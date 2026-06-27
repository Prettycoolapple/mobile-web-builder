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
import { requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Stack, useRouter } from "expo-router";
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
import { WatchlistProvider } from "@/context/WatchlistContext";
import { getApiBase } from "@/lib/api";
import { configureAppIconBadgesAsync } from "@/lib/appBadge";
import { parseShareTokenFromUrl, storePendingShareToken } from "@/lib/propertyShares";
import { initializeRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";
import { LocaleProvider, LocaleSync } from "@/lib/i18n";

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
  const { token, user } = useAuth();
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);
  const checkedInitialNotificationRef = useRef(false);
  const handledNotificationIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user || !token) return;

    async function registerPushToken() {
      if (Platform.OS === "web") return;
      try {
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
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

        await configureAppIconBadgesAsync();

        const tokenData = await Notifications.getExpoPushTokenAsync();
        const pushToken = tokenData.data;
        const platform = Platform.OS === "ios" ? "ios" : "android";

        await fetch(`${getApiBase()}/dm/push-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ token: pushToken, platform }),
        });
      } catch {
      }
    }

    registerPushToken();

    const openFromNotificationData = (data: Record<string, unknown> | undefined, notificationId?: string) => {
      if (!data || typeof data !== "object") return;
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
      if (threadId) {
        router.push(`/chat/${threadId}` as never);
      }
    };

    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      const type = data && typeof data.type === "string" ? data.type : undefined;
      if (type === "report_ready" || type === "screening_ready") {
        DeviceEventEmitter.emit("projectAlpha:backgroundJobsReady", { type });
        DeviceEventEmitter.emit("projectAlpha:notificationsChanged");
      }
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromNotificationData(
        response.notification.request.content.data as Record<string, unknown>,
        response.notification.request.identifier,
      );
    });

    if (!checkedInitialNotificationRef.current) {
      checkedInitialNotificationRef.current = true;
      Notifications.getLastNotificationResponseAsync().then((response) => {
        if (!response) return;
        openFromNotificationData(
          response.notification.request.content.data as Record<string, unknown>,
          response.notification.request.identifier,
        );
      });
    }

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user, token, router]);

  return null;
}

function ShareLinkSetup() {
  const { isLoading } = useAuth();
  const router = useRouter();
  const checkedInitialUrlRef = useRef(false);
  const [pendingRouteToken, setPendingRouteToken] = useState<string | null>(null);

  const routeToShareEntry = useCallback(() => {
    router.replace("/(tabs)" as never);
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
      <Stack.Screen name="my-listings" options={{ headerShown: false }} />
      <Stack.Screen name="explore" options={{ headerShown: false }} />
      <Stack.Screen name="listing/[id]" options={{ headerShown: false }} />
      <Stack.Screen name="chat/contacts" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="chat/[threadId]" options={{ headerShown: false }} />
      <Stack.Screen name="profile/[userId]" options={{ headerShown: false }} />
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
                    <WatchlistProvider>
                      <ChatProvider>
                        <GestureHandlerRootView style={{ flex: 1 }}>
                          <KeyboardProvider>
                            <MetaSdkSetup />
                            <NotificationSetup />
                            <ShareLinkSetup />
                            <RootLayoutNav />
                          </KeyboardProvider>
                        </GestureHandlerRootView>
                      </ChatProvider>
                    </WatchlistProvider>
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
