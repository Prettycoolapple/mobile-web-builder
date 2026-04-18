import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, profiles, searches } from "@workspace/db";
import {
  generateFeasibilityReport,
  generateSearchResults,
  generateChatReply,
  generateUnifiedResponse,
  generateAnalysis,
  detectMode,
  extractChatIntent,
  Message,
} from "../lib/claude";
import { verifyToken } from "../lib/auth";
import { extractNZAddress } from "../lib/address-parser";
import {
  findSuburbInTextViaIndex,
  getDistrictSiblings,
  findSuburbId,
} from "../lib/scrapers/realestate-api";
import { suggestNearbySuburbs } from "../lib/claude";
import { runPropertyPipeline } from "../lib/pipeline";
import { detectSubdivision } from "../lib/subdivision";
import { formatNZD } from "../lib/utils";
import { searchRealEstateListings } from "../lib/scrapers/realestate-search";
import { preScreenListingsFast, type PropertyCandidate } from "../lib/pre-screen";
import {
  makeCacheKey,
  setListingCache,
  popNextListings,
  markShown,
  getShownUrls,
} from "../lib/listing-cache";
import { queueBackgroundScores, getCardScores } from "../lib/analysis-cache";

const router = Router();

const FREE_REPORT_LIMIT = 2;
const STANDARD_REPORT_LIMIT = 20;

function extractJSON(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No JSON found in response");
}

// Simple edit-distance (Levenshtein) for fuzzy suburb matching
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Find suburbs to fall back to when the primary suburb has no listings.
 * Strategy: prefer LLM suggestions (Gemini knows real NZ geography), then
 * top up with sister suburbs from the same realestate.co.nz district. Both
 * sources are de-duplicated and capped. No hand-curated map.
 */
async function resolveNearbySuburbs(suburb: string, max = 5): Promise<string[]> {
  const llm = await suggestNearbySuburbs(suburb, max).catch(() => [] as string[]);

  // Pull a few district siblings as a safety net for any suburbs the LLM
  // may not know about (smaller / less famous places).
  let siblings: string[] = [];
  try {
    const rec = await findSuburbId(suburb);
    if (rec) {
      const siblingRecs = await getDistrictSiblings(rec.id, 8);
      siblings = siblingRecs.map((r) => r.title.toLowerCase());
    }
  } catch { /* ignore */ }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...llm, ...siblings]) {
    const key = candidate.toLowerCase().trim();
    if (!key || key === suburb.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= max) break;
  }
  return out;
}

// ── Criteria-based re-ranking ──────────────────────────────────────────────────
// Applies rule-based score boosts derived from the LLM-extracted criteria string
// so that properties best matching the user's intent surface to the top before
// the final random pick.
function rankByCriteria(candidates: PropertyCandidate[], criteria: string | null): PropertyCandidate[] {
  if (!criteria || candidates.length === 0) return candidates;
  const c = criteria.toLowerCase();

  // Parse intent signals from criteria text
  const wantsDevelopment  = /develop|subdiv|subdividable|section|lots?|townhouse|unit|multi/i.test(c);
  const wantsLargeLand    = /large|big|big\s+section|land\s+size|land\s+area|estate|wide|spacious/i.test(c);
  const wantsInvestment   = /invest|roi|yield|return|rental|income/i.test(c);
  const wantsLifestyle    = /lifestyle|rural|acreage|farm|rural/i.test(c);
  const wantsAffordable   = /afford|cheap|budget|value|low[\s-]cost/i.test(c);
  const wantsMinLand      = (() => {
    // "land over 600m²", "at least 700sqm", "bigger than 500", etc.
    const m = c.match(/(?:over|above|at\s+least|more\s+than|bigger\s+than|larger\s+than|minimum)\s+(\d+)\s*(?:m2|sqm|m²|square)/i)
           ?? c.match(/(\d{3,5})\s*(?:m2|sqm|m²)\s+(?:or\s+)?(?:more|plus|above|over)/i);
    return m ? parseInt(m[1], 10) : null;
  })();
  const wantsMaxLand      = (() => {
    const m = c.match(/(?:under|below|less\s+than|smaller\s+than|up\s+to)\s+(\d+)\s*(?:m2|sqm|m²|square)/i);
    return m ? parseInt(m[1], 10) : null;
  })();

  const DEVELOPMENT_ZONES = new Set(["THAB", "MHU", "MHU-H", "MHU-S", "MHS", "TBC", "TC", "LC"]);

  const ranked = candidates.map((p) => {
    let boost = 0;
    const zone = (p.zone ?? "").toUpperCase().trim();
    const land = p.landArea ?? 0;

    if (wantsDevelopment) {
      // Prefer zones that allow multi-lot development
      if (DEVELOPMENT_ZONES.has(zone)) boost += 2;
      // Prefer larger sites (more lot potential)
      if (land >= 800) boost += 1.5;
      else if (land >= 600) boost += 1;
      else if (land >= 400) boost += 0.5;
      // Prefer high ease score (few overlay restrictions)
      boost += p.scores.ease * 0.4;
    }

    if (wantsLargeLand) {
      // Scale boost with land area, capped at 3
      boost += Math.min(3, land / 400);
    }

    if (wantsMinLand !== null) {
      // Hard filter: strong negative if below minimum
      if (land > 0 && land < wantsMinLand) boost -= 5;
      else if (land >= wantsMinLand) boost += 1;
    }

    if (wantsMaxLand !== null && land > wantsMaxLand) {
      boost -= 3; // penalise over-sized sites
    }

    if (wantsInvestment) {
      boost += p.scores.roi * 0.5;
    }

    if (wantsLifestyle) {
      // Prefer larger land and rural-leaning zones
      boost += Math.min(2, land / 600);
      if (zone === "RUR" || zone === "LLRZ") boost += 1;
    }

    if (wantsAffordable) {
      boost += p.scores.cost * 0.4;
    }

    return { candidate: p, score: p.scores.composite + boost };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .map((r) => r.candidate);
}

// Randomly pick up to `n` items from an array (Fisher-Yates partial shuffle)
function shufflePick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const end = Math.min(n, copy.length);
  for (let i = 0; i < end; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, end);
}

async function parseDiscoverParams(text: string): Promise<{ suburb: string | null; minPrice: number; maxPrice: number }> {
  // Resolve suburb against the live realestate.co.nz directory (1899 suburbs)
  // — no hand-curated list. Coverage tracks the data source automatically.
  const hit = await findSuburbInTextViaIndex(text);
  const suburb = hit ? hit.title.toLowerCase() : null;

  const pricePatterns = [
    /under\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /below\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /less than\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /up to\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /max(?:imum)?\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
  ];

  let maxPrice = 3_000_000;
  for (const p of pricePatterns) {
    const m = p.exec(text);
    if (m) {
      let v = parseFloat(m[1]);
      const suffix = m[2]?.toLowerCase();
      if (suffix === "m") v *= 1_000_000;
      else if (suffix === "k") v *= 1_000;
      else if (v < 100) v *= 1_000_000;
      maxPrice = Math.round(v);
      break;
    }
  }

  const rangeM = /\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)\s*(?:to|-)\s*\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i.exec(text);
  let minPrice = Math.max(0, maxPrice - 1_500_000);
  if (rangeM) {
    let lo = parseFloat(rangeM[1]);
    const loS = rangeM[2]?.toLowerCase();
    if (loS === "m") lo *= 1_000_000;
    else if (loS === "k") lo *= 1_000;
    else if (lo < 100) lo *= 1_000_000;

    let hi = parseFloat(rangeM[3]);
    const hiS = rangeM[4]?.toLowerCase();
    if (hiS === "m") hi *= 1_000_000;
    else if (hiS === "k") hi *= 1_000;
    else if (hi < 100) hi *= 1_000_000;

    minPrice = Math.round(lo);
    maxPrice = Math.round(hi);
  }

  return { suburb, minPrice: Math.max(0, minPrice), maxPrice };
}

function getUserIdFromHeader(req: any): string | null {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const payload = verifyToken(authHeader.slice(7));
  return payload?.sub ?? null;
}

router.post("/analyse", async (req, res) => {
  const { address, conversationHistory } = req.body as {
    address: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!address) {
    res.status(400).json({ error: "address is required", code: "MISSING_ADDRESS" });
    return;
  }

  const userId = getUserIdFromHeader(req);

  if (userId) {
    const [profile] = await db.select({
      id: profiles.id,
      subscriptionTier: profiles.subscriptionTier,
      reportsUsedThisMonth: profiles.reportsUsedThisMonth,
      lastResetAt: profiles.lastResetAt,
    }).from(profiles).where(eq(profiles.id, userId)).limit(1);

    if (profile) {
      const now = new Date();
      const lastReset = new Date(profile.lastResetAt);
      const sameMonth = now.getFullYear() === lastReset.getFullYear() && now.getMonth() === lastReset.getMonth();

      const usedCount = sameMonth ? profile.reportsUsedThisMonth : 0;
      if (!sameMonth) {
        await db.update(profiles).set({ reportsUsedThisMonth: 0, lastResetAt: now }).where(eq(profiles.id, userId));
      }

      const isStandard = profile.subscriptionTier === "pro" || profile.subscriptionTier === "standard";
      const limit = isStandard ? STANDARD_REPORT_LIMIT : FREE_REPORT_LIMIT;
      if (usedCount >= limit) {
        res.status(402).json({
          error: isStandard
            ? `You've used all ${STANDARD_REPORT_LIMIT} reports this month. Your limit resets on the 1st.`
            : `You've used all ${FREE_REPORT_LIMIT} free reports this month. Upgrade to Standard for more reports.`,
          code: "LIMIT_REACHED",
          reportsUsed: usedCount,
          limit,
        });
        return;
      }
    }
  }

  try {
    // ── Subdivision pre-check ───────────────────────────────────────────────
    // If the user typed a parent street number that has been subdivided into
    // sub-lots (e.g. "66 Marine Parade" → 66A/66B/66C), don't run the pipeline
    // against stale parent data — ask which sub-lot they meant.
    const subdivision = await detectSubdivision(address).catch(() => null);
    if (subdivision?.isSubdivided) {
      res.json({
        type: "clarification",
        clarificationType: "subdivision",
        question: `"${address}" looks like it has been subdivided into separate lots. Which one would you like me to analyse?`,
        options: subdivision.subLots,
      });
      return;
    }

    const raw = await generateFeasibilityReport(address, conversationHistory || []);
    const report = extractJSON(raw);

    if (userId) {
      await db.update(profiles).set({
        reportsUsedThisMonth: sql`${profiles.reportsUsedThisMonth} + 1`,
      }).where(eq(profiles.id, userId));

      await db.insert(searches).values({
        userId,
        query: address,
        address,
        resultJson: report as any,
      }).catch(() => {});
    }

    res.json({ report, type: "report" });
  } catch (error) {
    req.log.error({ error }, "Failed to analyse property");
    res.status(500).json({
      error: "Failed to generate feasibility report. Please try again.",
      code: "ANALYSE_FAILED",
    });
  }
});

router.post("/search", async (req, res) => {
  const { query, suburb, minPrice, maxPrice } = req.body as {
    query: string;
    suburb?: string;
    minPrice?: number;
    maxPrice?: number;
    criteria?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query is required", code: "MISSING_QUERY" });
    return;
  }

  const userId = getUserIdFromHeader(req);

  try {
    const raw = await generateSearchResults(query, suburb, minPrice, maxPrice);
    const result = extractJSON(raw) as { suburb: string; candidates: unknown[] };

    if (userId) {
      await db.insert(searches).values({
        userId,
        query,
        address: suburb || null,
        resultJson: result as any,
      }).catch(() => {});
    }

    res.json({
      candidates: result.candidates || [],
      suburb: result.suburb || suburb || "",
      query,
      type: "search",
    });
  } catch (error) {
    req.log.error({ error }, "Failed to search properties");
    res.status(500).json({
      error: "Failed to search properties. Please try again.",
      code: "SEARCH_FAILED",
    });
  }
});

const CHAT_LIMITS: Record<string, { limit: number; warnAt: number }> = {
  service_provider: { limit: 300, warnAt: 280 },
  general_standard: { limit: 50,  warnAt: 45  },
  general_free:     { limit: 10,  warnAt: 8   },
  default:          { limit: 50,  warnAt: 45  },
};

async function checkAndIncrementChatMessages(userId: string): Promise<{
  allowed: boolean;
  messagesUsed: number;
  nearLimit: boolean;
  isFreeLimit: boolean;
}> {
  const [profile] = await db
    .select({
      messagesUsedThisMonth: profiles.messagesUsedThisMonth,
      lastResetAt: profiles.lastResetAt,
      role: profiles.role,
      subscriptionTier: profiles.subscriptionTier,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!profile) return { allowed: true, messagesUsed: 0, nearLimit: false, isFreeLimit: false };

  const tier = profile.subscriptionTier ?? "free";
  const role = profile.role ?? "general";
  let limitKey: string;
  if (role === "service_provider") {
    limitKey = "service_provider";
  } else if (role === "general" && (tier === "standard" || tier === "pro")) {
    limitKey = "general_standard";
  } else {
    limitKey = "general_free";
  }
  const { limit, warnAt } = CHAT_LIMITS[limitKey] ?? CHAT_LIMITS.default;
  const isFreeLimit = limitKey === "general_free";

  const now = new Date();
  const lastReset = new Date(profile.lastResetAt);
  const sameMonth =
    now.getFullYear() === lastReset.getFullYear() && now.getMonth() === lastReset.getMonth();

  let currentCount = sameMonth ? profile.messagesUsedThisMonth : 0;

  if (!sameMonth) {
    await db
      .update(profiles)
      .set({ messagesUsedThisMonth: 0, reportsUsedThisMonth: 0, lastResetAt: now })
      .where(eq(profiles.id, userId));
    currentCount = 0;
  }

  if (currentCount >= limit) {
    return { allowed: false, messagesUsed: currentCount, nearLimit: true, isFreeLimit };
  }

  await db
    .update(profiles)
    .set({ messagesUsedThisMonth: sql`${profiles.messagesUsedThisMonth} + 1` })
    .where(eq(profiles.id, userId));

  const newCount = currentCount + 1;
  return {
    allowed: true,
    messagesUsed: newCount,
    nearLimit: newCount >= warnAt,
    isFreeLimit,
  };
}

router.post("/chat", async (req, res) => {
  const { messages, currentReport, message, conversationHistory, reportContext } = req.body as {
    messages?: Message[];
    currentReport?: object;
    message?: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    reportContext?: string;
  };

  // Rate limiting: 50 messages/month per authenticated general user
  const chatUserId = getUserIdFromHeader(req);
  if (chatUserId) {
    try {
      const { allowed, messagesUsed, nearLimit, isFreeLimit } = await checkAndIncrementChatMessages(chatUserId);
      if (!allowed) {
        res.status(429).json({
          error: "monthly_limit_reached",
          code: isFreeLimit ? "upgrade_required" : "monthly_limit_reached",
          messagesUsed,
          message: isFreeLimit
            ? "You've used all your free messages this month. Upgrade to Standard for more."
            : "You've reached your monthly message limit. It resets at the start of next month.",
        });
        return;
      }
      // Attach to res.locals so we can surface nearLimit in response if needed
      res.locals.chatMessagesUsed = messagesUsed;
      res.locals.chatNearLimit = nearLimit;
    } catch {
      // Non-fatal — proceed even if rate limit check fails
    }
  }

  if (messages && messages.length > 0) {
    try {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      const userText = lastUserMessage?.content ?? "";

      // ─── LLM intent extraction ─────────────────────────────────────────────
      // Extract the address/suburb from the currently open report (if any) so
      // the LLM can resolve context references like "this area", "currently", etc.
      let reportCtx: { address?: string | null; suburb?: string | null } | null = null;
      if (currentReport) {
        const r = currentReport as Record<string, unknown>;
        const overview = r["propertyOverview"] as Record<string, unknown> | undefined;
        const addr = (r["address"] as string | null) ?? (overview?.["address"] as string | null) ?? null;
        // Extract suburb from address or pipeline suburb field
        const suburbFromReport = (r["suburb"] as string | null) ?? null;
        reportCtx = { address: addr, suburb: suburbFromReport };
      }

      // Already-shown addresses + URLs from conversation history (for follow-up de-duplication).
      // Discover responses are sent to the client as `content: JSON.stringify({candidates, ...})`,
      // so we parse those JSON payloads to recover everything previously shown across the whole
      // chat. This survives server restarts (in-memory listing cache lost) and prevents the
      // "show me others" bug where the same listings re-appear.
      const alreadyShownFromHistory: string[] = [];
      const alreadyShownUrlsFromHistory: string[] = [];
      for (const msg of messages) {
        if (msg.role !== "assistant" || !msg.content) continue;
        const trimmed = msg.content.trim();
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed) as { candidates?: Array<{ address?: unknown; listingUrl?: unknown }> };
          if (Array.isArray(parsed.candidates)) {
            for (const c of parsed.candidates) {
              if (typeof c.address === "string" && c.address) alreadyShownFromHistory.push(c.address);
              if (typeof c.listingUrl === "string" && c.listingUrl) alreadyShownUrlsFromHistory.push(c.listingUrl);
            }
          }
        } catch { /* not JSON, skip */ }
      }

      const intent = await extractChatIntent(messages, reportCtx, alreadyShownFromHistory);
      const mode = intent.mode;

      // ─── CLARIFICATION LOOP ─────────────────────────────────────────────────
      // When the LLM determines it can't proceed without more info (e.g. no suburb
      // for a discover search), return the clarification question immediately.
      // The next user reply will carry the answer in conversation history so the
      // intent extractor can resolve the suburb/price/address and proceed normally.
      if (intent.needsClarification && intent.clarificationQuestion) {
        req.log.info(
          { question: intent.clarificationQuestion, intent_reasoning: intent.reasoning },
          "Returning clarification question to user",
        );
        res.json({
          content: intent.clarificationQuestion,
          mode: "clarification",
          intent: { needsClarification: true },
        });
        return;
      }

      if (mode === "discover") {
        try {
          // ─── DISCOVER FLOW — using LLM-extracted intent ──────────────────
          // All parameters come from the intent object. Suburb may have been
          // inferred from the current report context when absent from the message.
          let suburb = intent.suburb;
          const isFollowUp = intent.isFollowUp;
          const includeNegotiation = intent.includeNegotiation;
          const userTextHasPrice = intent.minPrice !== null || intent.maxPrice !== null;

          // Default price range if LLM found no price constraint
          const DEFAULT_MAX = 3_000_000;
          let effectiveMinPrice = intent.minPrice ?? Math.max(0, (intent.maxPrice ?? DEFAULT_MAX) - 1_500_000);
          let effectiveMaxPrice = intent.maxPrice ?? DEFAULT_MAX;
          let alreadyShownAddresses: string[] = alreadyShownFromHistory;

          // If the LLM didn't find a suburb, scan history messages with fast regex
          // (covers follow-ups like "show more" where no suburb is mentioned)
          if (!suburb && isFollowUp) {
            for (const msg of [...messages].reverse()) {
              if (msg.role === "user" && msg.content !== userText) {
                const { suburb: prevSuburb, minPrice: prevMin, maxPrice: prevMax } = await parseDiscoverParams(msg.content ?? "");
                if (prevSuburb) {
                  suburb = prevSuburb;
                  if (!userTextHasPrice) {
                    effectiveMinPrice = prevMin;
                    effectiveMaxPrice = prevMax;
                  }
                  break;
                }
              }
            }
          }

          req.log.info({ suburb, effectiveMinPrice, effectiveMaxPrice, isFollowUp, includeNegotiation, intent_reasoning: intent.reasoning }, "Discovery search started");

          let candidates: import("../lib/pre-screen").PropertyCandidate[] = [];
          let isMockData = false;
          let dataSource = "realestate.co.nz";
          let prescreenedIntro = "";

          if (suburb) {
            const cacheKey = makeCacheKey(suburb, effectiveMinPrice, effectiveMaxPrice);

            // "Show more" follow-up: only try the cache if we've actually shown results before.
            // When isFollowUp=true because the user answered a clarification question (first search
            // for this suburb), hasShownAny=false so we skip straight to the fresh search below.
            const hasShownAny = getShownUrls(cacheKey).length > 0;

            if (isFollowUp && hasShownAny) {
              let attempts = 0;
              while (candidates.length === 0 && attempts < 3) {
                const { listings: nextListings, remaining } = popNextListings(cacheKey, 8);
                if (nextListings.length === 0) break;
                req.log.info({ nextListings: nextListings.length, remaining, attempt: attempts + 1 }, "Follow-up: popping next listings from cache");
                markShown(cacheKey, nextListings.map((l) => l.listingUrl));
                const screened = await preScreenListingsFast(nextListings, 5).catch(() => []);
                candidates = shufflePick(rankByCriteria(screened, intent.criteria), 3);
                attempts++;
              }
            }

            // Fresh search when: first search, clarification answer, or cache exhausted.
            // Combine in-memory shown URLs with history-derived URLs so we still skip
            // previously-shown listings even after a server restart.
            if (candidates.length === 0) {
              const shownUrls = Array.from(new Set([
                ...getShownUrls(cacheKey),
                ...alreadyShownUrlsFromHistory,
              ]));
              req.log.info(
                { fromCache: getShownUrls(cacheKey).length, fromHistory: alreadyShownUrlsFromHistory.length, total: shownUrls.length },
                "Discovery: dedupe skipUrls assembled",
              );
              const searchResult = await searchRealEstateListings({
                suburb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                skipUrls: shownUrls,
                includeNegotiation,
              }).catch((err) => { req.log.warn({ err }, "realestate.co.nz search failed"); return null; });

              if (searchResult && searchResult.firstBatch.length > 0) {
                // Allow null-priced (negotiation) listings through unconditionally; price-range filter still applies to priced ones
                const inRange = (l: { price: number | null }) =>
                  l.price == null || (l.price >= effectiveMinPrice && l.price <= effectiveMaxPrice * 1.1);

                const firstFiltered = searchResult.firstBatch.filter(inRange);
                const remainingFiltered = searchResult.remainingListings.filter(inRange);

                setListingCache(cacheKey, {
                  remainingListings: remainingFiltered,
                  shownUrls: firstFiltered.map((l) => l.listingUrl),
                  suburb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                });
                req.log.info({ fetched: firstFiltered.length, cached: remainingFiltered.length }, "realestate.co.nz: prescreening listings");
                // Run pre-screening and AI intro generation in parallel to save time
                const criteriaContext = intent.criteria ? ` matching criteria: ${intent.criteria}` : "";
                const introPromptPreScreen = `The user asked: "${userText}". You found ${firstFiltered.length} matching propert${firstFiltered.length === 1 ? "y" : "ies"} in ${suburb || "the area"} on realestate.co.nz${criteriaContext}. In 1 sentence, acknowledge this result conversationally (e.g. "I found a few development sites in St Heliers under $2M:"). Be natural and brief — no JSON.`;
                const [screened, introFromPreScreen] = await Promise.all([
                  preScreenListingsFast(firstFiltered, 5).catch(() => []),
                  generateAnalysis(introPromptPreScreen).catch(() => ""),
                ]);
                // Re-rank by user criteria then randomly pick to show variety
                candidates = shufflePick(rankByCriteria(screened, intent.criteria), 3);
                prescreenedIntro = introFromPreScreen;
              }
            }

            // ── NEARBY SUBURB FALLBACK ─────────────────────────────────────────
            // If the primary suburb returned nothing (scraper issue, low stock, etc.)
            // try the closest neighbouring suburbs one at a time until we get results.
            if (candidates.length === 0 && suburb) {
              const nearbyList = await resolveNearbySuburbs(suburb, 5);
              // Run nearby-suburb scrapes concurrently and return as soon as the first
              // one yields any listings — keeps tail latency bounded when the slow
              // Playwright fallback is in play.
              req.log.info({ suburb, nearbyList }, "Discovery: primary suburb empty, racing nearby suburb searches");
              type FallbackHit = { nearbySuburb: string; fallbackResult: Awaited<ReturnType<typeof searchRealEstateListings>> };
              const racers = nearbyList.map(
                (nb): Promise<FallbackHit> =>
                  searchRealEstateListings({
                    suburb: nb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                    skipUrls: [],
                    includeNegotiation,
                  }).then((res) => {
                    if (!res || res.firstBatch.length === 0) {
                      // Reject so Promise.any moves on; if all reject we fall through to no-listings
                      return Promise.reject(new Error(`empty:${nb}`));
                    }
                    return { nearbySuburb: nb, fallbackResult: res };
                  }),
              );

              // Bound total wait time so when ScrapingBee is down and all Playwright
              // fetches are slow, we don't keep the user waiting for the laggard.
              const FALLBACK_DEADLINE_MS = 25_000;
              const deadline = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), FALLBACK_DEADLINE_MS),
              );
              const winner: FallbackHit | null = racers.length === 0
                ? null
                : await Promise.race([
                    Promise.any(racers).catch(() => null),
                    deadline,
                  ]);

              const orderedResults: FallbackHit[] = winner ? [winner] : [];

              for (const { nearbySuburb, fallbackResult } of orderedResults) {
                if (fallbackResult && fallbackResult.firstBatch.length > 0) {
                  const inRangeFallback = (l: { price: number | null }) =>
                    l.price == null || (l.price >= effectiveMinPrice && l.price <= effectiveMaxPrice * 1.1);
                  const filtered = fallbackResult.firstBatch.filter(inRangeFallback);
                  if (filtered.length > 0) {
                    const fallbackCacheKey = makeCacheKey(nearbySuburb, effectiveMinPrice, effectiveMaxPrice);
                    setListingCache(fallbackCacheKey, {
                      remainingListings: fallbackResult.remainingListings.filter(inRangeFallback),
                      shownUrls: filtered.map((l) => l.listingUrl),
                      suburb: nearbySuburb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                    });
                    const criteriaContextFallback = intent.criteria ? ` (${intent.criteria})` : "";
                    const introPromptFallback = `The user asked about ${suburb}${criteriaContextFallback} but no listings were found there right now. You found ${filtered.length} propert${filtered.length === 1 ? "y" : "ies"} in nearby ${nearbySuburb}. In 1 sentence acknowledge this naturally (e.g. "I couldn't find anything in ${suburb} right now, but here are some nearby options in ${nearbySuburb}:"). Be brief — no JSON.`;
                    const [screenedFallback, introFallback] = await Promise.all([
                      preScreenListingsFast(filtered, 5).catch(() => filtered.slice(0, 5) as typeof candidates),
                      generateAnalysis(introPromptFallback).catch(() => ""),
                    ]);
                    if (screenedFallback.length > 0) {
                      candidates = shufflePick(rankByCriteria(screenedFallback, intent.criteria), 3);
                      prescreenedIntro = introFallback;
                      req.log.info({ nearbySuburb, count: candidates.length }, "Discovery: nearby suburb fallback succeeded");
                      break;
                    }
                  }
                }
              }
            }
          }

          const noListings = candidates.length === 0;

          // Use pre-computed intro if available, otherwise generate one now for the no-results case
          let aiIntro = (!noListings && prescreenedIntro) ? prescreenedIntro : "";
          if (!aiIntro) {
            try {
              const criteriaContextGeneral = intent.criteria ? ` (${intent.criteria})` : "";
              const introPrompt = noListings
                ? `The user asked: "${userText}". No matching listings were found on realestate.co.nz right now for ${suburb || "this area"}${criteriaContextGeneral}. In 1-2 sentences, acknowledge this warmly and suggest they try a different suburb, adjust their budget, or check back soon. Do NOT output any JSON.`
                : `The user asked: "${userText}". You found ${candidates.length} matching propert${candidates.length === 1 ? "y" : "ies"} in ${suburb || "the area"} on realestate.co.nz${criteriaContextGeneral}. In 1 sentence, acknowledge the results conversationally. Be natural and brief — no JSON.`;
              aiIntro = await generateAnalysis(introPrompt).catch(() => "");
            } catch { /* silent */ }
          }

          if (candidates.length > 0) {
            queueBackgroundScores(
              candidates.map((c) => ({
                address: c.address,
                price: c.price,
                landArea: c.landArea,
                zone: c.zone,
              })),
            );
          }

          const responsePayload = JSON.stringify({ candidates, isMockData, suburb, dataSource, noListings, aiIntro });
          res.json({ content: responsePayload, mode: "discover" });
          return;
        } catch (err) {
          req.log.warn({ err }, "Discovery mode error — falling through to AI");
        }
      }

      if (mode === "analyse") {
        // Address priority:
        // 1. LLM extracted it directly from the current message
        // 2. extractNZAddress regex on the current message
        // 3. extractNZAddress on prior history messages
        let extractedAddress: string | null = intent.address ?? null;

        if (!extractedAddress) {
          extractedAddress = await extractNZAddress(userText).catch(() => null);
        }

        if (!extractedAddress) {
          for (const msg of [...messages].reverse()) {
            if (msg.role === "user" && msg.content !== userText) {
              const prev = await extractNZAddress(msg.content).catch(() => null);
              if (prev) { extractedAddress = prev; break; }
            }
          }
        }

        // ── Safety-net guard: if the extracted address matches the already-analysed
        // currentReport (i.e. this is a follow-up, not a new property), and the user
        // has NOT explicitly asked to re-run the analysis, skip the pipeline entirely
        // and fall through to generateUnifiedResponse which uses the confirmed report data.
        // This prevents external API inconsistencies (e.g. different zone labels on repeat
        // fetches) from overwriting the verified data shown to the user in the same session.
        const RE_ANALYSE_TRIGGERS = /\b(re-?analy[sz]e|redo|run again|analy[sz]e again|new analysis|re-?run|fresh analysis)\b/i;
        if (extractedAddress && currentReport && !RE_ANALYSE_TRIGGERS.test(userText)) {
          const r = currentReport as Record<string, unknown>;
          const reportAddr: string | null =
            (r["address"] as string | null) ??
            ((r["propertyOverview"] as Record<string, unknown> | undefined)?.["address"] as string | null) ??
            null;
          if (reportAddr) {
            const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (normalise(reportAddr) === normalise(extractedAddress)) {
              req.log.info(
                { address: extractedAddress },
                "Follow-up about already-analysed property — skipping pipeline, using currentReport",
              );
              // Fall through to generateUnifiedResponse below (mode will be treated as followup)
              const { content, mode: responseMode } = await generateUnifiedResponse(messages, currentReport, "followup");
              res.json({ content, mode: responseMode });
              return;
            }
          }
        }

        const aiResponseEarly = null;
        void aiResponseEarly;

        if (extractedAddress) {
          // ── Subdivision pre-check ─────────────────────────────────────────
          // Same logic as the direct /analyse route — bail before the heavy
          // pipeline if the parent number was actually subdivided.
          const subdivision = await detectSubdivision(extractedAddress).catch(() => null);
          if (subdivision?.isSubdivided) {
            res.json({
              content: JSON.stringify({
                clarificationType: "subdivision",
                question: `"${extractedAddress}" looks like it has been subdivided into separate lots. Which one would you like me to analyse?`,
                options: subdivision.subLots,
              }),
              mode: "clarification",
            });
            return;
          }

          req.log.info({ address: extractedAddress }, "Running property pipeline for analyse mode");

          // Keep-alive heartbeat — sends a silent space every 8 s so the reverse
          // proxy doesn't close the connection during the long pipeline + LLM run.
          // The client uses resp.json() which buffers the full body; JSON.parse
          // ignores leading whitespace so the injected spaces are harmless.
          //
          // IMPORTANT: once res.write() is called the HTTP headers are committed.
          // After that, res.json() will crash with ERR_HTTP_HEADERS_SENT because
          // it tries to re-set Content-Type. We track whether the heartbeat fired
          // and use write+end instead of json() in that case.
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Accel-Buffering", "no");
          let heartbeatFired = false;
          const _heartbeat = setInterval(() => {
            try {
              if (!res.writableEnded) { res.write(" "); heartbeatFired = true; }
            } catch { /* ignore */ }
          }, 8_000);

          // Helper: send the final JSON response safely regardless of whether
          // the heartbeat has already committed the response headers.
          const sendAnalyseResponse = (data: object) => {
            clearInterval(_heartbeat);
            if (res.writableEnded) return;
            if (heartbeatFired) {
              // Headers already committed — write body directly
              try { res.write(JSON.stringify(data)); res.end(); } catch { /* ignore */ }
            } else {
              res.json(data);
            }
          };

          const pipelineResult = await runPropertyPipeline(extractedAddress).catch((err) => {
            req.log.warn({ err }, "Pipeline failed — falling back to AI-only analysis");
            return null;
          });

          if (pipelineResult) {
            const failedStr =
              pipelineResult.failed_sources.length > 0
                ? `\nFailed sources (treat as unknown): ${pipelineResult.failed_sources.join(", ")}`
                : "";

            const {
              merged, geocode, linz_parcel, contour, property_history, asbestos,
              asbestos_detail, lots, costs, comparables, comparables_quality,
              scenarios, scores, suburb, easements,
            } = pipelineResult;

            let enrichedContent: string;

            if (merged && lots && costs && scores && scenarios.length > 0) {
              const interestOutlook = scenarios[0]?.interest_rate_outlook ?? "stable";
              const scenarioLines = scenarios.map((s) => {
                const caseLines = (s.cases ?? []).map((c) =>
                  `    [${c.case.toUpperCase()}] GDV $${formatNZD(c.gdv)} (×${c.gdv_multiplier.toFixed(2)}), ` +
                  `Profit $${formatNZD(c.gross_profit)}, ROI ${c.roi_percent.toFixed(1)}%, ` +
                  `Ann. ${c.annualised_roi_percent.toFixed(1)}% p.a., Viable: ${c.viable}`
                ).join("\n");
                return `  ${s.years}-year (base GDV $${formatNZD(s.gdv)}, cost $${formatNZD(s.total_cost_mid)}):\n${caseLines}`;
              }).join("\n");

              const cvNzd = costs.land_cv_nzd;
              const cvNote = cvNzd > 0
                ? `$${formatNZD(cvNzd)} (confirmed from ${(merged as any).data_sources?.cv_nzd || "Hougarden/OneRoof"})`
                : `NOT AVAILABLE from any data source — cv_unavailable is TRUE. Set propertyOverview.cv to null in the JSON output. ROI calculations exclude land cost.`;

              const cvSource = (merged as any).data_sources?.cv_nzd ?? null;
              const landSource = (merged as any).data_sources?.land_area_sqm ?? null;
              const floorSource = (merged as any).data_sources?.floor_area_sqm ?? null;
              const contourSlope = (merged as any).contour_slope_degrees ?? null;
              const contourSrc = (merged as any).contour_source ?? null;
              const contourTxt = (merged as any).contour_text ?? null;
              const missingCritical = (merged as any).missing_critical_fields ?? [];

              enrichedContent = `Analyse this NZ property for development feasibility.${failedStr}

ADDRESS: ${geocode?.formatted ?? extractedAddress}
SUBURB: ${suburb}

PROPERTY DATA (from LINZ, Hougarden, OneRoof, Auckland Council GIS):
${JSON.stringify(merged, null, 2)}

PRE-COMPUTED SCORES — copy these numbers exactly, do not recalculate or second-guess them:
  Ease of development: ${scores.ease}/5
  Reasons: ${scores.ease_reasons.join("; ")}

  Cost score: ${scores.cost}/5
  Reasons: ${scores.cost_reasons.join("; ")}

  ROI score: ${scores.roi}/5
  Reasons: ${scores.roi_reasons.join("; ")}

  Composite score: ${scores.composite}/5

PRE-COMPUTED FINANCIALS — use verbatim:
  Potential lots: ${lots.lots}
  Zone: ${lots.zone_label} (${merged.zone_code ?? "unknown"})
  Land / CV: ${cvNote}
  CV unavailable: ${costs.cv_unavailable}
  Missing critical fields: ${missingCritical.join(", ") || "none"}

  Total development cost (${costs.cv_unavailable ? "EXCLUDES land — CV unavailable" : "INCLUDES land"}):
    Low:  $${formatNZD(costs.total_low)}
    High: $${formatNZD(costs.total_high)}
  Cost per unit (avg): $${formatNZD(costs.cost_per_unit_avg)}

  Lot breakdown: ${lots.lots} lots × ${scenarios[0]?.sqm_per_lot ?? "?"}m² each → estimated ~${scenarios[0]?.gdv_per_lot ? formatNZD(scenarios[0].gdv_per_lot) : "?"} per lot (based on ${comparables_quality} comparable data)
  NZ interest rate outlook: ${interestOutlook.toUpperCase()} (RBNZ OCR trajectory)${interestOutlook === "falling" ? " — BULL case enabled (+20% upside)" : ""}

  ROI Scenarios (Bear/Base/Bull cases per time horizon):
${scenarioLines}

  Comparables quality: ${comparables_quality}
  Avg comparable sale (per lot): $${formatNZD(scenarios[0]?.gdv_per_lot ?? scenarios[0]?.gdv / Math.max(1, lots.lots))}

ASBESTOS: ${asbestos_detail.risk} risk — ${asbestos_detail.notes}

EASEMENTS & RIGHTS OF WAY (from LINZ title memorials):
Retrieval status: ${easements.retrieval_status}
${easements.retrieval_status === "retrieved"
  ? `Source: LINZ title memorials (layer 51553)
Burdening encumbrances: ${easements.burdening.length}
Appurtenant (benefit) easements: ${easements.appurtenant.length}
Has burdening ROW: ${easements.access_row_burdening}
Has burdening drainage easement: ${easements.drainage_burdening}
Has burdening power easement: ${easements.power_burdening}
Has building covenant: ${easements.building_covenant}
Estimated burdening area: ${easements.total_burdening_area_sqm}m²
Net subdividable area after easements: ${lots.net_area_sqm}m² (gross: ${lots.gross_area_sqm}m²)
Lot impact: ${easements.lot_impact_note ?? "None identified"}
Summary: ${easements.summary}
Burdening easements detail:
${easements.burdening.map((e, i) => `  ${i + 1}. [${e.type}] ${e.description} — est. ${e.estimated_area_sqm ?? "?"}m² — severity: ${e.severity}`).join("\n") || "  None"}
Appurtenant easements detail:
${easements.appurtenant.map((e, i) => `  ${i + 1}. [${e.type}] ${e.description}`).join("\n") || "  None"}`
  : easements.retrieval_status === "api_error"
    ? "LINZ memorials API failed — easement data is UNAVAILABLE for this title. You MUST state in subdivisionSummary that a solicitor title search is required before any subdivision or building consent."
    : easements.retrieval_status === "no_title"
      ? "Could not resolve LINZ title for this property — no easement data available. State in subdivisionSummary that title search is required."
      : "LINZ returned no recorded memorials for this title. This may mean no registered easements/ROW, OR the data is incomplete. State that a title search is recommended to confirm."}

YOUR TASK:
Return a FeasibilityReport JSON using ALL of the above data. Follow this EXACT schema:
{
  "address": "full address",
  "scores": {
    "ease": ${scores.ease}, "cost": ${scores.cost}, "roi": ${scores.roi}, "composite": ${scores.composite},
    "ease_reasons": [${scores.ease_reasons.map((r) => `"${r}"`).join(", ")}],
    "cost_reasons": [${scores.cost_reasons.map((r) => `"${r}"`).join(", ")}],
    "roi_reasons": [${scores.roi_reasons.map((r) => `"${r}"`).join(", ")}]
  },
  "propertyOverview": {
    "address": "...",
    "cv": ${cvNzd > 0 ? `"$${formatNZD(cvNzd)}"` : "null"},
    "landArea": "${merged.land_area_sqm != null ? `${merged.land_area_sqm}m²` : "null — check LINZ"}",
    "floorArea": "${merged.floor_area_sqm != null ? `${merged.floor_area_sqm}m²` : "null"}",
    "buildYear": "${merged.build_year ?? "null"}",
    "zone": "...", "listingPrice": null, "isOnMarket": false
  },
  "planning": {
    "zone": "...",
    "minLotSize": "Xm²",
    "potentialLots": ${lots.lots},
    "grossAreaSqm": ${lots.gross_area_sqm},
    "netAreaSqm": ${lots.net_area_sqm},
    "easementAreaSqm": ${lots.easement_area_sqm},
    "overlays": [{ "name": "...", "status": "clear|moderate|restricted", "detail": "..." }],
    "easements": ${easements.burdening.length > 0
      ? JSON.stringify(easements.burdening.map((e) => ({
          type: e.type,
          burden: e.burden,
          description: e.description,
          estimated_width_m: e.estimated_width_m,
          estimated_area_sqm: e.estimated_area_sqm,
          severity: e.severity,
        })))
      : "[]"},
    "appurtenant_easements": ${easements.appurtenant.length > 0
      ? JSON.stringify(easements.appurtenant.map((e) => ({ type: e.type, description: e.description })))
      : "[]"},
    "easement_data_status": "${easements.retrieval_status}",
    "easement_summary": ${JSON.stringify(easements.summary)},
    "lot_impact_note": ${JSON.stringify(easements.lot_impact_note ?? null)},
    "subdivisionSummary": "..."
  },
  "potential_lots": ${lots.lots},
  "zone_label": "${lots.zone_label}",
  "cv_unavailable": ${costs.cv_unavailable},
  "total_excludes_land": ${costs.cv_unavailable},
  "missing_critical_fields": ${JSON.stringify(missingCritical)},
  "data_sources": {
    "cv_nzd": ${cvSource ? `"${cvSource}"` : "null"},
    "land_area_sqm": ${landSource ? `"${landSource}"` : "null"},
    "floor_area_sqm": ${floorSource ? `"${floorSource}"` : "null"}
  },
  "asbestos": { "buildYear": "${merged.build_year ?? "null"}", "riskLevel": "${asbestos_detail.risk}", "risk": "${asbestos_detail.risk}", "flagged": ${asbestos_detail.risk === "high"}, "notes": "${asbestos_detail.notes}", "worksafe_required": ${asbestos_detail.risk === "high"}, "demoCostLow": ${costs.demo_low}, "demoCostHigh": ${costs.demo_high} },
  "terrain": {
    "classification": ${merged.contour ? `"${merged.contour}"` : "null"},
    "official_label": ${contourTxt ? `"${contourTxt}"` : "null"},
    "slope_degrees": ${contourSlope ?? "null"},
    "slope": ${merged.contour ? `"${contourTxt ? contourTxt : `~${contourSlope ?? "?"}° slope`} — ${merged.contour}"` : "null"},
    "source": ${contourSrc ? `"${contourSrc}"` : "null"},
    "retainingCostLow": ${costs.retaining_low},
    "retainingCostHigh": ${costs.retaining_high}
  },
  "infrastructure": [ { "name": "Wastewater|Stormwater|Water Supply", "location": "on-parcel|boundary|neighbour|public-land|unknown", "distance_metres": <number or null>, "estimatedCostLow": <NZD or null>, "estimatedCostHigh": <NZD or null>, "risk": "low|moderate|high", "note": "..." } ],
  "costItems": [
    ${cvNzd > 0 ? `{ "label": "Land (CV)", "low": ${cvNzd}, "high": ${cvNzd} },` : `{ "label": "Land (CV — unavailable)", "low": 0, "high": 0 },`}
    { "label": "Demolition", "low": ${costs.demo_low}, "high": ${costs.demo_high} },
    { "label": "Construction", "low": ${costs.construction_low}, "high": ${costs.construction_high} },
    { "label": "Retaining Walls", "low": ${costs.retaining_low}, "high": ${costs.retaining_high} },
    { "label": "Services & Infrastructure", "low": ${costs.services_low}, "high": ${costs.services_high} },
    { "label": "Consents & Professionals", "low": ${costs.consents_low}, "high": ${costs.consents_high} },
    { "label": "Finance (Holding)", "low": ${costs.finance_low}, "high": ${costs.finance_high} },
    { "label": "Contingency", "low": ${costs.contingency_low}, "high": ${costs.contingency_high} }
  ],
  "totalCostLow": ${costs.total_low},
  "totalCostHigh": ${costs.total_high},
  "cost_per_unit_avg": ${costs.cost_per_unit_avg},
  "interest_rate_outlook": "${interestOutlook}",
  "roiScenarios": [
${scenarios.map((s) => {
  const casesJson = (s.cases ?? []).map((c) =>
    `      { "case": "${c.case}", "label": "${c.label}", "gdv": ${c.gdv}, "gdv_multiplier": ${c.gdv_multiplier.toFixed(2)}, "gross_profit": ${c.gross_profit}, "roi_percent": ${c.roi_percent.toFixed(1)}, "annualised_roi_percent": ${c.annualised_roi_percent.toFixed(1)}, "viable": ${c.viable} }`
  ).join(",\n");
  return `    { "years": ${s.years}, "gdv": ${s.gdv}, "gdv_per_lot": ${s.gdv_per_lot}, "sqm_per_lot": ${s.sqm_per_lot}, "lots": ${s.lots}, "total_cost_mid": ${s.total_cost_mid}, "gross_profit": ${s.gross_profit}, "roi_percent": ${s.roi_percent.toFixed(1)}, "annualised_roi_percent": ${s.annualised_roi_percent.toFixed(1)}, "viable": ${s.viable}, "cv_unavailable": ${costs.cv_unavailable}, "cases": [\n${casesJson}\n    ] }`;
}).join(",\n")}
  ],
  "comparableSales": [<3 real recent comparable sales for this suburb: { "address": "...", "sale_date": "YYYY-MM-DD", "price_nzd": <NZD>, "land_sqm": <number>, "floor_sqm": <number>, "price_per_sqm": <NZD> }>],
  "comparables_quality": "${comparables_quality}",
  "avg_sale_price": ${scenarios[0]?.gdv_per_lot ?? Math.round(scenarios[0]?.gdv / Math.max(1, lots.lots))},
  "avgPricePerSqm": <NZD/m² based on comparables>,
  "riskSummary": ["specific risk/opportunity 1 for this exact property", "risk/opportunity 2", "risk/opportunity 3", "risk/opportunity 4", "risk/opportunity 5"],
  "disclaimer": "These are indicative estimates only. Always engage a quantity surveyor, lawyer, and urban planner before making any development decisions. Figures in NZD."
}
CRITICAL RULES:
- If cv_unavailable is true: set propertyOverview.cv to null, include a riskSummary note about CV being unavailable.
- If terrain.classification is null: terrain data was unavailable — keep it null, do not guess.
- Infrastructure location "unknown" means GIS data was unavailable — keep as "unknown", do not guess.
- Fill in ALL fields. Mark truly unknown fields as null (not empty string, not 0).
- Write riskSummary items as specific, developer-focused 1-sentence statements about THIS property.
- Return ONLY valid JSON, no markdown fences, no other text.`;
            } else {
              const dataSummary = {
                address: geocode?.formatted ?? extractedAddress,
                suburb,
                geocode: geocode ? { lat: geocode.lat, lng: geocode.lng } : null,
                merged_property: merged,
                contour,
                infrastructure: pipelineResult.infrastructure,
                linz: linz_parcel,
                property_history,
                asbestos,
                data_sources: merged?.data_sources ?? {},
                failed_sources: pipelineResult.failed_sources,
              };

              enrichedContent = `Analyse this NZ property for development feasibility. Real data has been fetched from Hougarden, OneRoof, LINZ, and Auckland Council GIS sources.${failedStr}

VERIFIED PROPERTY DATA:
${JSON.stringify(dataSummary, null, 2)}

CRITICAL: Land (CV) cost MUST be a realistic NZD estimate based on the suburb, zone, and land area — never use $0. Research current Auckland Council CV rates for the suburb.

Generate a complete FeasibilityReport JSON following your system instructions exactly. Use the fetched data as your primary source — prefer confirmed data over estimates. Where data is missing or a source failed, make reasonable NZ-market estimates and flag in riskSummary. Return ONLY valid JSON — no markdown code fences, no other text.`;
            }

            const rawContent = await generateAnalysis(enrichedContent);

            // Inject scraped fields + override ROI cases with computed values
            const photoUrl = pipelineResult.oneroof?.main_photo_url ?? null;
            const overlayMapB64 = pipelineResult.hougarden?.overlay_map_image_base64 ?? null;
            const computedScenarios = pipelineResult.scenarios ?? [];
            let content = rawContent;
            try {
              const parsed = extractJSON(rawContent) as Record<string, unknown>;
              if (parsed && typeof parsed === "object") {
                if (photoUrl) parsed.photoUrl = photoUrl;
                if (overlayMapB64) parsed.overlay_map_image_base64 = overlayMapB64;

                // Always override asbestos with pre-computed deterministic values.
                // Claude ignores the schema hints and applies its own (incorrect) heuristics,
                // e.g. flagging pre-1940 buildings as "high" risk when they predate widespread
                // asbestos use in NZ. The classifyAsbestos() function uses the correct thresholds
                // so we always inject its output here.
                if (asbestos_detail) {
                  parsed.asbestos = {
                    buildYear: merged?.build_year ?? null,
                    riskLevel: asbestos_detail.risk,
                    risk: asbestos_detail.risk,
                    flagged: asbestos_detail.risk === "high",
                    notes: asbestos_detail.notes,
                    worksafe_required: asbestos_detail.worksafe_required,
                    demoCostLow: costs.demo_low,
                    demoCostHigh: costs.demo_high,
                  };
                }

                // Always override roiScenarios cases with computed values so
                // Bear/Base/Bull are guaranteed distinct — the LLM sometimes
                // collapses all three to the same number.
                if (computedScenarios.length > 0) {
                  const computedByYears = new Map(computedScenarios.map((s) => [s.years, s]));
                  const roiArr = parsed.roiScenarios as any[] | undefined;
                  if (Array.isArray(roiArr)) {
                    parsed.roiScenarios = roiArr.map((s: any) => {
                      const computed = computedByYears.get(s.years as 2 | 3 | 4);
                      if (computed?.cases && computed.cases.length > 0) {
                        return { ...s, cases: computed.cases };
                      }
                      return s;
                    });
                  }
                }

                content = JSON.stringify(parsed);
              }
            } catch {
              // silent — keep original content
            }

            // Persist to search history (non-blocking, silent fail)
            const chatUserId = getUserIdFromHeader(req);
            if (chatUserId) {
              try {
                const parsedForSave = extractJSON(content);
                await db.insert(searches).values({
                  userId: chatUserId,
                  query: extractedAddress,
                  address: geocode?.formatted ?? extractedAddress,
                  resultJson: parsedForSave as any,
                });
                req.log.info({ address: extractedAddress }, "Chat analysis saved to history");
              } catch {
                // silent — don't interrupt the response
              }
            }

            sendAnalyseResponse({ content, mode: "analyse" });
            return;
          }
          // pipelineResult was null — generate AI-only response inside the heartbeat
          // context so we can use sendAnalyseResponse (avoids ERR_HTTP_HEADERS_SENT
          // if the heartbeat already committed the response headers).
          try {
            const { content: aiContent, mode: aiMode } = await generateUnifiedResponse(messages, currentReport, intent.mode);
            sendAnalyseResponse({ content: aiContent, mode: aiMode });
          } catch {
            sendAnalyseResponse({ error: "Failed to generate reply. Please try again.", code: "CHAT_FAILED" });
          }
          return;
        }

      }

      const { content, mode: responseMode } = await generateUnifiedResponse(messages, currentReport, intent.mode);

      // Safety net A: if the AI said "I'm searching..." but the discover pipeline didn't run,
      // extract the suburb from the AI's text and actually run the search now.
      const isSearchingPhrase = /\b(searching|i'm searching|i am searching|let me search|looking for properties|i'll search|i will search)\b/i.test(content);
      if (isSearchingPhrase && responseMode !== "discover") {
        // Try the user text first (most reliable), then scan the AI's response for a known suburb,
        // then try a last-resort phrase extraction from user text for unmapped suburbs.
        const { suburb: userSuburb, minPrice, maxPrice } = await parseDiscoverParams(userText);
        const aiHit = userSuburb == null ? await findSuburbInTextViaIndex(content) : null;
        const suburb = userSuburb ?? (aiHit ? aiHit.title.toLowerCase() : null);
        const includeNegotiation = /negotiat|without\s+price|no\s+price|poa|tender|auction/i.test(userText);

        if (suburb) {
          req.log.info({ suburb, aiContent: content.slice(0, 100) }, "AI said 'searching' — running actual discover pipeline");
          try {
            const cacheKey = makeCacheKey(suburb, minPrice, maxPrice);
            const shownUrls = getShownUrls(cacheKey);
            const searchResult = await searchRealEstateListings({
              suburb, minPrice, maxPrice, skipUrls: shownUrls, includeNegotiation,
            }).catch(() => null);

            if (searchResult && searchResult.firstBatch.length > 0) {
              const inRange = (l: { price: number | null }) =>
                l.price == null || (l.price >= minPrice && l.price <= maxPrice * 1.1);
              const firstFiltered = searchResult.firstBatch.filter(inRange);
              const remainingFiltered = searchResult.remainingListings.filter(inRange);
              setListingCache(cacheKey, {
                remainingListings: remainingFiltered,
                shownUrls: firstFiltered.map((l) => l.listingUrl),
                suburb, minPrice, maxPrice,
              });
              const candidates = await preScreenListingsFast(firstFiltered, 5).catch(() => []);
              if (candidates.length > 0) {
                queueBackgroundScores(
                  candidates.map((c) => ({ address: c.address, price: c.price, landArea: c.landArea, zone: c.zone })),
                );
                const aiIntro = content; // Use what the AI already said as the intro
                const payload = JSON.stringify({ candidates, isMockData: false, suburb, dataSource: "realestate.co.nz", noListings: false, aiIntro });
                res.json({ content: payload, mode: "discover" });
                return;
              }
            }
            // No results — use AI's text as the no-results message
            const noResultMsg = `${content.trim()} Unfortunately, I couldn't find any matching listings right now in ${suburb}. Try a different suburb or adjust your budget.`;
            res.json({ content: noResultMsg, mode: "text" });
            return;
          } catch (searchErr) {
            req.log.warn({ searchErr }, "Fallback discover search failed — using AI text response");
          }
        }
      }

      // Safety net B: catch any raw JSON the AI leaked and re-classify it properly
      if (responseMode !== "discover" && responseMode !== "analyse") {
        const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed && Array.isArray(parsed.candidates)) {
              // Leaked discover JSON — render as property cards
              res.json({ content: cleaned, mode: "discover" });
              return;
            }
            if (parsed && (parsed.reportId || (parsed.address && parsed.zoning) || parsed.propertyOverview)) {
              // Leaked feasibility report JSON — render as analyse report
              res.json({ content: JSON.stringify(parsed), mode: "analyse" });
              return;
            }
          } catch {
            const isLikelyBrokenJson = /^\s*\{[\s\S]{20,}/.test(cleaned);
            if (isLikelyBrokenJson) {
              res.json({ content: "I'm sorry, I couldn't generate that right now. Please try again.", mode: "text" });
              return;
            }
          }
        }
      }

      res.json({ content, mode: responseMode });
    } catch (error) {
      req.log.error({ error }, "Failed to generate unified chat reply");
      res.status(500).json({
        error: "Failed to generate reply. Please try again.",
        code: "CHAT_FAILED",
      });
    }
    return;
  }

  if (!message) {
    res.status(400).json({ error: "message is required", code: "MISSING_MESSAGE" });
    return;
  }

  try {
    const reply = await generateChatReply(
      message,
      conversationHistory || [],
      reportContext,
    );
    res.json({ message: reply, type: "chat" });
  } catch (error) {
    req.log.error({ error }, "Failed to generate chat reply");
    res.status(500).json({
      error: "Failed to generate reply. Please try again.",
      code: "CHAT_FAILED",
    });
  }
});

router.get("/pipeline-test", async (req, res) => {
  const address = (req.query["address"] as string) || "8 Hampton Drive St Heliers Auckland";

  req.log.info({ address }, "Pipeline test started");

  try {
    const pipelineResult = await runPropertyPipeline(address);

    const debug = {
      address_input: pipelineResult.address_input,
      geocode: pipelineResult.geocode,
      failed_sources: pipelineResult.failed_sources,
      timing_ms: pipelineResult.timing_ms,
      raw_linz_parcel: {
        parcel_id: pipelineResult.linz_parcel?.parcel_id,
        area_sqm: pipelineResult.linz_parcel?.area_sqm,
        title_no: pipelineResult.linz_parcel?.title_no,
      },
      raw_hougarden: {
        cv_nzd: pipelineResult.hougarden?.cv_nzd,
        land_area_sqm: pipelineResult.hougarden?.land_area_sqm,
        floor_area_sqm: pipelineResult.hougarden?.floor_area_sqm,
        build_year: pipelineResult.hougarden?.build_year,
        zone_code: pipelineResult.hougarden?.zone_code,
      },
      raw_oneroof: {
        found: pipelineResult.oneroof?.found,
        cv_nzd: pipelineResult.oneroof?.cv_nzd,
        land_area_sqm: pipelineResult.oneroof?.land_area_sqm,
        floor_area_sqm: pipelineResult.oneroof?.floor_area_sqm,
        build_year: pipelineResult.oneroof?.build_year,
        last_sale_price: pipelineResult.oneroof?.last_sale_price,
      },
      raw_contour: pipelineResult.contour,
      merged_final: {
        cv_nzd: pipelineResult.merged?.cv_nzd,
        land_area_sqm: pipelineResult.merged?.land_area_sqm,
        floor_area_sqm: pipelineResult.merged?.floor_area_sqm,
        zone_code: pipelineResult.merged?.zone_code,
        contour: pipelineResult.merged?.contour,
        contour_slope_degrees: pipelineResult.merged?.contour_slope_degrees,
        contour_source: pipelineResult.merged?.contour_source,
        data_sources: pipelineResult.merged?.data_sources,
        missing_critical_fields: pipelineResult.merged?.missing_critical_fields,
      },
      infrastructure: pipelineResult.infrastructure,
      costs_summary: {
        land_cv_nzd: pipelineResult.costs?.land_cv_nzd,
        cv_unavailable: pipelineResult.costs?.cv_unavailable,
        total_low: pipelineResult.costs?.total_low,
        total_high: pipelineResult.costs?.total_high,
        retaining_unknown: pipelineResult.costs?.retaining_unknown,
      },
      roi_first_scenario: pipelineResult.scenarios[0],
    };

    req.log.info(debug, "Pipeline test result");
    res.json(debug);
  } catch (err) {
    req.log.error({ err }, "Pipeline test failed");
    res.status(500).json({ error: String(err) });
  }
});

router.get("/analyse/card-scores", async (req, res) => {
  const raw = req.query.addresses;
  const addresses: string[] = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === "string"
      ? [raw]
      : [];

  if (addresses.length === 0) {
    res.json([]);
    return;
  }

  const results = getCardScores(addresses);
  res.json(results);
});

export default router;
