import { describe, expect, it } from "vitest";
import { scoreProperty } from "../scoring";
import { buildBuiltEnvironmentContext, type ParcelBuildAssessment } from "../built-environment-context";
import type { MergedPropertyData } from "../scrapers/merge";
import type { CostBreakdown } from "../cost-estimator";
import type { ROIScenario } from "../roi-calculator";
import type { LinzParcelNearby } from "../linz";

function merged(overrides: Partial<MergedPropertyData> = {}): MergedPropertyData {
  return {
    cv_nzd: 1_500_000,
    cv_year: 2024,
    land_area_sqm: 700,
    floor_area_sqm: 180,
    build_year: 2015,
    build_year_range: null,
    bedrooms: 3,
    bathrooms: 2,
    // MHS is not penalised by zone deductions, so the only ease movement comes from tenure.
    zone_code: "MHS",
    zone_description: "Mixed Housing Suburban",
    min_lot_size_sqm: 400,
    overlays: [],
    school_zones: { primary: null, intermediate: null, secondary: null },
    last_sale_price: null,
    last_sale_date: null,
    listing_active: false,
    listing_price: null,
    main_photo_url: null,
    photo_urls: [],
    overlay_map_image_base64: null,
    comparables: [],
    data_sources: {},
    discrepancies: [],
    contour: "gentle",
    contour_slope_degrees: 4,
    contour_source: null,
    contour_text: null,
    asbestos_risk: "low",
    infrastructure: [],
    missing_critical_fields: [],
    estate_type: null,
    ...overrides,
  };
}

const baseCosts: CostBreakdown = {
  land_cv_nzd: 1_500_000,
  cv_unavailable: false,
  demo_low: 15_000,
  demo_high: 30_000,
  demo_vacant: false,
  retaining_low: 10_000,
  retaining_high: 30_000,
  retaining_unknown: false,
  tdr_ttr_low: 0,
  tdr_ttr_high: 0,
  tdr_ttr_required: false,
  tdr_ttr_note: null,
  services_low: 0,
  services_high: 0,
  construction_low: 336_000,
  construction_high: 420_000,
  consents_low: 44_000,
  consents_high: 67_000,
  finance_low: 150_000,
  finance_high: 300_000,
  contingency_low: 44_000,
  contingency_high: 102_000,
  total_low: 600_000,
  total_high: 700_000,
  total_excludes_land: false,
  units: 2,
  cost_per_unit_avg: 500_000,
  has_existing_dwelling: true,
};

// Empty scenarios keep ROI fixed at 0.5 so the test isolates the ease score.
const scenarios: ROIScenario[] = [];
// lots = 2 so the single-dwelling ease deduction does not fire.
const LOTS = 2;

function scenario(overrides: Partial<ROIScenario>): ROIScenario {
  const gdv = overrides.gdv ?? 7_500_000;
  const totalCost = overrides.total_cost_mid ?? 6_000_000;
  const grossProfit = overrides.gross_profit ?? gdv - totalCost;
  const roiPercent = overrides.roi_percent ?? (grossProfit / totalCost) * 100;
  return {
    years: 3,
    gdv,
    total_cost_mid: totalCost,
    gross_profit: grossProfit,
    roi_percent: roiPercent,
    annualised_roi_percent: roiPercent / 3,
    viable: roiPercent > 0,
    cases: [],
    lots: LOTS,
    sqm_per_lot: 350,
    gdv_per_lot: gdv / LOTS,
    interest_rate_outlook: "stable",
    ...overrides,
  };
}

const CROSS_LEASE_REASON = "Cross-lease title — co-owner consent constrains development";
const LEASEHOLD_REASON = "Leasehold title — limited development rights vs freehold";

const TITLE_UNVERIFIED_REASON = "Title verification incomplete - confirm tenure before committing to development";
const TYPOLOGY_UNKNOWN_REASON = "Dwelling typology not fully confirmed - verify this is not a unit, cross-lease, or apartment";

function builtEnvAssessment(id: string, representativeYear: number): ParcelBuildAssessment {
  const parcel: LinzParcelNearby = {
    parcel_id: id,
    appellation: `Lot ${id} DP 12345`,
    area_sqm: 450,
    title_no: `NA${id}/1`,
    legal_description: `Lot ${id} DP 12345`,
    topology_type: "Primary",
    bbox: null,
    distance_m: 20,
  };
  return {
    parcel,
    address: `${id} Test Street`,
    distanceM: 20,
    buildYear: representativeYear,
    buildYearRange: null,
    representativeYear,
  };
}

describe("scoreProperty — tenure", () => {
  const freehold = scoreProperty(merged({ estate_type: "Fee Simple" }), baseCosts, scenarios, LOTS);
  const unknown = scoreProperty(merged({ estate_type: null }), baseCosts, scenarios, LOTS);

  it("does not penalise freehold / fee simple", () => {
    expect(freehold.ease_reasons).not.toContain(CROSS_LEASE_REASON);
    expect(freehold.ease_reasons).not.toContain(LEASEHOLD_REASON);
  });

  it("does not penalise unknown tenure", () => {
    expect(unknown.ease_reasons).not.toContain(CROSS_LEASE_REASON);
    expect(unknown.ease_reasons).not.toContain(LEASEHOLD_REASON);
    expect(unknown.ease).toBe(freehold.ease);
  });

  it("lowers ease for a cross-lease title with the expected reason", () => {
    const crossLease = scoreProperty(merged({ estate_type: "Cross Lease" }), baseCosts, scenarios, LOTS);
    expect(crossLease.ease).toBeLessThan(freehold.ease);
    expect(crossLease.ease_reasons).toContain(CROSS_LEASE_REASON);
    expect(crossLease.ease_reasons).not.toContain(LEASEHOLD_REASON);
  });

  it("treats stratum like cross lease", () => {
    const stratum = scoreProperty(merged({ estate_type: "Stratum in Freehold" }), baseCosts, scenarios, LOTS);
    expect(stratum.ease).toBeLessThan(freehold.ease);
    expect(stratum.ease_reasons).toContain(CROSS_LEASE_REASON);
  });

  it("keeps scoring available while flagging title and typology uncertainty", () => {
    const verified = scoreProperty(
      merged({ typology: "standalone", typologyConfidence: "verified", titleConfidence: "verified" }),
      baseCosts,
      scenarios,
      LOTS,
    );
    const uncertain = scoreProperty(
      merged({ typology: "unknown", typologyConfidence: "unknown", titleConfidence: "unknown" }),
      baseCosts,
      scenarios,
      LOTS,
    );

    expect(uncertain.ease).toBeLessThan(verified.ease);
    expect(uncertain.cost).toBeGreaterThan(0);
    expect(uncertain.roi).toBeGreaterThan(0);
    expect(uncertain.ease_reasons).toContain(TITLE_UNVERIFIED_REASON);
    expect(uncertain.ease_reasons).toContain(TYPOLOGY_UNKNOWN_REASON);
  });

  it("lowers ease for a leasehold title with the expected reason", () => {
    const leasehold = scoreProperty(merged({ estate_type: "Leasehold" }), baseCosts, scenarios, LOTS);
    expect(leasehold.ease).toBeLessThan(freehold.ease);
    expect(leasehold.ease_reasons).toContain(LEASEHOLD_REASON);
    expect(leasehold.ease_reasons).not.toContain(CROSS_LEASE_REASON);
  });
});

describe("scoreProperty — cost position", () => {
  it("does not punish prime-location projects solely because the per-unit dollar cost is high", () => {
    const costs = { ...baseCosts, land_cv_nzd: 5_000_000, total_low: 5_800_000, total_high: 6_200_000, cost_per_unit_avg: 2_250_000 };
    const result = scoreProperty(
      merged({ cv_nzd: 5_000_000 }),
      costs,
      [scenario({ gdv: 8_000_000, total_cost_mid: 6_000_000, roi_percent: 33.3 })],
      LOTS,
    );

    expect(result.cost).toBeGreaterThanOrEqual(4);
    expect(result.cost_reasons.join(" ")).not.toContain("Cost per unit");
  });

  it("marks cost pressure when modelled end value barely covers acquisition and delivery", () => {
    const costs = { ...baseCosts, land_cv_nzd: 5_000_000, total_low: 5_900_000, total_high: 6_100_000, cost_per_unit_avg: 2_250_000 };
    const result = scoreProperty(
      merged({ cv_nzd: 5_000_000 }),
      costs,
      [scenario({ gdv: 5_800_000, total_cost_mid: 6_000_000, gross_profit: -200_000, roi_percent: -3.3 })],
      LOTS,
    );

    expect(result.cost).toBeLessThanOrEqual(2.5);
    expect(result.cost_reasons.join(" ")).toContain("relative to the estimated end value");
  });
});

describe("scoreProperty — built environment", () => {
  it("adds a bounded ROI uplift and reason for a confident last-missing-piece signal", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1955,
      assessments: [
        builtEnvAssessment("1", 2022),
        builtEnvAssessment("2", 2020),
        builtEnvAssessment("3", 2018),
        builtEnvAssessment("4", 2014),
        builtEnvAssessment("5", 2008),
        builtEnvAssessment("6", 2002),
        builtEnvAssessment("7", 1985),
        builtEnvAssessment("8", 1975),
      ],
    });
    const base = scoreProperty(merged(), baseCosts, scenarios, LOTS);
    const scored = scoreProperty(merged(), baseCosts, scenarios, LOTS, context);

    expect(scored.roi).toBe(Math.min(5, base.roi + 0.5));
    expect(scored.roi_reasons).toContain("Older dwelling among newer nearby homes suggests rebuild value may be unlocked.");
  });

  it("does not numerically adjust ROI for low-confidence built-environment context", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1955,
      assessments: [
        builtEnvAssessment("1", 2022),
        builtEnvAssessment("2", 2020),
        builtEnvAssessment("3", 1970),
      ],
    });
    const base = scoreProperty(merged(), baseCosts, scenarios, LOTS);
    const scored = scoreProperty(merged(), baseCosts, scenarios, LOTS, context);

    expect(context.confidence).toBe("low");
    expect(scored.roi).toBe(base.roi);
  });

  it("slightly deducts ROI for a confident older surrounding environment", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1955,
      assessments: [
        builtEnvAssessment("1", 1975),
        builtEnvAssessment("2", 1970),
        builtEnvAssessment("3", 1968),
        builtEnvAssessment("4", 1962),
        builtEnvAssessment("5", 1958),
        builtEnvAssessment("6", 1952),
        builtEnvAssessment("7", 1994),
        builtEnvAssessment("8", 2004),
      ],
    });
    const base = scoreProperty(merged(), baseCosts, scenarios, LOTS);
    const scored = scoreProperty(merged(), baseCosts, scenarios, LOTS, context);

    expect(context.signal).toBe("older_environment");
    expect(scored.roi).toBe(Math.max(0.5, base.roi - 0.25));
    expect(scored.roi_reasons).toContain("Nearby homes are mostly older, so a new build may need to lead the local environment rather than complete it.");
  });
});
