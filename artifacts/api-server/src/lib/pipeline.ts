import { logger } from "./logger";
import { geocodeAddress, type GeoResult } from "./geocode";
import { fetchLINZParcel, fetchLINZTitle, fetchLINZMemorials, type LinzParcel, type LinzTitle } from "./linz";
import { fetchUnitaryPlanZone, fetchOverlays, fetchContour, type ZoneResult, type Overlay, type ContourResult } from "./auckland-council";
import { fetchPropertyHistory, checkAsbestosRisk, type PropertyHistory, type AsbestosRisk } from "./property-data";
import { fetchInfrastructure, type InfrastructureItem } from "./infrastructure";
import { scrapeHougarden, type HougardenData } from "./scrapers/hougarden";
import { scrapeOneRoof, type OneRoofData } from "./scrapers/oneroof";
import { scrapeHomes, type HomesData } from "./scrapers/homes";
import { scrapeQV, type QVData } from "./scrapers/qv";
import { mergePropertyData, type MergedPropertyData } from "./scrapers/merge";
import { withBrowserSlot } from "./scrapers/browser";
import { classifyAsbestos, type AsbestosClassification } from "./asbestos";
import { calculatePotentialLots, type LotResult } from "./lot-calculator";
import { estimateCosts, type CostBreakdown } from "./cost-estimator";
import { getComparables, type ComparableSale, type ComparablesResult } from "./comparables";
import { calculateBearBaseBullScenarios, type ROIScenario } from "./roi-calculator";
import { assessInterestRateOutlook } from "./claude";
import { scoreProperty, type ScoringResult } from "./scoring";
import { extractSuburb } from "./utils";
import { parseEasements, NO_TITLE, API_ERROR, type EasementAnalysis } from "./easements";

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
  merged: MergedPropertyData | null;
  lots: LotResult | null;
  costs: CostBreakdown | null;
  comparables: ComparableSale[];
  comparables_quality: "live" | "estimated";
  scenarios: ROIScenario[];
  scores: ScoringResult | null;
  easements: EasementAnalysis;
  failed_sources: string[];
  timing_ms: Record<string, number>;
  completed_at: string;
}

async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  timing: Record<string, number>,
): Promise<{ value: T | null; failed: boolean }> {
  const start = Date.now();
  try {
    const value = await fn();
    timing[label] = Date.now() - start;
    return { value, failed: false };
  } catch (err) {
    timing[label] = Date.now() - start;
    logger.warn({ err, label }, `Pipeline source failed: ${label}`);
    return { value: null, failed: true };
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
    logger.warn({ address }, "Geocoding failed — pipeline cannot continue with location-based sources");

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
      merged: null,
      lots: null,
      costs: null,
      comparables: [],
      comparables_quality: "estimated",
      scenarios: [],
      scores: null,
      easements: NO_TITLE,
      failed_sources: failedSources,
      timing_ms: { ...timing, total: Date.now() - pipelineStart },
      completed_at: new Date().toISOString(),
    };
  }

  const { lat, lng } = geocode;
  const suburb = geocode.suburb ?? extractSuburb(geocode.formatted ?? address);

  // LINZ parcel is fetched first so its parcel polygon bbox can be passed to the contour
  // elevation fetch — this ensures we sample across the full parcel extent (not just a
  // fixed box centred on the street address, which misses the downhill portion of a property).
  const linzParcelResult = await timed("linz_parcel", () => fetchLINZParcel(lat, lng), timing);
  const linzParcelData = linzParcelResult.value;
  if (linzParcelResult.failed) failedSources.push("linz_parcel");

  const [
    zoneResult,
    overlaysResult,
    contourResult,
    propertyHistoryResult,
    infrastructureResult,
    hougardenResult,
    oneRoofResult,
  ] = await Promise.allSettled([
    timed("zone",             () => fetchUnitaryPlanZone(lat, lng),                          timing),
    timed("overlays",         () => fetchOverlays(lat, lng),                                 timing),
    timed("contour",          () => fetchContour(lat, lng, linzParcelData?.bbox ?? null),    timing),
    timed("property_history", () => fetchPropertyHistory(address, lat, lng),                 timing),
    timed("infrastructure",   () => fetchInfrastructure(lat, lng),                           timing),
    timed("hougarden",        () => withBrowserSlot(() => scrapeHougarden(lat, lng, address)), timing),
    timed("oneroof",          () => withBrowserSlot(() => scrapeOneRoof(address)),            timing),
  ]);

  const zoneData          = zoneResult.status          === "fulfilled" ? zoneResult.value.value          : null;
  const overlaysData      = overlaysResult.status      === "fulfilled" ? (overlaysResult.value.value ?? [])  : [];
  const contourData       = contourResult.status       === "fulfilled" ? contourResult.value.value       : null;
  const propertyHistoryData = propertyHistoryResult.status === "fulfilled" ? propertyHistoryResult.value.value : null;
  const infrastructureData  = infrastructureResult.status  === "fulfilled" ? (infrastructureResult.value.value ?? []) : [];
  const hougardenData     = hougardenResult.status     === "fulfilled" ? hougardenResult.value.value     : null;
  const oneRoofData       = oneRoofResult.status       === "fulfilled" ? oneRoofResult.value.value       : null;

  if (zoneResult.status          === "rejected" || (zoneResult.status          === "fulfilled" && zoneResult.value.failed))          failedSources.push("zone");
  if (overlaysResult.status      === "rejected" || (overlaysResult.status      === "fulfilled" && overlaysResult.value.failed))      failedSources.push("overlays");
  if (contourResult.status       === "rejected" || (contourResult.status       === "fulfilled" && contourResult.value.failed))       failedSources.push("contour");
  if (propertyHistoryResult.status === "rejected" || (propertyHistoryResult.status === "fulfilled" && propertyHistoryResult.value.failed)) failedSources.push("property_history");
  if (infrastructureResult.status  === "rejected" || (infrastructureResult.status  === "fulfilled" && infrastructureResult.value.failed))  failedSources.push("infrastructure");
  if (hougardenResult.status     === "rejected" || (hougardenResult.status     === "fulfilled" && hougardenResult.value.failed))     failedSources.push("hougarden");
  if (oneRoofResult.status       === "rejected" || (oneRoofResult.status       === "fulfilled" && oneRoofResult.value.failed))       failedSources.push("oneroof");

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
        // API call failed — cannot determine easement status
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

  let homesData: HomesData | null = null;
  let qvData: QVData | null = null;

  const cv_from_scrapers = hougardenData?.cv_nzd ?? oneRoofData?.cv_nzd ?? null;
  const land_from_scrapers = hougardenData?.land_area_sqm ?? oneRoofData?.land_area_sqm ?? null;
  const ac_cv = propertyHistoryData?.cv_nzd ?? null;

  if (!cv_from_scrapers && !ac_cv && !land_from_scrapers && !linzParcelData?.area_sqm) {
    logger.info("Primary scrapers empty — trying QV.co.nz first");
    const qvResult = await timed("qv", () => withBrowserSlot(() => scrapeQV(address)), timing);
    qvData = qvResult.value;
    if (qvResult.failed) failedSources.push("qv");

    const qvHasData = qvData?.cv_nzd && qvData?.land_area_sqm;
    if (!qvHasData) {
      logger.info("QV empty — trying homes.co.nz as fallback");
      const homesResult = await timed("homes", () => withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address)), timing);
      homesData = homesResult.value;
      if (homesResult.failed) failedSources.push("homes");
    }
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

  // Merge first with placeholder asbestos_risk — will be recomputed after merge using
  // the canonical merged.build_year so asbestos classification is consistent with what the UI displays.
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
      infrastructure: infrastructureData,
      property_history: propertyHistoryData,
    },
  );

  for (const [src, d] of [["homes", homesData], ["qv", qvData]] as const) {
    if (!d) continue;
    if (!merged.cv_nzd && d.cv_nzd) { merged.cv_nzd = d.cv_nzd; merged.cv_year = d.cv_year; merged.data_sources["cv_nzd"] = src; }
    if (!merged.land_area_sqm && d.land_area_sqm) { merged.land_area_sqm = d.land_area_sqm; merged.data_sources["land_area_sqm"] = src; }
    if (!merged.build_year && d.build_year) { merged.build_year = d.build_year; merged.data_sources["build_year"] = src; }
    if (!merged.floor_area_sqm && d.floor_area_sqm) { merged.floor_area_sqm = d.floor_area_sqm; merged.data_sources["floor_area_sqm"] = src; }
  }

  // Cross-validate land area between LINZ and scrapers — log warning if they diverge >10%.
  // LINZ is already the canonical source (first priority in mergePropertyData), but we surface
  // discrepancies so engineers can investigate data quality issues.
  const scraperLandArea = hougardenData?.land_area_sqm ?? oneRoofData?.land_area_sqm ?? homesData?.land_area_sqm ?? qvData?.land_area_sqm ?? null;
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
  merged.asbestos_risk = asbestosDetail.risk === "moderate" ? "high" : asbestosDetail.risk;

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

  const costs = estimateCosts(merged, lotResult.lots);

  const comparablesResult = getComparables(
    suburb,
    merged.zone_code,
    lat,
    lng,
    merged.comparables.length > 0 ? merged.comparables : undefined,
  );

  const interestRateOutlook = await assessInterestRateOutlook();

  const scenarios = calculateBearBaseBullScenarios(
    costs,
    comparablesResult.avg_price_per_sqm,
    comparablesResult.avg_sale_price,
    lotResult.lots,
    lotResult.sqm_per_lot,
    interestRateOutlook,
  );

  const scores = scoreProperty(merged, costs, scenarios, lotResult.lots);

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
    merged,
    lots: lotResult,
    costs,
    comparables: comparablesResult.comparables,
    comparables_quality: comparablesResult.data_quality,
    scenarios,
    scores,
    easements: easementAnalysis,
    failed_sources: failedSources,
    timing_ms: timing,
    completed_at: new Date().toISOString(),
  };
}
