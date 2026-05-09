import type { CostBreakdown } from "./cost-estimator";
import { roundToNearest } from "./utils";

export type PriceCase = "bear" | "base" | "bull";
export type DevelopmentStrategyId = "hold_existing" | "refurbish" | "demolish_rebuild";
export type RefurbishmentScope = "none" | "light" | "moderate" | "heavy";

export interface ROICaseResult {
  case: PriceCase;
  gdv: number;
  gdv_multiplier: number;
  gross_profit: number;
  roi_percent: number;
  annualised_roi_percent: number;
  viable: boolean;
  label: string;
}

export interface ROIScenario {
  years: number;
  gdv: number;
  total_cost_mid: number;
  gross_profit: number;
  roi_percent: number;
  annualised_roi_percent: number;
  viable: boolean;
  cv_unavailable?: boolean;
  cases: ROICaseResult[];
  lots: number;
  sqm_per_lot: number;
  gdv_per_lot: number;
  interest_rate_outlook: "falling" | "stable" | "rising";
}

export type InterestRateOutlook = "falling" | "stable" | "rising";

/**
 * Suburb comparables are usually standalone dwellings on larger sites. Modelled GDV for
 * many small lots in dense zones (THAB / MHU) is terrace or townhouse product — typically
 * lower $/dwelling than those villa-style comparables. Apply this multiplier (0–1] to GDV.
 */
export function exitGdvTypologyDiscountFactor(zoneCode: string | null, lots: number, sqmPerLot: number): number {
  if (lots < 2) return 1;
  const z = (zoneCode ?? "").toUpperCase().trim();

  let factor = 1;

  if (z === "THAB") {
    if (lots >= 7) factor = 0.68;
    else if (lots >= 6) factor = 0.71;
    else if (lots >= 5) factor = 0.74;
    else if (lots >= 4) factor = 0.78;
    else factor = 0.85;
  } else if (z === "MHU" || z === "MHU-H" || z === "MHU-S") {
    if (lots >= 7) factor = 0.76;
    else if (lots >= 5) factor = 0.8;
    else if (lots >= 4) factor = 0.84;
    else if (lots >= 3) factor = 0.9;
  } else if (z === "MHS") {
    if (lots >= 6) factor = 0.88;
    else if (lots >= 4) factor = 0.92;
    else if (lots >= 3) factor = 0.95;
  }

  if (sqmPerLot > 0 && sqmPerLot < 90 && lots >= 3) {
    factor *= 0.94;
  }

  return Math.min(1, Math.max(0.5, parseFloat(factor.toFixed(4))));
}

/**
 * Exit horizons for ROI cards: multi-unit schemes rarely realise full GDV in 2–3 years;
 * longer horizons better reflect phased construction, consent, and staged sales (lower annualised %).
 */
export function exitHorizonYearsForUnitCount(units: number): number[] {
  const n = Math.max(1, Math.floor(units));
  if (n <= 2) return [2, 3, 4];
  if (n === 3) return [2, 4, 5];
  if (n === 4) return [3, 4, 6];
  if (n <= 6) return [4, 5, 6];
  return [5, 6, 8];
}

/**
 * Estimate total finished floor area for a new-build house on the given lot size.
 * Starts with a plausible ground-floor footprint, then allows upper-floor area
 * on smaller infill lots where two-storey homes are common.
 */
export function estimateNewBuildFloorSqm(sqm_per_lot: number): number {
  // Smaller lots often use two storeys, so total GFA can exceed the footprint
  // implied by site coverage alone.
  const footprint = sqm_per_lot * 0.38;
  const storeyMultiplier =
    sqm_per_lot < 180 ? 1.55 :
    sqm_per_lot < 300 ? 1.45 :
    sqm_per_lot < 500 ? 1.30 :
    sqm_per_lot < 650 ? 1.15 :
    1.00;
  const raw = footprint * storeyMultiplier;
  return Math.round(Math.min(320, Math.max(90, raw)));
}

/**
 * Estimate the GDV (selling price) per lot based on comparable price_per_sqm
 * and the expected new-build floor area for that lot size.
 */
export function estimateGdvPerLot(
  avg_price_per_sqm: number,
  avg_sale_price: number,
  sqm_per_lot: number,
): number {
  if (avg_price_per_sqm > 0 && sqm_per_lot > 0) {
    const floor_sqm = estimateNewBuildFloorSqm(sqm_per_lot);
    return roundToNearest(avg_price_per_sqm * floor_sqm, 1000);
  }
  return roundToNearest(avg_sale_price, 1000);
}

function buildCase(
  caseType: PriceCase,
  gdv: number,
  total_cost_mid: number,
  years: number,
): ROICaseResult {
  const gross_profit = roundToNearest(gdv - total_cost_mid, 1000);
  const roi_percent = total_cost_mid > 0
    ? parseFloat(((gross_profit / total_cost_mid) * 100).toFixed(1))
    : 0;
  const rawAnnualised = total_cost_mid > 0
    ? (Math.pow(1 + roi_percent / 100, 1 / years) - 1) * 100
    : 0;
  const annualised_roi_percent = parseFloat(rawAnnualised.toFixed(1));

  const labels: Record<PriceCase, string> = {
    bear: "Bear (-20%) — Pessimistic market",
    base: "Base — Realistic market",
    bull: "Bull (+20%) — Rates falling",
  };
  const multipliers: Record<PriceCase, number> = { bear: 0.80, base: 1.00, bull: 1.20 };

  return {
    case: caseType,
    gdv,
    gdv_multiplier: multipliers[caseType],
    gross_profit,
    roi_percent,
    annualised_roi_percent,
    viable: gross_profit > 0,
    label: labels[caseType],
  };
}

export function calculateBearBaseBullScenarios(
  costs: CostBreakdown,
  avg_price_per_sqm: number,
  avg_sale_price: number,
  lots: number,
  sqm_per_lot: number,
  interest_rate_outlook: InterestRateOutlook,
  /** Applied to modelled GDV when exit product (e.g. terraces) differs from comparable typology */
  gdv_typology_multiplier: number = 1,
): ROIScenario[] {
  const safeUnits = Math.max(1, lots);
  const mult = Number.isFinite(gdv_typology_multiplier) ? Math.min(1, Math.max(0.5, gdv_typology_multiplier)) : 1;

  const gdv_per_lot_base = estimateGdvPerLot(avg_price_per_sqm, avg_sale_price, sqm_per_lot);
  const gdv_per_lot = roundToNearest(gdv_per_lot_base * mult, 1000);
  const base_gdv = roundToNearest(gdv_per_lot * safeUnits, 1000);

  return calculateScenariosFromGdv(
    costs,
    base_gdv,
    safeUnits,
    sqm_per_lot,
    gdv_per_lot,
    interest_rate_outlook,
  );
}

export function calculateScenariosFromGdv(
  costs: CostBreakdown,
  base_gdv: number,
  lots: number,
  sqm_per_lot: number,
  gdv_per_lot: number,
  interest_rate_outlook: InterestRateOutlook,
): ROIScenario[] {
  const safeUnits = Math.max(1, lots);
  const bear_gdv = roundToNearest(base_gdv * 0.80, 1000);
  const bull_gdv = roundToNearest(base_gdv * 1.20, 1000);

  const total_cost_mid = roundToNearest((costs.total_low + costs.total_high) / 2, 1000);
  const cvUnavailable = costs.cv_unavailable === true;

  const horizonYears = exitHorizonYearsForUnitCount(safeUnits);

  return horizonYears.map((years) => {
    const bearCase = buildCase("bear", bear_gdv, total_cost_mid, years);
    const baseCase = buildCase("base", base_gdv, total_cost_mid, years);
    const bullCase = buildCase("bull", bull_gdv, total_cost_mid, years);

    const activeCases: ROICaseResult[] = [
      bearCase,
      baseCase,
      ...(interest_rate_outlook === "falling" ? [bullCase] : []),
    ];

    return {
      years,
      gdv: base_gdv,
      total_cost_mid,
      gross_profit: baseCase.gross_profit,
      roi_percent: baseCase.roi_percent,
      annualised_roi_percent: baseCase.annualised_roi_percent,
      viable: baseCase.viable,
      cv_unavailable: cvUnavailable,
      cases: activeCases,
      lots: safeUnits,
      sqm_per_lot,
      gdv_per_lot,
      interest_rate_outlook,
    };
  });
}

export type { ROIScenario as default };
