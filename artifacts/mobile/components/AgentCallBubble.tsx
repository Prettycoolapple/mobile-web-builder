import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useT } from "@/lib/i18n";
import { getApiBase } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface Props {
  agentName: string | null;
  agencyName: string | null;
  agentAvatarUrl?: string | null;
  agentPhone: string;
  propertyAddress: string;
  matchType?: "subject" | "suburb";
  onDismiss: () => void;
}

export function AgentCallBubble({
  agentName,
  agencyName,
  agentAvatarUrl,
  agentPhone,
  propertyAddress,
  matchType,
  onDismiss,
}: Props) {
  const [dismissed, setDismissed] = useState(false);
  const { t } = useT();
  const { getApiHeaders } = useAuth();

  if (dismissed) return null;

  const logAgentCallEvent = () => {
    // Fire-and-forget — the dialer must NEVER be blocked by this network call.
    try {
      void fetch(`${getApiBase()}/agent-call-event`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          agentPhone,
          agentName,
          agencyName,
          propertyAddress,
        }),
      }).catch(() => {});
    } catch {
      // swallow — logging failure must not affect the call
    }
  };

  const handleCall = async () => {
    logAgentCallEvent();
    const dialNumber = agentPhone.replace(/[^\d+]/g, "");
    const telUrl = `tel:${dialNumber}`;
    const canOpen = await Linking.canOpenURL(telUrl);
    if (canOpen) {
      await Linking.openURL(telUrl);
    } else {
      Alert.alert(
        t("bubble.agent.cant_call_title"),
        t("bubble.agent.cant_call_body"),
      );
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  const displayName = agentName ?? t("bubble.agent.default_name");
  const displayAgency = agencyName ?? t("bubble.agent.default_agency");
  const addressShort = propertyAddress.split(",")[0] ?? propertyAddress;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{t("bubble.agent.header")}</Text>

      <Text style={styles.body}>
        {t(matchType === "suburb" ? "bubble.agent.body_suburb" : "bubble.agent.body", { address: addressShort })}
      </Text>

      <View style={styles.card}>
        <View style={styles.avatarWrap}>
          {agentAvatarUrl ? (
            <Image
              source={{ uri: agentAvatarUrl }}
              style={styles.avatarImage}
              contentFit="cover"
              transition={120}
            />
          ) : (
            <View style={styles.avatar}>
              <Feather name="user" size={20} color="#fff" />
            </View>
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.agentName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.agencyName} numberOfLines={1}>
              {displayAgency}
            </Text>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={styles.callBtn}
        onPress={handleCall}
        activeOpacity={0.8}
      >
        <Feather name="phone" size={16} color="#fff" />
        <Text style={styles.callBtnText}>{t("bubble.agent.call_cta")}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.dismissBtn}
        onPress={handleDismiss}
        activeOpacity={0.7}
      >
        <Text style={styles.dismissText}>{t("bubble.agent.dismiss")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#F0FDF4",
    borderWidth: 1,
    borderColor: "#BBF7D0",
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  header: {
    fontSize: 11,
    color: "#15803D",
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
    borderColor: "#D1FAE5",
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  avatarWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#16A34A",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EDE7E1",
    flexShrink: 0,
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  agentName: {
    fontSize: 15,
    fontFamily: "DM_Sans_600SemiBold",
    color: "#111827",
  },
  agencyName: {
    fontSize: 12,
    color: "#6B7280",
    fontFamily: "DM_Sans_400Regular",
  },
  callBtn: {
    backgroundColor: "#16A34A",
    borderRadius: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  callBtnText: {
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
