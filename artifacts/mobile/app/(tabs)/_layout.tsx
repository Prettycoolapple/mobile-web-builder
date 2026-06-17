import { BlurView } from "expo-blur";
import { Tabs, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
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
  const { startNewChat } = useChat();
  const router = useRouter();

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
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="magnifyingglass.circle" tintColor={color} size={24} />
            ) : (
              <Feather name="search" size={22} color={color} />
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
          tabBarButton: ({ ref: _ref, style }) => (
            <Pressable
              style={[style, styles.homeTabCell]}
              onPress={() => {
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
    if (!isLoading && user?.role === "service_provider" && user.subscriptionTier === "free") {
      router.replace("/(onboarding)/service-provider-welcome" as never);
    }
  }, [user, isLoading, router]);

  if (isLoading || (user?.role === "service_provider" && user.subscriptionTier === "free")) return null;

  return <ClassicTabLayout isGuest={!user} />;
}

const styles = StyleSheet.create({
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
