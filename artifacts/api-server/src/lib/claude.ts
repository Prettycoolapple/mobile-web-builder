import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import { SYSTEM_PROMPT, ANALYSE_AUGMENTATION, DISCOVER_AUGMENTATION, languageInstruction, type Locale } from "./prompts";
import { findSuburbId, findSuburbInTextViaIndex } from "./scrapers/realestate-api";
import type { DevelopmentStrategyAssessment, DevelopmentStrategyId, RefurbishmentScope } from "./development-strategies";
import { hasNumberedStreetAddress, hasUnnumberedStreetLine } from "./street-address-detect";

export { hasNumberedStreetAddress, hasNonStandardSalePropertyReference, hasUnnumberedStreetLine } from "./street-address-detect";

function analysisMaxOutputTokens(): number {
  const raw = process.env["AI_ANALYSIS_MAX_OUTPUT_TOKENS"]?.trim();
  const n = raw ? Number(raw) : 8192;
  if (!Number.isFinite(n) || n < 512) return 8192;
  return Math.floor(Math.min(Math.max(n, 512), 65536));
}

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type ChatMode = "analyse" | "discover" | "followup";

export function sanitizeAssistantProse(content: string, locale: Locale = "en"): string {
  let out = content;

  // Keep conversational replies out of code/JSON territory. The report JSON is
  // still returned untouched in analyse mode; this is only for plain chat text.
  out = out.replace(/```[\s\S]*?```/g, (block) => {
    const body = block.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```\s*$/, "").trim();
    return body.startsWith("{") || body.startsWith("[") ? "" : body;
  });
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/\(\s*(?:isOnMarket|isListed|listingPrice|agentName|agentPhone|agencyName|found|source|listingUrl)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^)\s,，。;；]+)\s*\)/gi, "");
  out = out.replace(/\b(?:isOnMarket|isListed|listingPrice|agentName|agentPhone|agencyName|found|source|listingUrl)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^\s,，。;；)]+)/gi, "");
  out = out.replace(/\{\s*(?:isOnMarket|isListed|listingPrice|agentName|agentPhone|agencyName|found|source|listingUrl)[^{}]*\}/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").replace(/\s+([,，。.;；])/g, "$1").trim();

  if (locale === "zh") {
    out = out.replace(/如果您希望出售或评估该房产[，,]\s*/g, "");
    out = out.replace(/我可以为您联系\s*Project Alpha\s*网络内的大奥克兰地区房地产中介。?/g, "");
    out = out.replace(/您需要我为您介绍一位熟悉[^？?]*的销售代理吗[？?]?/g, "");
  } else {
    out = out.replace(/I can (?:connect|introduce|refer) you (?:with|to) (?:a )?(?:Project Alpha )?(?:network )?(?:sales|real estate|listing) agent[^.?!]*[.?!]?/gi, "");
  }

  const genericOutroPatterns = [
    /^\s*>?\s*(?:以上|以上建议|以上分析|以上内容|上述内容|上述分析)[\s\S]*(?:仅供|不构成|专业建议|专业意见|已签约|服务提供商|Project Alpha)[\s\S]*$/i,
    /^\s*>?\s*(?:如需|如果您需要|若需要|如果需要)[\s\S]*(?:Project Alpha|已签约|服务提供商|专业人士)[\s\S]*$/i,
    /^\s*>?\s*(?:The above|This analysis|These estimates|This is based on)[\s\S]*(?:indicative|professional advice|not financial|not investment|Project Alpha|provider database|service provider)[\s\S]*$/i,
    /^\s*>?\s*(?:If you need|If you'd like|For next steps)[\s\S]*(?:Project Alpha|provider database|service provider|professional advice)[\s\S]*$/i,
  ];
  const paragraphs = out.split(/\n{2,}/);
  while (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1].trim();
    if (!genericOutroPatterns.some((pattern) => pattern.test(last))) break;
    paragraphs.pop();
  }
  out = paragraphs.join("\n\n");

  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** User is browsing listings / market availability (not asking for a single-title feasibility report). */
export function isListingBrowseIntent(message: string): boolean {
  if (
    /有什么在卖|在售|房源|挂牌|看看.*卖|哪些.*卖|什么.*在售|想买|看房|市场上有|在售房源|有卖|出售.*吗|在售的|买房|找房/i.test(message)
  ) {
    return true;
  }
  const lower = message.toLowerCase();
  if (
    /what(?:'s| is| are)\s+(?:for\s+)?sale|on\s+the\s+market|anything\s+for\s+sale|any\s+listings?|properties\s+for\s+sale|homes\s+for\s+sale|houses\s+for\s+sale|land\s+for\s+sale|what(?:'s| is)\s+available/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (/(?:looking|search|searching)\s+for\s+.+\s+in\s+/i.test(lower)) return true;
  return false;
}

// ─── LLM-powered intent extraction ───────────────────────────────────────────
// Instead of hardcoded keyword lists and regex, we ask DeepSeek chat to parse
// the user's intent from the full conversation context. This handles arbitrary
// phrasing, context references ("it", "this area", "currently"), and implicit
// suburb resolution from the currently open report.
export interface ChatIntent {
  mode: ChatMode;
  // Analyse
  address: string | null;
  // Discover
  suburb: string | null;           // normalised suburb name; inferred from context if needed
  minPrice: number | null;
  maxPrice: number | null;
  criteria: string | null;         // free-text description of what they want (subdividable, lifestyle, etc.)
  isFollowUp: boolean;             // true when asking for more results from a prior search
  includeNegotiation: boolean;     // true when user doesn't require a listed price (auction, tender, POA)
  // Clarification loop
  needsClarification: boolean;     // true when required info is missing and a question should be returned
  clarificationQuestion: string | null; // the natural-language question to ask the user
  // Service provider recommendation
  wantsProviderRecommendation: boolean; // true when user (in any language) asks to be connected with a professional
  wantsAnotherProvider: boolean;        // true when user wants to SWAP/REPLACE the CURRENTLY shown provider card
  suggestedDiscipline: string | null;   // architect_designer | planner | engineer | quantity_surveyor | other
  // Wide-scan signal — true when the user is asking for an area-wide subdivision sweep
  // (district, large suburb, "anything subdividable") that legitimately needs minutes to run.
  wideScanSubdivisionIntent: boolean;
  // Meta
  reasoning: string;               // brief explanation for debugging / logging
}

export type DelegatedDiscoverSuburb = {
  suburb: string;
  candidates: string[];
  reasoning: string;
  source: "llm" | "history_suggestions";
};

const INTENT_SCHEMA = `{
  "mode": "analyse" | "discover" | "followup",
  "address": "<full NZ street address string> | null",
  "suburb": "<suburb name, lowercase, normalised> | null",
  "minPrice": <NZD number> | null,
  "maxPrice": <NZD number> | null,
  "criteria": "<free-text describing what the user wants> | null",
  "isFollowUp": <true if asking for more results from an earlier search OR answering a clarification question, false otherwise>,
  "includeNegotiation": <true if user does not require a price (accepts auction/tender/POA), false otherwise>,
  "needsClarification": <true ONLY when required info is missing AND you cannot infer it — see rules>,
  "clarificationQuestion": "<short conversational question to ask the user> | null",
  "wantsProviderRecommendation": <true when user asks to be connected with / referred to a professional service provider>,
  "wantsAnotherProvider": <true when user already has a provider shown and wants to swap/replace/change it for a different one>,
  "suggestedDiscipline": "architect_designer" | "planner" | "engineer" | "quantity_surveyor" | "other" | null,
  "wideScanSubdivisionIntent": <true when user is asking for an area-wide subdivision/development sweep — see WIDE SCAN below>,
  "reasoning": "<1 sentence explaining your classification>"
}`;

const INTENT_RULES = `## MODE CLASSIFICATION

mode="analyse"
  Trigger: user wants a feasibility report for ONE specific titled property, identified by
  a NUMBERED street address (e.g. "66 Marine Parade", "12 Remuera Road").
  OR uses explicit re-analysis words like "re-analyse", "redo", "run again", "analyse again",
  "new analysis", "re-run" for a specific property that already has a number in the message or history.

  NOT analyse — use mode="discover" instead when:
  • The user is browsing what is for sale / available / listings in an area (English OR Chinese:
    "what's for sale", "anything on the market", "有什么在卖的", "在售", "房源", etc.) even if they name a road or suburb without a street number.
  • The user only gives a road name + suburb without a number (e.g. "Marine Parade, Mellons Bay",
    "分析 Marine Parade, Howick") — they want listings or area exploration, not a single-parcel report.
  • Exception: numbered address + feasibility request → analyse. Street numbers often include a
    letter suffix (66A, 12B) or unit prefix (2/14) — these STILL count as a numbered lot; use
    mode="analyse" when the user asks to analyse that property.

  Examples: "8 Hampton Drive, St Heliers", "can you assess 12 Remuera Rd?",
  "run a feasibility on this one"

  CRITICAL EXCEPTION — classify as "followup" instead when ALL of the following are true:
    1. There is an open property report (shown in APP CONTEXT above)
    2. The user's question is clearly about THAT same property (risks, zone, costs, summary,
       what does X mean, explain Y, how does this compare, etc.)
    3. The message does NOT contain an address different from the open report's address
    4. The message does NOT contain explicit re-analysis triggers (re-analyse, redo, run again,
       analyse again, new analysis, re-run, fresh analysis)
  In that case the user is discussing the already-analysed property — use mode="followup"
  so the confirmed data in the current report is used, not a fresh API fetch.

mode="discover"
  Trigger: ANY expression of wanting to find, buy, browse, or invest in property —
  even vague ones with no suburb or price. Cast a wide net here. Include:
  • market browsing in Chinese: "有什么在卖的", "在售", "房源", "看看这一带有什么",
    "哪些房子在卖" — always discover, not analyse, unless the user also gives a numbered street address for one lot.
  • explicit search: "find me", "show me", "what's on the market", "any listings",
    "anything for sale", "what's available", "search for", "look for", "browse"
  • buying intent: "I want to buy", "I'm looking to buy", "I'm in the market",
    "I want to purchase", "I want to invest", "I have $X to spend", "I have a budget of"
  • development intent: "looking for a development opportunity", "any subdivisions",
    "any good sections", "development sites"
  • vague browsing: "anything good out there?", "what would you recommend?",
    "what should I look at?", "help me find something", "show me what's around"
  → Even if the user gives NO suburb and NO price, still classify as discover.
  → Do NOT classify buy/invest/search intent as "followup" — that kills the search flow.

mode="followup"
  Trigger: questions or comments about a current analysis, general property advice,
  "what does X mean", "tell me more", "explain that", "how does this work", etc.
  This is the LAST resort — only use it when there is no search or analyse intent.

## CONTEXT ACCUMULATION (check history before acting)

Before deciding what to do, scan the RECENT CONVERSATION for information already given:
- Has the user mentioned a suburb in any earlier message? → use it
- Has the user mentioned a price range in any earlier message? → use it
- Has the user given an address in any earlier message? → use it
- Did the last ASSISTANT message ask a clarifying question? → the user's reply answers it

Combine all accumulated info across turns. You must not ask for something the user
has already told you in an earlier turn.

## SUBURB RESOLUTION

- Explicit mention in any turn → use it (check full history, not just latest message)
- "this area", "around here", "this suburb", "currently" → infer from CURRENT REPORT ADDRESS
- Short reply like "St Heliers" or "Grey Lynn" after an assistant question → that IS the suburb
- If truly undetermined after checking all history → leave null

## PRICE EXTRACTION (check full history)

- "under $2m" / "below 2 million" / "up to 2M" → maxPrice: 2000000
- "$1.5m to $2.5m" / "between 1.5 and 2.5" → minPrice: 1500000, maxPrice: 2500000
- "around $1.8m" → minPrice: 1600000, maxPrice: 2000000
- "I have $2M" / "my budget is 2M" / "spending up to 2M" → maxPrice: 2000000
- If no price anywhere in history → both null (system will use defaults — do NOT ask)

## FOLLOW-UP AND CLARIFICATION ANSWERS

isFollowUp=true for: "show more", "any others", "what else", "more like that",
"find more", "keep looking", "any other options", "more properties", or when the
user's message is a direct answer to a clarification question in the prior turn.

When the user answers a clarification question:
  → Set isFollowUp=true
  → Set needsClarification=false
  → Extract suburb/price/address from the answer and combine with history

## CLARIFICATION RULES — ONE QUESTION AT A TIME

Only set needsClarification=true when:
  1. You have determined the mode (discover or analyse)
  2. A REQUIRED piece of information is missing after checking all history
  3. The previous assistant message did NOT already ask about the same thing

Required pieces:
  • discover mode → suburb (REQUIRED). Price is NOT required; use defaults if absent.
  • analyse mode → full address (REQUIRED)

Ask ONE question at a time. Priority order for discover:
  1st: suburb (most important — without it, search cannot run)
  That's it. Do not ask for price, bedrooms, section size, etc.

For analyse:
  1st: full street address

Question style: short, conversational, friendly. Examples:
  "Which suburb are you thinking of?"
  "Any area in particular?"
  "Which neighbourhood?"
  "Which property did you have in mind — do you have an address?"

Never ask for price if suburb is provided. Never ask multiple questions at once.
Set needsClarification=false for mode="followup" always.

## ADDRESS EXTRACTION (CRITICAL — DO NOT HALLUCINATE)

- Extract the address EXACTLY as the user typed it. Do NOT correct, normalise, or
  "improve" suburb names, street names, or any part of the address.
- If the user writes "melons bay", put "melons bay" in the address field — do NOT
  change it to "Mission Bay" or any other suburb.
- If the user writes "66 marine parade melons bay", extract "66 Marine Parade, Melons Bay"
  — preserve every word the user actually typed, only fix capitalisation and add a comma.
- If the address looks misspelled or ambiguous, still extract it literally. The
  geocoder downstream will resolve or reject it — your job is faithful extraction, not correction.
- Only add suburb/city suffixes if the user explicitly mentioned them.
- NEVER substitute a similar-sounding suburb name (e.g. do NOT turn "Melons Bay" into
  "Mission Bay", do NOT turn "Remura" into "Remuera").
- When the user's message is in Chinese or another language, extract the English address
  tokens verbatim from the message without translating or re-interpreting them.

## SUBURB NORMALISATION
"Saint Heliers" → "st heliers", "Mt Eden" → "mt eden", "Grey Lynn" → "grey lynn",
"Remuera" → "remuera", "Mission Bay" → "mission bay", etc.

## PROFESSIONAL SERVICE PROVIDER RECOMMENDATION

Set wantsProviderRecommendation=true when the user (in English OR Chinese) is:
- Asking to be connected with or referred to a professional (builder, architect, designer, planner,
  engineer, quantity surveyor, project manager, etc.)
- Asking if the app knows anyone, can recommend someone, or can make an introduction
- Saying things like: "who can help", "do you have anyone", "can you recommend", "is there someone",
  "need a builder", "need an architect", "find me a planner", "connect me with", "any specialists"
- Chinese equivalents: 有没有...推荐, 介绍一个, 找设计师, 需要建筑师, 推荐专业人士, 有专家吗, etc.

Set suggestedDiscipline to the most relevant type based on context:
  "architect_designer" — design, architecture, drawings, plans, concept
  "planner"            — resource consent, zoning, planning rules, council
  "engineer"           — structural, geotech, civil, drainage, foundation
  "quantity_surveyor"  — cost estimate, budget, QS, quantity surveyor
  "other"              — builder, project manager, or any other professional
  null                 — when the discipline is unclear

Set wantsProviderRecommendation=false for all messages that are not about finding a professional.

## SWAP/REPLACE PROVIDER (wantsAnotherProvider)

wantsAnotherProvider is DISTINCT from wantsProviderRecommendation:
- wantsProviderRecommendation=true: user is asking to be connected with a professional for the FIRST TIME
- wantsAnotherProvider=true: a provider card is ALREADY SHOWN and the user wants a DIFFERENT one

Set wantsAnotherProvider=true when the user's intent is to replace, skip, or swap the currently
recommended provider — regardless of how they phrase it. Common expressions (any language):
  - Explicit swap: "别的", "换一个", "换人", "other one", "different person", "another specialist"
  - Dissatisfaction: "不合适", "不喜欢这个", "this doesn't work", "not quite right", "not a good fit"
  - Skip/pass: "next", "pass", "不感兴趣", "skip this one", "try someone else"
  - Any paraphrase meaning "I want a different provider than the one shown"

Set wantsAnotherProvider=false when there is no existing provider card being replaced.

## WIDE SCAN SUBDIVISION INTENT

Set wideScanSubdivisionIntent=true when ALL of the following are true:
  1. The user is asking what is subdividable / developable / splittable / can be split into multiple lots / has subdivision potential / 可分割 / 可以分割 / 可开发 / 可開發 / 可細分 / 可细分 / 分割潛力 / 分割潜力, in ANY language and ANY phrasing — formal or casual.
  2. The scope of the question is an AREA — a suburb, a Local Board / district name (orakei, howick, north shore, eastern bays, the shore, west auckland, 东区, 北岸, 西区), a city, a region, or simply "around here" / "near me" / "this area" inferred from the report context. NOT a specific numbered street address.
  3. The user is NOT asking about ONE named property.

This signal tells the app the request will legitimately take 1-5 minutes to walk through every active listing in the area and check each one against the subdivision criteria — the UI will show a "this may take a while" hint.

Set false when:
  • The user named a single street address ("can 12 Foo Road be subdivided?" — analyse, not wide scan).
  • The user is asking about non-subdivision criteria ("show me 3-bed houses under 1M" — discover, not wide-scan).
  • The user is asking for general advice without an area scope ("how does subdivision work?" — followup).

Wide-scan intent CAN be true alongside mode="discover" or mode="followup". It is independent of mode classification — it is purely a hint about how long the search will take. Set it whenever the trigger conditions above are met, regardless of which mode you pick.`;

/**
 * Tiny LLM classifier called by the mobile in parallel with the main chat
 * request, so the loading bubble can show a "this may take 1-5 min" subtitle
 * as soon as the user submits a wide-scan subdivision query — without having
 * to wait for the slow discovery work to start.
 *
 * Kept narrow on purpose: one boolean, ~32 output tokens, no nested fields,
 * so it returns in ~1-2 s. The authoritative classification still happens
 * inside extractChatIntent during the main request; this helper exists only
 * so the UI can update immediately.
 */
export async function classifyWideScanSubdivisionIntent(
  messages: Message[],
  locale: Locale = "en",
): Promise<boolean> {
  const last = [...messages].reverse().find((m) => m.role === "user");
  if (!last?.content?.trim()) return false;
  const recent = messages.slice(-6).map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 240)}`).join("\n");
  const localeNote = locale === "zh"
    ? " The user may write in Simplified Chinese or English — understand both."
    : "";
  const prompt = `You are an intent classifier for a NZ property app.${localeNote}

Recent conversation:
${recent}

Decide whether the user's LATEST message is asking the app to do a wide, area-wide sweep of "what is subdividable / developable / splittable into multiple lots" across an entire suburb, district, Local Board, city, region, or generic "around here" — in any language, any phrasing, formal or casual.

Return true ONLY when ALL hold:
  1. The user is asking about subdivision / development / splitting into multiple lots / 可分割 / 可以分割 / 可开发 / 可開發 / 可細分 / 可细分 / 分割潛力 / 分割潜力.
  2. The scope is an AREA, not a single numbered street address.
  3. No specific property is named.

Return false otherwise.

Reply with ONLY valid JSON, no markdown: {"wide": true|false}`;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: { maxOutputTokens: 32, temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    const match = raw.match(/\{[\s\S]*?\}/);
    if (!match) return false;
    const parsed = JSON.parse(match[0]) as { wide?: unknown };
    return parsed.wide === true;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "classifyWideScanSubdivisionIntent: LLM call failed");
    return false;
  }
}

export async function extractChatIntent(
  messages: Message[],
  reportContext?: {
    address?: string | null;
    suburb?: string | null;
  } | null,
  alreadyShownAddresses?: string[],
  locale: Locale = "en",
): Promise<ChatIntent> {
  if (messages.length === 0) {
    return {
      mode: "followup", address: null, suburb: null, minPrice: null, maxPrice: null,
      criteria: null, isFollowUp: false, includeNegotiation: false,
      needsClarification: false, clarificationQuestion: null,
      wantsProviderRecommendation: false, suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "empty messages",
    };
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return {
      mode: "followup", address: null, suburb: null, minPrice: null, maxPrice: null,
      criteria: null, isFollowUp: false, includeNegotiation: false,
      needsClarification: false, clarificationQuestion: null,
      wantsProviderRecommendation: false, suggestedDiscipline: null,
      wideScanSubdivisionIntent: false,
      reasoning: "no user message",
    };
  }

  // Build conversation history (last 12 turns) for context accumulation across multiple Q&A loops
  const recentHistory = messages.slice(-12).filter((m) => m !== lastUserMessage);
  const historyText = recentHistory.length > 0
    ? recentHistory.map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 400)}`).join("\n")
    : "(no prior conversation)";

  const contextLines: string[] = [];
  if (reportContext?.address) contextLines.push(`Currently open property report: ${reportContext.address}`);
  if (reportContext?.suburb) contextLines.push(`Report suburb: ${reportContext.suburb}`);
  if (alreadyShownAddresses && alreadyShownAddresses.length > 0) {
    contextLines.push(`Properties already shown to user: ${alreadyShownAddresses.slice(0, 5).join("; ")}`);
  }
  const contextText = contextLines.length > 0 ? contextLines.join("\n") : "(no open report)";

  const localeInstruction = locale === "zh"
    ? `\n\nLANGUAGE NOTE:
- The user may write in English OR Simplified Chinese — understand BOTH equally.
- When needsClarification=true, write clarificationQuestion in Simplified Chinese (简体中文).
- Keep NZ addresses, suburb names, zone codes, and numbers in their original form inside the JSON fields. Only the clarificationQuestion should be in Chinese.`
    : "";

  const prompt = `You are an intent parser for a NZ property development app called Project Alpha.
Your job: read the FULL CONVERSATION HISTORY and the user's latest message, accumulate all
information given across all turns (suburb, price, address, criteria), then classify intent
and decide whether you have enough to act or need to ask one more question.

APP CONTEXT:
${contextText}

CONVERSATION HISTORY (read all of it — earlier turns contain important accumulated info):
${historyText}

USER'S LATEST MESSAGE:
"${lastUserMessage.content}"

${INTENT_RULES}${localeInstruction}

Return ONLY valid JSON matching this schema (no explanation, no markdown fences):
${INTENT_SCHEMA}`;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        // Some providers spend "thinking" tokens out of this budget before any
        // visible output. 512 was being fully consumed by thinking on
        // ambiguous follow-ups (e.g. "show me more"), leaving no room for the
        // JSON answer. Disable thinking and give plenty of room for output.
        maxOutputTokens: 1024,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in response");

    const parsed = JSON.parse(match[0]) as ChatIntent;

    const VALID_DISCIPLINES = ["architect_designer", "planner", "engineer", "quantity_surveyor", "other"];

    // Sanitise fields
    let intent: ChatIntent = {
      mode: (["analyse", "discover", "followup"] as ChatMode[]).includes(parsed.mode) ? parsed.mode : "followup",
      address: parsed.address ?? null,
      suburb: parsed.suburb ? parsed.suburb.toLowerCase().trim() : null,
      minPrice: typeof parsed.minPrice === "number" && parsed.minPrice > 0 ? parsed.minPrice : null,
      maxPrice: typeof parsed.maxPrice === "number" && parsed.maxPrice > 0 ? parsed.maxPrice : null,
      criteria: parsed.criteria ?? null,
      isFollowUp: Boolean(parsed.isFollowUp),
      includeNegotiation: Boolean(parsed.includeNegotiation),
      needsClarification: Boolean(parsed.needsClarification),
      clarificationQuestion: parsed.clarificationQuestion ?? null,
      wantsProviderRecommendation: Boolean(parsed.wantsProviderRecommendation),
      wantsAnotherProvider: Boolean(parsed.wantsAnotherProvider),
      suggestedDiscipline: parsed.suggestedDiscipline && VALID_DISCIPLINES.includes(parsed.suggestedDiscipline as string) ? parsed.suggestedDiscipline : null,
      wideScanSubdivisionIntent: Boolean(parsed.wideScanSubdivisionIntent),
      reasoning: parsed.reasoning ?? "",
    };

    // If the model chose analyse for a road/area listing query, route to discover instead.
    const reAnalyseTrigger = /\b(re-?analy[sz]e|redo|run again|analy[sz]e again|new analysis|re-?run|fresh analysis)\b/i;
    const userMsg = lastUserMessage.content;
    if (
      intent.mode === "analyse"
      && !hasNumberedStreetAddress(userMsg)
      && (isListingBrowseIntent(userMsg) || (hasUnnumberedStreetLine(userMsg) && !reAnalyseTrigger.test(userMsg)))
    ) {
      let suburb = intent.suburb;
      if (!suburb) {
        const hit = await findSuburbInTextViaIndex(userMsg);
        if (hit) suburb = hit.title.toLowerCase();
      }
      intent = {
        ...intent,
        mode: "discover",
        address: null,
        suburb,
        needsClarification: !suburb,
        clarificationQuestion: !suburb
          ? (locale === "zh" ? "您想搜索哪个区域或郊区？" : "Which suburb or area should I search?")
          : null,
      };
    }

    // Safety: if needsClarification=true but no question was generated, supply a fallback
    if (intent.needsClarification && !intent.clarificationQuestion) {
      if (intent.mode === "discover") {
        intent.clarificationQuestion = locale === "zh"
          ? "您有特别想看的郊区吗?"
          : "Any particular suburb in mind?";
      } else if (intent.mode === "analyse") {
        intent.clarificationQuestion = locale === "zh"
          ? "您希望我分析哪个物业?请提供地址。"
          : "Which property would you like me to analyse? Please share the address.";
      } else {
        intent.needsClarification = false;
      }
    }
    // Safety: followup mode should never trigger a clarification
    if (intent.mode === "followup") {
      intent.needsClarification = false;
      intent.clarificationQuestion = null;
    }

    logger.info({ intent, userMessage: lastUserMessage.content.slice(0, 80) }, "LLM intent extraction");
    return intent;
  } catch (err) {
    logger.warn({ err: (err as Error).message, userMessage: lastUserMessage.content.slice(0, 80) }, "LLM intent extraction failed — falling back to regex");
    return await fallbackDetectIntent(lastUserMessage.content, reportContext, messages, locale);
  }
}

// Regex fallback (used when the LLM call fails or times out). All suburb
// detection here defers to the live realestate.co.nz directory (1899 suburbs)
// rather than any hand-curated list, so coverage tracks the data source.
async function fallbackDetectIntent(
  lastMessage: string,
  reportContext?: { address?: string | null; suburb?: string | null } | null,
  history?: Message[],
  locale: Locale = "en",
): Promise<ChatIntent> {
  const directHit = await findSuburbInTextViaIndex(lastMessage);
  // If the message is short and IS a known suburb, treat it as discover
  const trimmed = lastMessage.trim();
  const isSuburbOnly = directHit !== null
    && trimmed.split(/\s+/).length <= 5
    && !/\b(is|are|was|were|what|where|how|find|show|search|properties|property|house|land|section)\b/i.test(trimmed);
  const mode = isSuburbOnly ? "discover" : detectMode(lastMessage);

  // Scan recent user turns for a previously mentioned suburb so follow-ups
  // ("show me more", "any others") preserve the search context.
  let priorSuburb: string | null = null;
  if (history && history.length > 0) {
    for (let i = history.length - 1; i >= 0 && !priorSuburb; i--) {
      const m = history[i];
      if (m.role !== "user" || m.content === lastMessage) continue;
      const hit = await findSuburbInTextViaIndex(m.content);
      if (hit) priorSuburb = hit.title.toLowerCase();
    }
  }

  const suburb = (directHit?.title.toLowerCase() ?? null)
    ?? priorSuburb
    ?? (mode === "discover" && reportContext?.suburb ? reportContext.suburb.toLowerCase().trim() : null);

  const isFollowUp = /any\s*(others?|more)|show\s*(me\s*)?more|more\s*(properties|options|results|sites)|what\s*else|other\s*properties|more\s*results|few\s*more|find\s*more/i.test(lastMessage);

  const needsClarification = mode === "discover" && !suburb;

  const lowerFallback = lastMessage.toLowerCase();
  const providerKeywordsFallback = [
    "recommend", "referral", "architect", "builder", "planner", "engineer",
    "quantity surveyor", "specialist", "professional", "who can help",
    "设计师", "建筑师", "工程师", "推荐", "介绍",
  ];
  const wantsProviderRecommendation = providerKeywordsFallback.some((kw) => lowerFallback.includes(kw));

  return {
    mode,
    address: null,
    suburb,
    minPrice: null,
    maxPrice: null,
    criteria: lastMessage,
    isFollowUp,
    includeNegotiation: /negotiat|poa|by\s+applic|tender|auction/i.test(lowerFallback),
    needsClarification,
    clarificationQuestion: needsClarification
      ? (locale === "zh" ? "您有特别想看的郊区吗?" : "Any particular suburb in mind?")
      : null,
    wantsProviderRecommendation,
    wantsAnotherProvider: false,
    suggestedDiscipline: null,
    wideScanSubdivisionIntent: false,
    reasoning: "regex fallback",
  };
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value.trim());
  }
  return out;
}

async function validateSuburbCandidates(candidates: string[]): Promise<string[]> {
  const valid: string[] = [];
  for (const candidate of uniqueStrings(candidates).slice(0, 12)) {
    const hit = await findSuburbId(candidate).catch(() => null);
    if (hit) valid.push(hit.title.toLowerCase());
  }
  return uniqueStrings(valid);
}

async function extractSuburbSuggestionsFromRecentAssistant(messages: Message[]): Promise<string[]> {
  const assistantMessages = [...messages].reverse().filter((m) => m.role === "assistant").slice(0, 3);
  const candidates: string[] = [];
  for (const message of assistantMessages) {
    const text = message.content ?? "";
    const words = text.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
    for (let start = 0; start < words.length; start++) {
      for (let len = 1; len <= 3 && start + len <= words.length; len++) {
        candidates.push(words.slice(start, start + len).join(" "));
      }
    }
  }
  return validateSuburbCandidates(candidates);
}

function looksLikeDelegatedChoiceFallback(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return false;
  return /\b(any|anything|anywhere|either|whatever|whichever|you\s+(choose|pick|decide)|your\s+choice|no\s+preference|all\s+good|up\s+to\s+you)\b/i.test(trimmed)
    || /(都可以|都行|随便|隨便|你(?:来|來)?决定|你(?:来|來)?选|你看着办|无所谓|無所謂|哪个都行|哪個都行)/u.test(trimmed);
}

/**
 * Resolves replies like "any", "都可以", "you pick", or "whatever is best"
 * after a suburb clarification. The decision is semantic and context-aware:
 * an LLM reads the conversation and proposes concrete suburbs, then every
 * candidate is validated against the live realestate.co.nz suburb directory.
 */
export async function resolveDelegatedDiscoverSuburb(
  messages: Message[],
  latestMessage: string,
  locale: Locale = "en",
): Promise<DelegatedDiscoverSuburb | null> {
  const recent = messages.slice(-8).map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 500)}`).join("\n");
  const prompt = `You are resolving a property-search clarification in a New Zealand real estate app.

Conversation:
${recent}

Latest user message:
"${latestMessage}"

Task:
- Decide whether the latest user message means the user is delegating the suburb choice to the app, such as "any is fine", "you choose", "whatever", "都可以", "随便", or similar.
- Also accept this when the user originally gave a broad region, e.g. North Shore, Auckland, and is clearly asking for any suitable suburb in that region.
- If yes, return 3 to 6 concrete NZ suburb names that would be sensible to search for the user's property intent, preferring suburbs suggested by the assistant if any were offered.
- If no, return acceptsChoice=false.

Return ONLY JSON:
{"acceptsChoice": boolean, "candidates": ["suburb name"], "reasoning": "short reason"}`;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        maxOutputTokens: 512,
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in delegated suburb response");
    const parsed = JSON.parse(match[0]) as { acceptsChoice?: unknown; candidates?: unknown; reasoning?: unknown };
    if (parsed.acceptsChoice !== true || !Array.isArray(parsed.candidates)) return null;
    const valid = await validateSuburbCandidates(parsed.candidates.filter((x): x is string => typeof x === "string"));
    if (valid.length > 0) {
      const chosen = valid[Math.floor(Math.random() * valid.length)] ?? valid[0];
      return {
        suburb: chosen,
        candidates: valid,
        reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "user delegated suburb choice",
        source: "llm",
      };
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, latestMessage: latestMessage.slice(0, 80) }, "Delegated suburb resolver failed");
  }

  if (!looksLikeDelegatedChoiceFallback(latestMessage)) return null;

  const fallbackCandidates = await extractSuburbSuggestionsFromRecentAssistant(messages);
  if (fallbackCandidates.length === 0) return null;
  const chosen = fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)] ?? fallbackCandidates[0];
  return {
    suburb: chosen,
    candidates: fallbackCandidates,
    reasoning: "user delegated suburb choice; selected from prior assistant suggestions",
    source: "history_suggestions",
  };
}

export function detectMode(lastMessage: string): ChatMode {
  const lower = lastMessage.toLowerCase().trim();
  const numbered = hasNumberedStreetAddress(lastMessage);
  const browse = isListingBrowseIntent(lastMessage);
  const hasAnalyseVerbEn = /\b(analyse|analyze|analysis|feasibility|assess|evaluate)\b/i.test(lower);
  const hasAnalyseVerbZh =
    /(?:^|[\s，。!?])(?:分析|可行性分析|跑一下分析)/.test(lastMessage) ||
    /(?:我要|我想|还请|帮我|请).{0,6}分析/.test(lastMessage);
  const hasAddressCity = /,\s*(auckland|wellington|christchurch|hamilton|tauranga|dunedin|napier|hastings|palmerston|rotorua|new zealand|nz)\b/i.test(lastMessage);

  // Market / listing browse without a numbered lot → always discover (road + suburb is a filter, not one title).
  if (browse && !numbered) return "discover";

  // "Analyse …" on a road name only (no number) → discover so we show listing cards, not a fake whole-street report.
  if ((hasAnalyseVerbEn || hasAnalyseVerbZh) && !numbered && hasUnnumberedStreetLine(lastMessage)) {
    return "discover";
  }

  // Comma + city + street name but no lot number → area / corridor, not one titled parcel
  if (!numbered && hasUnnumberedStreetLine(lastMessage) && hasAddressCity) return "discover";

  // ─── ANALYSE: only with a numbered street address ─────────────────────────
  if (numbered) return "analyse";

  if (hasAnalyseVerbEn || hasAnalyseVerbZh) return "followup";

  // ─── DISCOVER: property search intent ─────────────────────────────────────
  const searchKeywords = [
    "find me", "find properties", "search for", "show me properties", "discover",
    "looking for properties", "what properties", "properties in", "sections in", "land in",
    "subdividable", "subdivision opportunities", "development sites", "lifestyle properties",
    "investment properties", "find sites", "show properties",
    "any properties", "any homes", "any houses", "any sections", "any land",
    "properties for sale", "homes for sale", "houses for sale", "land for sale",
    "on the market", "on sale", "for sale in", "listed in", "listings in",
    "available in", "available properties",
    "land bigger", "land larger", "land size", "bigger than", "larger than",
    "at least", "minimum land", "sites in", "sites near",
    "price around", "budget of", "under $", "below $", "above $",
    "looking to buy", "want to buy", "buying in",
  ];
  if (searchKeywords.some((k) => lower.includes(k))) return "discover";

  const searchPatterns = [
    /any\s+\w+\s+propert/i,
    /propert\w*\s+(on\s+sale|for\s+sale|available|listed)/i,
    /land\s+(area\s+)?(bigger|larger|over|above|more\s+than|greater\s+than)\s+\w*\s*\d/i,
    /\d+\s*(m2|sqm|m²|square\s+met)\s*(or\s+)?(bigger|larger|more|plus|above|over)/i,
    /show\s+(me\s+)?(all|some|any)\s+/i,
    /what('s|\s+is|\s+are)\s+(available|on\s+(the\s+)?market|for\s+sale)/i,
    /^(what|how)\s+about\s+(in\s+)?[\w\s]+/i,
    /^(try|check|look\s+in|look\s+at)\s+[\w\s]+/i,
    /^(ok|okay|and)[\s,]*(what|how)\s+about/i,
  ];
  if (searchPatterns.some((p) => p.test(lower))) return "discover";

  // (Suburb-only short messages are handled by the async `fallbackDetectIntent`
  // wrapper using the live suburb directory — no hand-curated list needed here.)

  const followUpDiscoverKeywords = [
    "any others", "any more", "show more", "more properties", "more options",
    "what else", "other properties", "more results", "others like", "more like",
    "anything else", "show me more", "any other", "more sites", "other options",
    "keep looking", "find more", "another one", "few more",
  ];
  if (followUpDiscoverKeywords.some((k) => lower.includes(k))) return "discover";

  return "followup";
}

// ─── LLM-driven nearby suburb suggestions ────────────────────────────────────
// Replaces a hand-curated NEARBY_SUBURBS adjacency map with a tiny LLM call
// that uses the model's geographic knowledge of NZ. Results are cached for the
// lifetime of the process so we only pay the LLM cost once per suburb.
const nearbySuburbCache = new Map<string, { value: string[]; expiresAt: number }>();
const NEARBY_OK_TTL_MS = 60 * 60 * 1000;       // 1h for successful results
const NEARBY_NEG_TTL_MS = 60 * 1000;           // 60s for failures (avoid hammering LLM during outage)
const NEARBY_TIMEOUT_MS = 3000;                // hard timeout so we never stall the discover pipeline

export async function suggestNearbySuburbs(suburb: string, max = 5): Promise<string[]> {
  if (!suburb) return [];
  const key = suburb.toLowerCase().trim();
  const now = Date.now();
  const cached = nearbySuburbCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value.slice(0, max);

  const prompt = `List the ${max} suburbs geographically closest to "${suburb}", New Zealand.
Use real NZ suburb names that would appear on realestate.co.nz.
Return ONLY a JSON array of lowercase suburb name strings, no prose, no markdown.
Example: ["kohimarama","mission bay","glendowie","meadowbank","saint johns"]`;

  try {
    const llmCall = ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        maxOutputTokens: 256,
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const response = await Promise.race([
      llmCall,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM nearby-suburb timeout")), NEARBY_TIMEOUT_MS),
      ),
    ]);
    const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("no JSON array");
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const cleaned = parsed
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.toLowerCase().trim())
      .filter((s) => s.length > 1 && s.toLowerCase() !== key)
      .slice(0, max);
    nearbySuburbCache.set(key, { value: cleaned, expiresAt: now + NEARBY_OK_TTL_MS });
    logger.info({ suburb, nearby: cleaned }, "LLM nearby suburbs");
    return cleaned;
  } catch (err) {
    // Negative-cache briefly so we don't hammer the LLM provider during an outage
    nearbySuburbCache.set(key, { value: [], expiresAt: now + NEARBY_NEG_TTL_MS });
    logger.warn({ err: (err as Error).message, suburb }, "LLM nearby-suburb suggestion failed");
    return [];
  }
}

const unresolvedPropertySuburbCache = new Map<string, { value: string | null; expiresAt: number }>();
const UNRESOLVED_PROPERTY_SUBURB_TTL_MS = 60 * 60 * 1000;
const UNRESOLVED_PROPERTY_SUBURB_TIMEOUT_MS = 2500;

export async function inferLikelySuburbForUnresolvedProperty(text: string): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const directHit = await findSuburbInTextViaIndex(trimmed).catch(() => null);
  if (directHit) return directHit.title.toLowerCase();

  const key = trimmed.toLowerCase();
  const cached = unresolvedPropertySuburbCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const prompt = `The user typed a non-standard NZ property sale label or road reference:
"${trimmed}"

Identify the most likely realestate.co.nz suburb/locality to search nearby sale listings.
Return ONLY one suburb/locality name, or "null" if you cannot infer it confidently.
Do not include a street name, district, explanation, punctuation, or markdown.`;

  try {
    const llmCall = ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        maxOutputTokens: 64,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    const response = await Promise.race([
      llmCall,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("unresolved property suburb timeout")), UNRESOLVED_PROPERTY_SUBURB_TIMEOUT_MS),
      ),
    ]);
    const raw = (response.text ?? "").trim().replace(/^["'`]+|["'`.]+$/g, "");
    if (!raw || /^null$/i.test(raw)) {
      unresolvedPropertySuburbCache.set(key, { value: null, expiresAt: Date.now() + UNRESOLVED_PROPERTY_SUBURB_TTL_MS });
      return null;
    }

    const suburb = raw.toLowerCase().replace(/\s+/g, " ").trim();
    const verified = await findSuburbId(suburb).catch(() => null);
    const value = verified ? verified.title.toLowerCase() : null;
    unresolvedPropertySuburbCache.set(key, { value, expiresAt: Date.now() + UNRESOLVED_PROPERTY_SUBURB_TTL_MS });
    return value;
  } catch (err) {
    logger.warn({ err: (err as Error).message, sample: trimmed.slice(0, 80) }, "Unresolved property suburb inference failed");
    unresolvedPropertySuburbCache.set(key, { value: null, expiresAt: Date.now() + 60_000 });
    return null;
  }
}

function buildLlmHistory(conversationHistory: Message[]) {
  return conversationHistory.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
}

export async function generateUnifiedResponse(
  messages: Message[],
  currentReport?: object,
  overrideMode?: ChatMode,
  locale: Locale = "en",
): Promise<{ content: string; mode: ChatMode }> {
  const langSuffix = languageInstruction(locale);
  if (messages.length === 0) {
    return {
      content: locale === "zh"
        ? "今天我能为您的新西兰物业开发提供什么帮助？"
        : "How can I help you with NZ property development today?",
      mode: "followup",
    };
  }

  const lastMessage = messages[messages.length - 1];
  const conversationHistory = messages.slice(0, -1);
  // Prefer the caller-supplied mode (from LLM intent extraction) over the internal regex detectMode
  const mode = overrideMode ?? detectMode(lastMessage.content);

  let systemWithContext = SYSTEM_PROMPT + langSuffix;
  if (currentReport) {
    const r = currentReport as Record<string, unknown>;
    const planning   = r["planning"]         as Record<string, unknown> | undefined;
    // Prefer the deterministic snapshot pinned at /analyse time over any
    // narrative-derived propertyOverview block. The snapshot mirrors the merged
    // pipeline output (which itself prefers the live OneRoof listing when active),
    // so follow-up answers stay consistent with the figures shown on the report.
    const snapshot   = r["property_overview_snapshot"] as Record<string, unknown> | undefined;
    const overview   = snapshot ?? (r["propertyOverview"] as Record<string, unknown> | undefined);
    const asbestosInfo = r["asbestos"]       as Record<string, unknown> | undefined;
    const terrain    = r["terrain"]          as Record<string, unknown> | undefined;
    const scores     = r["scores"]           as Record<string, unknown> | undefined;
    const costItems  = r["costItems"]        as Array<Record<string, unknown>> | undefined;
    const infraArr   = r["infrastructure"]   as Array<Record<string, unknown>> | undefined;
    const riskArr    = r["riskSummary"]      as string[] | undefined;
    const scenarios  = r["roiScenarios"]     as Array<Record<string, unknown>> | undefined;

    // ── helpers ──────────────────────────────────────────────────────────────
    const fmt = (v: unknown) => (v != null ? String(v) : null);
    const nzd = (v: unknown) => (typeof v === "number" && v > 0 ? `$${v.toLocaleString("en-NZ")}` : null);

    // ── property overview ────────────────────────────────────────────────────
    const address   = fmt(r["address"] ?? overview?.["address"]);
    const cv        = fmt(overview?.["cv"]);
    const cvYear    = fmt(overview?.["cv_year"]);
    const landArea  = fmt(overview?.["landArea"]);
    const floorArea = fmt(overview?.["floorArea"]);
    const buildYear = fmt(overview?.["buildYear"] ?? asbestosInfo?.["buildYear"]);
    const bedrooms  = fmt(overview?.["bedrooms"]);
    const bathrooms = fmt(overview?.["bathrooms"]);
    const zoneLabel = fmt(r["zone_label"] ?? planning?.["zone"] ?? overview?.["zone"]);
    const zoneCode  = fmt(r["zone_code"]);
    const titleType = fmt(overview?.["titleType"]);
    const typology = fmt(overview?.["typology"]);
    const typologyConfidence = fmt(overview?.["typologyConfidence"]);
    const titleConfidence = fmt(overview?.["titleConfidence"]);
    const subdivisionEligible = overview?.["subdivisionEligible"];
    const subdivisionRejectReason = fmt(overview?.["subdivisionRejectReason"]);
    const listingPrice = fmt(overview?.["listingPrice"]);
    const isOnMarket   = overview?.["isOnMarket"];
    const discrepancies = (overview?.["discrepancies"] as string[] | undefined) ?? [];

    // ── planning ─────────────────────────────────────────────────────────────
    const potentialLots = fmt(planning?.["potentialLots"] ?? r["potential_lots"]);
    const minLotSize    = fmt(planning?.["minLotSize"]);
    const grossArea     = fmt(planning?.["grossAreaSqm"]);
    const netArea       = fmt(planning?.["netAreaSqm"]);
    const subdivSummary = fmt(planning?.["subdivisionSummary"]);
    const overlaysArr   = planning?.["overlays"] as Array<Record<string, unknown>> | undefined;
    const overlayLines  = (overlaysArr ?? []).map((o) => `    • ${o["name"]}: ${o["status"]}${o["detail"] ? ` — ${o["detail"]}` : ""}`).join("\n");
    const easementNote  = fmt(planning?.["easement_summary"] ?? planning?.["lot_impact_note"]);

    // ── terrain ──────────────────────────────────────────────────────────────
    const terrainClass = fmt(terrain?.["classification"]);
    const terrainSlope = fmt(terrain?.["slope"]);
    const terrainDeg   = terrain?.["slope_degrees"] != null ? String(terrain["slope_degrees"]) + "°" : null;
    const terrainSrc   = fmt(terrain?.["source"]);
    const retainLow    = nzd(terrain?.["retainingCostLow"]);
    const retainHigh   = nzd(terrain?.["retainingCostHigh"]);

    // ── asbestos ─────────────────────────────────────────────────────────────
    const asbestosRisk = fmt(asbestosInfo?.["riskLevel"] ?? asbestosInfo?.["risk"]);
    const asbestosNotes = fmt(asbestosInfo?.["notes"]);
    const demoLow  = nzd(asbestosInfo?.["demoCostLow"]);
    const demoHigh = nzd(asbestosInfo?.["demoCostHigh"]);

    // ── scores ───────────────────────────────────────────────────────────────
    const easeScore = scores?.["ease"] != null ? `${scores["ease"]}/5` : null;
    const costScore = scores?.["cost"] != null ? `${scores["cost"]}/5` : null;
    const roiScore  = scores?.["roi"]  != null ? `${scores["roi"]}/5`  : null;
    const composite = scores?.["composite"] != null ? `${scores["composite"]}/5` : null;
    const easeReasons = (scores?.["ease_reasons"] as string[] | undefined)?.join("; ") ?? null;
    const costReasons = (scores?.["cost_reasons"] as string[] | undefined)?.join("; ") ?? null;
    const roiReasons  = (scores?.["roi_reasons"]  as string[] | undefined)?.join("; ") ?? null;

    // ── costs ─────────────────────────────────────────────────────────────────
    const totalLow  = nzd(r["totalCostLow"]);
    const totalHigh = nzd(r["totalCostHigh"]);
    const costPerUnit = nzd(r["cost_per_unit_avg"]);
    const costLines = (costItems ?? []).map((ci) => {
      const lo = nzd(ci["low"]);
      const hi = nzd(ci["high"]);
      return lo || hi ? `    • ${ci["label"]}: ${lo ?? "—"} – ${hi ?? "—"}` : null;
    }).filter(Boolean).join("\n");

    // ── ROI scenarios ─────────────────────────────────────────────────────────
    const scenarioLines = (scenarios ?? []).map((s) => {
      const cases = (s["cases"] as Array<Record<string,unknown>> | undefined) ?? [];
      const caseSummary = cases.map((c) =>
        `${c["case"]} — GDV ${nzd(c["gdv"])}, profit ${nzd(c["gross_profit"])}, ROI ${c["roi_percent"]}%, viable: ${c["viable"]}`
      ).join(" | ");
      return `    • ${s["years"]}yr: ${caseSummary}`;
    }).join("\n");

    // ── infrastructure ────────────────────────────────────────────────────────
    const infraLines = (infraArr ?? []).map((inf) => {
      const lo = nzd(inf["estimatedCostLow"]);
      const hi = nzd(inf["estimatedCostHigh"]);
      return `    • ${inf["name"]}: ${inf["location"]}${inf["distance_metres"] != null ? ` (~${inf["distance_metres"]}m)` : ""}, risk: ${inf["risk"]}${lo ? `, cost ${lo}–${hi}` : ""} — ${inf["note"]}`;
    }).join("\n");

    // ── risk summary ──────────────────────────────────────────────────────────
    const riskLines = (riskArr ?? []).map((r, i) => `    ${i + 1}. ${r}`).join("\n");

    // ── build the pinned block ────────────────────────────────────────────────
    const sections: string[] = [];

    sections.push("PROPERTY OVERVIEW");
    if (address)      sections.push(`  Address: ${address}`);
    if (zoneLabel)    sections.push(`  Zone: ${zoneLabel}${zoneCode ? ` (${zoneCode})` : ""}`);
    if (cv)           sections.push(`  Capital Value (CV): ${cv}${cvYear ? ` (${cvYear})` : ""}`);
    if (landArea)     sections.push(`  Land area: ${landArea}`);
    if (floorArea)    sections.push(`  Floor area: ${floorArea}`);
    if (buildYear)    sections.push(`  Build year: ${buildYear}`);
    if (bedrooms)     sections.push(`  Bedrooms: ${bedrooms}`);
    if (bathrooms)    sections.push(`  Bathrooms: ${bathrooms}`);
    if (titleType)    sections.push(`  Title type: ${titleType}${titleConfidence ? ` (confidence: ${titleConfidence})` : ""}`);
    if (typology)     sections.push(`  Typology: ${typology}${typologyConfidence ? ` (confidence: ${typologyConfidence})` : ""}`);
    if (subdivisionEligible != null) {
      sections.push(`  Strict subdivision eligibility: ${subdivisionEligible ? "eligible" : "not eligible"}${subdivisionRejectReason ? ` (${subdivisionRejectReason})` : ""}`);
    }
    if (listingPrice) sections.push(`  Listing price: ${listingPrice}`);
    if (isOnMarket != null) {
      sections.push(`  Sale listing status: ${isOnMarket ? "currently listed for sale" : "not currently on the market"}`);
    }
    if (discrepancies.length > 0) {
      sections.push(`  Source reconciliation notes (live listing overrode council/QV — quote these if asked why a value differs from public records):`);
      for (const note of discrepancies) sections.push(`    • ${note}`);
    }

    sections.push("\nPLANNING");
    if (potentialLots) sections.push(`  Potential lots: ${potentialLots}`);
    if (minLotSize)    sections.push(`  Min lot size: ${minLotSize}`);
    if (grossArea)     sections.push(`  Gross area: ${grossArea}m²`);
    if (netArea)       sections.push(`  Net subdividable area: ${netArea}m²`);
    if (overlayLines)  sections.push(`  Overlays:\n${overlayLines}`);
    if (easementNote)  sections.push(`  Easements: ${easementNote}`);
    if (subdivSummary) sections.push(`  Subdivision summary: ${subdivSummary}`);

    sections.push("\nTERRAIN (measured — DO NOT override with suburb assumptions)");
    if (terrainClass) sections.push(`  Classification: ${terrainClass}${terrainDeg ? ` (${terrainDeg} slope)` : ""}`);
    if (terrainSlope) sections.push(`  Description: ${terrainSlope}`);
    if (terrainSrc)   sections.push(`  Source: ${terrainSrc}`);
    if (retainLow)    sections.push(`  Retaining cost estimate: ${retainLow} – ${retainHigh ?? "—"}`);

    sections.push("\nASBESTOS");
    if (asbestosRisk)  sections.push(`  Risk level: ${asbestosRisk}`);
    if (asbestosNotes) sections.push(`  Notes: ${asbestosNotes}`);
    if (demoLow)       sections.push(`  Demolition cost: ${demoLow} – ${demoHigh ?? "—"}`);

    sections.push("\nSCORES (computed — do NOT recalculate or contradict)");
    if (easeScore) sections.push(`  Ease: ${easeScore}${easeReasons ? ` — ${easeReasons}` : ""}`);
    if (costScore) sections.push(`  Cost: ${costScore}${costReasons ? ` — ${costReasons}` : ""}`);
    if (roiScore)  sections.push(`  ROI: ${roiScore}${roiReasons  ? ` — ${roiReasons}`  : ""}`);
    if (composite) sections.push(`  Composite: ${composite}`);

    sections.push("\nCOST BREAKDOWN (computed — do NOT recalculate or contradict)");
    if (costLines)    sections.push(costLines);
    if (totalLow)     sections.push(`  TOTAL: ${totalLow} – ${totalHigh ?? "—"}`);
    if (costPerUnit)  sections.push(`  Cost per unit (avg): ${costPerUnit}`);

    if (scenarioLines) {
      sections.push("\nROI SCENARIOS (computed — use these numbers verbatim)");
      sections.push(scenarioLines);
    }

    if (infraLines) {
      sections.push("\nINFRASTRUCTURE (from GIS — do NOT guess locations or costs)");
      sections.push(infraLines);
    }

    if (riskLines) {
      sections.push("\nRISK SUMMARY (from report — reference these when asked about risks)");
      sections.push(riskLines);
    }

    const pinnedBlock = sections.join("\n");

    const pinnedSection =
      `CRITICAL INSTRUCTION — FOLLOW-UP RESPONSE RULES:\n` +
      `You are answering a follow-up question about the property analysed in this session.\n` +
      `ALL figures, classifications, scores, and facts below come from verified pipeline data (LINZ, LiDAR, Auckland Council GIS, QV).\n` +
      `You MUST base your answer ONLY on this data. You MUST NOT:\n` +
      `  - claim the property is standalone/freehold/subdividable unless the pinned title, typology, and eligibility fields say so with verified confidence\n` +
      `  • contradict any figure, score, or classification listed here\n` +
      `  • substitute general suburb knowledge (e.g. "Remuera is hilly") for measured data\n` +
      `  • recalculate scores, costs, or ROI — quote the numbers below verbatim\n` +
      `  • invent overlays, easements, or infrastructure details not listed here\n` +
      `If you are uncertain about something not listed, say so — do not fill gaps with assumptions.\n\n` +
      `${pinnedBlock}\n\n`;

    systemWithContext =
      `${SYSTEM_PROMPT}${langSuffix}\n\n${pinnedSection}FULL REPORT JSON (reference for any detail not covered above):\n${JSON.stringify(currentReport, null, 2)}`;
  }

  let userContent = lastMessage.content;
  if (mode === "analyse") {
    userContent = `${lastMessage.content}\n\n${ANALYSE_AUGMENTATION}`;
  } else if (mode === "discover") {
    userContent = `${lastMessage.content}\n\n${DISCOVER_AUGMENTATION}`;
  }

  const history = buildLlmHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-reasoner",
      config: {
        systemInstruction: systemWithContext,
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: userContent }] },
      ],
    });
    const content = response.text ?? "";
    return { content, mode };
  } catch (error) {
    logger.error({ error }, "Failed to generate unified response");
    throw error;
  }
}

export async function generateAnalysis(
  enrichedContent: string,
  locale: Locale = "en",
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "deepseek-reasoner",
      config: {
        systemInstruction: SYSTEM_PROMPT + languageInstruction(locale),
        maxOutputTokens: analysisMaxOutputTokens(),
      },
      contents: [{ role: "user", parts: [{ text: enrichedContent }] }],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate property analysis");
    throw error;
  }
}

export async function generateFeasibilityReport(
  address: string,
  conversationHistory: Message[] = [],
  locale: Locale = "en",
): Promise<string> {
  const prompt = `Analyse this NZ property for development feasibility: ${address}\n\n${ANALYSE_AUGMENTATION}`;
  const history = buildLlmHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-reasoner",
      config: {
        systemInstruction: SYSTEM_PROMPT + languageInstruction(locale),
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: prompt }] },
      ],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate feasibility report");
    throw error;
  }
}

export async function generateSearchResults(
  query: string,
  suburb?: string,
  minPrice?: number,
  maxPrice?: number,
  locale: Locale = "en",
): Promise<string> {
  const prompt = `Search query: "${query}"
${suburb ? `Target suburb: ${suburb}` : ""}
${minPrice ? `Min price: NZD ${minPrice.toLocaleString()}` : ""}
${maxPrice ? `Max price: NZD ${maxPrice.toLocaleString()}` : ""}

${DISCOVER_AUGMENTATION}`;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-reasoner",
      config: {
        systemInstruction: SYSTEM_PROMPT + languageInstruction(locale),
        maxOutputTokens: 8192,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate search results");
    throw error;
  }
}

export async function selectCandidatesByIntent(
  query: string,
  candidates: Array<{
    address: string;
    price: number;
    landArea: number;
    zone: string;
    scores: { ease: number; cost: number; roi: number; composite: number };
    briefSummary: string;
  }>,
  maxResults: number = 5,
  alreadyShown: string[] = [],
): Promise<typeof candidates> {
  if (candidates.length === 0) return [];

  const available = alreadyShown.length > 0
    ? candidates.filter((c) => !alreadyShown.some((a) => a.toLowerCase() === c.address.toLowerCase()))
    : candidates;

  if (available.length === 0) return [];

  const prompt = `You are a NZ property development advisor. A user searched for: "${query}"

Here are available property candidates (JSON array):
${JSON.stringify(available.map((c, i) => ({ index: i, ...c })), null, 2)}

Your task:
1. Understand the user's intent (subdivision? lifestyle? investment yield? flat section? specific zone? price range?)
2. Select the ${maxResults} most relevant candidates that best match their intent
3. For each selected candidate, rewrite the "briefSummary" to directly address why it matches the user's specific request
4. Return ONLY a valid JSON array of the selected candidates (same structure, with updated briefSummary)

Rules:
- If user wants "subdividable" or "subdivision": prefer MHS/MHU zones with ease score ≥ 3.0, exclude SHZ/LSZ
- If user wants "lifestyle": prefer larger land, rural, SHZ, LSZ zones
- If user wants "high yield" or "investment": prefer high ROI and composite scores  
- If user mentions a price range, only include candidates within that range
- Always return valid JSON array only — no explanation text, no markdown code fences
- Return between 3 and ${maxResults} candidates`;

  try {
    const timeoutPromise = new Promise<typeof candidates>((_, reject) =>
      setTimeout(() => reject(new Error("Selection timeout")), 5000),
    );

    const selectionPromise = ai.models.generateContent({
      model: "deepseek-chat",
      config: { maxOutputTokens: 2048 },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }).then((response: { text?: string }) => {
      const text = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array in response");
      const parsed = JSON.parse(match[0]) as typeof candidates;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Empty array");
      return parsed.slice(0, maxResults);
    });

    return await Promise.race([selectionPromise, timeoutPromise]);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "selectCandidatesByIntent failed — using score fallback");
    return available.sort((a, b) => b.scores.composite - a.scores.composite).slice(0, maxResults);
  }
}

export type InterestRateOutlook = "falling" | "stable" | "rising";

export interface DevelopmentStrategyAssessmentFacts {
  address: string;
  build_year: number | null;
  build_year_range: string | null;
  floor_area_sqm: number | null;
  land_area_sqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zone_code: string | null;
  zone_description: string | null;
  potential_lots: number;
  contour: string | null;
  asbestos_risk: string | null;
  cv_nzd: number | null;
  listing_active: boolean;
  listing_price: number | null;
  comparable_sales_count: number;
}

function cleanStrategyId(value: unknown): DevelopmentStrategyId | null {
  if (value === "hold_existing" || value === "refurbish" || value === "demolish_rebuild") return value;
  return null;
}

function cleanRefurbishmentScope(value: unknown): RefurbishmentScope {
  if (value === "none" || value === "light" || value === "moderate" || value === "heavy") return value;
  return "moderate";
}

function cleanConfidence(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.55;
  return Math.max(0.1, Math.min(0.95, n));
}

export async function assessDevelopmentStrategy(
  facts: DevelopmentStrategyAssessmentFacts,
): Promise<DevelopmentStrategyAssessment> {
  const schema = `{
  "recommended_strategy": "hold_existing" | "refurbish" | "demolish_rebuild",
  "confidence": <number between 0 and 1>,
  "rationale": "<one concise sentence>",
  "refurbish_scope": "none" | "light" | "moderate" | "heavy",
  "strategy_rationales": {
    "hold_existing": "<one concise sentence>",
    "refurbish": "<one concise sentence>",
    "demolish_rebuild": "<one concise sentence>"
  },
  "key_factors": ["<short factual factor>", "..."]
}`;

  const prompt = `You are a senior NZ property development advisor.

Choose the most sensible development strategy for this property using ONLY the factual JSON below.

Strategies:
- hold_existing: keep the current dwelling/do nothing major. Use when the dwelling is modern, demolition would destroy value, or development upside is weak.
- refurbish: keep the structure and improve it. Use when the dwelling is dated but reusable, and a lower-capex improvement path is commercially sensible.
- demolish_rebuild: remove the existing dwelling and rebuild/develop. Use when the dwelling is old/poor fit, asbestos/demolition risk is acceptable relative to upside, and planning/land area support redevelopment.

Rules:
- Return ONLY valid JSON matching this schema:
${schema}
- Do NOT output costs, prices, ROI, comparables, or any invented property facts.
- If the property is post-2010 and no strong redevelopment signal exists, prefer hold_existing.
- If facts are incomplete, make the most conservative recommendation and mention uncertainty in key_factors.

INTENSIVE MULTI-LOT REDEVELOPMENT (potential_lots >= 4, especially THAB/MHU/MHS with many small lots):
- A high lot count means very high upfront capital, long consent + construction programmes, and usually phased sales — money is returned over many years, so headline project ROI is a poor proxy for annualised return or cash flow; annualised returns are typically much lower than for a 1–2 lot scheme.
- Execution and absorption risk rise sharply; use a materially LOWER confidence (often ~0.35–0.55 unless the case is exceptional). Mention staging, construction duration, and capital stacking in key_factors.
- Weigh hold_existing and refurbish more seriously when the existing dwelling is relatively new or cash-flow preservation matters; demolish_rebuild may still be strategic but is not "easy upside".
- Do NOT cite lack of comparable sales, market data gaps, or exit-price predictability — those bullets are forbidden. Focus on site delivery, programme, and capital intensity instead.

FACTS:
${JSON.stringify(facts, null, 2)}`;

  const response = await ai.models.generateContent({
    model: "deepseek-chat",
    config: {
      maxOutputTokens: 1024,
      temperature: 0.1,
    },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });

  const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No strategy JSON object in response");

  const parsed = JSON.parse(match[0]) as Partial<DevelopmentStrategyAssessment>;
  const recommended = cleanStrategyId(parsed.recommended_strategy);
  if (!recommended) throw new Error("Invalid recommended strategy");

  const strategyRationales = parsed.strategy_rationales && typeof parsed.strategy_rationales === "object"
    ? parsed.strategy_rationales as Partial<Record<DevelopmentStrategyId, string>>
    : {};

  return {
    recommended_strategy: recommended,
    confidence: cleanConfidence(parsed.confidence),
    rationale: typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : "Strategy recommendation is based on the fetched property facts.",
    refurbish_scope: cleanRefurbishmentScope(parsed.refurbish_scope),
    strategy_rationales: {
      hold_existing: typeof strategyRationales.hold_existing === "string" ? strategyRationales.hold_existing : "Holding avoids major capital works.",
      refurbish: typeof strategyRationales.refurbish === "string" ? strategyRationales.refurbish : "Refurbishment may improve value with lower capex than rebuilding.",
      demolish_rebuild: typeof strategyRationales.demolish_rebuild === "string" ? strategyRationales.demolish_rebuild : "Rebuild may unlock value where planning and comparables support it.",
    },
    key_factors: Array.isArray(parsed.key_factors)
      ? parsed.key_factors.filter((factor): factor is string => typeof factor === "string").slice(0, 5)
      : [],
  };
}

export async function assessInterestRateOutlook(): Promise<InterestRateOutlook> {
  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        systemInstruction:
          "You are an NZ macroeconomic analyst. Answer concisely with exactly one word from the options given.",
        maxOutputTokens: 10,
        temperature: 0.1,
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Based on RBNZ monetary policy direction and NZ economic conditions as of 2024–2025, " +
                "is the Official Cash Rate (OCR) trend: falling (rate cuts expected), stable (on hold), " +
                "or rising (hikes expected)? Reply with exactly one word: falling, stable, or rising.",
            },
          ],
        },
      ],
    });

    const raw = (response.text ?? "").trim().toLowerCase();
    if (raw.includes("falling")) return "falling";
    if (raw.includes("rising")) return "rising";
    return "stable";
  } catch {
    return "stable";
  }
}

export async function generateChatReply(
  message: string,
  conversationHistory: Message[] = [],
  reportContext?: string,
  locale: Locale = "en",
): Promise<string> {
  const langSuffix = languageInstruction(locale);
  const systemWithContext = reportContext
    ? `${SYSTEM_PROMPT}${langSuffix}\n\nCURRENT PROPERTY CONTEXT:\n${reportContext}`
    : SYSTEM_PROMPT + langSuffix;

  const history = buildLlmHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-reasoner",
      config: {
        systemInstruction: systemWithContext,
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: message }] },
      ],
    });
    return sanitizeAssistantProse(response.text ?? "", locale);
  } catch (error) {
    logger.error({ error }, "Failed to generate chat reply");
    throw error;
  }
}
