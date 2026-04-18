import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { GroundupLogo } from "@/components/GroundupLogo";

const ROLES = [
  {
    key: "general" as const,
    icon: "user" as const,
    title: "General User",
    tagline: "Explore NZ property intelligence",
    accent: "#D97757",
    badgeLabel: "Free",
    priceNote: "",
    ctaLabel: "Get started",
    features: [
      "Feasibility reports",
      "Chat & property search",
    ],
    route: "/(auth)/signup-general",
  },
  // HIDDEN: Sales Agent signup temporarily disabled — re-add to ROLES array to restore
  // {
  //   key: "sales_agent" as const,
  //   icon: "briefcase" as const,
  //   title: "Sales Agent",
  //   tagline: "Power your real estate career with AI",
  //   accent: "#D97757",
  //   badgeLabel: "$99 / mo",
  //   priceNote: "",
  //   ctaLabel: "Start free trial",
  //   features: [
  //     "Analyse NZ properties & run feasibility reports",
  //     "Buyer leads",
  //     "Unlimited property listings",
  //     "Live translation phone calls",
  //     "Secure encrypted in-app chat",
  //   ],
  //   route: "/(auth)/signup-agent",
  // },
  {
    key: "service_provider" as const,
    icon: "tool" as const,
    title: "Service Provider",
    tagline: "Connect with developers who need you",
    accent: "#52C99A",
    badgeLabel: "14-day free trial",
    priceNote: "",
    ctaLabel: "Get started",
    features: [
      "Get referred in chats & search",
      "Encrypted chats with clients & investors",
      "Feasibility reports",
      "Chat & property search",
    ],
    route: "/(auth)/signup-provider",
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
          styles.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>

        <View style={styles.header}>
          <GroundupLogo size={36} color={colors.accent} />
          <View>
            <Text style={[styles.brandName, { color: colors.accent, fontFamily: "SpaceGrotesk_700Bold" }]}>Project Alpha</Text>
            <Text style={[styles.brandTagline, { color: colors.mutedForeground }]}>
              Residential property development intelligence
            </Text>
          </View>
        </View>

        <Text style={[styles.heading, { color: colors.foreground }]}>Join Project Alpha</Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
          Choose the plan that fits your goals
        </Text>

        <View style={styles.cards}>
          {ROLES.map((role) => (
            <TouchableOpacity
              key={role.key}
              activeOpacity={0.88}
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  borderTopColor: role.accent,
                },
              ]}
              onPress={() => router.push(role.route as any)}
            >
              <View style={styles.cardHeaderRow}>
                <View style={[styles.iconCircle, { backgroundColor: role.accent + "18" }]}>
                  <Feather name={role.icon} size={18} color={role.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{role.title}</Text>
                  <Text style={[styles.cardTagline, { color: colors.mutedForeground }]}>
                    {role.tagline}
                  </Text>
                </View>
                {role.badgeLabel ? (
                  <View style={[styles.badge, { backgroundColor: role.accent + "18" }]}>
                    <Text style={[styles.badgeText, { color: role.accent }]}>{role.badgeLabel}</Text>
                  </View>
                ) : null}
              </View>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <View style={styles.featureList}>
                {role.features.map((f, i) => (
                  <View key={i} style={styles.featureRow}>
                    <View style={[styles.checkCircle, { backgroundColor: role.accent + "15" }]}>
                      <Feather name="check" size={10} color={role.accent} />
                    </View>
                    <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
                {role.priceNote ? (
                  <Text style={[styles.priceNote, { color: colors.mutedForeground }]}>
                    {role.priceNote}
                  </Text>
                ) : <View />}
                <View style={styles.ctaRow}>
                  <Text style={[styles.ctaText, { color: role.accent }]}>{role.ctaLabel}</Text>
                  <Feather name="arrow-right" size={13} color={role.accent} />
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Already have an account?{" "}
          </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
            <Text style={[styles.footerLink, { color: colors.accent }]}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20 },
  backBtn: { marginBottom: 20, width: 36 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 28 },
  brandName: { fontSize: 17, fontFamily: "DM_Sans_700Bold" },
  brandTagline: { fontSize: 12, fontFamily: "DM_Sans_400Regular", marginTop: 1 },
  heading: { fontSize: 30, fontFamily: "DM_Sans_700Bold", marginBottom: 6 },
  subheading: { fontSize: 15, fontFamily: "DM_Sans_400Regular", lineHeight: 22, marginBottom: 24 },
  cards: { gap: 16 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderTopWidth: 3,
    overflow: "hidden",
    padding: 18,
    gap: 14,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconCircle: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
  },
  cardTitle: { fontSize: 16, fontFamily: "DM_Sans_700Bold", lineHeight: 22 },
  cardTagline: { fontSize: 12, fontFamily: "DM_Sans_400Regular", marginTop: 2, lineHeight: 17 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, alignSelf: "flex-start" },
  badgeText: { fontSize: 12, fontFamily: "DM_Sans_600SemiBold" },
  divider: { height: 1 },
  featureList: { gap: 9 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  checkCircle: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    marginTop: 1, flexShrink: 0,
  },
  featureText: { fontSize: 14, fontFamily: "DM_Sans_400Regular", flex: 1, lineHeight: 20 },
  cardFooter: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingTop: 12, borderTopWidth: 1,
  },
  priceNote: { fontSize: 12, fontFamily: "DM_Sans_400Regular" },
  ctaRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ctaText: { fontSize: 13, fontFamily: "DM_Sans_600SemiBold" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 32 },
  footerText: { fontSize: 14, fontFamily: "DM_Sans_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "DM_Sans_600SemiBold" },
});
