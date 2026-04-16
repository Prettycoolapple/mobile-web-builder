import { geocodeAddress } from "./geocode";
import { fetchUnitaryPlanZone, fetchOverlays, type Overlay } from "./auckland-council";
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

/**
 * Runs a lightweight but accurate score using the same scoring functions as the full
 * analysis pipeline. Avoids expensive web scraping — uses geocode + zone + overlays
 * (all fast public API calls) combined with Auckland-average comparable estimates.
 *
 * Ease score: identical to full analysis (same zone/overlay deductions)
 * Cost score: uses listing price as land value + estimated construction costs
 * ROI score:  uses Auckland median new-build prices as GDV proxy
 */
export async function computeLightScore(input: LightScoreInput): Promise<ScoringResult> {
  const { address, price, landArea, zone: hintZone } = input;

  const geo = await geocodeAddress(address);

  const [zoneResult, overlayResult] = await Promise.allSettled([
    fetchUnitaryPlanZone(geo.lat, geo.lng),
    fetchOverlays(geo.lat, geo.lng),
  ]);

  const zoneCode: string | null =
    zoneResult.status === "fulfilled" ? (zoneResult.value?.zone_code ?? hintZone ?? null) : (hintZone ?? null);
  const overlays: Overlay[] =
    overlayResult.status === "fulfilled" ? overlayResult.value : [];

  const land = landArea ?? 400;

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
    data_sources: { light_score: "pre-screen" },
    contour: null,
    contour_slope_degrees: null,
    contour_source: null,
    contour_text: null,
    asbestos_risk: "unknown",
    infrastructure: [],
    missing_critical_fields: [],
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

  return scoreProperty(minimalMerged, costs, scenarios, lots);
}
