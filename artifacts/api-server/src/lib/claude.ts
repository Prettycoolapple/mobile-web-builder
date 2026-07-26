import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "./logger";
import { SYSTEM_PROMPT, ANALYSE_AUGMENTATION, DISCOVER_AUGMENTATION, languageInstruction, type Locale } from "./prompts";
import { findLocationInTextViaIndex, findSuburbId, findSuburbInTextViaIndex } from "./scrapers/realestate-api";
import type { DevelopmentStrategyAssessment, DevelopmentStrategyId, RefurbishmentScope } from "./development-strategies";
import { hasNumberedStreetAddress, hasUnnumberedStreetLine } from "./street-address-detect";
import {
  isDevelopmentDiscoveryIntent,
  isStandardSubdivisionDiscoveryIntent,
  isSubdivisionRulesInformationIntent,
} from "./discovery-intent";
import { detectRecentSalesIntent, isRecentSalesContinuationText } from "./recent-sales";
import {
  detectNearbyAmenityIntent,
  extractNearbyAmenityTerms,
  normaliseNearbyAmenityTerms,
} from "./nearby-amenities";

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
export type ChatIntentCategory =
  | "property_discovery"
  | "recent_sales_lookup"
  | "nearby_amenity_lookup"
  | "single_property_analysis"
  | "rules_explanation"
  | "general_property_advice"
  | "followup";
export type ChatIntentSubject =
  | "subdivision"
  | "zoning"
  | "market"
  | "cost"
  | "schools"
  | "amenities"
  | "provider"
  | "unknown";
export type ChatIntentExecution =
  | "show_listing_cards"
  | "show_recent_sales_table"
  | "answer_nearby_amenities"
  | "run_feasibility_report"
  | "answer_in_chat"
  | "ask_clarifying_question";
export type DiscoveryPresentation = "generic_listing" | "scored_screening";

export function sanitizeAssistantProse(content: string, locale: Locale = "en"): string {
  let out = content;

  // Keep conversational replies out of code/JSON territory. The report JSON is
  // still returned untouched in analyse mode; this is only for plain chat text.
  out = out.replace(/```[\s\S]*?```/g, (block) => {
    const body = block.replace(/^```[a-zA-Z0-9_-]*\s*/, "").replace(/```\s*$/, "").trim();
    return body.startsWith("{") || body.startsWith("[") ? "" : body;
  });
  out = out.replace(/`([^`]+)`/g, "$1");
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  out = out.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "$1");
  out = out.replace(/__([^_\n]+)__/g, "$1");
  out = out.replace(/(^|[^\w])\*([^*\n]+)\*(?=[^\w]|$)/g, "$1$2");
  out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, "$1$2");
  out = out.replace(/\(\s*(?:isOnMarket|isListed|listingPrice|agentName|agentPhone|agencyName|found|source|listingUrl)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^)\s,，。;；]+)\s*\)/gi, "");
  out = out.replace(/\b(?:isOnMarket|isListed|listingPrice|agentName|agentPhone|agencyName|found|source|listingUrl)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^\s,，。;；)]+)/gi, "");
  out = out.replace(/\{\s*(?:isOnMarket|isListed|listingPrice|agentName|agentPhone|agencyName|found|source|listingUrl)[^{}]*\}/gi, "");
  out = out.replace(/\(\s*(?:cv_nzd|cv_year|land_area_sqm|floor_area_sqm|build_year|zone_code|listing_price_nzd|selectedListingContext)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^)\s,，。;；]+)(?:\s*[,;]\s*(?:cv_nzd|cv_year|land_area_sqm|floor_area_sqm|build_year|zone_code|listing_price_nzd|selectedListingContext)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^)\s,，。;；]+))*\s*\)/gi, "");
  out = out.replace(/\b(?:cv_nzd|cv_year|land_area_sqm|floor_area_sqm|build_year|zone_code|listing_price_nzd|selectedListingContext)\s*:\s*(?:true|false|null|undefined|"[^"]*"|'[^']*'|[^\s,，。;；)]+)/gi, "");
  out = out.replace(/\{\s*(?:cv_nzd|cv_year|land_area_sqm|floor_area_sqm|build_year|zone_code|listing_price_nzd|selectedListingContext)[^{}]*\}/gi, "");
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
  if (detectRecentSalesIntent(message)) return false;
  if (detectNearbyAmenityIntent(message)) return false;
  if (
    /有什么在卖|在售|房源|挂牌|看看.*卖|哪些.*卖|什么.*在售|想买|看房|市场上有|在售房源|有卖|出售.*吗|在售的|买房|找房/i.test(message)
  ) {
    return true;
  }
  const lower = message.toLowerCase();
  if (
    /what(?:'s| is| are)\s+(?:for\s+)?sale|what(?:'s| is| are)\s+(?:currently\s+)?listed|currently\s+listed|listed\s+in|on\s+the\s+market|anything\s+for\s+sale|any\s+listings?|properties\s+for\s+sale|homes\s+for\s+sale|houses\s+for\s+sale|land\s+for\s+sale|what(?:'s| is)\s+available/i.test(
      lower,
    )
  ) {
    return true;
  }
  if (/(?:looking|search|searching)\s+for\s+.+\s+in\s+/i.test(lower)) return true;
  // Explicit "show/see/find/get more properties/listings/homes/houses" — a generic
  // listing-browse continuation. Distinguishes "show more properties" (plain browse)
  // from "show more sites" (which stays development/subdivision-oriented).
  if (/\b(?:show|see|find|get|give|more|other|another|additional)\b[\s\S]{0,40}\b(?:propert(?:y|ies)|listings?|homes?|houses?|places?|apartments?|townhouses?|units?)\b/i.test(lower)) {
    return true;
  }
  if (/更多(?:的)?(?:房源|房子|房产|挂牌|公寓|单位|房屋)|(?:还有|再看|再来|给我).{0,6}(?:房源|房子|房产)/i.test(message)) {
    return true;
  }
  return false;
}

function hasExplicitAnalysisRequestText(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(analyse|analyze|analysis|feasibility|assess|evaluate|development\s+economics|run\s+(?:a\s+)?report|subdivid\w*|subdivision|split\s+into\s+\d|development\s+potential|developable)\b/i.test(lower) ||
    /(?:\u5206\u6790|\u53ef\u884c\u6027|\u8bc4\u4f30|\u8a55\u4f30|\u5f00\u53d1\u7ecf\u6d4e|\u958b\u767c\u7d93\u6fdf|\u8dd1\u4e00\u4e0b\u62a5\u544a|\u8dd1\u4e00\u4e0b\u5831\u544a|\u5206\u5272|\u7ec6\u5206|\u7d30\u5206|\u5f00\u53d1\u6f5c\u529b|\u958b\u767c\u6f5b\u529b)/u.test(message);
}

/**
 * A listing-browse phrase that is a CONTINUATION ("show me more property
 * options", "any other listings") rather than a fresh request. Continuations
 * inherit the prior search's presentation; a fresh browse resets to plain cards.
 * The continuation marker distinguishes "show me MORE properties" (continue) from
 * "show me properties in Ponsonby" (fresh).
 */
export function isListingBrowseContinuation(message: string): boolean {
  return (
    isListingBrowseIntent(message) &&
    (/\b(?:more|other|others|another|additional|else|again)\b/i.test(message) ||
      /还有|還有|再(?:看|来|來|给|給)|更多|其他|另外|多.{0,2}(?:看|来|來)/.test(message))
  );
}

// ─── LLM-powered intent extraction ───────────────────────────────────────────
// Instead of hardcoded keyword lists and regex, we ask DeepSeek chat to parse
// the user's intent from the full conversation context. This handles arbitrary
// phrasing, context references ("it", "this area", "currently"), and implicit
// suburb resolution from the currently open report.
export interface ChatIntent {
  intentCategory: ChatIntentCategory;
  subject: ChatIntentSubject;
  execution: ChatIntentExecution;
  confidence: number | null;
  mode: ChatMode;
  // Analyse
  address: string | null;
  // Discover
  suburb: string | null;           // normalised suburb name; inferred from context if needed
  additionalSuburbs: string[];     // further suburbs the user named, in spoken order AFTER `suburb` (e.g. "St Heliers or Kohimarama" → suburb="st heliers", additionalSuburbs=["kohimarama"]); [] when only one
  minPrice: number | null;
  maxPrice: number | null;
  criteria: string | null;         // free-text description of what they want (subdividable, lifestyle, etc.)
  requiresFreeholdTitle: boolean;  // true when the user wants a freehold / fee-simple title (triggers authoritative LINZ title screening)
  includeTenures: ("cross_lease" | "leasehold" | "unit_title")[]; // non-freehold tenures the user has EXPLICITLY opted in to seeing despite the subdivision catch (shown with a warning); [] by default
  discoveryPresentation: DiscoveryPresentation | null; // generic listings vs scored subdivision/development screening cards
  filterSpec: SearchFilterSpec | null; // structured measurable criteria (lots/slope/pipes/roi) for reverse-search; null unless the user named measurable criteria
  isFollowUp: boolean;             // true when asking for more results from a prior search
  includeNegotiation: boolean;     // true when user doesn't require a listed price (auction, tender, POA)
  // Clarification loop
  needsClarification: boolean;     // true when required info is missing and a question should be returned
  clarificationQuestion: string | null; // the natural-language question to ask the user
  // Nearby amenities
  nearbyAmenityTerms: string[];     // raw amenity terms requested, e.g. ["schools","hospitals"]
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
  "intentCategory": "property_discovery" | "recent_sales_lookup" | "nearby_amenity_lookup" | "single_property_analysis" | "rules_explanation" | "general_property_advice" | "followup",
  "subject": "subdivision" | "zoning" | "market" | "cost" | "schools" | "amenities" | "provider" | "unknown",
  "execution": "show_listing_cards" | "show_recent_sales_table" | "answer_nearby_amenities" | "run_feasibility_report" | "answer_in_chat" | "ask_clarifying_question",
  "confidence": <number from 0 to 1> | null,
  "mode": "analyse" | "discover" | "followup",
  "address": "<full NZ street address string> | null",
  "suburb": "<primary suburb name, lowercase, normalised> | null",
  "additionalSuburbs": ["<further suburb names the user named, lowercase, normalised, in spoken order after the primary one>"],
  "minPrice": <NZD number> | null,
  "maxPrice": <NZD number> | null,
  "criteria": "<free-text describing what the user wants> | null",
  "requiresFreeholdTitle": <true when the user wants a freehold / fee-simple title, false otherwise>,
  "includeTenures": ["<any of: cross_lease, leasehold, unit_title — non-freehold tenures the user EXPLICITLY opted in to seeing; [] unless clearly stated>"],
  "discoveryPresentation": "generic_listing" | "scored_screening" | null,
  "isFollowUp": <true if asking for more results from an earlier search OR answering a clarification question, false otherwise>,
  "includeNegotiation": <true if user does not require a price (accepts auction/tender/POA), false otherwise>,
  "needsClarification": <true ONLY when required info is missing AND you cannot infer it — see rules>,
  "clarificationQuestion": "<short conversational question to ask the user> | null",
  "nearbyAmenityTerms": ["<raw requested amenity terms, e.g. schools, hospitals, swimming pools; [] when not applicable>"],
  "wantsProviderRecommendation": <true when user asks to be connected with / referred to a professional service provider>,
  "wantsAnotherProvider": <true when user already has a provider shown and wants to swap/replace/change it for a different one>,
  "suggestedDiscipline": "architect_designer" | "planner" | "engineer" | "quantity_surveyor" | "other" | null,
  "wideScanSubdivisionIntent": <true when user is asking for an area-wide subdivision/development sweep — see WIDE SCAN below>,
  "filterSpec": { "minPotentialLots": <integer ≥2> | null, "maxSlopeDegrees": <number degrees> | null, "infrastructureOnParcel": ["storm"|"sewer"|"water"], "minRoiPct": <number> | null, "dwellingCondition": "older_do_up" | "avoid_recent_improvement" | "recent_improvement" | null, "searchScope": "analyzed_index" | "live_market" | "both" } | null,
  "reasoning": "<1 sentence explaining your classification>"
}`;

const INTENT_RULES = `## SEMANTIC INTENT AND EXECUTION

First classify the user's goal semantically, then choose the execution.

intentCategory:
  property_discovery      = user wants to find/show/browse/list currently available properties or listings.
  recent_sales_lookup     = user wants recently sold / settled sales / sale-price records or comparable sold evidence in an area, usually with filters like bedrooms, bathrooms, land area, floor area, title, or a time window.
  nearby_amenity_lookup   = user wants schools, hospitals, clinics, swimming pools, recreation centres, parks, supermarkets, pharmacies, or other local amenities near an address/current property.
  single_property_analysis = user wants a feasibility report for one specific numbered property.
  rules_explanation       = user asks about rules, requirements, process, policy, zoning, consent, or how something works.
  general_property_advice = user wants conversational property advice without listing cards or a single report.
  followup                = user is continuing discussion about the current answer/report/results.

subject:
  Choose the primary topic: subdivision, zoning, market, cost, schools, provider, or unknown.

execution:
  show_listing_cards      = run property discovery and return listing cards. Use ONLY when the user's goal is to find/show/browse/list available properties.
  show_recent_sales_table = fetch recent sold records and answer with a concise table in chat. Use when the user asks for sold prices, settled sales,成交价,成交记录,已售/售出 records, recently sold properties, or comparable sales evidence. Never use listing cards for this.
  answer_nearby_amenities = fetch nearby amenity information and answer with a concise chat table. Use when the user asks what schools/hospitals/clinics/pools/recreation centres/etc. are near a property or address, without asking for a feasibility report.
  run_feasibility_report  = run one-property analysis. Use ONLY for a specific numbered property.
  answer_in_chat          = answer conversationally. Use for rules_explanation and general_property_advice.
  ask_clarifying_question = ask one short question because required information is missing for discovery or analysis.

discoveryPresentation:
  generic_listing         = ordinary currently-for-sale / available / on-market browsing. Use for plain market availability searches, even if the user says "currently available", "on the market", "listings", "homes for sale", or simply wants to browse a suburb.
  scored_screening        = subdivision/development/redevelopment/yield/multi-lot opportunity screening. Use only when the user semantically asks for subdivision, development, redevelopment, yield, splitting, multiple lots, or similar opportunity analysis.
  null                    = not a property_discovery request.

## STRUCTURED CRITERIA (filterSpec)
When a property_discovery request names MEASURABLE criteria, ALSO populate filterSpec (keep discoveryPresentation="scored_screening" for these); otherwise filterSpec=null.
  - "split into N lots" / "可分割成N套/N块" / "subdivide into N" → minPotentialLots = N (integer ≥ 2).
  - "flat" / "基本平地/平地" → maxSlopeDegrees = 3;  "gentle/slight slope" / "坡小/缓坡" → maxSlopeDegrees = 8.
  - services/pipes on the land/parcel: "管道都在地上" / "上下水在红线内" / "services on the parcel" → infrastructureOnParcel = ["storm","sewer"] (add "water" if water supply is named).
  - "return/yield over X%" / "回报超过X%" → minRoiPct = X.
  - searchScope: default "both"; "already analysed / 在你数据库里" → "analyzed_index"; "on the market now / 在售" → "live_market".
For dwelling-condition criteria, set filterSpec.dwellingCondition to "older_do_up" for old/original/do-up homes, "avoid_recent_improvement" when the user wants to avoid renovated/new-build premium, and "recent_improvement" when the user asks for recently renovated/modernised homes.
Set filterSpec=null when the user names no measurable criteria.

Critical distinction:
  "recently sold", "sold price", "sales records", "settled sales", "成交价", "成交记录", "已售", "售出" => recent_sales_lookup, subject=market, execution=show_recent_sales_table, mode=followup. This is NOT property_discovery and must NOT show listing cards, even if the user says "find/show/search".
  If the user corrects you with "not listings / not for sale, I mean sold prices /成交价", preserve the prior area and filters from history and classify as recent_sales_lookup.
  "near/nearby/around/周边/附近 + schools/hospitals/clinics/pools/recreation centres/etc." => nearby_amenity_lookup, subject=amenities (or schools when only schools), execution=answer_nearby_amenities, mode=followup. This is NOT property_discovery and must NOT show listing cards. It is also NOT a feasibility report merely because the user included a numbered address.
  If the same message explicitly asks to analyse/run feasibility/development economics for the property AND also asks an amenity question, choose single_property_analysis + run_feasibility_report, but still populate nearbyAmenityTerms so the app can answer the amenity question after the report.
  The word "subdivision" alone does NOT mean show_listing_cards.
  "what is currently available in Saint Heliers?" => property_discovery, subject=market, execution=show_listing_cards, mode=discover, discoveryPresentation=generic_listing.
  "what's currently on the market in Highland Park?" => property_discovery, subject=market, execution=show_listing_cards, mode=discover, discoveryPresentation=generic_listing.
  "what are the subdivision rules in Coatesville?" => rules_explanation, subject=subdivision, execution=answer_in_chat, mode=followup.
  "how does subdivision consent work in Auckland?" => rules_explanation, subject=subdivision, execution=answer_in_chat, mode=followup.
  "show me subdividable properties in Coatesville" => property_discovery, subject=subdivision, execution=show_listing_cards, mode=discover, discoveryPresentation=scored_screening.
  "which listings in Coatesville can be subdivided?" => property_discovery, subject=subdivision, execution=show_listing_cards, mode=discover, discoveryPresentation=scored_screening.
  "can 12 Smith Road be subdivided?" => single_property_analysis, subject=subdivision, execution=run_feasibility_report, mode=analyse.
  If the previous conversation discussed subdivision but the latest user message is a fresh plain availability search in another suburb, reset to discoveryPresentation=generic_listing.

The legacy mode field must agree with execution:
  show_listing_cards -> mode="discover"
  show_recent_sales_table -> mode="followup"
  answer_nearby_amenities -> mode="followup"
  run_feasibility_report -> mode="analyse"
  answer_in_chat -> mode="followup"
  ask_clarifying_question -> mode stays as the intended next action ("discover" or "analyse")

## MODE CLASSIFICATION

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

  NOT discover — use mode="followup" for informational questions about rules,
  policy, requirements, or process, even when a suburb/area is named.
  Examples: "what are the subdivision rules in Coatesville?", "how does subdivision
  consent work in Auckland?", "explain minimum lot size rules". These are
  conversation/advice questions, not listing searches, unless the user also asks
  to find/show/search/list currently available properties.

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

MULTIPLE SUBURBS (important):
- When the user names two or more suburbs in one request — joined by "or", "and", commas,
  "/", or any phrasing ("St Heliers or Kohimarama", "Mission Bay, Kohi and St Heliers",
  "St Heliers 或 Kohimarama", "either Remuera or Meadowbank") — put the FIRST-named suburb in
  "suburb" and ALL the others, in the order the user said them, in "additionalSuburbs".
- Each entry must be lowercase and normalised the same way as "suburb".
- Do NOT invent suburbs. Only list suburbs the user actually named.
- When only one suburb is named (or none), "additionalSuburbs" is an empty array [].
- The app searches the primary suburb to exhaustion first, then automatically moves through
  additionalSuburbs in order — so the order you return them in matters.

## FREEHOLD / TITLE INTENT (requiresFreeholdTitle)

Set requiresFreeholdTitle=true when the user asks for a particular land title / tenure that
implies freehold ownership, in ANY language or phrasing. Triggers include:
- "freehold", "fee simple", "freehold title", "full freehold", "standalone freehold"
- "freehold only", "must be freehold", "with a freehold title", "not cross-lease / not leasehold"
- Chinese: "永久产权", "永久產權", "freehold 产权", "独立产权", "獨立業權", "非交叉租约"
Set requiresFreeholdTitle=false when title/tenure is not mentioned, OR when the user explicitly
wants a non-freehold tenure (e.g. asks specifically for cross-lease or leasehold).
Note: this is independent of subdivision — a plain "freehold homes under $1.5M in Kohi" sets it true.

## NON-FREEHOLD OPT-IN (includeTenures)

Subdivision/freehold searches drop properties with a non-freehold title. The user can OPT IN to
seeing those anyway (they are shown with a warning). Only populate includeTenures when the user
CLEARLY signals they want a specific non-freehold tenure included — never by default.
- "include cross-lease", "show me the cross-lease ones too", "cross lease is fine", "even if
  it's cross lease", "I don't mind cross-lease" → add "cross_lease".
- "include leasehold", "leasehold is ok", "show leasehold too" → add "leasehold".
- "include unit title", "unit title is fine", "show the unit-title ones" → add "unit_title".
- "include all titles", "any title", "show all of them", "don't filter by title" → add all three:
  ["cross_lease","leasehold","unit_title"].
- Chinese: "交叉地契"/"十字地契"→cross_lease, "租赁产权"/"租地"/"租约地"→leasehold,
  "单位产权"/"分契产权"/"地契公寓"→unit_title; "所有地契都可以"/"不限地契"→all three.
- HISTORY-AWARE AFFIRMATION: when the PREVIOUS assistant turn offered to include excluded
  non-freehold tenures (e.g. "I left out some cross-lease and leasehold properties… say the word
  and I'll include them") and the user replies with a bare affirmative ("yes", "yes please",
  "go ahead", "include them", "好的"/"可以"/"都加进来"), set includeTenures to the tenures that
  were offered in that prior turn. Check the full history to see which tenures were offered.
- includeTenures is [] unless one of the above clearly applies. requiresFreeholdTitle and
  includeTenures are independent (a user can want freehold yet also say "but show cross-lease too").

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
- Treat numbered NZ property addresses as valid even when the street line has an
  uncommon ending or no ordinary suffix (e.g. Broadway, The Anchorage, a named
  highway, private road, or rural lane). Downstream geocoding will validate it.
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

const VALID_INTENT_CATEGORIES: ChatIntentCategory[] = [
  "property_discovery",
  "recent_sales_lookup",
  "nearby_amenity_lookup",
  "single_property_analysis",
  "rules_explanation",
  "general_property_advice",
  "followup",
];
const VALID_INTENT_SUBJECTS: ChatIntentSubject[] = [
  "subdivision",
  "zoning",
  "market",
  "cost",
  "schools",
  "amenities",
  "provider",
  "unknown",
];
const VALID_INTENT_EXECUTIONS: ChatIntentExecution[] = [
  "show_listing_cards",
  "show_recent_sales_table",
  "answer_nearby_amenities",
  "run_feasibility_report",
  "answer_in_chat",
  "ask_clarifying_question",
];

function legacyModeFromExecution(execution: ChatIntentExecution, fallback: ChatMode): ChatMode {
  if (execution === "show_listing_cards") return "discover";
  if (execution === "show_recent_sales_table") return "followup";
  if (execution === "answer_nearby_amenities") return "followup";
  if (execution === "run_feasibility_report") return "analyse";
  if (execution === "answer_in_chat") return "followup";
  return fallback;
}

function executionFromLegacyMode(mode: ChatMode, needsClarification = false): ChatIntentExecution {
  if (needsClarification) return "ask_clarifying_question";
  if (mode === "discover") return "show_listing_cards";
  if (mode === "analyse") return "run_feasibility_report";
  return "answer_in_chat";
}

function intentCategoryFromLegacyMode(mode: ChatMode): ChatIntentCategory {
  if (mode === "discover") return "property_discovery";
  if (mode === "analyse") return "single_property_analysis";
  return "followup";
}

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
  if (isSubdivisionRulesInformationIntent(last.content)) return false;
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

/**
 * Normalise the LLM's extra-suburb list: lowercase/trim each, drop blanks, drop
 * the primary suburb, and dedupe — preserving the spoken order so the discovery
 * train serves them in the sequence the user named (see analyse.ts seeding).
 */
export function normaliseAdditionalSuburbs(
  raw: unknown,
  primarySuburb: string | null | undefined,
): string[] {
  if (!Array.isArray(raw)) return [];
  const primary = (primarySuburb ?? "").toLowerCase().trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const s = entry.toLowerCase().trim();
    if (!s || s === primary || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Structured, measurable criteria extracted from a "reverse engineering"
 * discovery query ("flat land whose pipes are on the parcel that splits into 4
 * lots"). Populated on the intent only when the user names such criteria; the
 * criteria-search retrieval path (lib/criteria-search.ts) turns it into a query
 * over the analysed-property feature index + live screening. `null` on the
 * intent means an ordinary browse/screen with no measurable constraints.
 */
export interface SearchFilterSpec {
  minPotentialLots: number | null;        // "split into 4" → 4 (integer ≥ 2)
  maxSlopeDegrees: number | null;         // flat ≈ ≤3°, gentle ≈ ≤8°
  infrastructureOnParcel: ("storm" | "sewer" | "water")[]; // services required ON the parcel
  minRoiPct: number | null;               // "return over 7%" → 7
  dwellingCondition: "older_do_up" | "avoid_recent_improvement" | "recent_improvement" | null;
  searchScope: "analyzed_index" | "live_market" | "both";
}

function normaliseDwellingCondition(value: unknown): SearchFilterSpec["dwellingCondition"] {
  return value === "older_do_up" || value === "avoid_recent_improvement" || value === "recent_improvement"
    ? value
    : null;
}

function clampLotCount(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  if (v < 2) return null; // 1 lot is not a "split" — treat as no constraint
  return Math.min(v, 50);
}

function clampPositive(n: unknown, max: number): number | null {
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(n, max);
}

/**
 * Validate/clamp the LLM's filterSpec. Returns null when no measurable
 * constraint survives — so a populated filterSpec always signals a real criteria
 * search (the routing trigger), never an empty object.
 */
export function normaliseFilterSpec(raw: unknown): SearchFilterSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const minPotentialLots = clampLotCount(r.minPotentialLots);
  const maxSlopeDegrees = clampPositive(r.maxSlopeDegrees, 90);
  const minRoiPct = clampPositive(r.minRoiPct, 1000);
  const dwellingCondition = normaliseDwellingCondition(r.dwellingCondition);
  const infrastructureOnParcel = Array.isArray(r.infrastructureOnParcel)
    ? [
        ...new Set(
          r.infrastructureOnParcel.filter(
            (s): s is "storm" | "sewer" | "water" => s === "storm" || s === "sewer" || s === "water",
          ),
        ),
      ]
    : [];
  const scope = r.searchScope;
  const searchScope =
    scope === "analyzed_index" || scope === "live_market" || scope === "both" ? scope : "both";

  const hasConstraint =
    minPotentialLots != null ||
    maxSlopeDegrees != null ||
    minRoiPct != null ||
    infrastructureOnParcel.length > 0 ||
    dwellingCondition != null;
  if (!hasConstraint) return null;
  return { minPotentialLots, maxSlopeDegrees, infrastructureOnParcel, minRoiPct, dwellingCondition, searchScope };
}

/**
 * Regex fallback for the measurable criteria — used only when the LLM intent
 * call fails (fallbackDetectIntent). Handles English + Chinese lot-count, slope,
 * on-parcel services, and return %. Returns null when nothing is found.
 */
export function detectFilterSpecFromText(text: string): SearchFilterSpec | null {
  const t = text.toLowerCase();

  // Lot count: "split into 4", "4 lots", "可分割成4套/4块/4个", "细分成4".
  // The bare "N套/N栋" form is only trusted alongside an explicit development/
  // subdivision word — otherwise "看3套房" (browse 3 homes) would be hijacked
  // into a criteria search.
  let minPotentialLots: number | null = null;
  const hasDevContext = /开发|開發|分割|细分|細分|develop|subdiv|split/i.test(text);
  const lotMatch =
    t.match(/split\s+into\s+(\d+)/) ||
    t.match(/subdivid\w*\s+into\s+(\d+)/) ||
    t.match(/(\d+)\s*(?:standalone\s+)?lots?\b/) ||
    text.match(/(?:分割|细分|細分|分成)\s*(?:成)?\s*(\d+)\s*(?:套|块|塊|个|個|間|间|栋|棟)?/) ||
    (hasDevContext ? text.match(/(\d+)\s*(?:套|块|塊|栋|棟)/) : null);
  if (lotMatch) minPotentialLots = clampLotCount(Number(lotMatch[1]));

  // Slope: flat ≈ ≤3°, gentle ≈ ≤8°
  let maxSlopeDegrees: number | null = null;
  if (/基本平地|平地|平坦|\bflat\b/i.test(text)) maxSlopeDegrees = 3;
  if (/坡小|缓坡|緩坡|gentle\s+slop|slight\s+slop|mild\s+slop/i.test(text)) {
    maxSlopeDegrees = Math.max(maxSlopeDegrees ?? 0, 8);
  }

  // Services/pipes on the parcel.
  const mentionsPipes =
    /管道|上下水|下水|污水|雨水|管线|管線/.test(text) || /storm\s*water|stormwater|sewer|wastewater|\bpipes?\b|\bservices?\b|utilit/.test(t);
  const onParcel =
    /在地上|在红线内|在紅線內|红线内|紅線內|地里|地裡/.test(text) ||
    /on[-\s]?(?:the\s+)?(?:parcel|site|land|section|property)|within\s+(?:the\s+)?(?:boundary|parcel|site)|on\s+site/.test(t);
  const infrastructureOnParcel: ("storm" | "sewer" | "water")[] = [];
  if (mentionsPipes && onParcel) {
    infrastructureOnParcel.push("storm", "sewer"); // the two the queries care about
    if (/water\s+(?:supply|main|pipe)|供水|给水|給水/.test(text)) infrastructureOnParcel.push("water");
  }

  // Return / yield %.
  let minRoiPct: number | null = null;
  const roiMatch =
    text.match(/(?:return|yield|roi|回报率?|回報率?|收益率?)\D{0,6}(\d+(?:\.\d+)?)\s*%/i) ||
    text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:return|yield|roi|回报|回報|收益)/i) ||
    text.match(/(?:over|above|超过|超過|大于|大於|高于|高於|>)\s*(\d+(?:\.\d+)?)\s*%/i);
  if (roiMatch) minRoiPct = clampPositive(Number(roiMatch[1]), 1000);

  let dwellingCondition: SearchFilterSpec["dwellingCondition"] = null;
  if (/\b(?:older\s+do[-\s]?up|do[-\s]?up|unrenovated|unmodernised|unmodernized|original\s+(?:home|house|dwelling|condition)|dated|tired)\b/i.test(text)) {
    dwellingCondition = "older_do_up";
  }
  if (/\b(?:avoid|exclude|without|no|not)\s+(?:recent\s+)?(?:renovat\w*|moderni[sz]\w*|new[-\s]?build|near[-\s]?new|improvement\w*)\b|\b(?:avoid|exclude|no)\s+renovation\s+premium\b/i.test(text)) {
    dwellingCondition = "avoid_recent_improvement";
  }
  if (/\b(?:recently|newly|fully|completely)\s+renovat\w*|\brenovated\s+throughout\b|\bmoderni[sz]ed\b|\b(?:new|consented|architectural)\s+(?:extension|addition)\b|\b(?:extended|added)\s+(?:living|bedroom|space|level|storey|story)\b/i.test(text)) {
    dwellingCondition = "recent_improvement";
  }

  const hasConstraint =
    minPotentialLots != null ||
    maxSlopeDegrees != null ||
    minRoiPct != null ||
    infrastructureOnParcel.length > 0 ||
    dwellingCondition != null;
  if (!hasConstraint) return null;
  return {
    minPotentialLots,
    maxSlopeDegrees,
    infrastructureOnParcel: [...new Set(infrastructureOnParcel)],
    minRoiPct,
    dwellingCondition,
    searchScope: "both",
  };
}

/**
 * Normalise the LLM's includeTenures array to the canonical tenure keys,
 * mapping common synonyms/typos (and "stratum" → unit_title) and dropping
 * anything unrecognised. Order-independent; deduped.
 */
export function normaliseIncludeTenures(raw: unknown): ("cross_lease" | "leasehold" | "unit_title")[] {
  if (!Array.isArray(raw)) return [];
  const out = new Set<"cross_lease" | "leasehold" | "unit_title">();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const s = entry.toLowerCase().trim();
    if (/cross[-\s_]*lease|crosslease/.test(s)) out.add("cross_lease");
    else if (/unit[-\s_]*title|stratum/.test(s)) out.add("unit_title");
    else if (/lease[-\s_]*hold|leasehold/.test(s)) out.add("leasehold");
  }
  return [...out];
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
      intentCategory: "followup",
      subject: "unknown",
      execution: "answer_in_chat",
      confidence: null,
      mode: "followup", address: null, suburb: null, additionalSuburbs: [], minPrice: null, maxPrice: null,
      criteria: null, requiresFreeholdTitle: false, includeTenures: [], discoveryPresentation: null, isFollowUp: false, includeNegotiation: false,
      needsClarification: false, clarificationQuestion: null,
      nearbyAmenityTerms: [],
      wantsProviderRecommendation: false, suggestedDiscipline: null,
      wantsAnotherProvider: false,
      wideScanSubdivisionIntent: false,
      filterSpec: null,
      reasoning: "empty messages",
    };
  }

  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUserMessage) {
    return {
      intentCategory: "followup",
      subject: "unknown",
      execution: "answer_in_chat",
      confidence: null,
      mode: "followup", address: null, suburb: null, additionalSuburbs: [], minPrice: null, maxPrice: null,
      criteria: null, requiresFreeholdTitle: false, includeTenures: [], discoveryPresentation: null, isFollowUp: false, includeNegotiation: false,
      needsClarification: false, clarificationQuestion: null,
      nearbyAmenityTerms: [],
      wantsProviderRecommendation: false, suggestedDiscipline: null,
      wantsAnotherProvider: false,
      wideScanSubdivisionIntent: false,
      filterSpec: null,
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

    const parsedMode = (["analyse", "discover", "followup"] as ChatMode[]).includes(parsed.mode) ? parsed.mode : "followup";
    const parsedExecution = VALID_INTENT_EXECUTIONS.includes(parsed.execution)
      ? parsed.execution
      : executionFromLegacyMode(parsedMode, Boolean(parsed.needsClarification));
    const parsedIntentCategory = VALID_INTENT_CATEGORIES.includes(parsed.intentCategory)
      ? parsed.intentCategory
      : intentCategoryFromLegacyMode(legacyModeFromExecution(parsedExecution, parsedMode));
    const parsedSubject = VALID_INTENT_SUBJECTS.includes(parsed.subject) ? parsed.subject : "unknown";
    const parsedConfidence = typeof parsed.confidence === "number" && parsed.confidence >= 0 && parsed.confidence <= 1
      ? parsed.confidence
      : null;
    const parsedDiscoveryPresentation: DiscoveryPresentation | null =
      parsed.discoveryPresentation === "generic_listing" || parsed.discoveryPresentation === "scored_screening"
        ? parsed.discoveryPresentation
        : null;

    // Sanitise fields
    let intent: ChatIntent = {
      intentCategory: parsedIntentCategory,
      subject: parsedSubject,
      execution: parsedExecution,
      confidence: parsedConfidence,
      mode: legacyModeFromExecution(parsedExecution, parsedMode),
      address: parsed.address ?? null,
      suburb: parsed.suburb ? parsed.suburb.toLowerCase().trim() : null,
      additionalSuburbs: normaliseAdditionalSuburbs(parsed.additionalSuburbs, parsed.suburb),
      includeTenures: normaliseIncludeTenures(parsed.includeTenures),
      minPrice: typeof parsed.minPrice === "number" && parsed.minPrice > 0 ? parsed.minPrice : null,
      maxPrice: typeof parsed.maxPrice === "number" && parsed.maxPrice > 0 ? parsed.maxPrice : null,
      criteria: parsed.criteria ?? null,
      requiresFreeholdTitle: Boolean(parsed.requiresFreeholdTitle),
      discoveryPresentation: parsedDiscoveryPresentation,
      filterSpec: normaliseFilterSpec(parsed.filterSpec),
      isFollowUp: Boolean(parsed.isFollowUp),
      includeNegotiation: Boolean(parsed.includeNegotiation),
      needsClarification: Boolean(parsed.needsClarification),
      clarificationQuestion: parsed.clarificationQuestion ?? null,
      nearbyAmenityTerms: normaliseNearbyAmenityTerms(parsed.nearbyAmenityTerms),
      wantsProviderRecommendation: Boolean(parsed.wantsProviderRecommendation),
      wantsAnotherProvider: Boolean(parsed.wantsAnotherProvider),
      suggestedDiscipline: parsed.suggestedDiscipline && VALID_DISCIPLINES.includes(parsed.suggestedDiscipline as string) ? parsed.suggestedDiscipline : null,
      wideScanSubdivisionIntent: Boolean(parsed.wideScanSubdivisionIntent),
      reasoning: parsed.reasoning ?? "",
    };

    if (isSubdivisionRulesInformationIntent(lastUserMessage.content)) {
      intent = {
        ...intent,
        intentCategory: "rules_explanation",
        subject: "subdivision",
        execution: "answer_in_chat",
        confidence: intent.confidence ?? 1,
        mode: "followup",
        address: null,
        discoveryPresentation: null,
        filterSpec: null,
        isFollowUp: false,
        includeNegotiation: false,
        needsClarification: false,
        clarificationQuestion: null,
        wideScanSubdivisionIntent: false,
        reasoning: intent.reasoning || "informational subdivision rules question",
      };
    }

    const recentSalesContext = messages
      .filter((m) => m.role === "user")
      .slice(-4)
      .map((m) => m.content)
      .join("\n");
    if (
      detectRecentSalesIntent(lastUserMessage.content) ||
      (detectRecentSalesIntent(recentSalesContext) && isRecentSalesContinuationText(lastUserMessage.content))
    ) {
      intent = {
        ...intent,
        intentCategory: "recent_sales_lookup",
        subject: "market",
        execution: "show_recent_sales_table",
        confidence: intent.confidence ?? 1,
        mode: "followup",
        address: null,
        discoveryPresentation: null,
        filterSpec: null,
        requiresFreeholdTitle: false,
        needsClarification: false,
        clarificationQuestion: null,
        nearbyAmenityTerms: [],
        wideScanSubdivisionIntent: false,
        reasoning: intent.reasoning || "recent sold-record lookup",
      };
    }

    if (detectNearbyAmenityIntent(lastUserMessage.content)) {
      const nearbyAmenityTerms = extractNearbyAmenityTerms(lastUserMessage.content);
      if (hasExplicitAnalysisRequestText(lastUserMessage.content)) {
        intent = {
          ...intent,
          nearbyAmenityTerms,
          reasoning: intent.reasoning || "feasibility request with attached nearby amenity question",
        };
      } else {
        intent = {
          ...intent,
          intentCategory: "nearby_amenity_lookup",
          subject: nearbyAmenityTerms.length === 1 && nearbyAmenityTerms[0] === "schools" ? "schools" : "amenities",
          execution: "answer_nearby_amenities",
          confidence: intent.confidence ?? 1,
          mode: "followup",
          discoveryPresentation: null,
          filterSpec: null,
          requiresFreeholdTitle: false,
          includeTenures: [],
          needsClarification: false,
          clarificationQuestion: null,
          nearbyAmenityTerms,
          wideScanSubdivisionIntent: false,
          reasoning: intent.reasoning || "nearby amenity lookup",
        };
      }
    }

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
        intentCategory: "property_discovery",
        execution: !suburb ? "ask_clarifying_question" : "show_listing_cards",
        mode: "discover",
        address: null,
        suburb,
        discoveryPresentation: "generic_listing",
        needsClarification: !suburb,
        clarificationQuestion: !suburb
          ? (locale === "zh" ? "您想搜索哪个区域或郊区？" : "Which suburb or area should I search?")
          : null,
      };
    }

    // Safety: if needsClarification=true but no question was generated, supply a fallback
    if (intent.needsClarification && !intent.clarificationQuestion) {
      intent.execution = "ask_clarifying_question";
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
    if (
      intent.mode === "followup" &&
      intent.execution !== "show_recent_sales_table" &&
      intent.execution !== "answer_nearby_amenities"
    ) {
      intent.needsClarification = false;
      intent.clarificationQuestion = null;
      intent.execution = "answer_in_chat";
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
  const directHit = await findLocationInTextViaIndex(lastMessage);
  const directLocationName = directHit?.status === "suburb"
    ? directHit.suburb.title.toLowerCase()
    : directHit?.status === "district"
      ? directHit.district.title.toLowerCase()
      : directHit?.status === "region"
        ? directHit.region.title.toLowerCase()
        : null;
  // If the message is short and is a known suburb, city, or region, treat it as discover.
  const trimmed = lastMessage.trim();
  const isSuburbOnly = directLocationName !== null
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
      const hit = await findLocationInTextViaIndex(m.content);
      if (hit?.status === "suburb") priorSuburb = hit.suburb.title.toLowerCase();
      else if (hit?.status === "district") priorSuburb = hit.district.title.toLowerCase();
      else if (hit?.status === "region") priorSuburb = hit.region.title.toLowerCase();
    }
  }

  const suburb = directLocationName
    ?? priorSuburb
    ?? (mode === "discover" && reportContext?.suburb ? reportContext.suburb.toLowerCase().trim() : null);

  const isFollowUp = /any\s*(others?|more)|show\s*(me\s*)?more|more\s*(properties|options|results|sites)|what\s*else|other\s*properties|more\s*results|few\s*more|find\s*more/i.test(lastMessage);

  const needsClarification = mode === "discover" && !suburb;
  const execution = executionFromLegacyMode(mode, needsClarification);
  const intentCategory = isSubdivisionRulesInformationIntent(lastMessage)
    ? "rules_explanation"
    : intentCategoryFromLegacyMode(mode);
  const subject: ChatIntentSubject = /subdivi|sub[-\s]?divide|分割|分地|细分|細分/i.test(lastMessage)
    ? "subdivision"
    : "unknown";

  const discoveryPresentation: DiscoveryPresentation | null =
    mode === "discover"
      ? (isDevelopmentDiscoveryIntent(lastMessage) || isStandardSubdivisionDiscoveryIntent(lastMessage) ? "scored_screening" : "generic_listing")
      : null;

  const lowerFallback = lastMessage.toLowerCase();
  const nearbyAmenityLookup = detectNearbyAmenityIntent(lastMessage) && !hasExplicitAnalysisRequestText(lastMessage);
  const nearbyAmenityTerms = nearbyAmenityLookup ? extractNearbyAmenityTerms(lastMessage) : [];
  const fallbackRecentSalesContext = [
    ...(history ?? []).filter((m) => m.role === "user").slice(-4).map((m) => m.content),
    lastMessage,
  ].join("\n");
  const recentSalesLookup =
    detectRecentSalesIntent(lastMessage) ||
    (detectRecentSalesIntent(fallbackRecentSalesContext) && isRecentSalesContinuationText(lastMessage));
  const providerKeywordsFallback = [
    "recommend", "referral", "architect", "builder", "planner", "engineer",
    "quantity surveyor", "specialist", "professional", "who can help",
    "设计师", "建筑师", "工程师", "推荐", "介绍",
  ];
  const wantsProviderRecommendation = providerKeywordsFallback.some((kw) => lowerFallback.includes(kw));

  return {
    intentCategory: recentSalesLookup ? "recent_sales_lookup" : nearbyAmenityLookup ? "nearby_amenity_lookup" : intentCategory,
    subject: recentSalesLookup ? "market" : nearbyAmenityLookup ? (nearbyAmenityTerms.length === 1 && nearbyAmenityTerms[0] === "schools" ? "schools" : "amenities") : subject,
    execution: recentSalesLookup ? "show_recent_sales_table" : nearbyAmenityLookup ? "answer_nearby_amenities" : execution,
    confidence: null,
    mode: recentSalesLookup || nearbyAmenityLookup ? "followup" : mode,
    address: null,
    suburb,
    // The regex fallback only fires when the LLM call fails; multi-suburb
    // parsing is left to the LLM path, so default to none here.
    additionalSuburbs: [],
    minPrice: null,
    maxPrice: null,
    criteria: lastMessage,
    requiresFreeholdTitle: /\b(freehold|fee\s*simple)\b/i.test(lowerFallback) || /永久产权|永久產權|独立产权|獨立業權/.test(lastMessage),
    // Opt-in is a deliberate, often conversational signal — leave it to the LLM
    // path. The regex fallback never opts the user in to non-freehold tenures.
    includeTenures: [],
    discoveryPresentation: recentSalesLookup || nearbyAmenityLookup ? null : discoveryPresentation,
    filterSpec: !recentSalesLookup && !nearbyAmenityLookup && mode === "discover" ? detectFilterSpecFromText(lastMessage) : null,
    isFollowUp,
    includeNegotiation: /negotiat|poa|by\s+applic|tender|auction/i.test(lowerFallback),
    needsClarification: recentSalesLookup || nearbyAmenityLookup ? false : needsClarification,
    clarificationQuestion: !recentSalesLookup && !nearbyAmenityLookup && needsClarification
      ? (locale === "zh" ? "您有特别想看的郊区吗?" : "Any particular suburb in mind?")
      : null,
    nearbyAmenityTerms,
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
  if (detectRecentSalesIntent(lastMessage)) return "followup";
  if (detectNearbyAmenityIntent(lastMessage) && !hasExplicitAnalysisRequestText(lastMessage)) return "followup";
  if (isSubdivisionRulesInformationIntent(lastMessage)) return "followup";
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

/**
 * Report fields that are useless to the LLM but expensive in tokens — base64
 * map overlays, photo URL lists, cached device URIs. A single report carrying
 * these can push the follow-up prompt past the provider's context window,
 * which fails the whole chat turn ("couldn't reach the service") rather than
 * degrading.
 */
const CHAT_CONTEXT_DROP_KEYS = new Set([
  "overlay_map_image_base64",
  "photoUrl",
  "photoUrls",
  "cachedPhotoUris",
  "cachedPhotoSignature",
  "overlay_map_image",
  "geometry",
  "parcelGeometry",
  "sitePlan",
]);

/** Character budget for the raw report JSON pinned into the chat system prompt. */
const CHAT_REPORT_JSON_BUDGET = 60_000;

/**
 * The mobile client aborts a follow-up chat at 200s (analyse-mode chats get
 * longer). Cap the reasoning model below the client's budget so there is still
 * time for the fast-model fallback, and keep the worst case (primary +
 * fallback) inside the 300s platform function limit.
 */
function unifiedResponseTimeouts(mode: ChatMode): { primary: number; fallback: number } {
  return mode === "analyse" || mode === "discover"
    ? { primary: 200_000, fallback: 45_000 }
    : { primary: 110_000, fallback: 60_000 };
}

function stripHeavyReportFields(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return depth > 12 ? [] : value.map((item) => stripHeavyReportFields(item, depth + 1));
  }
  if (value && typeof value === "object") {
    if (depth > 12) return {};
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (CHAT_CONTEXT_DROP_KEYS.has(key)) continue;
      // Any stray data URI / base64 blob elsewhere in the payload.
      if (typeof val === "string" && (val.startsWith("data:") || val.length > 4_000)) continue;
      out[key] = stripHeavyReportFields(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** Compact, token-bounded JSON for the "FULL REPORT JSON" prompt section. */
function reportJsonForPrompt(currentReport: object): string {
  let json: string;
  try {
    json = JSON.stringify(stripHeavyReportFields(currentReport));
  } catch {
    return "";
  }
  if (json.length <= CHAT_REPORT_JSON_BUDGET) return json;
  // The pinned summary block above already carries every figure the answer
  // rules depend on, so truncating the raw JSON loses detail, not accuracy.
  return `${json.slice(0, CHAT_REPORT_JSON_BUDGET)}\n…(report JSON truncated — use the pinned data above)`;
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
  // Same prompt without the raw report JSON — used by the fast-model retry so a
  // context-length or provider failure still gets the user a real answer.
  let pinnedOnlyContext: string | null = null;
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
    if (titleType)    sections.push(`  Title type: ${titleType}`);
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

    pinnedOnlyContext = `${SYSTEM_PROMPT}${langSuffix}\n\n${pinnedSection}`;
    const reportJson = reportJsonForPrompt(currentReport);
    systemWithContext = reportJson
      ? `${pinnedOnlyContext}FULL REPORT JSON (reference for any detail not covered above):\n${reportJson}`
      : pinnedOnlyContext;
  }

  let userContent = lastMessage.content;
  if (mode === "analyse") {
    userContent = `${lastMessage.content}\n\n${ANALYSE_AUGMENTATION}`;
  } else if (mode === "discover") {
    userContent = `${lastMessage.content}\n\n${DISCOVER_AUGMENTATION}`;
  }

  const history = buildLlmHistory(conversationHistory);
  const contents = [
    ...history,
    { role: "user", parts: [{ text: userContent }] },
  ];
  const timeouts = unifiedResponseTimeouts(mode);

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-reasoner",
      config: {
        systemInstruction: systemWithContext,
        maxOutputTokens: 8192,
        // Leave headroom under the mobile client's chat timeout so a stalled
        // reasoner falls back below instead of the user seeing a dead turn.
        timeoutMs: timeouts.primary,
      },
      contents,
    });
    const content = response.text ?? "";
    if (content.trim()) return { content, mode };
    logger.warn({ mode }, "Unified response was empty — retrying on the fast model");
  } catch (error) {
    logger.warn(
      { err: (error as Error)?.message, mode, hasReport: Boolean(currentReport) },
      "Unified response failed on the reasoning model — retrying on the fast model",
    );
  }

  // Fallback: the fast model with the pinned data only (no raw report JSON).
  // Covers provider timeouts/outages on the reasoner and prompts that exceed
  // the context window — a slightly shorter answer beats no answer at all.
  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        systemInstruction: pinnedOnlyContext ?? systemWithContext,
        maxOutputTokens: 4096,
        timeoutMs: timeouts.fallback,
      },
      contents,
    });
    // An empty answer is returned as-is: callers already substitute their own
    // "couldn't generate that" copy for empty content.
    return { content: response.text ?? "", mode };
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
  if (value === "hold_existing" || value === "refurbish" || value === "demolish_rebuild" || value === "integrated_consent") return value;
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
    "demolish_rebuild": "<one concise sentence>",
    "integrated_consent": "<one concise sentence>"
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
      integrated_consent: typeof strategyRationales.integrated_consent === "string" ? strategyRationales.integrated_consent : "A design-led integrated consent concept may be tested separately where the standard vacant-lot yield understates site potential.",
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

/**
 * Client-facing executive summary for a white-label PDF export (provider portal).
 * Reuses the existing DeepSeek client. Given the structured feasibility report,
 * returns 2-3 short professional paragraphs a service provider can put on the
 * cover of a report they send to their client. Read-only over the report — does
 * NOT change any report data or the analysis pipeline.
 */
export async function generateExecutiveSummary(
  report: Record<string, unknown>,
  locale: Locale = "en",
): Promise<string> {
  const overview = (report["propertyOverview"] as Record<string, unknown> | undefined) ?? {};
  const scores = (report["scores"] as Record<string, unknown> | undefined) ?? {};
  const planning = (report["planning"] as Record<string, unknown> | undefined) ?? {};
  const facts = {
    address: report["address"] ?? overview["address"] ?? "the property",
    zone: overview["zone"] ?? planning["zone"] ?? null,
    composite: scores["composite"] ?? null,
    ease: scores["ease"] ?? null,
    cost: scores["cost"] ?? null,
    roi: scores["roi"] ?? null,
    potentialLots: planning["potentialLots"] ?? report["potential_lots"] ?? null,
    totalCostLow: report["totalCostLow"] ?? null,
    totalCostHigh: report["totalCostHigh"] ?? null,
    riskSummary: Array.isArray(report["riskSummary"]) ? (report["riskSummary"] as unknown[]).slice(0, 5) : [],
  };

  const system =
    "You are a property development consultant writing the executive summary that opens a feasibility report sent to a client. " +
    "Write 2-3 concise, professional paragraphs (no headings, no markdown, no bullet lists). " +
    "Summarise the development opportunity, the key feasibility signals (subdivision potential, cost, ROI) and the main risks, " +
    "in plain client-friendly language. Do not invent figures beyond those provided. Do not include a sign-off." +
    languageInstruction(locale);

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: { systemInstruction: system, maxOutputTokens: 1024 },
      contents: [
        {
          role: "user",
          parts: [{ text: `Report facts (JSON):\n${JSON.stringify(facts)}` }],
        },
      ],
    });
    return sanitizeAssistantProse(response.text ?? "", locale).trim();
  } catch (error) {
    logger.error({ error }, "Failed to generate executive summary");
    throw error;
  }
}
