import type { MergedPropertyData } from "./scrapers/merge";
import type { CostBreakdown } from "./cost-estimator";
import type { ROIScenario } from "./roi-calculator";
import { formatNZD, roundToHalf } from "./utils";

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

export function scoreProperty(
  merged: MergedPropertyData,
  costs: CostBreakdown,
  scenarios: ROIScenario[],
  lots: number,
): ScoringResult {
  const easeDeductions: Array<{ condition: boolean; points: number; reason: string }> = [
    {
      condition: merged.zone_code === "SHZ",
      points: 1.5,
      reason: "Single House Zone — subdivision heavily restricted",
    },
    {
      condition: merged.zone_code === "LSZ" || merged.zone_code === "RUR" || merged.zone_code === "LLRZ",
      points: 2.0,
      reason: "Large Lot / Rural zone — development very limited",
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

  const costPerUnit = costs.cost_per_unit_avg;
  const costBrackets = [
    { max: 400000,   score: 5.0, reason: "Excellent cost efficiency per unit" },
    { max: 550000,   score: 4.0, reason: "Good cost per unit for NZ market" },
    { max: 700000,   score: 3.0, reason: "Moderate cost — market viable" },
    { max: 900000,   score: 2.0, reason: "High cost per unit — margin is thin" },
    { max: 1200000,  score: 1.0, reason: "Very high cost — ROI challenging" },
    { max: Infinity, score: 0.5, reason: "Extreme cost — feasibility doubtful" },
  ];

  const costBracket = costBrackets.find((b) => costPerUnit <= b.max) ?? costBrackets[costBrackets.length - 1];
  const cost = costBracket.score;
  const cost_reasons = [costBracket.reason, `Cost per unit: $${formatNZD(costPerUnit)}`];

  const bestScenario = scenarios.reduce((best, s) =>
    s.roi_percent > best.roi_percent ? s : best,
  );

  const roiBrackets = [
    { min: 35,        score: 5.0, reason: "Exceptional return — strong development opportunity" },
    { min: 25,        score: 4.0, reason: "Strong return — well above typical NZ threshold" },
    { min: 15,        score: 3.0, reason: "Solid return — meets typical developer hurdle rate" },
    { min: 8,         score: 2.0, reason: "Marginal return — viable but sensitive to cost overruns" },
    { min: 0,         score: 1.0, reason: "Low return — high risk of negative outcome" },
    { min: -Infinity, score: 0.5, reason: "Negative return — not viable at current market values" },
  ];

  const roiBracket = roiBrackets.find((b) => bestScenario.roi_percent >= b.min) ?? roiBrackets[roiBrackets.length - 1];
  const roi = roiBracket.score;
  const roi_reasons = [
    roiBracket.reason,
    `Best case: ${bestScenario.roi_percent.toFixed(1)}% ROI over ${bestScenario.years} years`,
  ];

  const composite = parseFloat(((ease * 0.3) + (cost * 0.3) + (roi * 0.4)).toFixed(1));

  return { ease, cost, roi, composite, ease_reasons, cost_reasons, roi_reasons };
}
