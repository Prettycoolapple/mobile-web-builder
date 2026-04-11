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

      if (queryType === "analyse") {
        const address = extractAddress(text);
        const resp = await fetch(`${getApiBase()}/analyse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, conversationHistory }),
        });
        const data = (await resp.json()) as { report: FeasibilityReport; type: string };
        setCurrentReport(data.report);
        updateLastMessage({ type: "report", report: data.report, content: "" });
      } else if (queryType === "search") {
        const resp = await fetch(`${getApiBase()}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: text }),
        });
        const data = (await resp.json()) as { candidates: PropertyCandidate[]; type: string };
        updateLastMessage({ type: "search", searchResults: data.candidates, content: "" });
      } else {
        const reportContext = currentSession?.currentReport
          ? JSON.stringify(currentSession.currentReport)
          : undefined;
        const resp = await fetch(`${getApiBase()}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, conversationHistory, reportContext }),
        });
        const data = (await resp.json()) as { message: string; type: string };
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
  const bottomInset = Platform.OS === "web" ? 34 : 0;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      <View style={[styles.topBar, { paddingTop: topInset, backgroundColor: colors.navy, borderBottomColor: "rgba(255,255,255,0.1)" }]}>
        <View style={styles.topBarContent}>
          <View>
            <Text style={[styles.appName, { fontFamily: "Inter_700Bold" }]}>DevFeasible</Text>
            <Text style={[styles.appSubtitle, { fontFamily: "Inter_400Regular" }]}>NZ Property Analysis</Text>
          </View>
          <View style={styles.topBarRight}>
            <View style={[styles.onlineDot, { backgroundColor: colors.emerald }]} />
            <Text style={[styles.onlineText, { color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }]}>AI Ready</Text>
          </View>
        </View>
      </View>

      <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
        {isEmpty ? (
          <View style={styles.emptyContainer}>
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                NZ Property Feasibility
              </Text>
              <Text style={[styles.emptySubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Analyse any Auckland property or discover development opportunities using AI and real NZ data.
              </Text>
            </View>
            <Text style={[styles.suggestionsLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              Try asking...
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
                  <Feather name="search" size={12} color={colors.emerald} />
                  <Text style={[styles.suggestionText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                    {q}
                  </Text>
                </TouchableOpacity>
              ))}
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
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        paddingBottom: Math.max(bottomInset, insets.bottom) + 8,
      }]}>
        <View style={[styles.inputWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <TextInput
            ref={inputRef}
            style={[styles.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
            placeholder="Analyse an address or find properties..."
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
                backgroundColor: inputText.trim() && !isLoading ? colors.emerald : colors.muted,
              },
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || isLoading}
            activeOpacity={0.85}
          >
            <Feather name="send" size={16} color={inputText.trim() && !isLoading ? "#fff" : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  topBarContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
  },
  appName: {
    fontSize: 20,
    color: "#fff",
    letterSpacing: -0.5,
  },
  appSubtitle: {
    fontSize: 11,
    color: "rgba(255,255,255,0.5)",
    letterSpacing: 0.3,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  onlineText: {
    fontSize: 12,
  },
  emptyContainer: {
    flex: 1,
    padding: 20,
    gap: 16,
    justifyContent: "center",
  },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 8,
    alignItems: "center",
  },
  emptyTitle: {
    fontSize: 20,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  suggestionsLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
  },
  suggestions: {
    gap: 8,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  suggestionText: {
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  messageList: {
    gap: 12,
    paddingTop: 16,
    paddingHorizontal: 0,
  },
  inputBar: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: 1,
    borderRadius: 24,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 14,
    maxHeight: 100,
    lineHeight: 20,
    paddingVertical: 4,
  },
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
});
