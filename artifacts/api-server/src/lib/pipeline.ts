import { logger } from "./logger";
import { geocodeAddress, type GeoResult } from "./geocode";
import { fetchLINZParcel, fetchLINZTitle, type LinzParcel, type LinzTitle } from "./linz";
import { fetchUnitaryPlanZone, fetchOverlays, fetchContour, type ZoneResult, type Overlay, type ContourResult } from "./auckland-council";
import { fetchPropertyHistory, checkAsbestosRisk, type PropertyHistory, type AsbestosRisk } from "./property-data";
import { fetchInfrastructure, type InfrastructureItem } from "./infrastructure";

export interface PipelineResult {
  address_input: string;
  geocode: GeoResult | null;
  linz_parcel: LinzParcel | null;
  linz_title: LinzTitle | null;
  zone: ZoneResult | null;
  overlays: Overlay[];
  contour: ContourResult | null;
  property_history: PropertyHistory | null;
  asbestos: AsbestosRisk | null;
  infrastructure: InfrastructureItem[];
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

    return {
      address_input: address,
      geocode: null,
      linz_parcel: null,
      linz_title: null,
      zone: null,
      overlays: [],
      contour: null,
      property_history: propHistoryOnly.value,
      asbestos,
      infrastructure: [],
      failed_sources: failedSources,
      timing_ms: { ...timing, total: Date.now() - pipelineStart },
      completed_at: new Date().toISOString(),
    };
  }

  const { lat, lng } = geocode;

  const [
    linzParcelResult,
    zoneResult,
    overlaysResult,
    contourResult,
    propertyHistoryResult,
    infrastructureResult,
  ] = await Promise.allSettled([
    timed("linz_parcel", () => fetchLINZParcel(lat, lng), timing),
    timed("zone", () => fetchUnitaryPlanZone(lat, lng), timing),
    timed("overlays", () => fetchOverlays(lat, lng), timing),
    timed("contour", () => fetchContour(lat, lng), timing),
    timed("property_history", () => fetchPropertyHistory(address), timing),
    timed("infrastructure", () => fetchInfrastructure(lat, lng), timing),
  ]);

  const linzParcelData = linzParcelResult.status === "fulfilled" ? linzParcelResult.value.value : null;
  if (linzParcelResult.status === "rejected" || (linzParcelResult.status === "fulfilled" && linzParcelResult.value.failed)) failedSources.push("linz_parcel");

  const zoneData = zoneResult.status === "fulfilled" ? zoneResult.value.value : null;
  if (zoneResult.status === "rejected" || (zoneResult.status === "fulfilled" && zoneResult.value.failed)) failedSources.push("zone");

  const overlaysData = overlaysResult.status === "fulfilled" ? (overlaysResult.value.value ?? []) : [];
  if (overlaysResult.status === "rejected" || (overlaysResult.status === "fulfilled" && overlaysResult.value.failed)) failedSources.push("overlays");

  const contourData = contourResult.status === "fulfilled" ? contourResult.value.value : null;
  if (contourResult.status === "rejected" || (contourResult.status === "fulfilled" && contourResult.value.failed)) failedSources.push("contour");

  const propertyHistoryData = propertyHistoryResult.status === "fulfilled" ? propertyHistoryResult.value.value : null;
  if (propertyHistoryResult.status === "rejected" || (propertyHistoryResult.status === "fulfilled" && propertyHistoryResult.value.failed)) failedSources.push("property_history");

  const infrastructureData = infrastructureResult.status === "fulfilled" ? (infrastructureResult.value.value ?? []) : [];
  if (infrastructureResult.status === "rejected" || (infrastructureResult.status === "fulfilled" && infrastructureResult.value.failed)) failedSources.push("infrastructure");

  let linzTitle: LinzTitle | null = null;
  if (linzParcelData?.title_no) {
    const titleResult = await timed("linz_title", () => fetchLINZTitle(linzParcelData.title_no!), timing);
    linzTitle = titleResult.value;
    if (titleResult.failed) failedSources.push("linz_title");
  }

  const asbestos = checkAsbestosRisk(propertyHistoryData?.build_year ?? null);

  timing["total"] = Date.now() - pipelineStart;
  logger.info({ timing, failedSources }, "Pipeline complete");

  return {
    address_input: address,
    geocode,
    linz_parcel: linzParcelData,
    linz_title: linzTitle,
    zone: zoneData,
    overlays: overlaysData,
    contour: contourData,
    property_history: propertyHistoryData,
    asbestos,
    infrastructure: infrastructureData,
    failed_sources: failedSources,
    timing_ms: timing,
    completed_at: new Date().toISOString(),
  };
}
