import { describe, expect, it } from "vitest";
import { calculateScenariosFromGdv, estimateNewBuildFloorSqm } from "../roi-calculator";
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

describe("calculateScenariosFromGdv suppressOrganicGrowth option", () => {
  it("keeps GDV flat across exit horizons when suppressOrganicGrowth is true", () => {
    const scenarios = calculateScenariosFromGdv(
      baseHoldCosts,
      3_000_000,
      1,
      833,
      3_000_000,
      "stable",
      { suppressOrganicGrowth: true },
    );

    expect(scenarios).toHaveLength(3);
    const gdvs = scenarios.map((s) => s.gdv);
    expect(gdvs[0]).toBe(3_000_000);
    expect(gdvs[1]).toBe(3_000_000);
    expect(gdvs[2]).toBe(3_000_000);
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
});
