import { logger } from "./logger";
import * as zlib from "zlib";
import type { ParcelBbox } from "./linz";

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

// ---------------------------------------------------------------------------
// Terrain tile elevation (Terrarium / AWS Elevation Tiles)
// ---------------------------------------------------------------------------
// Uses the public AWS Elevation Tiles (Terrarium RGB encoding).
// Zoom 15 gives ~3.8m pixel resolution for NZ — backed by Mapzen's 1m NZ LiDAR
// where available, falling back to SRTM 30m elsewhere.
// Formula: elevation = R×256 + G + B/256 − 32768  (metres)
// No API key required.
// ---------------------------------------------------------------------------

function terrariumTileCoords(lat: number, lng: number, zoom: number) {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  // Pixel offset within tile
  const fx = ((lng + 180) / 360) * n;
  const fy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const px = Math.floor((fx - Math.floor(fx)) * 256);
  const py = Math.floor((fy - Math.floor(fy)) * 256);
  // Resolution in metres per pixel at this latitude
  const pixelSizeM = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * n);
  return { tileX: x, tileY: y, px, py, pixelSizeM };
}

function decodeTerrariumPng(buf: Buffer): {
  getPixel: (x: number, y: number) => { r: number; g: number; b: number };
  terrarium: (px: { r: number; g: number; b: number }) => number;
  width: number;
  height: number;
} {
  const PNG_SIGNATURE = "89504e470d0a1a0a";
  if (buf.slice(0, 8).toString("hex") !== PNG_SIGNATURE) throw new Error("Not a valid PNG");

  let pos = 8, width = 0, height = 0;
  const idatChunks: Buffer[] = [];
  while (pos < buf.length - 4) {
    const len = buf.readUInt32BE(pos); pos += 4;
    const type = buf.slice(pos, pos + 4).toString(); pos += 4;
    const data = buf.slice(pos, pos + len); pos += len + 4; // +4 for CRC
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === "IDAT") idatChunks.push(data);
    if (type === "IEND") break;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 3; // RGB
  const stride = width * bpp;
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const srcRow = y * (stride + 1);
    const filter = raw[srcRow];
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const b = raw[srcRow + 1 + x];
      const left    = x >= bpp         ? pixels[dst + x - bpp]                   : 0;
      const up      = y > 0            ? pixels[dst - stride + x]                : 0;
      const upLeft  = (y > 0 && x >= bpp) ? pixels[dst - stride + x - bpp]      : 0;
      let val: number;
      switch (filter) {
        case 0: val = b; break;
        case 1: val = (b + left) & 0xFF; break;
        case 2: val = (b + up)   & 0xFF; break;
        case 3: val = (b + Math.floor((left + up) / 2)) & 0xFF; break;
        case 4: {
          const pa = Math.abs(up - upLeft), pb = Math.abs(left - upLeft), pc = Math.abs(left + up - 2 * upLeft);
          val = (b + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)) & 0xFF;
          break;
        }
        default: val = b;
      }
      pixels[dst + x] = val;
    }
  }

  const getPixel = (x: number, y: number) => {
    const off = y * stride + x * bpp;
    return { r: pixels[off], g: pixels[off + 1], b: pixels[off + 2] };
  };
  const terrarium = (px: { r: number; g: number; b: number }) => px.r * 256 + px.g + px.b / 256 - 32768;
  return { getPixel, terrarium, width, height };
}

// ---------------------------------------------------------------------------
// Point-in-polygon test (ray casting) — polygon is [lng, lat] pairs (GeoJSON)
// ---------------------------------------------------------------------------
function pointInPolygon(lng: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

async function fetchElevationViaTerrarium(lat: number, lng: number, parcelBbox?: ParcelBbox | null): Promise<ContourResult | null> {
  const ZOOM = 15; // ~3.8m per pixel for Auckland — backed by Mapzen/LINZ 1m NZ LiDAR
  const { tileX, tileY, px, py, pixelSizeM } = terrariumTileCoords(lat, lng, ZOOM);
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${tileX}/${tileY}.png`;

  logger.info({ lat, lng, tileX, tileY, px, py, pixelSizeM: pixelSizeM.toFixed(2) }, "Terrarium tiles: downloading elevation tile");

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`Terrarium tile HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const png = decodeTerrariumPng(buf);

  // Helper: pixel offset within this tile → geographic coordinates
  function pixelToLatLng(tPx: number, tPy: number): { lat: number; lng: number } {
    const n = Math.pow(2, ZOOM);
    const lngOut = ((tileX + tPx / 256) / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (tileY + tPy / 256)) / n)));
    return { lat: latRad * (180 / Math.PI), lng: lngOut };
  }

  let elevSamples: { elev: number; tPx: number; tPy: number }[] = [];
  let samplingMode: string;

  if (parcelBbox && parcelBbox.polygon && parcelBbox.polygon.length >= 3) {
    // -----------------------------------------------------------------------
    // Polygon mode: sample EVERY pixel within the parcel bbox, keep only those
    // that fall inside the actual polygon.  This mirrors what GIS software does
    // when it finds the highest and lowest contour crossing a parcel.
    // -----------------------------------------------------------------------
    const sw = terrariumTileCoords(parcelBbox.minLat, parcelBbox.minLng, ZOOM);
    const ne = terrariumTileCoords(parcelBbox.maxLat, parcelBbox.maxLng, ZOOM);
    const x0 = Math.min(sw.px, ne.px), x1 = Math.max(sw.px, ne.px);
    const y0 = Math.min(sw.py, ne.py), y1 = Math.max(sw.py, ne.py);

    for (let tPy = y0; tPy <= y1; tPy++) {
      for (let tPx = x0; tPx <= x1; tPx++) {
        const geo = pixelToLatLng(tPx, tPy);
        if (pointInPolygon(geo.lng, geo.lat, parcelBbox.polygon)) {
          const clampX = Math.min(Math.max(tPx, 0), png.width - 1);
          const clampY = Math.min(Math.max(tPy, 0), png.height - 1);
          elevSamples.push({ elev: png.terrarium(png.getPixel(clampX, clampY)), tPx, tPy });
        }
      }
    }
    samplingMode = `polygon pixel-scan (${elevSamples.length} pixels inside ${parcelBbox.polygon.length}-vertex ring)`;
  } else if (parcelBbox) {
    // -----------------------------------------------------------------------
    // Bbox mode: bbox available but no polygon — sample 7×7 grid across it.
    // -----------------------------------------------------------------------
    const GRID = 7;
    const sw = terrariumTileCoords(parcelBbox.minLat, parcelBbox.minLng, ZOOM);
    const ne = terrariumTileCoords(parcelBbox.maxLat, parcelBbox.maxLng, ZOOM);
    const bboxWidthPx  = Math.abs(ne.px - sw.px) || 4;
    const bboxHeightPx = Math.abs(ne.py - sw.py) || 4;
    const stepPx = Math.max(1, Math.round(Math.max(bboxWidthPx, bboxHeightPx) / (GRID - 1)));
    const startPx = Math.min(sw.px, ne.px), startPy = Math.min(sw.py, ne.py);
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const tPx = Math.min(Math.max(startPx + c * stepPx, 0), png.width - 1);
        const tPy = Math.min(Math.max(startPy + r * stepPx, 0), png.height - 1);
        elevSamples.push({ elev: png.terrarium(png.getPixel(tPx, tPy)), tPx, tPy });
      }
    }
    samplingMode = "bbox 7×7 grid";
  } else {
    // -----------------------------------------------------------------------
    // Fallback: no parcel data — 7×7 grid at 3-pixel spacing around geocoded point
    // -----------------------------------------------------------------------
    const GRID = 7, STEP = 3;
    const startPx = px - Math.floor(GRID / 2) * STEP;
    const startPy = py - Math.floor(GRID / 2) * STEP;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        const tPx = Math.min(Math.max(startPx + c * STEP, 0), png.width - 1);
        const tPy = Math.min(Math.max(startPy + r * STEP, 0), png.height - 1);
        elevSamples.push({ elev: png.terrarium(png.getPixel(tPx, tPy)), tPx, tPy });
      }
    }
    samplingMode = "geocode 7×7 grid (~11m step)";
  }

  if (elevSamples.length === 0) {
    logger.warn({ lat, lng }, "Terrarium tiles: no samples collected — falling back");
    return null;
  }

  // True min and max elevation across all sampled points
  let minSample = elevSamples[0], maxSample = elevSamples[0];
  for (const s of elevSamples) {
    if (s.elev < minSample.elev) minSample = s;
    if (s.elev > maxSample.elev) maxSample = s;
  }
  const elevMin = minSample.elev;
  const elevMax = maxSample.elev;
  const elevRange = elevMax - elevMin;

  // Horizontal distance between min and max points (in metres)
  const dxPx = maxSample.tPx - minSample.tPx;
  const dyPx = maxSample.tPy - minSample.tPy;
  const horizDistM = Math.sqrt(dxPx * dxPx + dyPx * dyPx) * pixelSizeM;

  // Slope = arctan(elevation_change / horizontal_distance)
  // Guard against identical pixels (flat parcel) — use 1m minimum distance
  const slopeDeg = horizDistM > 1
    ? Math.atan(elevRange / horizDistM) * (180 / Math.PI)
    : 0;

  const centerElev = png.terrarium(png.getPixel(
    Math.min(Math.max(px, 0), png.width - 1),
    Math.min(Math.max(py, 0), png.height - 1),
  ));

  logger.info(
    {
      lat, lng, samplingMode, pixelCount: elevSamples.length,
      elevMin: elevMin.toFixed(1), elevMax: elevMax.toFixed(1),
      elevRange: elevRange.toFixed(1), horizDistM: horizDistM.toFixed(1),
      slopeDeg: slopeDeg.toFixed(1), pixelSizeM: pixelSizeM.toFixed(2),
    },
    "Terrarium tiles: slope measurement complete",
  );

  return classifySlope(slopeDeg, "LINZ parcel polygon + 1m NZ LiDAR terrain tiles", centerElev);
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

async function fetchElevationViaOpenTopoData(lat: number, lng: number, parcelBbox?: ParcelBbox | null): Promise<ContourResult | null> {
  // Strategy: if we have the parcel polygon bbox from LINZ, sample uniformly across it.
  // This captures the lowest and highest contour within the actual parcel — even for elongated
  // hillside properties where the geocoded point (road frontage) sits at the top and the
  // steep downhill portion is missed by a fixed-offset box.
  //
  // Without bbox: fall back to a 5×5 grid at ~10m spacing centred on the geocoded point.
  // nzdem8m is NZ's purpose-built 8m DEM — far more accurate than global SRTM 30m.

  let finePoints: { lat: number; lng: number }[] = [];
  let stepM: number;
  let gridLabel: string;

  if (parcelBbox) {
    // Build a 7×7 grid evenly distributed across the parcel bounding box.
    // 7×7 = 49 points — comfortably within OpenTopoData's 100-point limit.
    const GRID = 7;
    const latRange = parcelBbox.maxLat - parcelBbox.minLat;
    const lngRange = parcelBbox.maxLng - parcelBbox.minLng;
    const stepLat = latRange / (GRID - 1);
    const stepLng = lngRange / (GRID - 1);
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        finePoints.push({
          lat: parcelBbox.minLat + r * stepLat,
          lng: parcelBbox.minLng + c * stepLng,
        });
      }
    }
    // Use the shorter axis as the step distance for slope calculation
    const widthM  = lngRange * 111320 * Math.cos(lat * Math.PI / 180);
    const heightM = latRange * 111320;
    stepM = Math.min(widthM, heightM) / (GRID - 1);
    gridLabel = `parcel-bbox 7×7 (${(widthM).toFixed(0)}m×${(heightM).toFixed(0)}m)`;
  } else {
    // Fallback: 5×5 grid at ~10m spacing around geocoded point
    const FINE_OFFSET = 0.00009; // ~10m
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        finePoints.push({ lat: lat + i * FINE_OFFSET, lng: lng + j * FINE_OFFSET });
      }
    }
    stepM = FINE_OFFSET * 111320;
    gridLabel = "geocode-centred 5×5 (40m×40m fallback)";
  }

  const fineLocStr = finePoints.map((p) => `${p.lat.toFixed(7)},${p.lng.toFixed(7)}`).join("|");

  // Also add a broader 3×3 grid at 200m spacing to capture neighbourhood-scale slopes
  // (catches situations where the parcel sits on a valley/ridge edge)
  const BROAD_OFFSET = 0.0018; // ~200m
  const broadPoints = buildElevationGrid(lat, lng, BROAD_OFFSET);
  const broadLocStr = broadPoints.map((p) => `${p.lat},${p.lng}`).join("|");

  // Determine grid columns (7 for bbox mode, 5 for fallback)
  const GRID_COLS = parcelBbox ? 7 : 5;
  const minPoints = parcelBbox ? 40 : 20; // accept partial results gracefully

  // Try nzdem8m (NZ-specific 8m DEM) first
  try {
    const url = `https://api.opentopodata.org/v1/nzdem8m?locations=${fineLocStr}`;
    logger.info({ lat, lng, points: finePoints.length, gridLabel, stepM: stepM.toFixed(0) }, "OpenTopoData: querying nzdem8m (NZ 8m DEM)");
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!resp.ok) throw new Error(`OpenTopoData nzdem8m HTTP ${resp.status}`);

    const data = (await resp.json()) as { status: string; results?: Array<{ elevation: number }> };
    if (data.status !== "OK" || !data.results || data.results.length < minPoints) throw new Error(`nzdem8m: insufficient results (${data.results?.length ?? 0})`);

    const elevs = data.results.map((r) => r.elevation).filter((e) => e != null && !isNaN(e));
    const centerIdx = Math.floor(elevs.length / 2);
    const centerElevation = elevs[centerIdx];
    const elevMin = Math.min(...elevs);
    const elevMax = Math.max(...elevs);
    const elevRange = elevMax - elevMin;

    // Find maximum gradient between any adjacent pair of points (row and column neighbours).
    // With parcel-bbox sampling this measures the steepest gradient anywhere within the parcel.
    let maxGrad = 0;
    for (let r = 0; r < GRID_COLS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const idx = r * GRID_COLS + c;
        if (idx >= elevs.length) continue;
        if (c + 1 < GRID_COLS && idx + 1 < elevs.length)
          maxGrad = Math.max(maxGrad, Math.abs(elevs[idx] - elevs[idx + 1]) / stepM);
        if (r + 1 < GRID_COLS && idx + GRID_COLS < elevs.length)
          maxGrad = Math.max(maxGrad, Math.abs(elevs[idx] - elevs[idx + GRID_COLS]) / stepM);
      }
    }
    const slopeDeg = Math.atan(maxGrad) * (180 / Math.PI);

    logger.info(
      { lat, lng, centerElevation, elevMin, elevMax, elevRange: elevRange.toFixed(1), slopeDeg: slopeDeg.toFixed(1), maxGradPct: (maxGrad*100).toFixed(1), gridLabel },
      "OpenTopoData nzdem8m: slope measurement complete"
    );
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

export async function fetchContour(lat: number, lng: number, parcelBbox?: ParcelBbox | null): Promise<ContourResult> {
  // 1. AWS Terrarium terrain tiles — public, no key, ~3.8m resolution backed by 1m NZ LiDAR
  //    This is the most accurate freely available source for NZ.  SRTM-based sources (Google,
  //    nzdem8m) are smoothed at 30m and systematically underestimate slope on urban hillsides.
  try {
    const result = await fetchElevationViaTerrarium(lat, lng, parcelBbox);
    if (result) return result;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Terrarium tiles failed — trying Google Elevation");
  }

  // 2. Google Elevation — fallback when Terrarium unavailable
  if (process.env["GOOGLE_MAPS_API_KEY"]) {
    try {
      const result = await fetchElevationViaGoogle(lat, lng);
      if (result) return result;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "Google elevation query failed — trying OpenTopoData");
    }
  }

  // 3. Open-Topo-Data NZ 8m DEM — free, no key, NZ-specific
  try {
    const result = await fetchElevationViaOpenTopoData(lat, lng, parcelBbox);
    if (result) return result;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "OpenTopoData query failed — trying Open-Elevation");
  }

  // 4. Open-Elevation API — free backup
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
