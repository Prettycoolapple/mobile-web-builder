import type { CostBreakdown } from "./cost-estimator";
import type { LotResult } from "./lot-calculator";
import type { MergedPropertyData } from "./scrapers/merge";
import {
  calculateScenariosFromGdv,
  estimateGdvPerLot,
  exitGdvTypologyDiscountFactor,
  type DevelopmentStrategyId,
  type InterestRateOutlook,
  type RefurbishmentScope,
  type ROIScenario,
} from "./roi-calculator";
import { roundToNearest } from "./utils";

export type { DevelopmentStrategyId, RefurbishmentScope };

export type DevelopmentStrategyRecommendationStatus = "recommended" | "viable" | "not_recommended";

export interface DevelopmentStrategyAssessment {
  recommended_strategy: DevelopmentStrategyId;
  confidence: number;
  rationale: string;
  refurbish_scope: RefurbishmentScope;
  strategy_rationales: Record<DevelopmentStrategyId, string>;
  strategy_rationales_zh?: Partial<Record<DevelopmentStrategyId, string>>;
  key_factors: string[];
}

export interface DevelopmentStrategyCostItem {
  label: string;
  low: number;
  high: number;
}

export interface DevelopmentStrategyScenario {
  id: DevelopmentStrategyId;
  title: string;
  recommendation: DevelopmentStrategyRecommendationStatus;
  confidence: number;
  rationale: string;
  rationale_zh?: string;
  assumptions: string[];
  refurbishScope?: RefurbishmentScope;
  totalCostLow: number;
  totalCostHigh: number;
  costPerUnitAvg: number;
  costItems: DevelopmentStrategyCostItem[];
  roiScenarios: ROIScenario[];
}

const STRATEGY_TITLES: Record<DevelopmentStrategyId, string> = {
  hold_existing: "Do nothing / hold existing dwelling",
  refurbish: "Refurbish existing dwelling",
  demolish_rebuild: "Demolish and rebuild",
};

const REFURB_RATES: Record<Exclude<RefurbishmentScope, "none">, { low: number; high: number; uplift: number }> = {
  light: { low: 600, high: 1000, uplift: 1.06 },
  moderate: { low: 1200, high: 1800, uplift: 1.12 },
  heavy: { low: 1800, high: 2800, uplift: 1.20 },
};

function r(n: number): number {
  return roundToNearest(n, 1000);
}

function ageFromBuildYear(buildYear: number | null): number | null {
  return buildYear ? new Date().getFullYear() - buildYear : null;
}

function isDevelopmentZone(zoneCode: string | null): boolean {
  return zoneCode === "MHS" || zoneCode === "MHU" || zoneCode === "THAB";
}

function hasExistingDwelling(data: MergedPropertyData): boolean {
  if (data.build_year != null) return true;
  if (data.floor_area_sqm != null && data.floor_area_sqm >= 30) return true;
  if (data.bedrooms != null && data.bedrooms > 0) return true;
  if (data.bathrooms != null && data.bathrooms > 0) return true;
  return false;
}

export function buildFallbackDevelopmentStrategyAssessment(
  data: MergedPropertyData,
  lots: LotResult,
): DevelopmentStrategyAssessment {
  const age = ageFromBuildYear(data.build_year);
  const hasDwelling = hasExistingDwelling(data);
  const hasMultipleLotPotential = lots.lots > 1 && isDevelopmentZone(data.zone_code);
  const intensiveLots = lots.lots >= 4 && isDevelopmentZone(data.zone_code);

  let recommended: DevelopmentStrategyId = hasDwelling ? "refurbish" : "demolish_rebuild";
  let scope: RefurbishmentScope = hasDwelling ? "moderate" : "none";
  const factors: string[] = [];

  if (age != null) factors.push(`Dwelling age is approximately ${age} years`);
  if (!hasDwelling) {
    factors.push("Vacant site - no existing dwelling or demolition allowance needed");
  }
  if (intensiveLots) {
    factors.push(
      `${lots.lots} potential lots imply major capital, long programme, and staged sales — absorption and holding costs can materially reduce annualised returns`,
    );
  }
  if (!hasDwelling) {
    recommended = "demolish_rebuild";
    scope = "none";
  } else if (data.build_year && data.build_year >= 2010) {
    recommended = "hold_existing";
    scope = "light";
    factors.push("Modern post-2010 dwelling makes demolition value-destructive unless land value is exceptional");
  } else if (hasMultipleLotPotential && (age == null || age >= 35 || data.asbestos_risk === "high")) {
    recommended = "demolish_rebuild";
    scope = "heavy";
    factors.push("Older dwelling and zoning/land area support a redevelopment option");
  } else if (age != null && age <= 25) {
    recommended = "hold_existing";
    scope = "light";
    factors.push("Relatively recent dwelling is more likely to retain value as-is");
  } else {
    recommended = "refurbish";
    scope = age != null && age > 45 ? "heavy" : "moderate";
    factors.push("Existing dwelling age suggests refurbishment should be tested before demolition");
  }

  return {
    recommended_strategy: recommended,
    confidence: intensiveLots ? 0.48 : 0.62,
    rationale: fallbackRationale(recommended, data, lots),
    refurbish_scope: scope,
    strategy_rationales: {
      hold_existing: !hasDwelling
        ? "Holding preserves the land position, but it does not create dwelling value on a vacant site."
        : data.build_year && data.build_year >= 2010
        ? "Modern dwelling condition is likely to preserve more value by avoiding unnecessary demolition and construction risk."
        : "Holding limits capital works, but may underuse the land if redevelopment potential is strong.",
      refurbish: hasDwelling
        ? "Refurbishment tests a middle path with lower capital exposure than full rebuild while improving resale appeal."
        : "No existing dwelling was identified, so refurbishment is not applicable.",
      demolish_rebuild: !hasDwelling
        ? "New-build feasibility should be tested from the land value, service availability, contour, and consent constraints without adding demolition cost."
        : hasMultipleLotPotential
        ? "Rebuild may unlock land value if planning, services, and comparable-sale evidence support new dwellings."
        : "Full rebuild carries high capital cost and may not be justified without clear planning or resale upside.",
    },
    strategy_rationales_zh: {
      hold_existing: data.build_year && data.build_year >= 2010
        ? "该住宅建造年份较新，避免不必要的拆除与重建风险、保留现有房屋更可能保值。"
        : "保留现状可控制资本支出，但若重建潜力较强，可能未充分利用土地价值。",
      refurbish: "翻新方案在较低资本投入与提升转售价值之间取得平衡，是拆除重建的中间路线。",
      demolish_rebuild: hasMultipleLotPotential
        ? "若规划条件、市政配套及可比成交数据支持新建，重建可释放土地价值。"
        : "全面重建资本投入较高，在规划条件或转售空间不明确的情况下，可能难以证明其合理性。",
    },
    key_factors: factors,
  };
}

function fallbackRationale(strategy: DevelopmentStrategyId, data: MergedPropertyData, lots: LotResult): string {
  const hasDwelling = hasExistingDwelling(data);
  if (strategy === "hold_existing") {
    return data.build_year
      ? `The dwelling was built in ${data.build_year}, so preserving the existing house should be tested before adding demolition or rebuild cost.`
      : hasDwelling
        ? "The safest baseline is to test the existing dwelling first because build condition is not fully confirmed."
        : "Holding is the land-only baseline because no existing dwelling was identified.";
  }
  if (strategy === "demolish_rebuild") {
    if (!hasDwelling) {
      return `The site appears vacant, so the new-build scenario excludes demolition and tests development feasibility against ${lots.lots} potential lot${lots.lots === 1 ? "" : "s"}.`;
    }
    return `The site has ${lots.lots} potential lot${lots.lots === 1 ? "" : "s"} and the existing dwelling appears old enough that redevelopment may unlock more value.`;
  }
  return hasDwelling
    ? "A refurbishment path balances lower capital cost against improved resale value and should be compared with holding and rebuilding."
    : "Refurbishment is not applicable because no existing dwelling was identified.";
}

function fallbackRationaleZh(strategy: DevelopmentStrategyId, data: MergedPropertyData, lots: LotResult): string {
  if (strategy === "hold_existing") {
    return data.build_year
      ? `该住宅建于 ${data.build_year} 年，建议在考虑拆除或重建成本前，先评估保留现有房屋的可行性。`
      : "在建筑状况未完全确认之前，以测试现有住宅价值为最稳健的基准策略。";
  }
  if (strategy === "demolish_rebuild") {
    return `该地块具有 ${lots.lots} 个潜在地块，现有住宅年代已久，重建可能释放更高价值。`;
  }
  return "翻新方案在较低资本支出与提升转售价值之间取得平衡，建议与保留现状及重建方案进行比较。";
}

function makeZeroCostBreakdown(base: CostBreakdown, units: number): CostBreakdown {
  const cv = base.land_cv_nzd ?? 0;
  const safeUnits = Math.max(1, units);
  return {
    land_cv_nzd: base.land_cv_nzd,
    cv_unavailable: base.cv_unavailable,
    demo_low: 0,
    demo_high: 0,
    demo_vacant: base.demo_vacant,
    retaining_low: 0,
    retaining_high: 0,
    retaining_unknown: base.retaining_unknown,
    services_low: 0,
    services_high: 0,
    construction_low: 0,
    construction_high: 0,
    consents_low: 0,
    consents_high: 0,
    finance_low: r(cv * 0.075),
    finance_high: r(cv * 0.075 * 2),
    contingency_low: 0,
    contingency_high: 0,
    total_low: r(cv + cv * 0.075),
    total_high: r(cv + cv * 0.075 * 2),
    total_excludes_land: base.total_excludes_land,
    units: safeUnits,
    cost_per_unit_avg: r((cv + cv * 0.075 * 1.5) / safeUnits),
    has_existing_dwelling: base.has_existing_dwelling,
  };
}

function makeRefurbishCostBreakdown(
  base: CostBreakdown,
  floorAreaSqm: number,
  scope: RefurbishmentScope,
): CostBreakdown {
  const cv = base.land_cv_nzd ?? 0;
  const effectiveScope = scope === "none" ? "light" : scope;
  const rates = REFURB_RATES[effectiveScope];
  const refurbLow = floorAreaSqm * rates.low;
  const refurbHigh = floorAreaSqm * rates.high;
  const consentsLow = refurbLow * 0.05;
  const consentsHigh = refurbHigh * 0.10;
  const financeLow = (cv + refurbLow * 0.5) * 0.075;
  const financeHigh = (cv + refurbHigh * 0.5) * 0.075 * 2;
  const subtotalLow = refurbLow + consentsLow + financeLow;
  const subtotalHigh = refurbHigh + consentsHigh + financeHigh;
  const contingencyLow = subtotalLow * 0.08;
  const contingencyHigh = subtotalHigh * 0.12;
  const totalLow = cv + subtotalLow + contingencyLow;
  const totalHigh = cv + subtotalHigh + contingencyHigh;

  return {
    land_cv_nzd: base.land_cv_nzd,
    cv_unavailable: base.cv_unavailable,
    demo_low: 0,
    demo_high: 0,
    demo_vacant: base.demo_vacant,
    retaining_low: 0,
    retaining_high: 0,
    retaining_unknown: base.retaining_unknown,
    services_low: 0,
    services_high: 0,
    construction_low: r(refurbLow),
    construction_high: r(refurbHigh),
    consents_low: r(consentsLow),
    consents_high: r(consentsHigh),
    finance_low: r(financeLow),
    finance_high: r(financeHigh),
    contingency_low: r(contingencyLow),
    contingency_high: r(contingencyHigh),
    total_low: r(totalLow),
    total_high: r(totalHigh),
    total_excludes_land: base.total_excludes_land,
    units: 1,
    cost_per_unit_avg: r((totalLow + totalHigh) / 2),
    has_existing_dwelling: base.has_existing_dwelling,
  };
}

function costItemsForStrategy(id: DevelopmentStrategyId, costs: CostBreakdown): DevelopmentStrategyCostItem[] {
  const landLabel = costs.land_cv_nzd != null ? "Land (CV)" : "Land (CV — unavailable)";
  const items: DevelopmentStrategyCostItem[] = [
    { label: landLabel, low: costs.land_cv_nzd ?? 0, high: costs.land_cv_nzd ?? 0 },
  ];
  if (id === "demolish_rebuild") {
    items.push(
      { label: "Demolition", low: costs.demo_low, high: costs.demo_high },
      { label: "Construction", low: costs.construction_low, high: costs.construction_high },
      { label: "Retaining Walls", low: costs.retaining_low, high: costs.retaining_high },
      { label: "Services & Infrastructure", low: costs.services_low, high: costs.services_high },
    );
  } else if (id === "refurbish") {
    items.push({ label: "Refurbishment", low: costs.construction_low, high: costs.construction_high });
  }
  items.push(
    { label: "Consents & Professionals", low: costs.consents_low, high: costs.consents_high },
    { label: "Finance / Holding", low: costs.finance_low, high: costs.finance_high },
    { label: "Contingency", low: costs.contingency_low, high: costs.contingency_high },
  );
  return items.filter((item) => item.low > 0 || item.high > 0 || item.label.startsWith("Land"));
}

function existingDwellingValue(data: MergedPropertyData, avgSalePrice: number, avgPricePerSqm: number): number {
  const floorArea = data.floor_area_sqm ?? 0;
  const floorBased = avgPricePerSqm > 0 && floorArea > 0 ? avgPricePerSqm * floorArea : 0;
  return r(Math.max(avgSalePrice, floorBased));
}

function statusFor(id: DevelopmentStrategyId, assessment: DevelopmentStrategyAssessment, scenarios: ROIScenario[]): DevelopmentStrategyRecommendationStatus {
  if (id === assessment.recommended_strategy) return "recommended";
  if (scenarios.some((scenario) => scenario.viable)) return "viable";
  return "not_recommended";
}

function buildAssumptions(
  id: DevelopmentStrategyId,
  data: MergedPropertyData,
  lotResult: LotResult,
  hasComparablePricing: boolean,
  scope: RefurbishmentScope,
  comparablesQuality?: "live" | "estimated" | "unavailable",
  exitTypologyMultiplier?: number,
): string[] {
  const assumptions: string[] = [];
  const n = lotResult.lots;
  const intensiveMultiLot = id === "demolish_rebuild" && n >= 4;
  // "No demolition cost included" is only relevant when there is no real pricing context
  // (comparable data present → the hold-existing cost model already reflects market realities)
  if (id === "hold_existing" && !hasComparablePricing) {
    assumptions.push("No demolition, refurbishment, or new-build construction cost included.");
  }
  if (id === "refurbish") {
    assumptions.push(`${scope[0].toUpperCase()}${scope.slice(1)} refurbishment scope applied to existing floor area.`);
  }
  if (id === "demolish_rebuild") {
    assumptions.push(
      `${n} potential lot${n === 1 ? "" : "s"} / new dwelling${n === 1 ? "" : "s"} modelled; construction, consents, finance, and contingency scale with the dwelling count.`,
    );
  }
  if (intensiveMultiLot) {
    assumptions.push(
      "Phased construction and staged unit sales are likely — full GDV is rarely realised in a short window; holding costs and absorption risk reduce annualised returns versus the headline project ROI.",
    );
    if (comparablesQuality === "estimated") {
      assumptions.push("Exit pricing uses listing-ask comparables — staged delivery over several years adds market-timing risk not fully captured in a single snapshot.");
    }
  }
  if (
    id === "demolish_rebuild" &&
    exitTypologyMultiplier != null &&
    exitTypologyMultiplier < 0.999
  ) {
    assumptions.push(
      "Total development value (GDV) is discounted versus raw suburb comparables: those sales are often standalone houses, while this scenario models smaller terrace or townhouse lots — a different buyer product and typically lower achievable pricing per dwelling.",
    );
  }
  return assumptions;
}

export function calculateDevelopmentStrategies(params: {
  data: MergedPropertyData;
  baseCosts: CostBreakdown;
  lotResult: LotResult;
  avgSalePrice: number;
  avgPricePerSqm: number;
  interestRateOutlook: InterestRateOutlook;
  assessment: DevelopmentStrategyAssessment;
  comparablesQuality?: "live" | "estimated" | "unavailable";
}): DevelopmentStrategyScenario[] {
  const { data, baseCosts, lotResult, avgSalePrice, avgPricePerSqm, interestRateOutlook, assessment, comparablesQuality } = params;
  const hasDwelling = hasExistingDwelling(data);
  const effectiveAssessment: DevelopmentStrategyAssessment = !hasDwelling && assessment.recommended_strategy !== "demolish_rebuild"
    ? {
        ...assessment,
        recommended_strategy: "demolish_rebuild",
        refurbish_scope: "none",
        rationale: fallbackRationale("demolish_rebuild", data, lotResult),
        strategy_rationales: {
          ...assessment.strategy_rationales,
          hold_existing: "Holding preserves the land position, but it does not create dwelling value on a vacant site.",
          refurbish: "No existing dwelling was identified, so refurbishment is not applicable.",
          demolish_rebuild: "New-build feasibility should be tested from the land value, service availability, contour, and consent constraints without adding demolition cost.",
        },
      }
    : assessment;
  const hasComparablePricing = avgSalePrice > 0 || avgPricePerSqm > 0;
  const floorArea = Math.max(80, data.floor_area_sqm ?? 120);
  const refurbScope = effectiveAssessment.refurbish_scope === "none" ? "light" : effectiveAssessment.refurbish_scope;
  const lotIntensityPenalty =
    lotResult.lots >= 7 ? 0.2 : lotResult.lots >= 5 ? 0.16 : lotResult.lots >= 4 ? 0.12 : 0;
  const exitTypologyMultiplier = exitGdvTypologyDiscountFactor(
    data.zone_code,
    lotResult.lots,
    lotResult.sqm_per_lot,
  );

  const holdCosts = makeZeroCostBreakdown(baseCosts, 1);
  const refurbCosts = makeRefurbishCostBreakdown(baseCosts, floorArea, refurbScope);
  const rebuildCosts = baseCosts;

  const existingValue = existingDwellingValue(data, avgSalePrice, avgPricePerSqm);
  const refurbValue = r(existingValue * REFURB_RATES[refurbScope].uplift);
  const rebuildGdvPerLot = hasComparablePricing
    ? r(estimateGdvPerLot(avgPricePerSqm, avgSalePrice, lotResult.sqm_per_lot) * exitTypologyMultiplier)
    : 0;
  const rebuildValue = r(rebuildGdvPerLot * Math.max(1, lotResult.lots));

  const rows: Array<{ id: DevelopmentStrategyId; costs: CostBreakdown; gdv: number; units: number; sqmPerLot: number; gdvPerLot: number }> = [
    { id: "hold_existing", costs: holdCosts, gdv: existingValue, units: 1, sqmPerLot: data.land_area_sqm ?? lotResult.sqm_per_lot, gdvPerLot: existingValue },
    { id: "refurbish", costs: refurbCosts, gdv: refurbValue, units: 1, sqmPerLot: data.land_area_sqm ?? lotResult.sqm_per_lot, gdvPerLot: refurbValue },
    { id: "demolish_rebuild", costs: rebuildCosts, gdv: rebuildValue, units: lotResult.lots, sqmPerLot: lotResult.sqm_per_lot, gdvPerLot: rebuildGdvPerLot },
  ];

  return rows.map((row) => {
    const roiScenarios = hasComparablePricing && row.gdv > 0
      ? calculateScenariosFromGdv(row.costs, row.gdv, row.units, row.sqmPerLot, row.gdvPerLot, interestRateOutlook)
      : [];
    const baseConf =
      row.id === effectiveAssessment.recommended_strategy ? effectiveAssessment.confidence : Math.max(0.35, effectiveAssessment.confidence - 0.15);
    const confidence = Math.max(0.25, parseFloat((baseConf - lotIntensityPenalty).toFixed(2)));
    return {
      id: row.id,
      title: row.id === "demolish_rebuild" && !hasDwelling ? "Build new dwelling(s)" : STRATEGY_TITLES[row.id],
      recommendation: statusFor(row.id, effectiveAssessment, roiScenarios),
      confidence,
      rationale: effectiveAssessment.strategy_rationales[row.id] ?? fallbackRationale(row.id, data, lotResult),
      rationale_zh: effectiveAssessment.strategy_rationales_zh?.[row.id] ?? fallbackRationaleZh(row.id, data, lotResult),
      assumptions: buildAssumptions(
        row.id,
        data,
        lotResult,
        hasComparablePricing,
        refurbScope,
        comparablesQuality,
        exitTypologyMultiplier,
      ),
      refurbishScope: row.id === "refurbish" ? refurbScope : undefined,
      totalCostLow: row.costs.total_low,
      totalCostHigh: row.costs.total_high,
      costPerUnitAvg: row.costs.cost_per_unit_avg,
      costItems: costItemsForStrategy(row.id, row.costs),
      roiScenarios,
    };
  });
}
