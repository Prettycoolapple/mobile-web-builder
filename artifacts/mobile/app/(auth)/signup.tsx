import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import Svg, { Circle, Line, Path, Rect, Polyline } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

function GlassesLogo({ size = 40, color = "#D97757" }: { size?: number; color?: string }) {
  const w = size * 1.5;
  const h = size * 0.65;
  const r = size * 0.28;
  const cx1 = size * 0.32;
  const cx2 = size * 1.18;
  const cy = h * 0.55;
  const strokeW = size * 0.065;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Circle cx={cx1} cy={cy} r={r} stroke={color} strokeWidth={strokeW} fill="none" />
      <Circle cx={cx2} cy={cy} r={r} stroke={color} strokeWidth={strokeW} fill="none" />
      <Line x1={cx1 + r} y1={cy} x2={cx2 - r} y2={cy} stroke={color} strokeWidth={strokeW * 0.8} strokeLinecap="round" />
      <Line x1={cx1 - r} y1={cy - r * 0.3} x2={cx1 - r - size * 0.2} y2={cy - r * 0.65} stroke={color} strokeWidth={strokeW * 0.8} strokeLinecap="round" />
      <Line x1={cx2 + r} y1={cy - r * 0.3} x2={cx2 + r + size * 0.2} y2={cy - r * 0.65} stroke={color} strokeWidth={strokeW * 0.8} strokeLinecap="round" />
    </Svg>
  );
}

const roles = [
  {
    key: "general" as const,
    icon: "user" as const,
    title: "General User",
    subtitle: "Analyse NZ properties & run feasibility reports",
    description: "Free — 2 reports/month",
    badge: "Free",
  },
  {
    key: "sales_agent" as const,
    icon: "briefcase" as const,
    title: "Sales Agent",
    subtitle: "Advise clients with AI-powered development insights",
    description: "$99/month after trial",
    badge: "Pro",
  },
  {
    key: "service_provider" as const,
    icon: "tool" as const,
    title: "Service Provider",
    subtitle: "Grow your business with qualified developer leads",
    description: "$149/month after trial",
    badge: "Business",
  },
];

export default function RoleSelectionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.logoRow}>
          <GlassesLogo size={32} color={colors.accent} />
          <View>
            <Text style={[styles.logoTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
              Lecorb
            </Text>
            <Text style={[styles.logoTagline, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Property development intelligence
            </Text>
          </View>
        </View>

        <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
          Who are you?
        </Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          Choose your role to get the right experience
        </Text>

        <View style={styles.cards}>
          {roles.map((role) => (
            <TouchableOpacity
              key={role.key}
              activeOpacity={0.85}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              onPress={() => {
                if (role.key === "general") router.push("/(auth)/signup-general");
                else if (role.key === "sales_agent") router.push("/(auth)/signup-agent");
                else router.push("/(auth)/signup-provider");
              }}
            >
              <View style={styles.cardTop}>
                <View style={[styles.iconCircle, { backgroundColor: colors.accent + "15" }]}>
                  <Feather name={role.icon} size={22} color={colors.accent} />
                </View>
                <View style={[styles.badge, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.badgeText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
                    {role.badge}
                  </Text>
                </View>
              </View>

              <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                {role.title}
              </Text>
              <Text style={[styles.cardSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {role.subtitle}
              </Text>

              <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
                <Text style={[styles.cardDescription, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  {role.description}
                </Text>
                <Feather name="chevron-right" size={16} color={colors.accent} />
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Already have an account?{" "}
          </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
            <Text style={[styles.footerLink, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
              Sign in
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 20, width: 36 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 32 },
  logoTitle: { fontSize: 18 },
  logoTagline: { fontSize: 13, marginTop: 1 },
  heading: { fontSize: 28, marginBottom: 8 },
  subheading: { fontSize: 15, marginBottom: 28, lineHeight: 22 },
  cards: { gap: 14 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 10,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  iconCircle: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontSize: 12 },
  cardTitle: { fontSize: 18 },
  cardSubtitle: { fontSize: 14, lineHeight: 20 },
  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 12, marginTop: 4, borderTopWidth: 1,
  },
  cardDescription: { fontSize: 13 },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 32 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14 },
});
