import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { ChatMessage } from "@/context/ChatContext";

export function LimTitleOfferBubble({
  message,
  onRequest,
  onDecline,
}: {
  message: ChatMessage;
  onRequest?: (message: ChatMessage) => void;
  onDecline?: (message: ChatMessage) => void;
}) {
  const colors = useColors();
  const status = message.limTitleStatus ?? "offered";
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: colors.accent + "18" }]}>
        <Feather name="file-text" size={18} color={colors.accent} />
      </View>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>LIM + PROPERTY TITLE</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Would you like the listing agent to send you the LIM report and property Title?</Text>
        {message.propertyAddress ? (
          <Text style={[styles.address, { color: colors.mutedForeground }]} numberOfLines={2}>{message.propertyAddress}</Text>
        ) : null}
        {status === "offered" ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primary, { backgroundColor: colors.accent }]}
              onPress={() => onRequest?.(message)}
              activeOpacity={0.82}
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>Yes, request them</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondary, { borderColor: colors.border }]}
              onPress={() => onDecline?.(message)}
              activeOpacity={0.78}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>No thanks</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Feather name={status === "requested" ? "check-circle" : "x-circle"} size={15} color={status === "requested" ? colors.accent : colors.mutedForeground} />
            <Text style={[styles.statusText, { color: status === "requested" ? colors.accent : colors.mutedForeground }]}>
              {status === "requested" ? "Request sent" : "Offer declined"}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: 9, marginVertical: 5, paddingRight: 28 },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", marginTop: 4 },
  card: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 15, gap: 7 },
  eyebrow: { fontFamily: "DM_Sans_700Bold", fontSize: 10, letterSpacing: 0.7 },
  title: { fontFamily: "DM_Sans_600SemiBold", fontSize: 15, lineHeight: 21 },
  address: { fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: "row", gap: 8, marginTop: 5, flexWrap: "wrap" },
  primary: { borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  primaryText: { color: "#fff", fontFamily: "DM_Sans_700Bold", fontSize: 12 },
  secondary: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 9 },
  secondaryText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  statusText: { fontFamily: "DM_Sans_600SemiBold", fontSize: 12 },
});
