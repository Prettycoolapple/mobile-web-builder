import { logger } from "./logger";
import { geocodeAddress, type GeoResult } from "./geocode";
import { fetchLINZParcel, fetchLINZParcelsNear, type LinzParcel, type ParcelBbox } from "./linz";
import type { RawPropertyData } from "./pipeline";

type SharpFactory = typeof import("sharp");

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

export interface SitePlanImage {
  dataUri: string;
  width: number;
  height: number;
  bounds: SitePlanBounds;
  attribution: string;
  available: boolean;
  source: "linz-basemaps" | "placeholder";
}

export type SitePlanLayerGroup = "boundary" | "planning" | "services" | "contours";

export interface SitePlanLayerStyle {
  stroke: string;
  strokeWidth: number;
  strokeOpacity?: number;
  fill?: string;
  fillOpacity?: number;
  dashArray?: number[];
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
const NEIGHBOURHOOD_CONTEXT_PAD_M = 90;
const NEIGHBOURHOOD_CONTEXT_MIN_SPAN_M = 300;
const AUCKLAND_MANAGEMENT_LAYERS =
  "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/UnitaryPlanManagementLayers/MapServer";
const AUCKLAND_UNDERGROUND_SERVICES =
  "https://mapspublic.aucklandcouncil.govt.nz/arcgis/rest/services/LiveMaps/UndergroundServices/MapServer";
const LINZ_CONTOURS_LAYER = "layer-50768";
const EMPTY_GEOJSON: GeoJsonFeatureCollection = { type: "FeatureCollection", features: [] };
const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

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

let sharpModulePromise: Promise<SharpFactory | null> | undefined;

async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModulePromise === undefined) {
    sharpModulePromise = import("sharp")
      .then((mod) => mod.default)
      .catch((err) => {
        logger.warn({ err: (err as Error).message }, "site-plan: sharp unavailable; aerial image will use placeholder");
        return null;
      });
  }
  return sharpModulePromise;
}

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

function linzBasemapsKey(): string | null {
  return process.env["LINZ_BASEMAPS_API_KEY"]?.trim() || process.env["LINZ_API_KEY"]?.trim() || null;
}

let aerialTileFailureLogged = false;

async function fetchTile(url: string): Promise<Buffer | null> {
  try {
    const resp = await fetch(url, {
      headers: { Accept: "image/webp,image/png,image/*" },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) {
      if (!aerialTileFailureLogged) {
        aerialTileFailureLogged = true;
        // A 401/403 here almost always means the LINZ Basemaps tile API rejected the key —
        // basemaps.linz.govt.nz needs a Basemaps-scoped key, NOT a data.linz.govt.nz key.
        logger.warn(
          { status: resp.status, url: url.replace(/api=[^&]+/, "api=***") },
          "site-plan: LINZ aerial tile request failed (check LINZ_BASEMAPS_API_KEY)",
        );
      }
      return null;
    }
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    if (!aerialTileFailureLogged) {
      aerialTileFailureLogged = true;
      logger.warn({ err: (err as Error).message }, "site-plan: LINZ aerial tile fetch threw");
    }
    return null;
  }
}

async function fetchLinzAerialTile(key: string, zoom: number, x: number, y: number): Promise<Buffer | null> {
  const formats = ["webp", "png", "jpeg"];
  for (const format of formats) {
    const url =
      `https://basemaps.linz.govt.nz/v1/tiles/aerial/WebMercatorQuad/${zoom}/${x}/${y}.${format}` +
      `?api=${encodeURIComponent(key)}`;
    const tile = await fetchTile(url);
    if (tile) return tile;
  }
  return null;
}

async function placeholderImage(bounds: SitePlanBounds, width = 768, height = 768): Promise<SitePlanImage> {
  const sharp = await loadSharp();
  if (!sharp) {
    return {
      dataUri: ONE_PIXEL_PNG,
      width,
      height,
      bounds,
      attribution: "LINZ Basemaps unavailable",
      available: false,
      source: "placeholder",
    };
  }

  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 238, g: 235, b: 229 },
    },
  })
    .jpeg({ quality: 72 })
    .toBuffer();
  return {
    dataUri: `data:image/jpeg;base64,${buffer.toString("base64")}`,
    width,
    height,
    bounds,
    attribution: "LINZ Basemaps unavailable",
    available: false,
    source: "placeholder",
  };
}

async function fetchLinzAerialImage(bounds: SitePlanBounds): Promise<SitePlanImage> {
  const key = linzBasemapsKey();
  const range = selectLinzAerialTileRange(bounds);
  const width = range.widthTiles * TILE_SIZE;
  const height = range.heightTiles * TILE_SIZE;
  if (!key) {
    logger.warn("site-plan: no LINZ Basemaps key (set LINZ_BASEMAPS_API_KEY) — using placeholder");
    return placeholderImage(range.bounds, width, height);
  }

  const sharp = await loadSharp();
  if (!sharp) {
    logger.warn("site-plan: sharp unavailable in runtime — aerial cannot be composed, using placeholder");
    return placeholderImage(range.bounds, width, height);
  }

  try {
    const tilePromises: Array<Promise<{ input: Buffer; left: number; top: number } | null>> = [];
    for (let x = range.minX; x <= range.maxX; x += 1) {
      for (let y = range.minY; y <= range.maxY; y += 1) {
        tilePromises.push(
          fetchLinzAerialTile(key, range.zoom, x, y).then((input) => {
            if (!input) return null;
            return {
              input,
              left: (x - range.minX) * TILE_SIZE,
              top: (y - range.minY) * TILE_SIZE,
            };
          }),
        );
      }
    }

    const tiles = (await Promise.all(tilePromises)).filter(
      (tile): tile is { input: Buffer; left: number; top: number } => tile !== null,
    );
    if (tiles.length === 0) {
      logger.warn(
        { zoom: range.zoom, tilesRequested: tilePromises.length },
        "site-plan: all LINZ aerial tiles failed to fetch — using placeholder",
      );
      return placeholderImage(range.bounds, width, height);
    }

    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 238, g: 235, b: 229 },
      },
    })
      .composite(tiles)
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    return {
      dataUri: `data:image/jpeg;base64,${buffer.toString("base64")}`,
      width,
      height,
      bounds: range.bounds,
      attribution: "Aerial imagery: LINZ Basemaps",
      available: true,
      source: "linz-basemaps",
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "site-plan: LINZ aerial composition failed");
    return placeholderImage(range.bounds, width, height);
  }
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
      const color = def.isControl ? "#0284C7" : "#B45309";
      return {
        id: `planning-overlay-${def.layerId}`,
        label: def.name,
        group: "planning" as const,
        defaultVisible: true,
        available: true,
        style: {
          stroke: color,
          strokeWidth: 2,
          strokeOpacity: 0.9,
          fill: color,
          fillOpacity: def.isControl ? 0.11 : 0.16,
          dashArray: def.isControl ? [8, 6] : undefined,
        },
        legend: [{ label: def.name, color, kind: "polygon" as const }],
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
        defaultVisible: true,
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

async function contourLayer(bounds: SitePlanBounds): Promise<SitePlanLayer> {
  const key = process.env["LINZ_API_KEY"]?.trim();
  const color = "#475569";
  if (!key) return unavailableLayer("contours", "Contours", "contours", color);
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
    if (!resp.ok) return unavailableLayer("contours", "Contours", "contours", color);
    const geojson = featureCollectionFromLinzContours(await resp.json());
    if (geojson.features.length === 0) return unavailableLayer("contours", "Contours", "contours", color);
    return {
      id: "contours",
      label: "Contours",
      group: "contours",
      defaultVisible: true,
      available: true,
      style: {
        stroke: color,
        strokeWidth: 1.5,
        strokeOpacity: 0.76,
        dashArray: [6, 5],
      },
      legend: [{ label: "Contour lines", color, kind: "line" }],
      geojson,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "site-plan: LINZ contour lookup failed");
    return unavailableLayer("contours", "Contours", "contours", color);
  }
}

function boundsRadiusMetres(bounds: SitePlanBounds): number {
  const center = boundsCenter(bounds);
  const latSpan = (bounds.maxLat - bounds.minLat) * 111_320;
  const lngSpan = (bounds.maxLng - bounds.minLng) * 111_320 * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180));
  return Math.ceil(Math.max(latSpan, lngSpan) / 2);
}

function validGeo(geo: GeoResult | null | undefined): geo is GeoResult {
  return Boolean(geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng));
}

async function resolveGeo(address: string, cachedRaw?: RawPropertyData | null): Promise<GeoResult> {
  if (validGeo(cachedRaw?.geocode)) return cachedRaw.geocode;
  return geocodeAddress(address);
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
): Promise<SitePlanResponse> {
  const geo = await resolveGeo(address, cachedRaw);
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
    fetchLinzAerialImage(mapBounds),
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

export function layerHasFeatures(layer: SitePlanLayer): boolean {
  return layer.geojson.features.length > 0;
}

export { EMPTY_GEOJSON };
