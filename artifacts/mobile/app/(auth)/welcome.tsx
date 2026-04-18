import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { GroundupLogo } from "@/components/GroundupLogo";

type FeatureItem = {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
};

const FEATURES: FeatureItem[] = [
  {
    icon: "map-pin",
    title: "Address-level feasibility",
    body: "Zoning, overlays, slope, and infrastructure costs for any NZ property in seconds.",
  },
  {
    icon: "trending-up",
    title: "Development ROI modelling",
    body: "Indicative GDV, build cost ranges, and 2–4 year return scenarios in NZD.",
  },
  {
    icon: "users",
    title: "Verified NZ professionals",
    body: "Get matched with planners, architects, and engineers who know your council.",
  },
];

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 520,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + 56,
            paddingBottom: insets.bottom + 28,
          },
        ]}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View
          style={{
            opacity: fade,
            transform: [{ translateY: lift }],
          }}
        >
          <View style={styles.brandRow}>
            <GroundupLogo size={36} color={colors.accent} accentColor={colors.accent} />
            <Text
              style={[
                styles.brandWord,
                { color: colors.foreground, fontFamily: "SpaceGrotesk_700Bold" },
              ]}
            >
              Groundup
            </Text>
          </View>

          <Text
            style={[
              styles.eyebrow,
              { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" },
            ]}
          >
            NEW ZEALAND PROPERTY DEVELOPMENT
          </Text>

          <Text
            style={[
              styles.headline,
              { color: colors.foreground, fontFamily: "SpaceGrotesk_700Bold" },
            ]}
          >
            Know if a site stacks up{"\n"}before you offer.
          </Text>

          <Text
            style={[
              styles.subhead,
              { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" },
            ]}
          >
            Instant feasibility analysis on any NZ address — zoning, costs, ROI,
            and risks, modelled by AI trained on local market data.
          </Text>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f.title} style={styles.featureRow}>
                <View
                  style={[
                    styles.featureIcon,
                    {
                      backgroundColor: colors.muted,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Feather name={f.icon} size={18} color={colors.accent} />
                </View>
                <View style={styles.featureCopy}>
                  <Text
                    style={[
                      styles.featureTitle,
                      { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" },
                    ]}
                  >
                    {f.title}
                  </Text>
                  <Text
                    style={[
                      styles.featureBody,
                      { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" },
                    ]}
                  >
                    {f.body}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View style={[styles.ctaBlock, { opacity: fade }]}>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.push("/(auth)/signup")}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.primaryBtnText,
                { color: colors.accentForeground, fontFamily: "DM_Sans_600SemiBold" },
              ]}
            >
              Create free account
            </Text>
            <Feather name="arrow-right" size={18} color={colors.accentForeground} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push("/(auth)/login")}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.secondaryBtnText,
                { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" },
              ]}
            >
              Sign in
            </Text>
          </TouchableOpacity>

          <Text
            style={[
              styles.fineprint,
              { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" },
            ]}
          >
            Indicative estimates only. Always engage qualified professionals
            before development decisions.
          </Text>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 48,
  },
  brandWord: {
    fontSize: 20,
    letterSpacing: -0.4,
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.6,
    marginBottom: 14,
  },
  headline: {
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1.2,
    marginBottom: 16,
  },
  subhead: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 36,
    maxWidth: 420,
  },
  features: {
    gap: 20,
    marginBottom: 32,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  featureIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  featureCopy: {
    flex: 1,
    paddingTop: 1,
  },
  featureTitle: {
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 3,
  },
  featureBody: {
    fontSize: 14,
    lineHeight: 20,
  },
  ctaBlock: {
    marginTop: 32,
    gap: 12,
  },
  primaryBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  primaryBtnText: {
    fontSize: 16,
  },
  secondaryBtn: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
  },
  fineprint: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 8,
    paddingHorizontal: 12,
  },
});
