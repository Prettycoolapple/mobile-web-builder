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
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { purchasePro, restorePurchases } from "@/lib/revenuecat";

interface Props {
  visible: boolean;
  onClose: () => void;
  onPurchaseSuccess?: () => void;
}

const FEATURES = [
  "Unlimited feasibility reports",
  "Full data pipeline (LINZ, Hougarden, GIS)",
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
  const slideAnim = useRef(new Animated.Value(300)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 200 }),
        Animated.timing(overlayAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
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
    setLoading(true);
    try {
      const isPro = await purchasePro();
      if (isPro) {
        await syncToBackend("pro");
        onPurchaseSuccess?.();
        onClose();
        Alert.alert("Welcome to Pro!", "You now have unlimited feasibility reports.");
      }
    } catch (err: any) {
      Alert.alert(
        "Purchase failed",
        err?.message ?? "Something went wrong. Please try again.",
      );
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
        Alert.alert("Purchases restored", "Your Pro subscription is active.");
      } else {
        Alert.alert("No purchases found", "No active Pro subscription was found for this account.");
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
            <Feather name="zap" size={24} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            You've used all 3 free reports this month
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Upgrade to Pro for unlimited feasibility reports
          </Text>

          <View style={[styles.priceBadge, { backgroundColor: colors.accent + "15", borderColor: colors.accent + "35" }]}>
            <Text style={[styles.priceAmount, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>$49</Text>
            <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>/month NZD</Text>
          </View>

          <View style={styles.features}>
            {FEATURES.map((f) => (
              <View key={f} style={styles.featureRow}>
                <Feather name="check-circle" size={15} color={colors.success} />
                <Text style={[styles.featureText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>{f}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: loading ? colors.accent + "80" : colors.accent }]}
            onPress={handleUpgrade}
            activeOpacity={0.85}
            disabled={loading || restoring}
          >
            {loading
              ? <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Processing…</Text>
              : <>
                  <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Upgrade to Pro</Text>
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
            Subscription automatically renews unless cancelled at least 24 hours before the end of the current period.
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
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 14,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 8,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    letterSpacing: -0.4,
    textAlign: "center",
    lineHeight: 27,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: -4,
  },
  priceBadge: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 100,
    borderWidth: 1,
  },
  priceAmount: {
    fontSize: 24,
    letterSpacing: -0.5,
  },
  pricePer: {
    fontSize: 14,
  },
  features: {
    alignSelf: "stretch",
    gap: 8,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureText: {
    fontSize: 14,
    lineHeight: 20,
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
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    marginTop: 4,
    opacity: 0.7,
  },
});
