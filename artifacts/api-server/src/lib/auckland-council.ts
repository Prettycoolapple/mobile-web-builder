import { logger } from "./logger";

const GIS_BASE = "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services";
const ZONE_SERVICE = `${GIS_BASE}/NonCouncil/UnitaryPlanZones/MapServer`;
const OVERLAY_SERVICE = `${GIS_BASE}/NonCouncil/UnitaryPlanManagementLayers/MapServer`;

export interface ZoneResult {
  zone_code: string;
  zone_description: string;
  min_lot_size_sqm: number | null;
  raw_zone: string | null;
}

export interface Overlay {
  name: string;
  status: "clear" | "moderate" | "restricted" | "unknown";
  detail: string;
}

export interface ContourResult {
  slope_degrees: number | null;
  classification: "flat" | "gentle" | "moderate" | "steep" | null;
  retaining_cost_low: number;
  retaining_cost_high: number;
  source: string;
  elevation_center?: number | null;
}

const ZONE_DOMAIN: Record<number, { code: string; description: string; minLot: number | null }> = {
  8:  { code: "THAB", description: "Terrace Housing and Apartment Buildings", minLot: 0 },
  18: { code: "MHS",  description: "Mixed Housing Suburban", minLot: 400 },
  60: { code: "MHU",  description: "Mixed Housing Urban", minLot: 300 },
  19: { code: "SHZ",  description: "Single House Zone", minLot: 600 },
  23: { code: "LLRZ", description: "Large Lot Residential Zone", minLot: 4000 },
  20: { code: "RCSZ", description: "Rural and Coastal Settlement Zone", minLot: 2000 },
  72: { code: "LDRZ", description: "Low Density Residential Zone", minLot: 600 },
  70: { code: "2SDA", description: "Two-Storey Single Dwelling Area", minLot: 600 },
  71: { code: "2SMDA", description: "Two-Storey Medium Density Area", minLot: 400 },
  4:  { code: "FUZ",  description: "Future Urban Zone", minLot: null },
  1:  { code: "BPZ",  description: "Business - Business Park Zone", minLot: 0 },
  35: { code: "CCZ",  description: "Business - City Centre Zone", minLot: 0 },
  49: { code: "GBZ",  description: "Business - General Business Zone", minLot: 0 },
  5:  { code: "HIZ",  description: "Business - Heavy Industry Zone", minLot: 0 },
  17: { code: "BPIZ", description: "Business - Light Industry Zone", minLot: 0 },
  7:  { code: "LCZ",  description: "Business - Local Centre Zone", minLot: 0 },
  10: { code: "MCZ",  description: "Business - Metropolitan Centre Zone", minLot: 0 },
  12: { code: "MUZ",  description: "Business - Mixed Use Zone", minLot: 0 },
  44: { code: "NCZ",  description: "Business - Neighbourhood Centre Zone", minLot: 0 },
  22: { code: "TCZ",  description: "Business - Town Centre Zone", minLot: 0 },
};

async function arcgisQuery(
  serviceUrl: string,
  layerId: number,
  lat: number,
  lng: number,
  outFields = "*",
  distanceM?: number,
  timeoutMs = 10000,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${serviceUrl}/${layerId}/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  if (distanceM != null) {
    url.searchParams.set("distance", String(distanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`ArcGIS HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    features?: Array<{ attributes: Record<string, unknown> }>;
    error?: { message: string };
  };

  if (data.error) throw new Error(`ArcGIS error: ${data.error.message}`);
  return (data.features ?? []).map((f) => f.attributes);
}

export async function fetchUnitaryPlanZone(lat: number, lng: number): Promise<ZoneResult> {
  try {
    const features = await arcgisQuery(ZONE_SERVICE, 1, lat, lng);
    if (features.length > 0) {
      const attrs = features[0];
      const rawZoneCode = attrs["ZONE"] as number | null;

      if (rawZoneCode != null && ZONE_DOMAIN[rawZoneCode]) {
        const { code, description, minLot } = ZONE_DOMAIN[rawZoneCode];
        logger.debug({ rawZoneCode, code, description }, "Zone resolved from Auckland Council GIS");
        return {
          zone_code: code,
          zone_description: description,
          min_lot_size_sqm: minLot,
          raw_zone: String(rawZoneCode),
        };
      }

      return {
        zone_code: `Z${rawZoneCode ?? "?"}`,
        zone_description: `Zone code ${rawZoneCode} — refer to Auckland Unitary Plan`,
        min_lot_size_sqm: null,
        raw_zone: rawZoneCode != null ? String(rawZoneCode) : null,
      };
    }
  } catch (err) {
    logger.warn({ err }, "Zone query failed");
  }

  return { zone_code: "UNKNOWN", zone_description: "Unknown — data unavailable", min_lot_size_sqm: null, raw_zone: null };
}

export async function fetchOverlays(lat: number, lng: number): Promise<Overlay[]> {
  const OVERLAY_LAYERS: Array<{
    name: string;
    layerId: number;
    distanceM?: number;
    mapStatus: (attrs: Record<string, unknown>) => "clear" | "moderate" | "restricted";
    mapDetail: (attrs: Record<string, unknown>) => string;
  }> = [
    {
      name: "Heritage",
      layerId: 33,
      mapStatus: () => "restricted",
      mapDetail: (attrs) => {
        const name = String(attrs["NAME"] ?? attrs["HERITAGE_NAME"] ?? "Heritage place");
        return `Historic Heritage Overlay applies — ${name}. Demolition or alteration requires Resource Consent. Contact heritage team.`;
      },
    },
    {
      name: "Notable Trees",
      layerId: 19,
      distanceM: 30,
      mapStatus: () => "moderate",
      mapDetail: (attrs) => {
        const species = String(attrs["NAME"] ?? attrs["COMMON_NAME"] ?? attrs["SPECIES"] ?? "tree");
        const schedule = String(attrs["SCHEDULE"] ?? "");
        return `Notable tree on or near site: ${species}${schedule ? ` (Schedule ${schedule})` : ""}. Tree removal requires Resource Consent from Auckland Council.`;
      },
    },
    {
      name: "Volcanic Viewshaft",
      layerId: 25,
      mapStatus: () => "restricted",
      mapDetail: () =>
        "Regionally Significant Volcanic Viewshaft — height restrictions apply. Maximum building height may be below zone standard. Requires urban designer input.",
    },
    {
      name: "Locally Significant Viewshaft",
      layerId: 27,
      mapStatus: () => "moderate",
      mapDetail: () =>
        "Locally Significant Volcanic Viewshaft — additional height assessment required at Resource Consent stage.",
    },
    {
      name: "Coastal Inundation",
      layerId: 58,
      mapStatus: () => "restricted",
      mapDetail: () =>
        "Coastal Inundation Area (1% AEP + 1m sea level rise) — floor level controls apply. Check NES-F compliance requirements.",
    },
    {
      name: "Waitakere Ranges Heritage",
      layerId: 24,
      mapStatus: () => "restricted",
      mapDetail: () =>
        "Waitakere Ranges Heritage Area — strict development controls. Most earthworks and vegetation clearance require consent.",
    },
    {
      name: "Ridgeline Protection",
      layerId: 29,
      mapStatus: () => "moderate",
      mapDetail: () =>
        "Ridgeline Protection Overlay — skyline development controls apply. Building bulk and location may be restricted.",
    },
  ];

  const overlays: Overlay[] = [];

  await Promise.allSettled(
    OVERLAY_LAYERS.map(async (overlay) => {
      try {
        const features = await arcgisQuery(
          OVERLAY_SERVICE,
          overlay.layerId,
          lat,
          lng,
          "*",
          overlay.distanceM,
          8000,
        );
        if (features.length > 0) {
          overlays.push({
            name: overlay.name,
            status: overlay.mapStatus(features[0]),
            detail: overlay.mapDetail(features[0]),
          });
          logger.debug({ overlay: overlay.name }, "Overlay found");
        }
      } catch (err) {
        logger.debug({ err, overlay: overlay.name }, "Overlay query failed");
      }
    }),
  );

  return overlays;
}

function buildElevationGrid(lat: number, lng: number, offset = 0.00025) {
  return [
    { lat: lat - offset, lng: lng - offset },
    { lat: lat - offset, lng: lng           },
    { lat: lat - offset, lng: lng + offset  },
    { lat: lat,          lng: lng - offset  },
    { lat: lat,          lng: lng           },
    { lat: lat,          lng: lng + offset  },
    { lat: lat + offset, lng: lng - offset  },
    { lat: lat + offset, lng: lng           },
    { lat: lat + offset, lng: lng + offset  },
  ];
}

function slopeFromGrid9(elevations: number[], offsetDeg: number): { slopeDeg: number; centerElevation: number } {
  const centerElevation = elevations[4];
  const adjacentDistM = offsetDeg * 111320;
  const cornerDistM   = adjacentDistM * Math.SQRT2;

  const cornerElevations   = [elevations[0], elevations[2], elevations[6], elevations[8]];
  const maxCornerDiff      = Math.max(...cornerElevations.map((e) => Math.abs(e - centerElevation)));
  const slopeDegCorner     = Math.atan(maxCornerDiff / cornerDistM) * (180 / Math.PI);

  const adjacentElevations = [elevations[1], elevations[3], elevations[5], elevations[7]];
  const maxAdjacentDiff    = Math.max(...adjacentElevations.map((e) => Math.abs(e - centerElevation)));
  const slopeDegAdjacent   = Math.atan(maxAdjacentDiff / adjacentDistM) * (180 / Math.PI);

  return { slopeDeg: Math.max(slopeDegCorner, slopeDegAdjacent), centerElevation };
}

async function fetchElevationViaOpenTopoData(lat: number, lng: number): Promise<ContourResult | null> {
  // Build a 5×5 grid at ~10m spacing to measure slope within the parcel itself.
  // nzdem8m is NZ's purpose-built 8m DEM — far more accurate for Auckland than global SRTM 30m.
  // At 0.00009° ≈ 10m steps, the 5×5 grid covers ~40m × 40m — typical suburban parcel size.
  const FINE_OFFSET = 0.00009;

  const finePoints: { lat: number; lng: number }[] = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      finePoints.push({ lat: lat + i * FINE_OFFSET, lng: lng + j * FINE_OFFSET });
    }
  }
  const fineLocStr = finePoints.map((p) => `${p.lat},${p.lng}`).join("|");

  // Also add a broader 3×3 grid at 200m spacing to capture neighbourhood-scale slopes
  // (catches situations where the parcel sits on a valley/ridge edge)
  const BROAD_OFFSET = 0.0018; // ~200m
  const broadPoints = buildElevationGrid(lat, lng, BROAD_OFFSET);
  const broadLocStr = broadPoints.map((p) => `${p.lat},${p.lng}`).join("|");

  // Try nzdem8m (NZ-specific 8m DEM) first with the fine parcel-scale grid
  try {
    const url = `https://api.opentopodata.org/v1/nzdem8m?locations=${fineLocStr}`;
    logger.info({ lat, lng, points: finePoints.length, offsetM: Math.round(FINE_OFFSET * 111320) }, "OpenTopoData: querying nzdem8m (NZ 8m DEM) with parcel-scale grid");
    const resp = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!resp.ok) throw new Error(`OpenTopoData nzdem8m HTTP ${resp.status}`);

    const data = (await resp.json()) as { status: string; results?: Array<{ elevation: number }> };
    if (data.status !== "OK" || !data.results || data.results.length < 25) throw new Error("nzdem8m: insufficient results");

    const elevs = data.results.map((r) => r.elevation).filter((e) => e != null && !isNaN(e));
    const centerElevation = elevs[12]; // centre of 5×5 grid
    const stepM = FINE_OFFSET * 111320; // metres per grid step

    // Find maximum gradient between any adjacent pair of points (EW and NS directions).
    // This is more accurate than range/diagonal, which averages out local peaks.
    let maxGrad = 0;
    const COLS = 5;
    for (let r = 0; r < COLS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        if (c + 1 < COLS) maxGrad = Math.max(maxGrad, Math.abs(elevs[idx] - elevs[idx + 1]) / stepM);
        if (r + 1 < COLS) maxGrad = Math.max(maxGrad, Math.abs(elevs[idx] - elevs[idx + COLS]) / stepM);
      }
    }
    const slopeDeg = Math.atan(maxGrad) * (180 / Math.PI);
    const elevRange = Math.max(...elevs) - Math.min(...elevs);

    logger.info({ lat, lng, centerElevation, elevRange, slopeDeg, maxGradPct: (maxGrad*100).toFixed(1), points: elevs.length }, "OpenTopoData nzdem8m: parcel-scale slope measurement");
    return classifySlope(slopeDeg, "Auckland Council / LINZ NZ 8m DEM", centerElevation);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "OpenTopoData nzdem8m failed — falling back to SRTM30m broad grid");
  }

  // Fallback: SRTM 30m with broader grid (works globally, lower resolution)
  const url = `https://api.opentopodata.org/v1/srtm30m?locations=${broadLocStr}`;
  logger.info({ lat, lng, offsetM: Math.round(BROAD_OFFSET * 111320) }, "OpenTopoData: querying SRTM30m broad grid fallback");
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`OpenTopoData SRTM30m HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    status: string;
    results?: Array<{ elevation: number; location: { lat: number; lng: number } }>;
  };

  if (data.status !== "OK" || !data.results || data.results.length < 9) {
    throw new Error(`OpenTopoData: status=${data.status} results=${data.results?.length ?? 0}`);
  }

  const elevations = data.results.map((r) => r.elevation);
  const { slopeDeg, centerElevation } = slopeFromGrid9(elevations, BROAD_OFFSET);

  logger.info({ lat, lng, centerElevation, elevations, slopeDeg }, "OpenTopoData SRTM30m broad fallback: raw values");
  return classifySlope(slopeDeg, "Open-Topo-Data (SRTM 30m, broad grid)", centerElevation);
}

async function fetchElevationViaOpenElevation(lat: number, lng: number): Promise<ContourResult | null> {
  // Use 0.001° (~111m) offset for same reason — ensures distinct SRTM pixels
  const d = 0.001;
  const locations = [
    { latitude: lat - d, longitude: lng - d },
    { latitude: lat,     longitude: lng     },
    { latitude: lat + d, longitude: lng + d },
  ];

  const resp = await fetch("https://api.open-elevation.com/api/v1/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locations }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Open-Elevation HTTP ${resp.status}`);

  const data = (await resp.json()) as { results?: Array<{ elevation: number }> };
  if (!data.results || data.results.length < 3) throw new Error("Open-Elevation: insufficient results");

  const elevs = data.results.map((r) => r.elevation);
  const diff = Math.abs(elevs[2] - elevs[0]);
  const diagonalDistM = d * 111320 * Math.SQRT2;
  const slopeDeg = Math.atan(diff / diagonalDistM) * (180 / Math.PI);
  const centerElevation = elevs[1];

  logger.info({ lat, lng, centerElevation, elevs, slopeDeg }, "Open-Elevation API: raw values");
  return classifySlope(slopeDeg, "Open-Elevation API", centerElevation);
}

async function fetchElevationViaGoogle(lat: number, lng: number): Promise<ContourResult | null> {
  const apiKey = process.env["GOOGLE_MAPS_API_KEY"];
  if (!apiKey) {
    logger.warn("Google Elevation: GOOGLE_MAPS_API_KEY not set — skipping");
    return null;
  }

  // Keep fine 0.00025° (25m) offset for Google — it has true high-res data for NZ
  const OFFSET = 0.00025;
  const points = buildElevationGrid(lat, lng, OFFSET);
  const locationStr = points.map((p) => `${p.lat},${p.lng}`).join("|");
  const url = `https://maps.googleapis.com/maps/api/elevation/json?locations=${locationStr}&key=${apiKey}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`Google Elevation HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    status: string;
    results?: Array<{ elevation: number; location: { lat: number; lng: number } }>;
  };

  if (data.status !== "OK" || !data.results || data.results.length < 9) {
    logger.warn({ status: data.status, resultsCount: data.results?.length ?? 0, errorMessage: (data as any).error_message }, "Google Elevation API returned unexpected result");
    return null;
  }

  const elevations = data.results.map((r) => r.elevation);
  const { slopeDeg, centerElevation } = slopeFromGrid9(elevations, OFFSET);

  logger.info({ lat, lng, centerElevation, elevations, slopeDeg }, "Google Elevation: raw values");
  return classifySlope(slopeDeg, "Google Elevation API", centerElevation);
}

async function fetchElevationViaLINZ(lat: number, lng: number): Promise<ContourResult | null> {
  const linzKey = process.env["LINZ_API_KEY"];
  if (!linzKey) return null;

  const LINZ_ELEVATION_URL = "https://data.linz.govt.nz/services/api/v1/layers/104687/features/";
  const OFFSET = 0.0001;
  const points = [
    { lat, lng },
    { lat: lat + OFFSET, lng },
    { lat: lat - OFFSET, lng },
    { lat, lng: lng + OFFSET },
    { lat, lng: lng - OFFSET },
  ];

  const elevations: number[] = [];
  for (const pt of points) {
    const url = new URL(LINZ_ELEVATION_URL);
    url.searchParams.set("q", `geometry INTERSECTS POINT(${pt.lng} ${pt.lat})`);
    url.searchParams.set("count", "1");

    const resp = await fetch(url.toString(), {
      headers: { Authorization: `key ${linzKey}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) continue;

    const data = (await resp.json()) as {
      features?: Array<{ properties: Record<string, unknown> }>;
    };
    const elev = Number(data.features?.[0]?.properties?.["elevation"] ?? NaN);
    if (!isNaN(elev)) elevations.push(elev);
  }

  if (elevations.length >= 2) {
    const elevDiff = Math.max(...elevations) - Math.min(...elevations);
    const distanceM = OFFSET * 111320;
    const slopeDeg = Math.atan(elevDiff / distanceM) * (180 / Math.PI);
    logger.info({ lat, lng, elevations, slopeDeg }, "LINZ elevation: raw values");
    return classifySlope(slopeDeg, "LINZ DEM");
  }

  return null;
}

export async function fetchContour(lat: number, lng: number): Promise<ContourResult> {
  // 1. Google Elevation (most accurate) — only if key present
  if (process.env["GOOGLE_MAPS_API_KEY"]) {
    try {
      const result = await fetchElevationViaGoogle(lat, lng);
      if (result) return result;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Google elevation query failed — trying OpenTopoData");
    }
  }

  // 2. Open-Topo-Data SRTM 30m — free, no key, covers all NZ
  try {
    const result = await fetchElevationViaOpenTopoData(lat, lng);
    if (result) return result;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "OpenTopoData query failed — trying Open-Elevation");
  }

  // 3. Open-Elevation API — free backup
  try {
    const result = await fetchElevationViaOpenElevation(lat, lng);
    if (result) return result;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Open-Elevation query failed — trying LINZ DEM");
  }

  // 4. LINZ DEM — requires LINZ_API_KEY
  try {
    const result = await fetchElevationViaLINZ(lat, lng);
    if (result) return result;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "LINZ elevation query failed");
  }

  logger.warn({ lat, lng }, "All elevation sources failed — returning unknown contour");
  return {
    slope_degrees: null,
    classification: null,
    retaining_cost_low: 0,
    retaining_cost_high: 0,
    source: "unavailable",
  };
}

function classifySlope(slopeDeg: number, source: string, elevationCenter?: number): ContourResult {
  const rounded = Math.round(slopeDeg * 10) / 10;
  // Thresholds calibrated for NZ residential development feasibility:
  // <3°  = effectively flat, no meaningful retaining needed
  // 3-10° = gentle slope, minor level changes / retaining required
  // 10-20° = moderate, significant retaining and earthworks budget needed
  // >20°  = steep, major geotechnical and retaining cost implications
  if (slopeDeg < 3)  return { slope_degrees: rounded, classification: "flat",     retaining_cost_low: 0,      retaining_cost_high: 5000,   source, elevation_center: elevationCenter ?? null };
  if (slopeDeg < 10) return { slope_degrees: rounded, classification: "gentle",   retaining_cost_low: 15000,  retaining_cost_high: 60000,  source, elevation_center: elevationCenter ?? null };
  if (slopeDeg < 20) return { slope_degrees: rounded, classification: "moderate", retaining_cost_low: 60000,  retaining_cost_high: 200000, source, elevation_center: elevationCenter ?? null };
  return { slope_degrees: rounded, classification: "steep",    retaining_cost_low: 200000, retaining_cost_high: 500000, source, elevation_center: elevationCenter ?? null };
}
