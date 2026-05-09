import { describe, expect, it } from "vitest";
import {
  buildFallbackDevelopmentStrategyAssessment,
  calculateDevelopmentStrategies,
} from "../development-strategies";
import type { CostBreakdown } from "../cost-estimator";
import type { LotResult } from "../lot-calculator";
import type { MergedPropertyData } from "../scrapers/merge";

function merged(overrides: Partial<MergedPropertyData> = {}): MergedPropertyData {
  return {
    cv_nzd: 1_800_000,
    cv_year: 2024,
    land_area_sqm: 833,
    floor_area_sqm: 220,
    build_year: 2016,
    build_year_range: null,
    bedrooms: 4,
    bathrooms: 3,
    zone_code: "SHZ",
    zone_description: "Single House Zone",
    min_lot_size_sqm: 600,
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
    contour_slope_degrees: 6,
    contour_source: null,
    contour_text: null,
    asbestos_risk: "low",
    infrastructure: [],
    missing_critical_fields: [],
    estate_type: null,
    ...overrides,
  };
}

const lotResult: LotResult = {
  lots: 1,
  min_lot_size: 600,
  zone_label: "Single House Zone",
  gross_area_sqm: 833,
  net_area_sqm: 833,
  easement_area_sqm: 0,
  sqm_per_lot: 833,
};

const baseCosts: CostBreakdown = {
  land_cv_nzd: 1_800_000,
  cv_unavailable: false,
  demo_low: 15_000,
  demo_high: 30_000,
  demo_vacant: false,
  retaining_low: 10_000,
  retaining_high: 30_000,
  retaining_unknown: false,
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
  total_low: 2_399_000,
  total_high: 2_749_000,
  total_excludes_land: false,
  units: 1,
  cost_per_unit_avg: 2_574_000,
  has_existing_dwelling: true,
};

describe("development strategies", () => {
  it("favours holding a modern post-2010 dwelling in fallback assessment", () => {
    const assessment = buildFallbackDevelopmentStrategyAssessment(merged({ build_year: 2016 }), lotResult);

    expect(assessment.recommended_strategy).toBe("hold_existing");
    expect(assessment.refurbish_scope).toBe("light");
  });

  it("keeps strategy ROI unavailable when real comparable pricing is unavailable", () => {
    const assessment = buildFallbackDevelopmentStrategyAssessment(merged(), lotResult);
    const strategies = calculateDevelopmentStrategies({
      data: merged(),
      baseCosts,
      lotResult,
      avgSalePrice: 0,
      avgPricePerSqm: 0,
      interestRateOutlook: "stable",
      assessment,
    });

    expect(strategies).toHaveLength(3);
    expect(strategies.every((strategy) => strategy.roiScenarios.length === 0)).toBe(true);
  });

  it("removes demolition and rebuild costs from the hold strategy", () => {
    const assessment = buildFallbackDevelopmentStrategyAssessment(merged(), lotResult);
    const strategies = calculateDevelopmentStrategies({
      data: merged(),
      baseCosts,
      lotResult,
      avgSalePrice: 2_400_000,
      avgPricePerSqm: 10_000,
      interestRateOutlook: "stable",
      assessment,
    });

    const hold = strategies.find((strategy) => strategy.id === "hold_existing");
    const rebuild = strategies.find((strategy) => strategy.id === "demolish_rebuild");

    expect(hold?.costItems.some((item) => item.label === "Demolition")).toBe(false);
    expect(hold?.totalCostLow).toBeLessThan(rebuild?.totalCostLow ?? 0);
    expect(hold?.roiScenarios.length).toBeGreaterThan(0);
  });

  it("uses the multi-unit rebuild cost stack when calculating subdivision ROI", () => {
    const twoLotResult: LotResult = {
      ...lotResult,
      lots: 2,
      min_lot_size: 400,
      zone_label: "Mixed Housing Suburban",
      sqm_per_lot: 416,
    };
    const twoUnitCosts: CostBreakdown = {
      ...baseCosts,
      construction_low: 672_000,
      construction_high: 840_000,
      consents_low: 87_000,
      consents_high: 134_000,
      total_low: 2_999_000,
      total_high: 3_549_000,
      units: 2,
      cost_per_unit_avg: 1_637_000,
    };
    const assessment = buildFallbackDevelopmentStrategyAssessment(
      merged({ build_year: 1960, zone_code: "MHS", min_lot_size_sqm: 400 }),
      twoLotResult,
    );
    const strategies = calculateDevelopmentStrategies({
      data: merged({ build_year: 1960, zone_code: "MHS", min_lot_size_sqm: 400 }),
      baseCosts: twoUnitCosts,
      lotResult: twoLotResult,
      avgSalePrice: 2_400_000,
      avgPricePerSqm: 10_000,
      interestRateOutlook: "stable",
      assessment,
    });

    const rebuild = strategies.find((strategy) => strategy.id === "demolish_rebuild");
    const scenario = rebuild?.roiScenarios[0];

    expect(rebuild?.totalCostLow).toBe(twoUnitCosts.total_low);
    expect(rebuild?.totalCostHigh).toBe(twoUnitCosts.total_high);
    expect(scenario?.lots).toBe(2);
    expect(scenario?.total_cost_mid).toBe(3_274_000);
  });
});
