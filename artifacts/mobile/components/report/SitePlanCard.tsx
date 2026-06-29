import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import Svg, { Circle, Polygon, Polyline } from "react-native-svg";

import { useAuth } from "@/context/AuthContext";
import type { FeasibilityReport as Report } from "@/context/ChatContext";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";
import { translateForOS } from "@/lib/i18n";
import { getApiBase } from "@/lib/api";

// The subject parcel ("boundary") and the surrounding property boundaries ("nearby-boundaries")
// are always drawn and not user-toggleable — they form the base context for the site plan.
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
  return (
    <Polyline
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

function fetchSitePlan(searchId: string, address: string | undefined, headers: Record<string, string>): Promise<SitePlanResponse> {
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
        trackColor={{ false: colors.border, true: `${colors.accent}75` }}
        thumbColor={visible && layer.available ? "#FFFFFF" : colors.mutedForeground}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

export function SitePlanCard({ report }: Props) {
  const colors = useColors();
  const { t } = useT();
  const { getApiHeaders } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const searchId = report.historyId ?? null;
  const planHeight = Math.min(430, Math.max(310, viewportWidth - 42));
  const [showAiSoon, setShowAiSoon] = useState(false);
  const soonProgress = useSharedValue(0);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  // Base "contain" fit that scales the native-resolution canvas down into the viewport. The map
  // content (aerial tiles + SVG linework) is laid out at the image's native pixel size so it
  // rasterizes at high resolution; `scale` (user zoom) multiplies on top of this base. Result:
  // crisp linework and aerial even when zoomed in.
  const baseScale = useSharedValue(1);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const framedRef = useRef(false);
  const [loadedAerialAssets, setLoadedAerialAssets] = useState<Set<string>>(new Set());
  const [aerialWaitExpired, setAerialWaitExpired] = useState(false);

  const query = useQuery({
    queryKey: ["site-plan", searchId, report.address],
    enabled: Boolean(searchId),
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchSitePlan(searchId!, report.address, getApiHeaders()),
  });

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
  const mapReady = Boolean(query.data) && aerialReady && Boolean(canvasSize);

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

  useEffect(() => {
    soonProgress.value = withTiming(showAiSoon ? 1 : 0, { duration: 170 });
    if (!showAiSoon) return;
    const timeout = setTimeout(() => setShowAiSoon(false), 2600);
    return () => clearTimeout(timeout);
  }, [showAiSoon, soonProgress]);

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

  // Keep the base "contain" fit in sync with the image + viewport so the native-resolution canvas
  // is scaled down to fit, independent of (and multiplied by) the user's zoom.
  useEffect(() => {
    const data = query.data;
    if (!data || !canvasSize) return;
    const fit = Math.min(canvasSize.width / data.image.width, canvasSize.height / data.image.height);
    if (Number.isFinite(fit) && fit > 0) baseScale.value = fit;
  }, [query.data, canvasSize, baseScale]);

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
    // "contain" fit factor mapping image pixels → on-screen canvas pixels.
    const fit = Math.min(cw / imgW, ch / imgH);
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
    const nextX = -dx * nextScale;
    const nextY = -dy * nextScale;

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
      translateX.value = savedX.value + event.translationX;
      translateY.value = savedY.value + event.translationY;
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
  const soonTipStyle = useAnimatedStyle(() => ({
    opacity: soonProgress.value,
    transform: [
      { translateY: (1 - soonProgress.value) * -5 },
      { scale: 0.95 + soonProgress.value * 0.05 },
    ],
  }));

  const toggleLayer = (id: string, next: boolean) => {
    setVisibleLayers((current) => ({ ...current, [id]: next }));
  };

  const visibleVectorLayers = useMemo(
    () =>
      query.data?.layers.filter(
        (layer) => layer.available && (ALWAYS_ON_LAYERS.has(layer.id) || visibleLayers[layer.id]),
      ) ?? [],
    [query.data?.layers, visibleLayers],
  );
  const legendLayers = useMemo(
    () => query.data?.layers.filter((layer) => !ALWAYS_ON_LAYERS.has(layer.id)) ?? [],
    [query.data?.layers],
  );

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
          {showAiSoon ? (
            <Animated.View style={[styles.comingSoonTip, soonTipStyle]} pointerEvents="none">
              <View style={[styles.comingSoonCaret, { backgroundColor: colors.accent }]} />
              <View style={[styles.comingSoonBubble, { backgroundColor: colors.accent }]}>
                <Feather name="clock" size={12} color="#FFFFFF" />
                <Text style={styles.comingSoonText}>
                  {translateForOS("site_plan.coming_soon")}
                </Text>
              </View>
            </Animated.View>
          ) : null}
          <TouchableOpacity
            style={[styles.aiButton, { borderColor: colors.border, backgroundColor: colors.muted }]}
            onPress={() => setShowAiSoon(true)}
            activeOpacity={0.72}
            accessibilityRole="button"
            accessibilityLabel={translateForOS("site_plan.ai_subdivision")}
          >
            <Feather name="grid" size={13} color={colors.mutedForeground} />
            <Text style={[styles.aiButtonText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {translateForOS("site_plan.ai_subdivision")}
            </Text>
          </TouchableOpacity>
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
                  // `baseScale` (the contain-fit) in the transform scales it down to fit; this keeps
                  // both the aerial tiles and the SVG linework crisp under zoom.
                  width: query.data.image.width,
                  height: query.data.image.height,
                  left: canvasSize ? (canvasSize.width - query.data.image.width) / 2 : 0,
                  top: canvasSize ? (canvasSize.height - query.data.image.height) / 2 : 0,
                  opacity: mapReady ? 1 : 0.01,
                },
                animatedMapStyle,
              ]}
            >
              {query.data.image.source === "linz-basemaps" && query.data.image.tiles?.length ? (
                // Aerial rendered as a grid of LINZ Basemaps tiles via the server proxy (key stays
                // server-side, no `sharp` needed). Each tile sits at its native resolution.
                query.data.image.tiles.map((tile) => (
                  <Image
                    key={`${tile.z}/${tile.x}/${tile.y}`}
                    source={{ uri: `${getApiBase()}/tiles/aerial/${tile.z}/${tile.x}/${tile.y}` }}
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
              <Svg
                style={StyleSheet.absoluteFill}
                viewBox={`0 0 ${query.data.image.width} ${query.data.image.height}`}
                preserveAspectRatio="xMidYMid meet"
              >
                {visibleVectorLayers.flatMap((layer) =>
                  layer.geojson.features.map((feature, featureIndex) =>
                    renderFeature(
                      feature,
                      layer,
                      query.data!.image.bounds,
                      query.data!.image.width,
                      query.data!.image.height,
                      featureIndex,
                    ),
                  ),
                )}
                {visibleVectorLayers.flatMap((layer) =>
                  renderServiceNodes(
                    layer,
                    query.data!.image.bounds,
                    query.data!.image.width,
                    query.data!.image.height,
                  ),
                )}
              </Svg>
            </Animated.View>
          </GestureDetector>
        ) : null}
        {query.isLoading || (query.data && !mapReady) ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.accent} />
            <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("site_plan.loading")}
            </Text>
          </View>
        ) : null}
        {query.isFetching && !query.isLoading && mapReady ? (
          <View style={[styles.refreshingPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null}
      </View>

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
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 12,
  },
  aiButtonWrap: {
    position: "relative",
    alignItems: "flex-end",
  },
  aiButtonText: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 12,
    lineHeight: 16,
  },
  comingSoonTip: {
    position: "absolute",
    right: 0,
    top: 40,
    zIndex: 5,
    alignItems: "flex-end",
  },
  comingSoonCaret: {
    width: 11,
    height: 11,
    borderRadius: 2,
    marginRight: 18,
    marginBottom: -6,
    transform: [{ rotate: "45deg" }],
  },
  comingSoonBubble: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 96,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  comingSoonText: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 11,
    lineHeight: 14,
    color: "#FFFFFF",
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
