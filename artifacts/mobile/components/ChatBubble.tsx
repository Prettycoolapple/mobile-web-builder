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
      <View style={[styles.aiRow]}>
        <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.typingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.typingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Analysing property...
            </Text>
          </View>
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
        <Text style={[styles.searchHeader, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          Found {message.searchResults.length} development opportunities
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
        <View style={[styles.userBubble, { backgroundColor: colors.navy }]}>
          <Text style={[styles.userText, { fontFamily: "Inter_400Regular" }]}>
            {message.content}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.aiRow}>
      <View style={[styles.aiAvatar, { backgroundColor: colors.emerald }]}>
        <Text style={styles.aiAvatarText}>AI</Text>
      </View>
      <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.aiText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
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
  },
  userBubble: {
    maxWidth: "80%",
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    fontSize: 14,
    color: "#fff",
    lineHeight: 20,
  },
  aiRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 16,
    gap: 8,
  },
  aiAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  aiAvatarText: {
    fontSize: 10,
    color: "#fff",
    fontWeight: "700",
  },
  aiBubble: {
    flex: 1,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  aiText: {
    fontSize: 14,
    lineHeight: 22,
  },
  typingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typingText: {
    fontSize: 13,
  },
  reportContainer: {
    paddingHorizontal: 12,
  },
  searchContainer: {
    paddingHorizontal: 12,
    gap: 10,
  },
  searchHeader: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: 4,
  },
});
