import { geocodeAddress } from "./geocode";
import { fetchUnitaryPlanZone, fetchOverlays, fetchContour, type Overlay } from "./auckland-council";
import { fetchLINZParcel } from "./linz";
import { calculatePotentialLots } from "./lot-calculator";
import { estimateCosts } from "./cost-estimator";
import { calculateBearBaseBullScenarios, exitGdvTypologyDiscountFactor } from "./roi-calculator";
import { scoreProperty, type ScoringResult } from "./scoring";
import type { MergedPropertyData } from "./scrapers/merge";

export interface LightScoreInput {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  buildYear?: number | null;
}

export interface LightScoreResult {
  scores: ScoringResult;
  landArea: number;
  zone: string | null;
}

/**
 * Runs a lightweight but accurate score using the same scoring functions as the full
 * analysis pipeline. Avoids expensive web scraping — uses geocode + LINZ + zone + overlays
 * (all fast public API calls) combined with Auckland-average comparable estimates.
 *
 * Ease score:  identical to full analysis (same zone/overlay deductions)
 * Cost score:  uses listing price as land value + estimated construction costs
 * ROI score:   uses Auckland median new-build prices as GDV proxy
 * Land area:   sourced from LINZ (the same authoritative source as the full report)
 */
export async function computeLightScore(input: LightScoreInput): Promise<LightScoreResult> {
  const { address, price, landArea: listingLandArea, zone: hintZone, buildYear } = input;

  const geo = await geocodeAddress(address);

  const [linzResult, zoneResult, overlayResult, contourResult] = await Promise.allSettled([
    fetchLINZParcel(geo.lat, geo.lng),
    fetchUnitaryPlanZone(geo.lat, geo.lng),
    fetchOverlays(geo.lat, geo.lng),
    fetchContour(geo.lat, geo.lng, null),
  ]);

  const linzParcel = linzResult.status === "fulfilled" ? linzResult.value : null;

  const zoneCode: string | null =
    zoneResult.status === "fulfilled" ? (zoneResult.value?.zone_code ?? hintZone ?? null) : (hintZone ?? null);
  const overlays: Overlay[] =
    overlayResult.status === "fulfilled" ? overlayResult.value : [];
  const contourData = contourResult.status === "fulfilled" ? contourResult.value : null;

  const land = linzParcel?.area_sqm ?? listingLandArea ?? 400;

  const asbestosRisk: "low" | "high" | "unknown" =
    buildYear && buildYear >= 1940 && buildYear <= 1990 ? "high"
      : buildYear && buildYear > 1990 ? "low"
        : "unknown";

  const lotResult = calculatePotentialLots(land, zoneCode, 0);
  const lots = lotResult.lots;

  const minimalMerged: MergedPropertyData = {
    cv_nzd: price,
    cv_year: null,
    land_area_sqm: land,
    floor_area_sqm: null,
    build_year: buildYear ?? null,
    build_year_range: null,
    bedrooms: null,
    zone_code: zoneCode,
    zone_description: null,
    min_lot_size_sqm: null,
    overlays,
    school_zones: { primary: null, intermediate: null, secondary: null },
    last_sale_price: null,
    last_sale_date: null,
    listing_active: true,
    listing_price: price,
    main_photo_url: null,
    photo_urls: [],
    overlay_map_image_base64: null,
    comparables: [],
    data_sources: { light_score: linzParcel ? "linz" : "listing" },
    contour: contourData?.classification ?? null,
    contour_slope_degrees: contourData?.slope_degrees ?? null,
    contour_source: contourData?.source ?? null,
    contour_text: null,
    asbestos_risk: asbestosRisk,
    infrastructure: [],
    missing_critical_fields: [],
    discrepancies: [],
    bathrooms: null,
    estate_type: null,
  };

  const costs = estimateCosts(minimalMerged, lots, { sqm_per_lot: lotResult.sqm_per_lot });

  const AUCKLAND_MEDIAN_PRICE_PER_SQM = 8500;
  const AUCKLAND_MEDIAN_SALE_PRICE = 900_000;

  const scenarios = calculateBearBaseBullScenarios(
    costs,
    AUCKLAND_MEDIAN_PRICE_PER_SQM,
    AUCKLAND_MEDIAN_SALE_PRICE,
    lots,
    lotResult.sqm_per_lot,
    "stable",
    exitGdvTypologyDiscountFactor(zoneCode, lots, lotResult.sqm_per_lot),
  );

  return {
    scores: scoreProperty(minimalMerged, costs, scenarios, lots),
    landArea: land,
    zone: zoneCode,
  };
}
