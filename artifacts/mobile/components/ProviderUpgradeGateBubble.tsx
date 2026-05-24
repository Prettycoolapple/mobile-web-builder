import React, { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSubscription } from "@/lib/revenuecat";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/context/AuthContext";

interface Props {
  onUpgrade: () => void;
  onDismiss?: () => void;
}

export function ProviderUpgradeGateBubble({ onUpgrade, onDismiss }: Props) {
  const { user } = useAuth();
  const { getPriceForRole, isSubscribed } = useSubscription();
  const price = getPriceForRole("general");
  const [dismissed, setDismissed] = useState(false);
  const { t } = useT();
  const subscriptionTier = user?.subscriptionTier ?? "free";
  const hasActiveSpecialStatus =
    user?.specialStatus === "friends_family" ||
    (user?.specialStatus === "supercharge" &&
      (!user?.specialStatusExpiresAt ||
        new Date(user.specialStatusExpiresAt) > new Date()));
  const isActive = isSubscribed || hasActiveSpecialStatus || subscriptionTier === "standard" || subscriptionTier === "pro";

  const features = useMemo(
    () => [
      t("paywall.f1"),
      t("paywall.f2"),
      t("paywall.f3"),
      t("paywall.f4"),
      t("paywall.f5"),
      t("paywall.f6"),
    ],
    [t],
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, isActive && styles.activeIconWrap]}>
          <Feather name={isActive ? "check" : "zap"} size={14} color={isActive ? "#2FA87A" : "#C86B4E"} />
        </View>
        <Text style={[styles.header, isActive && styles.activeHeader]}>
          {isActive ? t("bubble.upgrade.active_badge") : t("bubble.upgrade.badge")}
        </Text>
      </View>

      <Text style={styles.body}>
        {isActive ? t("bubble.upgrade.active_body") : t("bubble.upgrade.body")}
      </Text>

      <View style={styles.card}>
        <View style={styles.planRow}>
          <Text style={styles.planLabel}>{t("bubble.upgrade.plan_label")}</Text>
          <Text style={styles.planPrice}>{price}</Text>
        </View>
        <View style={styles.features}>
          {features.map((f) => (
            <View key={f} style={styles.featureRow}>
              <Feather name="check-circle" size={13} color="#2FA87A" />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={[styles.upgradeBtn, isActive && styles.activeBtn]}
        onPress={onUpgrade}
        activeOpacity={0.85}
        disabled={isActive}
      >
        <Text style={styles.upgradeBtnText}>
          {isActive ? t("bubble.upgrade.active_cta") : t("bubble.upgrade.cta")}
        </Text>
        <Feather name={isActive ? "check-circle" : "arrow-right"} size={15} color="#fff" />
      </TouchableOpacity>

      {!isActive && (
        <TouchableOpacity
          style={styles.dismissBtn}
          onPress={handleDismiss}
          activeOpacity={0.7}
        >
          <Text style={styles.dismissText}>{t("bubble.upgrade.dismiss")}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#FBF6F1",
    borderWidth: 1,
    borderColor: "#E8D6CB",
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
    backgroundColor: "#F3E2D8",
    alignItems: "center",
    justifyContent: "center",
  },
  activeIconWrap: {
    backgroundColor: "#E4F6EE",
  },
  header: {
    fontSize: 11,
    color: "#B95E43",
    fontFamily: "DM_Sans_600SemiBold",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  activeHeader: {
    color: "#25865F",
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
    borderColor: "#EADFD8",
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
    color: "#C86B4E",
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
    backgroundColor: "#D87355",
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  activeBtn: {
    backgroundColor: "#2FA87A",
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
    color: "#9A8F87",
    fontSize: 13,
    fontFamily: "DM_Sans_400Regular",
  },
});
