import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
  useFonts,
} from "@expo-google-fonts/dm-sans";
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
} from "@expo-google-fonts/space-grotesk";
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from "@expo-google-fonts/fraunces";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import Constants from "expo-constants";
import { Stack, usePathname, useRouter, useSegments } from "expo-router";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { Alert, AppState, DeviceEventEmitter, Platform, type AppStateStatus } from "react-native";
import { Settings } from "react-native-fbsdk-next";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatProvider } from "@/context/ChatContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { DmProvider } from "@/context/DmContext";
import { NotificationProvider } from "@/context/NotificationContext";
import { RubinHostProvider } from "@/context/RubinHostContext";
import { NewsProvider } from "@/context/NewsContext";
import { WatchlistProvider } from "@/context/WatchlistContext";
import { getApiBase } from "@/lib/api";
import { configureAppIconBadgesAsync } from "@/lib/appBadge";
import { parseShareTokenFromUrl, storePendingShareToken } from "@/lib/propertyShares";
import { initializeRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";
import { getCurrentLocale, LocaleProvider, LocaleSync } from "@/lib/i18n";
import {
  isInitialBootstrapRoute,
  isPendingNewsDestination,
  parsePendingNewsNavigation,
  pendingNewsNavigationFromData,
  PENDING_NEWS_NAVIGATION_KEY,
  type PendingNewsNavigation,
} from "@/lib/newsNotificationNavigation";

SplashScreen.preventAutoHideAsync();

initializeRevenueCat();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const queryClient = new QueryClient();

function MetaSdkSetup() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    let mounted = true;
    let initialized = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function showSdkError(error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      Alert.alert("SDK Error", message);
    }

    async function initializeMetaSdk() {
      if (!mounted || initialized) return;
      initialized = true;

      try {
        Settings.setAutoLogAppEventsEnabled(false);
        Settings.initializeSDK();

        const { status } = await requestTrackingPermissionsAsync();
        if (!mounted) return;

        if (status === "granted") {
          await Settings.setAdvertiserTrackingEnabled(true);
        }
      } catch (error) {
        if (mounted) showSdkError(error);
      }
    }

    function scheduleInitialize() {
      if (timer || initialized) return;
      timer = setTimeout(() => {
        timer = null;
        void initializeMetaSdk();
      }, 1000);
    }

    function handleAppStateChange(state: AppStateStatus) {
      if (state === "active") scheduleInitialize();
    }

    if (AppState.currentState === "active") {
      scheduleInitialize();
    }
    const appStateSub = AppState.addEventListener("change", handleAppStateChange);

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      appStateSub.remove();
    };
  }, []);

  return null;
}

function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { isSubscriptionIdentityReady } = useAuth();
  return (
    <SubscriptionProvider identityReady={isSubscriptionIdentityReady}>
      {children}
    </SubscriptionProvider>
  );
}

function SplashUntilReady({ fontsReady }: { fontsReady: boolean }) {
  const { isLoading } = useAuth();

  useEffect(() => {
    if (fontsReady && !isLoading) {
      void SplashScreen.hideAsync();
    }
  }, [fontsReady, isLoading]);

  return null;
}

function NotificationSetup() {
  const { getApiHeaders, isLoading, anonymousInstallId, newsGuestSessionId, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const checkedInitialNotificationRef = useRef(false);
  const handledNotificationIdsRef = useRef<Set<string>>(new Set());
  const syncedNewsIdentityRef = useRef<string | null>(null);
  const registeredPushIdentityRef = useRef<string | null>(null);
  const pushOpenLoggedRef = useRef<Set<string>>(new Set());
  const newsDestinationStableRef = useRef<{ postId: string; since: number } | null>(null);
  const [pendingNewsNavigation, setPendingNewsNavigation] = useState<PendingNewsNavigation | null>(null);
  const [pendingNavigationHydrated, setPendingNavigationHydrated] = useState(false);
  const [navigationAttempt, setNavigationAttempt] = useState(0);
  const [pendingInitialNotification, setPendingInitialNotification] = useState<{
    data: Record<string, unknown>;
    notificationId: string;
  } | null>(null);

  const queueNewsNavigation = useCallback((data: Record<string, unknown> | undefined, notificationId?: string): boolean => {
    const pending = pendingNewsNavigationFromData(data, notificationId);
    if (!pending) return false;
    if (pending.notificationId && handledNotificationIdsRef.current.has(pending.notificationId)) return true;
    if (pending.notificationId) handledNotificationIdsRef.current.add(pending.notificationId);
    newsDestinationStableRef.current = null;
    setPendingNewsNavigation(pending);
    setNavigationAttempt(0);
    void AsyncStorage.setItem(PENDING_NEWS_NAVIGATION_KEY, JSON.stringify(pending))
      .then(() => Notifications.clearLastNotificationResponseAsync())
      .catch(() => undefined);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(PENDING_NEWS_NAVIGATION_KEY)
      .then((raw) => {
        const restored = parsePendingNewsNavigation(raw);
        if (!cancelled && restored) {
          if (restored.notificationId) handledNotificationIdsRef.current.add(restored.notificationId);
          setPendingNewsNavigation((current) => current ?? restored);
        }
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setPendingNavigationHydrated(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (checkedInitialNotificationRef.current) return;
    checkedInitialNotificationRef.current = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const data = response.notification.request.content.data as Record<string, unknown>;
        const notificationId = response.notification.request.identifier;
        if (!queueNewsNavigation(data, notificationId)) {
          setPendingInitialNotification({ data, notificationId });
        }
      })
      .catch(() => undefined);
  }, [queueNewsNavigation]);

  useEffect(() => {
    if (
      isLoading
      || !anonymousInstallId
      || !newsGuestSessionId
      || !pendingNavigationHydrated
      || !pendingNewsNavigation
      || isInitialBootstrapRoute(segments.map(String))
    ) return;

    if (isPendingNewsDestination(pathname, pendingNewsNavigation.postId)) {
      const stable = newsDestinationStableRef.current;
      if (!stable || stable.postId !== pendingNewsNavigation.postId) {
        newsDestinationStableRef.current = { postId: pendingNewsNavigation.postId, since: Date.now() };
        const stableTimer = setTimeout(() => setNavigationAttempt((attempt) => attempt + 1), 2_000);
        return () => clearTimeout(stableTimer);
      }
      const stableForMs = Date.now() - stable.since;
      if (stableForMs < 2_000) {
        const stableTimer = setTimeout(
          () => setNavigationAttempt((attempt) => attempt + 1),
          2_000 - stableForMs,
        );
        return () => clearTimeout(stableTimer);
      }
      const trackingKey = pendingNewsNavigation.notificationId ?? `${pendingNewsNavigation.postId}:${pendingNewsNavigation.queuedAt}`;
      if (!pushOpenLoggedRef.current.has(trackingKey)) {
        pushOpenLoggedRef.current.add(trackingKey);
        void fetch(`${getApiBase()}/news/${encodeURIComponent(pendingNewsNavigation.postId)}/push-open`, {
          method: "POST",
          headers: getApiHeaders(),
        }).catch(() => undefined);
      }
      void AsyncStorage.removeItem(PENDING_NEWS_NAVIGATION_KEY);
      void Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
      setPendingNewsNavigation(null);
      return;
    }

    newsDestinationStableRef.current = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const routeTimer = setTimeout(() => {
      router.replace({
        pathname: "/news/[postId]",
        params: { postId: pendingNewsNavigation.postId, source: "push" },
      } as never);
      retryTimer = setTimeout(() => setNavigationAttempt((attempt) => attempt + 1), 1_000);
    }, navigationAttempt === 0 ? 75 : 250);

    return () => {
      clearTimeout(routeTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    anonymousInstallId,
    getApiHeaders,
    isLoading,
    navigationAttempt,
    newsGuestSessionId,
    pathname,
    pendingNavigationHydrated,
    pendingNewsNavigation,
    router,
    segments,
  ]);

  useEffect(() => {
    if (isLoading || !anonymousInstallId || !newsGuestSessionId) return;
    const segmentNames = segments.map(String);
    const leaf = segmentNames[segmentNames.length - 1];
    const onHome = segmentNames.includes("(tabs)") && (leaf === "(tabs)" || leaf === "index" || leaf === "home");
    const newsIdentity = user?.id ? `user:${user.id}:${newsGuestSessionId}` : `guest:${newsGuestSessionId}`;
    let cancelled = false;
    let registrationRetryTimer: ReturnType<typeof setTimeout> | null = null;

    function scheduleRegistrationRetry() {
      if (cancelled || registrationRetryTimer) return;
      registrationRetryTimer = setTimeout(() => {
        registrationRetryTimer = null;
        void registerPushToken();
      }, 15_000);
    }

    async function registerPushToken() {
      if (Platform.OS === "web") return;
      try {
        if (syncedNewsIdentityRef.current !== newsIdentity) {
          // Claim/merge a guest session once when identity changes, rather than
          // repeating that transaction on every navigation event.
          syncedNewsIdentityRef.current = newsIdentity;
          const sessionResponse = await fetch(`${getApiBase()}/news/session`, { method: "POST", headers: getApiHeaders(), body: "{}" });
          if (!sessionResponse.ok) {
            if (syncedNewsIdentityRef.current === newsIdentity) syncedNewsIdentityRef.current = null;
            scheduleRegistrationRetry();
            return;
          }
        }
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          if (!onHome) return;
          const promptKey = "@devfeasible/news_push_permission_requested";
          if (await AsyncStorage.getItem(promptKey)) return;
          await AsyncStorage.setItem(promptKey, "1");
          const { status } = await Notifications.requestPermissionsAsync({
            ios: {
              allowAlert: true,
              allowBadge: true,
              allowSound: true,
            },
          });
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        const registrationIdentity = `${newsIdentity}:${getCurrentLocale()}`;
        if (registeredPushIdentityRef.current === registrationIdentity) return;
        registeredPushIdentityRef.current = registrationIdentity;

        await configureAppIconBadgesAsync();

        const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
        if (!projectId) throw new Error("EAS project ID is unavailable");
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        const pushToken = tokenData.data;
        const platform = Platform.OS === "ios" ? "ios" : "android";

        const registrationResponse = await fetch(`${getApiBase()}/news/push-token`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ token: pushToken, platform, locale: getCurrentLocale() }),
        });
        if (!registrationResponse.ok && registeredPushIdentityRef.current === registrationIdentity) {
          registeredPushIdentityRef.current = null;
          scheduleRegistrationRetry();
        }
      } catch {
        if (syncedNewsIdentityRef.current === newsIdentity) syncedNewsIdentityRef.current = null;
        registeredPushIdentityRef.current = null;
        scheduleRegistrationRetry();
      }
    }

    void registerPushToken();
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void registerPushToken();
    });

    const openFromNotificationData = (data: Record<string, unknown> | undefined, notificationId?: string) => {
      if (!data || typeof data !== "object") return;
      if (queueNewsNavigation(data, notificationId)) return;
      if (notificationId) {
        if (handledNotificationIdsRef.current.has(notificationId)) return;
        handledNotificationIdsRef.current.add(notificationId);
      }
      const type = typeof data.type === "string" ? data.type : undefined;
      const threadId = typeof data.threadId === "string" ? data.threadId : undefined;
      if (type === "report_ready") {
        DeviceEventEmitter.emit("projectAlpha:backgroundJobsReady", { type });
        router.push("/(tabs)/history" as never);
        return;
      }
      if (type === "screening_ready") {
        DeviceEventEmitter.emit("projectAlpha:backgroundJobsReady", { type });
        router.push("/(tabs)" as never);
        return;
      }
      if (type === "watchlist_change") {
        DeviceEventEmitter.emit("projectAlpha:notificationsChanged");
        router.push({ pathname: "/(tabs)/history", params: { tab: "watchlist" } } as never);
        return;
      }
      if (threadId) {
        router.push(`/chat/${threadId}` as never);
      }
    };

    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const type = data && typeof data.type === "string" ? data.type : undefined;
      if (type === "report_ready" || type === "screening_ready") {
        DeviceEventEmitter.emit("projectAlpha:backgroundJobsReady", { type });
      }
      if (type === "report_ready" || type === "screening_ready" || type === "watchlist_change") {
        DeviceEventEmitter.emit("projectAlpha:notificationsChanged");
      }
      if (type === "news_post") DeviceEventEmitter.emit("projectAlpha:newsChanged");
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromNotificationData(
        response.notification.request.content.data as Record<string, unknown>,
        response.notification.request.identifier,
      );
    });

    if (pendingInitialNotification) {
      openFromNotificationData(pendingInitialNotification.data, pendingInitialNotification.notificationId);
      setPendingInitialNotification(null);
    }

    return () => {
      cancelled = true;
      if (registrationRetryTimer) clearTimeout(registrationRetryTimer);
      appStateSubscription.remove();
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [anonymousInstallId, getApiHeaders, isLoading, newsGuestSessionId, pendingInitialNotification, queueNewsNavigation, router, segments, user?.id]);

  return null;
}

function ShareLinkSetup() {
  const { isLoading } = useAuth();
  const router = useRouter();
  const checkedInitialUrlRef = useRef(false);
  const [pendingRouteToken, setPendingRouteToken] = useState<string | null>(null);

  const routeToShareEntry = useCallback(() => {
    // The nonce forces the (tabs) pending-share effect to re-run even when the
    // chat tab is already mounted (warm start via universal link) — a bare
    // replace to the same route would not re-fire it and the stored token
    // would sit unconsumed until the next cold start.
    router.replace({ pathname: "/(tabs)", params: { shareCheck: String(Date.now()) } } as never);
  }, [router]);

  const handleShareUrl = useCallback(async (url: string | null | undefined) => {
    const token = parseShareTokenFromUrl(url);
    if (!token) return;
    try {
      await storePendingShareToken(token);
      setPendingRouteToken(token);
      if (!isLoading) routeToShareEntry();
    } catch {
      // A bad link should not block normal app startup.
    }
  }, [isLoading, routeToShareEntry]);

  useEffect(() => {
    const sub = Linking.addEventListener("url", (event) => {
      void handleShareUrl(event.url);
    });
    return () => sub.remove();
  }, [handleShareUrl]);

  useEffect(() => {
    if (isLoading || checkedInitialUrlRef.current) return;
    checkedInitialUrlRef.current = true;
    Linking.getInitialURL().then(handleShareUrl).catch(() => {});
  }, [handleShareUrl, isLoading]);

  useEffect(() => {
    if (!pendingRouteToken || isLoading) return;
    routeToShareEntry();
    setPendingRouteToken(null);
  }, [isLoading, pendingRouteToken, routeToShareEntry]);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
      <Stack.Screen name="add-listing" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="support" options={{ headerShown: false }} />
      {/* Deep-link entry only. The Rubin canvas itself is presented by
          `RubinHostProvider`, above this navigator — see that file for why it
          cannot live on a screen. */}
      <Stack.Screen name="rubin" options={{ headerShown: false }} />
      <Stack.Screen name="my-listings" options={{ headerShown: false }} />
      <Stack.Screen name="explore" options={{ headerShown: false }} />
      <Stack.Screen name="browse" options={{ headerShown: false }} />
      <Stack.Screen name="listing/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="chat/contacts" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="chat/[threadId]" options={{ headerShown: false }} />
      <Stack.Screen name="profile/[userId]" options={{ headerShown: false }} />
      <Stack.Screen name="news/[postId]" options={{ headerShown: false }} />
      <Stack.Screen name="news/index" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  const fontsReady = fontsLoaded || !!fontError;

  if (!fontsReady) return null;

  return (
    <SafeAreaProvider>
      {/* LocaleProvider sits ABOVE ErrorBoundary so the error fallback can
          still resolve localized copy (Chinese-OS users) if anything deeper
          in the tree crashes. */}
      <LocaleProvider>
        <LocaleSync />
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <SplashUntilReady fontsReady={fontsReady} />
              <SubscriptionGate>
                <DmProvider>
                  <NotificationProvider>
                    <NewsProvider>
                      <WatchlistProvider>
                        <ChatProvider>
                          <GestureHandlerRootView style={{ flex: 1 }}>
                            <KeyboardProvider>
                              <MetaSdkSetup />
                              <NotificationSetup />
                              <ShareLinkSetup />
                              {/* Above the navigator so the Rubin canvas can be
                                  warmed on one screen and presented over another
                                  without ever being remounted. */}
                              <RubinHostProvider>
                                <RootLayoutNav />
                              </RubinHostProvider>
                            </KeyboardProvider>
                          </GestureHandlerRootView>
                        </ChatProvider>
                      </WatchlistProvider>
                    </NewsProvider>
                  </NotificationProvider>
                </DmProvider>
              </SubscriptionGate>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
