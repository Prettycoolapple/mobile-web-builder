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
  Message,
} from "../lib/claude";
import { verifyToken } from "../lib/auth";
import { extractNZAddress } from "../lib/address-parser";
import { runPropertyPipeline } from "../lib/pipeline";
import { formatNZD } from "../lib/utils";
import { searchRealEstateListings } from "../lib/scrapers/realestate-search";
import { preScreenListingsFast } from "../lib/pre-screen";
import {
  makeCacheKey,
  setListingCache,
  popNextListings,
  markShown,
  getShownUrls,
} from "../lib/listing-cache";

const router = Router();

const FREE_REPORT_LIMIT = 3;

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

function parseDiscoverParams(text: string): { suburb: string | null; minPrice: number; maxPrice: number } {
  const lower = text.toLowerCase();

  const SUBURBS = [
    "remuera", "epsom", "mt eden", "mt. eden", "grey lynn", "ponsonby", "parnell",
    "sandringham", "onehunga", "new lynn", "titirangi", "herne bay", "westmere",
    "kingsland", "mt albert", "mt roskill", "avondale", "henderson", "botany",
    "howick", "pakuranga", "manukau", "papakura", "pukekohe", "albany",
    "takapuna", "devonport", "northcote", "glenfield", "milford", "browns bay",
    "east tamaki", "mangere", "otahuhu", "penrose", "ellerslie", "glen innes",
    "st heliers", "saint heliers", "kohimarama", "mission bay", "st johns", "saint johns", "glendowie",
    "meadowbank", "birkenhead", "massey", "royal oak", "mt wellington", "manurewa",
    "papatoetoe", "glen eden", "panmure",
  ];

  let suburb: string | null = null;
  for (const s of SUBURBS) {
    if (lower.includes(s)) {
      suburb = s.replace(/\./g, "").replace(/\s+/g, " ").replace("saint ", "st ").trim();
      break;
    }
  }

  // Fuzzy match: extract the location phrase after "in/around/near/at/about" and try each suburb
  if (!suburb) {
    const locationPhrase = lower.match(/\b(?:in|around|near|at|about\s+in|about)\s+([\w\s]+?)(?:\s+under|\s+below|\s+above|\s+around|\s+price|\s+budget|\?|$)/i)?.[1]?.trim();
    if (locationPhrase && locationPhrase.length >= 3) {
      // Exact substring match first
      const exactMatch = SUBURBS.find((s) => locationPhrase.includes(s) || s.includes(locationPhrase));
      if (exactMatch) {
        suburb = exactMatch.replace(/\./g, "").replace(/\s+/g, " ").replace("saint ", "st ").trim();
      } else {
        // Fuzzy match: allow up to 2 character edits for multi-word suburbs
        let bestMatch: string | null = null;
        let bestDist = 3; // max allowed distance
        for (const s of SUBURBS) {
          const dist = editDistance(locationPhrase.replace(/\s+/g, ""), s.replace(/\s+/g, ""));
          if (dist < bestDist) {
            bestDist = dist;
            bestMatch = s;
          }
        }
        if (bestMatch) {
          suburb = bestMatch.replace(/\./g, "").replace(/\s+/g, " ").replace("saint ", "st ").trim();
        }
      }
    }
  }

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

      if (profile.subscriptionTier === "free" && usedCount >= FREE_REPORT_LIMIT) {
        res.status(402).json({
          error: `You've used all ${FREE_REPORT_LIMIT} free reports this month. Upgrade to Pro for unlimited reports.`,
          code: "LIMIT_REACHED",
          reportsUsed: usedCount,
          limit: FREE_REPORT_LIMIT,
        });
        return;
      }
    }
  }

  try {
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

router.post("/chat", async (req, res) => {
  const { messages, currentReport, message, conversationHistory, reportContext } = req.body as {
    messages?: Message[];
    currentReport?: object;
    message?: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    reportContext?: string;
  };

  if (messages && messages.length > 0) {
    try {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      const userText = lastUserMessage?.content ?? "";
      const mode = detectMode(userText);

      if (mode === "discover") {
        try {
          const { suburb: parsedSuburb, minPrice, maxPrice } = parseDiscoverParams(userText);

          const isFollowUpKeyword = /any\s+(others?|more)|show\s+(me\s+)?more|more\s+(properties|options|results|sites)|what\s+else|other\s+properties|more\s+results|others?\s+like|more\s+like|anything\s+else|few\s+more|find\s+more|keep\s+looking|another\s+one|more\s+sites|other\s+options/i.test(userText);
          // Also treat "what about [suburb]", "how about [suburb]", etc. as context-inheriting
          const isLocationSwitch = !parsedSuburb && /^(ok|okay|and|what|how|try|check|how\s+about|what\s+about)\b/i.test(userText.trim());
          const isFollowUp = !parsedSuburb && (isFollowUpKeyword || isLocationSwitch);
          const userTextHasPrice = /\$|\bunder\b|\babove\b|\bbelow\b|\bbetween\b|\brange\b|\b\d+[mk]\b/i.test(userText);
          const includeNegotiation = /negotiat|without\s+price|no\s+price|price\s+on\s+applic|poa|by\s+applic|tender|auction/i.test(userText);

          let suburb = parsedSuburb;
          let effectiveMinPrice = minPrice;
          let effectiveMaxPrice = maxPrice;
          let alreadyShownAddresses: string[] = [];

          // When suburb isn't found from the current message, always look back in history
          // (covers follow-ups, typos, and conversational switches like "what about in [suburb]")
          if (!suburb) {
            const history = [...messages].reverse();
            for (const msg of history) {
              if (msg.role === "assistant") {
                const searchResultsMatch = /\[Search results shown: ([^\]]+)\]/.exec(msg.content ?? "");
                if (searchResultsMatch && isFollowUp) {
                  alreadyShownAddresses = searchResultsMatch[1].split(";").map((a) => a.trim()).filter(Boolean);
                }
              }
              if (msg.role === "user" && !suburb) {
                const { suburb: prevSuburb, minPrice: prevMin, maxPrice: prevMax } = parseDiscoverParams(msg.content ?? "");
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

          req.log.info({ suburb, effectiveMinPrice, effectiveMaxPrice, isFollowUp, includeNegotiation }, "Discovery search started");

          let candidates: import("../lib/pre-screen").PropertyCandidate[] = [];
          let isMockData = false;
          let dataSource = "realestate.co.nz";
          let prescreenedIntro = "";

          if (suburb) {
            const cacheKey = makeCacheKey(suburb, effectiveMinPrice, effectiveMaxPrice);

            if (isFollowUp) {
              let attempts = 0;
              while (candidates.length === 0 && attempts < 3) {
                const { listings: nextListings, remaining } = popNextListings(cacheKey, 8);
                if (nextListings.length === 0) break;
                req.log.info({ nextListings: nextListings.length, remaining, attempt: attempts + 1 }, "Follow-up: popping next listings from cache");
                markShown(cacheKey, nextListings.map((l) => l.listingUrl));
                candidates = await preScreenListingsFast(nextListings, 5).catch(() => []);
                attempts++;
              }
            }

            if (candidates.length === 0 && !isFollowUp) {
              const shownUrls = getShownUrls(cacheKey);
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
                const introPromptPreScreen = `The user asked: "${userText}". You found ${firstFiltered.length} matching propert${firstFiltered.length === 1 ? "y" : "ies"} in ${suburb || "the area"} on realestate.co.nz. In 1 sentence, acknowledge this result conversationally (e.g. "I found a few options in St Heliers matching your criteria:"). Be natural and brief — no JSON.`;
                const [screened, introFromPreScreen] = await Promise.all([
                  preScreenListingsFast(firstFiltered, 5).catch(() => []),
                  generateAnalysis(introPromptPreScreen).catch(() => ""),
                ]);
                candidates = screened;
                prescreenedIntro = introFromPreScreen;
              }
            }
          }

          const noListings = candidates.length === 0;

          // Use pre-computed intro if available, otherwise generate one now for the no-results case
          let aiIntro = (!noListings && prescreenedIntro) ? prescreenedIntro : "";
          if (!aiIntro) {
            try {
              const introPrompt = noListings
                ? `The user asked: "${userText}". No matching listings were found on realestate.co.nz right now for ${suburb || "this area"}. In 1-2 sentences, acknowledge this warmly and suggest they try a different suburb, adjust their budget, or check back soon. Do NOT output any JSON.`
                : `The user asked: "${userText}". You found ${candidates.length} matching propert${candidates.length === 1 ? "y" : "ies"} in ${suburb || "the area"} on realestate.co.nz. In 1 sentence, acknowledge the results conversationally. Be natural and brief — no JSON.`;
              aiIntro = await generateAnalysis(introPrompt).catch(() => "");
            } catch { /* silent */ }
          }

          const responsePayload = JSON.stringify({ candidates, isMockData, suburb, dataSource, noListings, aiIntro });
          res.json({ content: responsePayload, mode: "discover" });
          return;
        } catch (err) {
          req.log.warn({ err }, "Discovery mode error — falling through to AI");
        }
      }

      if (mode === "analyse") {
        // Try to get the address from the current message; if not found, look back in history.
        // This handles follow-ups like "just analyze the property" / "analyze it" where the
        // address was mentioned in an earlier message.
        let extractedAddress = await extractNZAddress(userText).catch(() => null);

        if (!extractedAddress) {
          for (const msg of [...messages].reverse()) {
            if (msg.role === "user" && msg.content !== userText) {
              const prev = await extractNZAddress(msg.content).catch(() => null);
              if (prev) { extractedAddress = prev; break; }
            }
          }
        }

        const aiResponseEarly = null;
        void aiResponseEarly;

        if (extractedAddress) {
          req.log.info({ address: extractedAddress }, "Running property pipeline for analyse mode");

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
              scenarios, scores, suburb,
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
  "planning": { "zone": "...", "minLotSize": "Xm²", "potentialLots": ${lots.lots}, "overlays": [{ "name": "...", "status": "clear|moderate|restricted", "detail": "..." }], "subdivisionSummary": "..." },
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

            const content = await generateAnalysis(enrichedContent);

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

            res.json({ content, mode: "analyse" });
            return;
          }
        }

      }

      const { content, mode: responseMode } = await generateUnifiedResponse(messages, currentReport);

      // Safety net A: if the AI said "I'm searching..." but the discover pipeline didn't run,
      // extract the suburb from the AI's text and actually run the search now.
      const isSearchingPhrase = /\b(searching|i'm searching|i am searching|let me search|looking for properties|i'll search|i will search)\b/i.test(content);
      if (isSearchingPhrase && responseMode !== "discover") {
        // Try to extract suburb from the AI's response (it often names the suburb)
        const aiSuburbMatch = content.match(/\b(?:in|for)\s+([\w\s]+?)(?:\s+matching|\s+that|\s+on|\s+currently|\s+now|[.,!?]|$)/i);
        const aiSuburb = aiSuburbMatch?.[1]?.trim().toLowerCase();
        // Also try the user text  
        const { suburb: userSuburb, minPrice, maxPrice } = parseDiscoverParams(userText);
        const suburb = userSuburb || (aiSuburb && aiSuburb.length > 3 ? aiSuburb : null);
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

export default router;
