import type { CostBreakdown } from "./cost-estimator";
import { roundToNearest } from "./utils";

export type PriceCase = "bear" | "base" | "bull";

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
  years: 2 | 3 | 4;
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
 * Estimate the floor area a new-build house would occupy on a lot of the given size.
 * NZ new builds typically use 30–45% of lot area, capped to realistic townhouse/house sizes.
 */
export function estimateNewBuildFloorSqm(sqm_per_lot: number): number {
  // Tiny lots (< 150m²): compact 2-storey townhouse 80–100 m² floor
  // Medium lots (150–400m²): 2-3BR townhouse 100–160 m² floor
  // Large lots (400–600m²): 3-4BR house 150–200 m² floor
  // Premium lots (600m²+): 4BR+ house 180–260 m² floor
  const raw = sqm_per_lot * 0.38;
  return Math.round(Math.min(260, Math.max(80, raw)));
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
): ROIScenario[] {
  const safeUnits = Math.max(1, lots);

  const gdv_per_lot = estimateGdvPerLot(avg_price_per_sqm, avg_sale_price, sqm_per_lot);
  const base_gdv = roundToNearest(gdv_per_lot * safeUnits, 1000);
  const bear_gdv = roundToNearest(base_gdv * 0.80, 1000);
  const bull_gdv = roundToNearest(base_gdv * 1.20, 1000);

  const total_cost_mid = roundToNearest((costs.total_low + costs.total_high) / 2, 1000);
  const cvUnavailable = costs.cv_unavailable === true;

  return ([2, 3, 4] as const).map((years) => {
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
