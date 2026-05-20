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
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { getApiBase } from "@/lib/api";
import { useSubscription, getSubscriptionSyncBody } from "@/lib/revenuecat";
import { useT } from "@/lib/i18n";

const BG = "#131510";
const CARD_BG = "#1A1E14";
const ACCENT = "#D97757";
const ACCENT2 = "#52C99A";
const TEXT = "#FAFAF9";
const MUTED = "rgba(250,249,246,0.55)";
const BORDER = "rgba(250,249,246,0.1)";

const FEATURES: { icon: React.ComponentProps<typeof Feather>["name"]; labelKey: string }[] = [
  { icon: "users", labelKey: "provider_welcome.feature_investors" },
  { icon: "file-text", labelKey: "provider_welcome.feature_search_reports" },
  { icon: "message-circle", labelKey: "provider_welcome.feature_encrypted_chat" },
];

const COMING_SOON: { labelKey: string }[] = [
  { labelKey: "provider_welcome.coming_soon_item" },
  { labelKey: "provider_welcome.coming_soon_automation_tools" },
];

export default function ServiceProviderWelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, token, getApiHeaders, refreshProfile } = useAuth();
  const {
    purchase,
    isPurchasing,
    isSubscribed,
    getPriceForRole,
    getFreshPackageForRole,
    refetchCustomerInfo,
    refetchOfferings,
    refetchStoreProducts,
    offeringsLoading,
  } =
    useSubscription();
  const { t } = useT();
  const [showWelcomePopup, setShowWelcomePopup] = useState(true);

  const firstName = user?.fullName?.split(" ")[0] || t("provider_welcome.fallback_name");
  const hasSubscription = isSubscribed || (user?.subscriptionTier && user.subscriptionTier !== "free");
  const priceString = getPriceForRole("service_provider");
  const storeName = Platform.OS === "ios" ? "App Store" : "Google Play";

  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const featureAnims = useRef(FEATURES.map(() => new Animated.Value(0))).current;
  const comingSoonAnim = useRef(new Animated.Value(0)).current;
  const btnAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    void refetchOfferings();
    void refetchStoreProducts();
    Animated.sequence([
      Animated.timing(heroAnim, { toValue: 1, duration: 480, useNativeDriver: true }),
      Animated.timing(cardAnim, { toValue: 1, duration: 320, useNativeDriver: true }),
      Animated.stagger(
        90,
        featureAnims.map((a) =>
          Animated.timing(a, { toValue: 1, duration: 280, useNativeDriver: true }),
        ),
      ),
      Animated.timing(comingSoonAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(btnAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [refetchOfferings, refetchStoreProducts]);

  const handleSubscribe = async () => {
    try {
      const pkg = await getFreshPackageForRole("service_provider");
      if (!pkg) {
        Alert.alert(t("provider_welcome.unavailable"), t("provider_welcome.sub_unavailable"));
        return;
      }
      await purchase(pkg);
      await refetchCustomerInfo();
      let synced = false;
      if (token) {
        try {
          const body = await getSubscriptionSyncBody("pro");
          const resp = await fetch(`${getApiBase()}/subscription/sync`, {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify(body),
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
          t("provider_welcome.almost_there"),
          t("provider_welcome.subscription_no_activate"),
        );
        return;
      }
      router.replace("/(tabs)");
    } catch (err: unknown) {
      const message = (err as { message?: string; userCancelled?: boolean })?.message;
      const userCancelled = (err as { userCancelled?: boolean })?.userCancelled;
      if (!userCancelled) {
        Alert.alert(t("provider_welcome.purchase_failed"), message ?? t("provider_welcome.try_again"));
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
            <Text style={styles.popupTitle}>{t("provider_welcome.popup_title")}</Text>
            <Text style={styles.popupBody}>
              {t("provider_welcome.popup_body")}
            </Text>
            <TouchableOpacity
              style={styles.popupBtn}
              onPress={() => setShowWelcomePopup(false)}
              activeOpacity={0.85}
            >
              <Text style={styles.popupBtnText}>{t("provider_welcome.popup_cta")}</Text>
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
          <Text style={styles.roleTag}>{t("provider_welcome.role_tag")}</Text>
          <Text style={styles.heading}>{t("provider_welcome.heading", { name: firstName })}</Text>
          <Text style={styles.subheading}>
            {t("provider_welcome.subheading")}
          </Text>
        </Animated.View>

        <Animated.View style={[styles.pricingCard, { opacity: cardAnim, transform: [{ scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
          <View style={styles.pricingTop}>
            <View>
              <Text style={styles.pricingPlan}>{t("provider_welcome.plan_name")}</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceAmount}>{priceString}</Text>
                <Text style={styles.pricePer}>{t("provider_welcome.per_month")}</Text>
              </View>
            </View>
          </View>
          <Text style={styles.subscriptionNote}>
            {t("provider_welcome.subscription_note", { store: storeName })}
          </Text>
        </Animated.View>

        {!hasSubscription && (
          <View style={styles.verificationBanner}>
            <Feather name="shield" size={15} color={ACCENT2} />
            <Text style={styles.verificationText}>
              {t("provider_welcome.verification")}
            </Text>
          </View>
        )}

        <View style={styles.featuresSection}>
          <Text style={styles.featuresLabel}>{t("provider_welcome.whats_included")}</Text>
          {FEATURES.map((f, i) => (
            <Animated.View
              key={f.labelKey}
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
                <Text style={styles.featureLabel}>{t(f.labelKey)}</Text>
              </View>
            </Animated.View>
          ))}

          <Animated.View
            style={[
              styles.comingSoonBlock,
              {
                opacity: comingSoonAnim,
                transform: [{ translateY: comingSoonAnim.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
              },
            ]}
          >
            <Text style={styles.comingSoonHeading}>{t("provider_welcome.coming_soon_heading")}</Text>
            {COMING_SOON.map((item) => (
              <View key={item.labelKey} style={styles.comingSoonRow}>
                <Feather name="clock" size={14} color={MUTED} style={styles.comingSoonBulletIcon} />
                <Text style={styles.comingSoonText}>{t(item.labelKey)}</Text>
              </View>
            ))}
          </Animated.View>
        </View>

        <Animated.View style={[styles.btnSection, { opacity: btnAnim, transform: [{ translateY: btnAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
          {hasSubscription ? (
            <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/(tabs)")} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{t("provider_welcome.go_dashboard")}</Text>
              <Feather name="arrow-right" size={18} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, (isPurchasing || offeringsLoading) && styles.primaryBtnDisabled]}
              onPress={handleSubscribe}
              activeOpacity={0.85}
              disabled={isPurchasing || offeringsLoading}
            >
              {isPurchasing || offeringsLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>{t("provider_welcome.start_subscription")}</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          )}
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
  subscriptionNote: {
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
  comingSoonBlock: {
    marginTop: 20,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
  },
  comingSoonHeading: {
    color: MUTED,
    fontFamily: "DM_Sans_500Medium",
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  comingSoonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    marginBottom: 10,
  },
  comingSoonBulletIcon: {
    marginTop: 2,
    opacity: 0.85,
  },
  comingSoonText: {
    color: MUTED,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    lineHeight: 21,
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
