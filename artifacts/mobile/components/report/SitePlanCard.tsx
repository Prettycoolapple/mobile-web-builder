import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  InteractionManager,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, G, Polygon, Polyline } from "react-native-svg";


import { useAuth } from "@/context/AuthContext";
import type { FeasibilityReport as Report } from "@/context/ChatContext";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";
import { translateForOS } from "@/lib/i18n";
import { getApiBase } from "@/lib/api";
import { AiSubdivisionIntroModal } from "@/components/report/AiSubdivisionIntroModal";
import { useRubinHost } from "@/context/RubinHostContext";
import {
  pointsString,
  projectCoordinate,
  type Coordinate,
  type SitePlanBounds,
} from "@/components/report/mapProjection";
import { renderSubdivisionOverlay } from "@/components/report/SubdivisionOverlay";
import { SubdivisionPanel } from "@/components/report/SubdivisionPanel";
import { useSubdivision } from "@/components/report/useSubdivision";

// The subject parcel ("boundary") and the surrounding property boundaries ("nearby-boundaries")
// are always drawn and not user-toggleable — they form the base context for the site plan.
const ALWAYS_ON_LAYERS = new Set(["boundary", "nearby-boundaries"]);
const SITE_PLAN_STALE_TIME_MS = 15 * 60 * 1000;
const SITE_PLAN_GC_TIME_MS = 60 * 60 * 1000;
// Release switch for the Rubin hand-off. On: "Generate layout" and "Visualize
// Subdivision options" open Rubin directly. Off: the intro slides run instead,
// ending on the launch notice. Typed `boolean` so both arms stay live code.
const RUBIN_DIRECT_LAUNCH_ENABLED: boolean = true;

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

type SitePlanLayer = {
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

type SitePlanAerialTile = { z: number; x: number; y: number; left: number; top: number };

type SitePlanResponse = {
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

type Props = {
  report: Report;
  autoOpenAiSubdivision?: boolean;
  launchAiSubdivisionNonce?: number;
};

type LayerGroupCache = {
  key: string;
  groups: Map<string, React.ReactNode>;
};

function clampMapTranslation(value: number, contentSize: number, viewportSize: number): number {
  "worklet";
  const limit = Math.max(0, (contentSize - viewportSize) / 2);
  return Math.min(limit, Math.max(-limit, value));
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

function layerColor(layer: SitePlanLayer): string {
  return layer.legend[0]?.color ?? layer.style.stroke;
}

function isLineLayer(layer: SitePlanLayer): boolean {
  return layer.group === "services" || layer.group === "contours";
}

// Service pipes (storm/waste/water) come back as line paths. Their segment endpoints are the
// network junctions — i.e. where pipes connect, branch, or terminate (manholes / connection
// points). We mark each unique endpoint with a small node so the connection topology reads at a
// glance, deduping endpoints that share a location (a manhole where several pipes meet).
function renderServiceNodes(
  layer: SitePlanLayer,
  bounds: SitePlanBounds,
  width: number,
  height: number,
) {
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
      <Circle
        key={`${layer.id}-node-${index}`}
        cx={cx}
        cy={cy}
        r={4.5}
        fill="#FFFFFF"
        fillOpacity={0.96}
        stroke={layer.style.stroke}
        strokeWidth={2.4}
      />,
    );
  });
  return nodes;
}

function layerDisplayLabel(layer: SitePlanLayer): string {
  if (layer.id === "nearby-boundaries") return translateForOS("site_plan.layer.nearby_boundaries");
  if (layer.id === "service-stormwater") return translateForOS("site_plan.layer.stormwater");
  if (layer.id === "service-wastewater") return translateForOS("site_plan.layer.wastewater");
  if (layer.id === "service-water") return translateForOS("site_plan.layer.water_supply");
  if (layer.id === "contours") return translateForOS("site_plan.layer.contours");
  if (layer.group === "planning") return translatePlanningLayerLabel(layer.label);
  return layer.label;
}

function translatePlanningLayerLabel(label: string): string {
  const normalized = label.toLowerCase().replace(/\s+/g, " ").trim();
  const key = PLANNING_LAYER_LABEL_KEYS[normalized];
  return key ? translateForOS(key) : label;
}

const PLANNING_LAYER_LABEL_KEYS: Record<string, string> = {
  "heritage": "site_plan.layer.heritage",
  "notable trees": "site_plan.layer.notable_trees",
  "volcanic viewshaft": "site_plan.layer.volcanic_viewshaft",
  "locally significant viewshaft": "site_plan.layer.locally_significant_viewshaft",
  "coastal inundation": "site_plan.layer.coastal_inundation",
  "waitakere ranges heritage": "site_plan.layer.waitakere_ranges_heritage",
  "ridgeline protection": "site_plan.layer.ridgeline_protection",
  "sites and places of significance to mana whenua": "site_plan.layer.mana_whenua",
  "significant ecological area": "site_plan.layer.significant_ecological_area",
  "wetland management area": "site_plan.layer.wetland_management_area",
  "natural stream management area": "site_plan.layer.natural_stream_management_area",
  "high-use stream management area": "site_plan.layer.high_use_stream_management_area",
  "lake management area": "site_plan.layer.lake_management_area",
  "water supply management area": "site_plan.layer.water_supply_management_area",
  "high-use aquifer management area": "site_plan.layer.high_use_aquifer_management_area",
  "quality-sensitive aquifer management area": "site_plan.layer.quality_sensitive_aquifer_management_area",
  "special character area": "site_plan.layer.special_character_area",
  "outstanding natural feature": "site_plan.layer.outstanding_natural_feature",
  "outstanding natural landscape": "site_plan.layer.outstanding_natural_landscape",
  "outstanding natural character": "site_plan.layer.outstanding_natural_character",
  "high natural character": "site_plan.layer.high_natural_character",
  "local public views": "site_plan.layer.local_public_views",
  "height variation control": "site_plan.layer.height_variation_control",
  "subdivision variation control": "site_plan.layer.subdivision_variation_control",
  "parking variation control": "site_plan.layer.parking_variation_control",
  "stormwater management area control": "site_plan.layer.stormwater_management_area_control",
  "arterial roads control": "site_plan.layer.arterial_roads_control",
  "building frontage control": "site_plan.layer.building_frontage_control",
  "vehicle access restriction control": "site_plan.layer.vehicle_access_restriction_control",
  "level crossings with sightlines control": "site_plan.layer.level_crossings_sightlines_control",
  "emergency management area control": "site_plan.layer.emergency_management_area_control",
  "cable protection areas control": "site_plan.layer.cable_protection_areas_control",
};

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
  // Contours are context, not the focus. Cap values here as well as at the API source so older
  // cached site-plan payloads cannot bring back the heavy, high-opacity line treatment.
  const strokeWidth = layer.group === "contours"
    ? Math.min(layer.style.strokeWidth, 0.8)
    : layer.style.strokeWidth;
  const strokeOpacity = layer.group === "contours"
    ? Math.min(layer.style.strokeOpacity ?? 1, 0.58)
    : layer.style.strokeOpacity ?? 1;
  return (
    <Polyline
      key={key}
      points={points}
      fill="none"
      stroke={layer.style.stroke}
      strokeWidth={strokeWidth}
      strokeOpacity={strokeOpacity}
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
    <Polygon
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
      <Circle
        key={`${layer.id}-${featureIndex}`}
        cx={cx}
        cy={cy}
        r={Math.max(5, layer.style.strokeWidth * 2)}
        fill={layer.style.stroke}
        fillOpacity={0.86}
        stroke="#FFFFFF"
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

export function sitePlanQueryKey(searchId: string | null, address: string | undefined) {
  return ["site-plan", searchId, address] as const;
}

function aerialTileUri(tile: SitePlanAerialTile): string {
  return `${getApiBase()}/tiles/aerial/${tile.z}/${tile.x}/${tile.y}`;
}

export function fetchSitePlan(searchId: string, address: string | undefined, headers: Record<string, string>): Promise<SitePlanResponse> {
  const params = new URLSearchParams();
  if (address?.trim()) params.set("address", address.trim());
  const query = params.toString();
  const url = `${getApiBase()}/analyse/${encodeURIComponent(searchId)}/site-plan${query ? `?${query}` : ""}`;
  return fetch(url, {
    headers: {
      ...headers,
      Accept: "application/json",
    },
  }).then(async (resp) => {
    if (!resp.ok) {
      const data = await resp.json().catch(() => null) as { error?: string } | null;
      throw new Error(data?.error ?? "Site plan unavailable");
    }
    return resp.json() as Promise<SitePlanResponse>;
  });
}

export async function prefetchSitePlanAssets(
  queryClient: QueryClient,
  searchId: string | null,
  address: string | undefined,
  headers: Record<string, string>,
): Promise<SitePlanResponse | null> {
  if (!searchId) return null;
  const data = await queryClient.fetchQuery({
    queryKey: sitePlanQueryKey(searchId, address),
    staleTime: SITE_PLAN_STALE_TIME_MS,
    gcTime: SITE_PLAN_GC_TIME_MS,
    queryFn: () => fetchSitePlan(searchId, address, headers),
  });

  if (data.image.source === "linz-basemaps" && data.image.tiles?.length) {
    await Promise.allSettled(data.image.tiles.map((tile) => Image.prefetch(aerialTileUri(tile))));
  }

  return data;
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
  const colors = useColors();
  const color = layerColor(layer);
  const disabled = !layer.available;
  const switchTrackOff = "#E7E2DC";
  const switchTrackOn = `${colors.accent}75`;
  const switchThumb = disabled ? "#F5F1EA" : "#FFFFFF";
  return (
    <View style={[styles.legendRow, disabled && styles.legendRowDisabled]}>
      <View style={styles.legendLabelWrap}>
        <View
          style={[
            styles.legendSwatch,
            {
              borderColor: color,
              backgroundColor: isLineLayer(layer) ? "transparent" : `${color}30`,
            },
          ]}
        >
          {isLineLayer(layer) ? <View style={[styles.legendLine, { backgroundColor: color }]} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.legendLabel, { color: colors.foreground }]} numberOfLines={1}>
            {layerDisplayLabel(layer)}
          </Text>
          {!layer.available ? (
            <Text style={[styles.legendUnavailable, { color: colors.mutedForeground }]}>
              {translateForOS("site_plan.unavailable_short")}
            </Text>
          ) : null}
        </View>
      </View>
      <Switch
        value={visible && layer.available}
        disabled={disabled}
        onValueChange={(next) => onToggle(layer.id, next)}
        trackColor={{ false: switchTrackOff, true: switchTrackOn }}
        thumbColor={switchThumb}
        ios_backgroundColor={switchTrackOff}
      />
    </View>
  );
}

export function SitePlanCard({ report, autoOpenAiSubdivision = false, launchAiSubdivisionNonce = 0 }: Props) {
  const colors = useColors();
  const { t } = useT();
  const { getApiHeaders, user } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  // The id of whichever record owns this report on the server: a `searches` row
  // for signed-in users, the feasibility job for guests (who have no history).
  // Both are accepted by GET /analyse/:id/site-plan and authorised the same way.
  const searchId = report.historyId ?? report.guestJobId ?? null;
  const planHeight = Math.min(430, Math.max(310, viewportWidth - 42));
  const [showAiModal, setShowAiModal] = useState(false);
  const didAutoOpenAiSubdivisionRef = useRef(false);
  const lastLaunchAiSubdivisionNonceRef = useRef(0);
  const aiBreath = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  const aiInterestEventRef = useRef<Promise<string | null> | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const viewportW = useSharedValue(0);
  const viewportH = useSharedValue(0);
  const imageW = useSharedValue(0);
  const imageH = useSharedValue(0);
  // Base "cover" fit that scales the native-resolution canvas to fill the viewport. The map
  // content (aerial tiles + SVG linework) is laid out at the image's native pixel size so it
  // rasterizes at high resolution; `scale` (user zoom) multiplies on top of this base. Result:
  // crisp linework and aerial even when zoomed in, without blank margins at minimum zoom.
  const baseScale = useSharedValue(1);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const framedRef = useRef(false);
  const layerGroupCacheRef = useRef<LayerGroupCache>({ key: "", groups: new Map() });
  const [loadedAerialAssets, setLoadedAerialAssets] = useState<Set<string>>(new Set());
  const [aerialWaitExpired, setAerialWaitExpired] = useState(false);

  const query = useQuery({
    queryKey: sitePlanQueryKey(searchId, report.address),
    enabled: Boolean(searchId),
    staleTime: SITE_PLAN_STALE_TIME_MS,
    gcTime: SITE_PLAN_GC_TIME_MS,
    retry: 1,
    queryFn: () => fetchSitePlan(searchId!, report.address, getApiHeaders()),
  });

  // Rubin can resolve an address itself, but the site-plan centroid is the exact
  // parcel this card already draws — passing it avoids a second geocode landing
  // on a neighbouring property. Held until the site-plan query settles so the
  // subdivision target's identity cannot change underneath an in-flight solve.
  const sitePlanSettled = !query.isLoading;
  const centerLat = query.data?.center.lat;
  const centerLng = query.data?.center.lng;
  // `searchId` is also required: without it this card renders an empty state and
  // never draws a subdivision, so requesting one would be a wasted upstream call.
  const subdivisionTarget = useMemo(
    () =>
      sitePlanSettled && searchId
        ? { address: report.address, lat: centerLat ?? null, lng: centerLng ?? null }
        : {},
    [sitePlanSettled, searchId, report.address, centerLat, centerLng],
  );
  const subdivision = useSubdivision(subdivisionTarget);
  const rubinHost = useRubinHost();

  // Prefer the address Rubin itself resolved during the gate check — it is the
  // canonical LINZ form for the parcel, so passing it back avoids Rubin
  // re-resolving our (possibly differently formatted) string to another property.
  const rubinAddress =
    subdivision.siteResult?.supported === true
      ? subdivision.siteResult.site.address
      : report.address;

  const selectedSubdivisionScenario = useMemo(
    () =>
      subdivision.solvedScenarios.find((entry) => entry.id === subdivision.selectedScenarioId) ?? null,
    [subdivision.solvedScenarios, subdivision.selectedScenarioId],
  );

  const layersSignature = useMemo(
    () => query.data?.layers.map((layer) => `${layer.id}:${layer.available}:${layer.defaultVisible}`).join("|") ?? "",
    [query.data?.layers],
  );
  const [visibleLayers, setVisibleLayers] = useState<Record<string, boolean>>({});
  const aerialAssetKeys = useMemo(() => {
    const image = query.data?.image;
    if (!image) return [];
    if (image.source === "linz-basemaps" && image.tiles?.length) {
      return image.tiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`);
    }
    return image.dataUri ? ["data-uri"] : [];
  }, [query.data?.image]);
  const aerialReady = Boolean(query.data) && (aerialAssetKeys.every((key) => loadedAerialAssets.has(key)) || aerialWaitExpired);
  // Canvas is positioned and ready to draw vector layers (legend toggles, boundaries, service
  // lines) as soon as we have data + a measured viewport — this must NOT wait on the aerial
  // basemap tiles, which can take up to `aerialWaitExpired`'s 12s fallback to settle. Gating the
  // whole canvas (including vector linework) behind aerial readiness previously meant a legend
  // switch could flip instantly while its layer stayed invisible for seconds behind the aerial
  // wait — the aerial image itself still fades in separately via `aerialReady`.
  const canvasReady = Boolean(query.data) && Boolean(canvasSize);

  useEffect(() => {
    setLoadedAerialAssets(new Set());
    setAerialWaitExpired(false);
    framedRef.current = false;
  }, [query.data?.image.dataUri, query.data?.image.tiles]);

  useEffect(() => {
    if (!query.data || aerialAssetKeys.length === 0 || aerialReady) return;
    const timeout = setTimeout(() => setAerialWaitExpired(true), 12_000);
    return () => clearTimeout(timeout);
  }, [aerialAssetKeys.length, aerialReady, query.data]);

  const markAerialAssetLoaded = (key: string) => {
    setLoadedAerialAssets((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, boolean> = {};
    for (const layer of query.data.layers) {
      next[layer.id] = layer.available && layer.defaultVisible;
    }
    setVisibleLayers(next);
  }, [layersSignature, query.data]);

  // Keep the base "cover" fit in sync with the image + viewport so the native-resolution canvas
  // fills the visible map, independent of (and multiplied by) the user's zoom.
  useEffect(() => {
    const data = query.data;
    if (!data || !canvasSize) return;
    viewportW.value = canvasSize.width;
    viewportH.value = canvasSize.height;
    imageW.value = data.image.width;
    imageH.value = data.image.height;
    const fit = Math.max(canvasSize.width / data.image.width, canvasSize.height / data.image.height);
    if (Number.isFinite(fit) && fit > 0) baseScale.value = fit;
  }, [query.data, canvasSize, baseScale, viewportW, viewportH, imageW, imageH]);

  // Default the view to frame the analyzed parcel ("boundary") whenever the Plan tab opens, so the
  // subject lot is centered and filling the viewport rather than showing the whole fetched extent.
  useEffect(() => {
    if (framedRef.current) return;
    const data = query.data;
    if (!data || !canvasSize) return;
    const boundary = data.layers.find((layer) => layer.id === "boundary");
    const coords = boundary ? collectCoordinates(boundary.geojson.features) : [];
    if (coords.length === 0) return;

    const { width: imgW, height: imgH, bounds } = data.image;
    const pixels = coords.map((c) => projectCoordinate(c, bounds, imgW, imgH));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pixels) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const cw = canvasSize.width;
    const ch = canvasSize.height;
    // "cover" fit factor mapping image pixels to on-screen canvas pixels.
    const fit = Math.max(cw / imgW, ch / imgH);
    if (!Number.isFinite(fit) || fit <= 0) return;

    const parcelWCanvas = Math.max(1, (maxX - minX) * fit);
    const parcelHCanvas = Math.max(1, (maxY - minY) * fit);
    // Frame the parcel to ~58% of the viewport so immediate neighbours remain visible.
    const targetFill = 0.58;
    const nextScale = Math.max(1, Math.min(6, Math.min((cw * targetFill) / parcelWCanvas, (ch * targetFill) / parcelHCanvas)));

    const parcelCenterX = (minX + maxX) / 2;
    const parcelCenterY = (minY + maxY) / 2;
    // Offset of the parcel centre from the image centre, in canvas pixels.
    const dx = (parcelCenterX - imgW / 2) * fit;
    const dy = (parcelCenterY - imgH / 2) * fit;
    const nextX = clampMapTranslation(-dx * nextScale, imgW * fit * nextScale, cw);
    const nextY = clampMapTranslation(-dy * nextScale, imgH * fit * nextScale, ch);

    framedRef.current = true;
    scale.value = withTiming(nextScale);
    savedScale.value = nextScale;
    translateX.value = withTiming(nextX);
    translateY.value = withTiming(nextY);
    savedX.value = nextX;
    savedY.value = nextY;
  }, [query.data, canvasSize, scale, savedScale, translateX, translateY, savedX, savedY]);

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = Math.min(6, Math.max(1, savedScale.value * event.scale));
      translateX.value = clampMapTranslation(translateX.value, imageW.value * baseScale.value * scale.value, viewportW.value);
      translateY.value = clampMapTranslation(translateY.value, imageH.value * baseScale.value * scale.value, viewportH.value);
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
      }
    });

  const pan = Gesture.Pan()
    .onStart(() => {
      savedX.value = translateX.value;
      savedY.value = translateY.value;
    })
    .onUpdate((event) => {
      translateX.value = clampMapTranslation(
        savedX.value + event.translationX,
        imageW.value * baseScale.value * scale.value,
        viewportW.value,
      );
      translateY.value = clampMapTranslation(
        savedY.value + event.translationY,
        imageH.value * baseScale.value * scale.value,
        viewportH.value,
      );
    })
    .onEnd(() => {
      if (scale.value <= 1.02) {
        translateX.value = withTiming(0);
        translateY.value = withTiming(0);
      }
    });

  const composedGesture = Gesture.Simultaneous(pinch, pan);
  const animatedMapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: baseScale.value * scale.value },
    ],
  }));
  const animatedAiButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.985 + aiBreath.value * 0.025 }],
    shadowOpacity: 0.2 + aiBreath.value * 0.34,
    shadowRadius: 5 + aiBreath.value * 7,
    elevation: 4 + aiBreath.value * 4,
  }));

  useEffect(() => {
    if (reduceMotion) {
      aiBreath.value = 1;
      return () => cancelAnimation(aiBreath);
    }
    aiBreath.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(aiBreath);
  }, [aiBreath, reduceMotion]);
  const toggleLayer = (id: string, next: boolean) => {
    setVisibleLayers((current) => ({ ...current, [id]: next }));
  };

  /**
   * The site Rubin should be looking at.
   *
   * Coordinates come from the site plan already on screen, so Rubin resolves the
   * exact parcel this report was built from rather than re-geocoding an address
   * string onto a neighbour.
   */
  const rubinTarget = useMemo(
    () => ({
      address: rubinAddress ?? null,
      lat: centerLat ?? null,
      lng: centerLng ?? null,
    }),
    [rubinAddress, centerLat, centerLng],
  );

  /**
   * Load Rubin for this property in the background, now.
   *
   * The Plan tab being open is the strongest signal there is that this is the
   * property the user might want a layout for — stronger than the report-level
   * warm-up in `FeasibilityReport`, which fires for every report including the
   * three the user is not looking at in a combined group. So this one takes the
   * warm slot (`force`).
   *
   * Gated on `subdivision.available` for the same reason the button is: Rubin
   * covers Auckland only, and warming a site it will refuse is a wasted page
   * load. Cheap to call repeatedly — the host ignores a warm for the site it is
   * already holding.
   */
  useEffect(() => {
    if (!RUBIN_DIRECT_LAUNCH_ENABLED) return;
    if (!subdivision.available) return;
    rubinHost.warm(rubinTarget, { force: true });
  }, [rubinHost, rubinTarget, subdivision.available]);

  /** Bring Rubin to the front on this property, warm or not. */
  const openRubin = () => {
    rubinHost.present(rubinTarget);
  };

  /** Mark the interest event completed. Analytics only — never blocks the user. */
  const completeInterestEvent = (eventPromise: Promise<string | null> | null) => {
    if (!eventPromise) return;
    void eventPromise.then(async (eventId) => {
      if (!eventId) return;
      const url = `${getApiBase()}/ai-subdivision-interest/${encodeURIComponent(eventId)}/complete`;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: getApiHeaders(),
          });
          if (response.ok || response.status === 404) return;
        } catch {
          // Retry once below; analytics must never interrupt the acknowledgement.
        }
        if (attempt === 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
        }
      }
    });
  };

  const recordAiSubdivisionInterest = () => {
    // Never open the funnel for a site Rubin cannot analyse — the user would be
    // walked through an explainer only to hit an error at the end.
    if (!subdivision.available) return;

    const eventPromise = fetch(`${getApiBase()}/ai-subdivision-interest`, {
      method: "POST",
      headers: getApiHeaders(),
      body: JSON.stringify({
        searchId,
        propertyAddress: report.address ?? null,
      }),
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const data = await response.json() as { id?: unknown };
        return typeof data.id === "string" ? data.id : null;
      })
      .catch(() => null);

    // Keep the production Rubin path intact behind one release switch. While the
    // switch is off, this event remains open until the user reaches the final
    // launch-notice slide and taps OK.
    if (RUBIN_DIRECT_LAUNCH_ENABLED) {
      aiInterestEventRef.current = null;
      openRubin();
      completeInterestEvent(eventPromise);
      return;
    }

    aiInterestEventRef.current = eventPromise;
    setShowAiModal(true);
  };

  const completeAiSubdivisionInterest = () => {
    const eventPromise = aiInterestEventRef.current;
    setShowAiModal(false);
    aiInterestEventRef.current = null;
    completeInterestEvent(eventPromise);
  };

  /**
   * Tapping the button on a site Rubin cannot analyse.
   *
   * It stays visibly inert, but a control that does nothing at all reads as a
   * bug — so say which of the two real limits was hit. The notice under the map
   * says the same thing; this is for the user who went straight for the button.
   */
  const explainSubdivisionUnavailable = () => {
    if (subdivision.siteLoading) return;

    if (subdivision.siteError) {
      Alert.alert(
        translateForOS("site_plan.subdivision.title"),
        translateForOS("site_plan.subdivision.site_error"),
        [
          { text: translateForOS("common.cancel"), style: "cancel" },
          { text: translateForOS("site_plan.subdivision.retry"), onPress: subdivision.retrySite },
        ],
      );
      return;
    }

    const result = subdivision.siteResult;
    const body =
      result && !result.supported && result.reason === "unsupported-zone"
        ? report.zone_label
          ? translateForOS("site_plan.subdivision.unavailable_zone", { zone: report.zone_label })
          : translateForOS("site_plan.subdivision.unavailable_zone_generic")
        : translateForOS("site_plan.subdivision.unavailable_alert_body");

    Alert.alert(translateForOS("site_plan.subdivision.unavailable_alert_title"), body, [
      { text: translateForOS("common.ok") },
    ]);
  };

  useEffect(() => {
    // Waits on `available`, so a request arriving from chat opens the funnel only
    // once the gating lookup has confirmed Rubin covers this parcel.
    if (!subdivision.available) return;
    const shouldAutoOpen = autoOpenAiSubdivision && !didAutoOpenAiSubdivisionRef.current;
    const shouldOpenFromAction = launchAiSubdivisionNonce > lastLaunchAiSubdivisionNonceRef.current;
    if (!shouldAutoOpen && !shouldOpenFromAction) return;
    if (shouldAutoOpen) didAutoOpenAiSubdivisionRef.current = true;
    lastLaunchAiSubdivisionNonceRef.current = launchAiSubdivisionNonce;
    recordAiSubdivisionInterest();
  }, [autoOpenAiSubdivision, launchAiSubdivisionNonce, subdivision.available]);

  const activeSpecialStatus =
    user?.specialStatus === "friends_family" ||
    (user?.specialStatus === "supercharge" &&
      (!user.specialStatusExpiresAt ||
        new Date(user.specialStatusExpiresAt).getTime() > Date.now()));
  const showUpgradeSlide =
    !user ||
    (user.role === "general" &&
      user.subscriptionTier !== "standard" &&
      user.subscriptionTier !== "pro" &&
      !activeSpecialStatus);

  const visibleVectorLayers = useMemo(
    () =>
      query.data?.layers.filter(
        (layer) => layer.available && (ALWAYS_ON_LAYERS.has(layer.id) || visibleLayers[layer.id]),
      ) ?? [],
    [query.data?.layers, visibleLayers],
  );
  const legendLayers = useMemo(
    () => query.data?.layers.filter(
      (layer) => !ALWAYS_ON_LAYERS.has(layer.id) && layer.available && layer.geojson.features.length > 0,
    ) ?? [],
    [query.data?.layers],
  );

  // One honest line explaining why the AI Subdivision button is inert. Rubin's
  // own 404 ("no cadastral parcel found") would read as a defect, so the two
  // real causes — outside Auckland, or a non-residential zone — are named.
  const subdivisionNotice = useMemo(() => {
    if (subdivision.available || subdivision.hasStarted) return null;
    if (subdivision.siteLoading) return translateForOS("site_plan.subdivision.checking");
    if (subdivision.siteError) return translateForOS("site_plan.subdivision.site_error");
    const result = subdivision.siteResult;
    if (!result || result.supported) return null;
    if (result.reason === "unsupported-zone") {
      return report.zone_label
        ? translateForOS("site_plan.subdivision.unavailable_zone", { zone: report.zone_label })
        : translateForOS("site_plan.subdivision.unavailable_zone_generic");
    }
    return translateForOS("site_plan.subdivision.unavailable_region");
  }, [
    subdivision.available,
    subdivision.hasStarted,
    subdivision.siteLoading,
    subdivision.siteError,
    subdivision.siteResult,
    report.zone_label,
  ]);

  const layerGroupCacheKey = useMemo(() => {
    const image = query.data?.image;
    if (!image) return "";
    // `dataUpdatedAt` identifies this response without retaining another copy of a potentially
    // large data URI. The remaining fields make the image identity explicit for cached responses.
    const imageIdentity = image.source === "linz-basemaps"
      ? image.tiles?.map((tile) => `${tile.z}/${tile.x}/${tile.y}`).join("|") ?? "no-tiles"
      : image.dataUri
        ? "data-uri"
        : "no-image";
    return [
      searchId ?? "no-search",
      query.dataUpdatedAt,
      image.source,
      imageIdentity,
      `${image.width}x${image.height}`,
    ].join(":");
  }, [query.data?.image, query.dataUpdatedAt, searchId]);

  const getLayerGroup = useCallback((layer: SitePlanLayer): React.ReactNode => {
    const image = query.data?.image;
    if (!image) return null;

    if (layerGroupCacheRef.current.key !== layerGroupCacheKey) {
      layerGroupCacheRef.current = { key: layerGroupCacheKey, groups: new Map() };
    }

    const cachedGroup = layerGroupCacheRef.current.groups.get(layer.id);
    if (cachedGroup) return cachedGroup;

    const group = (
      <G key={layer.id}>
        {layer.geojson.features.map((feature, featureIndex) =>
          renderFeature(
            feature,
            layer,
            image.bounds,
            image.width,
            image.height,
            featureIndex,
          ),
        )}
        {renderServiceNodes(layer, image.bounds, image.width, image.height)}
      </G>
    );
    layerGroupCacheRef.current.groups.set(layer.id, group);
    return group;
  }, [layerGroupCacheKey, query.data?.image]);

  // Project hidden layers after the initial map interaction settles so their first toggle is also
  // a cache hit. This only populates the ref; it does not trigger another render.
  useEffect(() => {
    const data = query.data;
    if (!data || !canvasSize) return;

    const task = InteractionManager.runAfterInteractions(() => {
      for (const layer of data.layers) {
        if (layer.available) getLayerGroup(layer);
      }
    });

    return () => task.cancel();
  }, [canvasSize, getLayerGroup, query.data]);

  if (!searchId) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.emptyState}>
          <Feather name="map" size={18} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {translateForOS("site_plan.unavailable")}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {translateForOS("site_plan.title")}
          </Text>
        </View>
        <View style={styles.aiButtonWrap}>
          {subdivision.available ? (
            <Animated.View style={[styles.aiButtonGlow, animatedAiButtonStyle]}>
              <TouchableOpacity
                style={styles.aiButtonTouch}
                onPress={recordAiSubdivisionInterest}
                disabled={subdivision.isSolving}
                activeOpacity={0.78}
                accessibilityRole="button"
                accessibilityLabel={translateForOS("site_plan.ai_subdivision")}
              >
                <LinearGradient
                  colors={["#C4B5FD", "#F9A8D4", "#FDBA74", "#C4B5FD"]}
                  start={{ x: 0, y: 0.15 }}
                  end={{ x: 1, y: 0.85 }}
                  style={styles.aiButtonBorder}
                >
                  <LinearGradient
                    colors={["#7C3AED", "#DB2777", "#F97316"]}
                    start={{ x: 0, y: 0.15 }}
                    end={{ x: 1, y: 0.85 }}
                    style={styles.aiButton}
                  >
                    <Feather name="grid" size={13} color="#FFFFFF" />
                    <Text style={styles.aiButtonText} numberOfLines={1}>
                      {translateForOS("site_plan.ai_subdivision")}
                    </Text>
                  </LinearGradient>
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          ) : (
            // Rubin is Auckland-only, so the control stays visibly inert rather
            // than letting a user tap into a raw 404. It is still *tappable*,
            // though: a button that does nothing at all reads as a broken app,
            // so a tap explains which limit was hit.
            <TouchableOpacity
              style={[styles.aiButtonDisabled, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={explainSubdivisionUnavailable}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={translateForOS("site_plan.ai_subdivision")}
              accessibilityHint={translateForOS("site_plan.subdivision.unavailable_alert_title")}
            >
              {subdivision.siteLoading ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Feather name="grid" size={13} color={colors.mutedForeground} />
              )}
              <Text
                style={[styles.aiButtonDisabledText, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                {translateForOS("site_plan.ai_subdivision")}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View
        style={[styles.mapViewport, { height: planHeight, backgroundColor: colors.muted }]}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          setCanvasSize((prev) =>
            prev && Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
              ? prev
              : { width, height },
          );
        }}
      >
        {query.isError ? (
          <View style={styles.emptyState}>
            <Feather name="alert-circle" size={18} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {translateForOS("site_plan.load_failed")}
            </Text>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: colors.foreground }]}
              onPress={() => query.refetch()}
              activeOpacity={0.85}
            >
              <Text style={[styles.retryText, { color: colors.card }]}>
                {translateForOS("site_plan.retry")}
              </Text>
            </TouchableOpacity>
          </View>
        ) : query.data ? (
          <GestureDetector gesture={composedGesture}>
            <Animated.View
              style={[
                styles.mapCanvas,
                {
                  // Lay the canvas out at the image's native pixel size, centred in the viewport.
                  // `baseScale` (the cover-fit) in the transform scales it to fill; this keeps
                  // both the aerial tiles and the SVG linework crisp under zoom.
                  width: query.data.image.width,
                  height: query.data.image.height,
                  left: canvasSize ? (canvasSize.width - query.data.image.width) / 2 : 0,
                  top: canvasSize ? (canvasSize.height - query.data.image.height) / 2 : 0,
                  opacity: canvasReady ? 1 : 0.01,
                },
                animatedMapStyle,
              ]}
            >
              {/* Aerial imagery fades in independently on its own `aerialReady` gate so slow
                  satellite tile loads never block the vector linework (legend layers) below from
                  rendering — those are already in memory and should reflect toggles instantly. */}
              <View style={[StyleSheet.absoluteFill, { opacity: aerialReady ? 1 : 0 }]} pointerEvents="none">
                {query.data.image.source === "linz-basemaps" && query.data.image.tiles?.length ? (
                  // Aerial rendered as a grid of LINZ Basemaps tiles via the server proxy (key stays
                  // server-side, no `sharp` needed). Each tile sits at its native resolution.
                  query.data.image.tiles.map((tile) => (
                    <Image
                      key={`${tile.z}/${tile.x}/${tile.y}`}
                      source={{ uri: aerialTileUri(tile) }}
                      onLoadEnd={() => markAerialAssetLoaded(`${tile.z}/${tile.x}/${tile.y}`)}
                      onError={() => markAerialAssetLoaded(`${tile.z}/${tile.x}/${tile.y}`)}
                      style={{
                        position: "absolute",
                        left: tile.left,
                        top: tile.top,
                        width: query.data.image.tileSize ?? 256,
                        height: query.data.image.tileSize ?? 256,
                        // Slightly transparent so the vector linework (pipes/boundaries/nodes) on top
                        // stays legible against the satellite imagery.
                        opacity: 0.82,
                      }}
                    />
                  ))
                ) : query.data.image.dataUri ? (
                  <Image
                    source={{ uri: query.data.image.dataUri }}
                    style={styles.mapImage}
                    resizeMode="cover"
                    onLoadEnd={() => markAerialAssetLoaded("data-uri")}
                    onError={() => markAerialAssetLoaded("data-uri")}
                  />
                ) : null}
                {/* Slight scrim over the aerial so the vector linework (pipes/boundaries) stays
                    legible on top of the satellite imagery (house, trees) underneath. */}
                {query.data.image.source === "linz-basemaps" ? (
                  <View style={[StyleSheet.absoluteFill, styles.aerialScrim]} pointerEvents="none" />
                ) : null}
              </View>
              <Svg
                style={StyleSheet.absoluteFill}
                viewBox={`0 0 ${query.data.image.width} ${query.data.image.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {visibleVectorLayers.map((layer) => getLayerGroup(layer))}
                {/* Generated lots draw last so they sit above the council layers
                    they are proposed over. Same bounds and viewBox as everything
                    else, so no reprojection is involved. */}
                {selectedSubdivisionScenario
                  ? renderSubdivisionOverlay(
                      selectedSubdivisionScenario,
                      query.data.image.bounds,
                      query.data.image.width,
                      query.data.image.height,
                    )
                  : null}
              </Svg>
            </Animated.View>
          </GestureDetector>
        ) : null}
        {query.isLoading || (query.data && !canvasReady) ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("site_plan.loading")}
            </Text>
          </View>
        ) : null}
        {query.isFetching && !query.isLoading && canvasReady ? (
          <View style={[styles.refreshingPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null}
      </View>

      {subdivisionNotice ? (
        <View style={[styles.subdivisionNotice, { borderTopColor: colors.border }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.subdivisionNoticeText, { color: colors.mutedForeground }]}>
            {subdivisionNotice}
          </Text>
          {subdivision.siteError ? (
            <TouchableOpacity onPress={subdivision.retrySite} activeOpacity={0.8}>
              <Text style={[styles.subdivisionNoticeAction, { color: colors.accent }]}>
                {translateForOS("site_plan.subdivision.retry")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* DORMANT. Renders nothing until `subdivision.start()` is called, and
          nothing calls it — tapping "AI Subdivision" opens Rubin full-screen
          instead. Kept wired so the planned second button ("subdivide"), which
          will trigger Rubin's solver over the API, only needs that one call. */}
      <SubdivisionPanel state={subdivision} solverVersion={subdivision.solverVersion} />

      {query.data ? (
        <View style={[styles.legend, { borderTopColor: colors.border }]}>
          {legendLayers.map((layer) => (
            <LayerToggleRow
              key={layer.id}
              layer={layer}
              visible={Boolean(visibleLayers[layer.id])}
              onToggle={toggleLayer}
            />
          ))}
        </View>
      ) : null}
      <AiSubdivisionIntroModal
        visible={showAiModal}
        showUpgradeSlide={showUpgradeSlide}
        onCancel={() => setShowAiModal(false)}
        onComplete={completeAiSubdivisionInterest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  header: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  title: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 15,
    lineHeight: 20,
  },
  aiButton: {
    minWidth: 112,
    height: 34,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  aiButtonBorder: {
    borderRadius: 20,
    padding: 2,
  },
  aiButtonTouch: {
    borderRadius: 20,
    overflow: "hidden",
  },
  aiButtonGlow: {
    borderRadius: 20,
    shadowColor: "#C026D3",
    shadowOffset: { width: 0, height: 3 },
  },
  aiButtonWrap: {
    position: "relative",
    alignItems: "flex-end",
  },
  aiButtonDisabled: {
    minWidth: 112,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  aiButtonDisabledText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
    lineHeight: 16,
  },
  subdivisionNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  subdivisionNoticeText: {
    flex: 1,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11.5,
    lineHeight: 16,
  },
  subdivisionNoticeAction: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 11.5,
    lineHeight: 16,
  },
  aiButtonText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_700Bold",
    fontSize: 12,
    lineHeight: 16,
  },
  mapViewport: {
    width: "100%",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  mapCanvas: {
    position: "absolute",
  },
  mapImage: {
    width: "100%",
    height: "100%",
  },
  aerialScrim: {
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    textAlign: "center",
    paddingHorizontal: 24,
    lineHeight: 17,
  },
  refreshingPill: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    minHeight: 150,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 18,
  },
  emptyTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  retryButton: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  retryText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
  },
  legend: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
  },
  legendRow: {
    minHeight: 48,
    paddingHorizontal: 13,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  legendRowDisabled: {
    opacity: 0.48,
  },
  legendLabelWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    minWidth: 0,
  },
  legendSwatch: {
    width: 24,
    height: 18,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  legendLine: {
    width: 18,
    height: 3,
    borderRadius: 2,
  },
  legendLabel: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
    lineHeight: 16,
  },
  legendUnavailable: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 10,
    lineHeight: 14,
    marginTop: 1,
  },
});
