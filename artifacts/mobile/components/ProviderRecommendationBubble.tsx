import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { ServiceProvider } from "@/context/ChatContext";

interface Props {
  provider: ServiceProvider;
  intentType: string;
  propertyAddress: string;
  onConnect: (providerId: string) => Promise<void>;
  onDismiss: () => void;
}

function ProviderAvatar({ provider }: { provider: ServiceProvider }) {
  const initials = (provider.fullName ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarInitials}>{initials}</Text>
    </View>
  );
}

function intentLabel(intentType: string): string {
  switch (intentType) {
    case "subdivision": return "subdivision potential";
    case "newbuild": return "new build potential";
    case "renovation": return "development potential";
    default: return "development potential";
  }
}

function disciplineLabel(discipline: string | null): string {
  if (!discipline) return "Development Specialist";
  switch (discipline) {
    case "architect_designer": return "Architect / Designer";
    case "planner": return "Planner";
    case "engineer": return "Engineer";
    case "quantity_surveyor": return "Quantity Surveyor";
    default: return "Development Specialist";
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

  if (dismissed) return null;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      await onConnect(provider.id);
    } finally {
      setConnecting(false);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>🤖 AI suggestion</Text>

      <Text style={styles.body}>
        Based on this property's {intentLabel(intentType)}, I'd like to connect
        you with a development specialist who can help move this forward.
      </Text>

      <View style={styles.card}>
        <View style={styles.cardTop}>
          <ProviderAvatar provider={provider} />
          <View style={styles.cardInfo}>
            <Text style={styles.providerName} numberOfLines={1}>
              {provider.fullName ?? "Development Specialist"}
            </Text>
            {provider.companyName ? (
              <Text style={styles.specialty} numberOfLines={1}>
                {provider.companyName}
              </Text>
            ) : (
              <Text style={styles.specialty}>
                {disciplineLabel(provider.discipline)}
              </Text>
            )}
            <Text style={styles.connections}>
              ★ {provider.recommendationCount} {provider.recommendationCount === 1 ? "recommendation" : "recommendations"}
            </Text>
          </View>
        </View>
        {provider.bio ? (
          <Text style={styles.bio} numberOfLines={2}>
            "{provider.bio}"
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.connectBtn, connecting && styles.connectBtnDisabled]}
        onPress={handleConnect}
        disabled={connecting}
        activeOpacity={0.8}
      >
        {connecting ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.connectBtnText}>Connect &amp; Message  →</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        activeOpacity={0.7}
      >
        <Text style={styles.dismissText}>Not interested</Text>
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
  header: {
    fontSize: 11,
    color: "#7C3AED",
    fontFamily: "DM_Sans_600SemiBold",
    marginBottom: 8,
    letterSpacing: 0.2,
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
  avatarInitials: {
    fontSize: 14,
    color: "#fff",
    fontFamily: "DM_Sans_700Bold",
  },
  cardInfo: {
    flex: 1,
    gap: 2,
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
  connections: {
    fontSize: 12,
    color: "#10B981",
    fontFamily: "DM_Sans_500Medium",
  },
  bio: {
    fontSize: 13,
    color: "#4B5563",
    fontStyle: "italic",
    fontFamily: "DM_Sans_400Regular",
    lineHeight: 19,
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
