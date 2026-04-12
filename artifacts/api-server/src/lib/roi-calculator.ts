import type { CostBreakdown } from "./cost-estimator";
import { roundToNearest } from "./utils";

export interface ROIScenario {
  years: 2 | 3 | 4;
  gdv: number;
  total_cost_mid: number;
  gross_profit: number;
  roi_percent: number;
  annualised_roi_percent: number;
  viable: boolean;
}

export function calculateROIScenarios(
  costs: CostBreakdown,
  avg_sale_price_per_unit: number,
  units: number,
): ROIScenario[] {
  const safeUnits = Math.max(1, units);
  const gdv = roundToNearest(avg_sale_price_per_unit * safeUnits, 1000);
  const total_cost_mid = roundToNearest((costs.total_low + costs.total_high) / 2, 1000);

  const gross_profit = roundToNearest(gdv - total_cost_mid, 1000);
  const roi_percent = total_cost_mid > 0
    ? parseFloat(((gross_profit / total_cost_mid) * 100).toFixed(1))
    : 0;

  return ([2, 3, 4] as const).map((years) => {
    const rawAnnualised = total_cost_mid > 0
      ? (Math.pow(1 + roi_percent / 100, 1 / years) - 1) * 100
      : 0;
    const annualised_roi_percent = parseFloat(rawAnnualised.toFixed(1));

    return {
      years,
      gdv,
      total_cost_mid,
      gross_profit,
      roi_percent,
      annualised_roi_percent,
      viable: gross_profit > 0,
    };
  });
}
