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
import { searchOneRoofListings } from "../lib/scrapers/oneroof";
import { preScreenListings } from "../lib/pre-screen";
import { getMockListings } from "../lib/mock-data";

const router = Router();

const FREE_REPORT_LIMIT = 3;

function extractJSON(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error("No JSON found in response");
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
    "st heliers", "kohimarama", "mission bay", "st johns", "glendowie",
  ];

  let suburb: string | null = null;
  for (const s of SUBURBS) {
    if (lower.includes(s)) {
      suburb = s.replace(/\./g, "").replace(/\s+/g, " ").trim();
      break;
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
          const { suburb, minPrice, maxPrice } = parseDiscoverParams(userText);
          req.log.info({ suburb, minPrice, maxPrice }, "Discovery search started");

          let candidates: import("../lib/pre-screen").PropertyCandidate[] = [];
          let isMockData = false;

          if (suburb) {
            const listings = await searchOneRoofListings({ suburb, price_min: minPrice, price_max: maxPrice })
              .catch((err) => { req.log.warn({ err }, "OneRoof search failed"); return []; });

            if (listings.length > 0) {
              candidates = await preScreenListings(listings, 3).catch((err) => {
                req.log.warn({ err }, "Pre-screening failed");
                return [];
              });
            }
          }

          if (candidates.length === 0) {
            isMockData = true;
            candidates = getMockListings(suburb ?? undefined);
            req.log.info({ suburb, count: candidates.length }, "Discovery: using mock data fallback");
          }

          const responsePayload = JSON.stringify({ candidates, isMockData });
          res.json({ content: responsePayload, mode: "discover" });
          return;
        } catch (err) {
          req.log.warn({ err }, "Discovery mode error — falling through to AI");
        }
      }

      if (mode === "analyse") {
        const [extractedAddress, aiResponseEarly] = await Promise.all([
          extractNZAddress(userText).catch(() => null),
          Promise.resolve(null),
        ]);

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
              const scenarioLines = scenarios.map(
                (s) =>
                  `  ${s.years}-year: GDV $${formatNZD(s.gdv)}, Cost $${formatNZD(s.total_cost_mid)}, ` +
                  `Profit $${formatNZD(s.gross_profit)}, ROI ${s.roi_percent.toFixed(1)}%`,
              ).join("\n");

              const cvNzd = costs.land_cv_nzd;
              const cvNote = cvNzd > 0
                ? `$${formatNZD(cvNzd)} (confirmed from ${(merged as any).data_sources?.cv || "Hougarden/OneRoof"})`
                : `NOT AVAILABLE from scrapers — you MUST estimate a realistic CV for ${geocode?.formatted ?? extractedAddress} in ${suburb} based on the zone (${merged.zone_code ?? "unknown"}), land area (${(merged as any).land_sqm ?? "?"}m²), and current Auckland Council CV rates. Do NOT use $0. Research typical CV values for this suburb and property type — for Remuera/inner eastern suburbs THAB/MHU properties, CVs are typically $1.5M–$3M+ NZD.`;

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

  Total development cost (INCLUDES land if CV available):
    Low:  $${formatNZD(costs.total_low)}
    High: $${formatNZD(costs.total_high)}
  Cost per unit (avg): $${formatNZD(costs.cost_per_unit_avg)}

  ROI Scenarios:
${scenarioLines}

  Comparables quality: ${comparables_quality}
  Avg comparable sale: $${formatNZD(scenarios[0]?.gdv / Math.max(1, lots.lots))}

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
  "propertyOverview": { "address": "...", "cv": "${cvNzd > 0 ? `$${formatNZD(cvNzd)}` : "estimate based on suburb/zone/land area — do NOT use $0"}", "landArea": "Xm²", "floorArea": "...", "buildYear": "...", "zone": "...", "listingPrice": null, "isOnMarket": false },
  "planning": { "zone": "...", "minLotSize": "Xm²", "potentialLots": ${lots.lots}, "overlays": [{ "name": "...", "status": "clear|moderate|restricted", "detail": "..." }], "subdivisionSummary": "..." },
  "potential_lots": ${lots.lots},
  "zone_label": "${lots.zone_label}",
  "asbestos": { "buildYear": "year or null", "riskLevel": "${asbestos_detail.risk}", "risk": "${asbestos_detail.risk}", "flagged": ${asbestos_detail.risk === "high"}, "notes": "${asbestos_detail.notes}", "worksafe_required": ${asbestos_detail.risk === "high"}, "demoCostLow": ${costs.demo_low}, "demoCostHigh": ${costs.demo_high} },
  "terrain": { "classification": "flat|gentle|moderate|steep", "slope": "...", "retainingCostLow": ${costs.retaining_low}, "retainingCostHigh": ${costs.retaining_high} },
  "infrastructure": [ { "name": "Wastewater|Stormwater|Water Supply", "location": "on-parcel|boundary|neighbour|public-land", "distance_metres": <number or null>, "estimatedCostLow": <NZD>, "estimatedCostHigh": <NZD>, "risk": "low|moderate|high", "note": "..." } ],
  "costItems": [
    { "label": "Land (CV)", "low": ${cvNzd > 0 ? cvNzd : "ESTIMATE_REALISTIC_NZD — must not be 0"}, "high": ${cvNzd > 0 ? cvNzd : "ESTIMATE_REALISTIC_NZD — must not be 0"} },
    { "label": "Demolition", "low": ${costs.demo_low}, "high": ${costs.demo_high} },
    { "label": "Construction", "low": ${costs.construction_low}, "high": ${costs.construction_high} },
    { "label": "Retaining Walls", "low": ${costs.retaining_low}, "high": ${costs.retaining_high} },
    { "label": "Services & Infrastructure", "low": ${costs.services_low}, "high": ${costs.services_high} },
    { "label": "Consents & Professionals", "low": ${costs.consents_low}, "high": ${costs.consents_high} },
    { "label": "Finance (Holding)", "low": ${costs.finance_low}, "high": ${costs.finance_high} },
    { "label": "Contingency", "low": ${costs.contingency_low}, "high": ${costs.contingency_high} }
  ],
  "totalCostLow": ${costs.total_low > 0 ? costs.total_low : "recalculate including your estimated land CV"},
  "totalCostHigh": ${costs.total_high > 0 ? costs.total_high : "recalculate including your estimated land CV"},
  "cost_per_unit_avg": ${costs.cost_per_unit_avg},
  "roiScenarios": [
${scenarios.map((s) => `    { "years": ${s.years}, "gdv": ${s.gdv}, "total_cost_mid": ${s.total_cost_mid}, "gross_profit": ${s.gross_profit}, "roi_percent": ${s.roi_percent.toFixed(1)}, "annualised_roi_percent": ${s.annualised_roi_percent.toFixed(1)}, "viable": ${s.viable} }`).join(",\n")}
  ],
  "comparableSales": [<3 real recent comparable sales for this suburb: { "address": "...", "sale_date": "YYYY-MM-DD", "price_nzd": <NZD>, "land_sqm": <number>, "floor_sqm": <number>, "price_per_sqm": <NZD> }>],
  "comparables_quality": "${comparables_quality}",
  "avg_sale_price": ${Math.round(scenarios[0]?.gdv / Math.max(1, lots.lots))},
  "avgPricePerSqm": <NZD/m² based on comparables>,
  "riskSummary": ["specific risk/opportunity 1 for this exact property", "risk/opportunity 2", "risk/opportunity 3", "risk/opportunity 4", "risk/opportunity 5"],
  "disclaimer": "These are indicative estimates only. Always engage a quantity surveyor, lawyer, and urban planner before making any development decisions. Figures in NZD."
}
CRITICAL RULES:
- Land (CV) MUST be a realistic NZD number — never 0. If not confirmed, estimate from suburb/zone knowledge.
- Fill in ALL fields. Do not leave any blank. Mark truly unknown fields as null.
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
            res.json({ content, mode: "analyse" });
            return;
          }
        }

        void aiResponseEarly;
      }

      const { content, mode: responseMode } = await generateUnifiedResponse(messages, currentReport);
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

export default router;
