import { BlurView } from "expo-blur";
import { Tabs, useRouter, useSegments } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { hasServiceProviderAccess, useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";
import { useDm } from "@/context/DmContext";
import { useT } from "@/lib/i18n";

function ClassicTabLayout({ isGuest }: { isGuest: boolean }) {
  const colors = useColors();
  const { t } = useT();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const safeAreaInsets = useSafeAreaInsets();
  const { unreadCount } = useDm();
  const { startNewChat, currentSession, sessions, switchSession } = useChat();
  const router = useRouter();
  const segments = useSegments();

  // The Home and Search tabs both resolve to the index screen, so the active
  // tab can't be derived from the route — it follows chat state instead.
  // "In a conversation" = the current session has at least one message.
  const inConversation = (currentSession?.messages?.length ?? 0) > 0;
  // The most-recently-used session that still holds messages — what the Search
  // tab resumes when the user is back on the Home landing.
  const resumable =
    [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).find((s) => s.messages.length > 0) ?? null;
  const searchTappable = inConversation || resumable !== null;
  // Only the index route renders the search screen; on Messages/History/Account
  // the leaf segment is that tab's name. The search icon must light up ONLY when
  // we're actually on the search screen AND in a conversation — otherwise the
  // active tab and the search tab would both appear lit.
  // On the search/home (index) screen the leaf segment is the tab group itself
  // ("(tabs)"); every other tab leaf is that tab's route name.
  const leafSegment = segments[segments.length - 1];
  const onSearchScreen = leafSegment === "(tabs)";
  const searchActive = inConversation && onSearchScreen;
  const searchTint = searchActive ? colors.accent : colors.mutedForeground;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: "DM_Sans_500Medium",
          fontSize: 11,
          marginTop: -2,
        },
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.card,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          paddingBottom: safeAreaInsets.bottom,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={95}
              tint={isDark ? "dark" : "extraLight"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.card },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("tab.search"),
          tabBarButton: ({ style }) => (
            <Pressable
              style={[style, styles.tabCell, { opacity: searchTappable ? 1 : 0.4 }]}
              disabled={!searchTappable}
              onPress={() => {
                // Resume the backgrounded conversation when returning from the
                // Home landing; if already in one, just stay on the index route.
                if (!inConversation && resumable) switchSession(resumable.id);
                router.navigate("/(tabs)");
              }}
              accessibilityRole="button"
              accessibilityState={{ disabled: !searchTappable, selected: searchActive }}
              accessibilityLabel={t("tab.search")}
            >
              {isIOS ? (
                <SymbolView name="magnifyingglass.circle" tintColor={searchTint} size={24} />
              ) : (
                <Feather name="search" size={22} color={searchTint} />
              )}
              <Text style={[styles.tabLabel, { color: searchTint }]}>{t("tab.search")}</Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          href: isGuest ? null : undefined,
          title: t("tab.messages"),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.accent, fontSize: 10, minWidth: 18 },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="envelope" tintColor={color} size={24} />
            ) : (
              <Feather name="mail" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="home"
        options={{
          title: t("tab.home"),
          tabBarButton: ({ style }) => (
            <Pressable
              style={[style, styles.homeTabCell]}
              onPress={() => {
                // Fresh Home landing; prior sessions stay alive in `sessions`
                // and are resumable via the Search tab.
                startNewChat();
                router.navigate("/(tabs)");
              }}
              accessibilityRole="button"
              accessibilityLabel={t("tab.home")}
            >
              <View style={[styles.homeCircle, { backgroundColor: colors.accent }]}>
                {isIOS ? (
                  <SymbolView name="house.fill" tintColor="#fff" size={18} />
                ) : (
                  <Feather name="home" size={18} color="#fff" />
                )}
              </View>
              <Text style={[styles.homeLabel, { color: colors.mutedForeground }]}>
                {t("tab.home")}
              </Text>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          href: isGuest ? null : undefined,
          title: t("tab.history"),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="clock" tintColor={color} size={24} />
            ) : (
              <Feather name="clock" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: isGuest ? null : undefined,
          title: t("tab.account"),
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.circle" tintColor={color} size={24} />
            ) : (
              <Feather name="user" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user?.role === "service_provider" && !hasServiceProviderAccess(user)) {
      router.replace("/(onboarding)/service-provider-welcome" as never);
    }
  }, [user, isLoading, router]);

  if (isLoading || (user?.role === "service_provider" && !hasServiceProviderAccess(user))) return null;

  return <ClassicTabLayout isGuest={!user} />;
}

const styles = StyleSheet.create({
  tabCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  tabLabel: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 11,
    marginTop: -2,
  },
  homeTabCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  homeCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  homeLabel: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 11,
  },
});
