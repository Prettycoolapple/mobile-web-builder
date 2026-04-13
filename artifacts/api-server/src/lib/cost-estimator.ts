import type { MergedPropertyData } from "./scrapers/merge";
import { roundToNearest } from "./utils";

export interface CostBreakdown {
  land_cv_nzd: number | null;
  cv_unavailable: boolean;
  demo_low: number;
  demo_high: number;
  demo_vacant: boolean;
  retaining_low: number;
  retaining_high: number;
  retaining_unknown: boolean;
  services_low: number;
  services_high: number;
  construction_low: number;
  construction_high: number;
  consents_low: number;
  consents_high: number;
  finance_low: number;
  finance_high: number;
  contingency_low: number;
  contingency_high: number;
  total_low: number;
  total_high: number;
  total_excludes_land: boolean;
  units: number;
  cost_per_unit_avg: number;
  has_existing_dwelling: boolean;
}

export function estimateCosts(data: MergedPropertyData, units: number): CostBreakdown {
  const cv = data.cv_nzd ?? null;
  const cvUnavailable = cv === null;
  const contour = data.contour ?? null;
  const asbestos = data.asbestos_risk ?? "unknown";
  const hasDwelling = data.build_year != null;

  const safeUnits = Math.max(1, units);

  let demo_low = 0;
  let demo_high = 0;
  const demoVacant = !hasDwelling;
  if (hasDwelling) {
    if (asbestos === "low") {
      demo_low = 15000; demo_high = 30000;
    } else if (asbestos === "high") {
      demo_low = 35000; demo_high = 80000;
    } else {
      demo_low = 20000; demo_high = 60000;
    }
  }

  let retaining_low = 0;
  let retaining_high = 0;
  const retainingUnknown = contour === null;
  if (contour === "gentle") {
    retaining_low = 10000;  retaining_high = 30000;
  } else if (contour === "moderate") {
    retaining_low = 50000;  retaining_high = 150000;
  } else if (contour === "steep") {
    retaining_low = 200000; retaining_high = 400000;
  }

  const infra = data.infrastructure ?? [];
  const services_low  = infra.reduce((sum, i) => sum + (i.estimated_cost_low ?? 0),  0);
  const services_high = infra.reduce((sum, i) => sum + (i.estimated_cost_high ?? 0), 0);

  const FLOOR_AREA = 120;
  let rate_low  = 2800;
  let rate_high = 3500;
  if (contour === "steep") {
    rate_low  *= 1.18;
    rate_high *= 1.18;
  } else if (contour === "moderate") {
    rate_low  *= 1.08;
    rate_high *= 1.08;
  }

  const construction_low  = rate_low  * FLOOR_AREA * safeUnits;
  const construction_high = rate_high * FLOOR_AREA * safeUnits;

  const consents_low  = construction_low  * 0.13;
  const consents_high = construction_high * 0.16;

  const construction_mid = (construction_low + construction_high) / 2;
  const loan_base = (cv ?? 0) + construction_mid * 0.5;
  const finance_low  = loan_base * 0.075 * 1.5;
  const finance_high = loan_base * 0.075 * 2.5;

  const subtotal_low  = demo_low  + retaining_low  + services_low  + construction_low  + consents_low  + finance_low;
  const subtotal_high = demo_high + retaining_high + services_high + construction_high + consents_high + finance_high;

  const contingency_low  = subtotal_low  * 0.08;
  const contingency_high = subtotal_high * 0.12;

  const dev_cost_low  = subtotal_low  + contingency_low;
  const dev_cost_high = subtotal_high + contingency_high;

  const total_low  = (cv ?? 0) + dev_cost_low;
  const total_high = (cv ?? 0) + dev_cost_high;
  const cost_per_unit_avg = ((total_low + total_high) / 2) / safeUnits;

  const r = (n: number) => roundToNearest(n, 1000);

  return {
    land_cv_nzd:       cv !== null ? r(cv) : null,
    cv_unavailable:    cvUnavailable,
    demo_low:          r(demo_low),
    demo_high:         r(demo_high),
    demo_vacant:       demoVacant,
    retaining_low:     r(retaining_low),
    retaining_high:    r(retaining_high),
    retaining_unknown: retainingUnknown,
    services_low:      r(services_low),
    services_high:     r(services_high),
    construction_low:  r(construction_low),
    construction_high: r(construction_high),
    consents_low:      r(consents_low),
    consents_high:     r(consents_high),
    finance_low:       r(finance_low),
    finance_high:      r(finance_high),
    contingency_low:   r(contingency_low),
    contingency_high:  r(contingency_high),
    total_low:         r(total_low),
    total_high:        r(total_high),
    total_excludes_land: cvUnavailable,
    units:             safeUnits,
    cost_per_unit_avg: r(cost_per_unit_avg),
    has_existing_dwelling: hasDwelling,
  };
}
