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

const INTENT_RULES = `CLASSIFICATION RULES:
- mode="analyse": user wants a development feasibility analysis of a specific property. Detect specific street addresses (e.g. "8 Hampton Drive, St Heliers", "123 Queen St").
- mode="discover": user wants to find/browse/search properties currently for sale. Detect phrases like "what's on the market", "show me properties", "find me something", "any listings", "for sale in X", "what's available", "currently for sale", "looking to buy", "any homes", "what about in X suburb" — even if no suburb is specified in the message.
- mode="followup": anything else — questions about the current analysis, general advice, clarifications, "what does X mean", "tell me more about", etc.

SUBURB RESOLUTION (for discover mode):
- If the user mentions a suburb explicitly → use it.
- If the user says "this area", "around here", "nearby", "this suburb", "currently" with no location specified → infer suburb from the CURRENT REPORT ADDRESS (if provided in context).
- If no suburb can be determined at all → leave suburb as null.

PRICE EXTRACTION:
- "under $2m" / "below 2 million" / "up to 2M" → maxPrice: 2000000
- "$1.5m to $2.5m" → minPrice: 1500000, maxPrice: 2500000
- "around $1.8m" → minPrice: 1600000, maxPrice: 2000000
- If no price mentioned → both null.

FOLLOW-UP DETECT: isFollowUp=true for: "show more", "any others", "what else", "more like that", "find more", "keep looking", "any other options", "more properties".
ANSWERING A CLARIFICATION: If the immediately preceding ASSISTANT message was a clarifying question (ends with "?") and the user's reply directly answers it (e.g. "St heliers", "around $1.5M"), set isFollowUp=true, needsClarification=false, and extract suburb/price/address from the answer combined with the original intent from history.

CLARIFICATION RULES (needsClarification):
- Set needsClarification=true ONLY when ALL of these apply:
  1. mode is "discover" AND suburb is null (cannot be inferred from context or history)
  2. OR mode is "analyse" AND address is null
  3. AND the previous message was NOT already a clarification question about the same thing
- For discover with missing suburb: clarificationQuestion should be short and conversational, e.g. "Any particular suburb in mind?" or "Which area are you looking at?"
- For discover with suburb but no price: do NOT ask for price — just search with defaults
- For analyse with missing address: ask "Which property would you like me to analyse?"
- Set needsClarification=false for mode="followup" (always)
- If the user's message is clearly casual browsing ("show me what's out there", "anything good?") and no context exists, ask for suburb

NORMALISE suburb names: "Saint Heliers" → "st heliers", "Mt Eden" → "mt eden", "Grey Lynn" → "grey lynn".`;

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

  // Build compact conversation history (last 6 turns to keep context manageable)
  const recentHistory = messages.slice(-6).filter((m) => m !== lastUserMessage);
  const historyText = recentHistory.length > 0
    ? recentHistory.map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 300)}`).join("\n")
    : "(no prior conversation)";

  const contextLines: string[] = [];
  if (reportContext?.address) contextLines.push(`Currently open property report: ${reportContext.address}`);
  if (reportContext?.suburb) contextLines.push(`Report suburb: ${reportContext.suburb}`);
  if (alreadyShownAddresses && alreadyShownAddresses.length > 0) {
    contextLines.push(`Properties already shown to user: ${alreadyShownAddresses.slice(0, 5).join("; ")}`);
  }
  const contextText = contextLines.length > 0 ? contextLines.join("\n") : "(no open report)";

  const prompt = `You are an intent parser for a NZ property development app called DevFeasible. Parse the user's latest message into structured intent JSON.

CONTEXT:
${contextText}

RECENT CONVERSATION:
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

    const pinnedLines = [
      address ? `Address: ${address}` : null,
      zoneLabel ? `Zone: ${zoneLabel}${zoneCode ? ` (code: ${zoneCode})` : ""}` : null,
      buildYear ? `Build year: ${buildYear}` : null,
      landArea ? `Land area: ${landArea}` : null,
    ].filter(Boolean);

    const pinnedSection = pinnedLines.length > 0
      ? `CRITICAL — CONFIRMED PROPERTY FACTS (these are verified data — you MUST NOT contradict or substitute any of these in your response):\n${pinnedLines.join("\n")}\n\n`
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
