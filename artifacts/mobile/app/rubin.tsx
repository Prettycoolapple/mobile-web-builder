import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { WebView } from "react-native-webview";

import { useColors } from "@/hooks/useColors";
import { translateForOS } from "@/lib/i18n";
import { buildRubinEmbedUrl, getRubinOrigin, hasRubinTarget } from "@/lib/rubin";

/**
 * Full-screen Rubin site view.
 *
 * Reached from the "AI Subdivision" button on a feasibility report's Plan tab.
 * Rubin draws the parcel, 3-waters connections and contours itself; this screen
 * is the frame around it — a header with a back button, a loading state, and an
 * error state for when the canvas cannot load.
 *
 * Back returns to the report the user came from, which is the previous entry in
 * the stack, so the Plan tab is still selected when they land.
 */

// Rubin's canvas is a dark drafting surface; matching it means no white flash
// while the WebView boots, and no seam between the header and the canvas.
const RUBIN_CANVAS_BG = "#111827";

export default function RubinScreen() {
  const colors = useColors();
  const router = useRouter();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const params = useLocalSearchParams<{ address?: string; lat?: string; lng?: string }>();

  const target = useMemo(() => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    return {
      address: typeof params.address === "string" ? params.address : null,
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
    };
  }, [params.address, params.lat, params.lng]);

  const sourceUri = useMemo(() => buildRubinEmbedUrl(target), [target]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const retry = () => {
    setFailed(false);
    setLoading(true);
    // Remounts the WebView. Calling reload() on a view whose load already failed
    // is unreliable on Android, where the error page becomes the current entry.
    setReloadNonce((value) => value + 1);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: RUBIN_CANVAS_BG }]} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={goBack}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={translateForOS("rubin.back")}
          // Comfortably above the 44pt minimum without widening the visual chip.
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Feather name="chevron-left" size={20} color="#FFFFFF" />
          <Text style={styles.backText}>{translateForOS("rubin.back")}</Text>
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {target.address ?? translateForOS("rubin.title")}
        </Text>

        {/* Balances the back button so the title stays optically centred. */}
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.canvas}>
        {hasRubinTarget(target) && !failed ? (
          <WebView
            key={reloadNonce}
            ref={webViewRef}
            source={{ uri: sourceUri }}
            style={styles.webView}
            // Both carry the canvas colour so no white frame shows during load;
            // the WebView itself has no `backgroundColor` prop.
            containerStyle={styles.webViewContainer}
            originWhitelist={[`${getRubinOrigin()}/*`]}
            onLoadEnd={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            onHttpError={({ nativeEvent }) => {
              // Sub-resource 4xx/5xx also surface here; only a failure of the
              // document itself means the canvas will not appear.
              if (nativeEvent.url === sourceUri) {
                setLoading(false);
                setFailed(true);
              }
            }}
            // Rubin drives its own pinch/pan on the canvas. Leaving the WebView's
            // zoom on would fight those gestures and let the user scale the page
            // away from the drawing.
            scalesPageToFit={false}
            setBuiltInZoomControls={false}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            javaScriptEnabled
            domStorageEnabled
            // Keeps navigation inside Rubin; anything else is not ours to render.
            onShouldStartLoadWithRequest={(request) =>
              request.url.startsWith(getRubinOrigin())
            }
            // Rubin is a heavy canvas; on Android the default renderer can drop
            // the surface when the view is briefly detached.
            androidLayerType={Platform.OS === "android" ? "hardware" : undefined}
          />
        ) : null}

        {loading && hasRubinTarget(target) && !failed ? (
          <View style={styles.overlay} pointerEvents="none">
            <ActivityIndicator color="#A78BFA" />
            <Text style={styles.overlayText}>{translateForOS("rubin.loading")}</Text>
          </View>
        ) : null}

        {failed || !hasRubinTarget(target) ? (
          <View style={styles.overlay}>
            <Feather name="alert-circle" size={22} color="#9CA3AF" />
            <Text style={styles.overlayText}>
              {hasRubinTarget(target)
                ? translateForOS("rubin.failed")
                : translateForOS("rubin.no_target")}
            </Text>
            {hasRubinTarget(target) ? (
              <TouchableOpacity
                style={[styles.retryButton, { backgroundColor: colors.accent }]}
                onPress={retry}
                activeOpacity={0.85}
              >
                <Text style={styles.retryText}>{translateForOS("rubin.retry")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  header: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    gap: 8,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingVertical: 6,
    paddingRight: 8,
    minWidth: 76,
  },
  backText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: "#E5E7EB",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 13,
  },
  headerSpacer: {
    minWidth: 76,
  },
  canvas: {
    flex: 1,
    position: "relative",
  },
  webView: {
    flex: 1,
    backgroundColor: RUBIN_CANVAS_BG,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: RUBIN_CANVAS_BG,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: RUBIN_CANVAS_BG,
  },
  overlayText: {
    color: "#9CA3AF",
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  retryButton: {
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 9,
    marginTop: 4,
  },
  retryText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 13,
  },
});
