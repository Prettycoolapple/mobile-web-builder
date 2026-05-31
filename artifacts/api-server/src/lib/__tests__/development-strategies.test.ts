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

    // Hold-existing has no demolition, no construction, no consents — just
    // acquisition + light holding allowances. Rebuild carries the full dev
    // stack (demo, construction, consents, finance, larger contingency).
    expect(hold?.costItems.some((item) => item.label === "Demolition")).toBe(false);
    expect(hold?.costItems.some((item) => item.label === "Construction")).toBe(false);
    expect(hold?.roiScenarios.length).toBeGreaterThan(0);
    expect(hold?.costItems.find((item) => item.label === "Contingency")?.high ?? 0).toBeLessThan(
      rebuild?.costItems.find((item) => item.label === "Contingency")?.low ?? 0,
    );
    // Hold's totalCost is roughly the market-value acquisition + ~1-2.5%
    // holding allowance — it should NOT include the full rebuild dev stack.
    // (We no longer assert hold < rebuild because hold's acquisition basis is
    // now market value, which can exceed rebuild's CV-anchored baseCosts when
    // market > CV. The substantive property is exclusion of dev costs above.)
    const holdRange = (hold?.totalCostHigh ?? 0) - (hold?.totalCostLow ?? 0);
    const rebuildRange = (rebuild?.totalCostHigh ?? 0) - (rebuild?.totalCostLow ?? 0);
    expect(holdRange).toBeLessThan(rebuildRange);
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

    // "Hold existing" no longer applies the ORGANIC_ANNUAL_GROWTH_RATE
    // multiplier to its exit horizons — see calculateScenariosFromGdv's
    // suppressOrganicGrowth option. "Do nothing for N years" exits at current
    // market, not market × (1.02)^N, so GDV stays flat across the 3 horizons
    // at the CV-floored existing value (CV $3.95M > comparable-based $1.32M).
    expect(scenario?.gdv).toBe(3_950_000);
    expect(baseCase?.gdv).toBe(3_950_000);
    expect(hold?.roiScenarios.map((s) => s.gdv)).toEqual([3_950_000, 3_950_000, 3_950_000]);
    expect(hold?.totalCostLow).toBe(3_990_000);
    expect(hold?.totalCostHigh).toBe(4_069_000);
    expect(hold?.costItems.find((item) => item.label === "Contingency")?.high).toBe(20_000);
  });

  it("does not let broad suburb comparables create a free-lunch hold-existing ROI", () => {
    const data = merged({
      cv_nzd: 1_900_000,
      land_area_sqm: 833,
      floor_area_sqm: 160,
      build_year: 1964,
      bedrooms: 3,
      bathrooms: 1,
      zone_code: "MHS",
      typology: "standalone",
      listing_active: false,
      listing_price: null,
    });
    const assessment = buildFallbackDevelopmentStrategyAssessment(data, lotResult);
    const strategies = calculateDevelopmentStrategies({
      data,
      baseCosts: { ...baseCosts, land_cv_nzd: 1_900_000 },
      lotResult: { ...lotResult, zone_label: "Mixed Housing Suburban" },
      avgSalePrice: 3_380_000,
      avgPricePerSqm: 21_000,
      interestRateOutlook: "stable",
      assessment,
    });

    const hold = strategies.find((strategy) => strategy.id === "hold_existing");
    const scenario = hold?.roiScenarios[0];
    const baseCase = scenario?.cases.find((c) => c.case === "base");

    expect(scenario?.gdv).toBe(1_900_000);
    expect(baseCase?.gross_profit).toBeLessThanOrEqual(0);
    expect(baseCase?.roi_percent).toBeLessThanOrEqual(0);
    expect(scenario?.total_cost_mid).toBeGreaterThan(1_900_000);
    expect(scenario?.total_cost_mid).toBeLessThan(2_000_000);
  });

  it("floors single-lot rebuild GDV at CV × 1.10 for premium-suburb sites", () => {
    // Mirrors 66A Marine Parade, Mellons Bay: CV $3.85M, 900 sqm SHZ lot,
    // comparable $/sqm ≈ $6,000. Pre-fix the comparable-based GDV landed at
    // ~$1.82M (below current CV), which is nonsense in a $3M+ suburb.
    const data = merged({ cv_nzd: 3_850_000, land_area_sqm: 900, floor_area_sqm: 220, build_year: 1980 });
    const costs = { ...baseCosts, land_cv_nzd: 3_850_000 };
    const premiumLot: LotResult = { ...lotResult, lots: 1, sqm_per_lot: 900, gross_area_sqm: 900, net_area_sqm: 900 };
    const assessment = buildFallbackDevelopmentStrategyAssessment(data, premiumLot);
    const strategies = calculateDevelopmentStrategies({
      data,
      baseCosts: costs,
      lotResult: premiumLot,
      avgSalePrice: 3_500_000,
      avgPricePerSqm: 6_000,
      interestRateOutlook: "stable",
      assessment,
    });

    const rebuild = strategies.find((s) => s.id === "demolish_rebuild");
    const cvFloor = 3_850_000 * 1.10;
    // Rebuild GDV must clear the CV × 1.10 floor — a new build on a high-CV
    // freehold site is always worth at least the existing dated home's CV.
    // The first roiScenario's gdv is base GDV × organic growth for that
    // horizon; rebuild legitimately rides growth so this only makes the GDV
    // higher than the floor, never lower.
    const year2Gdv = rebuild?.roiScenarios[0]?.gdv ?? 0;
    expect(year2Gdv).toBeGreaterThanOrEqual(cvFloor);
  });

  it("does NOT apply the rebuild CV floor when multi-lot subdivision is the exit", () => {
    // Subdividing into 3 terraces intentionally trades typology and is
    // already handled by exitGdvTypologyDiscountFactor — the CV floor would
    // mask legitimate downside in multi-unit schemes.
    const data = merged({ cv_nzd: 3_850_000, land_area_sqm: 1500 });
    const costs = { ...baseCosts, land_cv_nzd: 3_850_000 };
    const multiLot: LotResult = { ...lotResult, lots: 3, sqm_per_lot: 500, gross_area_sqm: 1500, net_area_sqm: 1500, zone_label: "Mixed Housing Urban" };
    const assessment = buildFallbackDevelopmentStrategyAssessment(data, multiLot);
    const strategies = calculateDevelopmentStrategies({
      data,
      baseCosts: costs,
      lotResult: multiLot,
      avgSalePrice: 1_200_000,
      avgPricePerSqm: 5_000,
      interestRateOutlook: "stable",
      assessment,
    });

    const rebuild = strategies.find((s) => s.id === "demolish_rebuild");
    // No floor — the result reflects estimateGdvPerLot × 3 lots (possibly
    // below CV × 1.10 for terrace product). We assert the floor is *not*
    // mechanically applied by checking the base-year GDV (before organic
    // growth) sits below CV × 1.10. Year-2 GDV ≈ base × 1.0404, so undo that
    // multiplier for a clean comparison.
    const year2Gdv = rebuild?.roiScenarios[0]?.gdv ?? 0;
    const baseGdv = year2Gdv / Math.pow(1.02, 2);
    expect(baseGdv).toBeLessThan(3_850_000 * 1.10);
  });

  it("applies organic annual growth to refurbish and rebuild horizons but not to hold-existing", () => {
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

    const hold = strategies.find((s) => s.id === "hold_existing");
    const refurbish = strategies.find((s) => s.id === "refurbish");
    const rebuild = strategies.find((s) => s.id === "demolish_rebuild");

    // Refurbish + rebuild legitimately ride market growth during the dev cycle.
    for (const strategy of [refurbish, rebuild]) {
      expect(strategy?.roiScenarios.map((scenario) => scenario.years)).toEqual([2, 3, 4]);
      expect((strategy?.roiScenarios[1].gdv ?? 0)).toBeGreaterThan(strategy?.roiScenarios[0].gdv ?? 0);
      expect((strategy?.roiScenarios[2].gdv ?? 0)).toBeGreaterThan(strategy?.roiScenarios[1].gdv ?? 0);
    }
    // Hold-existing exits at current market — GDV is flat across horizons.
    expect(hold?.roiScenarios.map((scenario) => scenario.years)).toEqual([2, 3, 4]);
    const holdGdvs = hold?.roiScenarios.map((scenario) => scenario.gdv) ?? [];
    expect(holdGdvs[0]).toBe(holdGdvs[1]);
    expect(holdGdvs[1]).toBe(holdGdvs[2]);
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
      merged({ build_year: 1960, zone_code: "MHU", min_lot_size_sqm: 300 }),
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
      data: merged({ build_year: 1960, zone_code: "MHU", min_lot_size_sqm: 300 }),
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

  describe("unit/apartment typology resale discount (0.53)", () => {
    const unitData = merged({
      build_year: 1950,
      land_area_sqm: null,
      floor_area_sqm: 115,
      cv_nzd: 1_200_000,
      typology: "unit_apartment",
    });
    const unitCosts = { ...baseCosts, land_cv_nzd: 1_200_000 };

    it("applies a 0.53 factor to hold-existing GDV for unit_apartment typology", () => {
      const assessment = buildFallbackDevelopmentStrategyAssessment(unitData, { ...lotResult, lots: 1 });
      const strategies = calculateDevelopmentStrategies({
        data: unitData,
        baseCosts: unitCosts,
        lotResult: { ...lotResult, lots: 1 },
        avgSalePrice: 2_500_000,
        avgPricePerSqm: 10_000,
        interestRateOutlook: "falling",
        assessment,
      });

      const hold = strategies.find((s) => s.id === "hold_existing");
      const expectedDiscountedGdv = Math.round(2_500_000 * 0.53 / 1000) * 1000; // = 1_325_000
      // GDV grows by organic 2% per year across exit horizons but the base (year-0) value
      // used internally is ~1_325_000 — so the first scenario GDV should be >= 1_325_000.
      expect(hold?.roiScenarios[0]?.gdv).toBeGreaterThanOrEqual(expectedDiscountedGdv);
      // Must be significantly less than the undiscounted comparable ($2.5M)
      expect(hold?.roiScenarios[0]?.gdv).toBeLessThan(2_000_000);
    });

    it("adds a discount assumption note for unit typology on hold_existing and refurbish", () => {
      const assessment = buildFallbackDevelopmentStrategyAssessment(unitData, { ...lotResult, lots: 1 });
      const strategies = calculateDevelopmentStrategies({
        data: unitData,
        baseCosts: unitCosts,
        lotResult: { ...lotResult, lots: 1 },
        avgSalePrice: 2_500_000,
        avgPricePerSqm: 10_000,
        interestRateOutlook: "stable",
        assessment,
      });

      const hold = strategies.find((s) => s.id === "hold_existing");
      const refurbish = strategies.find((s) => s.id === "refurbish");
      const rebuild = strategies.find((s) => s.id === "demolish_rebuild");

      expect(hold?.assumptions.some((a) => /0\.53|47%|unit.*resale|resale.*unit/i.test(a))).toBe(true);
      expect(refurbish?.assumptions.some((a) => /0\.53|47%|unit.*resale|resale.*unit/i.test(a))).toBe(true);
      // demolish_rebuild is NOT affected — it has its own exit typology multiplier
      expect(rebuild?.assumptions.some((a) => /0\.53|47%|unit.*resale|resale.*unit/i.test(a))).toBe(false);
    });

    it("does NOT apply the unit discount for standalone typology", () => {
      const standaloneData = merged({ build_year: 1970, typology: "standalone" });
      const assessment = buildFallbackDevelopmentStrategyAssessment(standaloneData, lotResult);
      const strategies = calculateDevelopmentStrategies({
        data: standaloneData,
        baseCosts,
        lotResult,
        avgSalePrice: 2_500_000,
        avgPricePerSqm: 10_000,
        interestRateOutlook: "stable",
        assessment,
      });

      const hold = strategies.find((s) => s.id === "hold_existing");
      // GDV for standalone should be ≥ 2_500_000 (floored at avgSalePrice)
      expect(hold?.roiScenarios[0]?.gdv).toBe(1_800_000);
      expect(hold?.assumptions.some((a) => /0\.53|47%/i.test(a))).toBe(false);
    });

    it("uses STRATEGY_TITLES_ZH (no English) in rationale_zh when ROI recommends a different strategy", () => {
      // Set up a scenario where the assessment says hold_existing but ROI says demolish_rebuild
      const olderUnit = merged({ build_year: 1950, typology: "unit_apartment", cv_nzd: 1_200_000 });
      const assessment = buildFallbackDevelopmentStrategyAssessment(olderUnit, { ...lotResult, lots: 2 });
      // Inject a hold_existing recommended_strategy to trigger appendRoiSelectionReason
      const biasedAssessment = { ...assessment, recommended_strategy: "hold_existing" as const };
      const strategies = calculateDevelopmentStrategies({
        data: olderUnit,
        baseCosts: { ...baseCosts, land_cv_nzd: 1_200_000 },
        lotResult: { ...lotResult, lots: 2 },
        avgSalePrice: 2_500_000,
        avgPricePerSqm: 10_000,
        interestRateOutlook: "falling",
        assessment: biasedAssessment,
      });

      // Find any strategy whose rationale_zh was augmented by appendRoiSelectionReason
      const augmented = strategies.filter((s) => s.rationale_zh?.includes("当前 ROI 测算显示"));
      for (const strategy of augmented) {
        // Must not contain raw English strategy name
        expect(strategy.rationale_zh).not.toMatch(/demolish and rebuild|refurbish existing|do nothing/i);
        // Must contain a Chinese strategy name
        expect(strategy.rationale_zh).toMatch(/保持现状|翻新|拆除重建/);
      }
    });
  });
});
