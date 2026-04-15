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

interface Props {
  agentName: string | null;
  agencyName: string | null;
  agentPhone: string;
  propertyAddress: string;
  onDismiss: () => void;
}

export function AgentCallBubble({
  agentName,
  agencyName,
  agentPhone,
  propertyAddress,
  onDismiss,
}: Props) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleCall = async () => {
    const telUrl = `tel:${agentPhone}`;
    const canOpen = await Linking.canOpenURL(telUrl);
    if (canOpen) {
      await Linking.openURL(telUrl);
    } else {
      Alert.alert(
        "Cannot make call",
        "Your device doesn't support direct calls from this app. Please call the agent manually.",
      );
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss();
  };

  const displayName = agentName ?? "Listing Agent";
  const displayAgency = agencyName ?? "Real Estate Agency";
  const addressShort = propertyAddress.split(",")[0] ?? propertyAddress;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>🏠 Listing agent found</Text>

      <Text style={styles.body}>
        I found the agent handling {addressShort}. Tap below to call them directly.
      </Text>

      <View style={styles.card}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Feather name="user" size={20} color="#fff" />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.agentName} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={styles.agencyName} numberOfLines={1}>
              {displayAgency}
            </Text>
          </View>
        </View>
        <View style={styles.privateNote}>
          <Feather name="lock" size={11} color="#6B7280" />
          <Text style={styles.privateText}>Contact number is private — tap Call to connect</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.callBtn}
        onPress={handleCall}
        activeOpacity={0.8}
      >
        <Feather name="phone" size={16} color="#fff" />
        <Text style={styles.callBtnText}>Call Now  →</Text>
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
  privateNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  privateText: {
    fontSize: 11,
    color: "#6B7280",
    fontFamily: "DM_Sans_400Regular",
    flexShrink: 1,
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
