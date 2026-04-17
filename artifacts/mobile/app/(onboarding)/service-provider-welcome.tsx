import React, { useEffect, useRef, useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Animated,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/lib/revenuecat";

const BG = "#131510";
const CARD_BG = "#1A1E14";
const ACCENT = "#D97757";
const ACCENT2 = "#52C99A";
const TEXT = "#FAFAF9";
const MUTED = "rgba(250,249,246,0.55)";
const BORDER = "rgba(250,249,246,0.1)";

const FEATURES: { icon: React.ComponentProps<typeof Feather>["name"]; label: string }[] = [
  { icon: "cpu", label: "Groundup will recommend you to users when their need fits your expertise." },
  { icon: "trending-up", label: "Get insights into your potential client" },
  { icon: "globe", label: "AI powered live translation — help you get clients speaking different languages." },
  { icon: "file-text", label: "Access to feasibility reports" },
];

export default function ServiceProviderWelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token, getApiHeaders, refreshProfile } = useAuth();
  const { purchase, isPurchasing, isSubscribed, getPriceForRole, getPackageForRole } = useSubscription();
  const [showWelcomePopup, setShowWelcomePopup] = useState(true);

  const firstName = user?.fullName?.split(" ")[0] || "there";
  const hasSubscription = isSubscribed || (user?.subscriptionTier && user.subscriptionTier !== "free");
  const priceString = getPriceForRole("service_provider");

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

  const getApiBase = () => {
    if (process.env.EXPO_PUBLIC_DOMAIN) {
      return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    }
    return "/api";
  };

  const handleSubscribe = async () => {
    try {
      const pkg = getPackageForRole("service_provider");
      if (!pkg) {
        Alert.alert("Unavailable", "Subscription packages are not available right now. Please try again later.");
        return;
      }
      await purchase(pkg);
      let synced = false;
      if (token) {
        try {
          const resp = await fetch(`${getApiBase()}/subscription/sync`, {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify({ tier: "pro" }),
          });
          synced = resp.ok;
        } catch {
          synced = false;
        }
        await refreshProfile().catch(() => {});
        if (synced) {
          fetch(`${getApiBase()}/notifications/provider-subscribed`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      }
      if (!synced) {
        Alert.alert(
          "Almost there",
          "Your trial started but we couldn't activate your account. Please try again in a moment, or contact support if it persists.",
        );
        return;
      }
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const message = (err as { message?: string; userCancelled?: boolean })?.message;
      const userCancelled = (err as { userCancelled?: boolean })?.userCancelled;
      if (!userCancelled) {
        Alert.alert("Purchase failed", message ?? "Please try again.");
      }
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Modal
        visible={showWelcomePopup}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWelcomePopup(false)}
      >
        <View style={styles.popupOverlay}>
          <View style={styles.popupCard}>
            <View style={styles.popupIconWrap}>
              <Feather name="star" size={28} color={ACCENT2} />
            </View>
            <Text style={styles.popupTitle}>You're on Groundup!</Text>
            <Text style={styles.popupBody}>
              Groundup will start recommending you for suitable jobs as property developers and investors look for your expertise.
              {"\n\n"}Build your recommendations to boost your visibility across the platform.
            </Text>
            <TouchableOpacity
              style={styles.popupBtn}
              onPress={() => setShowWelcomePopup(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.popupBtnText}>Got it</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={[styles.heroSection, { opacity: heroAnim, transform: [{ translateY: heroAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }] }]}>
          <View style={styles.iconWrap}>
            <Feather name="tool" size={32} color={ACCENT2} />
          </View>
          <Text style={styles.roleTag}>Service Provider</Text>
          <Text style={styles.heading}>You're in,{"\n"}{firstName}!</Text>
          <Text style={styles.subheading}>
            Your account is set up. Your submitted credentials are being reviewed — once verified, you'll be recommended to property developers and investors looking for your services.
          </Text>
        </Animated.View>

        <Animated.View style={[styles.pricingCard, { opacity: cardAnim, transform: [{ scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
          <View style={styles.pricingTop}>
            <View>
              <Text style={styles.pricingPlan}>Service Provider Plan</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceAmount}>{priceString}</Text>
                <Text style={styles.pricePer}>/month NZD</Text>
              </View>
            </View>
            <View style={styles.trialBadge}>
              <Text style={styles.trialBadgeText}>7 days free</Text>
            </View>
          </View>
          <Text style={styles.trialNote}>Card required · $0 charged now · Billed after 7-day trial · Cancel anytime</Text>
        </Animated.View>

        {!hasSubscription && (
          <View style={styles.verificationBanner}>
            <Feather name="shield" size={15} color={ACCENT2} />
            <Text style={styles.verificationText}>
              Your Certificate of Incorporation is under review — verified within 1–2 business days.
            </Text>
          </View>
        )}

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
                <Feather name="check" size={13} color={ACCENT2} />
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
              style={[styles.primaryBtn, isPurchasing && styles.primaryBtnDisabled]}
              onPress={handleSubscribe}
              activeOpacity={0.85}
              disabled={isPurchasing}
            >
              {isPurchasing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Start 7-Day Free Trial</Text>
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
    backgroundColor: ACCENT2 + "18",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: ACCENT2 + "30",
  },
  roleTag: {
    color: ACCENT2,
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
    marginBottom: 20,
    borderWidth: 1,
    borderColor: ACCENT2 + "35",
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
    backgroundColor: ACCENT2 + "20",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: ACCENT2 + "40",
  },
  trialBadgeText: {
    color: ACCENT2,
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 12,
  },
  trialNote: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 12,
  },
  verificationBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: ACCENT2 + "10",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ACCENT2 + "25",
    padding: 14,
    marginBottom: 28,
  },
  verificationText: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
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
    backgroundColor: ACCENT2 + "15",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: ACCENT2 + "30",
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
  popupOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
  },
  popupCard: {
    backgroundColor: CARD_BG,
    borderRadius: 22,
    padding: 28,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: ACCENT2 + "40",
  },
  popupIconWrap: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: ACCENT2 + "18",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    borderWidth: 1,
    borderColor: ACCENT2 + "30",
  },
  popupTitle: {
    color: TEXT,
    fontFamily: "DM_Sans_700Bold",
    fontSize: 22,
    textAlign: "center",
    marginBottom: 12,
  },
  popupBody: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 24,
  },
  popupBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  popupBtnText: {
    color: "#fff",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
  },
});
