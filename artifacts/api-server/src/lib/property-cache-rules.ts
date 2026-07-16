import type { RawPropertyData } from "./pipeline";
import { hasRegionalPlanningZoneLayer } from "./regional-arcgis";
import { planningProviderMetadata, type PlanningProviderId } from "./regional-planning";

export function cachedPlanningProviderId(rawData: RawPropertyData): PlanningProviderId | null {
  const explicit = rawData.planning_provider?.providerId;
  if (explicit && explicit !== "unsupported") return explicit;
  const lat = rawData.geocode?.lat;
  const lng = rawData.geocode?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return explicit ?? null;
  return planningProviderMetadata({
    lat,
    lng,
    address: rawData.geocode?.formatted ?? null,
  })?.providerId ?? explicit ?? null;
}

export function cachedRawNeedsRegionalZoneRefresh(rawData: RawPropertyData): boolean {
  // A row with no stored geocode predates (or failed to capture) coordinates,
  // so cachedPlanningProviderId can't compute a fresh provider id and would
  // silently skip this check forever. Force a refresh rather than trust
  // whatever legacy zone value (if any) is sitting in the row.
  if (typeof rawData.geocode?.lat !== "number" || typeof rawData.geocode?.lng !== "number") {
    return true;
  }
  const providerId = cachedPlanningProviderId(rawData);
  if (!hasRegionalPlanningZoneLayer(providerId)) return false;
  const zoneCode = rawData.zone?.zone_code?.trim().toLowerCase();
  return !zoneCode || zoneCode === "unknown" || zoneCode === "unknown zone" || zoneCode === "regional";
}

export function cachedRawNeedsRegionalPropertyHistoryRefresh(rawData: RawPropertyData): boolean {
  const providerId = cachedPlanningProviderId(rawData);
  const history = rawData.property_history;
  if (providerId === "whakatane") {
    // Whakatane's rating layer is occasionally slow from Vercel.  A complete
    // PropertyValue record is an acceptable persisted fallback and prevents a
    // good report from being needlessly re-acquired on every new search.
    const cvNzd = history?.cv_nzd ?? rawData.propertyValue?.cv_nzd;
    const landAreaSqm = history?.land_area_sqm ?? rawData.propertyValue?.land_area_sqm;
    return cvNzd == null || landAreaSqm == null;
  }
  if (providerId === "southland") {
    return history?.cv_nzd == null;
  }
  if (providerId === "christchurch") {
    return history?.land_area_sqm == null;
  }
  return false;
}
