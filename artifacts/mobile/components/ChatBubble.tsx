import React from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useColors } from "@/hooks/useColors";
import { ChatMessage } from "@/context/ChatContext";
import { FeasibilityReportCard } from "./FeasibilityReport";
import { PropertyCard } from "./PropertyCard";

interface Props {
  message: ChatMessage;
  onFollowUp: (question: string) => void;
  onAnalyse: (address: string) => void;
}

export function ChatBubble({ message, onFollowUp, onAnalyse }: Props) {
  const colors = useColors();
  const isUser = message.role === "user";

  if (message.type === "loading") {
    return (
      <View style={styles.aiRow}>
        <View style={[styles.aiAvatar, { backgroundColor: colors.accent }]}>
          <Text style={styles.aiAvatarText}>D</Text>
        </View>
        <View style={[styles.loadingBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Analysing property…
          </Text>
        </View>
      </View>
    );
  }

  if (message.type === "report" && message.report) {
    return (
      <View style={styles.reportContainer}>
        <FeasibilityReportCard report={message.report} onFollowUp={onFollowUp} />
      </View>
    );
  }

  if (message.type === "search" && message.searchResults) {
    return (
      <View style={styles.searchContainer}>
        <Text style={[styles.searchHeader, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
          {message.searchResults.length} opportunities found
        </Text>
        {message.searchResults.map((candidate, i) => (
          <PropertyCard key={i} candidate={candidate} onAnalyse={onAnalyse} />
        ))}
      </View>
    );
  }

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={[styles.userBubble, { backgroundColor: colors.accent }]}>
          <Text style={[styles.userText, { fontFamily: "DM_Sans_400Regular" }]}>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.aiRow}>
      <View style={[styles.aiAvatar, { backgroundColor: colors.accent }]}>
        <Text style={styles.aiAvatarText}>D</Text>
      </View>
      <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.aiText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
          {message.content}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  userBubble: {
    maxWidth: "78%",
    borderRadius: 18,
    borderBottomRightRadius: 5,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  userText: {
    fontSize: 15,
    color: "#fff",
    lineHeight: 22,
  },
  aiRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
  },
  aiAvatar: {
    width: 28,
    height: 28,
    borderRadius: 7,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  aiAvatarText: {
    fontSize: 13,
    color: "#fff",
    fontFamily: "DM_Sans_700Bold",
  },
  aiBubble: {
    flex: 1,
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 11,
    shadowColor: "rgba(28,25,23,0.05)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  aiText: {
    fontSize: 15,
    lineHeight: 23,
  },
  loadingBubble: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  loadingText: {
    fontSize: 14,
  },
  reportContainer: {
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  searchContainer: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 10,
  },
  searchHeader: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
});
