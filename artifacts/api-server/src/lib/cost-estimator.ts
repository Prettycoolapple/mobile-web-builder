import type { MergedPropertyData } from "./scrapers/merge";
import { defaultRegionalCostProfile, type RegionalCostProfile } from "./regional-cost-profiles";
import { classifySiteCondition } from "./site-condition";
import { roundToNearest } from "./utils";

export interface CostBreakdown {
  /** Stable assumption-set identifier surfaced with the ROI cost model. */
  cost_profile_id?: RegionalCostProfile["id"];
  land_cv_nzd: number | null;
  cv_unavailable: boolean;
  demo_low: number;
  demo_high: number;
  demo_vacant: boolean;
  retaining_low: number;
  retaining_high: number;
  retaining_unknown: boolean;
  retaining_area_sqm_estimate?: number | null;
  large_site_terrain_adjusted?: boolean;
  tdr_ttr_low: number;
  tdr_ttr_high: number;
  tdr_ttr_required: boolean;
  tdr_ttr_note: string | null;
  services_low: number;
  services_high: number;
  /** Development contributions (Watercare IGC + council DC + stormwater) on net new dwellings. */
  contributions_low: number;
  contributions_high: number;
  contributions_units: number;
  /** Bounded extra allowance for the Veolia (Papakura) private network; 0 when out of zone. */
  veolia_low: number;
  veolia_high: number;
  veolia_in_zone: boolean;
  /** Annual council land rates (estimated from CV) and the holding-period total over the finance horizon. */
  land_rate_annual: number;
  land_rate_low: number;
  land_rate_high: number;
  construction_low: number;
  construction_high: number;
  /** 1 for normal delivery; 0.93 for the supported adjoining package model. */
  construction_cost_multiplier?: number;
  construction_discount_reason?: string | null;
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

/** Optional inputs — market $/m² comes from the same comparables pool as GDV so build cost tracks the micro-market. */
export interface EstimateCostsOptions {
  /** Median comparable finished-house $/m² (internal floor) when available */
  market_floor_price_per_sqm?: number | null;
  /** Region/provider-specific cost assumptions. Defaults match the current Auckland model. */
  cost_profile?: RegionalCostProfile | null;
  /**
   * Net lot size (m²) per new-build unit after subdivision.
   * When provided the construction floor area is derived from lot size, matching
   * the GDV estimate in roi-calculator (estimateGdvPerLot → estimateNewBuildFloorSqm).
   * Without this the calculator falls back to the existing building's floor area,
   * which can misstate multi-lot rebuild scenarios where the new dwelling size
   * differs materially from the existing house.
   */
  sqm_per_lot?: number | null;
  /** Applies only to construction, before downstream percentage allowances. */
  construction_cost_multiplier?: number | null;
  construction_discount_reason?: string | null;
}

/**
 * Total finished floor area estimate for a single new-build unit based on lot size.
 * Mirrors estimateNewBuildFloorSqm in roi-calculator.ts (kept local to avoid
 * a circular import: roi-calculator imports CostBreakdown from this module).
 * The first step estimates a plausible ground-floor footprint, then allows
 * extra upper-floor area on smaller infill lots where two-storey homes are common.
 */
function newBuildFloorSqmFromLotSize(sqmPerLot: number): number {
  const footprint = sqmPerLot * 0.38;
  const storeyMultiplier =
    sqmPerLot < 180 ? 1.55 :
    sqmPerLot < 300 ? 1.45 :
    sqmPerLot < 500 ? 1.30 :
    sqmPerLot < 650 ? 1.15 :
    1.00;
  const raw = footprint * storeyMultiplier;
  return Math.round(Math.min(320, Math.max(90, raw)));
}

/**
 * Estimate annual council land rates from Capital Value. NZ metro councils rate
 * on CV: annual ≈ cv × rateInDollarPerCv + fixedAnnualCharges. Returns 0 when CV
 * is unavailable so downstream holding-cost math stays well-defined.
 */
export function estimateAnnualLandRates(
  cv: number | null | undefined,
  costProfile: RegionalCostProfile,
): number {
  if (cv == null || !Number.isFinite(cv) || cv <= 0) return 0;
  return cv * costProfile.rates.rateInDollarPerCv + costProfile.rates.fixedAnnualCharges;
}

function effectiveNewBuildFloorSqm(floorFromProperty: number | null | undefined): number {
  const fallback = 120;
  if (floorFromProperty == null || !Number.isFinite(floorFromProperty) || floorFromProperty < 40) {
    return fallback;
  }
  return Math.min(800, Math.max(50, Math.round(floorFromProperty)));
}

/**
 * NZ residential build $/m² (incl. margin) is typically a fraction of finished
 * house $/m² in the same suburb. Anchor to comparables when present; otherwise
 * use national mid-range construction bands (contour still applies).
 */
function constructionRatesPerSqm(
  contour: MergedPropertyData["contour"],
  marketFloorPsm: number | null | undefined,
  costProfile: RegionalCostProfile,
): { low: number; high: number } {
  const m = marketFloorPsm != null && Number.isFinite(marketFloorPsm) && marketFloorPsm > 500
    ? marketFloorPsm
    : null;

  let rateLow = costProfile.construction.baseLowPerSqm;
  let rateHigh = costProfile.construction.baseHighPerSqm;

  if (m != null) {
    const anchor = Math.min(
      costProfile.construction.marketAnchorMax,
      Math.max(costProfile.construction.marketAnchorMin, m * costProfile.construction.marketAnchorFactor),
    );
    rateLow = anchor * costProfile.construction.marketLowMultiplier;
    rateHigh = anchor * costProfile.construction.marketHighMultiplier;
  }

  const contourMultiplier = contour ? costProfile.construction.contourMultipliers[contour] : null;
  if (contourMultiplier) {
    rateLow *= contourMultiplier;
    rateHigh *= contourMultiplier;
  }

  return { low: rateLow, high: rateHigh };
}

const RURAL_LIFESTYLE_ZONES = new Set(["CLZ", "LLRZ", "RCSZ", "RUR"]);
const RURAL_TRANSFER_RIGHT_ZONES = new Set(["CLZ", "LLRZ", "RCSZ", "RUR"]);

function isLargeRuralLifestyleSite(data: MergedPropertyData): boolean {
  const land = data.land_area_sqm ?? 0;
  const zone = (data.zone_code ?? "").toUpperCase();
  return land >= 10_000 || RURAL_LIFESTYLE_ZONES.has(zone);
}

function retainingBucketForContour(contour: MergedPropertyData["contour"], costProfile: RegionalCostProfile): {
  low: number;
  high: number;
} {
  if (contour) {
    const bucket = costProfile.retaining.buckets[contour];
    if (bucket) return bucket;
  }
  return { low: 0, high: 0 };
}

function estimateLargeSiteRetaining(data: MergedPropertyData, costProfile: RegionalCostProfile): {
  low: number;
  high: number;
  areaSqm: number | null;
  adjusted: boolean;
} | null {
  if (!isLargeRuralLifestyleSite(data)) return null;

  const contour = data.contour ?? null;
  if (contour == null || contour === "flat") return null;

  const land = data.land_area_sqm ?? null;
  const steepRatio = Math.max(0, Math.min(1, data.contour_steep_area_ratio ?? 0));
  const moderateRatio = Math.max(0, Math.min(1, data.contour_moderate_area_ratio ?? 0));
  const p90 = data.contour_local_slope_p90_degrees ?? 0;
  const p95 = data.contour_local_slope_p95_degrees ?? 0;
  const sampleCount = data.contour_sample_count ?? 0;
  const hasDistribution = sampleCount >= 8 && (steepRatio > 0 || moderateRatio > 0 || p90 > 0 || p95 > 0);
  const steepSignal = contour === "steep" || contour === "very_steep" || steepRatio >= 0.08 || p90 >= 18 || p95 >= 21;
  const moderateSignal = contour === "moderate" || steepSignal || steepRatio + moderateRatio >= 0.2 || p90 >= 6;

  if (!steepSignal && !moderateSignal) return null;
  if (!hasDistribution && contour !== "steep") return null;

  const effectiveLand = land != null && Number.isFinite(land) && land > 0 ? land : 10_000;
  const pressureRatio = hasDistribution
    ? Math.max(0.015, steepRatio + moderateRatio * 0.35)
    : 0.04;
  const maxEnvelope = Math.min(2_500, Math.max(450, effectiveLand * 0.08));
  const minEnvelope = steepSignal ? 900 : 350;
  const affectedAreaSqm = Math.round(Math.max(minEnvelope, Math.min(maxEnvelope, effectiveLand * pressureRatio)));

  const verySteepSignal = contour === "very_steep" || p90 >= 18 || p95 >= 21;
  const rateProfile = verySteepSignal
    ? costProfile.retaining.largeSite.verySteep
    : steepSignal
      ? costProfile.retaining.largeSite.steep
      : costProfile.retaining.largeSite.moderate;
  const lowRate = rateProfile.lowRate;
  const highRate = rateProfile.highRate;
  const ruralMultiplier = RURAL_LIFESTYLE_ZONES.has((data.zone_code ?? "").toUpperCase())
    ? costProfile.retaining.largeSite.ruralLifestyleMultiplier
    : 1;
  const calculatedLow = affectedAreaSqm * lowRate * ruralMultiplier;
  const calculatedHigh = affectedAreaSqm * highRate * ruralMultiplier;

  return {
    low: Math.max(rateProfile.floorLow, calculatedLow),
    high: Math.max(rateProfile.floorHigh, calculatedHigh),
    areaSqm: affectedAreaSqm,
    adjusted: true,
  };
}

function estimateRuralTransferRightCosts(data: MergedPropertyData, units: number): {
  low: number;
  high: number;
  required: boolean;
  note: string | null;
} {
  const zone = (data.zone_code ?? "").toUpperCase();
  const additionalTitles = Math.max(0, Math.floor(units) - 1);
  if (additionalTitles <= 0 || !RURAL_TRANSFER_RIGHT_ZONES.has(zone)) {
    return { low: 0, high: 0, required: false, note: null };
  }

  const low = additionalTitles * 160_000;
  const high = additionalTitles * 250_000;
  const note =
    `Rural/countryside subdivision may require a transferable rural site right (TDR/TTR) under Auckland Unitary Plan rural subdivision rules. ` +
    `Allowance is modelled for ${additionalTitles} additional title${additionalTitles === 1 ? "" : "s"} at $160k-$250k each; confirm availability and pathway with a planner/surveyor.`;

  return { low, high, required: true, note };
}

export function estimateCosts(
  data: MergedPropertyData,
  units: number,
  options?: EstimateCostsOptions,
): CostBreakdown {
  const costProfile = options?.cost_profile ?? defaultRegionalCostProfile();
  const cv = data.cv_nzd ?? null;
  const cvUnavailable = cv === null;
  const contour = data.contour ?? null;
  const asbestos = data.asbestos_risk ?? "unknown";
  const hasDwelling = classifySiteCondition(data).hasExistingDwelling;

  const safeUnits = Math.max(1, units);

  let demo_low = 0;
  let demo_high = 0;
  const demoVacant = !hasDwelling;
  if (hasDwelling) {
    if (asbestos === "low") {
      demo_low = costProfile.demolition.lowAsbestosLow;
      demo_high = costProfile.demolition.highAsbestosLow;
    } else if (asbestos === "high") {
      demo_low = costProfile.demolition.lowAsbestosHigh;
      demo_high = costProfile.demolition.highAsbestosHigh;
    } else {
      demo_low = costProfile.demolition.lowUnknownAsbestos;
      demo_high = costProfile.demolition.highUnknownAsbestos;
    }
  }

  let retaining_low = 0;
  let retaining_high = 0;
  const retainingUnknown = contour === null;
  const baseRetaining = retainingBucketForContour(contour, costProfile);
  retaining_low = baseRetaining.low;
  retaining_high = baseRetaining.high;
  const largeSiteRetaining = estimateLargeSiteRetaining(data, costProfile);
  let retaining_area_sqm_estimate: number | null = data.retaining_area_sqm_estimate ?? null;
  let large_site_terrain_adjusted = data.large_site_terrain_adjusted ?? false;
  if (largeSiteRetaining) {
    retaining_low = Math.max(retaining_low, largeSiteRetaining.low);
    retaining_high = Math.max(retaining_high, largeSiteRetaining.high);
    retaining_area_sqm_estimate = largeSiteRetaining.areaSqm;
    large_site_terrain_adjusted = true;
  }

  const infra = data.infrastructure ?? [];
  const services_low  = infra.reduce((sum, i) => sum + (i.estimated_cost_low ?? 0),  0);
  const services_high = infra.reduce((sum, i) => sum + (i.estimated_cost_high ?? 0), 0);
  const tdrTtr = estimateRuralTransferRightCosts(data, safeUnits);

  // Net new dwellings drive development contributions and the Veolia connection
  // allowance — an existing dwelling carries an existing connection credit, so
  // charges apply to the ADDITIONAL demand (matching how councils/Watercare levy).
  const existingUnits = hasDwelling ? 1 : 0;
  const newUnits = Math.max(0, safeUnits - existingUnits);

  const contribBase =
    costProfile.contributions.igcPerUnit +
    costProfile.contributions.councilDcPerUnit +
    costProfile.contributions.stormwaterPerUnit;
  const contributions_low = contribBase * newUnits;
  const contributions_high = contribBase * costProfile.contributions.highMultiplier * newUnits;

  const veoliaInZone = data.veolia_service_zone?.inServiceZone === true;
  const veolia_low = veoliaInZone ? costProfile.veolia.perLotLow * newUnits : 0;
  const veolia_high = veoliaInZone
    ? Math.min(costProfile.veolia.totalCapHigh, costProfile.veolia.perLotHigh * newUnits)
    : 0;

  const land_rate_annual = estimateAnnualLandRates(cv, costProfile);

  // Prefer lot-size-derived finished floor area so construction cost aligns with the GDV
  // estimate (estimateGdvPerLot mirrors the same likely-storeys assumption).
  // Fall back to the existing dwelling's floor area only when sqm_per_lot is absent.
  const sqmPerLotOpt = options?.sqm_per_lot;
  const floorSqm = sqmPerLotOpt != null && Number.isFinite(sqmPerLotOpt) && sqmPerLotOpt > 0
    ? newBuildFloorSqmFromLotSize(sqmPerLotOpt)
    : effectiveNewBuildFloorSqm(data.floor_area_sqm);
  const { low: rate_low, high: rate_high } = constructionRatesPerSqm(
    contour,
    options?.market_floor_price_per_sqm,
    costProfile,
  );

  const constructionCostMultiplier =
    options?.construction_cost_multiplier != null && Number.isFinite(options.construction_cost_multiplier)
      ? Math.max(0.5, Math.min(1, options.construction_cost_multiplier))
      : 1;
  const construction_low  = rate_low  * floorSqm * safeUnits * constructionCostMultiplier;
  const construction_high = rate_high * floorSqm * safeUnits * constructionCostMultiplier;

  const consents_low  = construction_low  * costProfile.consents.lowRate;
  const consents_high = construction_high * costProfile.consents.highRate;

  const construction_mid = (construction_low + construction_high) / 2;
  const loan_base = (cv ?? 0) + construction_mid * 0.5;
  const finance_low  = loan_base * costProfile.finance.annualRate * costProfile.finance.lowYears;
  const finance_high = loan_base * costProfile.finance.annualRate * costProfile.finance.highYears;

  const subtotal_low  = demo_low  + retaining_low  + tdrTtr.low  + services_low  + contributions_low  + veolia_low  + construction_low  + consents_low  + finance_low;
  const subtotal_high = demo_high + retaining_high + tdrTtr.high + services_high + contributions_high + veolia_high + construction_high + consents_high + finance_high;

  const contingency_low  = subtotal_low  * costProfile.contingency.lowRate;
  const contingency_high = subtotal_high * costProfile.contingency.highRate;

  const dev_cost_low  = subtotal_low  + contingency_low;
  const dev_cost_high = subtotal_high + contingency_high;

  // Land rates are a known holding carry (not an uncertain build cost), so they
  // sit outside contingency and mirror the Finance line's holding horizon.
  const land_rate_low  = land_rate_annual * costProfile.finance.lowYears;
  const land_rate_high = land_rate_annual * costProfile.finance.highYears;

  const total_low  = (cv ?? 0) + dev_cost_low  + land_rate_low;
  const total_high = (cv ?? 0) + dev_cost_high + land_rate_high;
  const cost_per_unit_avg = ((total_low + total_high) / 2) / safeUnits;

  const r = (n: number) => roundToNearest(n, 1000);

  return {
    cost_profile_id:     costProfile.id,
    land_cv_nzd:       cv !== null ? r(cv) : null,
    cv_unavailable:    cvUnavailable,
    demo_low:          r(demo_low),
    demo_high:         r(demo_high),
    demo_vacant:       demoVacant,
    retaining_low:     r(retaining_low),
    retaining_high:    r(retaining_high),
    retaining_unknown: retainingUnknown,
    retaining_area_sqm_estimate,
    large_site_terrain_adjusted,
    tdr_ttr_low:       r(tdrTtr.low),
    tdr_ttr_high:      r(tdrTtr.high),
    tdr_ttr_required:  tdrTtr.required,
    tdr_ttr_note:      tdrTtr.note,
    services_low:      r(services_low),
    services_high:     r(services_high),
    contributions_low:  r(contributions_low),
    contributions_high: r(contributions_high),
    contributions_units: newUnits,
    veolia_low:         r(veolia_low),
    veolia_high:        r(veolia_high),
    veolia_in_zone:     veoliaInZone,
    land_rate_annual:   r(land_rate_annual),
    land_rate_low:      r(land_rate_low),
    land_rate_high:     r(land_rate_high),
    construction_low:  r(construction_low),
    construction_high: r(construction_high),
    construction_cost_multiplier: constructionCostMultiplier,
    construction_discount_reason:
      constructionCostMultiplier < 1 ? options?.construction_discount_reason ?? null : null,
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
