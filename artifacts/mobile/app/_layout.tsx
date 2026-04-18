import {
  DM_Sans_400Regular,
  DM_Sans_500Medium,
  DM_Sans_600SemiBold,
  DM_Sans_700Bold,
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
import { initializeRevenueCat, SubscriptionProvider } from "@/lib/revenuecat";

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

function getApiBase(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "/api";
}

const queryClient = new QueryClient();

function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { isSubscriptionIdentityReady } = useAuth();
  return (
    <SubscriptionProvider identityReady={isSubscriptionIdentityReady}>
      {children}
    </SubscriptionProvider>
  );
}

function NotificationSetup() {
  const { token, user } = useAuth();
  const router = useRouter();
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

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

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { threadId?: string };
      if (data?.threadId) {
        router.push(`/chat/${data.threadId}`);
      }
    });

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as { threadId?: string };
      if (data?.threadId) {
        router.push(`/chat/${data.threadId}`);
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [user, token]);

  return null;
}

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
      <Stack.Screen name="add-listing" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="my-listings" options={{ headerShown: false }} />
      <Stack.Screen name="chat/contacts" options={{ headerShown: false, presentation: "modal" }} />
      <Stack.Screen name="chat/[threadId]" options={{ headerShown: false }} />
      <Stack.Screen name="profile/[userId]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    DM_Sans_400Regular,
    DM_Sans_500Medium,
    DM_Sans_600SemiBold,
    DM_Sans_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_700Bold,
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SubscriptionGate>
              <DmProvider>
                <ChatProvider>
                  <GestureHandlerRootView style={{ flex: 1 }}>
                    <KeyboardProvider>
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
    </SafeAreaProvider>
  );
}
