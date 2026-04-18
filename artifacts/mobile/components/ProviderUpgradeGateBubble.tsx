import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSubscription } from "@/lib/revenuecat";

interface Props {
  onUpgrade: () => void;
  onDismiss?: () => void;
}

const FEATURES = [
  "Message verified specialists directly",
  "20 feasibility reports per month",
  "Save and revisit past reports",
];

export function ProviderUpgradeGateBubble({ onUpgrade, onDismiss }: Props) {
  const { getPriceForRole } = useSubscription();
  const price = getPriceForRole("general");
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.iconWrap}>
          <Feather name="zap" size={14} color="#7C3AED" />
        </View>
        <Text style={styles.header}>Standard feature</Text>
      </View>

      <Text style={styles.body}>
        Connecting with a service provider is a Standard feature. Upgrade to
        message specialists directly from chat.
      </Text>

      <View style={styles.card}>
        <View style={styles.planRow}>
          <Text style={styles.planLabel}>Standard Monthly</Text>
          <Text style={styles.planPrice}>{price}</Text>
        </View>
        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check-circle" size={12} color="#10B981" />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={styles.upgradeBtn}
        onPress={onUpgrade}
        activeOpacity={0.85}
      >
        <Text style={styles.upgradeBtnText}>Get Standard</Text>
        <Feather name="arrow-right" size={15} color="#fff" />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        activeOpacity={0.7}
      >
        <Text style={styles.dismissText}>Not now</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F5F3FF",
    borderWidth: 1,
    borderColor: "#DDD6FE",
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 8,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 6,
    backgroundColor: "#EDE9FE",
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    fontSize: 11,
    color: "#7C3AED",
    fontFamily: "DM_Sans_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  body: {
    fontSize: 14,
    color: "#374151",
    lineHeight: 22,
    fontFamily: "DM_Sans_400Regular",
    marginBottom: 12,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  planLabel: {
    fontSize: 13,
    color: "#111827",
    fontFamily: "DM_Sans_600SemiBold",
  },
  planPrice: {
    fontSize: 16,
    color: "#7C3AED",
    fontFamily: "DM_Sans_700Bold",
    letterSpacing: -0.3,
  },
  features: {
    gap: 6,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  featureText: {
    fontSize: 12,
    color: "#4B5563",
    fontFamily: "DM_Sans_400Regular",
    flex: 1,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#7C3AED",
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  upgradeBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "DM_Sans_600SemiBold",
  },
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 2,
  },
  dismissText: {
    color: "#9CA3AF",
    fontSize: 13,
    fontFamily: "DM_Sans_400Regular",
  },
});
