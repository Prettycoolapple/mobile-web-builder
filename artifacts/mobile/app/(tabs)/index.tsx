import React, { useRef, useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  Platform,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
} from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useChat, ChatMessage, FeasibilityReport, PropertyCandidate, ServiceProvider } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { ChatBubble } from "@/components/ChatBubble";
import { PaywallModal } from "@/components/PaywallModal";
import { setBaseUrl } from "@workspace/api-client-react";

if (process.env.EXPO_PUBLIC_DOMAIN) {
  setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
}

const SUGGESTION_QUERIES = [
  "What's on the market in Grey Lynn?",
  "Find development sites under $2M",
  "Analyse 42 Arney Road, Remuera",
];

function extractJSON(text: string): unknown | null {
  try {
    const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

function GlassesLogo({ size = 40, color = "#D97757" }: { size?: number; color?: string }) {
  const w = size * 1.5;
  const h = size * 0.65;
  const r = size * 0.28;
  const cx1 = size * 0.32;
  const cx2 = size * 1.18;
  const cy = h * 0.55;
  const strokeW = size * 0.065;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Circle cx={cx1} cy={cy} r={r} stroke={color} strokeWidth={strokeW} fill="none" />
      <Circle cx={cx2} cy={cy} r={r} stroke={color} strokeWidth={strokeW} fill="none" />
      <Line
        x1={cx1 + r}
        y1={cy}
        x2={cx2 - r}
        y2={cy}
        stroke={color}
        strokeWidth={strokeW * 0.8}
        strokeLinecap="round"
      />
      <Line
        x1={cx1 - r}
        y1={cy - r * 0.3}
        x2={cx1 - r - size * 0.2}
        y2={cy - r * 0.65}
        stroke={color}
        strokeWidth={strokeW * 0.8}
        strokeLinecap="round"
      />
      <Line
        x1={cx2 + r}
        y1={cy - r * 0.3}
        x2={cx2 + r + size * 0.2}
        y2={cy - r * 0.65}
        stroke={color}
        strokeWidth={strokeW * 0.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getApiHeaders, refreshProfile, user } = useAuth();
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
  const checkedReportIds = useRef<Set<string>>(new Set());
  const checkedFollowupIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const messages = currentSession?.messages || [];

  useEffect(() => {
    if (user?.role !== "general") return;
    const msgs = currentSession?.messages ?? [];
    const reportMessages = msgs.filter((m) => m.type === "report" && m.report);
    if (reportMessages.length === 0) return;
    const lastReport = reportMessages[reportMessages.length - 1];
    if (checkedReportIds.current.has(lastReport.id)) return;
    checkedReportIds.current.add(lastReport.id);

    const alreadyHasRecommendation = msgs.some((m) => m.type === "provider_recommendation");
    if (alreadyHasRecommendation) return;

    const timer = setTimeout(async () => {
      try {
        const apiBase = process.env.EXPO_PUBLIC_DOMAIN
          ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
          : "/api";
        const headers = getApiHeaders();
        const conversationHistory = msgs
          .filter((m) => m.type === "text" || m.type === "report")
          .map((m) => ({ role: m.role, content: m.type === "text" ? m.content : `[Report for ${m.report?.address ?? "property"}]` }));

        const resp = await fetch(`${apiBase}/recommendations/check`, {
          method: "POST",
          headers,
          body: JSON.stringify({ report: lastReport.report, conversationHistory }),
        });
        if (!resp.ok) return;
        const data = await resp.json() as {
          shouldRecommend: boolean;
          provider: ServiceProvider | null;
          intentType: string;
        };
        if (data.shouldRecommend && data.provider) {
          addMessage({
            role: "assistant",
            content: "",
            type: "provider_recommendation",
            provider: data.provider,
            intentType: data.intentType,
            propertyAddress: lastReport.report?.address ?? "",
          }, currentSessionId ?? undefined);
        }
      } catch (err) {
        console.log("Recommendation check failed:", err);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [currentSession?.messages, user?.role, getApiHeaders, addMessage, currentSessionId]);

  const handleConnect = useCallback(async (providerId: string, propertyAddress: string) => {
    try {
      const apiBase = process.env.EXPO_PUBLIC_DOMAIN
        ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
        : "/api";
      const headers = getApiHeaders();
      const resp = await fetch(`${apiBase}/recommendations/connect`, {
        method: "POST",
        headers,
        body: JSON.stringify({ providerId, propertyAddress }),
      });
      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        throw new Error(err.error ?? "Connect failed");
      }
      router.push("/(tabs)/messages");
    } catch (err) {
      console.log("Connect failed:", err);
      throw err;
    }
  }, [getApiHeaders, router]);

  const handleDismiss = useCallback((_messageId: string) => {}, []);

  useEffect(() => {
    if (user?.role !== "general") return;
    const msgs = currentSession?.messages ?? [];
    if (!currentSession?.currentReport) return;

    const lastAssistantText = [...msgs].reverse().find(
      (m) => m.role === "assistant" && m.type === "text",
    );
    if (!lastAssistantText) return;
    if (checkedFollowupIds.current.has(lastAssistantText.id)) return;

    const alreadyHasAgentBubble = msgs.some((m) => m.type === "agent_contact");
    if (alreadyHasAgentBubble) return;

    const lastUserMsg = [...msgs].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) return;

    const userText = lastUserMsg.content.toLowerCase();
    const agentKeywords = [
      "call", "contact", "phone", "number", "agent", "reach", "speak",
      "get in touch", "seller", "vendor", "ring", "talk to", "who is selling",
      "who listed", "realtor", "salesperson",
    ];
    const hasKeyword = agentKeywords.some((kw) => userText.includes(kw));
    if (!hasKeyword) return;

    checkedFollowupIds.current.add(lastAssistantText.id);

    const timer = setTimeout(async () => {
      try {
        const apiBase = process.env.EXPO_PUBLIC_DOMAIN
          ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`
          : "/api";
        const headers = getApiHeaders();
        const address = currentSession?.currentReport?.address ?? "";
        const conversationHistory = msgs
          .filter((m) => m.type === "text")
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content }));

        const resp = await fetch(`${apiBase}/agent-contact/lookup`, {
          method: "POST",
          headers,
          body: JSON.stringify({ address, messages: conversationHistory }),
        });
        if (!resp.ok) return;

        const data = await resp.json() as {
          wantsAgentContact: boolean;
          found?: boolean;
          isListed?: boolean;
          agentName?: string | null;
          agentPhone?: string | null;
          agencyName?: string | null;
          propertyAddress?: string;
        };

        if (data.wantsAgentContact && data.found && data.isListed && data.agentPhone) {
          addMessage({
            role: "assistant",
            content: "",
            type: "agent_contact",
            agentName: data.agentName ?? null,
            agentPhone: data.agentPhone,
            agencyName: data.agencyName ?? null,
            propertyAddress: address,
          }, currentSessionId ?? undefined);
        }
      } catch (err) {
        console.log("Agent contact lookup failed:", err);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [currentSession?.messages, currentSession?.currentReport, user?.role, getApiHeaders, addMessage, currentSessionId]);

  const handleAgentDismiss = useCallback((_messageId: string) => {}, []);

  const getApiBase = useCallback(() => {
    if (process.env.EXPO_PUBLIC_DOMAIN) {
      return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
    }
    return "/api";
  }, []);

  const handleSend = useCallback(async (overrideText?: string) => {
    const text = (overrideText !== undefined ? overrideText : inputText).trim();
    if (!text || isLoading) return;

    setInputText("");
    inputRef.current?.clear();
    Keyboard.dismiss();

    const sessionId = currentSessionId ?? createSession();

    addMessage({ role: "user", content: text, type: "text" }, sessionId);
    setIsLoading(true);

    const lowerText = text.toLowerCase();
    const isDiscoverQuery =
      lowerText.match(/find\s+|search\s+|discover\s+|looking\s+for\s+|show\s+me\s+properties|subdividable|subdivision\s+opp|development\s+sites|lifestyle\s+prop|investment\s+prop/) ||
      lowerText.match(/any\s+(others?|more|properties|homes|houses|sections|land)|show\s+(me\s+)?more|more\s+(properties|options|results|sites)|what\s+else|anything\s+else|few\s+more|find\s+more|keep\s+looking|another\s+one|any\s+other|more\s+sites|other\s+options/) ||
      lowerText.match(/properties\s+(for\s+sale|on\s+sale|available|listed|in\s+)/i) ||
      lowerText.match(/(for\s+sale|on\s+sale|on\s+the\s+market)\s+in/i) ||
      lowerText.match(/what.*market|on.*market|market.*in/i);
    const detectedMode =
      isDiscoverQuery
        ? "discover"
        : text.match(/\d+\s+\w+\s+(road|street|ave|avenue|crescent|place|drive|way|lane|terrace)/i) ||
          lowerText.match(/analys[ei]|feasibility|check|assess|evaluate/)
          ? "analyse"
          : "followup";

    addMessage({ role: "assistant", content: "", type: "loading", loadingMode: detectedMode as any }, sessionId);

    const MAX_RETRIES = 1;
    const TIMEOUT_MS = 200_000;

    const currentMessages = currentSession?.messages ?? [];
    const allMessages = [
      ...currentMessages
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
              updateLastMessage({ type: "text", content: "You've used all your reports for this month. Upgrade to Standard for more." }, sessionId);
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
            const parsed = extractJSON(data.content) as { candidates?: PropertyCandidate[]; isMockData?: boolean; noListings?: boolean; aiIntro?: string } | null;
            const aiIntro = parsed?.aiIntro ?? "";
            if (parsed?.candidates && parsed.candidates.length > 0) {
              updateLastMessage({ type: "search", searchResults: parsed.candidates, content: "", aiIntro }, sessionId);
            } else {
              const noResultMsg = aiIntro || "No matching listings found right now. Try a different suburb, adjust your budget, or ask again shortly — new listings appear daily.";
              updateLastMessage({ type: "text", content: noResultMsg }, sessionId);
            }
          } else {
            const rawContent = data.content ?? "";
            const trimmed = rawContent.trim();
            if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
              const maybeParsed = extractJSON(trimmed) as { candidates?: PropertyCandidate[] } | null;
              if (maybeParsed?.candidates && maybeParsed.candidates.length > 0) {
                updateLastMessage({ type: "search", searchResults: maybeParsed.candidates, content: "" }, sessionId);
              } else {
                updateLastMessage({ type: "text", content: "I couldn't format that response properly. Please try rephrasing your question." }, sessionId);
              }
            } else {
              updateLastMessage({ type: "text", content: rawContent }, sessionId);
            }
          }
          return;
        } catch (err: any) {
          lastErr = err;
          const isAbort = err?.name === "AbortError";
          if (!isAbort || attempt >= MAX_RETRIES) break;
        }
      }

      const isTimeout = lastErr?.name === "AbortError";
      updateLastMessage({
        type: "text",
        content: isTimeout
          ? "Analysis timed out — NZ property data sources are slow right now. Please tap Try again."
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
    async (address: string) => {
      if (isLoading) return;
      setInputText("");
      Keyboard.dismiss();

      const sessionId = currentSessionId ?? createSession();

      addMessage({ role: "user", content: `Analyse ${address}`, type: "text" }, sessionId);
      setIsLoading(true);
      addMessage({ role: "assistant", content: "", type: "loading", loadingMode: "analyse" }, sessionId);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 200_000);

        const currentMessages = currentSession?.messages ?? [];
        const conversationHistory = currentMessages
          .filter((m) => m.type === "text" || m.type === "report")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.type === "text" ? m.content : `[Report for ${(m as any).report?.address ?? "property"}]`,
          }));

        const resp = await fetch(`${getApiBase()}/analyse`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({ address, conversationHistory }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!resp.ok) {
          const err = (await resp.json()) as { error?: string; code?: string };
          if (resp.status === 402) {
            updateLastMessage({ type: "text", content: "You've used all your reports for this month. Upgrade to Standard for more." }, sessionId);
            setShowPaywall(true);
          } else if (resp.status === 401) {
            updateLastMessage({ type: "text", content: "Session expired. Please sign in again." }, sessionId);
          } else {
            updateLastMessage({ type: "text", content: err.error || "Something went wrong. Please try again." }, sessionId);
          }
          return;
        }

        const data = (await resp.json()) as { report: FeasibilityReport; type: string };
        if (data.report && data.report.scores) {
          setCurrentReport(data.report);
          updateLastMessage({ type: "report", report: data.report, content: "" }, sessionId);
          refreshProfile().catch(() => {});
        } else {
          updateLastMessage({ type: "text", content: "Could not generate a report for this property. Please try again." }, sessionId);
        }
      } catch (err: any) {
        const isTimeout = err?.name === "AbortError";
        updateLastMessage({
          type: "text",
          content: isTimeout
            ? "Analysis timed out — NZ property data sources are slow right now. Please tap Try again."
            : "Couldn't connect to the analysis service. Check your connection.",
          retryText: `Analyse ${address}`,
        }, sessionId);
      } finally {
        setIsLoading(false);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [
      isLoading,
      currentSessionId,
      currentSession,
      createSession,
      addMessage,
      updateLastMessage,
      setCurrentReport,
      setIsLoading,
      getApiBase,
      getApiHeaders,
      refreshProfile,
    ],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatBubble
        message={item}
        onFollowUp={handleFollowUp}
        onAnalyse={handleAnalyse}
        onRetry={handleSend}
        onConnect={(providerId) => handleConnect(providerId, item.propertyAddress ?? "")}
        onDismiss={handleDismiss}
        onAgentDismiss={handleAgentDismiss}
      />
    ),
    [handleFollowUp, handleAnalyse, handleSend, handleConnect, handleDismiss, handleAgentDismiss],
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
      {/* Header */}
      <View style={[styles.topBar, {
        paddingTop: topInset,
        backgroundColor: colors.headerBg,
        borderBottomColor: colors.accent + "22",
      }]}>
        <View style={styles.topBarContent}>
          <View style={styles.brandRow}>
            <GlassesLogo size={22} color={colors.accent} />
            <Text style={[styles.appName, { fontFamily: "DM_Sans_700Bold" }]}>Lecorb</Text>
          </View>
          <View style={styles.headerActions}>
            {user?.role === "sales_agent" && (
              <>
                <TouchableOpacity
                  style={[styles.myListingsBtn, { borderColor: "rgba(250,249,246,0.22)" }]}
                  onPress={() => router.push("/my-listings")}
                  activeOpacity={0.75}
                >
                  <Feather name="list" size={14} color="rgba(250,249,246,0.75)" />
                  <Text style={[styles.myListingsBtnText, { fontFamily: "DM_Sans_500Medium" }]}>Listings</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addListingBtn, { backgroundColor: colors.accent }]}
                  onPress={() => router.push("/add-listing")}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={13} color="#fff" />
                  <Text style={[styles.addListingBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Add listing</Text>
                </TouchableOpacity>
              </>
            )}
            {!isEmpty && (
              <TouchableOpacity
                style={[styles.newChatBtn, { borderColor: "rgba(250,249,246,0.18)" }]}
                onPress={startNewChat}
                activeOpacity={0.7}
              >
                <Feather name="plus" size={14} color="rgba(250,249,246,0.65)" />
                <Text style={[styles.newChatText, { fontFamily: "DM_Sans_500Medium" }]}>New</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {currentSession?.currentReport && (
          <View style={[styles.contextBanner, { borderTopColor: "rgba(250,249,246,0.08)" }]}>
            <Feather name="map-pin" size={12} color={colors.accent} />
            <Text style={[styles.contextAddress, { color: "rgba(250,249,246,0.75)", fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
              {currentSession.currentReport.address || currentSession.currentReport.propertyOverview?.address || "Property loaded"}
            </Text>
            <View style={[styles.contextBadge, { backgroundColor: colors.accent + "22" }]}>
              <Text style={[styles.contextBadgeText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                {currentSession.currentReport.scores?.ease}/5
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Empty / Search state */}
      {isEmpty ? (
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
          <View style={[styles.landingContainer, { paddingBottom: tabBarOffset }]}>
            <View style={styles.landingContent}>
              {/* Glasses hero */}
              <View style={styles.landingLogo}>
                <GlassesLogo size={48} color={colors.accent} />
              </View>

              <Text style={[styles.landingTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                Going property shopping?
              </Text>
              <Text style={[styles.landingSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                Search an address, ask what's on the market,{"\n"}or find your next development opportunity.
              </Text>

              {/* Centered search input */}
              <View style={[styles.landingInputWrapper, {
                backgroundColor: colors.card,
                borderColor: canSend ? colors.accent + "60" : colors.border,
                shadowColor: colors.shadow,
              }]}>
                <TextInput
                  ref={inputRef}
                  style={[styles.landingInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Ask about an address or area..."
                  placeholderTextColor={colors.mutedForeground}
                  value={inputText}
                  onChangeText={setInputText}
                  multiline={false}
                  maxLength={500}
                  onSubmitEditing={() => handleSend()}
                  returnKeyType="search"
                />
                <TouchableOpacity
                  style={[styles.sendBtn, { backgroundColor: canSend ? colors.accent : colors.muted }]}
                  onPress={() => handleSend()}
                  disabled={!canSend}
                  activeOpacity={0.8}
                >
                  <Feather name="arrow-up" size={17} color={canSend ? "#fff" : colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {/* Suggestion chips — compact horizontal pills */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.suggestions}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}
              >
                {SUGGESTION_QUERIES.map((q) => (
                  <TouchableOpacity
                    key={q}
                    style={[styles.suggestionChip, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "35" }]}
                    onPress={() => handleSend(q)}
                    activeOpacity={0.75}
                  >
                    <Feather name="search" size={11} color={colors.accent} />
                    <Text style={[styles.suggestionText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
                      {q}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        </Pressable>
      ) : (
        <>
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
                style={[styles.sendBtn, { backgroundColor: canSend ? colors.accent : colors.muted }]}
                onPress={() => handleSend()}
                disabled={!canSend}
                activeOpacity={0.8}
              >
                <Feather name="arrow-up" size={17} color={canSend ? "#fff" : colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      <PaywallModal visible={showPaywall} onClose={() => setShowPaywall(false)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  appName: {
    fontSize: 17,
    color: "#FAFAF9",
    letterSpacing: -0.3,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  myListingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  myListingsBtnText: {
    fontSize: 13,
    color: "rgba(250,249,246,0.75)",
  },
  addListingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  addListingBtnText: {
    fontSize: 13,
    color: "#fff",
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
    color: "rgba(250,249,246,0.65)",
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
  // ── Landing / empty state ──────────────────────────────────────────
  landingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  landingContent: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    gap: 16,
  },
  landingLogo: {
    marginBottom: 4,
  },
  landingTitle: {
    fontSize: 26,
    lineHeight: 34,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  landingSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
    marginTop: -4,
  },
  landingInputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 16,
    paddingLeft: 16,
    paddingRight: 7,
    paddingVertical: 7,
    gap: 8,
    width: "100%",
    marginTop: 4,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 4,
  },
  landingInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 3,
  },
  suggestions: {
    marginTop: 8,
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 17,
  },
  // ── Chat state ─────────────────────────────────────────────────────
  messageList: {
    gap: 4,
    paddingTop: 16,
  },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
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
});
