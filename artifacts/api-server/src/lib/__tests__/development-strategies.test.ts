import { describe, expect, it } from "vitest";
import {
  buildFallbackDevelopmentStrategyAssessment,
  calculateDevelopmentStrategies,
} from "../development-strategies";
import { estimateGdvPerLot } from "../roi-calculator";
import type { CostBreakdown } from "../cost-estimator";
import type { LotResult } from "../lot-calculator";
import type { MergedPropertyData } from "../scrapers/merge";
import type { NeighbourhoodContext } from "../neighbourhood-context";

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
    expect(hold?.costItems.find((item) => item.label === "Contingency")?.high ?? 0).toBeLessThan(
      rebuild?.costItems.find((item) => item.label === "Contingency")?.low ?? 0,
    );
  });

  it("moves the recommended badge to the strongest calculated ROI strategy", () => {
    const olderHouse = merged({ build_year: 1976, cv_nzd: 1_550_000, floor_area_sqm: 207 });
    const staleAssessment = buildFallbackDevelopmentStrategyAssessment(olderHouse, lotResult);
    const strategies = calculateDevelopmentStrategies({
      data: olderHouse,
      baseCosts: { ...baseCosts, land_cv_nzd: 1_550_000 },
      lotResult,
      avgSalePrice: 1_550_000,
      avgPricePerSqm: 5_500,
      interestRateOutlook: "falling",
      assessment: { ...staleAssessment, recommended_strategy: "demolish_rebuild" },
    });

    const hold = strategies.find((strategy) => strategy.id === "hold_existing");
    const refurbish = strategies.find((strategy) => strategy.id === "refurbish");
    const rebuild = strategies.find((strategy) => strategy.id === "demolish_rebuild");

    const bestAnnualised = (strategy: typeof hold) => Math.max(
      ...(strategy?.roiScenarios.map((scenario) => scenario.cases.find((c) => c.case === "base")?.annualised_roi_percent ?? scenario.annualised_roi_percent) ?? []),
    );

    expect(bestAnnualised(hold)).toBeGreaterThan(bestAnnualised(refurbish));
    expect(bestAnnualised(hold)).toBeGreaterThan(bestAnnualised(rebuild));
    expect(hold?.recommendation).toBe("recommended");
    expect(rebuild?.recommendation).not.toBe("recommended");
  });

  it("floors hold-existing exit value at CV and uses light holding allowances", () => {
    const data = merged({ cv_nzd: 3_950_000, floor_area_sqm: 220 });
    const costs = { ...baseCosts, land_cv_nzd: 3_950_000 };
    const assessment = buildFallbackDevelopmentStrategyAssessment(data, lotResult);
    const strategies = calculateDevelopmentStrategies({
      data,
      baseCosts: costs,
      lotResult,
      avgSalePrice: 1_700_000,
      avgPricePerSqm: 6_000,
      interestRateOutlook: "stable",
      assessment,
    });

    const hold = strategies.find((strategy) => strategy.id === "hold_existing");
    const scenario = hold?.roiScenarios[0];
    const baseCase = scenario?.cases.find((c) => c.case === "base");

    expect(scenario?.gdv).toBe(4_110_000);
    expect(baseCase?.gdv).toBe(4_110_000);
    expect(hold?.roiScenarios.map((s) => s.gdv)).toEqual([4_110_000, 4_192_000, 4_276_000]);
    expect(hold?.totalCostLow).toBe(3_990_000);
    expect(hold?.totalCostHigh).toBe(4_069_000);
    expect(hold?.costItems.find((item) => item.label === "Contingency")?.high).toBe(20_000);
  });

  it("applies organic annual growth across hold, refurbish, and rebuild horizons", () => {
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

    for (const strategy of strategies) {
      expect(strategy.roiScenarios.map((scenario) => scenario.years)).toEqual([2, 3, 4]);
      expect(strategy.roiScenarios[1].gdv).toBeGreaterThan(strategy.roiScenarios[0].gdv);
      expect(strategy.roiScenarios[2].gdv).toBeGreaterThan(strategy.roiScenarios[1].gdv);
    }
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

  it("treats vacant land as a new-build scenario even if assessment recommends holding", () => {
    const vacant = merged({
      floor_area_sqm: null,
      build_year: null,
      bedrooms: null,
      bathrooms: null,
      zone_code: "CLZ",
      zone_description: "Countryside Living Zone",
      min_lot_size_sqm: 10000,
    });
    const countrysideLots: LotResult = {
      ...lotResult,
      lots: 2,
      min_lot_size: 10000,
      zone_label: "Countryside Living Zone",
      gross_area_sqm: 19996,
      net_area_sqm: 19996,
      sqm_per_lot: 9998,
    };
    const staleAssessment = buildFallbackDevelopmentStrategyAssessment(merged(), lotResult);
    const strategies = calculateDevelopmentStrategies({
      data: vacant,
      baseCosts: {
        ...baseCosts,
        demo_low: 0,
        demo_high: 0,
        demo_vacant: true,
        has_existing_dwelling: false,
        units: 2,
        tdr_ttr_low: 160_000,
        tdr_ttr_high: 250_000,
        tdr_ttr_required: true,
        tdr_ttr_note: "Rural/countryside subdivision may require a transferable rural site right (TDR/TTR).",
      },
      lotResult: countrysideLots,
      avgSalePrice: 0,
      avgPricePerSqm: 0,
      interestRateOutlook: "stable",
      assessment: { ...staleAssessment, recommended_strategy: "hold_existing" },
    });

    const rebuild = strategies.find((strategy) => strategy.id === "demolish_rebuild");

    expect(rebuild?.recommendation).toBe("recommended");
    expect(rebuild?.title).toBe("Build new dwelling(s)");
    expect(rebuild?.costItems.some((item) => item.label === "Demolition")).toBe(false);
    expect(rebuild?.costItems).toContainEqual({ label: "TDR/TTR transfer right", low: 160_000, high: 250_000 });
    expect(rebuild?.assumptions.some((item) => /TDR\/TTR/.test(item))).toBe(true);
  });

  it("does not apply a generic terrace/townhouse typology GDV discount", () => {
    const fourLotResult: LotResult = {
      ...lotResult,
      lots: 4,
      min_lot_size: 320,
      zone_label: "Mixed Housing Urban",
      sqm_per_lot: 185,
    };
    const assessment = buildFallbackDevelopmentStrategyAssessment(
      merged({ build_year: 1960, zone_code: "MHU", min_lot_size_sqm: 320 }),
      fourLotResult,
    );
    const context: NeighbourhoodContext = {
      assessedLots: 7,
      radiusM: 90,
      publicHousingSignal: { level: "none", count: 0, assessedLots: 7, confidence: "high" },
      terraceHousingSignal: { level: "high", count: 4, assessedLots: 7, confidence: "medium" },
      confidence: "high",
      marketAdjustment: { gdvMultiplier: 0.97, applied: true, reason: "Local public-housing concentration detected with medium confidence; GDV adjusted by 3% to reflect buyer-perception risk." },
      reasons: [],
    };
    const strategies = calculateDevelopmentStrategies({
      data: merged({ build_year: 1960, zone_code: "MHU", min_lot_size_sqm: 320 }),
      baseCosts: { ...baseCosts, units: 4, total_low: 3_000_000, total_high: 3_500_000 },
      lotResult: fourLotResult,
      avgSalePrice: 1_050_000,
      avgPricePerSqm: 8_000,
      interestRateOutlook: "stable",
      assessment,
      marketGdvMultiplier: 0.97,
      typologyMatchedComparables: false,
      neighbourhoodContext: context,
    });

    const rebuild = strategies.find((strategy) => strategy.id === "demolish_rebuild");
    const scenario = rebuild?.roiScenarios[0];
    const expectedSourceBackedGdv = Math.round(estimateGdvPerLot(8_000, 1_050_000, fourLotResult.sqm_per_lot) * 0.97 * Math.pow(1.02, 3) / 1000) * 1000;

    expect(scenario?.gdv_per_lot).toBe(expectedSourceBackedGdv);
    expect(rebuild?.assumptions.some((a) => /typology discount|terrace\/townhouse comparables|standalone-house/i.test(a))).toBe(false);
    expect(rebuild?.assumptions.some((a) => /buyer-perception risk/i.test(a))).toBe(true);
  });
});
