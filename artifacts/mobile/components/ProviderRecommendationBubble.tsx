import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { ServiceProvider } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { avatarImageSource } from "@/lib/avatar";
import { useT } from "@/lib/i18n";

interface Props {
  provider: ServiceProvider;
  intentType: string;
  propertyAddress: string;
  onConnect: (providerId: string) => Promise<void>;
  onDismiss: () => void;
}

function ProviderAvatar({ provider }: { provider: ServiceProvider }) {
  const { getApiHeaders } = useAuth();
  const source = avatarImageSource(provider.avatarUrl, getApiHeaders());
  const initials = (provider.fullName ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (source) {
    return (
      <Image
        source={source}
        style={styles.avatarImage}
        resizeMode="cover"
      />
    );
  }

  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitials}>{initials}</Text>
    </View>
  );
}

function intentLabel(
  intentType: string,
  hasAddress: boolean,
  t: (key: string) => string,
): string {
  if (intentType === "referral" || !hasAddress) return t("bubble.recommend.dev_projects");
  switch (intentType) {
    case "subdivision": return t("bubble.recommend.subdivision");
    case "newbuild": return t("bubble.recommend.newbuild");
    case "renovation": return t("bubble.recommend.renovation");
    default: return t("bubble.recommend.default_label");
  }
}

function disciplineLabel(discipline: string | null, t: (key: string) => string): string {
  if (!discipline) return t("bubble.recommend.default_discipline");
  switch (discipline) {
    case "architect_designer": return t("dm.discipline.architect_designer");
    case "planner": return t("dm.discipline.planner");
    case "engineer": return t("dm.discipline.engineer");
    case "quantity_surveyor": return t("dm.discipline.quantity_surveyor");
    default: return t("bubble.recommend.default_discipline");
  }
}

export function ProviderRecommendationBubble({
  provider,
  intentType,
  propertyAddress,
  onConnect,
  onDismiss,
}: Props) {
  const [connecting, setConnecting] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const { t } = useT();

  if (dismissed) return null;

  const hasAddress = !!propertyAddress;
  const label = intentLabel(intentType, hasAddress, t);

  const locationParts = [provider.addressSuburb, provider.addressCity].filter(Boolean);
  const locationString = locationParts.length > 0 ? locationParts.join(", ") : null;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect(provider.id);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : t("bubble.recommend.connect_error_body");
      Alert.alert(t("bubble.recommend.connect_error_title"), message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  const bodyText = hasAddress
    ? t("bubble.recommend.with_address", { label })
    : t("bubble.recommend.without_address", {
        discipline: disciplineLabel(provider.discipline, t),
        label,
      });

  return (
    <View style={styles.container}>
      <Text style={styles.body}>{bodyText}</Text>

      <View style={styles.card}>
        <View style={styles.cardTop}>
          <ProviderAvatar provider={provider} />
          <View style={styles.cardInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.providerName} numberOfLines={1}>
                {provider.fullName ?? t("bubble.recommend.default_discipline")}
              </Text>
              {provider.isVerified && (
                <View style={styles.verifiedBadge}>
                  <Feather name="shield" size={10} color="#10B981" />
                  <Text style={styles.verifiedText}>{t("bubble.recommend.verified")}</Text>
                </View>
              )}
            </View>

            <Text style={styles.specialty} numberOfLines={1}>
              {provider.companyName
                ? `${provider.companyName} · ${disciplineLabel(provider.discipline, t)}`
                : disciplineLabel(provider.discipline, t)}
            </Text>

            {locationString ? (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={11} color="#9CA3AF" />
                <Text style={styles.metaText}>{locationString}</Text>
              </View>
            ) : null}

            {(() => {
              const langs = [provider.primaryLanguage, provider.secondaryLanguage]
                .filter((l): l is string => !!l && l.trim().length > 0);
              if (langs.length === 0) return null;
              return (
                <View style={styles.metaRow}>
                  <Feather name="globe" size={11} color="#9CA3AF" />
                  <Text style={styles.metaText}>{langs.join(" · ")}</Text>
                </View>
              );
            })()}

            <Text style={styles.connections}>
              {provider.recommendationCount === 1
                ? t("bubble.recommend.connections_one", { n: provider.recommendationCount })
                : t("bubble.recommend.connections_other", { n: provider.recommendationCount })}
            </Text>
          </View>
        </View>

        {provider.bio ? (
          <Text style={styles.bio} numberOfLines={2}>
            "{provider.bio}"
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.connectBtn, connecting && styles.connectBtnDisabled]}
          onPress={handleConnect}
          disabled={connecting}
          activeOpacity={0.8}
        >
          {connecting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.connectBtnText}>{t("bubble.recommend.message_cta")}</Text>
          )}
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        activeOpacity={0.7}
      >
        <Text style={styles.dismissText}>{t("bubble.recommend.dismiss")}</Text>
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
    gap: 8,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#7C3AED",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  avatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
  },
  avatarInitials: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "DM_Sans_700Bold",
  },
  cardInfo: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  verifiedText: {
    fontSize: 11,
    color: "#9CA3AF",
    fontFamily: "DM_Sans_400Regular",
  },
  providerName: {
    fontSize: 15,
    fontFamily: "DM_Sans_600SemiBold",
    color: "#111827",
  },
  specialty: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "DM_Sans_400Regular",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: "#9CA3AF",
    fontFamily: "DM_Sans_400Regular",
  },
  connections: {
    fontSize: 12,
    color: "#10B981",
    fontFamily: "DM_Sans_500Medium",
    marginTop: 1,
  },
  bio: {
    fontSize: 13,
    color: "#4B5563",
    fontStyle: "italic",
    fontFamily: "DM_Sans_400Regular",
    lineHeight: 19,
  },
  actions: {
    gap: 8,
    marginBottom: 4,
  },
  connectBtn: {
    backgroundColor: "#10B981",
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  connectBtnDisabled: {
    opacity: 0.7,
  },
  connectBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "DM_Sans_600SemiBold",
  },
  dismissBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  dismissText: {
    color: "#9CA3AF",
    fontSize: 13,
    fontFamily: "DM_Sans_400Regular",
  },
});
