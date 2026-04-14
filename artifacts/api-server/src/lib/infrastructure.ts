import { logger } from "./logger";

export interface InfrastructureItem {
  name: string;
  location: "on-parcel" | "boundary" | "neighbour" | "public-land" | "unknown";
  distance_metres: number | null;
  estimated_cost_low: number;
  estimated_cost_high: number;
  risk: "low" | "moderate" | "high";
  note: string;
}

// ─── Auckland Council public GIS (accessible from cloud) ─────────────────────
// NOTE: gis.aucklandcouncil.govt.nz is blocked from non-NZ / cloud IPs.
//       mapspublic.aucklandcouncil.govt.nz is the publicly accessible endpoint.
//       LiveMaps/UndergroundServices is a single MapServer that contains all
//       wastewater, stormwater, and water pipe layers, so we can query it once
//       per infrastructure type instead of trying multiple service URLs.
const MAPS_BASE = "https://mapspublic.aucklandcouncil.govt.nz/arcgis/rest/services";
const UNDERGROUND_SVC = `${MAPS_BASE}/LiveMaps/UndergroundServices/MapServer`;

const INFRA_LAYERS: Array<{
  name: string;
  layers: Array<{ id: number; label: string }>;
}> = [
  {
    name: "Wastewater",
    layers: [
      { id: 5,  label: "Wastewater Pipe (Local)" },
      { id: 12, label: "Wastewater Pipe (Transmission)" },
    ],
  },
  {
    name: "Stormwater",
    layers: [
      { id: 109, label: "Stormwater Pipe" },
      { id: 32,  label: "Stormwater Watercourse" },
      { id: 36,  label: "Stormwater Channel" },
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

function classifyDistance(distanceM: number | null): {
  location: InfrastructureItem["location"];
  cost_low: number;
  cost_high: number;
  risk: "low" | "moderate" | "high";
  note: string;
} {
  if (distanceM === null || distanceM < 0) {
    return {
      location: "unknown",
      cost_low: 15000,
      cost_high: 40000,
      risk: "moderate",
      note: "Service location unknown — site inspection required",
    };
  }
  if (distanceM < 5) {
    return {
      location: "on-parcel",
      cost_low: 0,
      cost_high: 5000,
      risk: "low",
      note: `Service within parcel (~${Math.round(distanceM)}m) — straightforward connection`,
    };
  }
  if (distanceM < 15) {
    return {
      location: "boundary",
      cost_low: 5000,
      cost_high: 20000,
      risk: "low",
      note: `Service near boundary (~${Math.round(distanceM)}m) — standard connection consented`,
    };
  }
  if (distanceM < 40) {
    return {
      location: "neighbour",
      cost_low: 20000,
      cost_high: 60000,
      risk: "moderate",
      note: `Service on neighbouring private land (~${Math.round(distanceM)}m) — easement or negotiation required`,
    };
  }
  return {
    location: "public-land",
    cost_low: 10000,
    cost_high: 40000,
    risk: "low",
    note: `Service on public road/land (~${Math.round(distanceM)}m) — standard council connection consented`,
  };
}

// Haversine distance in metres between two WGS84 points.
// Both arguments must be in decimal degrees. The AC GIS service returns
// geometry in EPSG:4326 when outSR=4326 is set, so this is always safe.
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * R;
}

async function queryNearestFeature(
  lat: number,
  lng: number,
  layerId: number,
  searchDistanceM = 200,
): Promise<{ distance: number | null; found: boolean }> {
  const url = new URL(`${UNDERGROUND_SVC}/${layerId}/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326"); // force WGS84 output so Haversine is correct
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("distance", String(searchDistanceM));
  url.searchParams.set("units", "esriSRUnit_Meter");
  url.searchParams.set("outFields", "OBJECTID");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("returnDistinctValues", "false");
  url.searchParams.set("f", "json");

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    features?: Array<{
      attributes: Record<string, unknown>;
      geometry?: {
        paths?: number[][][];
        rings?: number[][][];
        x?: number;
        y?: number;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);
  if (!data.features || data.features.length === 0) return { distance: null, found: false };

  // Walk all returned features and vertices to find the closest point on any pipe
  let closestDist = Infinity;

  for (const feature of data.features) {
    const geom = feature.geometry;
    if (!geom) continue;

    const coordinateSets: number[][][] = [
      ...(geom.paths ?? []),
      ...(geom.rings ?? []),
    ];

    for (const coords of coordinateSets) {
      for (const [x, y] of coords) {
        const dist = haversineM(lat, lng, y, x);
        if (dist < closestDist) closestDist = dist;
      }
    }

    // Point geometry
    if (geom.x != null && geom.y != null && coordinateSets.length === 0) {
      const dist = haversineM(lat, lng, geom.y, geom.x);
      if (dist < closestDist) closestDist = dist;
    }
  }

  return {
    distance: isFinite(closestDist) ? closestDist : null,
    found: true,
  };
}

export async function fetchInfrastructure(lat: number, lng: number): Promise<InfrastructureItem[]> {
  const results: InfrastructureItem[] = [];

  await Promise.allSettled(
    INFRA_LAYERS.map(async (infraType) => {
      let found = false;
      let distance: number | null = null;

      for (const { id, label } of infraType.layers) {
        try {
          const result = await queryNearestFeature(lat, lng, id);
          if (result.found) {
            found = true;
            distance = result.distance;
            logger.debug({ infraType: infraType.name, layerId: id, label, distance }, "Infrastructure layer hit");
            break;
          }
        } catch (err) {
          logger.debug({ err, layerId: id, label, infraType: infraType.name }, "Infrastructure layer query failed — trying next");
        }
      }

      if (!found) {
        logger.warn({ infraType: infraType.name }, "No infrastructure feature found in any layer — returning unknown");
        results.push({
          name: infraType.name,
          location: "unknown",
          distance_metres: null,
          estimated_cost_low: 15000,
          estimated_cost_high: 40000,
          risk: "moderate",
          note: "Service location data unavailable — field investigation required",
        });
        return;
      }

      const classification = classifyDistance(distance);
      results.push({
        name: infraType.name,
        location: classification.location,
        distance_metres: distance !== null ? Math.round(distance) : null,
        estimated_cost_low: classification.cost_low,
        estimated_cost_high: classification.cost_high,
        risk: classification.risk,
        note: classification.note,
      });
    }),
  );

  return results;
}
