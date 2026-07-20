import type { RawPropertyData } from "./pipeline";
import { hasRegionalPlanningZoneLayer } from "./regional-arcgis";
import { planningProviderMetadata, type PlanningProviderId } from "./regional-planning";

export function cachedPlanningProviderId(rawData: RawPropertyData): PlanningProviderId | null {
  const explicit = rawData.planning_provider?.providerId;
  // Kāpiti was historically folded into the generic Wellington provider.
  // Re-resolve those rows so the dedicated district provider can reacquire
  // zoning, rating and three-waters data after deployment.
  // Selwyn was previously swallowed by the broad Christchurch/Canterbury
  // providers. Re-resolve those legacy rows as well as Kāpiti/Wellington rows.
  if (explicit && explicit !== "unsupported" && explicit !== "wellington" && explicit !== "christchurch" && explicit !== "canterbury") return explicit;
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
  // This provider was added after some otherwise-complete property bundles
  // were stored. A stale non-empty fallback zone must not prevent the first
  // live Manawatu reacquisition after deployment.
  if (
    rawData.planning_provider?.providerId === "unsupported"
    && (providerId === "manawatu" || providerId === "napier" || providerId === "tauranga" || providerId === "kapiti" || providerId === "selwyn")
  ) {
    return true;
  }
  if (rawData.planning_provider?.providerId === "wellington" && providerId === "kapiti") return true;
  if (
    (rawData.planning_provider?.providerId === "christchurch" || rawData.planning_provider?.providerId === "canterbury")
    && providerId === "selwyn"
  ) return true;
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
  if (providerId === "western-bay") {
    return history?.cv_nzd == null || history.land_area_sqm == null;
  }
  if (providerId === "napier") {
    return history?.land_area_sqm == null;
  }
  if (providerId === "tauranga") {
    return history?.cv_nzd == null || history.land_area_sqm == null;
  }
  if (providerId === "kapiti") {
    return history?.cv_nzd == null || history.land_area_sqm == null;
  }
  if (providerId === "selwyn") {
    return history?.cv_nzd == null || history.land_area_sqm == null;
  }
  if (providerId === "manawatu" && /\b(?:palmerston north|ashhurst|longburn)\b/i.test(rawData.geocode?.formatted ?? "")) {
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
