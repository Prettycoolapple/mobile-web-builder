import { logger } from "./logger";
import { ai } from "@workspace/integrations-gemini-ai";
import { geocodeAddress, type GeoResult } from "./geocode";
import { fetchLINZParcel, fetchLINZTitle, fetchLINZMemorials, type LinzParcel, type LinzTitle } from "./linz";
import { fetchUnitaryPlanZone, fetchOverlaysWithConsensus, fetchContour, type ZoneResult, type Overlay, type ContourResult } from "./auckland-council";
import { fetchPropertyHistory, checkAsbestosRisk, type PropertyHistory, type AsbestosRisk } from "./property-data";
import { fetchInfrastructure, type InfrastructureItem } from "./infrastructure";
import { scrapeHougarden, type HougardenData } from "./scrapers/hougarden";
import { scrapeOneRoof, type OneRoofData, type ListingResult } from "./scrapers/oneroof";
import { scrapeHomes, type HomesData } from "./scrapers/homes";
import { scrapeQV, type QVData } from "./scrapers/qv";
import { scrapePropertyValue, type PropertyValueData } from "./scrapers/propertyvalue";
import { mergePropertyData, type MergedPropertyData } from "./scrapers/merge";
import { withBrowserSlot } from "./scrapers/browser";
import { classifyAsbestos, type AsbestosClassification } from "./asbestos";
import { calculatePotentialLots, buildSubdivisionPathwayNote, type LotResult, type SubdivisionPathwayNote } from "./lot-calculator";
import { estimateCosts, type CostBreakdown } from "./cost-estimator";
import { getComparables, type ComparableSale, type ComparablesResult } from "./comparables";
import { calculateBearBaseBullScenarios, type ROIScenario } from "./roi-calculator";
import { selectComparableSalesForExit } from "./market-comparables";
import { fetchNeighbourhoodContext, type NeighbourhoodContext } from "./neighbourhood-context";
import { fetchTransportContext, type TransportContext } from "./transport-context";
import { assessDevelopmentStrategy, assessInterestRateOutlook } from "./claude";
import { scoreProperty, type ScoringResult } from "./scoring";
import { parseEasements, NO_TITLE, API_ERROR, type EasementAnalysis } from "./easements";
import {
  buildFallbackDevelopmentStrategyAssessment,
  calculateDevelopmentStrategies,
  type DevelopmentStrategyScenario,
} from "./development-strategies";
import { fetchRealestateListingForAddress, fetchSupplementListingComparables } from "./scrapers/realestate-api";
import { enrichSchoolZonesDetail, type SchoolZoneDetail } from "./school-directory";
import { inferSchoolZonesFromLocation } from "./school-zones-llm";
import { resolvePipelineSuburb } from "./suburb-resolver";

const AC_PROP_MAPSERVER = "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/PropertyValueInfo/MapServer";

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
  merged: MergedPropertyData | null;
  lots: LotResult | null;
  subdivision_pathway: SubdivisionPathwayNote | null;
  costs: CostBreakdown | null;
  comparables: ComparableSale[];
  comparables_quality: "live" | "estimated" | "unavailable";
  neighbourhoodContext: NeighbourhoodContext | null;
  transportContext: TransportContext | null;
  scenarios: ROIScenario[];
  developmentStrategies: DevelopmentStrategyScenario[];
  scores: ScoringResult | null;
  /** MoE directory enrichment for school_zones (Hougarden). */
  school_zones_detail: SchoolZoneDetail[];
  easements: EasementAnalysis;
  failed_sources: string[];
  timing_ms: Record<string, number>;
  completed_at: string;
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

export async function runPropertyPipeline(address: string): Promise<PipelineResult> {
  const timing: Record<string, number> = {};
  const failedSources: string[] = [];
  const pipelineStart = Date.now();

  logger.info({ address }, "Pipeline starting");

  let geocode: GeoResult | null = null;
  const geoResult = await timed("geocode", () => geocodeAddress(address), timing);
  geocode = geoResult.value;

  if (geoResult.failed || !geocode) {
    failedSources.push("geocode");
    logger.warn(
      { address, marker: "PIPELINE_GEOCODE_FAILED" },
      "Geocoding failed — pipeline cannot continue with location-based sources",
    );

    const propHistoryOnly = await timed("property_history", () => fetchPropertyHistory(address), timing);
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
      merged: null,
      lots: null,
      subdivision_pathway: null,
      costs: null,
      comparables: [],
      comparables_quality: "unavailable",
      neighbourhoodContext: null,
      transportContext: null,
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

  const { lat, lng } = geocode;
  const suburb = await resolvePipelineSuburb(address, geocode);

  // LINZ parcel is fetched first so its parcel polygon bbox can be passed to the contour
  // elevation fetch — this ensures we sample across the full parcel extent (not just a
  // fixed box centred on the street address, which misses the downhill portion of a property).
  const linzParcelResult = await timed("linz_parcel", () => fetchLINZParcel(lat, lng), timing);
  const linzParcelData = linzParcelResult.value;
  if (linzParcelResult.failed) failedSources.push("linz_parcel");

  // Start interest rate lookup in the background — it's an LLM call that takes
  // 3–8 s and is independent of the scrapers. Kicking it off here means it runs
  // concurrently with wave 1 rather than adding to the sequential tail.
  const interestRatePromise = assessInterestRateOutlook().catch(() => "stable" as const);
  const useBrowserScrapers = browserScrapersEnabled();
  if (!useBrowserScrapers) {
    logger.info("Browser-backed property scrapers disabled for this runtime; using direct APIs only");
  }

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
    timed("zone",             () => fetchUnitaryPlanZone(lat, lng),                                               timing),
    timed("overlays",         () => fetchOverlaysWithConsensus(lat, lng, linzParcelData?.bbox ?? null),            timing),
    timed("contour",          () => fetchContour(lat, lng, linzParcelData?.bbox ?? null, { landAreaSqm: linzParcelData?.area_sqm ?? null }), timing),
    timed("property_history", () => fetchPropertyHistory(address, lat, lng),                                      timing),
    timed("infrastructure",   () => fetchInfrastructure(lat, lng, linzParcelData?.bbox ?? null, linzParcelData?.parcel_id ?? null, { landAreaSqm: linzParcelData?.area_sqm ?? null }), timing),
    timed("hougarden",        () => useBrowserScrapers ? withBrowserSlot(() => scrapeHougarden(lat, lng, address)) : Promise.resolve(null), timing),
    timed("oneroof",          () => useBrowserScrapers ? withBrowserSlot(() => scrapeOneRoof(address)) : Promise.resolve(null), timing),
    timed("propertyvalue",    () => scrapePropertyValue(address, geocode!.formatted ?? address),                  timing),
    timed("qv",               () => useBrowserScrapers ? withBrowserSlot(() => scrapeQV(address)) : Promise.resolve(null), timing),
    timed("homes",            () => useBrowserScrapers ? withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address)) : Promise.resolve(null), timing),
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
    zoneCodeForInfrastructure != null &&
    ["CLZ", "LLRZ", "RCSZ", "RUR"].includes(zoneCodeForInfrastructure) &&
    !infrastructureData.some((item) => item.rural_infrastructure_adjusted);
  if (needsZoneBasedRuralInfrastructure) {
    const zoneAwareInfrastructure = await timed(
      "infrastructure_rural_zone_retry",
      () => fetchInfrastructure(lat, lng, linzParcelData?.bbox ?? null, linzParcelData?.parcel_id ?? null, {
        zoneCode: zoneCodeForInfrastructure,
        landAreaSqm: linzParcelData?.area_sqm ?? null,
      }),
      timing,
    );
    if (!zoneAwareInfrastructure.failed && zoneAwareInfrastructure.value) {
      infrastructureData = zoneAwareInfrastructure.value;
    }
  }

  // ─── LINZ title, memorials ────────────────────────────────────────────────
  let linzTitle: LinzTitle | null = null;
  let easementAnalysis: EasementAnalysis = NO_TITLE; // default: could not resolve title
  if (linzParcelData?.title_no) {
    const [titleResult, memorialsResult] = await Promise.allSettled([
      timed("linz_title", () => fetchLINZTitle(linzParcelData.title_no!), timing),
      timed("linz_memorials", () => fetchLINZMemorials(linzParcelData.title_no!), timing),
    ]);
    if (titleResult.status === "fulfilled") {
      linzTitle = titleResult.value.value;
      if (titleResult.value.failed) failedSources.push("linz_title");
    }
    if (memorialsResult.status === "fulfilled" && !memorialsResult.value.failed) {
      // fetchLINZMemorials returns null on API error, [] on genuine "no memorials"
      const memorials = memorialsResult.value.value;
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
        timed("homes_retry", () => withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address)), timing)
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

  // Match the subject against active realestate.co.nz listings. This is a
  // direct JSON API path, so it still works in Vercel where browser scrapers
  // are disabled. The merge step can use it to override stale valuation fields.
  let realestateListing: ListingResult | null = null;
  const realestateListingResult = await timed(
    "realestate_listing",
    () => fetchRealestateListingForAddress(geocode.formatted ?? address, suburb),
    timing,
  );
  if (!realestateListingResult.failed) {
    realestateListing = realestateListingResult.value;
  } else {
    failedSources.push("realestate_listing");
  }

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
      realestate_listing: realestateListing,
      realestate_photo_urls: realestatePhotoUrls,
    },
  );

  const titleEstate = linzTitle?.estate_type?.trim() ?? null;
  const parcelEstate = inferEstateTypeFromParcel(linzParcelData);
  const estateFromTitle = titleEstate ?? parcelEstate;
  merged.estate_type = estateFromTitle;
  if (estateFromTitle) merged.data_sources["estate_type"] = titleEstate ? "linz_title" : "linz_parcel_inferred";

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

  merged.missing_critical_fields = [
    ...(merged.cv_nzd === null ? ["cv_nzd"] : []),
    ...(merged.land_area_sqm === null ? ["land_area_sqm"] : []),
    ...(merged.contour === null ? ["contour"] : []),
  ];

  const easementAreaSqm = easementAnalysis?.total_burdening_area_sqm ?? 0;
  const lotResult = calculatePotentialLots(
    merged.land_area_sqm ?? 400,
    merged.zone_code,
    easementAreaSqm,
  );
  const subdivisionPathway = buildSubdivisionPathwayNote(
    lotResult.net_area_sqm,
    merged.zone_code,
    lotResult.lots,
    lotResult.min_lot_size,
    lotResult.zone_label,
  );

  const neighbourhoodContextResult = await timed(
    "neighbourhood_context",
    () => fetchNeighbourhoodContext({ lat, lng, subjectParcelId: linzParcelData?.parcel_id ?? null }),
    timing,
  );
  if (neighbourhoodContextResult.failed) failedSources.push("neighbourhood_context");
  const neighbourhoodContext = neighbourhoodContextResult.value;

  const transportContextResult = await timed(
    "transport_context",
    () => fetchTransportContext(lat, lng),
    timing,
  );
  if (transportContextResult.failed) failedSources.push("transport_context");
  const transportContext = transportContextResult.value;

  let comparablesResult = getComparables(
    suburb,
    merged.zone_code,
    lat,
    lng,
    merged.comparables.length > 0 ? merged.comparables : undefined,
  );
  if (comparablesResult.comparables.length < 3) {
    const sup = await timed(
      "realestate_comparables",
      () =>
        fetchSupplementListingComparables({
          suburbName: suburb,
          excludeAddress: geocode.formatted ?? address,
          priceHintNzd: merged.listing_price ?? merged.cv_nzd,
          landHintSqm: merged.land_area_sqm,
          minTarget: 3,
          maxResults: 5,
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
    lots: lotResult.lots,
    sqmPerLot: lotResult.sqm_per_lot,
    subjectLandSqm: merged.land_area_sqm,
    maxSelect: 3,
  });
  if (comparablesResult.comparables.length > 0) {
    comparablesResult = withComparableAverages(comparablesResult, comparableSelection.comparables);
  }

  const marketPsm = comparablesResult.avg_price_per_sqm > 0 ? comparablesResult.avg_price_per_sqm : null;
  const costs = estimateCosts(merged, lotResult.lots, {
    market_floor_price_per_sqm: marketPsm,
    sqm_per_lot: lotResult.sqm_per_lot,
  });

  const strategyAssessmentPromise = assessDevelopmentStrategy({
    address: geocode.formatted ?? address,
    build_year: merged.build_year,
    build_year_range: merged.build_year_range,
    floor_area_sqm: merged.floor_area_sqm,
    land_area_sqm: merged.land_area_sqm,
    bedrooms: merged.bedrooms,
    bathrooms: merged.bathrooms,
    zone_code: merged.zone_code,
    zone_description: merged.zone_description,
    potential_lots: lotResult.lots,
    contour: merged.contour,
    asbestos_risk: merged.asbestos_risk,
    cv_nzd: merged.cv_nzd,
    listing_active: merged.listing_active,
    listing_price: merged.listing_price,
    comparable_sales_count: comparablesResult.comparables.length,
  }).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Development strategy LLM assessment failed — using deterministic fallback");
    return buildFallbackDevelopmentStrategyAssessment(merged, lotResult);
  });

  const [interestRateOutlook, strategyAssessment] = await Promise.all([
    interestRatePromise,
    strategyAssessmentPromise,
  ]);

  const hasRealComparablePricing = comparablesResult.avg_sale_price > 0 || comparablesResult.avg_price_per_sqm > 0;
  const gdvTypologyMultiplier = 1;
  const neighbourhoodGdvMultiplier = neighbourhoodContext?.marketAdjustment.gdvMultiplier ?? 1;
  const combinedGdvMultiplier = Math.max(0.5, Math.min(1, neighbourhoodGdvMultiplier));
  const scenarios = hasRealComparablePricing
    ? calculateBearBaseBullScenarios(
        costs,
        comparablesResult.avg_price_per_sqm,
        comparablesResult.avg_sale_price,
        lotResult.lots,
        lotResult.sqm_per_lot,
        interestRateOutlook,
        combinedGdvMultiplier,
      )
    : [];

  const developmentStrategies = calculateDevelopmentStrategies({
    data: merged,
    baseCosts: costs,
    lotResult,
    avgSalePrice: comparablesResult.avg_sale_price,
    avgPricePerSqm: comparablesResult.avg_price_per_sqm,
    interestRateOutlook,
    assessment: strategyAssessment,
    comparablesQuality: comparablesResult.data_quality,
    gdvTypologyMultiplier,
    marketGdvMultiplier: neighbourhoodGdvMultiplier,
    typologyMatchedComparables: false,
    neighbourhoodContext,
  });

  const scores = scoreProperty(merged, costs, scenarios, lotResult.lots);
  if (neighbourhoodContext?.marketAdjustment.reason && !scores.roi_reasons.includes(neighbourhoodContext.marketAdjustment.reason)) {
    scores.roi_reasons.push(neighbourhoodContext.marketAdjustment.reason);
  }
  for (const reason of transportContext?.roiInfluence.reasons ?? []) {
    if (!scores.roi_reasons.includes(reason)) scores.roi_reasons.push(reason);
  }

  let schoolZonesForEnrichment = merged.school_zones;
  const missingAllSchoolZones =
    !schoolZonesForEnrichment.primary?.trim() &&
    !schoolZonesForEnrichment.intermediate?.trim() &&
    !schoolZonesForEnrichment.secondary?.trim();

  if (missingAllSchoolZones) {
    const llmZonesResult = await timed(
      "school_zones_llm",
      () => inferSchoolZonesFromLocation(geocode.formatted ?? address, suburb),
      timing,
    );
    const inferred = llmZonesResult.failed ? null : llmZonesResult.value;
    if (
      inferred &&
      (inferred.primary?.trim() || inferred.intermediate?.trim() || inferred.secondary?.trim())
    ) {
      schoolZonesForEnrichment = {
        primary: inferred.primary?.trim() || null,
        intermediate: inferred.intermediate?.trim() || null,
        secondary: inferred.secondary?.trim() || null,
      };
      merged.school_zones = schoolZonesForEnrichment;
      merged.data_sources["school_zones"] = "llm_inferred";
    }
  }

  const school_zones_detail = await enrichSchoolZonesDetail(schoolZonesForEnrichment, timing);

  timing["total"] = Date.now() - pipelineStart;
  logger.info({ timing, failedSources, cv_nzd: merged.cv_nzd, land_area_sqm: merged.land_area_sqm }, "Pipeline complete");

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
    merged,
    lots: lotResult,
    subdivision_pathway: subdivisionPathway,
    costs,
    comparables: comparablesResult.comparables,
    comparables_quality: comparablesResult.data_quality,
    neighbourhoodContext,
    transportContext,
    scenarios,
    developmentStrategies,
    scores,
    school_zones_detail,
    easements: easementAnalysis,
    failed_sources: failedSources,
    timing_ms: timing,
    completed_at: new Date().toISOString(),
  };
}
