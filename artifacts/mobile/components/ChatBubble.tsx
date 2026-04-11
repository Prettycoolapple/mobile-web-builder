import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import Markdown from "react-native-markdown-display";
import { useColors } from "@/hooks/useColors";
import { ChatMessage } from "@/context/ChatContext";
import { FeasibilityReportCard } from "./FeasibilityReport";
import { PropertyCard } from "./PropertyCard";

interface Props {
  message: ChatMessage;
  onFollowUp: (question: string) => void;
  onAnalyse: (address: string) => void;
}

function TypingDots() {
  const colors = useColors();
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const makePulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.delay(560 - delay),
        ]),
      );

    const anim = Animated.parallel([
      makePulse(dot1, 0),
      makePulse(dot2, 160),
      makePulse(dot3, 320),
    ]);
    anim.start();
    return () => anim.stop();
  }, [dot1, dot2, dot3]);

  const dotStyle = (dot: Animated.Value) => ({
    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
  });

  return (
    <View style={styles.dotsRow}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { backgroundColor: colors.accent }, dotStyle(dot)]}
        />
      ))}
    </View>
  );
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
          <TypingDots />
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

  const markdownStyles = {
    body: {
      color: colors.foreground,
      fontFamily: "DM_Sans_400Regular",
      fontSize: 15,
      lineHeight: 23,
    },
    strong: {
      fontFamily: "DM_Sans_600SemiBold",
      color: colors.foreground,
    },
    bullet_list_icon: {
      color: colors.accent,
      marginTop: 6,
    },
    bullet_list_content: {
      flex: 1,
    },
    paragraph: {
      marginBottom: 6,
      marginTop: 0,
    },
    heading1: {
      fontFamily: "DM_Sans_700Bold",
      fontSize: 17,
      color: colors.foreground,
      marginBottom: 8,
    },
    heading2: {
      fontFamily: "DM_Sans_600SemiBold",
      fontSize: 16,
      color: colors.foreground,
      marginBottom: 6,
    },
    heading3: {
      fontFamily: "DM_Sans_600SemiBold",
      fontSize: 15,
      color: colors.foreground,
      marginBottom: 4,
    },
    code_inline: {
      backgroundColor: colors.muted,
      color: colors.foreground,
      borderRadius: 4,
      paddingHorizontal: 4,
      fontFamily: "DM_Sans_400Regular",
      fontSize: 13,
    },
    fence: {
      backgroundColor: colors.muted,
      borderRadius: 8,
      padding: 10,
      marginBottom: 8,
    },
    blockquote: {
      borderLeftColor: colors.accent,
      borderLeftWidth: 3,
      paddingLeft: 12,
      opacity: 0.85,
    },
  };

  return (
    <View style={styles.aiRow}>
      <View style={[styles.aiAvatar, { backgroundColor: colors.accent }]}>
        <Text style={styles.aiAvatarText}>D</Text>
      </View>
      <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Markdown style={markdownStyles as any}>
          {message.content}
        </Markdown>
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
    alignSelf: "flex-start",
    marginTop: 4,
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
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
    shadowColor: "rgba(28,25,23,0.05)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  loadingBubble: {
    flex: 1,
    alignItems: "flex-start",
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  dotsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
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
