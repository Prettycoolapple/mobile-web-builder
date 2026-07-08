/**
 * Veolia (Papakura) water & wastewater service-area detection.
 *
 * Since 1997 Veolia has operated the RETAIL water and wastewater network for the
 * former Papakura District (Papakura, Takanini, Opaheke, Conifer Grove, Rosehill,
 * Red Hill, Drury, Hingaia, Karaka, Ardmore) under a franchise from Watercare.
 * Inside that area, connection approval and growth/connection charging sit with
 * Veolia rather than Watercare/Auckland Council directly — and Veolia is widely
 * reported as aggressive and unpredictable on developer charges (documented cases
 * of $0.88M–$1.6M forced main extensions for a handful of houses). Critically, a
 * resource consent does NOT guarantee a connection: schemes can be declined for
 * "no capacity" at Engineering Plan Approval after the design spend is committed.
 *
 * We detect the service area with a STATIC boundary polygon (point-in-polygon on
 * the geocoded lat/lng) rather than a live GIS call, so the check is deterministic,
 * free, and resilient to GIS endpoints blocking cloud IPs. The polygon below is a
 * simplified approximation of the former Papakura District territorial boundary and
 * should be refined against the authoritative Stats NZ / LINZ historical TA boundary
 * when convenient; the report language is advisory ("appears to fall within … confirm
 * with Veolia/Watercare"), which keeps edge-of-boundary misclassification low-stakes.
 */

export interface VeoliaServiceZone {
  inServiceZone: boolean;
  network: "papakura";
  source: "static_boundary_v1";
}

/**
 * Simplified ring of the former Papakura District franchise area as [lng, lat]
 * pairs. Northern edge is held tight to the Takanini/Manurewa border (~-37.028)
 * so neighbouring Watercare-serviced Manurewa is not swept in.
 */
const PAPAKURA_FRANCHISE_RING: Array<[number, number]> = [
  [174.875, -37.028], // NW — Takanini / Papakura-Manurewa border
  [174.955, -37.028], // NE — Alfriston / Ardmore north
  [174.990, -37.075], // E  — Ardmore
  [175.000, -37.135], // SE — Hunua foothills / Ararimu
  [174.950, -37.180], // S  — Ramarama / Bombay north
  [174.865, -37.150], // SW — Drury south / Karaka south
  [174.855, -37.090], // W  — Karaka / Hingaia west
  [174.860, -37.045], // NW2 — Hingaia / Takanini west
];

/** Ray-casting point-in-polygon on a [lng, lat] ring. */
function pointInRing(lng: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Returns whether the property (by geocoded lat/lng) appears to fall within the
 * Veolia Papakura service area. Pure function of location — safe to recompute on
 * every serve (no external call, no caching required).
 */
export function detectVeoliaServiceZone(
  lat: number | null | undefined,
  lng: number | null | undefined,
): VeoliaServiceZone {
  const inServiceZone =
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    pointInRing(lng, lat, PAPAKURA_FRANCHISE_RING);
  return { inServiceZone, network: "papakura", source: "static_boundary_v1" };
}
