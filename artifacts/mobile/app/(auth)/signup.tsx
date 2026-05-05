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
import { isOSChineseLocale, useT } from "@/lib/i18n";

interface RoleCard {
  key: "general" | "service_provider";
  icon: "user" | "tool";
  titleKey: string;
  taglineKey: string;
  accent: string;
  badgeKey: string;
  ctaKey: string;
  featureKeys: string[];
  route: string;
}

const ROLES: RoleCard[] = [
  {
    key: "general",
    icon: "user",
    titleKey: "signup.role.general.title",
    taglineKey: "signup.role.general.tagline",
    accent: "#D97757",
    badgeKey: "signup.role.general.badge",
    ctaKey: "signup.role.general.cta",
    featureKeys: [
      "signup.role.general.f1",
      "signup.role.general.f2",
    ],
    route: "/(auth)/signup-general",
  },
  {
    key: "service_provider",
    icon: "tool",
    titleKey: "signup.role.provider.title",
    taglineKey: "signup.role.provider.tagline",
    accent: "#52C99A",
    badgeKey: "signup.role.provider.badge",
    ctaKey: "signup.role.provider.cta",
    featureKeys: [
      "signup.role.provider.f1",
      "signup.role.provider.f2",
      "signup.role.provider.f3",
      "signup.role.provider.f4",
    ],
    route: "/(auth)/signup-provider",
  },
];

export default function RoleSelectionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();

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
          <View>
            <Text style={[styles.brandName, { color: colors.accent, fontFamily: "SpaceGrotesk_700Bold" }]}>
              {isOSChineseLocale() ? "奥房" : "Project Alpha"}
            </Text>
            <Text style={[styles.brandTagline, { color: colors.mutedForeground }]}>
              {t("signup.brand_tagline")}
            </Text>
          </View>
        </View>

        <Text style={[styles.heading, { color: colors.foreground }]}>{t("signup.heading")}</Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
          {t("signup.subheading")}
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
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t(role.titleKey)}</Text>
                  <Text style={[styles.cardTagline, { color: colors.mutedForeground }]}>
                    {t(role.taglineKey)}
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: role.accent + "18" }]}>
                  <Text style={[styles.badgeText, { color: role.accent }]}>{t(role.badgeKey)}</Text>
                </View>
              </View>

              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              <View style={styles.featureList}>
                {role.featureKeys.map((fKey, i) => (
                  <View key={i} style={styles.featureRow}>
                    <View style={[styles.checkCircle, { backgroundColor: role.accent + "15" }]}>
                      <Feather name="check" size={10} color={role.accent} />
                    </View>
                    <Text style={[styles.featureText, { color: colors.foreground }]}>{t(fKey)}</Text>
                  </View>
                ))}
              </View>

              <View style={[styles.cardFooter, { borderTopColor: colors.border }]}>
                <View />
                <View style={styles.ctaRow}>
                  <Text style={[styles.ctaText, { color: role.accent }]}>{t(role.ctaKey)}</Text>
                  <Feather name="arrow-right" size={13} color={role.accent} />
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            {t("signup.have_account")}
          </Text>
          <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
            <Text style={[styles.footerLink, { color: colors.accent }]}>{t("signup.sign_in")}</Text>
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
