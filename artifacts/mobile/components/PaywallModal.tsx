import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Linking,
  Platform,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const FEATURES = [
  "Unlimited feasibility reports",
  "Full data pipeline (LINZ, Hougarden, GIS)",
  "Export to PDF (coming soon)",
];

function getApiBase(): string {
  if (process.env["EXPO_PUBLIC_DOMAIN"]) {
    return `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  }
  return "/api";
}

export function PaywallModal({ visible, onClose }: Props) {
  const colors = useColors();
  const { getApiHeaders } = useAuth();
  const slideAnim = useRef(new Animated.Value(300)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;

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

  const handleUpgrade = async () => {
    try {
      const resp = await fetch(`${getApiBase()}/stripe/checkout`, {
        method: "POST",
        headers: getApiHeaders(),
      });
      if (!resp.ok) {
        const err = (await resp.json()) as { error?: string };
        Alert.alert("Payment setup failed", err.error ?? "Please try again or contact support.");
        return;
      }
      const { url } = (await resp.json()) as { url: string };
      if (url) {
        await Linking.openURL(url);
        onClose();
      }
    } catch {
      Alert.alert("Payment setup failed", "Please try again or contact support.");
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
            style={[styles.upgradeBtn, { backgroundColor: colors.accent }]}
            onPress={handleUpgrade}
            activeOpacity={0.85}
          >
            <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Upgrade to Pro</Text>
            <Feather name="arrow-right" size={16} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={styles.dismissBtn} activeOpacity={0.7}>
            <Text style={[styles.dismissText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Maybe later
            </Text>
          </TouchableOpacity>
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
    gap: 16,
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
    gap: 10,
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
  },
  upgradeBtnText: {
    fontSize: 16,
    color: "#fff",
  },
  dismissBtn: {
    paddingVertical: 8,
    marginBottom: Platform.OS === "ios" ? 8 : 0,
  },
  dismissText: {
    fontSize: 14,
  },
});
