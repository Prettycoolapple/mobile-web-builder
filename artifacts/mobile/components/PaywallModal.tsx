import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { getApiBase } from "@/lib/api";
import { useSubscription, getSubscriptionSyncBody } from "@/lib/revenuecat";
import { useT } from "@/lib/i18n";
import { STANDARD_REPORT_LIMIT } from "@/lib/quotas";

const TERMS_URL = "https://www.projectalpha.app/terms/";
const PRIVACY_URL = "https://www.projectalpha.app/privacy/";

interface Props {
  visible: boolean;
  onClose: () => void;
  onPurchaseSuccess?: () => void;
}

export function PaywallModal({ visible, onClose, onPurchaseSuccess }: Props) {
  const colors = useColors();
  const { getApiHeaders, refreshProfile } = useAuth();
  const { purchase, restore, isPurchasing, isRestoring, getFreshPackageForRole, getPriceForRole, refetchCustomerInfo, refetchOfferings, refetchStoreProducts, offeringsLoading, purchaseReadyForRole } =
    useSubscription();
  const { t } = useT();
  const FEATURES = [
    t("paywall.f1"),
    t("feature.private_search"),
    t("paywall.f2"),
    t("paywall.f3"),
    t("paywall.f4"),
    t("paywall.f5"),
    t("paywall.f6"),
  ];
  const slideAnim = useRef(new Animated.Value(400)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      void refetchOfferings();
      void refetchStoreProducts();
    }
  }, [visible, refetchOfferings, refetchStoreProducts]);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }),
        Animated.timing(overlayAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
        Animated.timing(overlayAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  const syncToBackend = async (tier: "pro" | "free"): Promise<boolean> => {
    try {
      const body = await getSubscriptionSyncBody(tier);
      const resp = await fetch(`${getApiBase()}/subscription/sync`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(body),
      });
      await refreshProfile().catch(() => {});
      return resp.ok;
    } catch {
      return false;
    }
  };

  const handleUpgrade = async () => {
    const pkg = await getFreshPackageForRole("general");
    if (!pkg) {
      Alert.alert(t("paywall.not_available"), t("profile.sub_unavailable"));
      return;
    }
    try {
      await purchase(pkg);
      await refetchCustomerInfo();
      const synced = await syncToBackend("pro");
      if (!synced) {
        Alert.alert(t("paywall.almost_there"), t("paywall.no_account_activate"));
        return;
      }
      onPurchaseSuccess?.();
      onClose();
      Alert.alert(t("paywall.welcome_title"), t("paywall.welcome_msg", { n: STANDARD_REPORT_LIMIT }));
    } catch (err: unknown) {
      const userCancelled = (err as { userCancelled?: boolean })?.userCancelled;
      if (!userCancelled) {
        const message = (err as { message?: string })?.message;
        Alert.alert(t("paywall.purchase_failed"), message ?? t("paywall.purchase_failed_msg"));
      }
    }
  };

  const handleRestore = async () => {
    try {
      const info = await restore();
      const isActive = info?.entitlements?.active?.["Pro"] !== undefined;
      if (isActive) {
        await refetchCustomerInfo();
        await syncToBackend("pro");
        onPurchaseSuccess?.();
        onClose();
        Alert.alert(t("paywall.restored_title"), t("paywall.restored_msg"));
      } else {
        Alert.alert(t("paywall.no_purchases"), t("paywall.no_purchases_msg"));
      }
    } catch {
      Alert.alert(t("paywall.restore_failed"), t("paywall.restore_failed_msg"));
    }
  };

  const openLegalLink = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert(t("common.error"), t("paywall.legal_open_failed"));
    }
  };

  const priceString = getPriceForRole("general");

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <Animated.View
          style={[styles.sheet, { backgroundColor: colors.card, transform: [{ translateY: slideAnim }] }]}
        >
          <View style={[styles.handle, { backgroundColor: "#EADFD8" }]} />

          <View style={[styles.iconWrap, { backgroundColor: "#F3E2D8" }]}>
            <Feather name="zap" size={22} color="#C86B4E" />
          </View>

          <Text style={[styles.title, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            {t("paywall.title")}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("paywall.subtitle")}
          </Text>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <Feather name="check-circle" size={14} color="#2FA87A" />
                <Text style={[styles.featureText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>{f}</Text>
              </View>
            ))}
          </View>

          <View style={[styles.planCard, { borderColor: "#D87355", backgroundColor: "#FBF6F1", borderWidth: 2, alignSelf: "stretch" }]}>
            <Text style={[styles.planLabel, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
              {t("paywall.standard_monthly")}
            </Text>
            <Text style={[styles.planPrice, { color: "#C86B4E", fontFamily: "DM_Sans_700Bold" }]}>
              {priceString}
            </Text>
            <Text style={[styles.planDesc, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("paywall.billed_cancel")}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: isPurchasing ? "#D8735580" : "#D87355" }]}
            onPress={handleUpgrade}
            activeOpacity={0.85}
            disabled={isPurchasing || isRestoring || offeringsLoading}
          >
            {isPurchasing || (offeringsLoading && !isPurchasing)
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                    {t("paywall.get_standard")}
                  </Text>
                  <Feather name="arrow-right" size={16} color="#fff" />
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRestore}
            style={styles.restoreBtn}
            activeOpacity={0.7}
            disabled={isPurchasing || isRestoring}
          >
            <Text style={[styles.restoreText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {isRestoring ? t("paywall.restoring") : t("paywall.restore")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.dismissBtn} activeOpacity={0.7}>
            <Text style={[styles.dismissText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("paywall.maybe_later")}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.legalText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("paywall.legal", { store: Platform.OS === "ios" ? "Apple ID" : "Google Play" })}
          </Text>
          <View style={styles.legalLinksRow}>
            <TouchableOpacity onPress={() => openLegalLink(TERMS_URL)} activeOpacity={0.7} hitSlop={8}>
              <Text style={[styles.legalLink, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]}>
                {t("paywall.terms")}
              </Text>
            </TouchableOpacity>
            <Text style={[styles.legalSeparator, { color: colors.mutedForeground }]}>•</Text>
            <TouchableOpacity onPress={() => openLegalLink(PRIVACY_URL)} activeOpacity={0.7} hitSlop={8}>
              <Text style={[styles.legalLink, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]}>
                {t("paywall.privacy")}
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 24,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 12,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: -4,
  },
  features: {
    alignSelf: "stretch",
    gap: 7,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  featureText: {
    fontSize: 13,
    lineHeight: 19,
  },
  plansRow: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 8,
    marginTop: 4,
  },
  planCard: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    gap: 3,
    position: "relative",
    minHeight: 90,
    justifyContent: "center",
  },
  bestBadge: {
    position: "absolute",
    top: -8,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 100,
  },
  bestBadgeText: {
    fontSize: 8,
    color: "#fff",
    letterSpacing: 0.5,
  },
  planLabel: {
    fontSize: 12,
    letterSpacing: 0.2,
  },
  planPrice: {
    fontSize: 17,
    letterSpacing: -0.3,
    marginTop: 1,
  },
  planDesc: {
    fontSize: 10,
    textAlign: "center",
    lineHeight: 14,
  },
  checkMark: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 15,
    borderRadius: 14,
    alignSelf: "stretch",
    marginTop: 4,
    minHeight: 52,
  },
  upgradeBtnText: {
    fontSize: 16,
    color: "#fff",
  },
  restoreBtn: {
    paddingVertical: 6,
  },
  restoreText: {
    fontSize: 13,
  },
  dismissBtn: {
    paddingVertical: 6,
  },
  dismissText: {
    fontSize: 14,
  },
  legalText: {
    fontSize: 10,
    textAlign: "center",
    lineHeight: 15,
    opacity: 0.7,
  },
  legalLinksRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: -4,
  },
  legalLink: {
    fontSize: 11,
    textDecorationLine: "underline",
  },
  legalSeparator: {
    fontSize: 11,
    opacity: 0.6,
  },
});
