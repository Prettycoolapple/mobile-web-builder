import { geocodeAddress } from "./geocode";
import { fetchUnitaryPlanZone, fetchOverlays, type Overlay } from "./auckland-council";
import { fetchLINZParcel } from "./linz";
import { calculatePotentialLots } from "./lot-calculator";
import { estimateCosts } from "./cost-estimator";
import { calculateBearBaseBullScenarios } from "./roi-calculator";
import { scoreProperty, type ScoringResult } from "./scoring";
import type { MergedPropertyData } from "./scrapers/merge";

export interface LightScoreInput {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
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
  const { address, price, landArea: listingLandArea, zone: hintZone } = input;

  const geo = await geocodeAddress(address);

  const [linzResult, zoneResult, overlayResult] = await Promise.allSettled([
    fetchLINZParcel(geo.lat, geo.lng),
    fetchUnitaryPlanZone(geo.lat, geo.lng),
    fetchOverlays(geo.lat, geo.lng),
  ]);

  const linzParcel = linzResult.status === "fulfilled" ? linzResult.value : null;

  const zoneCode: string | null =
    zoneResult.status === "fulfilled" ? (zoneResult.value?.zone_code ?? hintZone ?? null) : (hintZone ?? null);
  const overlays: Overlay[] =
    overlayResult.status === "fulfilled" ? overlayResult.value : [];

  const land = linzParcel?.area_sqm ?? listingLandArea ?? 400;

  const lotResult = calculatePotentialLots(land, zoneCode, 0);
  const lots = lotResult.lots;

  const minimalMerged: MergedPropertyData = {
    cv_nzd: price,
    cv_year: null,
    land_area_sqm: land,
    floor_area_sqm: null,
    build_year: null,
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
    overlay_map_image_base64: null,
    comparables: [],
    data_sources: { light_score: linzParcel ? "linz" : "listing" },
    contour: null,
    contour_slope_degrees: null,
    contour_source: null,
    contour_text: null,
    asbestos_risk: "unknown",
    infrastructure: [],
    missing_critical_fields: [],
    discrepancies: [],
    bathrooms: null,
  };

  const costs = estimateCosts(minimalMerged, lots);

  const AUCKLAND_MEDIAN_PRICE_PER_SQM = 8500;
  const AUCKLAND_MEDIAN_SALE_PRICE = 900_000;

  const scenarios = calculateBearBaseBullScenarios(
    costs,
    AUCKLAND_MEDIAN_PRICE_PER_SQM,
    AUCKLAND_MEDIAN_SALE_PRICE,
    lots,
    lotResult.sqm_per_lot,
    "stable",
  );

  return {
    scores: scoreProperty(minimalMerged, costs, scenarios, lots),
    landArea: land,
    zone: zoneCode,
  };
}
