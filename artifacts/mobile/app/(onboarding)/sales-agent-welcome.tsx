import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  Linking,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";

const BG = "#1E1610";
const CARD_BG = "#261B12";
const ACCENT = "#D97757";
const TEXT = "#FAFAF9";
const MUTED = "rgba(250,249,246,0.55)";
const BORDER = "rgba(250,249,246,0.1)";

const FEATURES: { icon: React.ComponentProps<typeof Feather>["name"]; label: string }[] = [
  { icon: "list", label: "Unlimited listings" },
  { icon: "users", label: "Qualified buyer leads" },
  { icon: "message-circle", label: "Built-in live chat with leads" },
  { icon: "cpu", label: "AI-recommended listings to buyers" },
  { icon: "star", label: "Priority placement in AI recommendations" },
];

function getApiBase(): string {
  if (process.env["EXPO_PUBLIC_DOMAIN"]) {
    return `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  }
  return "/api";
}

export default function SalesAgentWelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, getApiHeaders } = useAuth();
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const firstName = user?.fullName?.split(" ")[0] || "there";
  const hasSubscription = user?.subscriptionTier && user.subscriptionTier !== "free";

  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const featureAnims = useRef(FEATURES.map(() => new Animated.Value(0))).current;
  const btnAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(heroAnim, { toValue: 1, duration: 480, useNativeDriver: true }),
      Animated.timing(cardAnim, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.stagger(
        90,
        featureAnims.map((a) =>
          Animated.timing(a, { toValue: 1, duration: 280, useNativeDriver: true }),
        ),
      ),
      Animated.timing(btnAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSubscribe = async () => {
    setCheckoutLoading(true);
    try {
      const resp = await fetch(`${getApiBase()}/stripe/checkout`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ plan: "sales_agent" }),
      });
      const data = (await resp.json()) as { url?: string; error?: string };
      if (!resp.ok || !data.url) {
        throw new Error(data.error ?? "Could not start checkout. Please try again.");
      }
      await Linking.openURL(data.url);
    } catch (err) {
      Alert.alert("Checkout failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.heroSection, { opacity: heroAnim, transform: [{ translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
          <View style={styles.iconWrap}>
            <Feather name="briefcase" size={32} color={ACCENT} />
          </View>
          <Text style={styles.roleTag}>Sales Agent</Text>
          <Text style={styles.heading}>Welcome aboard,{"\n"}{firstName}!</Text>
          <Text style={styles.subheading}>
            Your verified agent account is live. Start your free trial and get listed on NZ's most intelligent property platform.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.pricingCard, { opacity: cardAnim, transform: [{ scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
          <View style={styles.pricingTop}>
            <View>
              <Text style={styles.pricingPlan}>Sales Agent Plan</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceAmount}>$99</Text>
                <Text style={styles.pricePer}>/month NZD</Text>
              </View>
            </View>
            <View style={styles.trialBadge}>
              <Text style={styles.trialBadgeText}>14 days free</Text>
            </View>
          </View>
          <Text style={styles.trialNote}>No credit card required to start · Cancel anytime</Text>
        </Animated.View>

        <View style={styles.featuresSection}>
          <Text style={styles.featuresLabel}>What's included</Text>
          {FEATURES.map((f, i) => (
            <Animated.View
              key={f.label}
              style={[
                styles.featureRow,
                {
                  opacity: featureAnims[i],
                  transform: [{ translateX: featureAnims[i].interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
                },
              ]}
            >
              <View style={styles.featureCheck}>
                <Feather name="check" size={13} color={ACCENT} />
              </View>
              <View style={styles.featureContent}>
                <Feather name={f.icon} size={16} color={MUTED} style={styles.featureIcon} />
                <Text style={styles.featureLabel}>{f.label}</Text>
              </View>
            </Animated.View>
          ))}
        </View>

        <Animated.View style={[styles.btnSection, { opacity: btnAnim, transform: [{ translateY: btnAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
          {hasSubscription ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(tabs)")} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>Go to dashboard</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, checkoutLoading && styles.primaryBtnDisabled]}
              onPress={handleSubscribe}
              activeOpacity={0.85}
              disabled={checkoutLoading}
            >
              {checkoutLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Start Free Trial</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.secondaryBtn} onPress={() => router.replace("/(tabs)")} activeOpacity={0.7}>
            <Text style={styles.secondaryBtnText}>Maybe later</Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  heroSection: {
    alignItems: "center",
    marginBottom: 32,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: ACCENT + "18",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: ACCENT + "30",
  },
  roleTag: {
    color: ACCENT,
    fontFamily: "DM_Sans_500Medium",
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  heading: {
    color: TEXT,
    fontFamily: "DM_Sans_700Bold",
    fontSize: 34,
    textAlign: "center",
    lineHeight: 42,
    marginBottom: 14,
  },
  subheading: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    textAlign: "center",
    lineHeight: 23,
  },
  pricingCard: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    padding: 22,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: ACCENT + "35",
  },
  pricingTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },
  pricingPlan: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    marginBottom: 4,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  priceAmount: {
    color: TEXT,
    fontFamily: "DM_Sans_700Bold",
    fontSize: 38,
    lineHeight: 44,
  },
  pricePer: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    paddingBottom: 6,
  },
  trialBadge: {
    backgroundColor: ACCENT + "20",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: ACCENT + "40",
  },
  trialBadgeText: {
    color: ACCENT,
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
  },
  trialNote: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
  },
  featuresSection: {
    marginBottom: 36,
  },
  featuresLabel: {
    color: MUTED,
    fontFamily: "DM_Sans_500Medium",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    gap: 12,
  },
  featureCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: ACCENT + "15",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: ACCENT + "30",
  },
  featureContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 10,
  },
  featureIcon: {
    opacity: 0.7,
  },
  featureLabel: {
    color: TEXT,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    flex: 1,
  },
  btnSection: {
    gap: 12,
  },
  primaryBtn: {
    height: 54,
    borderRadius: 14,
    backgroundColor: ACCENT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.7,
  },
  primaryBtnText: {
    color: "#fff",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
  },
  secondaryBtn: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
  },
});
