import React, { useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Pressable,
  Keyboard,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useChat, ChatMessage, FeasibilityReport, PropertyCandidate } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { ChatBubble } from "@/components/ChatBubble";
import { setBaseUrl } from "@workspace/api-client-react";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

const SUGGESTION_QUERIES = [
  "Analyse 42 Arney Road, Remuera",
  "Find subdividable sections in Grey Lynn under $2M",
  "Analyse 12 Jervois Road, Herne Bay",
  "Find properties with old homes in Sandringham",
];

function detectQueryType(query: string): "analyse" | "search" | "chat" {
  const lower = query.toLowerCase();
  const analyseKeywords = ["analyse", "analyze", "analysis", "feasibility", "check", "look at", "assess"];
  const searchKeywords = ["find", "search", "looking for", "show me properties", "discover", "what properties"];

  if (analyseKeywords.some((k) => lower.includes(k)) && (lower.match(/\d+/) || lower.includes("road") || lower.includes("street") || lower.includes("avenue") || lower.includes("crescent") || lower.includes("place") || lower.includes("drive"))) {
    return "analyse";
  }
  if (searchKeywords.some((k) => lower.includes(k))) {
    return "search";
  }
  if (lower.includes(",") && (lower.includes("road") || lower.includes("street") || lower.includes("avenue") || lower.includes("crescent") || lower.includes("place") || lower.includes("drive") || lower.includes("way"))) {
    return "analyse";
  }
  return "chat";
}

function extractAddress(query: string): string {
  const match = query.match(/(?:analyse|analyze|analysis|check|assess|at|:\s*)?\s*(.+)/i);
  return match ? match[1].trim() : query;
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getApiHeaders, refreshProfile } = useAuth();
  const {
    currentSession,
    currentSessionId,
    createSession,
    addMessage,
    updateLastMessage,
    setCurrentReport,
    isLoading,
    setIsLoading,
  } = useChat();

  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  const messages = currentSession?.messages || [];

  const getApiBase = useCallback(() => {
    if (process.env.EXPO_PUBLIC_DOMAIN) {
      return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    }
    return "/api";
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setInputText("");
    inputRef.current?.focus();

    if (!currentSessionId) {
      createSession();
    }

    addMessage({ role: "user", content: text, type: "text" });
    setIsLoading(true);

    const queryType = detectQueryType(text);

    addMessage({
      role: "assistant",
      content: "",
      type: "loading",
    });

    try {
      const conversationHistory = messages
        .filter((m) => m.type === "text")
        .map((m) => ({ role: m.role, content: m.content }));

      const headers = getApiHeaders();

      if (queryType === "analyse") {
        const address = extractAddress(text);
        const resp = await fetch(`${getApiBase()}/analyse`, {
          method: "POST",
          headers,
          body: JSON.stringify({ address, conversationHistory }),
        });
        const data = (await resp.json()) as { report: FeasibilityReport; type: string; error?: string; code?: string };
        if (!resp.ok) {
          if (resp.status === 402) {
            updateLastMessage({
              type: "text",
              content: `⚠️ ${data.error || "Monthly report limit reached. Upgrade to Pro for unlimited reports."}`,
            });
          } else {
            updateLastMessage({ type: "text", content: data.error || "Analysis failed. Please try again." });
          }
          return;
        }
        setCurrentReport(data.report);
        updateLastMessage({ type: "report", report: data.report, content: "" });
        refreshProfile().catch(() => {});
      } else if (queryType === "search") {
        const resp = await fetch(`${getApiBase()}/search`, {
          method: "POST",
          headers,
          body: JSON.stringify({ query: text }),
        });
        const data = (await resp.json()) as { candidates: PropertyCandidate[]; type: string };
        if (!resp.ok) {
          updateLastMessage({ type: "text", content: "Search failed. Please try again." });
          return;
        }
        updateLastMessage({ type: "search", searchResults: data.candidates, content: "" });
      } else {
        const reportContext = currentSession?.currentReport
          ? JSON.stringify(currentSession.currentReport)
          : undefined;
        const resp = await fetch(`${getApiBase()}/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({ message: text, conversationHistory, reportContext }),
        });
        const data = (await resp.json()) as { message: string; type: string };
        if (!resp.ok) {
          updateLastMessage({ type: "text", content: "Couldn't get a reply. Please try again." });
          return;
        }
        updateLastMessage({ type: "text", content: data.message });
      }
    } catch (err) {
      updateLastMessage({
        type: "text",
        content: "Sorry, I couldn't connect to the analysis service. Please try again.",
      });
    } finally {
      setIsLoading(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [
    inputText,
    isLoading,
    currentSessionId,
    currentSession,
    createSession,
    addMessage,
    updateLastMessage,
    setCurrentReport,
    setIsLoading,
    messages,
    getApiBase,
    getApiHeaders,
    refreshProfile,
  ]);

  const handleFollowUp = useCallback(
    (question: string) => {
      setInputText(question);
      setTimeout(() => inputRef.current?.focus(), 100);
    },
    [],
  );

  const handleAnalyse = useCallback(
    (address: string) => {
      setInputText(`Analyse ${address}`);
      setTimeout(() => {
        setInputText(`Analyse ${address}`);
        handleSend();
      }, 50);
    },
    [handleSend],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatBubble message={item} onFollowUp={handleFollowUp} onAnalyse={handleAnalyse} />
    ),
    [handleFollowUp, handleAnalyse],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const isEmpty = messages.length === 0;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const TAB_BAR_HEIGHT = Platform.OS === "web" ? 84 : 49;
  const tabBarOffset = Platform.OS === "web" ? TAB_BAR_HEIGHT : TAB_BAR_HEIGHT + insets.bottom;
  const canSend = inputText.trim().length > 0 && !isLoading;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.topBar, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.topBarContent}>
          <View style={styles.brandRow}>
            <View style={[styles.logoMark, { backgroundColor: colors.accent }]}>
              <Text style={styles.logoLetter}>D</Text>
            </View>
            <View>
              <Text style={[styles.appName, { fontFamily: "DM_Sans_700Bold" }]}>DevFeasible</Text>
              <Text style={[styles.appSubtitle, { color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular" }]}>
                NZ Property Analysis
              </Text>
            </View>
          </View>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: colors.success }]} />
            <Text style={[styles.statusText, { color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular" }]}>
              AI ready
            </Text>
          </View>
        </View>
      </View>

      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
        {isEmpty ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyHero}>
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                What would you like to{"\n"}analyse today?
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                Ask about any NZ property address, or discover development opportunities by suburb and budget.
              </Text>
            </View>

            <View style={styles.suggestionsSection}>
              <Text style={[styles.suggestionsLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
                Try a query
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTION_QUERIES.map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={[styles.suggestionChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => {
                      setInputText(q);
                      inputRef.current?.focus();
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.suggestionText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
                      {q}
                    </Text>
                    <Feather name="arrow-up-right" size={14} color={colors.accent} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={[...messages].reverse()}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            inverted
            contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}
      </Pressable>

      <View style={[styles.inputBar, {
        backgroundColor: colors.background,
        borderTopColor: colors.border,
        paddingBottom: tabBarOffset + 8,
      }]}>
        <View style={[styles.inputWrapper, {
          backgroundColor: colors.card,
          borderColor: canSend ? colors.accent + "60" : colors.border,
          shadowColor: colors.shadow,
        }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
            placeholder="Ask about an address or area..."
            placeholderTextColor={colors.mutedForeground}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              {
                backgroundColor: canSend ? colors.accent : colors.muted,
              },
            ]}
            onPress={handleSend}
            disabled={!canSend}
            activeOpacity={0.8}
          >
            <Feather name="arrow-up" size={17} color={canSend ? "#fff" : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        <Text style={[styles.inputHint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          NZ property data · Gemini AI
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  topBarContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoMark: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  logoLetter: {
    fontSize: 17,
    color: "#fff",
    fontFamily: "DM_Sans_700Bold",
    lineHeight: 20,
  },
  appName: {
    fontSize: 17,
    color: "#FAFAF9",
    letterSpacing: -0.3,
  },
  appSubtitle: {
    fontSize: 11,
    letterSpacing: 0.1,
    marginTop: 1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 48,
    gap: 40,
  },
  emptyHero: {
    gap: 12,
  },
  emptyTitle: {
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.4,
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 24,
  },
  suggestionsSection: {
    gap: 12,
  },
  suggestionsLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  suggestions: {
    gap: 8,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: "rgba(28,25,23,0.05)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  suggestionText: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  messageList: {
    gap: 4,
    paddingTop: 16,
  },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: 1.5,
    borderRadius: 16,
    paddingLeft: 16,
    paddingRight: 7,
    paddingVertical: 7,
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    lineHeight: 22,
    paddingVertical: 3,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
  inputHint: {
    fontSize: 11,
    textAlign: "center",
    letterSpacing: 0.2,
  },
});
