import { logger } from "./logger";
import { geocodeAddress, type GeoResult } from "./geocode";
import { fetchLINZParcel, fetchLINZParcelsNear, type LinzParcel, type ParcelBbox } from "./linz";
import type { RawPropertyData } from "./pipeline";
import {
  regionalPlanningProvidersEnabled,
  resolvePlanningJurisdiction,
  type PlanningProviderId,
} from "./regional-planning";
import { regionalSitePlanOverlayLayers, type RegionalSitePlanOverlayLayer } from "./regional-arcgis";
import { regionalInfrastructureServiceLayers, type RegionalInfrastructureGroup } from "./regional-infrastructure";

type GeoJsonPosition = [number, number];
type GeoJsonGeometry =
  | { type: "Point"; coordinates: GeoJsonPosition }
  | { type: "LineString"; coordinates: GeoJsonPosition[] }
  | { type: "MultiLineString"; coordinates: GeoJsonPosition[][] }
  | { type: "Polygon"; coordinates: GeoJsonPosition[][] }
  | { type: "MultiPolygon"; coordinates: GeoJsonPosition[][][] };

export interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

export interface SitePlanBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export interface SitePlanAerialTile {
  z: number;
  x: number;
  y: number;
  /** Pixel offset of this tile inside the image canvas (image.width × image.height). */
  left: number;
  top: number;
}

export interface SitePlanImage {
  /** Retained for backward compatibility / placeholder; empty when tiles are used. */
  dataUri: string;
  width: number;
  height: number;
  bounds: SitePlanBounds;
  attribution: string;
  available: boolean;
  source: "linz-basemaps" | "placeholder";
  /** Tile edge length in px (when client-rendered tiles are used). */
  tileSize?: number;
  /** Aerial tiles for the client to render via the /tiles/aerial proxy. */
  tiles?: SitePlanAerialTile[];
}

export type SitePlanLayerGroup = "boundary" | "planning" | "services" | "contours";
export type SitePlanMarkerShape = "circle" | "triangle" | "square";

export interface SitePlanLayerStyle {
  stroke: string;
  strokeWidth: number;
  strokeOpacity?: number;
  fill?: string;
  fillOpacity?: number;
  dashArray?: number[];
  markerShape?: SitePlanMarkerShape;
}

export interface SitePlanLegendItem {
  label: string;
  color: string;
  kind: "line" | "polygon" | "point";
}

export interface SitePlanLayer {
  id: string;
  label: string;
  group: SitePlanLayerGroup;
  defaultVisible: boolean;
  style: SitePlanLayerStyle;
  legend: SitePlanLegendItem[];
  available: boolean;
  geojson: GeoJsonFeatureCollection;
}

export interface SitePlanResponse {
  image: SitePlanImage;
  center: { lat: number; lng: number };
  layers: SitePlanLayer[];
}

type ArcGisGeometry = {
  rings?: unknown;
  paths?: unknown;
  x?: unknown;
  y?: unknown;
};

type ArcGisFeature = {
  attributes?: Record<string, unknown>;
  geometry?: ArcGisGeometry;
};

type TileRange = {
  zoom: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  widthTiles: number;
  heightTiles: number;
  bounds: SitePlanBounds;
};

const TILE_SIZE = 256;
const MAX_AERIAL_TILES = 24;
const AERIAL_TILE_CONTEXT_PAD = 1;
const NEIGHBOURHOOD_CONTEXT_PAD_M = 90;
const NEIGHBOURHOOD_CONTEXT_MIN_SPAN_M = 300;
const AUCKLAND_MANAGEMENT_LAYERS =
  "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/UnitaryPlanManagementLayers/MapServer";
const AUCKLAND_UNDERGROUND_SERVICES =
  "https://mapspublic.aucklandcouncil.govt.nz/arcgis/rest/services/LiveMaps/UndergroundServices/MapServer";
const LINZ_CONTOURS_LAYER = "layer-50768";
// Auckland Council LiDAR-derived contour layers (NZTM/2193, reprojected via inSR/outSR=4326).
// Far finer than the LINZ national 20m topo layer. Tried in order (finest first); a group/empty
// layer is skipped and we fall back to the next, then to the LINZ 20m WFS layer outside Auckland.
const AUCKLAND_CONTOURS =
  "https://mapspublic.aucklandcouncil.govt.nz/arcgis/rest/services/Contours/MapServer";
const AUCKLAND_CONTOUR_LAYERS: Array<{ id: number; interval: string }> = [
  { id: 10, interval: "0.5m" },
  { id: 9, interval: "1m" },
  { id: 8, interval: "2m" },
];
const EMPTY_GEOJSON: GeoJsonFeatureCollection = { type: "FeatureCollection", features: [] };

const PLANNING_LAYER_DEFS: Array<{ name: string; layerId: number; distanceM?: number; isControl?: boolean }> = [
  { name: "Heritage", layerId: 33 },
  { name: "Notable Trees", layerId: 19, distanceM: 30 },
  { name: "Volcanic Viewshaft", layerId: 25 },
  { name: "Locally Significant Viewshaft", layerId: 27 },
  { name: "Coastal Inundation", layerId: 58 },
  { name: "Waitakere Ranges Heritage", layerId: 24 },
  { name: "Ridgeline Protection", layerId: 29 },
  { name: "Sites and Places of Significance to Mana Whenua", layerId: 40 },
  { name: "Significant Ecological Area", layerId: 10 },
  { name: "Wetland Management Area", layerId: 15 },
  { name: "Natural Stream Management Area", layerId: 12 },
  { name: "High-Use Stream Management Area", layerId: 13 },
  { name: "Lake Management Area", layerId: 14 },
  { name: "Water Supply Management Area", layerId: 11 },
  { name: "High-Use Aquifer Management Area", layerId: 16 },
  { name: "Quality-Sensitive Aquifer Management Area", layerId: 17 },
  { name: "Special Character Area", layerId: 34 },
  { name: "Outstanding Natural Feature", layerId: 20 },
  { name: "Outstanding Natural Landscape", layerId: 21 },
  { name: "Outstanding Natural Character", layerId: 22 },
  { name: "High Natural Character", layerId: 23 },
  { name: "Local Public Views", layerId: 30 },
  { name: "Height Variation Control", layerId: 55, isControl: true },
  { name: "Subdivision Variation Control", layerId: 64, isControl: true },
  { name: "Parking Variation Control", layerId: 62, isControl: true },
  { name: "Stormwater Management Area Control", layerId: 63, isControl: true },
  { name: "Arterial Roads Control", layerId: 51, distanceM: 20, isControl: true },
  { name: "Building Frontage Control", layerId: 52, distanceM: 12, isControl: true },
  { name: "Vehicle Access Restriction Control", layerId: 53, distanceM: 12, isControl: true },
  { name: "Level Crossings With Sightlines Control", layerId: 60, isControl: true },
  { name: "Emergency Management Area Control", layerId: 59, isControl: true },
  { name: "Cable Protection Areas Control", layerId: 56, isControl: true },
];

const PLANNING_LAYER_COLORS = [
  "#E11D48",
  "#16A34A",
  "#A16207",
  "#0891B2",
  "#DC2626",
  "#4D7C0F",
  "#BE123C",
  "#0F766E",
  "#9333EA",
  "#15803D",
  "#0D9488",
  "#0369A1",
  "#65A30D",
  "#1D4ED8",
  "#7C2D12",
  "#A21CAF",
  "#C2410C",
  "#047857",
  "#B91C1C",
  "#4338CA",
  "#A855F7",
  "#0E7490",
  "#0284C7",
  "#7E22CE",
  "#B45309",
  "#166534",
  "#1E40AF",
  "#C026D3",
  "#9F1239",
  "#155E75",
  "#6D28D9",
  "#854D0E",
] as const;

function planningLayerColor(def: { name: string; layerId: number }): string {
  const index = PLANNING_LAYER_DEFS.findIndex((item) => item.layerId === def.layerId);
  return PLANNING_LAYER_COLORS[Math.max(0, index) % PLANNING_LAYER_COLORS.length]!;
}

function regionalPlanningLayerColor(index: number): string {
  return PLANNING_LAYER_COLORS[Math.max(0, index) % PLANNING_LAYER_COLORS.length]!;
}

function planningLayerKind(def: { name: string }): SitePlanLegendItem["kind"] {
  return def.name === "Notable Trees" ? "point" : "polygon";
}

function regionalPlanningLayerKind(def: RegionalSitePlanOverlayLayer): SitePlanLegendItem["kind"] {
  if (def.geometryType === "point") return "point";
  if (def.geometryType === "polyline") return "line";
  return "polygon";
}

export function planningLayerStylePreview(): Array<{
  name: string;
  layerId: number;
  color: string;
  kind: SitePlanLegendItem["kind"];
  style: SitePlanLayerStyle;
}> {
  return PLANNING_LAYER_DEFS.map((def) => {
    const color = planningLayerColor(def);
    return {
      name: def.name,
      layerId: def.layerId,
      color,
      kind: planningLayerKind(def),
      style: {
        stroke: color,
        strokeWidth: def.name === "Notable Trees" ? 2.6 : def.isControl ? 2.4 : 2,
        strokeOpacity: 0.92,
        fill: color,
        fillOpacity: def.name === "Notable Trees" ? 0.9 : def.isControl ? 0.08 : 0.15,
        dashArray: def.isControl ? [8, 6] : undefined,
        markerShape: def.name === "Notable Trees" ? "triangle" : undefined,
      },
    };
  });
}

const SERVICE_LAYER_DEFS: Array<{
  id: "service-stormwater" | "service-wastewater" | "service-water";
  label: string;
  color: string;
  layers: Array<{ id: number; label: string }>;
}> = [
  {
    id: "service-stormwater",
    label: "Stormwater",
    color: "#0EA5E9",
    layers: [
      { id: 109, label: "Stormwater Pipe" },
      { id: 32, label: "Stormwater Watercourse" },
      { id: 36, label: "Stormwater Channel" },
    ],
  },
  {
    id: "service-wastewater",
    label: "Wastewater",
    color: "#7C3AED",
    layers: [
      { id: 5, label: "Wastewater Pipe (Local)" },
      { id: 12, label: "Wastewater Pipe (Transmission)" },
    ],
  },
  {
    id: "service-water",
    label: "Water Supply",
    color: "#2563EB",
    layers: [
      { id: 52, label: "Water Pipe (Local)" },
      { id: 61, label: "Water Pipe (Transmission)" },
    ],
  },
];

function emptyFeatureCollection(): GeoJsonFeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function metersToLat(metres: number): number {
  return metres / 111_320;
}

function metersToLng(metres: number, lat: number): number {
  return metres / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
}

export function boundsCenter(bounds: SitePlanBounds): { lat: number; lng: number } {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };
}

export function boundsFromParcel(parcel: LinzParcel | null | undefined): SitePlanBounds | null {
  if (!parcel?.bbox) return null;
  const { minLat, maxLat, minLng, maxLng } = parcel.bbox;
  if (![minLat, maxLat, minLng, maxLng].every(Number.isFinite)) return null;
  return { minLat, maxLat, minLng, maxLng };
}

export function fallbackBoundsFromCenter(lat: number, lng: number, radiusMetres = 90): SitePlanBounds {
  const latPad = metersToLat(radiusMetres);
  const lngPad = metersToLng(radiusMetres, lat);
  return {
    minLat: lat - latPad,
    maxLat: lat + latPad,
    minLng: lng - lngPad,
    maxLng: lng + lngPad,
  };
}

export function paddedBounds(bounds: SitePlanBounds, padMetres = 45, minSpanMetres = 150): SitePlanBounds {
  const center = boundsCenter(bounds);
  const latPad = metersToLat(padMetres);
  const lngPad = metersToLng(padMetres, center.lat);
  let next: SitePlanBounds = {
    minLat: bounds.minLat - latPad,
    maxLat: bounds.maxLat + latPad,
    minLng: bounds.minLng - lngPad,
    maxLng: bounds.maxLng + lngPad,
  };

  const latSpanM = (next.maxLat - next.minLat) * 111_320;
  const lngSpanM = (next.maxLng - next.minLng) * 111_320 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180));
  if (latSpanM < minSpanMetres) {
    const pad = metersToLat((minSpanMetres - latSpanM) / 2);
    next = { ...next, minLat: next.minLat - pad, maxLat: next.maxLat + pad };
  }
  if (lngSpanM < minSpanMetres) {
    const pad = metersToLng((minSpanMetres - lngSpanM) / 2, center.lat);
    next = { ...next, minLng: next.minLng - pad, maxLng: next.maxLng + pad };
  }
  return next;
}

export function sitePlanMapBounds(bounds: SitePlanBounds): SitePlanBounds {
  return paddedBounds(bounds, NEIGHBOURHOOD_CONTEXT_PAD_M, NEIGHBOURHOOD_CONTEXT_MIN_SPAN_M);
}

function lngToTileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * 2 ** zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const latRad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom);
}

function tileXToLng(x: number, zoom: number): number {
  return (x / 2 ** zoom) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function selectLinzAerialTileRange(bounds: SitePlanBounds, maxTiles = MAX_AERIAL_TILES): TileRange {
  let selected: TileRange | null = null;
  for (let zoom = 20; zoom >= 14; zoom -= 1) {
    const limit = 2 ** zoom - 1;
    const minX = Math.max(0, Math.min(limit, lngToTileX(bounds.minLng, zoom)));
    const maxX = Math.max(0, Math.min(limit, lngToTileX(bounds.maxLng, zoom)));
    const minY = Math.max(0, Math.min(limit, latToTileY(bounds.maxLat, zoom)));
    const maxY = Math.max(0, Math.min(limit, latToTileY(bounds.minLat, zoom)));
    const widthTiles = maxX - minX + 1;
    const heightTiles = maxY - minY + 1;
    const range = {
      zoom,
      minX,
      maxX,
      minY,
      maxY,
      widthTiles,
      heightTiles,
      bounds: {
        minLng: tileXToLng(minX, zoom),
        maxLng: tileXToLng(maxX + 1, zoom),
        maxLat: tileYToLat(minY, zoom),
        minLat: tileYToLat(maxY + 1, zoom),
      },
    };
    selected = range;
    if (widthTiles * heightTiles <= maxTiles) return range;
  }
  return selected ?? {
    zoom: 14,
    minX: lngToTileX(bounds.minLng, 14),
    maxX: lngToTileX(bounds.maxLng, 14),
    minY: latToTileY(bounds.maxLat, 14),
    maxY: latToTileY(bounds.minLat, 14),
    widthTiles: 1,
    heightTiles: 1,
    bounds,
  };
}

function tileRangeFromEdges(zoom: number, minX: number, maxX: number, minY: number, maxY: number): TileRange {
  return {
    zoom,
    minX,
    maxX,
    minY,
    maxY,
    widthTiles: maxX - minX + 1,
    heightTiles: maxY - minY + 1,
    bounds: {
      minLng: tileXToLng(minX, zoom),
      maxLng: tileXToLng(maxX + 1, zoom),
      maxLat: tileYToLat(minY, zoom),
      minLat: tileYToLat(maxY + 1, zoom),
    },
  };
}

export function expandLinzAerialTileRange(range: TileRange, padTiles = AERIAL_TILE_CONTEXT_PAD): TileRange {
  if (padTiles <= 0) return range;
  const limit = 2 ** range.zoom - 1;
  return tileRangeFromEdges(
    range.zoom,
    Math.max(0, range.minX - padTiles),
    Math.min(limit, range.maxX + padTiles),
    Math.max(0, range.minY - padTiles),
    Math.min(limit, range.maxY + padTiles),
  );
}

function linzBasemapsKey(): string | null {
  return process.env["LINZ_BASEMAPS_API_KEY"]?.trim() || process.env["LINZ_API_KEY"]?.trim() || null;
}

let aerialTileFailureLogged = false;

export function hasLinzBasemapsKey(): boolean {
  return linzBasemapsKey() !== null;
}

/**
 * Fetch a single LINZ Basemaps aerial tile with the server-held key. Used by the
 * `/tiles/aerial/:z/:x/:y` proxy so the Basemaps key never reaches the client and `sharp`
 * is not needed (the client renders tiles directly).
 */
export async function fetchAerialTile(
  z: number,
  x: number,
  y: number,
): Promise<{ body: Buffer; contentType: string } | null> {
  const key = linzBasemapsKey();
  if (!key) {
    if (!aerialTileFailureLogged) {
      aerialTileFailureLogged = true;
      logger.warn("site-plan: no LINZ Basemaps key (set LINZ_BASEMAPS_API_KEY) — aerial tiles unavailable");
    }
    return null;
  }
  const url =
    `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/${z}/${x}/${y}.jpeg` +
    `?api=${encodeURIComponent(key)}`;
  try {
    const resp = await fetch(url, {
      headers: { Accept: "image/jpeg,image/*" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      if (!aerialTileFailureLogged) {
        aerialTileFailureLogged = true;
        // A 401/403 here almost always means the LINZ Basemaps tile API rejected the key —
        // basemaps.linz.govt.nz needs a Basemaps-scoped key, NOT a data.linz.govt.nz key.
        logger.warn(
          { status: resp.status },
          "site-plan: LINZ aerial tile request failed (check LINZ_BASEMAPS_API_KEY)",
        );
      }
      return null;
    }
    return {
      body: Buffer.from(await resp.arrayBuffer()),
      contentType: resp.headers.get("content-type") ?? "image/jpeg",
    };
  } catch (err) {
    if (!aerialTileFailureLogged) {
      aerialTileFailureLogged = true;
      logger.warn({ err: (err as Error).message }, "site-plan: LINZ aerial tile fetch threw");
    }
    return null;
  }
}

/**
 * Describe the aerial as a grid of tiles for the client to render directly (via the proxy),
 * instead of compositing a single raster server-side with `sharp`. Tiles are rendered at their
 * native resolution → crisper than a recompressed/downscaled JPEG, and robust on serverless.
 */
function buildAerialTileGrid(bounds: SitePlanBounds): SitePlanImage {
  const range = expandLinzAerialTileRange(selectLinzAerialTileRange(bounds));
  const width = range.widthTiles * TILE_SIZE;
  const height = range.heightTiles * TILE_SIZE;
  if (!hasLinzBasemapsKey()) {
    logger.warn("site-plan: no LINZ Basemaps key (set LINZ_BASEMAPS_API_KEY) — aerial unavailable");
    return {
      dataUri: "",
      width,
      height,
      bounds: range.bounds,
      attribution: "LINZ Basemaps unavailable",
      available: false,
      source: "placeholder",
    };
  }

  const tiles: SitePlanAerialTile[] = [];
  for (let x = range.minX; x <= range.maxX; x += 1) {
    for (let y = range.minY; y <= range.maxY; y += 1) {
      tiles.push({
        z: range.zoom,
        x,
        y,
        left: (x - range.minX) * TILE_SIZE,
        top: (y - range.minY) * TILE_SIZE,
      });
    }
  }

  return {
    dataUri: "",
    width,
    height,
    bounds: range.bounds,
    attribution: "Aerial imagery: LINZ Basemaps",
    available: true,
    source: "linz-basemaps",
    tileSize: TILE_SIZE,
    tiles,
  };
}

function closedRing(ring: GeoJsonPosition[]): GeoJsonPosition[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return ring;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function pointFromUnknown(value: unknown): GeoJsonPosition | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

function lineFromUnknown(value: unknown): GeoJsonPosition[] | null {
  if (!Array.isArray(value)) return null;
  const points = value.map(pointFromUnknown).filter((point): point is GeoJsonPosition => point !== null);
  return points.length >= 2 ? points : null;
}

function linesFromUnknown(value: unknown): GeoJsonPosition[][] {
  if (!Array.isArray(value)) return [];
  return value.map(lineFromUnknown).filter((line): line is GeoJsonPosition[] => line !== null);
}

function arcgisGeometryToGeoJson(geometry: ArcGisGeometry | undefined): GeoJsonGeometry | null {
  if (!geometry) return null;
  if (typeof geometry.x === "number" && typeof geometry.y === "number") {
    return { type: "Point", coordinates: [geometry.x, geometry.y] };
  }
  const rings = linesFromUnknown(geometry.rings);
  if (rings.length > 0) {
    return { type: "Polygon", coordinates: rings.map(closedRing) };
  }
  const paths = linesFromUnknown(geometry.paths);
  if (paths.length === 1) {
    return { type: "LineString", coordinates: paths[0]! };
  }
  if (paths.length > 1) {
    return { type: "MultiLineString", coordinates: paths };
  }
  return null;
}

function usefulFeatureName(attrs: Record<string, unknown>, fallback: string): string {
  const keys = ["NAME", "LABEL", "TYPE", "SUBTYPE", "ASSETID", "OBJECTID", "FID"];
  for (const key of keys) {
    const value = attrs[key];
    if (value != null && String(value).trim() && String(value).trim().toLowerCase() !== "null") {
      return String(value).trim();
    }
  }
  return fallback;
}

function arcgisFeaturesToGeoJson(features: ArcGisFeature[], fallbackLabel: string): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.flatMap((feature) => {
      const geometry = arcgisGeometryToGeoJson(feature.geometry);
      if (!geometry) return [];
      const attrs = feature.attributes ?? {};
      return [{
        type: "Feature" as const,
        properties: {
          label: usefulFeatureName(attrs, fallbackLabel),
          objectId: attrs["OBJECTID"] ?? attrs["FID"] ?? null,
          sourceLayer: fallbackLabel,
        },
        geometry,
      }];
    }),
  };
}

function arcgisParcelGeometry(parcelBbox: ParcelBbox | null | undefined): { geometry: string; geometryType: string } | null {
  if (parcelBbox?.polygon && parcelBbox.polygon.length >= 3) {
    return {
      geometry: JSON.stringify({
        rings: [closedRing(parcelBbox.polygon)],
        spatialReference: { wkid: 4326 },
      }),
      geometryType: "esriGeometryPolygon",
    };
  }
  return null;
}

async function queryArcGisFeatures(args: {
  serviceUrl: string;
  layerId: number;
  geometry: string;
  geometryType: string;
  distanceM?: number;
  maxFeatures?: number;
  timeoutMs?: number;
}): Promise<ArcGisFeature[]> {
  const url = new URL(`${args.serviceUrl}/${args.layerId}/query`);
  url.searchParams.set("geometry", args.geometry);
  url.searchParams.set("geometryType", args.geometryType);
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("geometryPrecision", "7");
  url.searchParams.set("resultRecordCount", String(args.maxFeatures ?? 80));
  url.searchParams.set("f", "json");
  if (args.distanceM != null) {
    url.searchParams.set("distance", String(args.distanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(args.timeoutMs ?? 9000) });
  if (!resp.ok) throw new Error(`ArcGIS HTTP ${resp.status}`);
  const data = (await resp.json()) as { features?: ArcGisFeature[]; error?: { message?: string } };
  if (data.error) throw new Error(`ArcGIS error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

function boundaryLayer(parcel: LinzParcel | null): SitePlanLayer {
  const polygon = parcel?.bbox?.polygon;
  const available = Array.isArray(polygon) && polygon.length >= 3;
  return {
    id: "boundary",
    label: "Parcel Boundary",
    group: "boundary",
    defaultVisible: available,
    available,
    style: {
      stroke: "#F97316",
      strokeWidth: 4,
      strokeOpacity: 0.96,
      fill: "#F97316",
      fillOpacity: 0.08,
    },
    legend: [{ label: "Parcel boundary", color: "#F97316", kind: "polygon" }],
    geojson: available
      ? {
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: {
              label: parcel?.appellation ?? parcel?.parcel_id ?? "Parcel boundary",
              parcelId: parcel?.parcel_id ?? null,
            },
            geometry: { type: "Polygon", coordinates: [closedRing(polygon)] },
          }],
        }
      : emptyFeatureCollection(),
  };
}

export function nearbyBoundaryLayer(parcels: LinzParcel[] | null | undefined, targetParcel: LinzParcel | null): SitePlanLayer {
  const targetParcelId = targetParcel?.parcel_id ?? null;
  const features = (parcels ?? []).flatMap((parcel): GeoJsonFeature[] => {
    if (targetParcelId && parcel.parcel_id === targetParcelId) return [];
    const polygon = parcel.bbox?.polygon;
    if (!Array.isArray(polygon) || polygon.length < 3) return [];
    return [{
      type: "Feature",
      properties: {
        label: parcel.appellation ?? parcel.parcel_id ?? "Nearby parcel",
        parcelId: parcel.parcel_id,
      },
      geometry: { type: "Polygon", coordinates: [closedRing(polygon)] },
    }];
  });

  return {
    id: "nearby-boundaries",
    label: "Nearby Boundaries",
    group: "boundary",
    defaultVisible: features.length > 0,
    available: features.length > 0,
    style: {
      stroke: "#334155",
      strokeWidth: 1.15,
      strokeOpacity: 0.72,
      fill: "#334155",
      fillOpacity: 0,
    },
    legend: [{ label: "Nearby property boundaries", color: "#334155", kind: "polygon" }],
    geojson: { type: "FeatureCollection", features },
  };
}

function unavailableLayer(id: string, label: string, group: SitePlanLayerGroup, color: string): SitePlanLayer {
  return {
    id,
    label,
    group,
    defaultVisible: false,
    available: false,
    style: {
      stroke: color,
      strokeWidth: 2,
      fill: color,
      fillOpacity: 0.08,
    },
    legend: [{ label, color, kind: group === "services" || group === "contours" ? "line" : "polygon" }],
    geojson: emptyFeatureCollection(),
  };
}

async function planningOverlayLayers(lat: number, lng: number, parcelBbox: ParcelBbox | null | undefined): Promise<SitePlanLayer[]> {
  const parcelGeometry = arcgisParcelGeometry(parcelBbox);
  const pointGeometry = { geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint" };
  const queryGeometry = parcelGeometry ?? pointGeometry;

  const results = await Promise.allSettled(
    PLANNING_LAYER_DEFS.map(async (def) => {
      const features = await queryArcGisFeatures({
        serviceUrl: AUCKLAND_MANAGEMENT_LAYERS,
        layerId: def.layerId,
        geometry: queryGeometry.geometry,
        geometryType: queryGeometry.geometryType,
        distanceM: def.distanceM,
        maxFeatures: 50,
      });
      const geojson = arcgisFeaturesToGeoJson(features, def.name);
      if (geojson.features.length === 0) return null;
      const color = planningLayerColor(def);
      const kind = planningLayerKind(def);
      const isPoint = kind === "point";
      return {
        id: `planning-overlay-${def.layerId}`,
        label: def.name,
        group: "planning" as const,
        // Off by default — user turns overlays on one at a time. Only contours default on.
        defaultVisible: false,
        available: true,
        style: {
          stroke: color,
          strokeWidth: isPoint ? 2.6 : def.isControl ? 2.4 : 2,
          strokeOpacity: 0.92,
          fill: color,
          fillOpacity: isPoint ? 0.9 : def.isControl ? 0.08 : 0.15,
          dashArray: def.isControl ? [8, 6] : undefined,
          markerShape: isPoint ? "triangle" as const : undefined,
        },
        legend: [{ label: def.name, color, kind }],
        geojson,
      };
    }),
  );

  const layers: SitePlanLayer[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) layers.push(result.value);
  }
  return layers;
}

async function regionalPlanningOverlayLayers(
  providerId: PlanningProviderId,
  geo: GeoResult,
  parcelBbox: ParcelBbox | null | undefined,
  coreBounds: SitePlanBounds,
): Promise<SitePlanLayer[]> {
  const defs = regionalSitePlanOverlayLayers(providerId);
  if (defs.length === 0) return [];

  const parcelGeometry = arcgisParcelGeometry(parcelBbox);
  const pointGeometry = { geometry: `${geo.lng},${geo.lat}`, geometryType: "esriGeometryPoint" };
  const nearbyGeometry = envelopeGeometry(paddedBounds(coreBounds, 45, 180));

  const results = await Promise.allSettled(
    defs.map(async (def, index) => {
      const kind = regionalPlanningLayerKind(def);
      const queryGeometry = def.geometryType === "polygon"
        ? (parcelGeometry ?? pointGeometry)
        : nearbyGeometry;
      const features = await queryArcGisFeatures({
        serviceUrl: def.serviceUrl,
        layerId: def.layerId,
        geometry: queryGeometry.geometry,
        geometryType: queryGeometry.geometryType,
        distanceM: queryGeometry === pointGeometry ? def.distanceM : undefined,
        maxFeatures: 80,
      });
      const geojson = arcgisFeaturesToGeoJson(features, def.name);
      if (geojson.features.length === 0) return null;
      const color = regionalPlanningLayerColor(index);
      return {
        id: `regional-planning-${providerId}-${def.layerId}`,
        label: def.name,
        group: "planning" as const,
        defaultVisible: false,
        available: true,
        style: {
          stroke: color,
          strokeWidth: kind === "point" ? 2.6 : def.status === "control" ? 2.4 : 2,
          strokeOpacity: 0.92,
          fill: color,
          fillOpacity: kind === "point" ? 0.9 : def.status === "control" ? 0.08 : 0.15,
          dashArray: def.status === "control" ? [8, 6] : undefined,
          markerShape: kind === "point" ? "triangle" as const : undefined,
        },
        legend: [{ label: def.name, color, kind }],
        geojson,
      };
    }),
  );

  const layers: SitePlanLayer[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) layers.push(result.value);
  }
  return layers;
}

function envelopeGeometry(bounds: SitePlanBounds): { geometry: string; geometryType: string } {
  return {
    geometry: JSON.stringify({
      xmin: bounds.minLng,
      ymin: bounds.minLat,
      xmax: bounds.maxLng,
      ymax: bounds.maxLat,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryEnvelope",
  };
}

async function serviceLayers(bounds: SitePlanBounds): Promise<SitePlanLayer[]> {
  const serviceBounds = paddedBounds(bounds, 200, 520);
  const geometry = envelopeGeometry(serviceBounds);

  const groupResults = await Promise.allSettled(
    SERVICE_LAYER_DEFS.map(async (group) => {
      const layerResults = await Promise.allSettled(
        group.layers.map(async (layer) => {
          const features = await queryArcGisFeatures({
            serviceUrl: AUCKLAND_UNDERGROUND_SERVICES,
            layerId: layer.id,
            geometry: geometry.geometry,
            geometryType: geometry.geometryType,
            maxFeatures: 220,
            timeoutMs: 9000,
          });
          return arcgisFeaturesToGeoJson(features, layer.label).features.map((feature) => ({
            ...feature,
            properties: {
              ...feature.properties,
              serviceType: group.label,
              sourceLayer: layer.label,
            },
          }));
        }),
      );
      const features = layerResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (features.length === 0) return unavailableLayer(group.id, group.label, "services", group.color);
      return {
        id: group.id,
        label: group.label,
        group: "services" as const,
        // Off by default — user turns service/pipe overlays on one at a time.
        defaultVisible: false,
        available: true,
        style: {
          stroke: group.color,
          strokeWidth: 3,
          strokeOpacity: 0.95,
        },
        legend: [{ label: group.label, color: group.color, kind: "line" as const }],
        geojson: { type: "FeatureCollection" as const, features },
      };
    }),
  );

  return groupResults.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    const def = SERVICE_LAYER_DEFS[index]!;
    return unavailableLayer(def.id, def.label, "services", def.color);
  });
}

function regionalServiceLayerStyle(group: RegionalInfrastructureGroup): {
  id: "service-stormwater" | "service-wastewater" | "service-water";
  label: string;
  color: string;
} {
  if (group.name === "Stormwater") return { id: "service-stormwater", label: "Stormwater", color: "#0EA5E9" };
  if (group.name === "Wastewater") return { id: "service-wastewater", label: "Wastewater", color: "#7C3AED" };
  return { id: "service-water", label: "Water Supply", color: "#2563EB" };
}

async function regionalServiceLayers(bounds: SitePlanBounds, providerId: PlanningProviderId): Promise<SitePlanLayer[]> {
  const serviceBounds = paddedBounds(bounds, 200, 520);
  const geometry = envelopeGeometry(serviceBounds);
  const groups = regionalInfrastructureServiceLayers(providerId);
  if (groups.length === 0) return [];

  const groupResults = await Promise.allSettled(
    groups.map(async (group) => {
      const style = regionalServiceLayerStyle(group);
      const layerResults = await Promise.allSettled(
        group.layers.map(async (layer) => {
          const features = await queryArcGisFeatures({
            serviceUrl: group.serviceUrl,
            layerId: layer.id,
            geometry: geometry.geometry,
            geometryType: geometry.geometryType,
            maxFeatures: 220,
            timeoutMs: 9000,
          });
          return arcgisFeaturesToGeoJson(features, layer.label).features.map((feature) => ({
            ...feature,
            properties: {
              ...feature.properties,
              serviceType: group.name,
              sourceLayer: layer.label,
              sourceOwner: group.owner,
            },
          }));
        }),
      );
      const features = layerResults.flatMap((result) => result.status === "fulfilled" ? result.value : []);
      if (features.length === 0) return unavailableLayer(style.id, style.label, "services", style.color);
      return {
        id: style.id,
        label: style.label,
        group: "services" as const,
        defaultVisible: false,
        available: true,
        style: {
          stroke: style.color,
          strokeWidth: 3,
          strokeOpacity: 0.95,
        },
        legend: [{ label: style.label, color: style.color, kind: "line" as const }],
        geojson: { type: "FeatureCollection" as const, features },
      };
    }),
  );

  return groupResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

const CONTOUR_COLOR = "#475569";

function featureCollectionFromLinzContours(value: unknown): GeoJsonFeatureCollection {
  const obj = value as { features?: Array<{ properties?: Record<string, unknown>; geometry?: GeoJsonGeometry }> };
  const features = (obj.features ?? []).flatMap((feature): GeoJsonFeature[] => {
    const geometry = feature.geometry;
    if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) return [];
    return [{
      type: "Feature",
      properties: {
        label: feature.properties?.["elevation"] != null ? `${feature.properties["elevation"]}m contour` : "Contour",
        elevation: feature.properties?.["elevation"] ?? null,
      },
      geometry,
    }];
  });
  return { type: "FeatureCollection", features };
}

/** Pull an elevation value from arbitrary ArcGIS contour attributes (schemas vary by service). */
function pickContourElevation(attrs: Record<string, unknown>): number | null {
  const preferred = ["ELEVATION", "ELEV", "CONTOUR", "CONTOURVAL", "VALUE", "HEIGHT", "AMSL", "ALTITUDE", "Z"];
  for (const key of preferred) {
    const v = attrs[key];
    if (v != null && Number.isFinite(Number(v))) return Number(v);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (/elev|contour|height|amsl|altit/i.test(k) && v != null && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function arcgisContoursToGeoJson(features: ArcGisFeature[]): GeoJsonFeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.flatMap((feature): GeoJsonFeature[] => {
      const geometry = arcgisGeometryToGeoJson(feature.geometry);
      if (!geometry || (geometry.type !== "LineString" && geometry.type !== "MultiLineString")) return [];
      const elevation = pickContourElevation(feature.attributes ?? {});
      return [{
        type: "Feature",
        properties: {
          label: elevation != null ? `${elevation}m contour` : "Contour",
          elevation: elevation ?? null,
        },
        geometry,
      }];
    }),
  };
}

function makeContourLayer(geojson: GeoJsonFeatureCollection, legendLabel: string): SitePlanLayer {
  return {
    id: "contours",
    label: "Contours",
    group: "contours",
    defaultVisible: true,
    available: true,
    style: {
      // Thin solid stroke reads better than dashes when lines are dense (fine intervals).
      stroke: CONTOUR_COLOR,
      strokeWidth: 0.9,
      strokeOpacity: 0.72,
    },
    legend: [{ label: legendLabel, color: CONTOUR_COLOR, kind: "line" }],
    geojson,
  };
}

/** LINZ national 20m topo contours (WFS) — fallback outside Auckland. */
async function linzContourLayer(bounds: SitePlanBounds): Promise<SitePlanLayer> {
  const key = process.env["LINZ_API_KEY"]?.trim();
  if (!key) return unavailableLayer("contours", "Contours", "contours", CONTOUR_COLOR);
  const contourBounds = paddedBounds(bounds, 220, 560);
  const bbox = `${contourBounds.minLng},${contourBounds.minLat},${contourBounds.maxLng},${contourBounds.maxLat},EPSG:4326`;
  const url =
    `https://data.linz.govt.nz/services;key=${key}/wfs` +
    `?service=WFS&version=2.0.0&request=GetFeature` +
    `&typeNames=${LINZ_CONTOURS_LAYER}` +
    `&bbox=${encodeURIComponent(bbox)}` +
    `&srsName=EPSG:4326&maxFeatures=160&outputFormat=application%2Fjson`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!resp.ok) return unavailableLayer("contours", "Contours", "contours", CONTOUR_COLOR);
    const geojson = featureCollectionFromLinzContours(await resp.json());
    if (geojson.features.length === 0) return unavailableLayer("contours", "Contours", "contours", CONTOUR_COLOR);
    return makeContourLayer(geojson, "Contour lines (20m)");
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "site-plan: LINZ contour lookup failed");
    return unavailableLayer("contours", "Contours", "contours", CONTOUR_COLOR);
  }
}

/**
 * Fine LiDAR contours (0.5m default) from Auckland Council, falling back through coarser AC
 * intervals, then to LINZ national 20m contours outside Auckland.
 */
async function contourLayer(bounds: SitePlanBounds): Promise<SitePlanLayer> {
  const contourBounds = paddedBounds(bounds, 220, 560);
  const geometry = envelopeGeometry(contourBounds);
  for (const candidate of AUCKLAND_CONTOUR_LAYERS) {
    try {
      const features = await queryArcGisFeatures({
        serviceUrl: AUCKLAND_CONTOURS,
        layerId: candidate.id,
        geometry: geometry.geometry,
        geometryType: geometry.geometryType,
        maxFeatures: 1200,
        timeoutMs: 9000,
      });
      const geojson = arcgisContoursToGeoJson(features);
      if (geojson.features.length > 0) {
        return makeContourLayer(geojson, `Contour lines (${candidate.interval})`);
      }
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, layerId: candidate.id },
        "site-plan: Auckland contour lookup failed (trying next interval)",
      );
    }
  }
  return linzContourLayer(bounds);
}

function boundsRadiusMetres(bounds: SitePlanBounds): number {
  const center = boundsCenter(bounds);
  const latSpan = (bounds.maxLat - bounds.minLat) * 111_320;
  const lngSpan = (bounds.maxLng - bounds.minLng) * 111_320 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180));
  return Math.ceil(Math.max(latSpan, lngSpan) / 2);
}

export interface GeoHint {
  lat: number;
  lng: number;
}

/** Thrown when a site plan cannot be built because no coordinates are available at all. */
export class SitePlanNoLocationError extends Error {
  constructor(address: string) {
    super(`Site plan has no usable coordinates for "${address}"`);
    this.name = "SitePlanNoLocationError";
  }
}

function validGeo(geo: { lat: number; lng: number } | null | undefined): geo is GeoResult {
  return Boolean(geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng));
}

function geoFromHint(address: string, hint: GeoHint): GeoResult {
  return { lat: hint.lat, lng: hint.lng, formatted: address, suburb: null };
}

async function resolveGeo(
  address: string,
  cachedRaw?: RawPropertyData | null,
  geoHint?: GeoHint | null,
): Promise<GeoResult> {
  // Prefer coordinates the analysis already resolved — avoids a flaky live re-geocode.
  if (validGeo(cachedRaw?.geocode)) return cachedRaw.geocode;
  if (geoHint && validGeo(geoHint)) return geoFromHint(address, geoHint);
  try {
    return await geocodeAddress(address);
  } catch (err) {
    if (geoHint && validGeo(geoHint)) return geoFromHint(address, geoHint);
    logger.warn({ err: (err as Error).message, address }, "site-plan: geocode failed and no coordinate hint available");
    throw new SitePlanNoLocationError(address);
  }
}

async function resolveParcel(geo: GeoResult, cachedRaw?: RawPropertyData | null): Promise<LinzParcel | null> {
  if (cachedRaw?.linz_parcel) return cachedRaw.linz_parcel;
  return fetchLINZParcel(geo.lat, geo.lng).catch((err) => {
    logger.warn({ err: (err as Error).message }, "site-plan: LINZ parcel lookup failed");
    return null;
  });
}

export async function buildSitePlanForAddress(
  address: string,
  cachedRaw?: RawPropertyData | null,
  geoHint?: GeoHint | null,
): Promise<SitePlanResponse> {
  const geo = await resolveGeo(address, cachedRaw, geoHint);
  const parcel = await resolveParcel(geo, cachedRaw);
  const coreBounds = boundsFromParcel(parcel) ?? fallbackBoundsFromCenter(geo.lat, geo.lng);
  const mapBounds = sitePlanMapBounds(coreBounds);
  const center = parcel?.bbox ? boundsCenter(parcel.bbox) : { lat: geo.lat, lng: geo.lng };
  // Fetch parcels over a much larger extent than the display box so the visible (and
  // pannable) area is fully populated with neighbouring lots and immediate neighbours are
  // never truncated. The display bounds (sitePlanMapBounds) are intentionally left unchanged
  // so the on-screen scrollable extent stays the same — only the fetched data coverage grows.
  const nearbyRadiusM = Math.max(240, Math.min(1500, Math.ceil(boundsRadiusMetres(mapBounds) * 3)));

  const [image, nearbyParcels, planning, services, contours] = await Promise.all([
    Promise.resolve(buildAerialTileGrid(mapBounds)),
    fetchLINZParcelsNear(center.lat, center.lng, nearbyRadiusM, 400).catch((err) => {
      logger.warn({ err: (err as Error).message }, "site-plan: LINZ nearby parcel lookup failed");
      return null;
    }),
    planningOverlayLayers(geo.lat, geo.lng, parcel?.bbox ?? null).catch((err) => {
      logger.warn({ err: (err as Error).message }, "site-plan: Auckland planning overlay lookup failed");
      return [] as SitePlanLayer[];
    }),
    serviceLayers(coreBounds).catch((err) => {
      logger.warn({ err: (err as Error).message }, "site-plan: Auckland service lookup failed");
      return SERVICE_LAYER_DEFS.map((def) => unavailableLayer(def.id, def.label, "services", def.color));
    }),
    contourLayer(coreBounds),
  ]);

  return {
    image,
    center,
    layers: [
      nearbyBoundaryLayer(nearbyParcels, parcel),
      boundaryLayer(parcel),
      ...planning,
      ...services,
      contours,
    ],
  };
}

async function buildNationalSitePlanForGeo(
  geo: GeoResult,
  cachedRaw?: RawPropertyData | null,
  providerId?: PlanningProviderId,
): Promise<SitePlanResponse> {
  const parcel = await resolveParcel(geo, cachedRaw);
  const coreBounds = boundsFromParcel(parcel) ?? fallbackBoundsFromCenter(geo.lat, geo.lng);
  const mapBounds = sitePlanMapBounds(coreBounds);
  const center = parcel?.bbox ? boundsCenter(parcel.bbox) : { lat: geo.lat, lng: geo.lng };
  const nearbyRadiusM = Math.max(240, Math.min(1500, Math.ceil(boundsRadiusMetres(mapBounds) * 3)));

  const [image, nearbyParcels, planning, services, contours] = await Promise.all([
    Promise.resolve(buildAerialTileGrid(mapBounds)),
    fetchLINZParcelsNear(center.lat, center.lng, nearbyRadiusM, 400).catch((err) => {
      logger.warn({ err: (err as Error).message }, "site-plan: LINZ nearby parcel lookup failed");
      return null;
    }),
    providerId
      ? regionalPlanningOverlayLayers(providerId, geo, parcel?.bbox ?? null, coreBounds).catch((err) => {
          logger.warn({ err: (err as Error).message, providerId }, "site-plan: regional planning overlay lookup failed");
          return [] as SitePlanLayer[];
        })
      : Promise.resolve([] as SitePlanLayer[]),
    providerId
      ? regionalServiceLayers(coreBounds, providerId).catch((err) => {
          logger.warn({ err: (err as Error).message, providerId }, "site-plan: regional service lookup failed");
          return [] as SitePlanLayer[];
        })
      : Promise.resolve([] as SitePlanLayer[]),
    linzContourLayer(coreBounds),
  ]);

  return {
    image,
    center,
    layers: [
      nearbyBoundaryLayer(nearbyParcels, parcel),
      boundaryLayer(parcel),
      ...planning,
      ...services,
      contours,
    ],
  };
}

export async function buildSitePlanForReport(
  address: string,
  cachedRaw?: RawPropertyData | null,
  geoHint?: GeoHint | null,
): Promise<SitePlanResponse> {
  if (!regionalPlanningProvidersEnabled()) {
    return buildSitePlanForAddress(address, cachedRaw, geoHint);
  }

  const geo = await resolveGeo(address, cachedRaw, geoHint);
  const jurisdiction = resolvePlanningJurisdiction({ address, lat: geo.lat, lng: geo.lng });
  if (jurisdiction.providerId === "auckland-legacy") {
    return buildSitePlanForAddress(address, cachedRaw, geo);
  }

  return buildNationalSitePlanForGeo(geo, cachedRaw, jurisdiction.providerId);
}

export function layerHasFeatures(layer: SitePlanLayer): boolean {
  return layer.geojson.features.length > 0;
}

export { EMPTY_GEOJSON };
