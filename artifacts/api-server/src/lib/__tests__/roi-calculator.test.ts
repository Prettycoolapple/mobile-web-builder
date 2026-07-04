import { describe, expect, it } from "vitest";
import {
  calculateBearBaseBullScenarios,
  calculateScenariosFromGdv,
  estimateNewBuildFloorSqm,
  exitGdvTypologyDiscountFactor,
  nearestHorizonRoiPercent,
  type ROIScenario,
} from "../roi-calculator";
import type { CostBreakdown } from "../cost-estimator";

describe("estimateNewBuildFloorSqm", () => {
  it("models total floor area, not just the ground-floor footprint, on infill lots", () => {
    const sqmPerLot = 412;
    const singleLevelFootprint = Math.round(sqmPerLot * 0.38);

    expect(estimateNewBuildFloorSqm(sqmPerLot)).toBe(204);
    expect(estimateNewBuildFloorSqm(sqmPerLot)).toBeGreaterThan(singleLevelFootprint);
  });

  it("uses a higher GFA cap for premium-suburb lots (>= 600 sqm)", () => {
    // 900 sqm SHZ lot (Mellons Bay / St Heliers / Remuera scale): footprint
    // 0.38 × 900 = 342 sqm, storey multiplier 1.0 at this size → raw 342 sqm.
    // The cap should NOT clip this back to 320 — premium-suburb new builds
    // routinely exceed 320 sqm.
    expect(estimateNewBuildFloorSqm(900)).toBe(342);

    // A very large lot can push raw GFA above the 450 cap; verify the cap holds.
    expect(estimateNewBuildFloorSqm(2000)).toBe(450);
  });

  it("retains the 320 sqm cap for sub-600 sqm infill lots", () => {
    // 550 sqm × 1.15 storey × 0.38 footprint = 240.35 → 240. Below cap.
    expect(estimateNewBuildFloorSqm(550)).toBeLessThanOrEqual(320);
  });
});

const baseHoldCosts: CostBreakdown = {
  land_cv_nzd: 2_000_000,
  cv_unavailable: false,
  demo_low: 0,
  demo_high: 0,
  demo_vacant: false,
  retaining_low: 0,
  retaining_high: 0,
  retaining_unknown: false,
  tdr_ttr_low: 0,
  tdr_ttr_high: 0,
  tdr_ttr_required: false,
  tdr_ttr_note: null,
  services_low: 0,
  services_high: 0,
  construction_low: 0,
  construction_high: 0,
  consents_low: 0,
  consents_high: 0,
  finance_low: 0,
  finance_high: 0,
  contingency_low: 0,
  contingency_high: 0,
  total_low: 2_020_000,
  total_high: 2_050_000,
  total_excludes_land: false,
  units: 1,
  cost_per_unit_avg: 2_035_000,
  has_existing_dwelling: true,
};

describe("calculateScenariosFromGdv organic growth", () => {
  it("applies organic growth across every exit horizon", () => {
    const scenarios = calculateScenariosFromGdv(
      baseHoldCosts,
      3_000_000,
      1,
      833,
      3_000_000,
      "stable",
    );

    expect(scenarios).toHaveLength(3);
    const gdvs = scenarios.map((s) => s.gdv);
    expect(gdvs[0]).toBeGreaterThan(3_000_000);
    expect(gdvs[1]).toBeGreaterThan(gdvs[0]);
    expect(gdvs[2]).toBeGreaterThan(gdvs[1]);
  });

  it("applies organic growth across exit horizons by default", () => {
    const scenarios = calculateScenariosFromGdv(
      baseHoldCosts,
      3_000_000,
      1,
      833,
      3_000_000,
      "stable",
    );

    const gdvs = scenarios.map((s) => s.gdv);
    expect(gdvs[0]).toBeGreaterThan(3_000_000);
    expect(gdvs[1]).toBeGreaterThan(gdvs[0]);
    expect(gdvs[2]).toBeGreaterThan(gdvs[1]);
  });

  it("discounts GDV (and therefore roi_percent) for a dense multi-lot THAB scheme when the typology multiplier is applied", () => {
    const discountFactor = exitGdvTypologyDiscountFactor("THAB", 7, 120);
    expect(discountFactor).toBeLessThan(1); // sanity: THAB 7+ lots is meant to discount

    const withoutDiscount = calculateBearBaseBullScenarios(
      baseHoldCosts,
      12_000, // avg_price_per_sqm
      1_400_000, // avg_sale_price
      7, // lots
      120, // sqm_per_lot
      "stable",
      1, // no discount — the pre-fix hardcoded value
    );
    const withDiscount = calculateBearBaseBullScenarios(
      baseHoldCosts,
      12_000,
      1_400_000,
      7,
      120,
      "stable",
      discountFactor,
    );

    // Same horizon, same cost base — GDV and roi_percent must both be lower once
    // the discount is actually applied (this is the bug that was fixed: the
    // discount previously never reached the ROI scenario calculation at all).
    for (let i = 0; i < withoutDiscount.length; i++) {
      expect(withDiscount[i].gdv).toBeLessThan(withoutDiscount[i].gdv);
      expect(withDiscount[i].roi_percent).toBeLessThan(withoutDiscount[i].roi_percent);
    }
  });
});

describe("nearestHorizonRoiPercent", () => {
  const scenario = (years: number, roi_percent: number): ROIScenario => ({
    years,
    gdv: 0,
    total_cost_mid: 0,
    gross_profit: 0,
    roi_percent,
    annualised_roi_percent: 0,
    viable: true,
    cases: [],
    lots: 1,
    sqm_per_lot: 0,
    gdv_per_lot: 0,
    interest_rate_outlook: "stable",
  });

  it("picks the NEAREST exit horizon's total return, not the max across horizons", () => {
    // The longest horizon (8 years) has compounded the most and would win under
    // a naive Math.max — that's the exact behaviour being fixed here.
    const scenarios = [scenario(5, 40), scenario(6, 65), scenario(8, 496)];
    expect(nearestHorizonRoiPercent(scenarios)).toBe(40);
  });

  it("returns null for no scenarios (e.g. missing comparables)", () => {
    expect(nearestHorizonRoiPercent([])).toBeNull();
  });
});
