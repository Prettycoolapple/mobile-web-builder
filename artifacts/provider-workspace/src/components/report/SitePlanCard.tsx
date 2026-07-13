import { useEffect, useMemo, useRef, useState } from "react";
import type { FeasibilityReport } from "@/state/chat-model";
import { apiGet } from "@/lib/api";
import type { SitePlanAerialTile, SitePlanLayer, SitePlanResponse } from "@/lib/sitePlanSnapshot";

const ALWAYS_ON_LAYERS = new Set(["boundary", "nearby-boundaries"]);
const MIN_MAP_SCALE = 1;
const MAX_MAP_SCALE = 6;
const PARCEL_TARGET_FILL = 0.58;
const TILE_SEAM_OVERLAP_PX = 1;

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
type SitePlanMarkerShape = "circle" | "triangle" | "square";

function mercatorX(lng: number): number {
  return (lng + 180) / 360;
}

function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
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

function clampMapTranslation(value: number, contentSize: number, viewportSize: number): number {
  const limit = Math.max(0, (contentSize - viewportSize) / 2);
  return Math.min(limit, Math.max(-limit, value));
}

function pointsString(coords: Coordinate[], bounds: SitePlanBounds, width: number, height: number): string {
  return coords
    .map((coord) => projectCoordinate(coord, bounds, width, height))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

function collectCoordinates(features: GeoJsonFeature[]): Coordinate[] {
  const out: Coordinate[] = [];
  const pushLine = (line: Coordinate[]) => {
    for (const coord of line) {
      if (Array.isArray(coord) && coord.length >= 2) out.push(coord);
    }
  };
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry.type === "Point") out.push(geometry.coordinates);
    else if (geometry.type === "LineString") pushLine(geometry.coordinates);
    else if (geometry.type === "MultiLineString") geometry.coordinates.forEach(pushLine);
    else if (geometry.type === "Polygon") geometry.coordinates.forEach(pushLine);
    else if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => polygon.forEach(pushLine));
  }
  return out;
}

function layerColor(layer: SitePlanLayer): string {
  return layer.legend[0]?.color ?? layer.style.stroke;
}

function isLineLayer(layer: SitePlanLayer): boolean {
  return layer.group === "services" || layer.group === "contours";
}

function layerLegendKind(layer: SitePlanLayer): "line" | "polygon" | "point" {
  return layer.legend[0]?.kind ?? (isLineLayer(layer) ? "line" : "polygon");
}

function layerMarkerShape(layer: SitePlanLayer): SitePlanMarkerShape {
  return layer.style.markerShape ?? "circle";
}

function layerDisplayLabel(layer: SitePlanLayer): string {
  if (layer.id === "nearby-boundaries") return "Nearby boundaries";
  if (layer.id === "service-stormwater") return "Stormwater";
  if (layer.id === "service-wastewater") return "Wastewater";
  if (layer.id === "service-water") return "Water supply";
  if (layer.id === "contours") return "Contours";
  return layer.label;
}

function trianglePoints(cx: number, cy: number, radius: number): string {
  return `${cx},${cy - radius} ${cx + radius * 0.92},${cy + radius * 0.65} ${cx - radius * 0.92},${cy + radius * 0.65}`;
}

function aerialTileUrl(tile: SitePlanAerialTile): string {
  return `/api/tiles/aerial/${tile.z}/${tile.x}/${tile.y}`;
}

function renderPointMarker(
  layer: SitePlanLayer,
  cx: number,
  cy: number,
  radius: number,
  key: string,
) {
  const common = {
    key,
    fill: layer.style.fill ?? layer.style.stroke,
    fillOpacity: layer.style.fillOpacity ?? 0.86,
    stroke: "#fff",
    strokeWidth: 1.5,
  };
  const shape = layerMarkerShape(layer);
  if (shape === "triangle") {
    return <polygon {...common} points={trianglePoints(cx, cy, radius)} strokeLinejoin="round" />;
  }
  if (shape === "square") {
    const size = radius * 1.55;
    return <rect {...common} x={cx - size / 2} y={cy - size / 2} width={size} height={size} rx={1.5} />;
  }
  return <circle {...common} cx={cx} cy={cy} r={radius} />;
}

function renderLine(
  coords: Coordinate[],
  layer: SitePlanLayer,
  bounds: SitePlanBounds,
  width: number,
  height: number,
  key: string,
) {
  const points = pointsString(coords, bounds, width, height);
  if (!points) return null;
  return (
    <polyline
      key={key}
      points={points}
      fill="none"
      stroke={layer.style.stroke}
      strokeWidth={layer.style.strokeWidth}
      strokeOpacity={layer.style.strokeOpacity ?? 1}
      strokeDasharray={layer.style.dashArray?.join(",")}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function renderPolygon(
  rings: Coordinate[][],
  layer: SitePlanLayer,
  bounds: SitePlanBounds,
  width: number,
  height: number,
  key: string,
) {
  const exterior = rings[0];
  if (!exterior || exterior.length < 3) return null;
  return (
    <polygon
      key={key}
      points={pointsString(exterior, bounds, width, height)}
      fill={layer.style.fill ?? layer.style.stroke}
      fillOpacity={layer.style.fillOpacity ?? 0.12}
      stroke={layer.style.stroke}
      strokeWidth={layer.style.strokeWidth}
      strokeOpacity={layer.style.strokeOpacity ?? 1}
      strokeDasharray={layer.style.dashArray?.join(",")}
      strokeLinejoin="round"
    />
  );
}

function renderFeature(
  feature: GeoJsonFeature,
  layer: SitePlanLayer,
  bounds: SitePlanBounds,
  width: number,
  height: number,
  featureIndex: number,
) {
  const geometry = feature.geometry;
  if (geometry.type === "Point") {
    const [cx, cy] = projectCoordinate(geometry.coordinates, bounds, width, height);
    return renderPointMarker(layer, cx, cy, Math.max(5, layer.style.strokeWidth * 2), `${layer.id}-${featureIndex}`);
  }
  if (geometry.type === "LineString") {
    return renderLine(geometry.coordinates, layer, bounds, width, height, `${layer.id}-${featureIndex}`);
  }
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates.map((line, lineIndex) =>
      renderLine(line, layer, bounds, width, height, `${layer.id}-${featureIndex}-${lineIndex}`),
    );
  }
  if (geometry.type === "Polygon") {
    return renderPolygon(geometry.coordinates, layer, bounds, width, height, `${layer.id}-${featureIndex}`);
  }
  return geometry.coordinates.map((polygon, polygonIndex) =>
    renderPolygon(polygon, layer, bounds, width, height, `${layer.id}-${featureIndex}-${polygonIndex}`),
  );
}

function renderServiceNodes(layer: SitePlanLayer, bounds: SitePlanBounds, width: number, height: number) {
  if (layer.group !== "services") return [];
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
  const nodes: React.ReactNode[] = [];
  endpoints.forEach((coord, index) => {
    const [cx, cy] = projectCoordinate(coord, bounds, width, height);
    const key = `${Math.round(cx / 5)}:${Math.round(cy / 5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    nodes.push(
      <circle
        key={`${layer.id}-node-${index}`}
        cx={cx}
        cy={cy}
        r={4.5}
        fill="#fff"
        fillOpacity={0.96}
        stroke={layer.style.stroke}
        strokeWidth={2.4}
      />,
    );
  });
  return nodes;
}

function LegendGlyph({ layer }: { layer: SitePlanLayer }) {
  const color = layerColor(layer);
  const kind = layerLegendKind(layer);
  const fill = layer.style.fill ?? color;
  const dash = layer.style.dashArray?.join(",");
  if (kind === "line") {
    return (
      <svg className="site-plan-swatch-svg" viewBox="0 0 28 18" aria-hidden="true">
        <line
          x1="3"
          y1="9"
          x2="25"
          y2="9"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={dash}
        />
      </svg>
    );
  }
  if (kind === "point") {
    const shape = layerMarkerShape(layer);
    return (
      <svg className="site-plan-swatch-svg" viewBox="0 0 28 18" aria-hidden="true">
        {shape === "triangle" ? (
          <polygon points={trianglePoints(14, 9, 7)} fill={fill} fillOpacity="0.9" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        ) : shape === "square" ? (
          <rect x="7" y="3" width="14" height="12" rx="2" fill={fill} fillOpacity="0.9" stroke={color} strokeWidth="2" />
        ) : (
          <circle cx="14" cy="9" r="6" fill={fill} fillOpacity="0.9" stroke={color} strokeWidth="2" />
        )}
      </svg>
    );
  }
  return (
    <svg className="site-plan-swatch-svg" viewBox="0 0 28 18" aria-hidden="true">
      <rect
        x="4"
        y="3"
        width="20"
        height="12"
        rx="2"
        fill={fill}
        fillOpacity={layer.style.fillOpacity ?? 0.16}
        stroke={color}
        strokeWidth="2"
        strokeDasharray={dash}
      />
    </svg>
  );
}

function LayerToggleRow({
  layer,
  visible,
  onToggle,
}: {
  layer: SitePlanLayer;
  visible: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  const disabled = !layer.available;
  return (
    <label className={`site-plan-legend-row${disabled ? " disabled" : ""}`}>
      <span className="site-plan-legend-label">
        <span className="site-plan-swatch">
          <LegendGlyph layer={layer} />
        </span>
        <span>
          <span className="site-plan-legend-title">{layerDisplayLabel(layer)}</span>
          {disabled && <span className="site-plan-legend-sub">Unavailable</span>}
        </span>
      </span>
      <input
        type="checkbox"
        checked={visible && layer.available}
        disabled={disabled}
        onChange={(event) => onToggle(layer.id, event.currentTarget.checked)}
      />
    </label>
  );
}

export function SitePlanCard({ report, active }: { report: FeasibilityReport; active: boolean }) {
  const searchId = report.historyId ?? null;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const framedKeyRef = useRef<string | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [data, setData] = useState<SitePlanResponse | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSoon, setShowSoon] = useState(false);
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });

  useEffect(() => {
    setData(null);
    setVisibleLayers({});
    setStatus("idle");
    setError(null);
    framedKeyRef.current = null;
    dragRef.current = null;
    setView({ scale: 1, x: 0, y: 0 });
  }, [searchId, report.address]);

  useEffect(() => {
    if (!active || !searchId || data || status === "loading") return;
    const params = new URLSearchParams();
    if (report.address?.trim()) params.set("address", report.address.trim());
    setStatus("loading");
    setError(null);
    apiGet<SitePlanResponse>(`/analyse/${encodeURIComponent(searchId)}/site-plan${params.size ? `?${params}` : ""}`)
      .then((next) => {
        setData(next);
        const layerVisibility: Record<string, boolean> = {};
        for (const layer of next.layers) {
          layerVisibility[layer.id] = layer.available && layer.defaultVisible;
        }
        setVisibleLayers(layerVisibility);
        setStatus("ready");
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Site plan unavailable");
        setStatus("error");
      });
  }, [active, data, report.address, searchId, status]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setViewportSize((current) => {
        if (rect.width <= 0 || rect.height <= 0) return current;
        if (current && Math.abs(current.width - rect.width) < 1 && Math.abs(current.height - rect.height) < 1) {
          return current;
        }
        return { width: rect.width, height: rect.height };
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    framedKeyRef.current = null;
    setView({ scale: 1, x: 0, y: 0 });
  }, [data?.image.width, data?.image.height, data?.image.bounds.minLat, data?.image.bounds.minLng]);

  useEffect(() => {
    if (!showSoon) return;
    const timeout = setTimeout(() => setShowSoon(false), 2600);
    return () => clearTimeout(timeout);
  }, [showSoon]);

  const visibleVectorLayers = useMemo(
    () =>
      data?.layers.filter(
        (layer) => layer.available && (ALWAYS_ON_LAYERS.has(layer.id) || visibleLayers[layer.id]),
      ) ?? [],
    [data?.layers, visibleLayers],
  );
  const legendLayers = useMemo(
    () => data?.layers.filter(
      (layer) => !ALWAYS_ON_LAYERS.has(layer.id) && layer.available && layer.geojson.features.length > 0,
    ) ?? [],
    [data],
  );
  const baseScale = useMemo(() => {
    if (!data || !viewportSize) return 1;
    return Math.max(viewportSize.width / data.image.width, viewportSize.height / data.image.height);
  }, [data, viewportSize]);

  const toggleLayer = (id: string, next: boolean) => {
    setVisibleLayers((current) => ({ ...current, [id]: next }));
  };

  useEffect(() => {
    if (!data || !viewportSize) return;
    setView((current) => ({
      ...current,
      x: clampMapTranslation(current.x, data.image.width * baseScale * current.scale, viewportSize.width),
      y: clampMapTranslation(current.y, data.image.height * baseScale * current.scale, viewportSize.height),
    }));
  }, [baseScale, data, viewportSize]);

  useEffect(() => {
    if (!data || !viewportSize) return;
    const key = `${searchId ?? "report"}:${data.image.width}:${data.image.height}:${Math.round(viewportSize.width)}:${Math.round(viewportSize.height)}`;
    if (framedKeyRef.current === key) return;

    const boundary = data.layers.find((layer) => layer.id === "boundary");
    const coords = boundary ? collectCoordinates(boundary.geojson.features) : [];
    if (coords.length === 0) {
      framedKeyRef.current = key;
      setView({ scale: 1, x: 0, y: 0 });
      return;
    }

    const pixels = coords.map((coord) => projectCoordinate(coord, data.image.bounds, data.image.width, data.image.height));
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pixels) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }

    const parcelW = Math.max(1, (maxX - minX) * baseScale);
    const parcelH = Math.max(1, (maxY - minY) * baseScale);
    const nextScale = Math.max(
      MIN_MAP_SCALE,
      Math.min(MAX_MAP_SCALE, Math.min((viewportSize.width * PARCEL_TARGET_FILL) / parcelW, (viewportSize.height * PARCEL_TARGET_FILL) / parcelH)),
    );
    const parcelCenterX = (minX + maxX) / 2;
    const parcelCenterY = (minY + maxY) / 2;
    const dx = (parcelCenterX - data.image.width / 2) * baseScale;
    const dy = (parcelCenterY - data.image.height / 2) * baseScale;
    const contentW = data.image.width * baseScale * nextScale;
    const contentH = data.image.height * baseScale * nextScale;

    framedKeyRef.current = key;
    setView({
      scale: nextScale,
      x: clampMapTranslation(-dx * nextScale, contentW, viewportSize.width),
      y: clampMapTranslation(-dy * nextScale, contentH, viewportSize.height),
    });
  }, [baseScale, data, searchId, viewportSize]);

  // Zoom on mouse-wheel while the cursor is over the map. React registers `onWheel` as a passive
  // listener on its root, so `preventDefault()` there is ignored and the page scrolls instead of
  // the map zooming. Attach a native non-passive listener so we can cancel the page scroll and
  // keep the wheel confined to zooming this card. MIN_MAP_SCALE caps zoom-out at the fetched
  // neighbourhood extent (the tile grid only covers the immediate surroundings, never all of NZ).
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !data || !viewportSize) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const pointerX = event.clientX - rect.left - viewportSize.width / 2;
      const pointerY = event.clientY - rect.top - viewportSize.height / 2;
      const zoomFactor = Math.exp(-event.deltaY * 0.0012);
      setView((current) => {
        const nextScale = Math.max(MIN_MAP_SCALE, Math.min(MAX_MAP_SCALE, current.scale * zoomFactor));
        if (Math.abs(nextScale - current.scale) < 0.001) return current;

        const oldTotalScale = baseScale * current.scale;
        const nextTotalScale = baseScale * nextScale;
        const anchorX = (pointerX - current.x) / oldTotalScale;
        const anchorY = (pointerY - current.y) / oldTotalScale;
        const contentW = data.image.width * nextTotalScale;
        const contentH = data.image.height * nextTotalScale;
        const nextX = pointerX - anchorX * nextTotalScale;
        const nextY = pointerY - anchorY * nextTotalScale;

        return {
          scale: nextScale,
          x: clampMapTranslation(nextX, contentW, viewportSize.width),
          y: clampMapTranslation(nextY, contentH, viewportSize.height),
        };
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [baseScale, data, viewportSize]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!data || !viewportSize || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !data || !viewportSize || drag.pointerId !== event.pointerId) return;
    const contentW = data.image.width * baseScale * view.scale;
    const contentH = data.image.height * baseScale * view.scale;
    setView((current) => ({
      ...current,
      x: clampMapTranslation(drag.originX + event.clientX - drag.startX, contentW, viewportSize.width),
      y: clampMapTranslation(drag.originY + event.clientY - drag.startY, contentH, viewportSize.height),
    }));
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  if (!searchId) {
    return (
      <div className="site-plan-card">
        <div className="site-plan-empty">Site plan is unavailable for this report.</div>
      </div>
    );
  }

  return (
    <div className="site-plan-card">
      <div className="site-plan-head">
        <div>
          <div className="site-plan-title">Site plan</div>
          <div className="site-plan-subtitle">Parcel boundary, services, contours, overlays and controls</div>
        </div>
        <div className="site-plan-ai-wrap">
          {showSoon && <div className="site-plan-coming-soon">Coming soon</div>}
          <button className="site-plan-ai-btn" type="button" onClick={() => setShowSoon(true)}>
            AI subdivision
          </button>
        </div>
      </div>

      <div
        ref={viewportRef}
        className="site-plan-map"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        {status === "loading" || status === "idle" ? (
          <div className="site-plan-empty">Loading site plan...</div>
        ) : status === "error" ? (
          <div className="site-plan-empty">
            <strong>Site plan could not load.</strong>
            <span>{error}</span>
          </div>
        ) : data ? (
          <div
            className="site-plan-canvas"
            style={{
              width: data.image.width,
              height: data.image.height,
              left: viewportSize ? (viewportSize.width - data.image.width) / 2 : 0,
              top: viewportSize ? (viewportSize.height - data.image.height) / 2 : 0,
              transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${baseScale * view.scale})`,
            }}
          >
            {data.image.source === "linz-basemaps" && data.image.tiles?.length ? (
              data.image.tiles.map((tile) => (
                <img
                  key={`${tile.z}/${tile.x}/${tile.y}`}
                  src={aerialTileUrl(tile)}
                  alt=""
                  className="site-plan-tile"
                  style={{
                    left: tile.left,
                    top: tile.top,
                    width: (data.image.tileSize ?? 256) + TILE_SEAM_OVERLAP_PX,
                    height: (data.image.tileSize ?? 256) + TILE_SEAM_OVERLAP_PX,
                  }}
                />
              ))
            ) : data.image.dataUri ? (
              <img src={data.image.dataUri} alt="" className="site-plan-base-image" />
            ) : null}
            <div className="site-plan-aerial-scrim" />
            <svg
              className="site-plan-svg"
              viewBox={`0 0 ${data.image.width} ${data.image.height}`}
              preserveAspectRatio="xMidYMid meet"
              aria-label="Analyzed property site plan"
            >
              {visibleVectorLayers.flatMap((layer) =>
                layer.geojson.features.map((feature, featureIndex) =>
                  renderFeature(feature, layer, data.image.bounds, data.image.width, data.image.height, featureIndex),
                ),
              )}
              {visibleVectorLayers.flatMap((layer) =>
                renderServiceNodes(layer, data.image.bounds, data.image.width, data.image.height),
              )}
            </svg>
          </div>
        ) : null}
      </div>

      {data && (
        <div className="site-plan-legend">
          {legendLayers.map((layer) => (
            <LayerToggleRow
              key={layer.id}
              layer={layer}
              visible={Boolean(visibleLayers[layer.id])}
              onToggle={toggleLayer}
            />
          ))}
        </div>
      )}
    </div>
  );
}
