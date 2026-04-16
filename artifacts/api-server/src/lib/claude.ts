import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import { SYSTEM_PROMPT, ANALYSE_AUGMENTATION, DISCOVER_AUGMENTATION } from "./prompts";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export type ChatMode = "analyse" | "discover" | "followup";

// ─── LLM-powered intent extraction ───────────────────────────────────────────
// Instead of hardcoded keyword lists and regex, we ask Gemini Flash to parse
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
  // Meta
  reasoning: string;               // brief explanation for debugging / logging
}

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
  "reasoning": "<1 sentence explaining your classification>"
}`;

const INTENT_RULES = `## MODE CLASSIFICATION

mode="analyse"
  Trigger: user mentions a DIFFERENT NZ street address from any open report, OR uses
  explicit re-analysis words like "re-analyse", "redo", "run again", "analyse again",
  "new analysis", "re-run" for a specific property.
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

## SUBURB NORMALISATION
"Saint Heliers" → "st heliers", "Mt Eden" → "mt eden", "Grey Lynn" → "grey lynn",
"Remuera" → "remuera", "Mission Bay" → "mission bay", etc.`;

export async function extractChatIntent(
  messages: Message[],
  reportContext?: {
    address?: string | null;
    suburb?: string | null;
  } | null,
  alreadyShownAddresses?: string[],
): Promise<ChatIntent> {
  if (messages.length === 0) {
    return {
      mode: "followup", address: null, suburb: null, minPrice: null, maxPrice: null,
      criteria: null, isFollowUp: false, includeNegotiation: false,
      needsClarification: false, clarificationQuestion: null, reasoning: "empty messages",
    };
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return {
      mode: "followup", address: null, suburb: null, minPrice: null, maxPrice: null,
      criteria: null, isFollowUp: false, includeNegotiation: false,
      needsClarification: false, clarificationQuestion: null, reasoning: "no user message",
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

  const prompt = `You are an intent parser for a NZ property development app called DevFeasible.
Your job: read the FULL CONVERSATION HISTORY and the user's latest message, accumulate all
information given across all turns (suburb, price, address, criteria), then classify intent
and decide whether you have enough to act or need to ask one more question.

APP CONTEXT:
${contextText}

CONVERSATION HISTORY (read all of it — earlier turns contain important accumulated info):
${historyText}

USER'S LATEST MESSAGE:
"${lastUserMessage.content}"

${INTENT_RULES}

Return ONLY valid JSON matching this schema (no explanation, no markdown fences):
${INTENT_SCHEMA}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      config: {
        maxOutputTokens: 512,
        temperature: 0.1,
      },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const raw = (response.text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON object in response");

    const parsed = JSON.parse(match[0]) as ChatIntent;

    // Sanitise fields
    const intent: ChatIntent = {
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
      reasoning: parsed.reasoning ?? "",
    };

    // Safety: if needsClarification=true but no question was generated, supply a fallback
    if (intent.needsClarification && !intent.clarificationQuestion) {
      if (intent.mode === "discover") {
        intent.clarificationQuestion = "Any particular suburb in mind?";
      } else if (intent.mode === "analyse") {
        intent.clarificationQuestion = "Which property would you like me to analyse? Please share the address.";
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
    return fallbackDetectIntent(lastUserMessage.content, reportContext);
  }
}

// Regex fallback (used when the LLM call fails or times out)
function fallbackDetectIntent(
  lastMessage: string,
  reportContext?: { address?: string | null; suburb?: string | null } | null,
): ChatIntent {
  const mode = detectMode(lastMessage);
  const lower = lastMessage.toLowerCase();

  let suburb: string | null = null;
  const SUBURBS = [
    "remuera", "epsom", "mt eden", "grey lynn", "ponsonby", "parnell", "herne bay",
    "westmere", "kingsland", "sandringham", "mt albert", "mt roskill", "onehunga",
    "new lynn", "titirangi", "avondale", "st heliers", "kohimarama", "mission bay",
    "glendowie", "meadowbank", "howick", "pakuranga", "botany", "east tamaki",
    "henderson", "albany", "takapuna", "devonport", "northcote", "glenfield",
    "milford", "browns bay", "glen innes", "penrose", "ellerslie", "mangere",
    "birkenhead", "massey", "royal oak", "mt wellington", "manurewa", "papatoetoe",
    "papakura", "glen eden", "st johns", "otahuhu", "panmure",
  ];
  for (const s of SUBURBS) {
    if (lower.includes(s)) { suburb = s; break; }
  }

  // Fall back to report context suburb
  if (!suburb && mode === "discover" && reportContext?.suburb) {
    suburb = reportContext.suburb.toLowerCase().trim();
  }

  const isFollowUp = /any\s*(others?|more)|show\s*(me\s*)?more|more\s*(properties|options|results|sites)|what\s*else|other\s*properties|more\s*results|few\s*more|find\s*more/i.test(lastMessage);

  const needsClarification = mode === "discover" && !suburb;

  return {
    mode,
    address: null,
    suburb,
    minPrice: null,
    maxPrice: null,
    criteria: lastMessage,
    isFollowUp,
    includeNegotiation: /negotiat|poa|by\s+applic|tender|auction/i.test(lower),
    needsClarification,
    clarificationQuestion: needsClarification ? "Any particular suburb in mind?" : null,
    reasoning: "regex fallback",
  };
}

export function detectMode(lastMessage: string): ChatMode {
  const lower = lastMessage.toLowerCase().trim();

  // ─── ANALYSE: highest priority — check before any discover logic ───────────
  // A specific street address always means analyse, regardless of suburb mentions.
  const hasStreetAddress = /\d+\s+\w[\w''-]*(\s+\w[\w''-]*)?\s+(road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|boulevard|esplanade|quay)\b/i.test(lastMessage);
  const hasAddressCity = /,\s*(auckland|wellington|christchurch|hamilton|tauranga|dunedin|napier|hastings|palmerston|rotorua|new zealand|nz)\b/i.test(lastMessage);
  // Explicit analyse intent — even without an address in the current message (e.g. "just analyze the property")
  const hasAnalyseVerb = /\b(analyse|analyze|analysis|feasibility|assess|evaluate)\b/i.test(lower);

  if (hasStreetAddress || hasAddressCity || hasAnalyseVerb) return "analyse";

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

  // Short message with only a suburb name → discover follow-up
  const KNOWN_SUBURBS = [
    "remuera", "epsom", "mt eden", "grey lynn", "ponsonby", "parnell", "herne bay",
    "westmere", "kingsland", "sandringham", "mt albert", "mt roskill", "onehunga",
    "new lynn", "titirangi", "avondale", "st heliers", "kohimarama", "mission bay",
    "glendowie", "meadowbank", "howick", "pakuranga", "botany", "east tamaki",
    "henderson", "albany", "takapuna", "devonport", "northcote", "glenfield",
    "milford", "browns bay", "glen innes", "penrose", "ellerslie", "mangere",
    "birkenhead", "massey", "royal oak", "mt wellington", "manurewa", "papatoetoe",
    "papakura", "glen eden", "st johns", "otahuhu", "panmure",
    "saint heliers", "saint johns", "mount eden", "mount albert", "mount roskill", "mount wellington",
  ];
  const hasKnownSuburb = KNOWN_SUBURBS.some((s) => lower.includes(s));
  const isVagueShort = lower.length < 50 || /^(ok|okay|yes|sure|and|what|how|try)\b/i.test(lower);
  if (hasKnownSuburb && isVagueShort) return "discover";

  const followUpDiscoverKeywords = [
    "any others", "any more", "show more", "more properties", "more options",
    "what else", "other properties", "more results", "others like", "more like",
    "anything else", "show me more", "any other", "more sites", "other options",
    "keep looking", "find more", "another one", "few more",
  ];
  if (followUpDiscoverKeywords.some((k) => lower.includes(k))) return "discover";

  return "followup";
}

function buildGeminiHistory(conversationHistory: Message[]) {
  return conversationHistory.map((m) => ({
    role: m.role === "assistant" ? ("model" as const) : ("user" as const),
    parts: [{ text: m.content }],
  }));
}

export async function generateUnifiedResponse(
  messages: Message[],
  currentReport?: object,
  overrideMode?: ChatMode,
): Promise<{ content: string; mode: ChatMode }> {
  if (messages.length === 0) {
    return { content: "How can I help you with NZ property development today?", mode: "followup" };
  }

  const lastMessage = messages[messages.length - 1];
  const conversationHistory = messages.slice(0, -1);
  // Prefer the caller-supplied mode (from LLM intent extraction) over the internal regex detectMode
  const mode = overrideMode ?? detectMode(lastMessage.content);

  let systemWithContext = SYSTEM_PROMPT;
  if (currentReport) {
    const r = currentReport as Record<string, unknown>;
    const planning = r["planning"] as Record<string, unknown> | undefined;
    const overview = r["propertyOverview"] as Record<string, unknown> | undefined;
    const asbestosInfo = r["asbestos"] as Record<string, unknown> | undefined;
    const terrain = r["terrain"] as Record<string, unknown> | undefined;
    const scores = r["scores"] as Record<string, unknown> | undefined;

    const zoneLabel: string | null =
      (r["zone_label"] as string | null) ??
      (planning?.["zone"] as string | null) ??
      (overview?.["zone"] as string | null) ??
      null;
    const zoneCode: string | null = (r["zone_code"] as string | null) ?? null;
    const buildYear: string | null =
      (overview?.["buildYear"] as string | null) ??
      (asbestosInfo?.["buildYear"] as string | null) ??
      null;
    const landArea: string | null = (overview?.["landArea"] as string | null) ?? null;
    const address: string | null =
      (r["address"] as string | null) ??
      (overview?.["address"] as string | null) ??
      null;

    // Terrain — pin ALL measured values so the LLM cannot substitute general geographic
    // knowledge (e.g. "Remuera is hilly") for the actual LiDAR/pipeline measurement.
    const terrainClassification: string | null =
      (terrain?.["classification"] as string | null) ?? null;
    const terrainSlopeDeg: number | null =
      (terrain?.["slope_degrees"] as number | null) ?? null;
    const terrainSlope: string | null =
      (terrain?.["slope"] as string | null) ?? null;
    const terrainSource: string | null =
      (terrain?.["source"] as string | null) ?? null;

    const terrainLine = terrainClassification
      ? `Terrain / contour: ${terrainClassification}` +
        (terrainSlopeDeg != null ? ` (measured slope ${terrainSlopeDeg}°)` : "") +
        (terrainSlope ? ` — "${terrainSlope}"` : "") +
        (terrainSource ? ` [source: ${terrainSource}]` : "") +
        " — DO NOT describe this property as moderate, steep, hilly, or sloped; the measured data shows it is " + terrainClassification
      : null;

    // Scores — pin the computed scores so the LLM cannot re-derive different numbers
    const easeScore = scores?.["ease"] != null ? `Ease score: ${scores["ease"]}/5` : null;
    const costScore = scores?.["cost"] != null ? `Cost score: ${scores["cost"]}/5` : null;
    const roiScore = scores?.["roi"] != null ? `ROI score: ${scores["roi"]}/5` : null;

    const pinnedLines = [
      address ? `Address: ${address}` : null,
      zoneLabel ? `Zone: ${zoneLabel}${zoneCode ? ` (code: ${zoneCode})` : ""}` : null,
      buildYear ? `Build year: ${buildYear}` : null,
      landArea ? `Land area: ${landArea}` : null,
      terrainLine,
      easeScore,
      costScore,
      roiScore,
    ].filter(Boolean);

    const pinnedSection = pinnedLines.length > 0
      ? `CRITICAL — CONFIRMED PROPERTY FACTS (measured/verified data from LINZ, Auckland Council GIS, and LiDAR — you MUST NOT contradict, override, or substitute any of these with general knowledge or suburb assumptions):\n${pinnedLines.join("\n")}\n\n`
      : "";

    systemWithContext =
      `${SYSTEM_PROMPT}\n\n${pinnedSection}CURRENT PROPERTY CONTEXT (full report the user is discussing):\n${JSON.stringify(currentReport, null, 2)}`;
  }

  let userContent = lastMessage.content;
  if (mode === "analyse") {
    userContent = `${lastMessage.content}\n\n${ANALYSE_AUGMENTATION}`;
  } else if (mode === "discover") {
    userContent = `${lastMessage.content}\n\n${DISCOVER_AUGMENTATION}`;
  }

  const history = buildGeminiHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
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
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 8192,
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
): Promise<string> {
  const prompt = `Analyse this NZ property for development feasibility: ${address}\n\n${ANALYSE_AUGMENTATION}`;
  const history = buildGeminiHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: SYSTEM_PROMPT,
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
): Promise<string> {
  const prompt = `Search query: "${query}"
${suburb ? `Target suburb: ${suburb}` : ""}
${minPrice ? `Min price: NZD ${minPrice.toLocaleString()}` : ""}
${maxPrice ? `Max price: NZD ${maxPrice.toLocaleString()}` : ""}

${DISCOVER_AUGMENTATION}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: SYSTEM_PROMPT,
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
      model: "gemini-2.5-flash",
      config: { maxOutputTokens: 2048 },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    }).then((response) => {
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

export async function assessInterestRateOutlook(): Promise<InterestRateOutlook> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
): Promise<string> {
  const systemWithContext = reportContext
    ? `${SYSTEM_PROMPT}\n\nCURRENT PROPERTY CONTEXT:\n${reportContext}`
    : SYSTEM_PROMPT;

  const history = buildGeminiHistory(conversationHistory);

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      config: {
        systemInstruction: systemWithContext,
        maxOutputTokens: 8192,
      },
      contents: [
        ...history,
        { role: "user", parts: [{ text: message }] },
      ],
    });
    return response.text ?? "";
  } catch (error) {
    logger.error({ error }, "Failed to generate chat reply");
    throw error;
  }
}
