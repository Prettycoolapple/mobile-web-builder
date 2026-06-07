import { geocodeAddress } from "./geocode";
import { fetchUnitaryPlanZone, fetchOverlays, fetchContour, type Overlay } from "./auckland-council";
import { fetchLINZParcel } from "./linz";
import {
  assessSubdivisionPathways,
  calculatePotentialLots,
  type DesignLedConfidence,
  type DesignLedYieldRange,
} from "./lot-calculator";
import { estimateCosts } from "./cost-estimator";
import { calculateBearBaseBullScenarios } from "./roi-calculator";
import { scoreProperty, type ScoringResult } from "./scoring";
import type { MergedPropertyData } from "./scrapers/merge";
import type { PropertyEligibilityConfidence, PropertyTypology } from "./property-eligibility";

export interface LightScoreInput {
  address: string;
  listingUrl?: string;
  price: number;
  landArea?: number;
  landAreaConfidence?: "verified" | "unverified";
  isAlreadySubdividedChild?: boolean;
  zone?: string;
  buildYear?: number | null;
  typology?: PropertyTypology;
  titleConfidence?: PropertyEligibilityConfidence;
  subdivisionEligible?: boolean;
  subdivisionRejectReason?: string | null;
}

export interface LightScoreResult {
  scores: ScoringResult;
  landArea: number;
  zone: string | null;
  potentialLots: number;
  minLotSize: number | null;
  standardVacantLots: number;
  standardPathViable: boolean;
  standardMinLotSize: number | null;
  designLedEligible: boolean;
  designLedYieldRange: DesignLedYieldRange | null;
  designLedConfidence: DesignLedConfidence;
  designLedReasons: string[];
  designLedBlockers: string[];
  designLedSummary: string | null;
  designLedDetail: string | null;
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
  const { address, price, landArea: listingLandArea, landAreaConfidence, zone: hintZone, buildYear } = input;

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

  const hasVerifiedListingArea = listingLandArea != null && landAreaConfidence === "verified";
  const land = hasVerifiedListingArea ? listingLandArea : (linzParcel?.area_sqm ?? listingLandArea ?? 400);

  const asbestosRisk: "low" | "high" | "unknown" =
    buildYear && buildYear >= 1940 && buildYear <= 1990 ? "high"
      : buildYear && buildYear > 1990 ? "low"
        : "unknown";

  const lotResult = calculatePotentialLots(land, zoneCode, 0);
  const forceSingleLot = input.subdivisionEligible === false
    || input.isAlreadySubdividedChild === true
    || (input.typology != null && input.typology !== "standalone")
    || (input.titleConfidence != null && input.titleConfidence !== "verified")
    || (input.buildYear != null && input.buildYear >= 2000);
  const lots = forceSingleLot ? 1 : lotResult.lots;
  const subdivisionAssessment = assessSubdivisionPathways({
    netAreaSqm: land > 0 ? land : null,
    zoneCode,
    zoneLabel: lotResult.zone_label,
    standardVacantLots: lots,
    minLotSqm: lotResult.min_lot_size,
    typology: input.typology,
    titleConfidence: input.titleConfidence,
    landAreaConfidence: hasVerifiedListingArea || linzParcel?.area_sqm != null ? "verified" : landAreaConfidence,
    isAlreadySubdividedChild: input.isAlreadySubdividedChild,
    buildYear: input.buildYear ?? null,
    parcelBbox: linzParcel?.bbox ?? null,
    overlays,
    slopeClass: contourData?.classification ?? null,
  });

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
    data_sources: { light_score: hasVerifiedListingArea ? "verified_listing" : (linzParcel ? "linz" : "listing") },
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
    property_type: null,
    typology: input.typology ?? "unknown",
    typologyConfidence: input.typology ? "inferred" : "unknown",
    titleConfidence: input.titleConfidence ?? "unknown",
    subdivisionEligible: input.subdivisionEligible ?? null,
    subdivisionRejectReason: input.subdivisionRejectReason ?? null,
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
    1,
  );

  return {
    scores: scoreProperty(minimalMerged, costs, scenarios, lots),
    landArea: land,
    zone: zoneCode,
    potentialLots: lots,
    minLotSize: lotResult.min_lot_size > 0 ? lotResult.min_lot_size : null,
    standardVacantLots: subdivisionAssessment.standardVacantLots,
    standardPathViable: subdivisionAssessment.standardPathViable,
    standardMinLotSize: subdivisionAssessment.standardMinLotSize,
    designLedEligible: subdivisionAssessment.designLedEligible,
    designLedYieldRange: subdivisionAssessment.designLedYieldRange,
    designLedConfidence: subdivisionAssessment.designLedConfidence,
    designLedReasons: subdivisionAssessment.designLedReasons,
    designLedBlockers: subdivisionAssessment.designLedBlockers,
    designLedSummary: subdivisionAssessment.designLedSummary,
    designLedDetail: subdivisionAssessment.designLedDetail,
  };
}
