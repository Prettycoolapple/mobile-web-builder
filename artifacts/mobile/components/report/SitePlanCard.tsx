import React, { useEffect, useMemo, useState } from "react";
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
import { getApiBase } from "@/lib/api";

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

type SitePlanResponse = {
  image: {
    dataUri: string;
    width: number;
    height: number;
    bounds: SitePlanBounds;
    attribution: string;
    available: boolean;
    source: "linz-basemaps" | "placeholder";
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

function layerColor(layer: SitePlanLayer): string {
  return layer.legend[0]?.color ?? layer.style.stroke;
}

function isLineLayer(layer: SitePlanLayer): boolean {
  return layer.group === "services" || layer.group === "contours";
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
            {layer.label}
          </Text>
          {!layer.available ? (
            <Text style={[styles.legendUnavailable, { color: colors.mutedForeground }]}>Unavailable</Text>
          ) : null}
        </View>
      </View>
      <Switch
        value={visible && layer.available}
        disabled={disabled}
        onValueChange={(next) => onToggle(layer.id, next)}
        trackColor={{ false: colors.border, true: `${colors.accent}75` }}
        thumbColor={visible && layer.available ? colors.accent : colors.mutedForeground}
      />
    </View>
  );
}

export function SitePlanCard({ report }: Props) {
  const colors = useColors();
  const { getApiHeaders } = useAuth();
  const { width: viewportWidth } = useWindowDimensions();
  const searchId = report.historyId ?? null;
  const planHeight = Math.min(430, Math.max(310, viewportWidth - 42));

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

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

  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, boolean> = {};
    for (const layer of query.data.layers) {
      next[layer.id] = layer.available && layer.defaultVisible;
    }
    setVisibleLayers(next);
  }, [layersSignature, query.data]);

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
      { scale: scale.value },
    ],
  }));

  const resetMap = () => {
    scale.value = withTiming(1);
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
  };

  const toggleLayer = (id: string, next: boolean) => {
    setVisibleLayers((current) => ({ ...current, [id]: next }));
  };

  const visibleVectorLayers = useMemo(
    () => query.data?.layers.filter((layer) => layer.available && visibleLayers[layer.id]) ?? [],
    [query.data?.layers, visibleLayers],
  );

  if (!searchId) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.emptyState}>
          <Feather name="map" size={18} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Site plan unavailable</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Site Plan</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {query.data?.image.attribution ?? "Loading map layers"}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.iconButton, { borderColor: colors.border, backgroundColor: colors.muted }]}
          onPress={resetMap}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Reset site plan"
        >
          <Feather name="maximize" size={15} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <View style={[styles.mapViewport, { height: planHeight, backgroundColor: colors.muted }]}>
        {query.isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : query.isError ? (
          <View style={styles.emptyState}>
            <Feather name="alert-circle" size={18} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Site plan unavailable</Text>
            <TouchableOpacity
              style={[styles.retryButton, { backgroundColor: colors.foreground }]}
              onPress={() => query.refetch()}
              activeOpacity={0.85}
            >
              <Text style={[styles.retryText, { color: colors.card }]}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : query.data ? (
          <GestureDetector gesture={composedGesture}>
            <Animated.View style={[styles.mapCanvas, animatedMapStyle]}>
              <Image source={{ uri: query.data.image.dataUri }} style={styles.mapImage} resizeMode="contain" />
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
              </Svg>
            </Animated.View>
          </GestureDetector>
        ) : null}
        {query.isFetching && !query.isLoading ? (
          <View style={[styles.refreshingPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.accent} />
          </View>
        ) : null}
      </View>

      {query.data ? (
        <View style={[styles.legend, { borderTopColor: colors.border }]}>
          {query.data.layers.map((layer) => (
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
    minHeight: 62,
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
  subtitle: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  mapViewport: {
    width: "100%",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  mapCanvas: {
    width: "100%",
    height: "100%",
  },
  mapImage: {
    width: "100%",
    height: "100%",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
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
