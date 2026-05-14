import { logger } from "./logger";
import { fetchLINZParcel, type LinzParcel, type ParcelBbox } from "./linz";

export interface InfrastructureItem {
  name: string;
  location: "on-parcel" | "boundary" | "neighbour" | "public-land" | "unknown";
  distance_metres: number | null;
  estimated_cost_low: number;
  estimated_cost_high: number;
  risk: "low" | "moderate" | "high";
  note: string;
}

export type InfrastructureGeometry = {
  paths?: number[][][];
  rings?: number[][][];
  x?: number;
  y?: number;
};

export type InfrastructureFeature = {
  attributes: Record<string, unknown>;
  geometry?: InfrastructureGeometry;
};

type InfrastructureClassification = {
  location: InfrastructureItem["location"];
  distance_metres: number | null;
  estimated_cost_low: number;
  estimated_cost_high: number;
  risk: InfrastructureItem["risk"];
  note: string;
};

type Point = { x: number; y: number };
type OffsiteLandContext = "neighbour" | "public-land" | "unknown";

// Auckland Council public GIS (accessible from cloud).
// gis.aucklandcouncil.govt.nz is often blocked from cloud IPs; mapspublic is not.
const MAPS_BASE = "https://mapspublic.aucklandcouncil.govt.nz/arcgis/rest/services";
const UNDERGROUND_SVC = `${MAPS_BASE}/LiveMaps/UndergroundServices/MapServer`;

const INFRA_LAYERS: Array<{
  name: string;
  layers: Array<{ id: number; label: string }>;
}> = [
  {
    name: "Wastewater",
    layers: [
      { id: 5, label: "Wastewater Pipe (Local)" },
      { id: 12, label: "Wastewater Pipe (Transmission)" },
    ],
  },
  {
    name: "Stormwater",
    layers: [
      { id: 109, label: "Stormwater Pipe" },
      { id: 32, label: "Stormwater Watercourse" },
      { id: 36, label: "Stormwater Channel" },
    ],
  },
  {
    name: "Water Supply",
    layers: [
      { id: 52, label: "Water Pipe (Local)" },
      { id: 61, label: "Water Pipe (Transmission)" },
    ],
  },
];

const LOCATION_RANK: Record<InfrastructureItem["location"], number> = {
  "on-parcel": 0,
  boundary: 1,
  "public-land": 2,
  neighbour: 3,
  unknown: 4,
};

function degLat(metres: number): number {
  return metres / 111_320;
}

function degLng(metres: number, lat: number): number {
  return metres / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
}

function project(lng: number, lat: number, refLat: number, refLng: number): Point {
  return {
    x: (lng - refLng) * 111_320 * Math.cos((refLat * Math.PI) / 180),
    y: (lat - refLat) * 111_320,
  };
}

function unproject(point: Point, refLat: number, refLng: number): { lat: number; lng: number } {
  return {
    lng: refLng + point.x / (111_320 * Math.cos((refLat * Math.PI) / 180)),
    lat: refLat + point.y / 111_320,
  };
}

function distancePointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(p.x - x, p.y - y);
}

function orientation(a: Point, b: Point, c: Point): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(a: Point, b: Point, c: Point): boolean {
  return (
    b.x <= Math.max(a.x, c.x) + 1e-9 &&
    b.x + 1e-9 >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) + 1e-9 &&
    b.y + 1e-9 >= Math.min(a.y, c.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function distanceSegmentToSegment(a: Point, b: Point, c: Point, d: Point): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    distancePointToSegment(a, c, d),
    distancePointToSegment(b, c, d),
    distancePointToSegment(c, a, b),
    distancePointToSegment(d, a, b),
  );
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const intersects =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y || 1e-12) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function polygonSegments(polygon: Point[]): Array<[Point, Point]> {
  const segments: Array<[Point, Point]> = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    segments.push([a, b]);
  }
  return segments;
}

function distanceToPolygonBoundary(point: Point, polygonSegs: Array<[Point, Point]>): number {
  let best = Infinity;
  for (const [a, b] of polygonSegs) {
    best = Math.min(best, distancePointToSegment(point, a, b));
  }
  return best;
}

function distanceToPolygonFromSegment(a: Point, b: Point, polygonSegs: Array<[Point, Point]>): number {
  let best = Infinity;
  for (const [c, d] of polygonSegs) {
    best = Math.min(best, distanceSegmentToSegment(a, b, c, d));
  }
  return best;
}

function geometryPaths(geometry: InfrastructureGeometry | undefined): number[][][] {
  if (!geometry) return [];
  const paths = [...(geometry.paths ?? []), ...(geometry.rings ?? [])];
  if (paths.length > 0) return paths;
  if (geometry.x != null && geometry.y != null) return [[[geometry.x, geometry.y]]];
  return [];
}

function featureText(feature: InfrastructureFeature): string {
  return Object.entries(feature.attributes ?? {})
    .map(([k, v]) => `${k}:${String(v ?? "")}`)
    .join(" ")
    .toLowerCase();
}

function hasPrivateServiceHint(features: InfrastructureFeature[]): boolean {
  return features.some((feature) =>
    /\b(private|customer|non[-\s]?public|easement|right\s*of\s*way|row)\b/i.test(featureText(feature)),
  );
}

function classifyPointDistance(serviceName: string, distanceM: number | null): InfrastructureClassification {
  if (distanceM === null || distanceM < 0) {
    return {
      location: "unknown",
      distance_metres: null,
      estimated_cost_low: 15000,
      estimated_cost_high: 40000,
      risk: "moderate",
      note: "Service location unknown - site inspection required",
    };
  }

  const d = Math.round(distanceM);
  if (distanceM < 5) {
    return {
      location: "on-parcel",
      distance_metres: d,
      estimated_cost_low: 0,
      estimated_cost_high: 5000,
      risk: "low",
      note: `${serviceName} service appears within the site (~${d}m from address point) - straightforward connection`,
    };
  }
  if (distanceM < 35) {
    return {
      location: "boundary",
      distance_metres: d,
      estimated_cost_low: 5000,
      estimated_cost_high: 20000,
      risk: "low",
      note: `${serviceName} service is close to the site frontage/boundary (~${d}m) - standard council connection`,
    };
  }
  return {
    location: "public-land",
    distance_metres: d,
    estimated_cost_low: distanceM < 80 ? 5000 : 10000,
    estimated_cost_high: distanceM < 80 ? 25000 : 40000,
    risk: distanceM < 80 ? "low" : "moderate",
    note: `${serviceName} service is off-site in the public network (~${d}m from address point) - verify tie-in route during design`,
  };
}

function classifyParcelDistance(
  serviceName: string,
  distanceToBoundaryM: number | null,
  features: InfrastructureFeature[],
  offsiteLandContext: OffsiteLandContext = "unknown",
): InfrastructureClassification {
  if (distanceToBoundaryM === null || distanceToBoundaryM < 0) {
    return classifyPointDistance(serviceName, null);
  }

  const d = Math.round(distanceToBoundaryM);
  if (distanceToBoundaryM <= 15) {
    return {
      location: "boundary",
      distance_metres: d,
      estimated_cost_low: 5000,
      estimated_cost_high: 20000,
      risk: "low",
      note: `${serviceName} service is at or near the parcel boundary/public frontage (~${d}m) - standard council connection, not a neighbour-land service`,
    };
  }

  if (offsiteLandContext === "neighbour" || hasPrivateServiceHint(features)) {
    return {
      location: "neighbour",
      distance_metres: d,
      estimated_cost_low: 20000,
      estimated_cost_high: 60000,
      risk: "moderate",
      note: `${serviceName} service appears off-site on private land (~${d}m from parcel boundary) - easement or owner approval may be required`,
    };
  }

  if (offsiteLandContext === "unknown") {
    return {
      location: "unknown",
      distance_metres: d,
      estimated_cost_low: 15000,
      estimated_cost_high: 40000,
      risk: "moderate",
      note: `${serviceName} service is off-site (~${d}m from parcel boundary), but public-road vs neighbouring-lot context could not be confirmed automatically - verify in Auckland GeoMaps during civil design`,
    };
  }

  return {
    location: "public-land",
    distance_metres: d,
    estimated_cost_low: distanceToBoundaryM < 50 ? 5000 : 10000,
    estimated_cost_high: distanceToBoundaryM < 50 ? 25000 : 40000,
    risk: distanceToBoundaryM < 50 ? "low" : "moderate",
    note: `${serviceName} service is off-site in the public network (~${d}m from parcel boundary) - verify tie-in route during civil design`,
  };
}

function chooseBetterClassification(
  current: InfrastructureClassification | null,
  next: InfrastructureClassification,
): InfrastructureClassification {
  if (!current) return next;
  const currentRank = LOCATION_RANK[current.location];
  const nextRank = LOCATION_RANK[next.location];
  if (nextRank !== currentRank) return nextRank < currentRank ? next : current;

  const currentDistance = current.distance_metres ?? Infinity;
  const nextDistance = next.distance_metres ?? Infinity;
  return nextDistance < currentDistance ? next : current;
}

function classifyNoMappedService(serviceName: string): InfrastructureClassification {
  const critical = serviceName === "Wastewater" || serviceName === "Water Supply";
  return {
    location: "unknown",
    distance_metres: null,
    estimated_cost_low: critical ? 30000 : 15000,
    estimated_cost_high: critical ? 120000 : 60000,
    risk: critical ? "high" : "moderate",
    note: `No mapped public ${serviceName.toLowerCase()} service found within 200m of the parcel - confirm private/on-site servicing or extension costs during civil design`,
  };
}

export function classifyInfrastructureFeatures(
  serviceName: string,
  lat: number,
  lng: number,
  features: InfrastructureFeature[],
  parcelBbox?: ParcelBbox | null,
  offsiteLandContext: OffsiteLandContext = "unknown",
): InfrastructureClassification | null {
  if (features.length === 0) return null;

  const polygon = parcelBbox?.polygon;
  if (polygon && polygon.length >= 3) {
    const refLat = (parcelBbox!.minLat + parcelBbox!.maxLat) / 2;
    const refLng = (parcelBbox!.minLng + parcelBbox!.maxLng) / 2;
    const parcelPoly = polygon.map(([plng, plat]) => project(plng, plat, refLat, refLng));
    const parcelSegs = polygonSegments(parcelPoly);

    let minDistanceToBoundary = Infinity;
    let hasDeepInside = false;
    let touchesParcel = false;

    for (const feature of features) {
      for (const path of geometryPaths(feature.geometry)) {
        const projected = path.map(([x, y]) => project(x, y, refLat, refLng));

        if (projected.length === 1) {
          const p = projected[0]!;
          const inside = pointInPolygon(p, parcelPoly);
          const boundaryDistance = distanceToPolygonBoundary(p, parcelSegs);
          minDistanceToBoundary = Math.min(minDistanceToBoundary, boundaryDistance);
          if (inside) {
            touchesParcel = true;
            if (boundaryDistance > 2) hasDeepInside = true;
          }
          continue;
        }

        for (let i = 1; i < projected.length; i++) {
          const a = projected[i - 1]!;
          const b = projected[i]!;
          const boundaryDistance = distanceToPolygonFromSegment(a, b, parcelSegs);
          minDistanceToBoundary = Math.min(minDistanceToBoundary, boundaryDistance);
          if (boundaryDistance <= 0.5) touchesParcel = true;

          for (const t of [0, 0.25, 0.5, 0.75, 1]) {
            const sample = {
              x: a.x + (b.x - a.x) * t,
              y: a.y + (b.y - a.y) * t,
            };
            if (pointInPolygon(sample, parcelPoly)) {
              touchesParcel = true;
              if (distanceToPolygonBoundary(sample, parcelSegs) > 2) hasDeepInside = true;
            }
          }
        }
      }
    }

    if (hasDeepInside) {
      return {
        location: "on-parcel",
        distance_metres: 0,
        estimated_cost_low: 0,
        estimated_cost_high: 5000,
        risk: "low",
        note: `${serviceName} service crosses or sits within the parcel - straightforward on-site connection subject to asset-protection checks`,
      };
    }

    if (touchesParcel && minDistanceToBoundary <= 2) {
      return classifyParcelDistance(serviceName, 0, features, offsiteLandContext);
    }

    return classifyParcelDistance(
      serviceName,
      isFinite(minDistanceToBoundary) ? minDistanceToBoundary : null,
      features,
      offsiteLandContext,
    );
  }

  const refLat = lat;
  const refLng = lng;
  const addressPoint = project(lng, lat, refLat, refLng);
  let minDistanceToPoint = Infinity;
  for (const feature of features) {
    for (const path of geometryPaths(feature.geometry)) {
      const projected = path.map(([x, y]) => project(x, y, refLat, refLng));
      if (projected.length === 1) {
        minDistanceToPoint = Math.min(minDistanceToPoint, Math.hypot(projected[0]!.x, projected[0]!.y));
        continue;
      }
      for (let i = 1; i < projected.length; i++) {
        minDistanceToPoint = Math.min(
          minDistanceToPoint,
          distancePointToSegment(addressPoint, projected[i - 1]!, projected[i]!),
        );
      }
    }
  }

  return classifyPointDistance(serviceName, isFinite(minDistanceToPoint) ? minDistanceToPoint : null);
}

function collectOffsiteProbePoints(
  features: InfrastructureFeature[],
  parcelBbox: ParcelBbox,
): Array<{ lat: number; lng: number; distanceM: number }> {
  const polygon = parcelBbox.polygon;
  if (!polygon || polygon.length < 3) return [];

  const refLat = (parcelBbox.minLat + parcelBbox.maxLat) / 2;
  const refLng = (parcelBbox.minLng + parcelBbox.maxLng) / 2;
  const parcelPoly = polygon.map(([plng, plat]) => project(plng, plat, refLat, refLng));
  const parcelSegs = polygonSegments(parcelPoly);
  const probes: Array<{ lat: number; lng: number; distanceM: number }> = [];

  const addProbe = (sample: Point) => {
    if (pointInPolygon(sample, parcelPoly)) return;
    const distanceM = distanceToPolygonBoundary(sample, parcelSegs);
    if (!Number.isFinite(distanceM)) return;
    const geo = unproject(sample, refLat, refLng);
    probes.push({ ...geo, distanceM });
  };

  for (const feature of features) {
    for (const path of geometryPaths(feature.geometry)) {
      const projected = path.map(([x, y]) => project(x, y, refLat, refLng));
      if (projected.length === 1) {
        addProbe(projected[0]!);
        continue;
      }
      for (let i = 1; i < projected.length; i++) {
        const a = projected[i - 1]!;
        const b = projected[i]!;
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          addProbe({
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
          });
        }
      }
    }
  }

  const distinct: Array<{ lat: number; lng: number; distanceM: number }> = [];
  for (const probe of probes.sort((a, b) => a.distanceM - b.distanceM)) {
    if (distinct.some((p) => Math.hypot(p.lat - probe.lat, p.lng - probe.lng) < 0.00002)) continue;
    distinct.push(probe);
    if (distinct.length >= 5) break;
  }
  return distinct;
}

function isLikelyPublicRoadParcel(parcel: LinzParcel): boolean {
  const text = [
    parcel.appellation,
    parcel.legal_description,
    parcel.topology_type,
    parcel.title_no,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(road|street|motorway|highway|esplanade|railway|drainage reserve|local purpose reserve|recreation reserve)\b/i.test(text);
}

async function resolveOffsiteLandContext(
  features: InfrastructureFeature[],
  parcelBbox: ParcelBbox | null | undefined,
  targetParcelId?: string | null,
): Promise<OffsiteLandContext> {
  if (!process.env["LINZ_API_KEY"]) return "unknown";
  if (!parcelBbox?.polygon) return "unknown";
  const probes = collectOffsiteProbePoints(features, parcelBbox);
  if (probes.length === 0) return "unknown";

  let sawPublicLand = false;
  for (const probe of probes.slice(0, 4)) {
    const parcel = await fetchLINZParcel(probe.lat, probe.lng).catch(() => null);
    if (!parcel) {
      sawPublicLand = true;
      continue;
    }
    if (targetParcelId && parcel.parcel_id === targetParcelId) continue;
    if (isLikelyPublicRoadParcel(parcel)) {
      sawPublicLand = true;
      continue;
    }
    logger.info(
      { targetParcelId, serviceParcelId: parcel.parcel_id, appellation: parcel.appellation, distanceM: Math.round(probe.distanceM) },
      "Infrastructure off-site service resolved inside neighbouring parcel",
    );
    return "neighbour";
  }

  return sawPublicLand ? "public-land" : "unknown";
}

async function queryLayerFeatures(
  lat: number,
  lng: number,
  layerId: number,
  parcelBbox?: ParcelBbox | null,
  searchDistanceM = 200,
): Promise<InfrastructureFeature[]> {
  const url = new URL(`${UNDERGROUND_SVC}/${layerId}/query`);

  if (parcelBbox) {
    const lngPad = degLng(searchDistanceM, lat);
    const latPad = degLat(searchDistanceM);
    url.searchParams.set(
      "geometry",
      `${parcelBbox.minLng - lngPad},${parcelBbox.minLat - latPad},${parcelBbox.maxLng + lngPad},${parcelBbox.maxLat + latPad}`,
    );
    url.searchParams.set("geometryType", "esriGeometryEnvelope");
  } else {
    url.searchParams.set("geometry", `${lng},${lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("distance", String(searchDistanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }

  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("returnDistinctValues", "false");
  url.searchParams.set("f", "json");

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    features?: InfrastructureFeature[];
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);
  return data.features ?? [];
}

export async function fetchInfrastructure(
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
  targetParcelId?: string | null,
): Promise<InfrastructureItem[]> {
  const results: InfrastructureItem[] = [];

  await Promise.allSettled(
    INFRA_LAYERS.map(async (infraType) => {
      let best: InfrastructureClassification | null = null;

      for (const { id, label } of infraType.layers) {
        try {
          const features = await queryLayerFeatures(lat, lng, id, parcelBbox);
          if (features.length === 0) continue;

          let classification = classifyInfrastructureFeatures(infraType.name, lat, lng, features, parcelBbox);
          if (
            parcelBbox &&
            classification?.location === "unknown" &&
            classification.distance_metres != null &&
            classification.distance_metres > 15
          ) {
            const offsiteContext = await resolveOffsiteLandContext(features, parcelBbox, targetParcelId);
            classification = classifyInfrastructureFeatures(
              infraType.name,
              lat,
              lng,
              features,
              parcelBbox,
              offsiteContext,
            );
          }
          if (classification) {
            best = chooseBetterClassification(best, classification);
            logger.debug(
              { infraType: infraType.name, layerId: id, label, featureCount: features.length, classification },
              "Infrastructure layer hit",
            );
          }
        } catch (err) {
          logger.debug({ err, layerId: id, label, infraType: infraType.name }, "Infrastructure layer query failed - trying next");
        }
      }

      if (!best) {
        const missing = classifyNoMappedService(infraType.name);
        logger.warn({ infraType: infraType.name, classification: missing }, "No mapped infrastructure feature found in any layer");
        results.push({
          name: infraType.name,
          location: missing.location,
          distance_metres: missing.distance_metres,
          estimated_cost_low: missing.estimated_cost_low,
          estimated_cost_high: missing.estimated_cost_high,
          risk: missing.risk,
          note: missing.note,
        });
        return;
      }

      results.push({
        name: infraType.name,
        location: best.location,
        distance_metres: best.distance_metres,
        estimated_cost_low: best.estimated_cost_low,
        estimated_cost_high: best.estimated_cost_high,
        risk: best.risk,
        note: best.note,
      });
    }),
  );

  return results;
}
