import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { translateForOS } from "@/lib/i18n";
import { buildRubinEmbedUrl, getRubinOrigin, hasRubinTarget } from "@/lib/rubin";
import { fetchSubdivisionSite, subdivisionSiteQueryKey } from "@/lib/subdivision";
import {
  buildRubinInjection,
  claimRubinGenerateQuota,
  fetchLatestRubinLayout,
  parseRubinMessage,
  saveRubinLayout,
  type RubinHapticStyle,
  type RubinInboundMessage,
  type RubinLayoutSummary,
  type RubinSiteIdentity,
} from "@/lib/rubinBridge";

/**
 * The one Rubin WebView, and the reason it does not live on a screen.
 *
 * ## Why a host instead of a route
 *
 * Rubin is a heavy canvas app: it boots a Next.js bundle, geocodes, fetches the
 * cadastral parcel, the three-waters network and the contour set, then draws all
 * of it. Cold, on mobile data, that is tens of seconds — and it used to start
 * the moment the user tapped "Generate layout", so the tap was followed by a
 * spinner every single time.
 *
 * Almost all of that work is knowable earlier — and the earliest moment it is
 * knowable is the one the user asks for the report, not the one it arrives. An
 * address is enough: `warmForAddress` puts it through the subdivision gate,
 * which answers both "which parcel is this" and "does Rubin cover it", and the
 * WebView starts loading **while the feasibility analysis is still running**.
 * By the time the report is on screen the canvas behind it is usually drawn, and
 * the tap that follows does not start a load: it moves it into view.
 *
 * The report-mount and Plan-tab warms are still there behind it, unchanged in
 * purpose: they cover the reports that never went through this screen's analyse
 * path, and they re-take the slot for the property the user actually opens out
 * of a combined group.
 *
 * That only works if the WebView is never remounted, which is exactly what a
 * route cannot promise — pushing `/rubin` mounts a fresh screen with a fresh
 * WebView and throws the warm one away. Hence a provider above the navigator
 * holding one instance whose *position* changes, never its identity.
 *
 * ## What warming does and does not do
 *
 * It loads the **site**. It never generates: a layout costs minutes of solver
 * time and one slot of a metered hourly allowance, and spending either without
 * a press would be spending the user's money on a guess. Generation still
 * starts inside Rubin, on the user's Generate.
 *
 * ## Keeping the promotion free
 *
 * The canvas box is sized from the window and the insets, identically whether it
 * is warming or presented, and the header's height is reserved either way. So
 * promotion changes one offset and nothing else: no resize, so no reprojection,
 * no reflow of the drawing, and no visible settle. Getting this wrong is not
 * cosmetic — a resize rebuilds the projection and redraws every layer, which is
 * the very cost the warm-up exists to avoid.
 */

/** Rubin's canvas is a dark drafting surface; the frame matches it exactly. */
const RUBIN_CANVAS_BG = "#111827";
const HEADER_HEIGHT = 48;

/**
 * Backstop for the load gate.
 *
 * Normally cleared by Rubin's own `site-ready`, the only honest signal that the
 * canvas is drawn. A Rubin that never gets that far — a bundle that fails to
 * parse, a build predating the bridge — would otherwise leave a presented
 * session on a spinner forever. Comfortably longer than a slow cold load
 * (parcel + contours + pipes over mobile data).
 */
const SITE_READY_WATCHDOG_MS = 90_000;

export interface RubinTarget {
  address?: string | null;
  /** Preferred when known: re-geocoding an address can land on a neighbour. */
  lat?: number | null;
  lng?: number | null;
  /**
   * LINZ parcel id, from the subdivision gate. The site's real identity — see
   * {@link sessionKey} — and the key saved layouts are stored under.
   */
  parcelId?: string | null;
}

interface RubinHostApi {
  /**
   * Start loading this site in the background, if nothing better is loading.
   *
   * Idempotent per target and deliberately timid: a report is not a promise that
   * the user wants a layout, so an existing session is left alone unless
   * `force` is set. `force` is for the stronger signal — the user has the Plan
   * tab open on *this* property — which should take the warm slot from whatever
   * a combined report warmed first.
   */
  warm: (target: RubinTarget, options?: { force?: boolean }) => void;
  /**
   * The same, from an address alone — for callers that have nothing else yet.
   *
   * Resolves the parcel through the subdivision gate first, and warms only if
   * Rubin covers it. That is the whole point: the caller is the chat screen at
   * the moment a feasibility analysis is requested, which knows an address
   * string and no coordinates, and must not open a canvas onto a site Rubin
   * will refuse. Fire-and-forget — nothing waits on it and every failure is
   * swallowed.
   */
  warmForAddress: (address: string | null | undefined, options?: { force?: boolean }) => void;
  /** Bring Rubin to the front for this site, loading it first if it is not warm. */
  present: (target: RubinTarget) => void;
}

const RubinHostContext = createContext<RubinHostApi | null>(null);

export function useRubinHost(): RubinHostApi {
  const api = useContext(RubinHostContext);
  if (!api) throw new Error("useRubinHost must be used inside <RubinHostProvider>");
  return api;
}

type SessionPhase = "loading" | "ready" | "failed";

interface RubinSession {
  /** Site identity. Every state update is guarded on it, so a message from a
   *  superseded WebView cannot write into the current session. */
  key: string;
  target: RubinTarget;
  /** Bumped by a retry, and the only thing that remounts the WebView. */
  attempt: number;
  phase: SessionPhase;
  /** False only when Rubin says another attempt cannot possibly help. */
  retryable: boolean;
  /** Rubin has published its bridge; queued messages can go out. */
  bridgeReady: boolean;
}

/**
 * Identity of a site — the parcel if we know it, else the point, else the words.
 *
 * ## Why the parcel and not the coordinates
 *
 * This key is what decides whether a `warm` is free or throws a loaded canvas
 * away, so the places that warm one site — the analyse intent, the report mount,
 * the Plan tab — have to agree on it. They cannot agree on coordinates: each
 * looks the parcel up from whatever point it has, and Rubin's `/site` reports
 * back the point it was ASKED about rather than the middle of what it found. So
 * the intent, which has only an address, gets LINZ's geocode of that address,
 * while the two later callers get the site plan's centre. Same parcel, different
 * numbers, and on a coordinate key the second warm would remount the WebView and
 * discard the load the first one had been running for minutes.
 *
 * The parcel id is what all three actually resolved, and it is the same string
 * every time — it is also what the server stores layouts under. Rubin
 * synthesises an `nztm:{e},{n}` id for a parcel LINZ gave none, and those ARE
 * point-derived: two lookups of such a site from different points miss each
 * other. That is exactly the behaviour this key had before, and it can never
 * merge two genuinely different sites, so it is left to degrade quietly.
 *
 * Six decimal places on the coordinate fallback is ~0.1 m — far finer than a
 * parcel. Address alone is the last resort, for a target that got neither.
 */
function sessionKey(target: RubinTarget): string {
  const { lat, lng, address, parcelId } = target;
  const parcel = parcelId?.trim();
  if (parcel) return `parcel:${parcel}`;
  if (typeof lat === "number" && typeof lng === "number") {
    return `${lat.toFixed(6)},${lng.toFixed(6)}`;
  }
  return `addr:${(address ?? "").trim().toLowerCase()}`;
}

/**
 * Cache key for a site's saved layout.
 *
 * One function rather than two literals because both the lookup and the
 * post-generation write below have to name the *same* entry, and a key that
 * drifted by one `?? null` would fail silently — the write would land on an
 * entry nothing reads, and the restore it exists to fix would still not happen.
 */
function layoutQueryKey(target: RubinTarget | null | undefined) {
  return [
    "rubin-layout",
    target?.parcelId ?? null,
    target?.lat ?? null,
    target?.lng ?? null,
  ] as const;
}

/** Normalised so a session's target cannot carry `undefined` into a URL. */
function normaliseTarget(target: RubinTarget): RubinTarget {
  return {
    address: target.address?.trim() ? target.address.trim() : null,
    lat: typeof target.lat === "number" && Number.isFinite(target.lat) ? target.lat : null,
    lng: typeof target.lng === "number" && Number.isFinite(target.lng) ? target.lng : null,
    parcelId: target.parcelId?.trim() ? target.parcelId.trim() : null,
  };
}

const HAPTIC_IMPACT: Record<string, Haptics.ImpactFeedbackStyle> = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
};

export function RubinHostProvider({ children }: { children: React.ReactNode }) {
  const { getApiHeaders } = useAuth();
  const queryClient = useQueryClient();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const webViewRef = useRef<WebView>(null);

  const [session, setSession] = useState<RubinSession | null>(null);
  const [presented, setPresented] = useState(false);
  /**
   * Which session's `init`/`hydrate` have already gone out.
   *
   * Keyed rather than a pair of booleans: the session can be replaced between a
   * message being received and the effect that answers it running, and a stale
   * "already sent" would silently cost the next site its saved layout.
   */
  const sentRef = useRef<{ key: string; init: boolean; hydrate: boolean }>({
    key: "",
    init: false,
    hydrate: false,
  });

  const sessionRef = useRef<RubinSession | null>(null);
  sessionRef.current = session;
  const presentedRef = useRef(false);
  presentedRef.current = presented;

  const rubinOrigin = getRubinOrigin();
  const sourceUri = useMemo(
    () => (session ? buildRubinEmbedUrl(session.target) : null),
    // The key IS the target's identity, so this is the whole dependency.
    [session?.key],
  );
  /**
   * Memoised as an object, not just a string.
   *
   * `react-native-webview` takes `source` as a prop and reloads when it changes;
   * a fresh `{ uri }` literal on every render has, across versions, been enough
   * to trigger that. This host re-renders for reasons that have nothing to do
   * with the page — a query settling, a session flag, a rotation — and any one of
   * those reloading the canvas would discard exactly the work being warmed. One
   * stable object means React does not even send the prop down again.
   */
  const source = useMemo(() => (sourceUri ? { uri: sourceUri } : undefined), [sourceUri]);

  // ── Session control ──────────────────────────────────────────────────────

  const startSession = useCallback((target: RubinTarget) => {
    const normalised = normaliseTarget(target);
    const key = sessionKey(normalised);
    sentRef.current = { key, init: false, hydrate: false };
    setSession({
      key,
      target: normalised,
      attempt: 0,
      phase: "loading",
      retryable: true,
      bridgeReady: false,
    });
  }, []);

  const warm = useCallback(
    (target: RubinTarget, options?: { force?: boolean }) => {
      const normalised = normaliseTarget(target);
      if (!hasRubinTarget(normalised)) return;
      const key = sessionKey(normalised);
      const current = sessionRef.current;
      if (current?.key === key) return;
      // Never pull the canvas out from under a user who is looking at it.
      if (current && presentedRef.current) return;
      if (current && !options?.force) return;
      startSession(normalised);
    },
    [startSession],
  );

  const warmForAddress = useCallback(
    (address: string | null | undefined, options?: { force?: boolean }) => {
      const trimmed = address?.trim();
      if (!trimmed) return;

      void (async () => {
        try {
          // Through the query cache, not a bare fetch. Analysing the same
          // property twice inside the hour reuses the answer instead of paying
          // for the lookup again, and two calls that overlap are deduped into
          // one request — while a *repeat* still re-warms, which is what takes
          // the slot back from whatever the user looked at in between.
          const gate = await queryClient.fetchQuery({
            queryKey: subdivisionSiteQueryKey({ address: trimmed }),
            staleTime: 60 * 60 * 1000,
            queryFn: () => fetchSubdivisionSite({ address: trimmed }, getApiHeaders()),
          });
          if (gate.supported !== true) return;
          // Rubin's own resolved address and the parcel it landed on, never the
          // caller's raw string: the address is the canonical LINZ form, and the
          // parcel id is what makes the later warms for this same site free. See
          // the note on `sessionKey`.
          warm(
            {
              address: gate.site.address,
              lat: gate.site.centroid.lat,
              lng: gate.site.centroid.lng,
              parcelId: gate.site.parcelId,
            },
            options,
          );
        } catch {
          // A head start, not a feature. The Plan tab still owns the visible
          // loading, error and retry UI, and a warm that never happened costs
          // the user only the wait they used to have.
        }
      })();
    },
    [getApiHeaders, queryClient, warm],
  );

  const present = useCallback(
    (target: RubinTarget) => {
      const normalised = normaliseTarget(target);
      const key = sessionKey(normalised);
      const current = sessionRef.current;
      if (!current || current.key !== key) {
        startSession(normalised);
      } else if (current.phase === "failed") {
        // A background load that quietly failed is not the user's error to see.
        // Warming never retries on its own — battery — so the tap is the retry.
        sentRef.current = { key, init: false, hydrate: false };
        setSession({
          ...current,
          attempt: current.attempt + 1,
          phase: "loading",
          retryable: true,
          bridgeReady: false,
        });
      }
      setPresented(true);
    },
    [startSession],
  );

  const dismiss = useCallback(() => {
    // The session stays alive on purpose: the drawing — including a layout the
    // user just spent minutes generating — is still on that canvas, and coming
    // back to it should cost nothing.
    setPresented(false);
  }, []);

  const retry = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    sentRef.current = { key: current.key, init: false, hydrate: false };
    setSession({
      ...current,
      attempt: current.attempt + 1,
      phase: "loading",
      retryable: true,
      bridgeReady: false,
    });
  }, []);

  /** Key-guarded update, so a superseded WebView's message lands nowhere. */
  const patchSession = useCallback((key: string, patch: Partial<RubinSession>) => {
    setSession((current) => (current && current.key === key ? { ...current, ...patch } : current));
  }, []);

  // Android's hardware back closes Rubin rather than the screen behind it.
  useEffect(() => {
    if (!presented) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      dismiss();
      return true;
    });
    return () => subscription.remove();
  }, [dismiss, presented]);

  // ── Saved layout ─────────────────────────────────────────────────────────

  /**
   * The user's saved layout for this site, fetched alongside the WebView boot so
   * it is in hand well before Rubin says it is ready. Full form, not summary:
   * this one is going to be drawn.
   */
  const savedLayout = useQuery({
    queryKey: layoutQueryKey(session?.target),
    enabled: Boolean(session && session.target.lat !== null && session.target.lng !== null),
    // A layout only changes when this user generates one, and that arrives
    // through the bridge rather than through this query — so `persistLayout`
    // writes the result straight into this entry rather than leaving it to a
    // refetch that has no trigger to fire it.
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: () =>
      fetchLatestRubinLayout(
        {
          lat: session!.target.lat as number,
          lng: session!.target.lng as number,
          // Sent whenever we have it. The server stores a layout under
          // `parcel:{id}` when the save carried one and falls back to an 11 m
          // geo key otherwise — so a lookup that omits the id can only match by
          // coordinate, and this session's coordinates now depend on which
          // caller warmed it first. The id does not.
          parcelId: session!.target.parcelId ?? undefined,
        },
        getApiHeaders(),
      ),
  });

  const post = useCallback((message: Parameters<typeof buildRubinInjection>[0]) => {
    webViewRef.current?.injectJavaScript(buildRubinInjection(message));
  }, []);

  /**
   * `init` tells Rubin whether a hydrate is coming, so it can skip its "no
   * layout yet" affordances. Sent as soon as both the bridge and the lookup have
   * settled — a lookup that *failed* is reported as "no saved layout" rather
   * than held open, since the alternative is blocking a working canvas on an
   * unrelated API call.
   */
  useEffect(() => {
    if (!session?.bridgeReady || savedLayout.isLoading) return;
    if (sentRef.current.key !== session.key || sentRef.current.init) return;
    sentRef.current.init = true;
    post({ type: "init", hasSavedLayout: savedLayout.data?.exists === true });
  }, [post, savedLayout.data, savedLayout.isLoading, session?.bridgeReady, session?.key]);

  // ── Watchdog ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!session || session.phase !== "loading") return;
    const key = session.key;
    const timer = setTimeout(() => {
      console.warn("[rubin] no site-ready within the watchdog window");
      patchSession(key, { phase: "failed" });
    }, SITE_READY_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [patchSession, session?.attempt, session?.key, session?.phase]);

  // ── Bridge ───────────────────────────────────────────────────────────────

  const persistLayout = useCallback(
    async (message: Extract<RubinInboundMessage, { type: "layout-complete" }>, target: RubinTarget) => {
      const site: RubinSiteIdentity = message.site ?? {
        parcelId: null,
        address: target.address ?? null,
        zone: null,
        lat: target.lat ?? null,
        lng: target.lng ?? null,
      };
      // Coordinates key the row. Rubin reports the ones it was opened with, but
      // fall back to this session's own target rather than dropping the save.
      const lat = site.lat ?? target.lat ?? null;
      const lng = site.lng ?? target.lng ?? null;
      if (lat === null || lng === null) {
        console.warn("[rubin] layout-complete with no coordinates — not saved");
        return;
      }

      const saved = await saveRubinLayout(
        {
          site: { ...site, address: site.address ?? target.address ?? null, lat, lng },
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

      /**
       * Record the new layout as this site's restorable one.
       *
       * The lookup above is fetched once per site and has nothing that would
       * ever refetch it — no interval, no refocus trigger, and a `staleTime`
       * that only matters to a refetch that never comes. So without this write
       * it keeps answering with the "no saved layout" it got *before* this run,
       * and the next remount of this same session — a Retry, or a `present` on
       * a session that had quietly failed — rebuilds the canvas empty and asks
       * for no hydrate. The layout is safely in the database; the host just
       * never looks, which reads as work lost rather than a stale cache.
       *
       * Written from the run we just watched rather than by invalidating, for
       * two reasons: a refetch would drag the geometry back down over mobile
       * data seconds after sending it up, and it would be wrong for the two
       * cases where the server has nothing to give back — a guest, whose save
       * feeds the corpus but leaves no per-account row, and a save that failed
       * outright. In both, this canvas holds the only copy of the layout that
       * exists, which is precisely when a remount must be able to restore it.
       * Nothing here grants durable storage: the entry lives and dies with this
       * provider, exactly like the canvas it mirrors.
       */
      const restorable: RubinLayoutSummary = {
        exists: true,
        layout: message.layout,
        updatedAt: new Date().toISOString(),
        lotCount: message.lotCount,
        intensity: message.intensity,
        typology: message.typology,
        solverVersion: message.solverVersion,
      };
      queryClient.setQueryData(layoutQueryKey(target), restorable);
    },
    [getApiHeaders, queryClient],
  );

  /**
   * Answer Rubin's "may this user generate?" question.
   *
   * The allowance is per account and the count is durable server-side, neither of
   * which Rubin can see — it has no auth and no database. Rubin blocks on this
   * answer, so it is always sent, including when the check itself fails.
   *
   * A failed check answers **allowed**. The cap exists to keep one account from
   * monopolising expensive solver time, not to protect anything, and refusing to
   * generate because our own API had a blip would break the feature to enforce a
   * fairness rule.
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

  /**
   * Tick the phone for Rubin's density slider.
   *
   * Only while presented. A warming WebView is a background page the user cannot
   * see or touch, and a buzz from one would be a phantom vibration during
   * something else entirely. Failures are swallowed: a device with haptics
   * disabled rejects these, which is the user's choice, not an error.
   */
  const tapHaptic = useCallback((style: RubinHapticStyle) => {
    if (!presentedRef.current) return;
    const impact = HAPTIC_IMPACT[style];
    const request = impact !== undefined
      ? Haptics.impactAsync(impact)
      : Haptics.selectionAsync();
    void request.catch(() => {});
  }, []);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseRubinMessage(event.nativeEvent.data);
      const current = sessionRef.current;
      if (!message || !current) return;
      const key = current.key;

      switch (message.type) {
        case "ready":
          // State, not a ref: the `init` effect above owns sending it, and has
          // to re-evaluate when either this or the saved-layout lookup settles,
          // whichever lands second.
          patchSession(key, { bridgeReady: true });
          break;

        case "site-ready": {
          patchSession(key, { phase: "ready" });
          // Only now is there a projection to draw a restored layout against.
          const saved = savedLayout.data;
          if (sentRef.current.key === key && !sentRef.current.hydrate && saved?.exists && saved.layout) {
            sentRef.current.hydrate = true;
            post({ type: "hydrate", layout: saved.layout, savedAt: saved.updatedAt ?? null });
          }
          break;
        }

        case "site-error":
          // Failed either way, and this frame says so rather than deferring to
          // Rubin's in-canvas retry. A warming session that hit an error the user
          // never saw must come back as "failed", because that is what makes the
          // next tap remount and try again — reporting it as ready would present
          // an empty canvas and a stale message. `retryable` decides only whether
          // the overlay offers a button: an address that matched nothing will
          // match nothing again.
          patchSession(key, { phase: "failed", retryable: message.retryable });
          break;

        case "generate-permission-request":
          void answerGeneratePermission(message.requestId);
          break;

        case "haptic":
          tapHaptic(message.style);
          break;

        case "layout-complete":
          void persistLayout(message, current.target);
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
    [answerGeneratePermission, patchSession, persistLayout, post, savedLayout.data, tapHaptic],
  );

  // ── Layout ───────────────────────────────────────────────────────────────

  const headerBlock = insets.top + HEADER_HEIGHT;
  // Fixed for the life of the session, presented or not — see the note at the
  // top of this file about why a promotion must not resize the canvas.
  const canvasHeight = Math.max(120, windowHeight - headerBlock);

  const api = useMemo<RubinHostApi>(
    () => ({ warm, warmForAddress, present }),
    [warm, warmForAddress, present],
  );

  const targetIsUsable = session ? hasRubinTarget(session.target) : false;
  const showSpinner = presented && session?.phase === "loading" && targetIsUsable;
  const showError = presented && session !== null && (session.phase === "failed" || !targetIsUsable);

  return (
    <RubinHostContext.Provider value={api}>
      {children}
      {session && sourceUri ? (
        <View
          style={[
            styles.host,
            { width: windowWidth, height: windowHeight },
            // Presented, this layer is the last child of the provider, so it
            // paints over the navigator without needing to be lifted. Parked, it
            // is a full screen to the left: off-screen rather than hidden or
            // zero-sized, because a WebView with no size never lays out and one
            // parked *behind* the app would show through any screen that is not
            // fully opaque. Its size — and therefore its canvas and projection —
            // are identical in both states.
            presented ? { left: 0 } : { left: -windowWidth - 32 },
          ]}
          pointerEvents={presented ? "auto" : "none"}
          // Nothing here is meaningful to a screen reader while it is parked,
          // and an off-screen canvas in the focus order is a trap.
          accessibilityElementsHidden={!presented}
          importantForAccessibility={presented ? "auto" : "no-hide-descendants"}
        >
          <View style={[styles.header, { height: headerBlock, paddingTop: insets.top }]}>
            {presented ? (
              <>
                {/* The header runs under the status bar and is always dark, so
                    the clock has to be light regardless of the app's theme. */}
                <StatusBar style="light" />
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={dismiss}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={translateForOS("rubin.back")}
                  // Comfortably above the 44pt minimum without widening the chip.
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Feather name="chevron-left" size={20} color="#FFFFFF" />
                  <Text style={styles.backText}>{translateForOS("rubin.back")}</Text>
                </TouchableOpacity>

                <Text style={styles.headerTitle} numberOfLines={1}>
                  {session.target.address ?? translateForOS("rubin.title")}
                </Text>

                {/* Balances the back button so the title stays optically centred. */}
                <View style={styles.headerSpacer} />
              </>
            ) : null}
          </View>

          <View style={[styles.canvas, { width: windowWidth, height: canvasHeight }]}>
            {targetIsUsable ? (
              <WebView
                // Identity is the site and the retry count ONLY. Anything else in
                // here — presented, dimensions — would remount the WebView on
                // promotion and throw away the very load this host exists to keep.
                key={`${session.key}:${session.attempt}`}
                ref={webViewRef}
                source={source}
                style={styles.webView}
                // Both carry the canvas colour so no white frame shows during
                // load; the WebView itself has no `backgroundColor` prop.
                containerStyle={styles.webViewContainer}
                // The bare origin MUST be listed alongside the wildcard. iOS
                // matches the whitelist against the origin with no trailing
                // slash, so a list of only `https://host/*` never matches — and a
                // non-whitelisted URL is handed to `Linking.openURL`, which is
                // what was punting the canvas out to Safari.
                originWhitelist={[rubinOrigin, `${rubinOrigin}*`]}
                onMessage={onMessage}
                onError={() => patchSession(session.key, { phase: "failed" })}
                onHttpError={({ nativeEvent }) => {
                  // Sub-resource 4xx/5xx also surface here; only a failure of the
                  // document itself means the canvas will not appear.
                  if (nativeEvent.url === sourceUri) {
                    patchSession(session.key, { phase: "failed" });
                  }
                }}
                // Rubin drives its own pinch/pan on the canvas. Leaving the
                // WebView's zoom on would fight those gestures and let the user
                // scale the page away from the drawing.
                scalesPageToFit={false}
                setBuiltInZoomControls={false}
                scrollEnabled={false}
                bounces={false}
                overScrollMode="never"
                javaScriptEnabled
                domStorageEnabled
                // Keeps navigation inside Rubin; anything else is not ours to render.
                onShouldStartLoadWithRequest={(request) => request.url.startsWith(rubinOrigin)}
                // Rubin is a heavy canvas; on Android the default renderer can
                // drop the surface when the view is briefly detached.
                androidLayerType={Platform.OS === "android" ? "hardware" : undefined}
              />
            ) : null}

            {showSpinner ? (
              <View style={styles.overlay} pointerEvents="none">
                <ActivityIndicator color="#A78BFA" />
                <Text style={styles.overlayText}>{translateForOS("rubin.loading")}</Text>
              </View>
            ) : null}

            {showError ? (
              <View style={styles.overlay}>
                <Feather name="alert-circle" size={22} color="#9CA3AF" />
                <Text style={styles.overlayText}>
                  {targetIsUsable
                    ? translateForOS("rubin.failed")
                    : translateForOS("rubin.no_target")}
                </Text>
                {targetIsUsable && session.retryable ? (
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
        </View>
      ) : null}
    </RubinHostContext.Provider>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    backgroundColor: RUBIN_CANVAS_BG,
  },
  header: {
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
