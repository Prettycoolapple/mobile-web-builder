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

  // Start interest rate lookup in the background — it's an LLM call that takes
  // 3–8 s and is independent of the scrapers. Kicking it off here means it runs
  // concurrently with wave 1 rather than adding to the sequential tail.
  const interestRatePromise = assessInterestRateOutlook().catch(() => "stable" as const);

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
    qvResult,
    homesResult,
  ] = await Promise.allSettled([
    timed("zone",             () => fetchUnitaryPlanZone(lat, lng),                                               timing),
    timed("overlays",         () => fetchOverlays(lat, lng),                                                      timing),
    timed("contour",          () => fetchContour(lat, lng, linzParcelData?.bbox ?? null),                         timing),
    timed("property_history", () => fetchPropertyHistory(address, lat, lng),                                      timing),
    timed("infrastructure",   () => fetchInfrastructure(lat, lng),                                                timing),
    timed("hougarden",        () => withBrowserSlot(() => scrapeHougarden(lat, lng, address)),                    timing),
    timed("oneroof",          () => withBrowserSlot(() => scrapeOneRoof(address)),                                timing),
    timed("qv",               () => withBrowserSlot(() => scrapeQV(address)),                                     timing),
    timed("homes",            () => withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address)), timing),
  ]);

  const zoneData            = zoneResult.status            === "fulfilled" ? zoneResult.value.value            : null;
  const overlaysData        = overlaysResult.status        === "fulfilled" ? (overlaysResult.value.value ?? []) : [];
  const contourData         = contourResult.status         === "fulfilled" ? contourResult.value.value         : null;
  const propertyHistoryData = propertyHistoryResult.status === "fulfilled" ? propertyHistoryResult.value.value  : null;
  const infrastructureData  = infrastructureResult.status  === "fulfilled" ? (infrastructureResult.value.value ?? []) : [];
  let hougardenData         = hougardenResult.status       === "fulfilled" ? hougardenResult.value.value        : null;
  let oneRoofData           = oneRoofResult.status         === "fulfilled" ? oneRoofResult.value.value          : null;
  let qvData                = qvResult.status              === "fulfilled" ? qvResult.value.value               : null;
  let homesData             = homesResult.status           === "fulfilled" ? homesResult.value.value            : null;

  const wave1HougardenFailed = hougardenResult.status === "rejected" || (hougardenResult.status === "fulfilled" && hougardenResult.value.failed);
  const wave1OneRoofFailed   = oneRoofResult.status   === "rejected" || (oneRoofResult.status   === "fulfilled" && oneRoofResult.value.failed);
  const wave1QvFailed        = qvResult.status        === "rejected" || (qvResult.status        === "fulfilled" && qvResult.value.failed);
  const wave1HomesFailed     = homesResult.status     === "rejected" || (homesResult.status     === "fulfilled" && homesResult.value.failed);

  if (zoneResult.status            === "rejected" || (zoneResult.status            === "fulfilled" && zoneResult.value.failed))            failedSources.push("zone");
  if (overlaysResult.status        === "rejected" || (overlaysResult.status        === "fulfilled" && overlaysResult.value.failed))        failedSources.push("overlays");
  if (contourResult.status         === "rejected" || (contourResult.status         === "fulfilled" && contourResult.value.failed))         failedSources.push("contour");
  if (propertyHistoryResult.status === "rejected" || (propertyHistoryResult.status === "fulfilled" && propertyHistoryResult.value.failed)) failedSources.push("property_history");
  if (infrastructureResult.status  === "rejected" || (infrastructureResult.status  === "fulfilled" && infrastructureResult.value.failed))  failedSources.push("infrastructure");
  if (wave1HougardenFailed) failedSources.push("hougarden");
  if (wave1OneRoofFailed)   failedSources.push("oneroof");
  if (wave1QvFailed)        failedSources.push("qv");
  if (wave1HomesFailed)     failedSources.push("homes");

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
    qv: QVData | null, hm: HomesData | null, ph: typeof propertyHistoryData,
  ) => ({
    hasCV:        !!(hg?.cv_nzd    || or?.cv_nzd    || qv?.cv_nzd    || hm?.cv_nzd    || ph?.cv_nzd),
    hasBuildYear: !!(hg?.build_year || or?.build_year || qv?.build_year || hm?.build_year || ph?.build_year),
    hasFloorArea: !!(hg?.floor_area_sqm || or?.floor_area_sqm || qv?.floor_area_sqm || hm?.floor_area_sqm),
  });

  const wave1Coverage = getCriticalCoverage(hougardenData, oneRoofData, qvData, homesData, propertyHistoryData);
  const criticalMissing = !wave1Coverage.hasCV || !wave1Coverage.hasBuildYear || !wave1Coverage.hasFloorArea;

  // ── Time-budget guard ────────────────────────────────────────────────────
  // Wave 2 retries add 15–40 s. Skip them if we're already past the 70 s
  // mark so the Gemini analysis call still fits inside the client's 200 s
  // window. The report will use whatever data wave 1 collected.
  const wave1ElapsedMs = Date.now() - pipelineStart;
  const skipWave2 = wave1ElapsedMs > 70_000;

  if (criticalMissing && !skipWave2) {
    logger.info({
      missing_cv: !wave1Coverage.hasCV,
      missing_build_year: !wave1Coverage.hasBuildYear,
      missing_floor_area: !wave1Coverage.hasFloorArea,
      retrying: { hougarden: wave1HougardenFailed, oneroof: wave1OneRoofFailed, qv: wave1QvFailed, homes: wave1HomesFailed },
    }, "Wave 1 missing critical data — retrying failed scrapers");

    const retryPromises: Promise<void>[] = [];

    if (wave1HougardenFailed) {
      retryPromises.push(
        timed("hougarden_retry", () => withBrowserSlot(() => scrapeHougarden(lat, lng, address)), timing)
          .then((r) => { if (!r.failed && r.value) hougardenData = r.value; })
          .catch(() => {}),
      );
    }
    if (wave1OneRoofFailed) {
      retryPromises.push(
        timed("oneroof_retry", () => withBrowserSlot(() => scrapeOneRoof(address)), timing)
          .then((r) => { if (!r.failed && r.value) oneRoofData = r.value; })
          .catch(() => {}),
      );
    }
    if (wave1QvFailed) {
      retryPromises.push(
        timed("qv_retry", () => withBrowserSlot(() => scrapeQV(address)), timing)
          .then((r) => { if (!r.failed && r.value) qvData = r.value; })
          .catch(() => {}),
      );
    }
    if (wave1HomesFailed) {
      retryPromises.push(
        timed("homes_retry", () => withBrowserSlot(() => scrapeHomes(address, suburb, geocode!.formatted ?? address)), timing)
          .then((r) => { if (!r.failed && r.value) homesData = r.value; })
          .catch(() => {}),
      );
    }

    if (retryPromises.length > 0) {
      await Promise.allSettled(retryPromises);
      const wave2Coverage = getCriticalCoverage(hougardenData, oneRoofData, qvData, homesData, propertyHistoryData);
      logger.info({
        recovered_cv: !wave1Coverage.hasCV && wave2Coverage.hasCV,
        recovered_build_year: !wave1Coverage.hasBuildYear && wave2Coverage.hasBuildYear,
        recovered_floor_area: !wave1Coverage.hasFloorArea && wave2Coverage.hasFloorArea,
      }, "Wave 2 retry complete");
    }
  } else if (criticalMissing && skipWave2) {
    logger.warn({ wave1ElapsedMs, missing_cv: !wave1Coverage.hasCV, missing_build_year: !wave1Coverage.hasBuildYear, missing_floor_area: !wave1Coverage.hasFloorArea }, "Wave 2 skipped — time budget exceeded (>70 s elapsed). Proceeding with wave 1 data.");
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
      infrastructure: infrastructureData,
      property_history: propertyHistoryData,
      qv: qvData,
      homes: homesData,
    },
  );

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

  const interestRateOutlook = await interestRatePromise;

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
