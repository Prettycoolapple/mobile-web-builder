import { useEffect, useMemo, useState } from "react";
import type { FeasibilityReport } from "@/state/chat-model";
import { apiGet } from "@/lib/api";
import type { SitePlanAerialTile, SitePlanLayer, SitePlanResponse } from "@/lib/sitePlanSnapshot";

const ALWAYS_ON_LAYERS = new Set(["boundary", "nearby-boundaries"]);

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

function pointsString(coords: Coordinate[], bounds: SitePlanBounds, width: number, height: number): string {
  return coords
    .map((coord) => projectCoordinate(coord, bounds, width, height))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
}

function layerColor(layer: SitePlanLayer): string {
  return layer.legend[0]?.color ?? layer.style.stroke;
}

function isLineLayer(layer: SitePlanLayer): boolean {
  return layer.group === "services" || layer.group === "contours";
}

function layerDisplayLabel(layer: SitePlanLayer): string {
  if (layer.id === "nearby-boundaries") return "Nearby boundaries";
  if (layer.id === "service-stormwater") return "Stormwater";
  if (layer.id === "service-wastewater") return "Wastewater";
  if (layer.id === "service-water") return "Water supply";
  if (layer.id === "contours") return "Contours";
  return layer.label;
}

function aerialTileUrl(tile: SitePlanAerialTile): string {
  return `/api/tiles/aerial/${tile.z}/${tile.x}/${tile.y}`;
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
    return (
      <circle
        key={`${layer.id}-${featureIndex}`}
        cx={cx}
        cy={cy}
        r={Math.max(5, layer.style.strokeWidth * 2)}
        fill={layer.style.stroke}
        fillOpacity={0.86}
        stroke="#fff"
        strokeWidth={1.5}
      />
    );
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

function LayerToggleRow({
  layer,
  visible,
  onToggle,
}: {
  layer: SitePlanLayer;
  visible: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  const color = layerColor(layer);
  const disabled = !layer.available;
  return (
    <label className={`site-plan-legend-row${disabled ? " disabled" : ""}`}>
      <span className="site-plan-legend-label">
        <span
          className={`site-plan-swatch${isLineLayer(layer) ? " line" : ""}`}
          style={{ borderColor: color, backgroundColor: isLineLayer(layer) ? "transparent" : `${color}30` }}
        >
          {isLineLayer(layer) && <span style={{ backgroundColor: color }} />}
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
  const [data, setData] = useState<SitePlanResponse | null>(null);
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSoon, setShowSoon] = useState(false);

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
  const legendLayers = useMemo(() => data?.layers.filter((layer) => !ALWAYS_ON_LAYERS.has(layer.id)) ?? [], [data]);

  const toggleLayer = (id: string, next: boolean) => {
    setVisibleLayers((current) => ({ ...current, [id]: next }));
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

      <div className="site-plan-map">
        {status === "loading" || status === "idle" ? (
          <div className="site-plan-empty">Loading site plan...</div>
        ) : status === "error" ? (
          <div className="site-plan-empty">
            <strong>Site plan could not load.</strong>
            <span>{error}</span>
          </div>
        ) : data ? (
          <div className="site-plan-canvas" style={{ aspectRatio: `${data.image.width} / ${data.image.height}` }}>
            {data.image.source === "linz-basemaps" && data.image.tiles?.length ? (
              data.image.tiles.map((tile) => (
                <img
                  key={`${tile.z}/${tile.x}/${tile.y}`}
                  src={aerialTileUrl(tile)}
                  alt=""
                  className="site-plan-tile"
                  style={{
                    left: `${(tile.left / data.image.width) * 100}%`,
                    top: `${(tile.top / data.image.height) * 100}%`,
                    width: `${((data.image.tileSize ?? 256) / data.image.width) * 100}%`,
                    height: `${((data.image.tileSize ?? 256) / data.image.height) * 100}%`,
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
            <div className="site-plan-attribution">{data.image.attribution}</div>
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
