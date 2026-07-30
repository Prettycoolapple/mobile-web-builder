import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useQuery } from "@tanstack/react-query";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { translateForOS } from "@/lib/i18n";
import { buildRubinEmbedUrl, getRubinOrigin, hasRubinTarget } from "@/lib/rubin";
import {
  buildRubinInjection,
  claimRubinGenerateQuota,
  fetchLatestRubinLayout,
  parseRubinMessage,
  saveRubinLayout,
  type RubinInboundMessage,
  type RubinSiteIdentity,
} from "@/lib/rubinBridge";

/**
 * Full-screen Rubin site view.
 *
 * Reached from the "AI Subdivision" button on a feasibility report's Plan tab.
 * Rubin draws the parcel, 3-waters connections and contours itself, and now runs
 * generation in-page too; this screen is the frame around it — a header, a
 * loading state, an error state, and the two things Rubin cannot do for itself:
 * authenticate the user and store what they generate.
 *
 * Back returns to the report the user came from, which is the previous entry in
 * the stack, so the Plan tab is still selected when they land.
 */

// Rubin's canvas is a dark drafting surface; matching it means no white flash
// while the WebView boots, and no seam between the header and the canvas.
const RUBIN_CANVAS_BG = "#111827";

/**
 * Backstop for the load gate.
 *
 * The overlay is normally cleared by Rubin's own `site-ready`, which is the only
 * honest signal that the canvas is fully drawn. But a Rubin that never gets far
 * enough to send anything — a JS bundle that fails to parse, a build predating
 * the bridge — would leave the user on a spinner forever. Comfortably longer
 * than a slow cold site load (parcel + contours + pipes over mobile data).
 */
const SITE_READY_WATCHDOG_MS = 90_000;

export default function RubinScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  /** Rubin has registered its bridge; queued messages can go out. */
  const [bridgeReady, setBridgeReady] = useState(false);
  const initSentRef = useRef(false);
  const hydrateSentRef = useRef(false);

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

  /**
   * The user's saved layout for this site, fetched in parallel with the WebView
   * boot so it is usually in hand by the time Rubin says it is ready. Full form,
   * not summary: this one is going to be drawn.
   */
  const savedLayout = useQuery({
    queryKey: ["rubin-layout", target.lat, target.lng],
    enabled: target.lat !== null && target.lng !== null,
    // A layout only changes when this user generates one, and generating one
    // invalidates by remounting the screen.
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: () =>
      fetchLatestRubinLayout(
        { lat: target.lat as number, lng: target.lng as number },
        getApiHeaders(),
      ),
  });

  const post = useCallback((message: Parameters<typeof buildRubinInjection>[0]) => {
    webViewRef.current?.injectJavaScript(buildRubinInjection(message));
  }, []);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  };

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setBridgeReady(false);
    initSentRef.current = false;
    hydrateSentRef.current = false;
    // Remounts the WebView. Calling reload() on a view whose load already failed
    // is unreliable on Android, where the error page becomes the current entry.
    setReloadNonce((value) => value + 1);
  };

  // Watchdog. Cancelled the moment Rubin reports either outcome.
  useEffect(() => {
    if (!loading || failed || !hasRubinTarget(target)) return;
    const timer = setTimeout(() => {
      console.warn("[rubin] no site-ready within the watchdog window");
      setLoading(false);
      setFailed(true);
    }, SITE_READY_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [loading, failed, target, reloadNonce]);

  /**
   * `init` tells Rubin whether a hydrate is coming, so it can skip the "no
   * layout yet" affordances. Sent as soon as both the bridge and the lookup are
   * settled — a lookup that failed is reported as "no saved layout" rather than
   * held open, since the alternative is blocking a working canvas on an
   * unrelated API call.
   */
  useEffect(() => {
    if (!bridgeReady || initSentRef.current || savedLayout.isLoading) return;
    initSentRef.current = true;
    post({ type: "init", hasSavedLayout: savedLayout.data?.exists === true });
  }, [bridgeReady, post, savedLayout.isLoading, savedLayout.data]);

  const persistLayout = useCallback(
    async (message: Extract<RubinInboundMessage, { type: "layout-complete" }>) => {
      const site: RubinSiteIdentity = message.site ?? {
        parcelId: null,
        address: target.address,
        zone: null,
        lat: target.lat,
        lng: target.lng,
      };
      // Coordinates key the row. Rubin reports the ones it was opened with, but
      // fall back to this screen's own params rather than dropping the save.
      const lat = site.lat ?? target.lat;
      const lng = site.lng ?? target.lng;
      if (lat === null || lng === null) {
        console.warn("[rubin] layout-complete with no coordinates — not saved");
        return;
      }

      const saved = await saveRubinLayout(
        {
          site: { ...site, address: site.address ?? target.address, lat, lng },
          canonical: message.canonical,
          layout: message.layout,
          meta: {
            typology: message.typology,
            intensity: message.intensity,
            solverVersion: message.solverVersion,
            lotCount: message.lotCount,
          },
        },
        getApiHeaders(),
      );
      // Silent by design: the layout is on the canvas in front of the user
      // either way, and the retries have already run.
      if (!saved) console.warn("[rubin] layout save gave up after retries");
    },
    [getApiHeaders, target],
  );

  /**
   * Answer Rubin's "may this user generate?" question.
   *
   * The allowance is per account and the count is durable server-side, neither
   * of which Rubin can see — it has no auth and no database. Rubin blocks on
   * this answer, so it is always sent, including when the check itself fails.
   *
   * A failed check answers **allowed**. The cap exists to keep one account from
   * monopolising expensive solver time, not to protect anything, and refusing to
   * generate because our own API had a blip would break the feature to enforce
   * a fairness rule.
   */
  const answerGeneratePermission = useCallback(
    async (requestId: string) => {
      try {
        const quota = await claimRubinGenerateQuota(getApiHeaders());
        post({
          type: "generate-permission",
          requestId,
          allowed: quota.allowed,
          limit: quota.limit,
          remaining: quota.remaining,
          resetInSeconds: quota.resetInSeconds,
        });
      } catch (err) {
        console.warn("[rubin] generation allowance check failed — allowing:", err);
        post({ type: "generate-permission", requestId, allowed: true });
      }
    },
    [getApiHeaders, post],
  );

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseRubinMessage(event.nativeEvent.data);
      if (!message) return;

      switch (message.type) {
        case "ready":
          // State, not a ref: the effect above owns sending `init`, and it has
          // to re-evaluate when either this or the saved-layout lookup settles,
          // whichever lands second.
          setBridgeReady(true);
          break;

        case "site-ready": {
          setLoading(false);
          // Only now is there a projection to draw a restored layout against.
          const saved = savedLayout.data;
          if (!hydrateSentRef.current && saved?.exists && saved.layout) {
            hydrateSentRef.current = true;
            post({ type: "hydrate", layout: saved.layout, savedAt: saved.updatedAt ?? null });
          }
          break;
        }

        case "site-error":
          // Rubin shows its own message and its own Retry inside the canvas, so
          // the native overlay gets out of the way rather than covering it.
          setLoading(false);
          if (!message.retryable) setFailed(true);
          break;

        case "generate-permission-request":
          void answerGeneratePermission(message.requestId);
          break;

        case "layout-complete":
          void persistLayout(message);
          break;

        case "layout-error":
          console.warn("[rubin] generation failed during", message.failedState, message.message);
          break;

        case "hydrated":
          if (!message.ok) console.warn("[rubin] hydrate rejected:", message.message);
          break;

        default:
          break;
      }
    },
    [answerGeneratePermission, persistLayout, post, savedLayout.data],
  );

  const rubinOrigin = getRubinOrigin();

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
            // The bare origin MUST be listed alongside the wildcard. iOS matches
            // the whitelist against the origin with no trailing slash, so a list
            // of only `https://host/*` never matches — and a non-whitelisted URL
            // is handed to `Linking.openURL`, which is what was punting the
            // canvas out to Safari and leaving this screen on a dead spinner.
            originWhitelist={[rubinOrigin, `${rubinOrigin}*`]}
            onMessage={onMessage}
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
            onShouldStartLoadWithRequest={(request) => request.url.startsWith(rubinOrigin)}
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
