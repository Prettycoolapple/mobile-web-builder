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
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import React, { useEffect, useRef } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ChatProvider } from "@/context/ChatContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { DmProvider } from "@/context/DmContext";
import { getApiBase } from "@/lib/api";
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

    async function initializeMetaSdk() {
      try {
        const [{ requestTrackingPermissionsAsync }, { Settings }] = await Promise.all([
          import("expo-tracking-transparency"),
          import("react-native-fbsdk-next"),
        ]);
        const { granted } = await requestTrackingPermissionsAsync();
        if (!mounted) return;

        Settings.initializeSDK();
        if (Platform.OS === "ios") {
          await Settings.setAdvertiserTrackingEnabled(granted);
        }
      } catch {
        // Keep startup resilient if the native SDK is unavailable in a dev shell.
      }
    }

    void initializeMetaSdk();

    return () => {
      mounted = false;
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
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

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
        router.push("/(tabs)/history" as never);
        return;
      }
      if (threadId) {
        router.push(`/chat/${threadId}` as never);
      }
    };

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
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
                  <ChatProvider>
                    <GestureHandlerRootView style={{ flex: 1 }}>
                      <KeyboardProvider>
                        <MetaSdkSetup />
                        <NotificationSetup />
                        <RootLayoutNav />
                      </KeyboardProvider>
                    </GestureHandlerRootView>
                  </ChatProvider>
                </DmProvider>
              </SubscriptionGate>
            </AuthProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </LocaleProvider>
    </SafeAreaProvider>
  );
}
