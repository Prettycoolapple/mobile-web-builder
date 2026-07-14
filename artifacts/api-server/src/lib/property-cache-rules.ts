import type { RawPropertyData } from "./pipeline";
import { hasRegionalPlanningZoneLayer } from "./regional-arcgis";
import { planningProviderMetadata, type PlanningProviderId } from "./regional-planning";

export function cachedPlanningProviderId(rawData: RawPropertyData): PlanningProviderId | null {
  const explicit = rawData.planning_provider?.providerId;
  if (explicit) return explicit;
  const lat = rawData.geocode?.lat;
  const lng = rawData.geocode?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  return planningProviderMetadata({
    lat,
    lng,
    address: rawData.geocode?.formatted ?? null,
  })?.providerId ?? null;
}

export function cachedRawNeedsRegionalZoneRefresh(rawData: RawPropertyData): boolean {
  const providerId = cachedPlanningProviderId(rawData);
  if (!hasRegionalPlanningZoneLayer(providerId)) return false;
  const zoneCode = rawData.zone?.zone_code?.trim();
  return !zoneCode || zoneCode === "UNKNOWN";
}

export function cachedRawNeedsRegionalPropertyHistoryRefresh(rawData: RawPropertyData): boolean {
  const providerId = cachedPlanningProviderId(rawData);
  const history = rawData.property_history;
  if (providerId === "whakatane") {
    return history?.cv_nzd == null || history.land_area_sqm == null;
  }
  if (providerId === "southland") {
    return history?.cv_nzd == null;
  }
  if (providerId === "christchurch") {
    return history?.land_area_sqm == null;
  }
  return false;
}
