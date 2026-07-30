import { logger } from "./logger";
import { ai } from "@workspace/integrations-gemini-ai";
import { geocodeAddress, type GeoResult } from "./geocode";
import { fetchLINZParcel, fetchLINZTitle, fetchLINZMemorials, fetchLINZTitlesByAddressDetailed, fetchLINZChildAddressCount, estateTypeFromLrsTitles, type LinzParcel, type LinzTitle, type LinzLrsAddressTitlePreview, type LinzLrsTitlePreviewStatus, type LinzLrsTitlePreviewSource } from "./linz";
import type { ZoneResult, Overlay, ContourResult } from "./auckland-council";
import { checkAsbestosRisk, type PropertyHistory, type AsbestosRisk } from "./property-data";
import type { InfrastructureItem } from "./infrastructure";
import {
  fetchInfrastructureForReport,
  fetchPlanningOverlaysForReport,
  fetchPlanningZoneForReport,
  fetchPropertyHistoryForReport,
  fetchTerrainForReport,
} from "./regional-planning-fetchers";
import {
  planningProviderMetadata,
  shouldSuppressAucklandPlanningRules,
  type PlanningProviderMetadata,
} from "./regional-planning";
import {
  assessRegionalSubdivisionPathways,
  calculateRegionalPotentialLots,
  regionalPlanningRuleStatus,
  regionalZoneDescriptionWithRuleStatus,
} from "./regional-rules";
import { regionalCostProfileForProvider } from "./regional-cost-profiles";
import { scrapeHougarden, type HougardenData } from "./scrapers/hougarden";
import { scrapeOneRoof, type OneRoofData, type ListingResult } from "./scrapers/oneroof";
import { scrapeHomes, type HomesData } from "./scrapers/homes";
import { scrapeQV, type QVData } from "./scrapers/qv";
import { scrapePropertyValue, type PropertyValueData } from "./scrapers/propertyvalue";
import { mergePropertyData, type MergedPropertyData } from "./scrapers/merge";
import { detectVeoliaServiceZone } from "./veolia-service-zone";
import { sanitizeTenureField } from "./titleDisplay";
import { resolveTitleStatus } from "./title-resolution";
import { withBrowserSlot } from "./scrapers/browser";
import { classifyAsbestos, type AsbestosClassification } from "./asbestos";
import {
  assessSubdivisionPathways,
  calculatePotentialLots,
  buildSubdivisionPathwayNote,
  type DesignLedAssessmentInput,
  type LotResult,
  type SubdivisionPathwayNote,
  type SubdivisionPathwayAssessment,
} from "./lot-calculator";
import { estimateCosts, type CostBreakdown } from "./cost-estimator";
import { classifySiteCondition } from "./site-condition";
import { getComparables, type ComparableSale, type ComparablesResult } from "./comparables";
import { calculateBearBaseBullScenarios, exitGdvTypologyDiscountFactor, nearestHorizonRoiPercent, type ROIScenario } from "./roi-calculator";
import {
  exitGdvMultiplierForComparableSelection,
  isImprovedDwellingComparable,
  selectComparableSalesForExit,
} from "./market-comparables";
import { fetchNeighbourhoodContext, type NeighbourhoodContext } from "./neighbourhood-context";
import { fetchTransportContext, type TransportContext } from "./transport-context";
import {
  fetchBuiltEnvironmentContext,
  hasUsableBuiltEnvironmentContext,
  type BuiltEnvironmentContext,
} from "./built-environment-context";
import { assessDevelopmentStrategy, assessInterestRateOutlook } from "./claude";
import { scoreProperty, type ScoringResult } from "./scoring";
import { parseEasements, NO_TITLE, API_ERROR, type EasementAnalysis } from "./easements";
import {
  buildFallbackDevelopmentStrategyAssessment,
  calculateDevelopmentStrategies,
  type DevelopmentStrategyScenario,
} from "./development-strategies";
import {
  addressLineAppearsInText,
  addressesLikelyMatch,
  fetchRealestateListingByUrl,
  fetchRealestatePropertyProfileForAddress,
  fetchSupplementListingComparables,
} from "./scrapers/realestate-api";
import { selectedListingPhotoUrls, type SelectedListingContext } from "./selected-listing-context";
import { resolveActiveListingContext } from "./active-listing-context";
import { enrichSchoolZonesFromGis, type SchoolZoneDetail } from "./school-directory";
import { fetchSchoolZonesByPoint, type SchoolZoneGisHit } from "./school-zones-gis";
import { SCORING_VERSION, type DerivedCardScores } from "./card-score";
import { resolvePipelineSuburb } from "./suburb-resolver";
import {
  assessPropertyEligibility,
  eligibilityPlanningNote,
  resolveSubjectLandAreaForEligibility,
  shouldForceSingleLotForEligibility,
  shouldSuppressParentLandAreaForEligibility,
} from "./property-eligibility";
import { isAucklandBusinessZone } from "./auckland-zone-classification";
import { extractListingClaims, detectRedevelopmentConflict, hasAmbiguousListingSignals, type ListingClaims } from "./listing-claims";
import { extractListingClaimsLLM, mergeClaimsSafer } from "./listing-claims-llm";
import { looksLikeUnitOrApartmentAddress } from "./address-patterns";
import { assessDwellingCondition, selectedDwellingConditionPhotoUrls, type DwellingConditionAssessment } from "./dwelling-condition";
import { hasRegionalPlanningZoneLayer } from "./regional-arcgis";

const AC_PROP_MAPSERVER = "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/PropertyValueInfo/MapServer";

function normaliseListingScope(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/[^a-z0-9&+]+/g, "");
}

function activeListingFactsMatchSubject(
  listing: ListingResult | null,
  subjectAddress: string | null | undefined,
): boolean {
  if (!listing || !subjectAddress) return false;
  if (listing.isCombinedListing) {
    return normaliseListingScope(listing.address) === normaliseListingScope(subjectAddress);
  }
  return addressesLikelyMatch(subjectAddress, listing.address)
    || addressLineAppearsInText(subjectAddress, listing.address)
    || addressLineAppearsInText(subjectAddress, listing.listingUrl);
}

function browserScrapersEnabled(): boolean {
  const explicit = process.env["ENABLE_BROWSER_SCRAPERS"]?.trim().toLowerCase();
  if (explicit === "1" || explicit === "true" || explicit === "yes" || explicit === "on") return true;
  if (explicit === "0" || explicit === "false" || explicit === "no" || explicit === "off") return false;

  // Vercel/serverless has a short request ceiling and does not reliably run
  // browser-backed scrapers. The direct PropertyValue + GIS paths are the
  // production source of truth for CV/build year/beds/baths.
  if (process.env["VERCEL"] || process.env["ENABLE_SOCKET_IO"] === "false") return false;
  return true;
}

export function hasRoomCountConflict(values: Array<number | null | undefined>): boolean {
  const usable = values.filter(
    (value): value is number => value != null && Number.isFinite(value) && value > 0,
  );
  return new Set(usable).size > 1;
}

/**
 * Parse a build decade string or year from AC GIS.
 * AC GIS returns "DECADEBUILT" as values like 2010, 1990, "2010s", "1990s".
 * Returns null if unparseable.
 */
function parseACBuildDecade(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/s$/i, "").trim();
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 1800 && n <= new Date().getFullYear()) return n;
  return null;
}

function inferEstateTypeFromParcel(parcel: LinzParcel | null): string | null {
  if (!parcel?.title_no) return null;
  const text = [
    parcel.legal_description,
    parcel.appellation,
    parcel.topology_type,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/\b(cross\s*lease|leasehold|unit title|stratum|flat|unit)\b/.test(text)) {
    return null;
  }
  if (/\blot\s+\d+\b.*\bdp\b|\bdp\s*\d+\b/.test(text)) {
    return "Fee Simple";
  }
  return null;
}

function forceSingleLotResult(lotResult: LotResult): LotResult {
  return {
    ...lotResult,
    lots: 1,
    sqm_per_lot: Math.round(lotResult.net_area_sqm || lotResult.gross_area_sqm || 0),
  };
}

function applyDesignLedMaximumLotCount(
  lotResult: LotResult,
  assessment: SubdivisionPathwayAssessment,
): LotResult {
  const designMax = assessment.designLedEligible
    ? assessment.designLedYieldRange?.max ?? 0
    : 0;

  if (designMax <= lotResult.lots) return lotResult;

  const netArea = lotResult.net_area_sqm || lotResult.gross_area_sqm || 0;
  return {
    ...lotResult,
    lots: designMax,
    sqm_per_lot: Math.max(1, Math.round(netArea / designMax)),
  };
}

/**
 * Sequentially enriches comparables with CV, build year, and floor area from
 * Auckland Council GIS. Uses `for...of` — fully sequential, one property at a
 * time — to avoid GIS rate-limit hammering and any interleaved-response races.
 */
async function enrichComparables(
  comparables: ComparableSale[],
  subject?: { lat: number; lng: number },
  maxToEnrich = 5,
): Promise<ComparableSale[]> {
  const enriched: ComparableSale[] = [];

  for (let i = 0; i < comparables.length; i++) {
    const comp = comparables[i];

    if (i >= maxToEnrich) {
      enriched.push(comp);
      continue;
    }

    try {
      const geo = await geocodeAddress(comp.address);
      if (!geo?.lat || !geo?.lng) {
        enriched.push(comp);
        continue;
      }

      // Rate-assessment layer (3): CV + build decade + floor area
      const url = new URL(`${AC_PROP_MAPSERVER}/3/query`);
      url.searchParams.set("geometry", `${geo.lng},${geo.lat}`);
      url.searchParams.set("geometryType", "esriGeometryPoint");
      url.searchParams.set("inSR", "4326");
      url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
      // Request all fields that might carry CV, build year, and floor area
      url.searchParams.set("outFields", "LCV,CV,DECADEBUILT,DECADE_BUILT,YEAR_BUILT,YEARBUILT,FLOORAREA,FLOOR_AREA,BUILDINGFLOORAREA");
      url.searchParams.set("returnGeometry", "false");
      url.searchParams.set("f", "json");

      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(7000) });
      if (resp.ok) {
        const data = (await resp.json()) as { features?: Array<{ attributes: Record<string, unknown> }> };
        const attrs = data.features?.[0]?.attributes;
        if (attrs) {
          const lcv = Number(attrs["LCV"] ?? NaN);
          const cv  = Number(attrs["CV"]  ?? NaN);
          const cvFinal = !isNaN(lcv) && lcv > 0 ? lcv : (!isNaN(cv) && cv > 0 ? cv : null);

          const buildYear = parseACBuildDecade(
            attrs["DECADEBUILT"] ?? attrs["DECADE_BUILT"] ?? attrs["YEARBUILT"] ?? attrs["YEAR_BUILT"],
          );

          const floorRaw = Number(
            attrs["FLOORAREA"] ?? attrs["FLOOR_AREA"] ?? attrs["BUILDINGFLOORAREA"] ?? NaN,
          );
          const floorEnriched = !isNaN(floorRaw) && floorRaw > 10 ? Math.round(floorRaw) : null;

          enriched.push({
            ...comp,
            cv_nzd: cvFinal,
            build_year: comp.build_year ?? buildYear,
            // Prefer scraped floor area; fall back to GIS if missing
            floor_sqm: comp.floor_sqm > 0 ? comp.floor_sqm : (floorEnriched ?? comp.floor_sqm),
            distanceM: subject ? distanceMeters(subject.lat, subject.lng, geo.lat, geo.lng) : comp.distanceM,
          });
          logger.debug({ address: comp.address, cv_nzd: cvFinal, build_year: buildYear, floor_sqm: floorEnriched }, "Comparable enriched");
          continue;
        }
      }
    } catch (err) {
      logger.debug({ address: comp.address, err: (err as Error).message }, "Comparable enrichment failed — skipping");
    }

    enriched.push(comp);
  }

  return enriched;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6_371_000;
  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const dPhi = ((bLat - aLat) * Math.PI) / 180;
  const dLambda = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return Math.round(2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function withComparableAverages(result: ComparablesResult, comparables: ComparableSale[]): ComparablesResult {
  if (comparables.length === 0) {
    return { ...result, comparables: [], avg_sale_price: 0, avg_price_per_sqm: 0 };
  }
  const avg_sale_price = Math.round(comparables.reduce((sum, c) => sum + c.price_nzd, 0) / comparables.length);
  const psms = comparables.map((c) => c.price_per_sqm).filter((p) => p > 0);
  const avg_price_per_sqm = psms.length > 0 ? Math.round(psms.reduce((sum, p) => sum + p, 0) / psms.length) : 0;
  const selectedSoldCount = comparables.filter((c) => c.source === "oneroof_sold").length;
  const data_quality: ComparablesResult["data_quality"] = selectedSoldCount >= 3 ? "live" : "estimated";
  return { ...result, comparables, avg_sale_price, avg_price_per_sqm, data_quality };
}

/**
 * Uses an LLM to rank a pool of candidate comparables and return the 3 most
 * relevant ones for the subject property. Considers land size, floor area,
 * build era, and location — importantly, old houses are not comparable with
 * new houses.
 *
 * Falls back to the original pool order if the LLM call fails or returns
 * invalid output.
 */
async function selectComparablesByLLM(
  pool: ComparableSale[],
  subject: {
    address: string;
    suburb: string;
    land_area_sqm: number | null;
    floor_area_sqm: number | null;
    build_year: number | null;
    zone_code: string | null;
  },
  maxSelect = 3,
): Promise<ComparableSale[]> {
  if (pool.length <= maxSelect) return pool;

  const candidateList = pool
    .slice(0, 12) // cap the pool to keep the prompt small
    .map((c, i) => {
      const parts: string[] = [`${i}. ${c.address}`];
      if (c.land_sqm > 0) parts.push(`land ${c.land_sqm}m²`);
      if (c.floor_sqm > 0) parts.push(`floor ${c.floor_sqm}m²`);
      if (c.build_year) parts.push(`built ${c.build_year}`);
      if (c.price_nzd > 0) parts.push(`price ${Math.round(c.price_nzd / 1000)}k`);
      return parts.join(", ");
    })
    .join("\n");

  const subjectDesc = [
    `Address: ${subject.address}`,
    subject.land_area_sqm ? `Land: ${subject.land_area_sqm}m²` : null,
    subject.floor_area_sqm ? `Floor: ${subject.floor_area_sqm}m²` : null,
    subject.build_year ? `Built: ${subject.build_year}` : "Build year: unknown",
    subject.zone_code ? `Zone: ${subject.zone_code}` : null,
    `Suburb: ${subject.suburb}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are a New Zealand property analyst selecting comparable properties for a development feasibility study.

SUBJECT PROPERTY:
${subjectDesc}

CANDIDATE COMPARABLES (index: details):
${candidateList}

Select exactly ${maxSelect} candidates that are the best comparables for the subject property.
Key rules:
- Land area should be similar (within ~50% if possible)
- Build era must be compatible — do not mix pre-1980 with post-2000 builds
- Prefer same suburb/street over distant ones
- If build year is unknown for subject, prefer recent builds (post-2000)

Return ONLY a JSON array of ${maxSelect} zero-based indices, e.g. [0, 3, 5]. No other text.`;

  try {
    const resp = await ai.models.generateContent({
      model: "deepseek-chat",
      config: { maxOutputTokens: 64 },
      contents: [{
        role: "user",
        parts: [{ text: prompt }],
      }],
    });
    const text = (resp.text ?? "").trim();

    // Extract JSON array from response
    const match = text.match(/\[[\d,\s]+\]/);
    if (match) {
      const indices: unknown[] = JSON.parse(match[0]);
      const selected: ComparableSale[] = [];
      for (const idx of indices) {
        if (typeof idx === "number" && idx >= 0 && idx < pool.length) {
          selected.push(pool[idx]);
          if (selected.length >= maxSelect) break;
        }
      }
      if (selected.length > 0) {
        logger.info({ selected: selected.map((s) => s.address) }, "Comparables selected by LLM");
        return selected;
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "LLM comparable selection failed — using pool order");
  }

  return pool.slice(0, maxSelect);
}

/**
 * The raw, externally-acquired data behind an analysis — everything that costs a
 * network call to a scraper, LINZ, Auckland Council GIS, or a geocoder. This is
 * what the global property cache stores (see lib/property-cache.ts). Volatile
 * listing/photo fields are stripped before caching and refetched live on serve.
 *
 * When supplied back via `runPropertyPipeline(address, { cachedRaw })`, every
 * external fetch short-circuits to the cached value while the derived/financial
 * computation (merge, lots, costs, ROI, scores) still runs fresh.
 *
 * `schema_version` pairs with PIPELINE_VERSION in lib/property-cache.ts; bump
 * both when the SHAPE of this bundle changes so stale rows are treated as misses.
 */
export interface RawPropertyData {
  schema_version: number;
  /** Version of the evidence rules used to distinguish vacant land from an existing dwelling. */
  site_classification_version?: number;
  geocode: GeoResult;
  suburb: string;
  linz_parcel: LinzParcel | null;
  linz_title: LinzTitle | null;
  linz_memorials: Awaited<ReturnType<typeof fetchLINZMemorials>>;
  linz_lrs_preview_result: {
    preview: LinzLrsAddressTitlePreview | null;
    status: LinzLrsTitlePreviewStatus;
    source: LinzLrsTitlePreviewSource;
  } | null;
  zone: ZoneResult | null;
  overlays: Overlay[];
  contour: ContourResult | null;
  infrastructure: InfrastructureItem[];
  property_history: PropertyHistory | null;
  hougarden: HougardenData | null;
  oneroof: OneRoofData | null;
  qv: QVData | null;
  homes: HomesData | null;
  propertyValue: PropertyValueData | null;
  /** Exact address-matched realestate.co.nz property-profile facts. Unlike an
   * active listing, these stable dwelling facts are cached so unit/cross-lease
   * reports do not lose bedrooms, bathrooms, floor area or build information
   * when the live profile endpoint is temporarily unavailable. */
  realestate_property_profile?: ListingResult | null;
  neighbourhood_context: NeighbourhoodContext | null;
  transport_context: TransportContext | null;
  built_environment_context?: BuiltEnvironmentContext | null;
  /** Optional regional-planning provider diagnostics. Omitted when the provider
   * router is disabled so legacy Auckland cache payloads remain unchanged. */
  planning_provider?: PlanningProviderMetadata | null;
  /** Official MoE enrolment-zone hits (point-in-polygon). Optional: rows cached
   * before this field existed fall back to a live lookup on serve. */
  school_zones_gis?: SchoolZoneGisHit[];
  /** Real report-grade scores, persisted so screening cards match the report.
   * Versioned by SCORING_VERSION; ignored when the version no longer matches.
   * (The only derived numbers we deliberately cache — see card-score.ts.) */
  derived_scores?: DerivedCardScores;
}

export const RAW_PROPERTY_SCHEMA_VERSION = 14;
export const SITE_CLASSIFICATION_VERSION = 2;

export interface PipelineResult {
  address_input: string;
  suburb: string;
  geocode: GeoResult | null;
  linz_parcel: LinzParcel | null;
  linz_title: LinzTitle | null;
  zone: ZoneResult | null;
  overlays: Overlay[];
  contour: ContourResult | null;
  property_history: PropertyHistory | null;
  asbestos: AsbestosRisk | null;
  asbestos_detail: AsbestosClassification;
  infrastructure: InfrastructureItem[];
  hougarden: HougardenData | null;
  oneroof: OneRoofData | null;
  homes: HomesData | null;
  qv: QVData | null;
  propertyValue: PropertyValueData | null;
  realestate_listing: ListingResult | null;
  selectedListingContext?: SelectedListingContext | null;
  // True when this report is one child of a combined/packaged listing. Photo
  // assembly downstream must NOT append address-fuzzy galleries (oneroof etc.)
  // for these — only child-scope-matched listing photos are trustworthy.
  suppressNonSubjectPhotos?: boolean;
  merged: MergedPropertyData | null;
  lots: LotResult | null;
  subdivision_pathway: SubdivisionPathwayNote | null;
  costs: CostBreakdown | null;
  comparables: ComparableSale[];
  comparables_quality: "live" | "estimated" | "unavailable";
  neighbourhoodContext: NeighbourhoodContext | null;
  transportContext: TransportContext | null;
  builtEnvironmentContext: BuiltEnvironmentContext | null;
  dwellingCondition: DwellingConditionAssessment | null;
  scenarios: ROIScenario[];
  developmentStrategies: DevelopmentStrategyScenario[];
  scores: ScoringResult | null;
  /** MoE directory enrichment for school_zones (Hougarden). */
  school_zones_detail: SchoolZoneDetail[];
  easements: EasementAnalysis;
  failed_sources: string[];
  timing_ms: Record<string, number>;
  completed_at: string;
  /** The raw acquired data, suitable for caching. Present whenever geocoding
   * succeeded (i.e. not on the geocode-failure early return). */
  raw_property?: RawPropertyData | null;
  /** True when external fetches were served from a supplied `cachedRaw` bundle
   * rather than hit live. The derived numbers are still freshly computed. */
  served_from_cache?: boolean;
  /**
   * Council-lag detector: set when the active listing's own claims (new build /
   * townhouse / multi-unit development) conflict with council/valuation
   * records — the parcel was likely demolished and redeveloped, so recorded
   * land area, CV, and build year describe the PRE-development parent site.
   */
  redevelopmentCheck?: {
    suspected: boolean;
    listingClaims: ListingClaims | null;
    councilBuildYear: number | null;
    reasons: string[];
  } | null;
  /** When the underlying raw property data was acquired, for "data as at" display. */
  dataFreshness?: { acquiredAt: string; fromCache: boolean } | null;
}

/**
 * Whether a pipeline result holds enough resolved property data to be worth
 * caching globally. Geocode is mandatory (location anchors every source); beyond
 * that we require either a LINZ parcel id (stable identity) or at least one core
 * fact (CV or land area) so we never persist an essentially-empty shell.
 */
export function hasCacheableCore(r: PipelineResult): boolean {
  if (!r.geocode || !r.raw_property) return false;
  const providerId = r.raw_property.planning_provider?.providerId;
  const isRegionalZoneProvider = hasRegionalPlanningZoneLayer(providerId);
  if (
    isRegionalZoneProvider &&
    (!r.raw_property.zone?.zone_code?.trim() || r.raw_property.zone.zone_code === "UNKNOWN")
  ) {
    return false;
  }
  const ph = r.raw_property.property_history;
  const hasCompleteDirectRegionalCore =
    providerId === "taupo"
      ? ph?.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "manawatu"
      ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "western-bay"
      ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "tauranga"
      ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "kapiti"
        ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "selwyn"
        ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "buller"
        ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "napier"
      ? ph?.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "hastings"
      ? ph?.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "whakatane"
      ? ph?.cv_nzd != null && ph.land_area_sqm != null && r.merged?.cv_nzd != null && r.merged.land_area_sqm != null
      : providerId === "southland"
        ? ph?.cv_nzd != null && r.merged?.cv_nzd != null
        : providerId === "christchurch"
          ? ph?.land_area_sqm != null && r.merged?.land_area_sqm != null
          : false;
  if (hasCompleteDirectRegionalCore) return true;

  // Require at least one ScrapingBee-backed scraper to have returned data.
  // hougarden, oneroof, qv, and homes are all browser/ScrapingBee-dependent.
  // If all four are null, ScrapingBee credits are likely depleted — don't
  // cache a shell that's missing the scraper layer entirely, since it will
  // be served stale to every future user of the same address.
  const hasScraperData = !!(r.raw_property.hougarden || r.raw_property.oneroof || r.raw_property.qv || r.raw_property.homes);
  if (!hasScraperData) return false;
  if (r.linz_parcel?.parcel_id) return true;
  const m = r.merged;
  return !!(m && (m.cv_nzd != null || m.land_area_sqm != null));
}

export function developmentScoreUnavailableReason(
  merged: MergedPropertyData,
  _costs: CostBreakdown,
  _scenarios: ROIScenario[],
): string | null {
  if (merged.typology === "unit_apartment") return "unit_or_apartment_typology";
  if (isAucklandBusinessZone(merged.zone_code)) return "non_residential_business_zone";
  if (merged.subdivisionRejectReason === "unit_or_crosslease_signal" && merged.typology !== "standalone") {
    return "unit_or_crosslease_signal";
  }
  if (merged.land_area_sqm == null || !Number.isFinite(merged.land_area_sqm) || merged.land_area_sqm <= 0) {
    return "missing_land_area_sqm";
  }
  if (merged.zone_code == null) return "missing_zone";
  return null;
}

/** Drop bulky, volatile photo fields before caching — photos are refetched live
 * from the active listing on every serve, never served stale. */
function stripScraperPhotos<T>(d: T | null): T | null {
  if (!d) return d;
  const clone: Record<string, unknown> = { ...(d as unknown as Record<string, unknown>) };
  if ("photo_urls" in clone) clone.photo_urls = [];
  if ("main_photo_url" in clone) clone.main_photo_url = null;
  return clone as unknown as T;
}

/** OneRoof drives merged.listing_active / listing_price / photos (see
 * scrapers/merge.ts), so neutralise its volatile listing state before caching.
 * The live active-listing fetch remains the sole authority on serve. */
function stripOneRoofVolatile(d: OneRoofData | null): OneRoofData | null {
  if (!d) return d;
  const clone: Record<string, unknown> = { ...(d as unknown as Record<string, unknown>) };
  if ("photo_urls" in clone) clone.photo_urls = [];
  if ("main_photo_url" in clone) clone.main_photo_url = null;
  if ("listing_active" in clone) clone.listing_active = false;
  if ("listing_price" in clone) clone.listing_price = null;
  return clone as unknown as OneRoofData;
}

/** Preserve stable, exact property-profile facts while removing listing media
 * and marketing copy that can change independently of the property record. */
function stripRealestateProfileVolatile(profile: ListingResult | null): ListingResult | null {
  if (!profile) return null;
  return {
    ...profile,
    description: null,
    photoUrl: null,
    photoUrls: [],
  };
}

async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  timing: Record<string, number>,
): Promise<{ value: T | null; failed: boolean; errorMessage?: string }> {
  const start = Date.now();
  try {
    const value = await fn();
    timing[label] = Date.now() - start;
    return { value, failed: false };
  } catch (err) {
    timing[label] = Date.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const isBrowserError = /chromium|browser|launch|executable/i.test(errorMessage);
    const isTimeout = /timeout|timed out|abort/i.test(errorMessage);
    const category = isBrowserError ? "BROWSER_NOT_FOUND" : isTimeout ? "TIMEOUT" : "ERROR";
    logger.warn({ err, label, category, elapsed_ms: timing[label] }, `Pipeline source failed: ${label} [${category}]`);
    return { value: null, failed: true, errorMessage };
  }
}

export async function runPropertyPipeline(
  address: string,
  options: {
    preferredRealestateListingUrl?: string | null;
    selectedListingContext?: SelectedListingContext | null;
    /** When supplied (a global-cache HIT), every external fetch short-circuits to
     * this bundle's value instead of hitting the network, while the derived
     * computation and the live listing/photo fetches still run fresh. */
    cachedRaw?: RawPropertyData | null;
    /** When `cachedRaw` is supplied: the timestamp that bundle was acquired
     * (cache row's lastRefreshedAt), surfaced as `dataFreshness.acquiredAt`. */
    cachedRawAcquiredAt?: string | null;
    /**
     * Verified address alias used only to acquire coordinates when the canonical
     * rating/listing address has no standalone geocoder point (for example two
     * dwelling addresses sharing one live title). The report and all property
     * lookups continue to use `address`.
     */
    geocodeFallbackAddress?: string | null;
    /** Coordinated delivery assumptions for separately analysed package sites. */
    packageDevelopment?: {
      siteCount: number;
      constructionDiscountPercent: number;
    } | null;
  } = {},
): Promise<PipelineResult> {
  const timing: Record<string, number> = {};
  const failedSources: string[] = [];
  const pipelineStart = Date.now();
  let preferredRealestateListing: ListingResult | null = null;
  let realestatePropertyProfile: ListingResult | null =
    options.cachedRaw?.realestate_property_profile ?? null;

  // Global property cache: when present, leaf external fetches below resolve from
  // `cr` instead of the network. The derived/financial layer is untouched and
  // recomputes every serve, and the active-listing/photo fetches still run live.
  const cr = options.cachedRaw ?? null;

  logger.info({ address, served_from_cache: !!cr }, "Pipeline starting");

  if (options.preferredRealestateListingUrl) {
    const preferredListingResult = await timed(
      "preferred_realestate_listing",
      () => fetchRealestateListingByUrl(options.preferredRealestateListingUrl!),
      timing,
    );
    if (!preferredListingResult.failed) {
      preferredRealestateListing = preferredListingResult.value;
    } else {
      failedSources.push("preferred_realestate_listing");
    }
  }

  let geocode: GeoResult | null = null;
  const geoResult = await timed("geocode", async () => {
    if (cr) return cr.geocode;
    try {
      return await geocodeAddress(address);
    } catch (primaryError) {
      if (
        preferredRealestateListing?.lat != null &&
        preferredRealestateListing.lng != null &&
        activeListingFactsMatchSubject(preferredRealestateListing, address)
      ) {
        logger.info(
          { address, listing: preferredRealestateListing.address },
          "Pipeline: exact selected listing supplied the subject coordinates",
        );
        return {
          lat: preferredRealestateListing.lat,
          lng: preferredRealestateListing.lng,
          formatted: preferredRealestateListing.address,
          suburb: preferredRealestateListing.address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim() || null,
        };
      }

      realestatePropertyProfile = await fetchRealestatePropertyProfileForAddress(address);
      if (
        realestatePropertyProfile?.lat != null &&
        realestatePropertyProfile.lng != null &&
        activeListingFactsMatchSubject(realestatePropertyProfile, address)
      ) {
        logger.info(
          { address, profile: realestatePropertyProfile.address },
          "Pipeline: exact sold/off-market property profile supplied the subject coordinates",
        );
        return {
          lat: realestatePropertyProfile.lat,
          lng: realestatePropertyProfile.lng,
          formatted: realestatePropertyProfile.address,
          suburb: realestatePropertyProfile.address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim() || null,
        };
      }

      const fallbackAddress = options.geocodeFallbackAddress?.trim();
      if (!fallbackAddress || fallbackAddress.toLowerCase() === address.trim().toLowerCase()) throw primaryError;
      const fallback = await geocodeAddress(fallbackAddress);
      logger.info(
        { address, geocodeFallbackAddress: fallbackAddress },
        "Pipeline: canonical address geocoded through verified same-title alias",
      );
      return { ...fallback, formatted: address };
    }
  }, timing);
  geocode = geoResult.value;

  if (geoResult.failed || !geocode) {
    failedSources.push("geocode");
    logger.warn(
      { address, marker: "PIPELINE_GEOCODE_FAILED" },
      "Geocoding failed — pipeline cannot continue with location-based sources",
    );

    const propHistoryOnly = await timed("property_history", () => fetchPropertyHistoryForReport(address), timing);
    if (propHistoryOnly.failed) failedSources.push("property_history");

    const asbestos = propHistoryOnly.value
      ? checkAsbestosRisk(propHistoryOnly.value.build_year)
      : checkAsbestosRisk(null);
    const asbestosDetail = classifyAsbestos(propHistoryOnly.value?.build_year ?? null);

    return {
      address_input: address,
      suburb: "default",
      geocode: null,
      linz_parcel: null,
      linz_title: null,
      zone: null,
      overlays: [],
      contour: null,
      property_history: propHistoryOnly.value,
      asbestos,
      asbestos_detail: asbestosDetail,
      infrastructure: [],
      hougarden: null,
      oneroof: null,
      homes: null,
      qv: null,
      propertyValue: null,
      realestate_listing: null,
      selectedListingContext: options.selectedListingContext ?? null,
      merged: null,
      lots: null,
      subdivision_pathway: null,
      costs: null,
      comparables: [],
      comparables_quality: "unavailable",
      neighbourhoodContext: null,
      transportContext: null,
      builtEnvironmentContext: null,
      dwellingCondition: null,
      scenarios: [],
      developmentStrategies: [],
      scores: null,
      school_zones_detail: [],
      easements: NO_TITLE,
      failed_sources: failedSources,
      timing_ms: { ...timing, total: Date.now() - pipelineStart },
      completed_at: new Date().toISOString(),
    };
  }

  if (
    preferredRealestateListing?.lat != null &&
    preferredRealestateListing.lng != null &&
    Number.isFinite(preferredRealestateListing.lat) &&
    Number.isFinite(preferredRealestateListing.lng)
  ) {
    geocode = {
      ...geocode,
      lat: preferredRealestateListing.lat,
      lng: preferredRealestateListing.lng,
      formatted: preferredRealestateListing.address || geocode.formatted,
      suburb: preferredRealestateListing.address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim() || geocode.suburb,
    };
    logger.info(
      {
        address,
        listing: preferredRealestateListing.address,
        lat: preferredRealestateListing.lat,
        lng: preferredRealestateListing.lng,
      },
      "Pipeline: using selected active listing coordinates as the subject anchor",
    );
  }

  const { lat, lng } = geocode;
  const planningProvider = planningProviderMetadata({ address, lat, lng });
  const suburb = cr ? cr.suburb : await resolvePipelineSuburb(address, geocode);
  const subjectAddress = looksLikeUnitOrApartmentAddress(address)
    ? address
    : (geocode.formatted ?? address);
  let resolvedListingContext = options.selectedListingContext ?? null;

  // LINZ parcel is fetched first so its parcel polygon bbox can be passed to the contour
  // elevation fetch — this ensures we sample across the full parcel extent (not just a
  // fixed box centred on the street address, which misses the downhill portion of a property).
  const linzParcelResult = await timed("linz_parcel", () => (cr ? Promise.resolve(cr.linz_parcel) : fetchLINZParcel(lat, lng)), timing);
  const linzParcelData = linzParcelResult.value;
  if (linzParcelResult.failed) failedSources.push("linz_parcel");

  // Start interest rate lookup in the background — it's an LLM call that takes
  // 3–8 s and is independent of the scrapers. Kicking it off here means it runs
  // concurrently with wave 1 rather than adding to the sequential tail.
  const interestRatePromise = assessInterestRateOutlook().catch(() => "stable" as const);
  const useBrowserScrapers = browserScrapersEnabled();
  if (!useBrowserScrapers) {
    logger.info("Browser automation disabled for this runtime; keeping direct APIs and ScrapingBee HTTP scrapers enabled");
  }
  const refreshRegionalPlanning =
    !!planningProvider &&
    planningProvider.providerId !== "auckland-legacy";

  // ─── WAVE 1: Run all data sources in parallel ─────────────────────────────
  // All 4 scrapers (Hougarden, OneRoof, QV, Homes) run simultaneously from the
  // start. Previously QV and Homes were only triggered as sequential fallbacks
  // when BOTH CV and land area were missing — this caused them to be skipped
  // whenever LINZ had land area, leaving CV/build year/floor area null.
  // Browser slots (MAX_BROWSERS=3) queue the scrapers naturally so they don't
  // overwhelm the container even when all 4 start at the same time.
  const [
    zoneResult,
    overlaysResult,
    contourResult,
    propertyHistoryResult,
    infrastructureResult,
    hougardenResult,
    oneRoofResult,
    propertyValueResult,
    qvResult,
    homesResult,
  ] = await Promise.allSettled([
    timed("zone",             () => cr && !refreshRegionalPlanning ? Promise.resolve(cr.zone)             : fetchPlanningZoneForReport(lat, lng, address, linzParcelData?.bbox ?? null),                             timing),
    timed("overlays",         () => cr && !refreshRegionalPlanning ? Promise.resolve(cr.overlays)         : fetchPlanningOverlaysForReport(lat, lng, linzParcelData?.bbox ?? null, { address, consensus: true }), timing),
    timed("contour",          () => cr ? Promise.resolve(cr.contour)          : fetchTerrainForReport(lat, lng, linzParcelData?.bbox ?? null, { landAreaSqm: linzParcelData?.area_sqm ?? null }, address), timing),
    timed("property_history", () => cr ? Promise.resolve(cr.property_history) : fetchPropertyHistoryForReport(address, lat, lng, linzParcelData?.area_sqm ?? null),              timing),
    timed("infrastructure",   () => cr && !refreshRegionalPlanning ? Promise.resolve(cr.infrastructure)   : fetchInfrastructureForReport(lat, lng, linzParcelData?.bbox ?? null, linzParcelData?.parcel_id ?? null, { landAreaSqm: linzParcelData?.area_sqm ?? null }, address), timing),
    timed("hougarden",        () => cr ? Promise.resolve(cr.hougarden)        : (useBrowserScrapers
      ? withBrowserSlot(() => scrapeHougarden(lat, lng, address))
      : scrapeHougarden(lat, lng, address, { allowBrowserFallback: false })), timing),
    timed("oneroof",          () => cr ? Promise.resolve(cr.oneroof)          : (useBrowserScrapers
      ? withBrowserSlot(() => scrapeOneRoof(address))
      : scrapeOneRoof(address, { allowBrowserFallback: false })), timing),
    timed("propertyvalue",    () => cr ? Promise.resolve(cr.propertyValue)    : scrapePropertyValue(address, geocode!.formatted ?? address),                  timing),
    timed("qv",               () => cr ? Promise.resolve(cr.qv)               : (useBrowserScrapers ? withBrowserSlot(() => scrapeQV(address)) : Promise.resolve(null)), timing),
    timed("homes",            () => cr ? Promise.resolve(cr.homes)            : (useBrowserScrapers
      ? withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address, { allowBrowserFallback: true }))
      : scrapeHomes(address, suburb, geocode!.formatted ?? address, { allowBrowserFallback: false })), timing),
  ]);

  const zoneData            = zoneResult.status            === "fulfilled" ? zoneResult.value.value            : null;
  const overlaysData        = overlaysResult.status        === "fulfilled" ? (overlaysResult.value.value ?? []) : [];
  const contourData         = contourResult.status         === "fulfilled" ? contourResult.value.value         : null;
  const propertyHistoryData = propertyHistoryResult.status === "fulfilled" ? propertyHistoryResult.value.value  : null;
  let infrastructureData    = infrastructureResult.status  === "fulfilled" ? (infrastructureResult.value.value ?? []) : [];
  let hougardenData         = hougardenResult.status       === "fulfilled" ? hougardenResult.value.value        : null;
  let oneRoofData           = oneRoofResult.status         === "fulfilled" ? oneRoofResult.value.value          : null;
  let propertyValueData     = propertyValueResult.status   === "fulfilled" ? propertyValueResult.value.value    : null;
  let qvData                = qvResult.status              === "fulfilled" ? qvResult.value.value               : null;
  let homesData             = homesResult.status           === "fulfilled" ? homesResult.value.value            : null;

  const wave1HougardenFailed = hougardenResult.status === "rejected" || (hougardenResult.status === "fulfilled" && hougardenResult.value.failed);
  const wave1OneRoofFailed   = oneRoofResult.status   === "rejected" || (oneRoofResult.status   === "fulfilled" && oneRoofResult.value.failed);
  const wave1PropertyValueFailed = propertyValueResult.status === "rejected" || (propertyValueResult.status === "fulfilled" && propertyValueResult.value.failed);
  const wave1QvFailed        = qvResult.status        === "rejected" || (qvResult.status        === "fulfilled" && qvResult.value.failed);
  const wave1HomesFailed     = homesResult.status     === "rejected" || (homesResult.status     === "fulfilled" && homesResult.value.failed);

  if (zoneResult.status            === "rejected" || (zoneResult.status            === "fulfilled" && zoneResult.value.failed))            failedSources.push("zone");
  if (overlaysResult.status        === "rejected" || (overlaysResult.status        === "fulfilled" && overlaysResult.value.failed))        failedSources.push("overlays");
  if (contourResult.status         === "rejected" || (contourResult.status         === "fulfilled" && contourResult.value.failed))         failedSources.push("contour");
  if (propertyHistoryResult.status === "rejected" || (propertyHistoryResult.status === "fulfilled" && propertyHistoryResult.value.failed)) failedSources.push("property_history");
  if (infrastructureResult.status  === "rejected" || (infrastructureResult.status  === "fulfilled" && infrastructureResult.value.failed))  failedSources.push("infrastructure");
  if (wave1HougardenFailed) failedSources.push("hougarden");
  if (wave1OneRoofFailed)   failedSources.push("oneroof");
  if (wave1PropertyValueFailed) failedSources.push("propertyvalue");
  if (wave1QvFailed)        failedSources.push("qv");
  if (wave1HomesFailed)     failedSources.push("homes");

  const zoneCodeForInfrastructure = zoneData?.zone_code?.trim().toUpperCase() ?? null;
  const needsZoneBasedRuralInfrastructure =
    !cr &&
    zoneCodeForInfrastructure != null &&
    ["CLZ", "LLRZ", "RCSZ", "RUR", "RURAL LIFESTYLE ENVIRONMENT", "GENERAL RURAL ENVIRONMENT"].includes(zoneCodeForInfrastructure) &&
    !infrastructureData.some((item) => item.rural_infrastructure_adjusted);
  if (needsZoneBasedRuralInfrastructure) {
    const zoneAwareInfrastructure = await timed(
      "infrastructure_rural_zone_retry",
      () => fetchInfrastructureForReport(lat, lng, linzParcelData?.bbox ?? null, linzParcelData?.parcel_id ?? null, {
        zoneCode: zoneCodeForInfrastructure,
        landAreaSqm: linzParcelData?.area_sqm ?? null,
      }, address),
      timing,
    );
    if (!zoneAwareInfrastructure.failed && zoneAwareInfrastructure.value) {
      infrastructureData = zoneAwareInfrastructure.value;
    }
  }

  // ─── LINZ title, memorials ────────────────────────────────────────────────
  let linzTitle: LinzTitle | null = null;
  let linzLrsTitlePreview: LinzLrsAddressTitlePreview | null = null;
  let linzLrsStatus: LinzLrsTitlePreviewStatus = "failed";
  let linzLrsPreviewSource: LinzLrsTitlePreviewSource = null;
  let easementAnalysis: EasementAnalysis = NO_TITLE; // default: could not resolve title
  // Retained raw for the cache bundle; easementAnalysis is always recomputed from it.
  let linzMemorialsRaw: Awaited<ReturnType<typeof fetchLINZMemorials>> = null;
  const lrsTitlePreviewResult = await timed(
    "linz_lrs_title_preview",
    async () => {
      if (cr) return cr.linz_lrs_preview_result;
      const primary = await fetchLINZTitlesByAddressDetailed(subjectAddress);
      const fallback = options.geocodeFallbackAddress?.trim();
      const identityKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
      if (primary.preview || !fallback || identityKey(fallback) === identityKey(subjectAddress)) {
        return primary;
      }
      const alias = await fetchLINZTitlesByAddressDetailed(fallback);
      if (alias.preview) {
        logger.info(
          { address: subjectAddress, geocodeFallbackAddress: fallback, titleNo: alias.preview.titles[0]?.title_no ?? null },
          "Pipeline: canonical address title resolved through verified same-title alias",
        );
        return alias;
      }
      return primary;
    },
    timing,
  );
  if (!lrsTitlePreviewResult.failed && lrsTitlePreviewResult.value) {
    linzLrsTitlePreview = lrsTitlePreviewResult.value.preview;
    linzLrsStatus = lrsTitlePreviewResult.value.status;
    linzLrsPreviewSource = lrsTitlePreviewResult.value.source;
  }
  if (linzParcelData?.title_no) {
    const [titleResult, memorialsResult] = await Promise.allSettled([
      timed("linz_title", () => (cr ? Promise.resolve(cr.linz_title) : fetchLINZTitle(linzParcelData.title_no!)), timing),
      timed("linz_memorials", () => (cr ? Promise.resolve(cr.linz_memorials) : fetchLINZMemorials(linzParcelData.title_no!)), timing),
    ]);
    if (titleResult.status === "fulfilled") {
      linzTitle = titleResult.value.value;
      if (titleResult.value.failed) failedSources.push("linz_title");
    }
    if (memorialsResult.status === "fulfilled" && !memorialsResult.value.failed) {
      // fetchLINZMemorials returns null on API error, [] on genuine "no memorials"
      const memorials = memorialsResult.value.value;
      linzMemorialsRaw = memorials;
      if (memorials === null) {
        easementAnalysis = API_ERROR;
        failedSources.push("linz_memorials");
        logger.warn({ title_no: linzParcelData.title_no }, "LINZ memorials API error — easement data unavailable");
      } else {
        const landArea = linzParcelData.area_sqm ?? 400;
        easementAnalysis = parseEasements(memorials, landArea);
        logger.info({ title_no: linzParcelData.title_no, memorial_count: memorials.length, easements: easementAnalysis.burdening.length, retrieval_status: easementAnalysis.retrieval_status }, "LINZ memorials processed");
      }
    } else if (memorialsResult.status === "rejected") {
      easementAnalysis = API_ERROR;
      failedSources.push("linz_memorials");
    }
  }

  // ─── WAVE 2: Retry failed scrapers for critical missing data ──────────────
  // If CV, build year, or floor area are still null after wave 1, retry any
  // scraper that failed. We allow one retry per scraper to maximise the chance
  // of complete data without infinite looping. The retry runs in parallel so it
  // adds at most one extra scraper-duration to the total pipeline time.
  const getCriticalCoverage = (
    hg: HougardenData | null, or: OneRoofData | null,
    pv: PropertyValueData | null, qv: QVData | null, hm: HomesData | null, ph: typeof propertyHistoryData,
  ) => ({
    hasCV:        !!(pv?.cv_nzd    || hg?.cv_nzd    || or?.cv_nzd    || qv?.cv_nzd    || hm?.cv_nzd    || ph?.cv_nzd),
    hasBuildYear: !!(pv?.build_year || hg?.build_year || or?.build_year || qv?.build_year || hm?.build_year || ph?.build_year),
    hasFloorArea: !!(pv?.floor_area_sqm || hg?.floor_area_sqm || or?.floor_area_sqm || qv?.floor_area_sqm || hm?.floor_area_sqm),
  });

  const getCriticalSourceMap = (
    hg: HougardenData | null, or: OneRoofData | null,
    pv: PropertyValueData | null, qv: QVData | null, hm: HomesData | null, ph: typeof propertyHistoryData,
  ) => ({
    cv: {
      propertyvalue: !!pv?.cv_nzd,
      property_history: !!ph?.cv_nzd,
      hougarden: !!hg?.cv_nzd,
      oneroof: !!or?.cv_nzd,
      qv: !!qv?.cv_nzd,
      homes: !!hm?.cv_nzd,
    },
    build_year: {
      propertyvalue: !!pv?.build_year,
      property_history: !!ph?.build_year,
      hougarden: !!hg?.build_year,
      oneroof: !!or?.build_year,
      qv: !!qv?.build_year,
      homes: !!hm?.build_year,
    },
    floor_area: {
      propertyvalue: !!pv?.floor_area_sqm,
      property_history: !!ph?.floor_area_sqm,
      hougarden: !!hg?.floor_area_sqm,
      oneroof: !!or?.floor_area_sqm,
      qv: !!qv?.floor_area_sqm,
      homes: !!hm?.floor_area_sqm,
    },
  });

  const wave1Coverage = getCriticalCoverage(hougardenData, oneRoofData, propertyValueData, qvData, homesData, propertyHistoryData);
  const wave1SourceMap = getCriticalSourceMap(hougardenData, oneRoofData, propertyValueData, qvData, homesData, propertyHistoryData);
  logger.info({ wave: 1, coverage: wave1Coverage, source_map: wave1SourceMap }, "Critical field coverage snapshot");

  // ─── Detailed scraper diagnostics ───────────────────────────────────────
  // Log exactly what each scraper returned (or why it failed) so missing
  // CV/build-year can be diagnosed without guesswork.
  logger.info({
    marker: "SCRAPER_DIAGNOSTICS",
    property_history: propertyHistoryData
      ? { cv_nzd: propertyHistoryData.cv_nzd, build_year: propertyHistoryData.build_year, floor_area_sqm: propertyHistoryData.floor_area_sqm, confirmed: propertyHistoryData.sources_confirmed, estimated: propertyHistoryData.sources_estimated }
      : "FAILED",
    hougarden: hougardenData
      ? { cv_nzd: hougardenData.cv_nzd, build_year: hougardenData.build_year, floor_area_sqm: hougardenData.floor_area_sqm, land_area_sqm: hougardenData.land_area_sqm, zone_code: hougardenData.zone_code }
      : (wave1HougardenFailed ? "FAILED" : "NULL"),
    oneroof: oneRoofData
      ? { cv_nzd: oneRoofData.cv_nzd, build_year: oneRoofData.build_year, floor_area_sqm: oneRoofData.floor_area_sqm, land_area_sqm: oneRoofData.land_area_sqm, listing_active: oneRoofData.listing_active }
      : (wave1OneRoofFailed ? "FAILED" : "NULL"),
    propertyvalue: propertyValueData
      ? { cv_nzd: propertyValueData.cv_nzd, cv_year: propertyValueData.cv_year, build_year: propertyValueData.build_year, bedrooms: propertyValueData.bedrooms, bathrooms: propertyValueData.bathrooms, floor_area_sqm: propertyValueData.floor_area_sqm, land_area_sqm: propertyValueData.land_area_sqm }
      : (wave1PropertyValueFailed ? "FAILED" : "NULL"),
    qv: qvData
      ? { cv_nzd: qvData.cv_nzd, build_year: qvData.build_year, build_year_range: qvData.build_year_range, bedrooms: qvData.bedrooms, bathrooms: qvData.bathrooms, floor_area_sqm: qvData.floor_area_sqm, land_area_sqm: qvData.land_area_sqm }
      : (wave1QvFailed ? "FAILED" : "NULL"),
    homes: homesData
      ? { cv_nzd: homesData.cv_nzd, build_year: homesData.build_year, floor_area_sqm: homesData.floor_area_sqm, land_area_sqm: homesData.land_area_sqm }
      : (wave1HomesFailed ? "FAILED" : "NULL"),
    all_scrapers_failed: wave1HougardenFailed && wave1OneRoofFailed && wave1PropertyValueFailed && wave1QvFailed && wave1HomesFailed,
  }, "Wave 1 scraper diagnostics — check for FAILED sources if CV/build-year missing");

  const criticalMissing = !wave1Coverage.hasCV || !wave1Coverage.hasBuildYear || !wave1Coverage.hasFloorArea;

  // ── Time-budget guard ────────────────────────────────────────────────────
  // Wave 2 retries add 15–40 s. Skip them if we're already past the 70 s
  // mark so the LLM analysis call still fits inside the client's 200 s
  // window. The report will use whatever data wave 1 collected.
  const wave1ElapsedMs = Date.now() - pipelineStart;
  const skipWave2 = wave1ElapsedMs > 70_000;

  if (criticalMissing && !skipWave2) {
    logger.info({
      missing_cv: !wave1Coverage.hasCV,
      missing_build_year: !wave1Coverage.hasBuildYear,
      missing_floor_area: !wave1Coverage.hasFloorArea,
      retrying: { hougarden: wave1HougardenFailed, oneroof: wave1OneRoofFailed, propertyvalue: wave1PropertyValueFailed, qv: wave1QvFailed, homes: wave1HomesFailed },
    }, "Wave 1 missing critical data — retrying failed scrapers");

    const retryPromises: Promise<void>[] = [];

    if (useBrowserScrapers && wave1HougardenFailed) {
      retryPromises.push(
        timed("hougarden_retry", () => withBrowserSlot(() => scrapeHougarden(lat, lng, address)), timing)
          .then((r) => { if (!r.failed && r.value) hougardenData = r.value; })
          .catch(() => {}),
      );
    }
    if (useBrowserScrapers && wave1OneRoofFailed) {
      retryPromises.push(
        timed("oneroof_retry", () => withBrowserSlot(() => scrapeOneRoof(address)), timing)
          .then((r) => { if (!r.failed && r.value) oneRoofData = r.value; })
          .catch(() => {}),
      );
    }
    if (wave1PropertyValueFailed) {
      retryPromises.push(
        timed("propertyvalue_retry", () => scrapePropertyValue(address, geocode!.formatted ?? address), timing)
          .then((r) => { if (!r.failed && r.value) propertyValueData = r.value; })
          .catch(() => {}),
      );
    }
    if (useBrowserScrapers && wave1QvFailed) {
      retryPromises.push(
        timed("qv_retry", () => withBrowserSlot(() => scrapeQV(address)), timing)
          .then((r) => { if (!r.failed && r.value) qvData = r.value; })
          .catch(() => {}),
      );
    }
    if (useBrowserScrapers && wave1HomesFailed) {
      retryPromises.push(
        timed("homes_retry", () => withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address, { allowBrowserFallback: true })), timing)
          .then((r) => { if (!r.failed && r.value) homesData = r.value; })
          .catch(() => {}),
      );
    } else if (!useBrowserScrapers && wave1HomesFailed) {
      retryPromises.push(
        timed("homes_retry", () => scrapeHomes(address, suburb, geocode!.formatted ?? address, { allowBrowserFallback: false }), timing)
          .then((r) => { if (!r.failed && r.value) homesData = r.value; })
          .catch(() => {}),
      );
    }

    if (retryPromises.length > 0) {
      await Promise.allSettled(retryPromises);
      const wave2Coverage = getCriticalCoverage(hougardenData, oneRoofData, propertyValueData, qvData, homesData, propertyHistoryData);
      const wave2SourceMap = getCriticalSourceMap(hougardenData, oneRoofData, propertyValueData, qvData, homesData, propertyHistoryData);
      logger.info({
        recovered_cv: !wave1Coverage.hasCV && wave2Coverage.hasCV,
        recovered_build_year: !wave1Coverage.hasBuildYear && wave2Coverage.hasBuildYear,
        recovered_floor_area: !wave1Coverage.hasFloorArea && wave2Coverage.hasFloorArea,
        source_map: wave2SourceMap,
      }, "Wave 2 retry complete");
    }
  } else if (criticalMissing && skipWave2) {
    logger.warn({ wave1ElapsedMs, missing_cv: !wave1Coverage.hasCV, missing_build_year: !wave1Coverage.hasBuildYear, missing_floor_area: !wave1Coverage.hasFloorArea }, "Wave 2 skipped — time budget exceeded (>70 s elapsed). Proceeding with wave 1 data.");
  }

  const finalCoverage = getCriticalCoverage(hougardenData, oneRoofData, propertyValueData, qvData, homesData, propertyHistoryData);
  const finalSourceMap = getCriticalSourceMap(hougardenData, oneRoofData, propertyValueData, qvData, homesData, propertyHistoryData);
  if (!finalCoverage.hasCV || !finalCoverage.hasBuildYear) {
    logger.warn(
      {
        marker: "PIPELINE_CRITICAL_DATA_MISSING",
        coverage: finalCoverage,
        source_map: finalSourceMap,
        failed_sources: failedSources,
      },
      "Critical source data still missing after scraper waves",
    );
  } else {
    logger.info({ coverage: finalCoverage, source_map: finalSourceMap }, "Critical source data coverage complete");
  }

  const hasBedrooms = !!(
    propertyValueData?.bedrooms ||
    qvData?.bedrooms ||
    homesData?.bedrooms ||
    oneRoofData?.bedrooms
  );
  const hasBathrooms = !!(
    propertyValueData?.bathrooms ||
    qvData?.bathrooms ||
    homesData?.bathrooms ||
    oneRoofData?.bathrooms
  );
  const hasConflictingRoomCounts =
    hasRoomCountConflict([
      propertyValueData?.bedrooms,
      qvData?.bedrooms,
      homesData?.bedrooms,
      oneRoofData?.bedrooms,
    ]) ||
    hasRoomCountConflict([
      propertyValueData?.bathrooms,
      qvData?.bathrooms,
      homesData?.bathrooms,
      oneRoofData?.bathrooms,
    ]);
  if (
    !realestatePropertyProfile &&
    (
      !finalCoverage.hasCV ||
      !finalCoverage.hasBuildYear ||
      !finalCoverage.hasFloorArea ||
      !hasBedrooms ||
      !hasBathrooms ||
      hasConflictingRoomCounts
    )
  ) {
    const profileResult = await timed(
      "realestate_property_profile",
      () => fetchRealestatePropertyProfileForAddress(address),
      timing,
    );
    if (!profileResult.failed) realestatePropertyProfile = profileResult.value;
  }

  const linzAreaSqm = linzParcelData?.area_sqm ?? null;

  // Priority: elevation API (actual measured degrees) always wins over scraped text labels.
  // QV/Hougarden text like "easy/moderate rise" is just a broad administrative rating —
  // the elevation API calculates real slope from DEM data and is far more accurate.
  const scrapedContourText =
    qvData?.contour_classification
      ? { classification: qvData.contour_classification, text: qvData.contour_text, source: "QV Rating Valuation" }
      : hougardenData?.contour_classification
        ? { classification: hougardenData.contour_classification, text: hougardenData.contour_text, source: "Hougarden" }
        : null;

  // Use elevation API when it returned actual slope degrees; fall back to scraped text only when elevation API failed.
  const elevationMeasured = contourData?.slope_degrees != null;
  const resolvedContour = elevationMeasured
    ? { classification: contourData!.classification, text: scrapedContourText?.text ?? null, source: contourData!.source }
    : (scrapedContourText ?? (contourData ? { classification: contourData.classification, text: null, source: contourData.source } : null));

  if (elevationMeasured) {
    logger.info({ classification: contourData!.classification, slope_degrees: contourData!.slope_degrees, source: contourData!.source, qv_text: scrapedContourText?.text }, "Contour: using measured elevation API (overrides QV text)");
  } else if (scrapedContourText) {
    logger.info({ classification: scrapedContourText.classification, text: scrapedContourText.text }, "Contour: elevation API unavailable — using scraped text fallback");
  }

  // Resolve active listing context. This starts with the same realestate.co.nz
  // JSON API used by property-card discovery, then falls back to
  // ScrapingBee-backed Homes/OneRoof/Trade Me exact listing pages.
  // A combined/packaged listing is expanded into one report per child address.
  // Those sub-addresses are not separately listed, so speculative photo pages
  // resolve to a neighbour/parent gallery. Suppress them and only trust photos
  // from a listing whose scope matches this exact child.
  const isCombinedListingChild =
    options.selectedListingContext?.isCombinedListing === true
    || options.packageDevelopment != null;

  let realestateListing: ListingResult | null = null;
  const activeListingResult = await timed(
    "active_listing_context",
    async () => resolveActiveListingContext(address, {
      purpose: "feasibility",
      suburb,
      formattedAddress: subjectAddress,
      preferredRealestateListingUrl: preferredRealestateListing?.listingUrl ?? options.preferredRealestateListingUrl ?? null,
      selectedListingContext: options.selectedListingContext ?? null,
      suppressSpeculativePhotoSources: isCombinedListingChild,
    }),
    timing,
  );
  if (!activeListingResult.failed && activeListingResult.value) {
    realestateListing =
      activeListingResult.value.realestateListing ??
      preferredRealestateListing ??
      realestatePropertyProfile;
    resolvedListingContext = activeListingResult.value.context ?? options.selectedListingContext ?? null;
  } else {
    failedSources.push("active_listing_context");
    realestateListing = preferredRealestateListing ?? realestatePropertyProfile;
  }
  const realestateListingForFacts = activeListingFactsMatchSubject(realestateListing, geocode!.formatted ?? address)
    ? realestateListing
    : null;

  const realestatePhotoUrls = realestateListing
    ? Array.from(new Set(realestateListing.photoUrls?.length ? realestateListing.photoUrls : (realestateListing.photoUrl ? [realestateListing.photoUrl] : [])))
    : [];

  // Merge all data sources together. QV and Homes are now passed directly into
  // mergePropertyData (not patched in afterwards) so the smart merge rules
  // (best CV year, consensus build year, median floor area) apply across all
  // four scrapers in one pass. Asbestos risk is a placeholder here — it is
  // recomputed below once the canonical build_year is resolved.
  const merged = mergePropertyData(
    linzParcelData,
    hougardenData,
    oneRoofData,
    zoneData,
    overlaysData,
    {
      contour: resolvedContour?.classification ?? null,
      contour_slope_degrees: elevationMeasured ? (contourData?.slope_degrees ?? null) : null,
      contour_source: resolvedContour?.source ?? null,
      contour_text: resolvedContour?.text ?? null,
      asbestos_risk: "unknown", // placeholder — updated below after build_year is resolved
      contour_steep_area_ratio: elevationMeasured ? (contourData?.steep_area_ratio ?? null) : null,
      contour_moderate_area_ratio: elevationMeasured ? (contourData?.moderate_area_ratio ?? null) : null,
      contour_local_slope_p90_degrees: elevationMeasured ? (contourData?.local_slope_p90_degrees ?? null) : null,
      contour_local_slope_p95_degrees: elevationMeasured ? (contourData?.local_slope_p95_degrees ?? null) : null,
      contour_sample_count: elevationMeasured ? (contourData?.sample_count ?? null) : null,
      large_site_terrain_adjusted: contourData?.large_site_terrain_adjusted ?? false,
      infrastructure: infrastructureData,
      property_history: propertyHistoryData,
      qv: qvData,
      homes: homesData,
      propertyValue: propertyValueData,
      linz_lrs_title_preview: linzLrsTitlePreview,
      analysed_address: geocode!.formatted ?? address,
      realestate_listing: realestateListing,
      preferred_realestate_listing_url: preferredRealestateListing?.listingUrl ?? options.preferredRealestateListingUrl ?? null,
      selected_listing_context: resolvedListingContext ?? null,
      realestate_photo_urls: [
        ...selectedListingPhotoUrls(resolvedListingContext),
        ...realestatePhotoUrls,
      ],
    },
  );
  // Veolia (Papakura) private water network flag — pure function of the geocoded
  // location, so recompute every serve (no external call, no cache field).
  merged.veolia_service_zone = detectVeoliaServiceZone(lat, lng);
  merged.package_development_context = options.packageDevelopment ?? null;
  if (shouldSuppressAucklandPlanningRules(planningProvider)) {
    const ruleStatus = regionalPlanningRuleStatus(planningProvider, zoneData, merged.land_area_sqm, merged.overlays);
    if (merged.zone_code || merged.min_lot_size_sqm) {
      logger.info(
        {
          providerId: planningProvider?.providerId,
          originalZoneCode: merged.zone_code,
          originalMinLotSizeSqm: merged.min_lot_size_sqm,
          regionalZoneCode: ruleStatus.regionalZoneCode,
          regionalMinLotSizeSqm: ruleStatus.verifiedMinimumLotSqm,
        },
        "Regional provider selected: replacing Auckland-specific zone and lot-size modelling",
      );
    }
    const officialRegionalZoneCode =
      zoneData?.zone_code?.trim() && zoneData.zone_code !== "UNKNOWN"
        ? zoneData.zone_code.trim()
        : null;
    merged.zone_code = ruleStatus.automaticYieldClaimsAllowed
      ? ruleStatus.regionalZoneCode
      : ruleStatus.automaticRoiAllowed
        ? officialRegionalZoneCode
        : null;
    merged.min_lot_size_sqm = ruleStatus.automaticYieldClaimsAllowed ? ruleStatus.verifiedMinimumLotSqm : null;
    merged.zone_description = regionalZoneDescriptionWithRuleStatus(
      zoneData,
      planningProvider,
      merged.land_area_sqm,
      merged.overlays,
    );
    const regionalSourcePrefix = planningProvider?.providerId ?? "regional_provider";
    merged.data_sources["zone"] = ruleStatus.automaticYieldClaimsAllowed
      ? `${regionalSourcePrefix}_rule_pack`
      : `${regionalSourcePrefix}_council_gis`;
    merged.data_sources["overlays"] = `${regionalSourcePrefix}_council_gis`;
    if (
      propertyHistoryData?.cv_nzd != null
      && merged.cv_nzd === propertyHistoryData.cv_nzd
    ) {
      merged.data_sources["cv_nzd"] = `${regionalSourcePrefix}_council_rating_gis`;
    }
    if (ruleStatus.sourceLabel && ruleStatus.verifiedMinimumLotSqm != null) {
      merged.data_sources["min_lot_size_sqm"] = ruleStatus.sourceLabel;
    } else if (ruleStatus.sourceLabel) {
      delete merged.data_sources["min_lot_size_sqm"];
      merged.data_sources["subdivision_pathway"] = ruleStatus.sourceLabel;
    }
    if (ruleStatus.note) merged.discrepancies.push(ruleStatus.note);
  }

  // ── Photo enrichment ───────────────────────────────────────────────────
  // Feasibility report photos must be either selected/current active-listing
  // photos or exact live listing photos. Do not use Homes/TradeMe/Hougarden
  // photo-only fallback scrapers here: when there is no listing gallery, the
  // mobile should fall back to Google Street View / satellite imagery.
  const verifiedListingPhotos = selectedListingPhotoUrls(resolvedListingContext);
  const beforeEnrichCount = merged.photo_urls.length;

  // ── Subject-verified vs speculative photos ─────────────────────────────────
  // Subject-verified listing photos only. OneRoof is included only when it
  // confirms the page is a live listing; otherwise the app should show Google
  // Street View / satellite rather than old or unrelated listing images.
  const verifiedSubjectPhotos = Array.from(new Set([
    ...verifiedListingPhotos,
    ...(oneRoofData?.listing_active ? (oneRoofData.photo_urls ?? []) : []),
    ...(oneRoofData?.listing_active && oneRoofData.main_photo_url ? [oneRoofData.main_photo_url] : []),
    ...realestatePhotoUrls,
  ].filter(Boolean)));
  merged.photo_urls = verifiedSubjectPhotos;
  merged.main_photo_url = merged.photo_urls[0] ?? null;

  // Combined-listing child: the package's marketing photos are not specific to
  // any single sub-address, and address-fuzzy scrapers routinely return a
  // neighbouring/parent listing's gallery. Show ONLY photos from a listing
  // whose scope matches this exact child (realestateListingForFacts); otherwise
  // leave photos empty so the mobile falls back to Google Street View / aerial
  // imagery instead of an unrelated gallery. Mirrored in the route's photo
  // override via PipelineResult.suppressNonSubjectPhotos.
  if (isCombinedListingChild) {
    const childMatchedPhotos = realestateListingForFacts
      ? Array.from(new Set([
          ...(realestateListingForFacts.photoUrls ?? []),
          ...(realestateListingForFacts.photoUrl ? [realestateListingForFacts.photoUrl] : []),
        ].filter(Boolean)))
      : [];
    merged.photo_urls = childMatchedPhotos;
    merged.main_photo_url = childMatchedPhotos[0] ?? null;
  }

  // When all scrapers return zero photos (e.g. unlisted property), photo_urls
  // stays empty here. The mobile's getReportPhotoUrls (in FeasibilityReport.tsx)
  // appends Google Street View / Static Map proxy URLs via withFallbacks when
  // urls.length < FALLBACK_PHOTO_TARGET (4), so the user sees Google Maps
  // imagery instead of nothing. No backend image-search fallback is used.

  // ── PhotoScrape diagnostic — observability for triage ──
  logger.info({
    address,
    photoSources: {
      oneroof: oneRoofData?.photo_urls?.length ?? 0,
      oneroofMain: oneRoofData?.main_photo_url ? 1 : 0,
      realestate: realestateListing?.photoUrls?.length ?? 0,
      realestateExtra: realestatePhotoUrls.length,
      propertyValue: propertyValueData?.photo_urls?.length ?? 0,
      trademeFallback: "disabled",
      hougardenFallback: "disabled",
      homesFallback: "disabled",
      oneroofPhotoFallback: "disabled",
      activeListing: verifiedListingPhotos.length,
    },
    beforeEnrichCount,
    totalUnique: merged.photo_urls.length,
    realestateListingFound: !!realestateListing,
  }, "PhotoScrape: summary");

  const titleEstate = linzTitle?.estate_type?.trim() ?? null;
  const lrsTenure = estateTypeFromLrsTitles(linzLrsTitlePreview?.titles ?? []);
  const addressHasUnitPrefix = looksLikeUnitOrApartmentAddress(address);
  const parcelEstate = addressHasUnitPrefix ? null : inferEstateTypeFromParcel(linzParcelData);
  // Sanitize scraped tenure text at the source: scrapers occasionally capture
  // page navigation/menu chrome instead of a tenure, which previously leaked all
  // the way to the property card as a bogus title badge. Only keep values that
  // are a recognisable NZ tenure; otherwise drop to null and fall back to the
  // authoritative LINZ-derived estate type.
  const realestateTenure = sanitizeTenureField(realestateListingForFacts?.tenureText);
  const oneRoofTenure = sanitizeTenureField(oneRoofData?.tenureText);
  const homesTenure = sanitizeTenureField(homesData?.tenureText);
  const titleResolution = resolveTitleStatus({
    lrsTenure,
    lrsPreviewSource: linzLrsPreviewSource,
    lrsStatus: linzLrsStatus,
    listingTenures: [realestateTenure],
    scrapedTenures: [oneRoofTenure, homesTenure],
    titleEstate,
    parcelEstate,
  });
  merged.estate_type = titleResolution.titleType;
  merged.titleResolutionSource = titleResolution.titleResolutionSource;
  merged.lrsStatus = titleResolution.lrsStatus;
  merged.data_sources["title_resolution_source"] = titleResolution.titleResolutionSource;
  merged.data_sources["linz_lrs_status"] = titleResolution.lrsStatus;
  if (titleResolution.titleType) {
    merged.data_sources["estate_type"] = titleResolution.titleResolutionSource;
  }

  // Cross-validate land area between LINZ and scrapers — log warning if they diverge >10%.
  // LINZ is already the canonical source (first priority in mergePropertyData), but we surface
  // discrepancies so engineers can investigate data quality issues.
  const scraperLandArea = propertyValueData?.land_area_sqm ?? hougardenData?.land_area_sqm ?? oneRoofData?.land_area_sqm ?? homesData?.land_area_sqm ?? qvData?.land_area_sqm ?? null;
  if (linzAreaSqm && scraperLandArea && linzAreaSqm > 0) {
    const diffPct = Math.abs(linzAreaSqm - scraperLandArea) / linzAreaSqm;
    if (diffPct > 0.1) {
      logger.warn(
        { linz_area_sqm: linzAreaSqm, scraper_area_sqm: scraperLandArea, diff_pct: `${(diffPct * 100).toFixed(1)}%`, canonical_used: merged.data_sources["land_area_sqm"] ?? "linz" },
        `Land area discrepancy >10%: LINZ=${linzAreaSqm}m² vs scraper=${scraperLandArea}m². Using ${merged.data_sources["land_area_sqm"] ?? "linz"} as canonical.`,
      );
      merged.data_sources["land_area_discrepancy"] = `LINZ:${linzAreaSqm}m² vs scraper:${scraperLandArea}m² (${(diffPct * 100).toFixed(1)}% diff)`;
    }
  }

  // Compute asbestos classification AFTER merge so both use the same canonical build_year
  // Listing-claims reconciliation: the active listing is the only source that
  // knows about a NEW dwelling on a parcel whose council/valuation records
  // still describe the demolished one (e.g. 1935 house → 10 new townhouses).
  // Must run BEFORE asbestos/eligibility so every downstream consumer sees the
  // reconciled build year rather than the stale pre-redevelopment one.
  let listingClaims = realestateListingForFacts ? extractListingClaims(realestateListingForFacts) : null;
  // LLM tie-breaker for ambiguous copy (townhouse mentions the regex layer
  // couldn't classify). Only ADDS risk flags — never clears deterministic ones.
  if (realestateListingForFacts && listingClaims && hasAmbiguousListingSignals(realestateListingForFacts)) {
    const llmClaims = await timed("listing_claims_llm", () => extractListingClaimsLLM(realestateListingForFacts), timing);
    listingClaims = mergeClaimsSafer(listingClaims, llmClaims.value ?? null);
  }
  const councilBuildYearForCheck = merged.build_year;
  // Optional LINZ probe (env-flag gated): unit-style child addresses at the
  // parent address mean the parcel has already been developed, even when the
  // listing copy is silent about it.
  const linzChildProbe = await fetchLINZChildAddressCount(geocode!.formatted ?? address).catch(() => null);
  const redevelopmentConflict = detectRedevelopmentConflict({
    claims: listingClaims ?? extractListingClaims({}),
    councilBuildYear: councilBuildYearForCheck,
    listingFloorAreaSqm: realestateListingForFacts?.floorArea ?? null,
    councilFloorAreaSqm: merged.floor_area_sqm,
    linzChildAddressCount: linzChildProbe?.childCount ?? null,
  });
  const redevelopmentCheck = {
    suspected: redevelopmentConflict.suspected,
    listingClaims,
    councilBuildYear: councilBuildYearForCheck,
    reasons: redevelopmentConflict.reasons,
  };
  if (redevelopmentConflict.suspected) {
    logger.warn(
      { address, councilBuildYear: councilBuildYearForCheck, reasons: redevelopmentConflict.reasons },
      "Pipeline: listing claims conflict with council records — parcel likely redeveloped; preferring listing-derived dwelling attributes",
    );
    merged.discrepancies.push(
      `Listing claims conflict with council records (parcel likely redeveloped): ${redevelopmentConflict.reasons.join("; ")}.`,
    );
    // Prefer the listing's view of the dwelling: a claimed completion year (or
    // nothing, rather than the demolished dwelling's year) and listing floor area.
    merged.build_year = listingClaims?.completionYear ?? null;
    merged.data_sources["build_year"] = "listing_claims";
    if (realestateListingForFacts?.floorArea != null) {
      merged.floor_area_sqm = realestateListingForFacts.floorArea;
      merged.data_sources["floor_area_sqm"] = "listing_claims";
    }
    if (listingClaims?.dwellingIsTownhouse) {
      merged.property_type = "Townhouse";
      merged.data_sources["property_type"] = "listing_claims";
    }
  }

  // that will be displayed in the UI. This prevents the asbestos risk label from contradicting
  // the build year shown elsewhere in the report.
  const canonicalBuildYear = merged.build_year;
  const asbestos = checkAsbestosRisk(canonicalBuildYear);
  const asbestosDetail = classifyAsbestos(canonicalBuildYear);
  merged.asbestos_risk = asbestosDetail.risk;

  logger.info(
    { build_year: canonicalBuildYear, build_year_source: merged.data_sources["build_year"] ?? "unknown", asbestos_risk: merged.asbestos_risk },
    "Asbestos classification (post-merge)",
  );

  // LINZ LRS is the only tenure source authoritative enough to overrule text
  // inference in the eligibility assessment (e.g. council "HOUSE & FLAT"
  // improvements on a LINZ-verified Fee Simple home-and-income house).
  const lrsVerifiedEstateType =
    titleResolution.titleResolutionSource === "lrs" || titleResolution.titleResolutionSource === "lrs_cache"
      ? merged.estate_type
      : null;

  const preliminaryEligibility = assessPropertyEligibility({
    address: subjectAddress,
    estateType: merged.estate_type,
    verifiedEstateType: lrsVerifiedEstateType,
    legalDescription: [
      linzParcelData?.legal_description,
      linzParcelData?.appellation,
      realestateListingForFacts?.legalDescription,
      ...(propertyValueData?.legal_descriptions ?? []),
    ].filter(Boolean).join(" "),
    propertyType: merged.property_type ?? propertyHistoryData?.property_type ?? propertyValueData?.property_type,
    propertySubType: propertyValueData?.property_sub_type,
    propertyValueLegalDescriptions: propertyValueData?.legal_descriptions,
    landUsePrimary: propertyValueData?.land_use_primary,
    propertyImprovements: propertyValueData?.property_improvements,
    listingPropertyType: realestateListingForFacts?.propertyType,
    listingCategory: realestateListingForFacts?.listingCategory,
    listingTenureText: realestateListingForFacts?.tenureText,
    listingLegalDescription: realestateListingForFacts?.legalDescription,
    linzParcel: linzParcelData,
    landAreaSqm: merged.land_area_sqm,
    floorAreaSqm: merged.floor_area_sqm,
    buildYear: merged.build_year,
    buildYearRange: merged.build_year_range,
    zoneCode: merged.zone_code,
    potentialLots: null,
    minLotSize: null,
    isCombinedListingAggregate: !!realestateListing?.isCombinedListing && !realestateListingForFacts,
    listingClaims,
  });
  if (shouldSuppressParentLandAreaForEligibility(preliminaryEligibility)) {
    const subjectLandArea = resolveSubjectLandAreaForEligibility({
      eligibility: preliminaryEligibility,
      currentLandAreaSqm: merged.land_area_sqm,
      currentLandAreaSource: merged.data_sources["land_area_sqm"] ?? null,
      propertyValueLandAreaSqm: propertyValueData?.land_area_sqm ?? null,
      listingLandAreaSqm: realestateListingForFacts?.landArea ?? null,
      listingLandAreaSource: realestateListingForFacts?.landAreaSource ?? null,
      listingLandAreaConfidence: realestateListingForFacts?.landAreaConfidence ?? null,
      listingLandAreaApprox: realestateListingForFacts?.landAreaApprox ?? null,
    });
    if (subjectLandArea.note) {
      merged.discrepancies.push(subjectLandArea.note);
    }
    merged.land_area_sqm = subjectLandArea.landAreaSqm;
    merged.data_sources["land_area_sqm"] = subjectLandArea.source;
    // NOTE: do NOT derive `estate_type` from `unitLikeSignal` here. That signal
    // matches building-TYPOLOGY phrases ("apartment", "flat", "home unit",
    // "unit X") that are NOT land titles. Many Cross Lease dwellings (e.g.
    // 38/38A Te Arawa Street) carry those phrases in PropertyValue's legal
    // description while the LINZ title is "Cross Lease". Overwriting LINZ here
    // surfaced "Unit title" (→ 单元产权) for cross-lease properties. The
    // authoritative title comes from LINZ / parcel-inference / listing tenure
    // at lines 994-1004; if none of those produced a value, leave it null
    // rather than guess from typology. Subdivision gating uses
    // `unitLikeSignal` directly (property-eligibility.ts:185), so this does
    // not change the subdivision verdict.
  }

  merged.missing_critical_fields = [
    ...(merged.cv_nzd === null ? ["cv_nzd"] : []),
    ...(merged.land_area_sqm === null ? ["land_area_sqm"] : []),
    ...(merged.contour === null ? ["contour"] : []),
  ];

  const easementAreaSqm = easementAnalysis?.total_burdening_area_sqm ?? 0;
  const regionalLotAssessment = calculateRegionalPotentialLots({
    provider: planningProvider,
    zone: zoneData,
    landAreaSqm: merged.land_area_sqm,
    easementAreaSqm,
    overlays: merged.overlays,
  });
  const baseLotResult = regionalLotAssessment?.lotResult ?? calculatePotentialLots(
    merged.land_area_sqm ?? 0,
    merged.zone_code,
    easementAreaSqm,
  );
  const regionalZoneDisplayLabel =
    !regionalLotAssessment &&
    planningProvider &&
    planningProvider.providerId !== "auckland-legacy" &&
    zoneData?.zone_code !== "UNKNOWN" &&
    zoneData?.zone_description?.trim()
      ? zoneData.zone_description.trim()
      : null;
  const rawLotResult = regionalZoneDisplayLabel
    ? { ...baseLotResult, zone_label: regionalZoneDisplayLabel }
    : baseLotResult;
  if (regionalLotAssessment) {
    for (const caveat of regionalLotAssessment.caveats) {
      if (!merged.discrepancies.includes(caveat)) merged.discrepancies.push(caveat);
    }
  }
  const eligibilityRegionalRuleStatus = regionalPlanningRuleStatus(
    planningProvider,
    zoneData,
    merged.land_area_sqm,
    merged.overlays,
  );
  const designLedSubdivisionPathwayVerified =
    eligibilityRegionalRuleStatus.automaticRoiAllowed
    && !eligibilityRegionalRuleStatus.automaticYieldClaimsAllowed
    && eligibilityRegionalRuleStatus.sourceLabel != null;
  const eligibility = assessPropertyEligibility({
    address: subjectAddress,
    estateType: merged.estate_type,
    verifiedEstateType: lrsVerifiedEstateType,
    legalDescription: [
      linzParcelData?.legal_description,
      linzParcelData?.appellation,
      realestateListingForFacts?.legalDescription,
      ...(propertyValueData?.legal_descriptions ?? []),
    ].filter(Boolean).join(" "),
    propertyType: merged.property_type ?? propertyHistoryData?.property_type ?? propertyValueData?.property_type,
    propertySubType: propertyValueData?.property_sub_type,
    propertyValueLegalDescriptions: propertyValueData?.legal_descriptions,
    landUsePrimary: propertyValueData?.land_use_primary,
    propertyImprovements: propertyValueData?.property_improvements,
    listingPropertyType: realestateListingForFacts?.propertyType,
    listingCategory: realestateListingForFacts?.listingCategory,
    listingTenureText: realestateListingForFacts?.tenureText,
    listingLegalDescription: realestateListingForFacts?.legalDescription,
    linzParcel: linzParcelData,
    landAreaSqm: merged.land_area_sqm,
    floorAreaSqm: merged.floor_area_sqm,
    buildYear: merged.build_year,
    buildYearRange: merged.build_year_range,
    zoneCode: merged.zone_code,
    potentialLots: rawLotResult.lots,
    minLotSize: rawLotResult.min_lot_size,
    designLedSubdivisionPathwayVerified,
    isCombinedListingAggregate: !!realestateListing?.isCombinedListing && !realestateListingForFacts,
    listingClaims,
  });
  merged.typology = eligibility.typology;
  merged.typologyConfidence = eligibility.typologyConfidence;
  merged.titleConfidence = eligibility.titleConfidence;
  merged.subdivisionEligible = eligibility.subdivisionEligible;
  merged.subdivisionRejectReason = eligibility.subdivisionRejectReason;
  if (eligibility.typology !== "unknown") merged.data_sources["typology"] = eligibility.typologyConfidence;
  if (eligibility.titleConfidence !== "unknown") merged.data_sources["title_confidence"] = eligibility.titleConfidence;
  if (eligibility.subdivisionRejectReason) {
    merged.data_sources["subdivision_reject_reason"] = eligibility.subdivisionRejectReason;
  }
  const lotResult = shouldForceSingleLotForEligibility(eligibility)
    ? forceSingleLotResult(rawLotResult)
    : rawLotResult;
  const subdivisionAssessmentInput: DesignLedAssessmentInput = {
    netAreaSqm: (merged.land_area_sqm == null || merged.land_area_sqm <= 0) ? null : lotResult.net_area_sqm,
    zoneCode: merged.zone_code,
    zoneLabel: lotResult.zone_label,
    standardVacantLots: lotResult.lots,
    minLotSqm: lotResult.min_lot_size,
    typology: eligibility.typology,
    titleConfidence: eligibility.titleConfidence,
    landAreaConfidence: merged.land_area_sqm != null && merged.land_area_sqm > 0 ? "verified" : "unverified",
    isAlreadySubdividedChild: false,
    buildYear: merged.build_year,
    parcelBbox: linzParcelData?.bbox ?? null,
    overlays: merged.overlays,
    slopeClass: merged.contour,
  };
  const subdivisionAssessment = assessRegionalSubdivisionPathways({
    ...subdivisionAssessmentInput,
    provider: planningProvider,
    zone: zoneData,
  }) ?? assessSubdivisionPathways(subdivisionAssessmentInput);
  const subdivisionPathway = buildSubdivisionPathwayNote(
    // Treat both null and 0 as "area unavailable" — some data sources (e.g.
    // propertyvalue.co.nz for units) return 0 rather than null when the land
    // area is not meaningful.  Passing null ensures buildSubdivisionPathwayNote
    // shows zone education text rather than "0m² site in …".
    (merged.land_area_sqm == null || merged.land_area_sqm <= 0) ? null : lotResult.net_area_sqm,
    merged.zone_code,
    lotResult.lots,
    lotResult.min_lot_size,
    lotResult.zone_label,
    subdivisionAssessment,
    regionalLotAssessment
      ? {
          standardRulesLabel: regionalLotAssessment.sourceLabel,
          jurisdictionLabel: planningProvider?.territorialAuthority ?? planningProvider?.providerName ?? null,
        }
      : undefined,
  );
  const eligibilityNote = eligibilityPlanningNote(eligibility);
  if (eligibilityNote) {
    subdivisionPathway.detail = `${subdivisionPathway.detail} ${eligibilityNote}`;
    const titleVerificationRequired = new Set([
      "unit_or_crosslease_signal",
      "title_not_confirmed_freehold",
      "typology_not_confirmed_standalone",
      "land_area_parent_or_typology_suspect",
    ]).has(eligibility.subdivisionRejectReason ?? "");
    subdivisionPathway.headline = lotResult.lots <= 1 && titleVerificationRequired
      ? `${subdivisionPathway.headline} Title/typology verification required.`
      : subdivisionPathway.headline;
  }
  const modelledLotResult = applyDesignLedMaximumLotCount(lotResult, subdivisionAssessment);

  const neighbourhoodContextResult = await timed(
    "neighbourhood_context",
    () => (cr ? Promise.resolve(cr.neighbourhood_context) : fetchNeighbourhoodContext({ lat, lng, subjectParcelId: linzParcelData?.parcel_id ?? null })),
    timing,
  );
  if (neighbourhoodContextResult.failed) failedSources.push("neighbourhood_context");
  const neighbourhoodContext = neighbourhoodContextResult.value;

  const transportContextResult = await timed(
    "transport_context",
    () => (cr ? Promise.resolve(cr.transport_context) : fetchTransportContext(lat, lng)),
    timing,
  );
  if (transportContextResult.failed) failedSources.push("transport_context");
  const transportContext = transportContextResult.value;

  const builtEnvironmentContextResult = await timed(
    "built_environment_context",
    () => (cr?.built_environment_context
      ? Promise.resolve(cr.built_environment_context)
      : fetchBuiltEnvironmentContext({
          address: subjectAddress,
          lat,
          lng,
          subjectParcelId: linzParcelData?.parcel_id ?? null,
          subjectBuildYear: merged.build_year,
          subjectBuildYearRange: merged.build_year_range,
        })),
    timing,
  );
  if (builtEnvironmentContextResult.failed) failedSources.push("built_environment_context");
  const builtEnvironmentContextRaw = builtEnvironmentContextResult.value;
  const builtEnvironmentContext = hasUsableBuiltEnvironmentContext(builtEnvironmentContextRaw)
    ? builtEnvironmentContextRaw
    : null;

  let comparablesResult = getComparables(
    suburb,
    merged.zone_code,
    lat,
    lng,
    merged.comparables.length > 0 ? merged.comparables : undefined,
  );
  const subjectSiteCondition = classifySiteCondition(merged);
  const requireImprovedDwellingComparables = subjectSiteCondition.siteStatus === "vacant_land";
  const usableComparableCount = () => requireImprovedDwellingComparables
    ? comparablesResult.comparables.filter(isImprovedDwellingComparable).length
    : comparablesResult.comparables.length;
  if (usableComparableCount() < 3) {
    const sup = await timed(
      "realestate_comparables",
      () =>
        fetchSupplementListingComparables({
          suburbName: suburb,
          excludeAddress: subjectAddress,
          priceHintNzd: merged.listing_price ?? merged.cv_nzd,
          landHintSqm: merged.land_area_sqm,
          minTarget: 3,
          maxResults: 5,
          requireImprovedDwelling: requireImprovedDwellingComparables,
        }),
      timing,
    );
    if (!sup.failed && sup.value && sup.value.length > 0) {
      comparablesResult = getComparables(
        suburb,
        merged.zone_code,
        lat,
        lng,
        merged.comparables.length > 0 ? merged.comparables : undefined,
        sup.value,
      );
    }
  }

  const regionalComparableFallback = planningProvider?.providerId === "rotorua"
    ? "rotorua"
    : planningProvider?.providerId === "whakatane"
      ? "whakatane"
      : planningProvider?.providerId === "western-bay"
        ? "western bay of plenty"
      : planningProvider?.providerId === "tauranga"
        ? "tauranga"
      : planningProvider?.providerId === "kapiti"
        ? "paraparaumu"
      : planningProvider?.providerId === "selwyn"
        ? "selwyn"
      : planningProvider?.providerId === "napier"
        ? "napier"
      : planningProvider?.providerId === "hastings"
        ? "hastings"
      : planningProvider?.providerId === "southland"
        ? "southland"
      : planningProvider?.providerId === "taupo"
        ? "taupo"
      : null;
  if (
    regionalComparableFallback &&
    usableComparableCount() < 3 &&
    regionalComparableFallback.toLowerCase() !== suburb.toLowerCase()
  ) {
    const districtSupplement = await timed(
      "regional_district_comparables",
      () => fetchSupplementListingComparables({
        suburbName: regionalComparableFallback,
        excludeAddress: subjectAddress,
        priceHintNzd: merged.listing_price ?? merged.cv_nzd,
        landHintSqm: merged.land_area_sqm,
        minTarget: 3,
        maxResults: 8,
        requireImprovedDwelling: requireImprovedDwellingComparables,
      }),
      timing,
    );
    if (!districtSupplement.failed && districtSupplement.value?.length) {
      comparablesResult = getComparables(
        suburb,
        merged.zone_code,
        lat,
        lng,
        merged.comparables.length > 0 ? merged.comparables : undefined,
        districtSupplement.value,
      );
    }
  }

  // Step 1 — Sequentially enrich comparable candidates with CV, build year,
  // and floor area from AC GIS. Each property is fully resolved before the next.
  if (comparablesResult.comparables.length > 0) {
    const enriched = await enrichComparables(comparablesResult.comparables, { lat, lng }, 8);
    comparablesResult = withComparableAverages(comparablesResult, enriched);
  }

  // Step 2 — deterministically prefer comparables that match the expected exit
  // product. For 3+ small-lot rebuilds this means terrace/townhouse product,
  // not generic standalone suburb sales.
  const comparableSelection = selectComparableSalesForExit({
    comparables: comparablesResult.comparables,
    lots: modelledLotResult.lots,
    sqmPerLot: modelledLotResult.sqm_per_lot,
    subjectLandSqm: merged.land_area_sqm,
    maxSelect: 3,
    requireImprovedDwelling: requireImprovedDwellingComparables,
  });
  if (comparablesResult.comparables.length > 0) {
    comparablesResult = withComparableAverages(comparablesResult, comparableSelection.comparables);
  }

  const marketPsm = comparablesResult.avg_price_per_sqm > 0 ? comparablesResult.avg_price_per_sqm : null;
  const costProfile = regionalCostProfileForProvider(planningProvider?.providerId ?? "auckland-legacy");
  const costs = estimateCosts(merged, modelledLotResult.lots, {
    market_floor_price_per_sqm: marketPsm,
    sqm_per_lot: modelledLotResult.sqm_per_lot,
    cost_profile: costProfile,
    construction_cost_multiplier: options.packageDevelopment
      ? Number((1 - options.packageDevelopment.constructionDiscountPercent / 100).toFixed(4))
      : 1,
    construction_discount_reason: options.packageDevelopment
      ? `${options.packageDevelopment.constructionDiscountPercent}% coordinated package delivery saving across ${options.packageDevelopment.siteCount} adjoining sites.`
      : null,
  });

  const strategyAssessmentPromise = assessDevelopmentStrategy({
    address: subjectAddress,
    build_year: merged.build_year,
    build_year_range: merged.build_year_range,
    floor_area_sqm: merged.floor_area_sqm,
    land_area_sqm: merged.land_area_sqm,
    bedrooms: merged.bedrooms,
    bathrooms: merged.bathrooms,
    zone_code: merged.zone_code,
    zone_description: merged.zone_description,
    potential_lots: modelledLotResult.lots,
    contour: merged.contour,
    asbestos_risk: merged.asbestos_risk,
    cv_nzd: merged.cv_nzd,
    listing_active: merged.listing_active,
    listing_price: merged.listing_price,
    comparable_sales_count: comparablesResult.comparables.length,
  }).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Development strategy LLM assessment failed — using deterministic fallback");
    return buildFallbackDevelopmentStrategyAssessment(merged, modelledLotResult);
  });

  const [interestRateOutlook, strategyAssessment] = await Promise.all([
    interestRatePromise,
    strategyAssessmentPromise,
  ]);

  const hasRealComparablePricing = comparablesResult.avg_sale_price > 0 || comparablesResult.avg_price_per_sqm > 0;
  const regionalCvExitFallbackAllowed = planningProvider?.providerId === "rotorua"
    || planningProvider?.providerId === "taupo"
    || planningProvider?.providerId === "whakatane"
    || planningProvider?.providerId === "southland"
    || planningProvider?.providerId === "wairarapa"
    || planningProvider?.providerId === "matamata-piako"
    || planningProvider?.providerId === "manawatu"
    || planningProvider?.providerId === "western-bay"
    || planningProvider?.providerId === "tauranga"
    || planningProvider?.providerId === "kapiti"
    || planningProvider?.providerId === "selwyn"
    || planningProvider?.providerId === "napier"
    || planningProvider?.providerId === "hastings";
  const fallbackExitSalePrice = !hasRealComparablePricing && regionalCvExitFallbackAllowed
    ? merged.listing_price ?? merged.cv_nzd
    : null;
  const roiAverageSalePrice = comparablesResult.avg_sale_price > 0
    ? comparablesResult.avg_sale_price
    : fallbackExitSalePrice ?? 0;
  const hasRoiExitPricing = hasRealComparablePricing || roiAverageSalePrice > 0;
  if (fallbackExitSalePrice) {
    merged.data_sources["roi_exit_price"] = merged.listing_price
      ? "subject_listing_price_low_confidence"
      : "subject_cv_low_confidence";
    const note = "ROI exit value uses the subject listing price or CV because no credible comparable-sale pricing was available; treat the result as low confidence.";
    if (!merged.discrepancies.includes(note)) merged.discrepancies.push(note);
  }
  const regionalRoiAllowed = !planningProvider
    || planningProvider.providerId === "auckland-legacy"
    || regionalPlanningRuleStatus(planningProvider, zoneData, merged.land_area_sqm, merged.overlays).automaticRoiAllowed;
  // Discounts modelled GDV for dense multi-lot schemes (THAB/MHU/MHS), since
  // those sell as terraces/townhouses at a lower $/dwelling than the mostly
  // standalone-dwelling comparables the suburb average is built from. Was
  // previously hardcoded to 1 (no discount) here and never reached the ROI
  // scenario calc below — only calculateDevelopmentStrategies got the real
  // value — so every multi-lot ROI scenario (and roiPercentBest) was inflated.
  const gdvTypologyMultiplier = exitGdvMultiplierForComparableSelection(
    exitGdvTypologyDiscountFactor(
      merged.zone_code,
      modelledLotResult.lots,
      modelledLotResult.sqm_per_lot,
    ),
    comparableSelection.typologyMatched,
  );
  const neighbourhoodGdvMultiplier = neighbourhoodContext?.marketAdjustment.gdvMultiplier ?? 1;
  // Combine both discounts for the ROI scenarios; floor at 0.4 so a poor
  // neighbourhood adjustment stacked with a dense-zone discount can't collapse
  // GDV to an implausibly small figure.
  const combinedGdvMultiplier = Math.max(0.4, Math.min(1, neighbourhoodGdvMultiplier * gdvTypologyMultiplier));
  const scenarios = hasRoiExitPricing && regionalRoiAllowed
    ? calculateBearBaseBullScenarios(
        costs,
        comparablesResult.avg_price_per_sqm,
        roiAverageSalePrice,
        modelledLotResult.lots,
        modelledLotResult.sqm_per_lot,
        interestRateOutlook,
        combinedGdvMultiplier,
      )
    : [];

  const developmentStrategies = calculateDevelopmentStrategies({
    data: merged,
    baseCosts: costs,
    lotResult: modelledLotResult,
    avgSalePrice: roiAverageSalePrice,
    avgPricePerSqm: comparablesResult.avg_price_per_sqm,
    interestRateOutlook,
    assessment: strategyAssessment,
    comparablesQuality: comparablesResult.data_quality,
    gdvTypologyMultiplier,
    marketGdvMultiplier: neighbourhoodGdvMultiplier,
    typologyMatchedComparables: comparableSelection.typologyMatched,
    neighbourhoodContext,
    subdivisionAssessment,
  });

  const dwellingPhotoUrls = realestateListingForFacts
    ? selectedDwellingConditionPhotoUrls([
        ...(realestateListingForFacts.photoUrls ?? []),
        ...(realestateListingForFacts.photoUrl ? [realestateListingForFacts.photoUrl] : []),
      ])
    : [];
  const dwellingConditionResult = await timed(
    "dwelling_condition",
    () => assessDwellingCondition({
      address: geocode!.formatted ?? address,
      buildYear: merged.build_year,
      buildYearRange: merged.build_year_range,
      listingTitle: realestateListingForFacts?.listingTitle ?? null,
      description: realestateListingForFacts?.description ?? null,
      features: realestateListingForFacts?.features ?? [],
      propertyType: realestateListingForFacts?.propertyType ?? realestateListingForFacts?.listingCategory ?? null,
      listingUrl: realestateListingForFacts?.listingUrl ?? null,
      photoUrls: dwellingPhotoUrls,
      cachedAssessment: cr?.derived_scores?.scoringVersion === SCORING_VERSION
        ? cr.derived_scores.dwellingCondition ?? null
        : null,
    }),
    timing,
  );
  const dwellingCondition = dwellingConditionResult.value ?? null;

  const computedScores = scoreProperty(merged, costs, scenarios, modelledLotResult.lots, builtEnvironmentContext, dwellingCondition);
  if (neighbourhoodContext?.marketAdjustment.reason && !computedScores.roi_reasons.includes(neighbourhoodContext.marketAdjustment.reason)) {
    computedScores.roi_reasons.push(neighbourhoodContext.marketAdjustment.reason);
  }
  for (const reason of transportContext?.roiInfluence.reasons ?? []) {
    if (!computedScores.roi_reasons.includes(reason)) computedScores.roi_reasons.push(reason);
  }
  const scoreUnavailableReason = developmentScoreUnavailableReason(merged, costs, scenarios);
  const scores = scoreUnavailableReason ? null : computedScores;
  const exposedCosts = scoreUnavailableReason ? null : costs;
  const exposedScenarios = scoreUnavailableReason ? [] : scenarios;
  const exposedDevelopmentStrategies = scoreUnavailableReason ? [] : developmentStrategies;

  // School zones: point-in-polygon against the official MoE enrolment-zone
  // boundaries using the geocoded location. Authoritative — it returns the
  // schools whose zone actually contains the property (multiple per level
  // possible). Replaces the old scrape/LLM-guess of school names. Cache-aware:
  // reuse stored hits, but fall back to a live query for rows cached before
  // this field existed (cheap; avoids a full re-acquire).
  const schoolZonesResult = await timed(
    "school_zones_gis",
    () => (cr?.school_zones_gis ? Promise.resolve(cr.school_zones_gis) : fetchSchoolZonesByPoint(lat, lng)),
    timing,
  );
  const schoolGisZones: SchoolZoneGisHit[] = schoolZonesResult.value ?? [];
  merged.data_sources["school_zones"] = schoolGisZones.length > 0 ? "moe_gis" : "none";
  const school_zones_detail = await enrichSchoolZonesFromGis(schoolGisZones, timing);

  timing["total"] = Date.now() - pipelineStart;
  logger.info({ timing, failedSources, served_from_cache: !!cr, cv_nzd: merged.cv_nzd, land_area_sqm: merged.land_area_sqm }, "Pipeline complete");

  // Raw acquired data, suitable for the global cache. Volatile listing/photo
  // fields are stripped here; they are always refetched live on serve.
  const rawProperty: RawPropertyData = {
    schema_version: RAW_PROPERTY_SCHEMA_VERSION,
    site_classification_version: SITE_CLASSIFICATION_VERSION,
    geocode: geocode!,
    suburb,
    linz_parcel: linzParcelData,
    linz_title: linzTitle,
    linz_memorials: linzMemorialsRaw,
    linz_lrs_preview_result: {
      preview: linzLrsTitlePreview,
      status: linzLrsStatus,
      source: linzLrsPreviewSource,
    },
    zone: zoneData,
    overlays: overlaysData,
    contour: contourData,
    infrastructure: infrastructureData,
    property_history: propertyHistoryData,
    ...(planningProvider ? { planning_provider: planningProvider } : {}),
    hougarden: stripScraperPhotos(hougardenData),
    oneroof: stripOneRoofVolatile(oneRoofData),
    qv: stripScraperPhotos(qvData),
    homes: stripScraperPhotos(homesData),
    propertyValue: stripScraperPhotos(propertyValueData),
    realestate_property_profile: stripRealestateProfileVolatile(realestatePropertyProfile),
    neighbourhood_context: neighbourhoodContext,
    transport_context: transportContext,
    built_environment_context: builtEnvironmentContext,
    school_zones_gis: schoolGisZones,
    // Persist the real scores so subdivision screening cards show the exact same
    // numbers as the report (globally, for any user, once analysed). Recomputed
    // and re-persisted on every analysis (fresh or cache-serve), keeping it current.
    derived_scores: {
      scoringVersion: SCORING_VERSION,
      scores,
      scoreUnavailableReason,
      roiPercentBest: nearestHorizonRoiPercent(exposedScenarios),
      landArea: merged.land_area_sqm,
      zone: merged.zone_code,
      potentialLots: modelledLotResult.lots,
      minLotSize: modelledLotResult.min_lot_size > 0 ? modelledLotResult.min_lot_size : null,
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
      builtEnvironmentContext,
      dwellingCondition,
    },
  };

  return {
    address_input: address,
    suburb,
    geocode,
    linz_parcel: linzParcelData,
    linz_title: linzTitle,
    zone: zoneData,
    overlays: overlaysData,
    contour: contourData,
    property_history: propertyHistoryData,
    asbestos,
    asbestos_detail: asbestosDetail,
    infrastructure: infrastructureData,
    hougarden: hougardenData,
    oneroof: oneRoofData,
    homes: homesData,
    qv: qvData,
    propertyValue: propertyValueData,
    realestate_listing: realestateListing,
    selectedListingContext: resolvedListingContext ?? null,
    suppressNonSubjectPhotos: isCombinedListingChild,
    merged,
    lots: modelledLotResult,
    subdivision_pathway: subdivisionPathway,
    costs: exposedCosts,
    comparables: comparablesResult.comparables,
    comparables_quality: comparablesResult.data_quality,
    neighbourhoodContext,
    transportContext,
    builtEnvironmentContext,
    dwellingCondition,
    scenarios: exposedScenarios,
    developmentStrategies: exposedDevelopmentStrategies,
    scores,
    school_zones_detail,
    easements: easementAnalysis,
    failed_sources: failedSources,
    timing_ms: timing,
    completed_at: new Date().toISOString(),
    raw_property: rawProperty,
    served_from_cache: !!cr,
    redevelopmentCheck,
    dataFreshness: {
      acquiredAt: (cr ? options.cachedRawAcquiredAt : null) ?? new Date().toISOString(),
      fromCache: !!cr,
    },
  };
}
