type Coordinate = [number, number];

type GeoJsonGeometry =
  | { type: "Point"; coordinates: Coordinate }
  | { type: "LineString"; coordinates: Coordinate[] }
  | { type: "MultiLineString"; coordinates: Coordinate[][] }
  | { type: "Polygon"; coordinates: Coordinate[][] }
  | { type: "MultiPolygon"; coordinates: Coordinate[][][] };

type GeoJsonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

type SitePlanBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

export type SitePlanLayer = {
  id: string;
  label: string;
  group: "boundary" | "planning" | "services" | "contours";
  defaultVisible: boolean;
  available: boolean;
  style: {
    stroke: string;
    strokeWidth: number;
    strokeOpacity?: number;
    fill?: string;
    fillOpacity?: number;
    dashArray?: number[];
  };
  legend: Array<{ label: string; color: string; kind: "line" | "polygon" | "point" }>;
  geojson: GeoJsonFeatureCollection;
};

export type SitePlanAerialTile = { z: number; x: number; y: number; left: number; top: number };

export type SitePlanResponse = {
  image: {
    dataUri: string;
    width: number;
    height: number;
    bounds: SitePlanBounds;
    attribution: string;
    available: boolean;
    source: "linz-basemaps" | "placeholder";
    tileSize?: number;
    tiles?: SitePlanAerialTile[];
  };
  center: { lat: number; lng: number };
  layers: SitePlanLayer[];
};

function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / Math.max(1e-9, 1 - sin)) / (4 * Math.PI);
}

function projectCoordinate(coord: Coordinate, bounds: SitePlanBounds, width: number, height: number): Coordinate {
  const [lng, lat] = coord;
  const west = mercatorX(bounds.minLng);
  const east = mercatorX(bounds.maxLng);
  const north = mercatorY(bounds.maxLat);
  const south = mercatorY(bounds.minLat);
  const x = ((mercatorX(lng) - west) / Math.max(1e-9, east - west)) * width;
  const y = ((mercatorY(lat) - north) / Math.max(1e-9, south - north)) * height;
  return [x, y];
}

function collectCoordinates(features: GeoJsonFeature[]): Coordinate[] {
  const out: Coordinate[] = [];
  const pushRing = (ring: Coordinate[]) => {
    for (const c of ring) if (Array.isArray(c) && c.length >= 2) out.push(c);
  };
  for (const feature of features) {
    const g = feature.geometry;
    if (g.type === "Point") out.push(g.coordinates);
    else if (g.type === "LineString") pushRing(g.coordinates);
    else if (g.type === "MultiLineString") g.coordinates.forEach(pushRing);
    else if (g.type === "Polygon") g.coordinates.forEach(pushRing);
    else if (g.type === "MultiPolygon") g.coordinates.forEach((poly) => poly.forEach(pushRing));
  }
  return out;
}

function imageUrlForTile(tile: SitePlanAerialTile): string {
  return `/api/tiles/aerial/${tile.z}/${tile.x}/${tile.y}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function withAlpha(ctx: CanvasRenderingContext2D, alpha: number | undefined, draw: () => void) {
  const previous = ctx.globalAlpha;
  ctx.globalAlpha = alpha ?? 1;
  draw();
  ctx.globalAlpha = previous;
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  coords: Coordinate[],
  layer: SitePlanLayer,
  data: SitePlanResponse,
) {
  if (coords.length < 2) return;
  ctx.beginPath();
  coords.forEach((coord, index) => {
    const [x, y] = projectCoordinate(coord, data.image.bounds, data.image.width, data.image.height);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = layer.style.stroke;
  ctx.lineWidth = layer.style.strokeWidth;
  ctx.globalAlpha = layer.style.strokeOpacity ?? 1;
  ctx.setLineDash(layer.style.dashArray ?? []);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawPolygon(
  ctx: CanvasRenderingContext2D,
  rings: Coordinate[][],
  layer: SitePlanLayer,
  data: SitePlanResponse,
) {
  const exterior = rings[0];
  if (!exterior || exterior.length < 3) return;
  ctx.beginPath();
  exterior.forEach((coord, index) => {
    const [x, y] = projectCoordinate(coord, data.image.bounds, data.image.width, data.image.height);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = layer.style.fill ?? layer.style.stroke;
  withAlpha(ctx, layer.style.fillOpacity ?? 0.12, () => ctx.fill());
  ctx.strokeStyle = layer.style.stroke;
  ctx.lineWidth = layer.style.strokeWidth;
  withAlpha(ctx, layer.style.strokeOpacity ?? 1, () => ctx.stroke());
}

function drawFeature(
  ctx: CanvasRenderingContext2D,
  feature: GeoJsonFeature,
  layer: SitePlanLayer,
  data: SitePlanResponse,
) {
  const g = feature.geometry;
  if (g.type === "Point") {
    const [x, y] = projectCoordinate(g.coordinates, data.image.bounds, data.image.width, data.image.height);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(5, layer.style.strokeWidth * 2), 0, Math.PI * 2);
    ctx.fillStyle = layer.style.stroke;
    withAlpha(ctx, 0.86, () => ctx.fill());
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (g.type === "LineString") {
    drawLine(ctx, g.coordinates, layer, data);
  } else if (g.type === "MultiLineString") {
    g.coordinates.forEach((line) => drawLine(ctx, line, layer, data));
  } else if (g.type === "Polygon") {
    drawPolygon(ctx, g.coordinates, layer, data);
  } else {
    g.coordinates.forEach((polygon) => drawPolygon(ctx, polygon, layer, data));
  }
}

function drawServiceNodes(ctx: CanvasRenderingContext2D, layer: SitePlanLayer, data: SitePlanResponse) {
  if (layer.group !== "services") return;
  const endpoints: Coordinate[] = [];
  const pushEnds = (line: Coordinate[]) => {
    if (line.length === 0) return;
    endpoints.push(line[0]!);
    endpoints.push(line[line.length - 1]!);
  };
  for (const feature of layer.geojson.features) {
    const g = feature.geometry;
    if (g.type === "LineString") pushEnds(g.coordinates);
    else if (g.type === "MultiLineString") g.coordinates.forEach(pushEnds);
  }
  const seen = new Set<string>();
  for (const coord of endpoints) {
    const [x, y] = projectCoordinate(coord, data.image.bounds, data.image.width, data.image.height);
    const key = `${Math.round(x / 5)}:${Math.round(y / 5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = layer.style.stroke;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
}

function parcelCrop(data: SitePlanResponse, outputWidth: number, outputHeight: number) {
  const boundary = data.layers.find((layer) => layer.id === "boundary");
  const coords = boundary ? collectCoordinates(boundary.geojson.features) : [];
  const pixels = coords.map((coord) => projectCoordinate(coord, data.image.bounds, data.image.width, data.image.height));

  if (pixels.length === 0) {
    const aspect = outputWidth / outputHeight;
    const width = data.image.width;
    const height = width / aspect;
    return {
      x: 0,
      y: Math.max(0, (data.image.height - height) / 2),
      width,
      height: Math.min(data.image.height, height),
    };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pixels) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const parcelW = Math.max(1, maxX - minX);
  const parcelH = Math.max(1, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const targetFill = 0.58;
  let cropW = parcelW / targetFill;
  let cropH = parcelH / targetFill;
  const targetAspect = outputWidth / outputHeight;
  if (cropW / cropH > targetAspect) cropH = cropW / targetAspect;
  else cropW = cropH * targetAspect;

  cropW = Math.min(data.image.width, Math.max(cropW, data.image.width * 0.22));
  cropH = Math.min(data.image.height, Math.max(cropH, data.image.height * 0.22));
  return {
    x: Math.max(0, Math.min(data.image.width - cropW, centerX - cropW / 2)),
    y: Math.max(0, Math.min(data.image.height - cropH, centerY - cropH / 2)),
    width: cropW,
    height: cropH,
  };
}

export type SitePlanLegendEntry = { label: string; color: string; kind: "line" | "polygon" | "point" };

/**
 * Legend entries for the layers actually drawn into the snapshot — every available layer that has
 * features (parcel boundary, nearby boundaries, contours, plus any planning overlays / services).
 * Consumed by the white-label PDF so the exported site plan carries the same legend as the card.
 */
export function sitePlanLegendEntries(data: SitePlanResponse): SitePlanLegendEntry[] {
  return data.layers
    .filter((layer) => layer.available && layer.geojson.features.length > 0)
    .map((layer) => {
      const item = layer.legend[0];
      return {
        label: item?.label ?? layer.label,
        color: item?.color ?? layer.style.stroke,
        kind: item?.kind ?? (layer.group === "services" || layer.group === "contours" ? "line" : "polygon"),
      };
    });
}

export async function renderSitePlanSnapshot(data: SitePlanResponse): Promise<string> {
  const outputWidth = 1600;
  const outputHeight = 980;
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create site plan canvas");

  ctx.fillStyle = "#d9d1c5";
  ctx.fillRect(0, 0, outputWidth, outputHeight);

  const crop = parcelCrop(data, outputWidth, outputHeight);
  const scale = Math.min(outputWidth / crop.width, outputHeight / crop.height);
  const offsetX = (outputWidth - crop.width * scale) / 2;
  const offsetY = (outputHeight - crop.height * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.translate(-crop.x, -crop.y);

  if (data.image.source === "linz-basemaps" && data.image.tiles?.length) {
    const loaded = await Promise.all(data.image.tiles.map(async (tile) => ({ tile, image: await loadImage(imageUrlForTile(tile)) })));
    const tileSize = data.image.tileSize ?? 256;
    for (const { tile, image } of loaded) {
      if (!image) continue;
      // Draw tiles fully opaque with a 1px overlap so no seam/gap shows between them (the
      // white wash below keeps the vector linework legible). A sub-1 alpha here would draw
      // darker lines along the overlaps. Matches the interactive card's tile rendering.
      ctx.drawImage(image, tile.left, tile.top, tileSize + 1, tileSize + 1);
    }
  } else if (data.image.dataUri) {
    const image = await loadImage(data.image.dataUri);
    if (image) ctx.drawImage(image, 0, 0, data.image.width, data.image.height);
  }

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, data.image.width, data.image.height);

  const layers = data.layers.filter((layer) => layer.available);
  for (const layer of layers) {
    for (const feature of layer.geojson.features) drawFeature(ctx, feature, layer, data);
  }
  for (const layer of layers) drawServiceNodes(ctx, layer, data);
  ctx.restore();

  return canvas.toDataURL("image/png", 0.92);
}
