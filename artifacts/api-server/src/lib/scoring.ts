import type { MergedPropertyData } from "./scrapers/merge";
import type { CostBreakdown } from "./cost-estimator";
import type { ROIScenario } from "./roi-calculator";
import { roundToHalf } from "./utils";
import { builtEnvironmentScoreAdjustment, type BuiltEnvironmentContext } from "./built-environment-context";
import {
  DWELLING_CONDITION_COST_REASON,
  dwellingConditionCostPenalty,
  type DwellingConditionAssessment,
} from "./dwelling-condition";

export interface ScoringResult {
  ease: number;
  cost: number;
  roi: number;
  composite: number;
  ease_reasons: string[];
  cost_reasons: string[];
  roi_reasons: string[];
}

function hasOverlay(merged: MergedPropertyData, keyword: string): boolean {
  const kw = keyword.toLowerCase();
  return merged.overlays.some(
    (o) =>
      o.name.toLowerCase().includes(kw) &&
      (o.status === "restricted" || o.status === "moderate"),
  );
}

function hasNeighbourInfrastructure(merged: MergedPropertyData): boolean {
  return (merged.infrastructure ?? []).some((i) => i.location === "neighbour");
}

function clampScore(score: number): number {
  return Math.min(5, Math.max(0.5, score));
}

function bestRoiScenario(scenarios: ROIScenario[]): ROIScenario | null {
  if (scenarios.length === 0) return null;
  return scenarios.reduce((best, scenario) =>
    scenario.roi_percent > best.roi_percent ? scenario : best,
  );
}

function scoreCostPosition(costs: CostBreakdown, scenarios: ROIScenario[]): { score: number; reasons: string[] } {
  const scenario = bestRoiScenario(scenarios);

  if (!scenario || !Number.isFinite(scenario.gdv) || !Number.isFinite(scenario.total_cost_mid) || scenario.gdv <= 0 || scenario.total_cost_mid <= 0) {
    const landValue = Number(costs.land_cv_nzd);
    const totalMid = (Number(costs.total_low) + Number(costs.total_high)) / 2;
    if (Number.isFinite(landValue) && landValue > 0 && Number.isFinite(totalMid) && totalMid > 0) {
      const valueCover = landValue / totalMid;
      const score = roundToHalf(clampScore(2.5 + (valueCover - 0.75) * 4));
      return {
        score,
        reasons: [
          score >= 4
            ? "Cost position looks attractive relative to the current property value"
            : score >= 2.5
              ? "Cost position appears workable relative to the current property value"
              : "Cost position is tight relative to the current property value",
          "Cost rating uses relative value pressure, not a fixed per-unit threshold",
        ],
      };
    }

    return {
      score: 2.5,
      reasons: [
        "Cost position needs market validation against real exit evidence",
        "Cost rating uses relative value pressure, not a fixed per-unit threshold",
      ],
    };
  }

  const valueCover = scenario.gdv / scenario.total_cost_mid;
  const capitalPressure = scenario.total_cost_mid / scenario.gdv;

  let rawScore: number;
  if (valueCover < 0.90) {
    // Hard-cap below 1.5 — value cover too weak
    rawScore = 1.0 + (valueCover - 0.90) * 5;
  } else if (valueCover < 1.07) {
    // 2.0 at vc=0.90 → 3.0 at vc=1.07
    rawScore = 2.0 + ((valueCover - 0.90) / 0.17);
  } else if (valueCover < 1.29) {
    // 3.0 at vc=1.07 → 4.5 at vc=1.29
    rawScore = 3.0 + ((valueCover - 1.07) / 0.22) * 1.5;
  } else {
    // ≥ 4.5 at vc=1.29, continues upward
    rawScore = 4.5 + (valueCover - 1.29) * 5;
  }
  const score = roundToHalf(clampScore(rawScore));

  const primary =
    score >= 4
      ? "Cost position looks efficient relative to the estimated end value"
      : score >= 2.5
        ? "Cost position appears workable relative to the estimated end value"
        : "Cost position is tight relative to the estimated end value";
  const secondary =
    capitalPressure <= 0.8
      ? "Modelled value gives a useful buffer over acquisition and delivery costs"
      : capitalPressure <= 1
        ? "Modelled value only modestly covers acquisition and delivery costs"
        : "Modelled value does not cover acquisition and delivery costs";

  return { score, reasons: [primary, secondary] };
}

export function scoreProperty(
  merged: MergedPropertyData,
  costs: CostBreakdown,
  scenarios: ROIScenario[],
  lots: number,
  builtEnvironmentContext?: BuiltEnvironmentContext | null,
  dwellingCondition?: DwellingConditionAssessment | null,
): ScoringResult {
  const estateType = (merged.estate_type ?? "").trim();
  const isCrossLeaseTenure = /cross\s*lease|stratum/i.test(estateType);
  const isFreeholdTenure = /free\s*hold|fee\s*simple/i.test(estateType);
  const isLeaseholdTenure =
    /lease(hold)?\b/i.test(estateType) && !isCrossLeaseTenure && !isFreeholdTenure;
  const hasUnverifiedTitleConfidence = merged.titleConfidence != null && merged.titleConfidence !== "verified";
  const hasUnknownTypology = merged.typology === "unknown" || merged.typologyConfidence === "unknown";

  const easeDeductions: Array<{ condition: boolean; points: number; reason: string }> = [
    {
      condition: isCrossLeaseTenure,
      points: 1.5,
      reason: "Cross-lease title — co-owner consent constrains development",
    },
    {
      condition: isLeaseholdTenure,
      points: 1.0,
      reason: "Leasehold title — limited development rights vs freehold",
    },
    {
      condition: hasUnverifiedTitleConfidence,
      points: 0.5,
      reason: "Title verification incomplete - confirm tenure before committing to development",
    },
    {
      condition: hasUnknownTypology,
      points: 0.5,
      reason: "Dwelling typology not fully confirmed - verify this is not a unit, cross-lease, or apartment",
    },
    {
      condition: merged.zone_code === "SHZ",
      points: 1.5,
      reason: "Single House Zone — subdivision heavily restricted",
    },
    {
      condition: merged.zone_code === "LSZ" || merged.zone_code === "RUR" || merged.zone_code === "LLRZ" || merged.zone_code === "CLZ",
      points: 2.0,
      reason: "Large Lot / Countryside / Rural zone - development very limited",
    },
    {
      condition: hasOverlay(merged, "heritage"),
      points: 1.5,
      reason: "Heritage overlay — demolition may require resource consent",
    },
    {
      condition: hasOverlay(merged, "flood"),
      points: 1.2,
      reason: "Flood overlay — engineering and consent complexity",
    },
    {
      condition: hasOverlay(merged, "tree"),
      points: 0.5,
      reason: "Notable tree overlay — design constraints apply",
    },
    {
      condition: hasOverlay(merged, "viewshaft") || hasOverlay(merged, "volcanic"),
      points: 0.5,
      reason: "Volcanic viewshaft — height restrictions apply",
    },
    {
      condition: hasOverlay(merged, "coastal"),
      points: 0.8,
      reason: "Coastal protection overlay — additional consenting required",
    },
    {
      condition: hasOverlay(merged, "mana whenua"),
      points: 1.2,
      reason: "Site of Significance to Mana Whenua — cultural assessment, iwi engagement and accidental-discovery protocols required",
    },
    {
      condition: hasOverlay(merged, "ecological"),
      points: 1.5,
      reason: "Significant Ecological Area — vegetation clearance and earthworks tightly restricted; developable area may be reduced",
    },
    {
      condition: hasOverlay(merged, "special character"),
      points: 1.5,
      reason: "Special Character Area — strict demolition and design controls; redevelopment significantly constrained",
    },
    {
      condition: hasOverlay(merged, "outstanding natural"),
      points: 1.2,
      reason: "Outstanding Natural Feature/Landscape/Character — building location, bulk and earthworks heavily controlled",
    },
    {
      condition: hasOverlay(merged, "wetland"),
      points: 1.2,
      reason: "Wetland Management Area — NES-Freshwater setbacks and consent likely; reduces usable yield",
    },
    {
      condition: hasOverlay(merged, "stream"),
      points: 0.8,
      reason: "Stream Management Area — riparian setbacks and stream-works controls apply",
    },
    {
      condition: hasOverlay(merged, "aquifer") || hasOverlay(merged, "lake") || hasOverlay(merged, "water supply"),
      points: 0.5,
      reason: "Water/aquifer management area — groundwater and discharge controls apply",
    },
    {
      condition: hasOverlay(merged, "high natural character"),
      points: 0.6,
      reason: "High Natural Character Overlay — coastal development controls apply",
    },
    {
      condition: hasOverlay(merged, "public view"),
      points: 0.4,
      reason: "Local Public Views Overlay — height and location controls to protect an identified view",
    },
    {
      condition: merged.contour === "very_steep",
      points: 1.1,
      reason: "Very steep terrain - severe earthworks and geotechnical complexity",
    },
    {
      condition: merged.contour === "steep",
      points: 0.8,
      reason: "Steep terrain — significant earthworks required",
    },
    {
      condition: merged.contour === "moderate",
      points: 0.4,
      reason: "Moderate slope — some retaining wall work expected",
    },
    {
      condition: merged.asbestos_risk === "high",
      points: 0.4,
      reason: "Probable asbestos — specialist demolition required",
    },
    {
      condition: hasNeighbourInfrastructure(merged),
      points: 0.4,
      reason: "Service infrastructure on neighbouring land — easement needed",
    },
    {
      condition: merged.veolia_service_zone?.inServiceZone === true,
      points: 0.8,
      reason: "Within the Veolia (Papakura) private water network — connection approval sits with Veolia, growth/mains-extension charges can be high and unpredictable, and a resource consent does not guarantee servicing; confirm capacity and charges with Veolia/Watercare before committing design spend",
    },
    {
      condition: lots <= 1,
      points: 0.5,
      reason: "Land area limits subdivision to single dwelling",
    },
  ];

  const ease_reasons: string[] = [];
  let easeDeducted = 0;
  for (const d of easeDeductions) {
    if (d.condition) {
      easeDeducted += d.points;
      ease_reasons.push(d.reason);
    }
  }
  const ease = roundToHalf(Math.max(0.5, 5.0 - easeDeducted));

  const costPosition = scoreCostPosition(costs, scenarios);
  const conditionPenalty = dwellingConditionCostPenalty(dwellingCondition, lots);
  const cost = roundToHalf(clampScore(costPosition.score - conditionPenalty));
  const cost_reasons = conditionPenalty > 0
    ? [...costPosition.reasons, DWELLING_CONDITION_COST_REASON]
    : costPosition.reasons;

  if (scenarios.length === 0) {
    const roi = 0.5;
    const roi_reasons = [
      "ROI unavailable — no real fetched comparable sales were available",
      "Sale price assumptions were not estimated from synthetic comparables",
    ];
    const adjustment = builtEnvironmentScoreAdjustment(builtEnvironmentContext);
    if (adjustment.reason) roi_reasons.push(adjustment.reason);
    const adjustedRoi = roundToHalf(clampScore(roi + adjustment.roiDelta));
    const composite = parseFloat(((ease * 0.3) + (cost * 0.3) + (adjustedRoi * 0.4)).toFixed(1));
    return { ease, cost, roi: adjustedRoi, composite, ease_reasons, cost_reasons, roi_reasons };
  }

  const bestScenario = bestRoiScenario(scenarios)!;

  const roiBrackets = [
    { min: 35,        score: 5.0, reason: "Exceptional return — strong development opportunity" },
    { min: 25,        score: 4.0, reason: "Strong return — well above typical NZ threshold" },
    { min: 15,        score: 3.0, reason: "Solid return — meets typical developer hurdle rate" },
    { min: 8,         score: 2.0, reason: "Marginal return — viable but sensitive to cost overruns" },
    { min: 0,         score: 1.0, reason: "Low return — high risk of negative outcome" },
    { min: -Infinity, score: 0.5, reason: "Negative return — not viable at current market values" },
  ];

  const roiBracket = roiBrackets.find((b) => bestScenario.roi_percent >= b.min) ?? roiBrackets[roiBrackets.length - 1];
  let roi = roiBracket.score;
  const roi_reasons = [
    roiBracket.reason,
    `Best case: ~${bestScenario.roi_percent.toFixed(0)}% ROI over ~${bestScenario.years} years`,
  ];
  if (lots >= 5) {
    roi = Math.max(0.5, roi - 0.5);
    roi_reasons.push(
      "High lot count — long construction and phased sales typically stretch capital recovery; headline ROI is a full-project figure, not short-cycle annualised performance.",
    );
  } else if (lots >= 4) {
    roi = Math.max(0.5, roi - 0.35);
    roi_reasons.push(
      "Several potential lots increase programme length and absorption exposure versus a single-dwelling flip.",
    );
  }

  const adjustment = builtEnvironmentScoreAdjustment(builtEnvironmentContext);
  if (adjustment.reason) roi_reasons.push(adjustment.reason);
  roi = roundToHalf(clampScore(roi + adjustment.roiDelta));

  const composite = parseFloat(((ease * 0.3) + (cost * 0.3) + (roi * 0.4)).toFixed(1));

  return { ease, cost, roi, composite, ease_reasons, cost_reasons, roi_reasons };
}
