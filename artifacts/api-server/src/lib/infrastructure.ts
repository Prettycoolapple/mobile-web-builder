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

const GIS_BASE = "https://gis.aucklandcouncil.govt.nz/arcgis/rest/services";

const INFRA_LAYERS = [
  {
    name: "Stormwater",
    services: [
      { url: `${GIS_BASE}/Infrastructure/Stormwater/MapServer`, layer: 0 },
      { url: `${GIS_BASE}/Infrastructure/Wastewater_Stormwater/MapServer`, layer: 1 },
    ],
  },
  {
    name: "Wastewater",
    services: [
      { url: `${GIS_BASE}/Infrastructure/Wastewater/MapServer`, layer: 0 },
      { url: `${GIS_BASE}/Infrastructure/Wastewater_Stormwater/MapServer`, layer: 0 },
    ],
  },
  {
    name: "Water Supply",
    services: [
      { url: `${GIS_BASE}/Infrastructure/Water_Supply/MapServer`, layer: 0 },
      { url: `${GIS_BASE}/Infrastructure/Water/MapServer`, layer: 0 },
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

async function queryNearestFeature(
  lat: number,
  lng: number,
  serviceUrl: string,
  layerId: number,
  searchDistanceM = 200,
): Promise<{ distance: number | null; found: boolean }> {
  const url = new URL(`${serviceUrl}/${layerId}/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("distance", String(searchDistanceM));
  url.searchParams.set("units", "esriSRUnit_Meter");
  url.searchParams.set("outFields", "OBJECTID,Shape_Length");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("returnDistinctValues", "false");
  url.searchParams.set("f", "json");

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    features?: Array<{
      attributes: Record<string, unknown>;
      geometry?: {
        paths?: number[][][];
        x?: number;
        y?: number;
      };
    }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(data.error.message);
  if (!data.features || data.features.length === 0) return { distance: null, found: false };

  const feature = data.features[0];
  let closestDist = searchDistanceM;

  if (feature.geometry?.paths && feature.geometry.paths.length > 0) {
    const latRad = (lat * Math.PI) / 180;
    const lngRad = (lng * Math.PI) / 180;

    for (const path of feature.geometry.paths) {
      for (const [x, y] of path) {
        const yRad = (y * Math.PI) / 180;
        const xRad = (x * Math.PI) / 180;
        const dLat = yRad - latRad;
        const dLng = xRad - lngRad;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(latRad) * Math.cos(yRad) * Math.sin(dLng / 2) ** 2;
        const dist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 6371000;
        closestDist = Math.min(closestDist, dist);
      }
    }
  } else if (feature.geometry?.x != null && feature.geometry?.y != null) {
    const yRad = (feature.geometry.y * Math.PI) / 180;
    const xRad = (feature.geometry.x * Math.PI) / 180;
    const latRad2 = (lat * Math.PI) / 180;
    const lngRad2 = (lng * Math.PI) / 180;
    const dLat = yRad - latRad2;
    const dLng = xRad - lngRad2;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(latRad2) * Math.cos(yRad) * Math.sin(dLng / 2) ** 2;
    closestDist = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 6371000;
  }

  return { distance: closestDist, found: true };
}

export async function fetchInfrastructure(lat: number, lng: number): Promise<InfrastructureItem[]> {
  const results: InfrastructureItem[] = [];

  await Promise.allSettled(
    INFRA_LAYERS.map(async (infraType) => {
      let found = false;
      let distance: number | null = null;

      for (const { url, layer } of infraType.services) {
        try {
          const result = await queryNearestFeature(lat, lng, url, layer);
          if (result.found) {
            found = true;
            distance = result.distance;
            break;
          }
        } catch (err) {
          logger.debug({ err, url, infraType: infraType.name }, "Infrastructure layer query failed");
        }
      }

      if (!found) {
        logger.debug({ infraType: infraType.name }, "No infrastructure feature found in any layer");
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
