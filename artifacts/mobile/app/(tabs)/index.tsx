import React, { useRef, useState, useCallback, useEffect } from "react";
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
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useChat, ChatMessage, FeasibilityReport, PropertyCandidate } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { ChatBubble } from "@/components/ChatBubble";
import { PaywallModal } from "@/components/PaywallModal";
import { setBaseUrl } from "@workspace/api-client-react";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

const SUGGESTION_QUERIES = [
  "Analyse 42 Arney Road, Remuera",
  "Find subdividable sections in Grey Lynn under $2M",
  "Analyse 12 Jervois Road, Herne Bay",
  "Find terrace housing sites in Sandringham",
];

function extractJSON(text: string): unknown | null {
  try {
    const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { getApiHeaders, refreshProfile } = useAuth();
  const {
    currentSession,
    currentSessionId,
    createSession,
    startNewChat,
    addMessage,
    updateLastMessage,
    setCurrentReport,
    isLoading,
    setIsLoading,
  } = useChat();

  const [inputText, setInputText] = useState("");
  const [showPaywall, setShowPaywall] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const messages = currentSession?.messages || [];

  const getApiBase = useCallback(() => {
    if (process.env.EXPO_PUBLIC_DOMAIN) {
      return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    }
    return "/api";
  }, []);

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : inputText).trim();
    if (!text || isLoading) return;

    // Clear input IMMEDIATELY before any async work
    setInputText("");
    inputRef.current?.clear();
    Keyboard.dismiss();

    const sessionId = currentSessionId ?? createSession();

    addMessage({ role: "user", content: text, type: "text" }, sessionId);
    setIsLoading(true);

    const lowerText = text.toLowerCase();
    const detectedMode =
      lowerText.match(/find\s+|search\s+|discover\s+|looking\s+for\s+|show\s+me\s+properties|subdividable|subdivision\s+opp|development\s+sites|lifestyle\s+prop|investment\s+prop/) ||
      lowerText.match(/any\s+(others?|more)|show\s+(me\s+)?more|more\s+(properties|options|results|sites)|what\s+else|anything\s+else|few\s+more|find\s+more|keep\s+looking|another\s+one|any\s+other|more\s+sites|other\s+options/)
        ? "discover"
        : text.match(/\d+\s+\w+\s+(road|street|ave|avenue|crescent|place|drive|way|lane|terrace)/i) ||
          lowerText.match(/analys[ei]|feasibility|check|assess|evaluate/)
          ? "analyse"
          : "followup";

    addMessage({ role: "assistant", content: "", type: "loading", loadingMode: detectedMode as any }, sessionId);

    const MAX_RETRIES = 2;
    const TIMEOUT_MS = 55_000;

    const allMessages = [
      ...messages
        .filter((m) => m.type === "text" || m.type === "report" || m.type === "search")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.type === "text" ? m.content : m.type === "report" ? `[Feasibility report for ${m.report?.address || "property"}]` : `[Search results shown: ${(m.searchResults ?? []).map((r) => r.address).join("; ")}]`,
        })),
      { role: "user" as const, content: text },
    ];
    const currentReport = currentSession?.currentReport ?? undefined;
    const headers = getApiHeaders();

    try {
      let lastErr: any = null;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 1) {
          updateLastMessage({
            retryLabel: `Data sources slow — retrying (${attempt} of ${MAX_RETRIES})…`,
          }, sessionId);
          await new Promise<void>((r) => setTimeout(r, 1500));
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const resp = await fetch(`${getApiBase()}/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify({ messages: allMessages, currentReport }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!resp.ok) {
            const err = (await resp.json()) as { error?: string; code?: string };
            if (resp.status === 402) {
              updateLastMessage({ type: "text", content: "You've used all 3 free reports this month. Upgrade to Pro for unlimited analysis." }, sessionId);
              setShowPaywall(true);
            } else if (resp.status === 401) {
              updateLastMessage({ type: "text", content: "Session expired. Please sign in again." }, sessionId);
            } else {
              updateLastMessage({ type: "text", content: err.error || "Something went wrong. Please try again." }, sessionId);
            }
            return;
          }

          const data = (await resp.json()) as { content: string; mode: string };

          if (data.mode === "analyse") {
            const parsed = extractJSON(data.content) as FeasibilityReport | null;
            if (parsed && parsed.scores) {
              setCurrentReport(parsed);
              updateLastMessage({ type: "report", report: parsed, content: "" }, sessionId);
              refreshProfile().catch(() => {});
            } else {
              updateLastMessage({ type: "text", content: data.content }, sessionId);
            }
          } else if (data.mode === "discover") {
            const parsed = extractJSON(data.content) as { candidates?: PropertyCandidate[]; isMockData?: boolean; noListings?: boolean } | null;
            if (parsed?.candidates && parsed.candidates.length > 0) {
              updateLastMessage({ type: "search", searchResults: parsed.candidates, content: "" }, sessionId);
            } else {
              updateLastMessage({ type: "search", searchResults: [], content: "" }, sessionId);
            }
          } else {
            updateLastMessage({ type: "text", content: data.content }, sessionId);
          }
          return;
        } catch (err: any) {
          lastErr = err;
          const isAbort = err?.name === "AbortError";
          if (!isAbort || attempt >= MAX_RETRIES) break;
        }
      }

      // All retries exhausted
      const isTimeout = lastErr?.name === "AbortError";
      updateLastMessage({
        type: "text",
        content: isTimeout
          ? "Analysis timed out after 2 attempts — NZ property data sources may be slow right now."
          : "Couldn't connect to the analysis service. Check your connection.",
        retryText: text,
      }, sessionId);
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
      setInputText("");
      handleSend(`Analyse ${address}`);
    },
    [handleSend],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatBubble message={item} onFollowUp={handleFollowUp} onAnalyse={handleAnalyse} onRetry={handleSend} />
    ),
    [handleFollowUp, handleAnalyse, handleSend],
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
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.topBar, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.topBarContent}>
          <View style={styles.brandRow}>
            <View style={[styles.logoMark, { backgroundColor: colors.accent }]}>
              <Text style={styles.logoLetter}>L</Text>
            </View>
            <View>
              <Text style={[styles.appName, { fontFamily: "DM_Sans_700Bold" }]}>Lecorb</Text>
              <Text style={[styles.appSubtitle, { color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular" }]}>
                NZ Property Analysis
              </Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            {!isEmpty && (
              <TouchableOpacity
                style={[styles.newChatBtn, { borderColor: "rgba(250,249,246,0.2)" }]}
                onPress={() => {
                  startNewChat();
                }}
                activeOpacity={0.7}
              >
                <Feather name="plus" size={14} color="rgba(250,249,246,0.7)" />
                <Text style={[styles.newChatText, { fontFamily: "DM_Sans_500Medium" }]}>New</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {currentSession?.currentReport && (
          <View style={[styles.contextBanner, { borderTopColor: "rgba(250,249,246,0.1)" }]}>
            <Feather name="map-pin" size={12} color={colors.accent} />
            <Text style={[styles.contextAddress, { color: "rgba(250,249,246,0.75)", fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
              {currentSession.currentReport.address || currentSession.currentReport.propertyOverview?.address || "Property loaded"}
            </Text>
            <View style={[styles.contextBadge, { backgroundColor: colors.accent + "25" }]}>
              <Text style={[styles.contextBadgeText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                {currentSession.currentReport.scores?.ease}/5
              </Text>
            </View>
          </View>
        )}
      </View>

      {isEmpty ? (
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
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
        </Pressable>
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
          automaticallyAdjustKeyboardInsets
          nestedScrollEnabled
        />
      )}

      <View style={[styles.inputBar, {
        backgroundColor: colors.background,
        borderTopColor: colors.border,
        paddingBottom: keyboardVisible ? 12 : tabBarOffset + 8,
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
            onSubmitEditing={() => handleSend()}
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
            onPress={() => handleSend()}
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
      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
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
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  newChatBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  newChatText: {
    fontSize: 13,
    color: "rgba(250,249,246,0.7)",
  },
  contextBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contextAddress: {
    flex: 1,
    fontSize: 12,
    letterSpacing: 0.1,
  },
  contextBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  contextBadgeText: {
    fontSize: 11,
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
