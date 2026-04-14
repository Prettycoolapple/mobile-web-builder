import React, { useRef, useEffect, useState } from "react";
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
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import {
  getOfferings,
  purchasePlan,
  restorePurchases,
  type PlanInfo,
  type PlanType,
} from "@/lib/revenuecat";

interface Props {
  visible: boolean;
  onClose: () => void;
  onPurchaseSuccess?: () => void;
}

const FEATURES = [
  "20 feasibility reports per month",
  "Complete property data pipeline",
  "AI risk assessments & ROI modelling",
  "Save and revisit past reports",
  "Export to PDF (coming soon)",
];

function getApiBase(): string {
  if (process.env["EXPO_PUBLIC_DOMAIN"]) {
    return `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  }
  return "/api";
}

export function PaywallModal({ visible, onClose, onPurchaseSuccess }: Props) {
  const colors = useColors();
  const { getApiHeaders, refreshProfile } = useAuth();
  const slideAnim = useRef(new Animated.Value(400)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType>("monthly");
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  useEffect(() => {
    if (visible) {
      setLoadingPlans(true);
      getOfferings().then((p) => { setPlans(p); setLoadingPlans(false); });
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

  const syncToBackend = async (tier: "pro" | "free") => {
    try {
      await fetch(`${getApiBase()}/subscription/sync`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ tier }),
      });
      await refreshProfile().catch(() => {});
    } catch {
    }
  };

  const handleUpgrade = async () => {
    const plan = plans.find((p) => p.type === selectedPlan);
    if (!plan?.pkg) {
      Alert.alert(
        "Not available",
        "In-app purchases require the full app build. If you have already purchased, tap Restore.",
      );
      return;
    }
    setLoading(true);
    try {
      const isPro = await purchasePlan(plan.pkg);
      if (isPro) {
        await syncToBackend("pro");
        onPurchaseSuccess?.();
        onClose();
        Alert.alert("Welcome to Standard!", "You now have 20 reports per month.");
      }
    } catch (err: any) {
      Alert.alert("Purchase failed", err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const isPro = await restorePurchases();
      if (isPro) {
        await syncToBackend("pro");
        onPurchaseSuccess?.();
        onClose();
        Alert.alert("Purchases restored", "Your Standard subscription is active.");
      } else {
        Alert.alert("No purchases found", "No active Standard subscription was found for this account.");
      }
    } catch {
      Alert.alert("Restore failed", "Could not restore purchases. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onClose}>
      <Animated.View style={[styles.overlay, { opacity: overlayAnim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} activeOpacity={1} />
        <Animated.View
          style={[styles.sheet, { backgroundColor: colors.card, transform: [{ translateY: slideAnim }] }]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={[styles.iconWrap, { backgroundColor: colors.accent + "15" }]}>
            <Feather name="zap" size={22} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            Upgrade to Standard
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            20 reports per month with full AI-powered property analysis
          </Text>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <Feather name="check-circle" size={14} color={colors.success} />
                <Text style={[styles.featureText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>{f}</Text>
              </View>
            ))}
          </View>

          {loadingPlans ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 12 }} />
          ) : (
            <View style={styles.plansRow}>
              {(plans.length > 0 ? plans : [
                { type: "monthly" as PlanType, label: "Monthly", priceString: "—/mo", description: "Billed monthly", pkg: null },
                { type: "yearly" as PlanType,  label: "Yearly",  priceString: "—/yr", description: "Save ~40%",       pkg: null },
                { type: "lifetime" as PlanType,label: "Lifetime",priceString: "Once", description: "Forever",         pkg: null },
              ]).map((plan) => {
                const isSelected = selectedPlan === plan.type;
                return (
                  <TouchableOpacity
                    key={plan.type}
                    style={[
                      styles.planCard,
                      {
                        borderColor: isSelected ? colors.accent : colors.border,
                        backgroundColor: isSelected ? colors.accent + "10" : colors.background,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                    onPress={() => setSelectedPlan(plan.type)}
                    activeOpacity={0.8}
                  >
                    {plan.type === "yearly" && (
                      <View style={[styles.bestBadge, { backgroundColor: colors.accent }]}>
                        <Text style={[styles.bestBadgeText, { fontFamily: "DM_Sans_700Bold" }]}>BEST</Text>
                      </View>
                    )}
                    <Text style={[styles.planLabel, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                      {plan.label}
                    </Text>
                    <Text style={[styles.planPrice, { color: isSelected ? colors.accent : colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                      {plan.priceString}
                    </Text>
                    <Text style={[styles.planDesc, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      {plan.description}
                    </Text>
                    {isSelected && (
                      <View style={[styles.checkMark, { backgroundColor: colors.accent }]}>
                        <Feather name="check" size={10} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: loading ? colors.accent + "80" : colors.accent }]}
            onPress={handleUpgrade}
            activeOpacity={0.85}
            disabled={loading || restoring}
          >
            {loading
              ? <ActivityIndicator size="small" color="#fff" />
              : <>
                  <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                    Get Standard
                  </Text>
                  <Feather name="arrow-right" size={16} color="#fff" />
                </>
            }
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleRestore}
            style={styles.restoreBtn}
            activeOpacity={0.7}
            disabled={loading || restoring}
          >
            <Text style={[styles.restoreText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {restoring ? "Restoring…" : "Restore purchases"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.dismissBtn} activeOpacity={0.7}>
            <Text style={[styles.dismissText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Maybe later
            </Text>
          </TouchableOpacity>

          <Text style={[styles.legalText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Payment will be charged to your {Platform.OS === "ios" ? "Apple ID" : "Google Play"} account at confirmation.
            Subscriptions automatically renew unless cancelled at least 24 hours before the end of the current period.
            Manage in your device Settings.
          </Text>
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
});
