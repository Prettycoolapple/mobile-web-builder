import { estimateCosts, type CostBreakdown } from "./cost-estimator";
import type { LotResult, SubdivisionPathwayAssessment } from "./lot-calculator";
import type { MergedPropertyData } from "./scrapers/merge";
import {
  calculateScenariosFromGdv,
  estimateGdvPerLot,
  type DevelopmentStrategyId,
  type InterestRateOutlook,
  type RefurbishmentScope,
  type ROIScenario,
} from "./roi-calculator";
import type { NeighbourhoodContext } from "./neighbourhood-context";
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
  integrated_consent: "Integrated consent concept",
};

const STRATEGY_TITLES_ZH: Record<DevelopmentStrategyId, string> = {
  hold_existing: "保持现状",
  refurbish: "翻新",
  demolish_rebuild: "拆除重建",
  integrated_consent: "综合许可概念方案",
};

/**
 * Suburb comparable sales are typically for standalone dwellings.
 * Units, apartments, and terrace/townhouse properties sell at a significant
 * discount to those comparables — this factor is applied to the "hold existing"
 * and "refurbish" GDV when the subject property's typology is unit or terrace.
 *
 * 0.53 ≈ median NZ unit/townhouse price as a fraction of equivalent-suburb
 * standalone house prices (Auckland 2023–2025 data).
 */
const UNIT_RESALE_DISCOUNT = 0.53;

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
      integrated_consent: "A higher-density integrated land-use and subdivision concept may be tested only where site layout, servicing, and consent risk justify further design work.",
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
  if (strategy === "integrated_consent") {
    return "This concept tests whether a design-led land-use and subdivision consent could support more dwellings/lots than the standard vacant-lot test, with higher consent and layout sensitivity.";
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
  if (strategy === "integrated_consent") {
    return "综合许可概念方案用于测试设计导向的更高密度开发可能性，但对许可、布局与市政配套更敏感。";
  }
  return "翻新方案在较低资本支出与提升转售价值之间取得平衡，建议与保留现状及重建方案进行比较。";
}

function makeHoldExistingCostBreakdown(
  base: CostBreakdown,
  units: number,
  acquisitionCostOverride?: number,
): CostBreakdown {
  const cv = base.land_cv_nzd ?? 0;
  // CV is council-set and often 1-2 years stale — a buyer typically pays
  // market value (= the comparable-based estimate the GDV side uses), not CV.
  // When the caller can supply a market-value acquisition basis, use it so
  // the ROI denominator reflects the true capital outlay. Without this the
  // "hold existing" ROI compared a market-value GDV against a stale-CV cost
  // basis and looked like a free lunch (e.g. 8 Hampton Drive showed 74% 2y
  // ROI for "do nothing").
  const acquisitionCost = Math.max(cv, acquisitionCostOverride ?? 0);
  const safeUnits = Math.max(1, units);
  // Holding the existing dwelling should not inherit the development finance /
  // contingency stack used for subdivision or rebuild work.
  const holdingLow = acquisitionCost * 0.01;
  const holdingHigh = acquisitionCost * 0.025;
  const contingencyLow = 0;
  const contingencyHigh = acquisitionCost * 0.005;
  const totalLow = acquisitionCost + holdingLow + contingencyLow;
  const totalHigh = acquisitionCost + holdingHigh + contingencyHigh;
  return {
    land_cv_nzd: base.land_cv_nzd,
    cv_unavailable: base.cv_unavailable,
    demo_low: 0,
    demo_high: 0,
    demo_vacant: base.demo_vacant,
    retaining_low: 0,
    retaining_high: 0,
    retaining_unknown: base.retaining_unknown,
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
    finance_low: r(holdingLow),
    finance_high: r(holdingHigh),
    contingency_low: r(contingencyLow),
    contingency_high: r(contingencyHigh),
    total_low: r(totalLow),
    total_high: r(totalHigh),
    total_excludes_land: base.total_excludes_land,
    units: safeUnits,
    cost_per_unit_avg: r(((totalLow + totalHigh) / 2) / safeUnits),
    has_existing_dwelling: base.has_existing_dwelling,
  };
}

function makeRefurbishCostBreakdown(
  base: CostBreakdown,
  floorAreaSqm: number,
  scope: RefurbishmentScope,
  acquisitionCostOverride?: number,
): CostBreakdown {
  const cv = base.land_cv_nzd ?? 0;
  // Use the market-value acquisition basis (max of CV and the caller-supplied
  // market estimate) so the ROI denominator reflects real outlay — see
  // makeHoldExistingCostBreakdown rationale.
  const acquisitionCost = Math.max(cv, acquisitionCostOverride ?? 0);
  const effectiveScope = scope === "none" ? "light" : scope;
  const rates = REFURB_RATES[effectiveScope];
  const refurbLow = floorAreaSqm * rates.low;
  const refurbHigh = floorAreaSqm * rates.high;
  const consentsLow = refurbLow * 0.05;
  const consentsHigh = refurbHigh * 0.10;
  const financeLow = (acquisitionCost + refurbLow * 0.5) * 0.075;
  const financeHigh = (acquisitionCost + refurbHigh * 0.5) * 0.075 * 2;
  const subtotalLow = refurbLow + consentsLow + financeLow;
  const subtotalHigh = refurbHigh + consentsHigh + financeHigh;
  const contingencyLow = subtotalLow * 0.08;
  const contingencyHigh = subtotalHigh * 0.12;
  const totalLow = acquisitionCost + subtotalLow + contingencyLow;
  const totalHigh = acquisitionCost + subtotalHigh + contingencyHigh;

  return {
    land_cv_nzd: base.land_cv_nzd,
    cv_unavailable: base.cv_unavailable,
    demo_low: 0,
    demo_high: 0,
    demo_vacant: base.demo_vacant,
    retaining_low: 0,
    retaining_high: 0,
    retaining_unknown: base.retaining_unknown,
    tdr_ttr_low: 0,
    tdr_ttr_high: 0,
    tdr_ttr_required: false,
    tdr_ttr_note: null,
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
  if (id === "demolish_rebuild" || id === "integrated_consent") {
    items.push(
      { label: "Demolition", low: costs.demo_low, high: costs.demo_high },
      { label: "Construction", low: costs.construction_low, high: costs.construction_high },
      { label: "Retaining Walls", low: costs.retaining_low, high: costs.retaining_high },
      { label: "TDR/TTR transfer right", low: costs.tdr_ttr_low, high: costs.tdr_ttr_high },
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
  if (data.listing_active && data.listing_price != null && data.listing_price > 0) {
    return r(Math.max(data.listing_price, data.cv_nzd ?? 0));
  }
  if (data.cv_nzd != null && data.cv_nzd > 0) {
    if (data.typology === "unit_apartment" || data.typology === "terrace_townhouse") {
      return r(Math.max(data.cv_nzd, avgSalePrice));
    }
    return r(data.cv_nzd);
  }
  const floorArea = data.floor_area_sqm ?? 0;
  const floorBased = avgPricePerSqm > 0 && floorArea > 0 ? avgPricePerSqm * floorArea : 0;
  return r(Math.max(floorBased, avgSalePrice));
}

function hasViableReturn(scenarios: ROIScenario[]): boolean {
  return scenarios.some((scenario) => scenario.viable || scenario.cases.some((c) => c.viable));
}

function bestBaseAnnualisedReturn(scenarios: ROIScenario[]): number | null {
  let best: number | null = null;
  for (const scenario of scenarios) {
    const baseCase = scenario.cases.find((c) => c.case === "base");
    const annualised = baseCase?.annualised_roi_percent ?? scenario.annualised_roi_percent;
    if (Number.isFinite(annualised)) {
      best = best == null ? annualised : Math.max(best, annualised);
    }
  }
  return best;
}

function selectRoiBackedRecommendation(
  strategies: DevelopmentStrategyScenario[],
  fallback: DevelopmentStrategyId,
): DevelopmentStrategyId {
  const scored = strategies
    .map((strategy) => ({
      id: strategy.id,
      score: bestBaseAnnualisedReturn(strategy.roiScenarios),
      viable: hasViableReturn(strategy.roiScenarios),
      totalCostMid: (strategy.totalCostLow + strategy.totalCostHigh) / 2,
      fallbackMatch: strategy.id === fallback,
    }))
    .filter((strategy): strategy is typeof strategy & { score: number } => strategy.score != null);

  if (scored.length === 0) return fallback;

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.viable !== b.viable) return a.viable ? -1 : 1;
    if (a.fallbackMatch !== b.fallbackMatch) return a.fallbackMatch ? -1 : 1;
    return a.totalCostMid - b.totalCostMid;
  });

  return scored[0].id;
}

function roiAlignedStatus(id: DevelopmentStrategyId, recommendedId: DevelopmentStrategyId, scenarios: ROIScenario[]): DevelopmentStrategyRecommendationStatus {
  if (id === recommendedId) return "recommended";
  if (hasViableReturn(scenarios)) return "viable";
  return "not_recommended";
}

function appendRoiSelectionReason(
  strategy: DevelopmentStrategyScenario,
  roiRecommendedId: DevelopmentStrategyId,
  assessmentRecommendedId: DevelopmentStrategyId,
): DevelopmentStrategyScenario {
  if (strategy.id !== roiRecommendedId || roiRecommendedId === assessmentRecommendedId) return strategy;

  if (strategy.id === "hold_existing") {
    return {
      ...strategy,
      rationale: "Holding/do nothing is ranked first by ROI only because it avoids near-term capital works; treat it as a low-capital benchmark, not a positive long-term recommendation. The planning and condition assessment still indicates redevelopment should be professionally tested.",
      rationale_zh: strategy.rationale_zh
        ? "当前 ROI 测算将保持现状排在第一，主要是因为它避免了近期资本支出；请把它视为低资本投入基准，而不是积极的长期持有建议。规划和房屋状况评估仍显示，应由专业人士测试重开发方案。"
        : strategy.rationale_zh,
    };
  }

  return {
    ...strategy,
    rationale: `${strategy.rationale} The computed ROI scenarios currently rank this option ahead of ${STRATEGY_TITLES[assessmentRecommendedId].toLowerCase()}.`,
    rationale_zh: strategy.rationale_zh
      ? `${strategy.rationale_zh} 当前 ROI 测算显示，该方案优于${STRATEGY_TITLES_ZH[assessmentRecommendedId]}。`
      : strategy.rationale_zh,
  };
}

function buildAssumptions(
  id: DevelopmentStrategyId,
  data: MergedPropertyData,
  lotResult: LotResult,
  hasComparablePricing: boolean,
  scope: RefurbishmentScope,
  comparablesQuality?: "live" | "estimated" | "unavailable",
  exitTypologyMultiplier?: number,
  marketGdvMultiplier?: number,
  typologyMatchedComparables?: boolean,
  neighbourhoodContext?: NeighbourhoodContext | null,
): string[] {
  const assumptions: string[] = [];
  const n = lotResult.lots;
  const intensiveMultiLot = (id === "demolish_rebuild" || id === "integrated_consent") && n >= 4;
  // "No demolition cost included" is only relevant when there is no real pricing context
  // (comparable data present → the hold-existing cost model already reflects market realities)
  if (id === "hold_existing" && !hasComparablePricing) {
    assumptions.push("No demolition, refurbishment, or new-build construction cost included.");
  }
  if (id === "refurbish") {
    assumptions.push(`${scope[0].toUpperCase()}${scope.slice(1)} refurbishment scope applied to existing floor area.`);
  }
  if (id === "demolish_rebuild" || id === "integrated_consent") {
    assumptions.push(
      `${n} potential lot${n === 1 ? "" : "s"} / new dwelling${n === 1 ? "" : "s"} modelled; construction, consents, finance, and contingency scale with the dwelling count.`,
    );
    if (data.zone_code && ["CLZ", "LLRZ", "RCSZ", "RUR"].includes(data.zone_code.toUpperCase()) && n > 1) {
      assumptions.push("Rural/countryside title creation may require a transferable rural site right (TDR/TTR); allowance is included for each additional title and must be confirmed at resource consent stage.");
    }
  }
  if (intensiveMultiLot) {
    assumptions.push(
      "Phased construction and staged unit sales are likely — full GDV is rarely realised in a short window; holding costs and absorption risk reduce annualised returns versus the headline project ROI.",
    );
    if (comparablesQuality === "estimated") {
      assumptions.push("Exit pricing uses listing-ask comparables — staged delivery over several years adds market-timing risk not fully captured in a single snapshot.");
    }
  }
  if (marketGdvMultiplier != null && marketGdvMultiplier < 0.999 && neighbourhoodContext?.marketAdjustment.reason) {
    assumptions.push(neighbourhoodContext.marketAdjustment.reason);
  }
  // Unit / apartment / terrace resale discount note
  if ((id === "hold_existing" || id === "refurbish") &&
      (data.typology === "unit_apartment" || data.typology === "terrace_townhouse")) {
    assumptions.push(
      "Exit value discounted by 47% (×0.53) from standalone comparable sales to reflect the unit/apartment resale market — units typically sell at a significant premium discount to equivalent-suburb standalone dwellings.",
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
  gdvTypologyMultiplier?: number;
  marketGdvMultiplier?: number;
  typologyMatchedComparables?: boolean;
  neighbourhoodContext?: NeighbourhoodContext | null;
  subdivisionAssessment?: SubdivisionPathwayAssessment | null;
}): DevelopmentStrategyScenario[] {
  const {
    data,
    baseCosts,
    lotResult,
    avgSalePrice,
    avgPricePerSqm,
    interestRateOutlook,
    assessment,
    comparablesQuality,
    typologyMatchedComparables,
    neighbourhoodContext,
    subdivisionAssessment,
  } = params;
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
  const exitTypologyMultiplier = params.gdvTypologyMultiplier ?? 1;
  const marketGdvMultiplier = Number.isFinite(params.marketGdvMultiplier)
    ? Math.min(1, Math.max(0.9, params.marketGdvMultiplier ?? 1))
    : 1;

  // Suburb comparable sales are almost always standalone dwellings. When the
  // subject property is a unit, apartment, or terrace/townhouse, apply a
  // discount so the "hold existing" and "refurbish" GDV reflects the actual
  // unit-market exit price rather than the overstated standalone comparable.
  const isUnitOrApartmentTypology =
    data.typology === "unit_apartment" || data.typology === "terrace_townhouse";
  const existingResaleMultiplier = isUnitOrApartmentTypology ? UNIT_RESALE_DISCOUNT : 1;

  const existingValue = r(existingDwellingValue(data, avgSalePrice, avgPricePerSqm) * marketGdvMultiplier * existingResaleMultiplier);
  const refurbValue = r(existingValue * REFURB_RATES[refurbScope].uplift);
  // For hold/refurbish, acquisition basis is the market-value estimate (not
  // CV), so ROI compares like-for-like against the same market value. Without
  // this the denominator was just CV, and any market-vs-CV gap (typical, since
  // CV lags) looked like investment return.
  const holdCosts = makeHoldExistingCostBreakdown(baseCosts, 1, existingValue);
  const refurbCosts = makeRefurbishCostBreakdown(baseCosts, floorArea, refurbScope, existingValue);
  const rebuildCosts = baseCosts;
  const rebuildGdvPerLotBeforeFloor = hasComparablePricing
    ? r(estimateGdvPerLot(avgPricePerSqm, avgSalePrice, lotResult.sqm_per_lot) * exitTypologyMultiplier * marketGdvMultiplier)
    : 0;
  const rebuildValueBeforeFloor = r(rebuildGdvPerLotBeforeFloor * Math.max(1, lotResult.lots));

  // Single-lot CV floor: a new build on a high-CV freehold site is essentially
  // always worth at least the current dated dwelling's CV (typically more —
  // the +10% accounts for the new-build premium). Comparable $/sqm × estimated
  // GFA can understate this in premium suburbs (e.g. 66A Marine Parade,
  // Mellons Bay: CV $3.85M, calc landed at $1.82M). Only applies when there's
  // exactly one resulting lot — multi-lot subdivisions intentionally trade
  // typology and are already discounted via exitGdvTypologyDiscountFactor.
  const isSingleLotRebuild = Math.max(1, lotResult.lots) === 1;
  const cvFloorForRebuild =
    isSingleLotRebuild && data.cv_nzd != null && data.cv_nzd > 0 && hasComparablePricing
      ? r(data.cv_nzd * 1.10)
      : 0;
  const rebuildValue = r(Math.max(rebuildValueBeforeFloor, cvFloorForRebuild));
  const rebuildGdvPerLot =
    isSingleLotRebuild && rebuildValue !== rebuildValueBeforeFloor
      ? rebuildValue
      : rebuildGdvPerLotBeforeFloor;

  const rows: Array<{ id: DevelopmentStrategyId; costs: CostBreakdown; gdv: number; units: number; sqmPerLot: number; gdvPerLot: number }> = [
    { id: "hold_existing", costs: holdCosts, gdv: existingValue, units: 1, sqmPerLot: data.land_area_sqm ?? lotResult.sqm_per_lot, gdvPerLot: existingValue },
    { id: "refurbish", costs: refurbCosts, gdv: refurbValue, units: 1, sqmPerLot: data.land_area_sqm ?? lotResult.sqm_per_lot, gdvPerLot: refurbValue },
    { id: "demolish_rebuild", costs: rebuildCosts, gdv: rebuildValue, units: lotResult.lots, sqmPerLot: lotResult.sqm_per_lot, gdvPerLot: rebuildGdvPerLot },
  ];
  if (subdivisionAssessment?.designLedEligible && subdivisionAssessment.designLedYieldRange) {
    const designUnits = subdivisionAssessment.designLedYieldRange.max;
    const designSqmPerLot = Math.max(1, Math.round((lotResult.net_area_sqm || data.land_area_sqm || lotResult.sqm_per_lot) / designUnits));
    const designCosts = estimateCosts(data, designUnits, {
      market_floor_price_per_sqm: avgPricePerSqm > 0 ? avgPricePerSqm : null,
      sqm_per_lot: designSqmPerLot,
    });
    const designGdvPerLot = hasComparablePricing
      ? r(estimateGdvPerLot(avgPricePerSqm, avgSalePrice, designSqmPerLot) * exitTypologyMultiplier * marketGdvMultiplier)
      : 0;
    const designValue = r(designGdvPerLot * designUnits);
    rows.push({
      id: "integrated_consent",
      costs: designCosts,
      gdv: designValue,
      units: designUnits,
      sqmPerLot: designSqmPerLot,
      gdvPerLot: designGdvPerLot,
    });
  }

  const strategies = rows.map((row) => {
    const roiScenarios = hasComparablePricing && row.gdv > 0
      ? calculateScenariosFromGdv(row.costs, row.gdv, row.units, row.sqmPerLot, row.gdvPerLot, interestRateOutlook)
      : [];
    const baseConf =
      row.id === effectiveAssessment.recommended_strategy ? effectiveAssessment.confidence : Math.max(0.35, effectiveAssessment.confidence - 0.15);
    const localMarketPenalty = marketGdvMultiplier < 0.999 ? 0.05 : 0;
    const confidence = Math.max(0.25, parseFloat((baseConf - lotIntensityPenalty - localMarketPenalty).toFixed(2)));
    return {
      id: row.id,
      title: row.id === "demolish_rebuild" && !hasDwelling ? "Build new dwelling(s)" : STRATEGY_TITLES[row.id],
      recommendation: "not_recommended" as DevelopmentStrategyRecommendationStatus,
      confidence,
      rationale: effectiveAssessment.strategy_rationales[row.id] ?? fallbackRationale(row.id, data, lotResult),
      rationale_zh: effectiveAssessment.strategy_rationales_zh?.[row.id] ?? fallbackRationaleZh(row.id, data, lotResult),
      assumptions: row.id === "integrated_consent"
        ? [
            `Indicative design-led yield range: ${subdivisionAssessment?.designLedYieldRange?.min}-${subdivisionAssessment?.designLedYieldRange?.max} subdivided lots.`,
            `ROI and costs use the maximum ${row.units}-lot design-led case, including subdivision, new dwellings, construction, consents, finance, and contingency.`,
            "Higher-risk consent/design pathway: access, servicing, stormwater, HIRB, outdoor living space, outlook, overlays, and final site layout must be tested by architects and planners.",
          ]
        : buildAssumptions(
        row.id,
        data,
        lotResult,
        hasComparablePricing,
        refurbScope,
        comparablesQuality,
        exitTypologyMultiplier,
        marketGdvMultiplier,
        typologyMatchedComparables,
        neighbourhoodContext,
      ),
      refurbishScope: row.id === "refurbish" ? refurbScope : undefined,
      totalCostLow: row.costs.total_low,
      totalCostHigh: row.costs.total_high,
      costPerUnitAvg: row.costs.cost_per_unit_avg,
      costItems: costItemsForStrategy(row.id, row.costs),
      roiScenarios,
    };
  });

  const roiRecommendedId = selectRoiBackedRecommendation(strategies, effectiveAssessment.recommended_strategy);

  return strategies.map((strategy) => appendRoiSelectionReason(
    {
      ...strategy,
      recommendation: roiAlignedStatus(strategy.id, roiRecommendedId, strategy.roiScenarios),
    },
    roiRecommendedId,
    effectiveAssessment.recommended_strategy,
  ));
}
