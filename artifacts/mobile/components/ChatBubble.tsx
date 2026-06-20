import React, { useEffect, useMemo, useRef, useState, Component } from "react";
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity, TouchableWithoutFeedback, Clipboard, Alert, Image } from "react-native";
import Markdown from "react-native-markdown-display";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { ChatMessage, PropertyCandidate, SelectedListingContext } from "@/context/ChatContext";
import { useT } from "@/lib/i18n";
import { BrowseListing } from "@/lib/browseListings";
import { shareListing } from "@/lib/propertyShares";
import { FeasibilityReportCard } from "./FeasibilityReport";
import { CombinedReportGroupCard } from "./CombinedReportGroup";
import { PropertyCard } from "./PropertyCard";
import { BrowseListingCard } from "./BrowseListingCard";
import { AnalysisProgress } from "./AnalysisProgress";
import { ProviderRecommendationBubble } from "./ProviderRecommendationBubble";
import { ProviderUpgradeGateBubble } from "./ProviderUpgradeGateBubble";
import { AgentCallBubble } from "./AgentCallBubble";

function ReportErrorBoundaryInner({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <ReportErrorBoundaryClass
      titleText={t("search.report_issue_title")}
      defaultErrorText={t("search.report_issue_default")}
      hintText={t("search.report_issue_hint")}
    >
      {children}
    </ReportErrorBoundaryClass>
  );
}

class ReportErrorBoundaryClass extends Component<
  { children: React.ReactNode; titleText: string; defaultErrorText: string; hintText: string },
  { hasError: boolean; error?: string }
> {
  state = { hasError: false, error: undefined as string | undefined };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={reportErrorStyles.box}>
          <Text style={reportErrorStyles.title}>{this.props.titleText}</Text>
          <Text style={reportErrorStyles.body}>
            {this.state.error ?? this.props.defaultErrorText}{"\n\n"}
            {this.props.hintText}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const ReportErrorBoundary = ReportErrorBoundaryInner;

class MarkdownErrorBoundaryClass extends Component<
  { children: React.ReactNode; fallbackText: string; fallbackStyle: object },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return <Text style={this.props.fallbackStyle as any}>{this.props.fallbackText}</Text>;
    }
    return this.props.children;
  }
}

const reportErrorStyles = StyleSheet.create({
  box: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    margin: 4,
    gap: 6,
  },
  title: {
    color: "#991B1B",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
  },
  body: {
    color: "#B91C1C",
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
});

function SafeMarkdown({
  content,
  markdownStyles,
  textStyle,
}: {
  content: string;
  markdownStyles: Record<string, unknown>;
  textStyle: object;
}) {
  const hasMarkdownSyntax = /(^\s*[-*]\s)|(^\s*\d+\.\s)|[`*_#[\]()>|]/m.test(content);
  if (!hasMarkdownSyntax) {
    return <Text style={textStyle as any}>{content}</Text>;
  }
  return (
    <MarkdownErrorBoundaryClass fallbackText={content} fallbackStyle={textStyle}>
      <Markdown style={markdownStyles as any}>
        {content}
      </Markdown>
    </MarkdownErrorBoundaryClass>
  );
}

interface Props {
  message: ChatMessage;
  onFollowUp: (question: string) => void;
  onDiscoveryChoice?: (message: ChatMessage, option: string, optionIndex: number) => void;
  onAnalyse: (address: string, photoUrl?: string | null, listingUrl?: string | null, selectedListingContext?: SelectedListingContext | null, analysisKey?: string) => void;
  onAnalyseProperty?: (address: string) => void;
  analysingPropertyKey?: string | null;
  onRetry?: (text: string) => void;
  onConnect?: (providerId: string) => Promise<void>;
  onDismiss?: (messageId: string) => void;
  onAgentDismiss?: (messageId: string) => void;
  onUpgrade?: () => void;
  onShowMore?: (message: ChatMessage) => void;
  onSearchResultLayout?: (messageId: string, index: number, layout: { y: number; height: number }) => void;
}

const THINKING_KEYS = [
  "search.thinking",
  "search.thinking_looking_up",
  "search.thinking_checking_records",
  "search.thinking_takes_moment",
  "search.thinking_still_working",
  "search.thinking_almost_there",
] as const;

const APP_ICON = require("@/assets/images/icon.png");

function genericListingId(candidate: PropertyCandidate): string {
  const seed = candidate.listingUrl || candidate.address;
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return `generic_${Math.abs(hash)}`;
}

function firstAddressLine(address: string): string {
  return address.split(",")[0]?.trim() || address;
}

function genericDescription(candidate: PropertyCandidate): string {
  return candidate.description?.trim()
    || "Curated from live NZ marketplace listings. Analyse this property in Project Alpha for feasibility context.";
}

function genericTeaser(candidate: PropertyCandidate): string | null {
  const text = candidate.briefSummary?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const address = candidate.address.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const title = (candidate.listingTitle ?? firstAddressLine(candidate.address)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalized === title || normalized === address || address.includes(normalized)) return null;
  if (/^(house|section|apartment|unit|townhouse|property)\s+for\s+(sale|rent)\s+at\b/i.test(text)) return null;
  return text;
}

function browseListingFromCandidate(candidate: PropertyCandidate): BrowseListing {
  const imageUrls = candidate.photoUrls?.length
    ? candidate.photoUrls
    : candidate.photoUrl
      ? [candidate.photoUrl]
      : [];
  const priceNzd = candidate.price > 0 ? candidate.price : null;
  const isInternal = candidate.source === "internal";
  return {
    id: candidate.internalListingId ?? genericListingId(candidate),
    source: isInternal ? "internal" : "curated",
    externalUrl: isInternal ? null : candidate.listingUrl ?? null,
    listingTitle: candidate.listingTitle ?? firstAddressLine(candidate.address),
    address: candidate.address,
    listingType: "for_sale",
    propertyType: candidate.propertyType ?? "property",
    bedrooms: candidate.bedrooms ?? null,
    bathrooms: candidate.bathrooms ?? null,
    toilets: candidate.toilets ?? null,
    garages: candidate.garages ?? null,
    landAreaSqm: candidate.landArea ?? null,
    floorAreaSqm: candidate.floorArea ?? null,
    priceNzd,
    priceDisplay: candidate.priceDisplay ?? (priceNzd ? `$${priceNzd.toLocaleString("en-NZ")}` : "Price on application"),
    description: genericDescription(candidate),
    teaser: genericTeaser(candidate),
    imageUrls,
    features: candidate.features ?? [],
    // Only set agent when we have real data; null hides the row on the card
    // rather than showing misleading placeholder text.
    agent: (candidate.agentName || candidate.agencyName || candidate.agentAvatarUrl)
      ? {
          fullName: candidate.agentName ?? null,
          avatarUrl: candidate.agentAvatarUrl ?? null,
          agencyName: candidate.agencyName ?? null,
          phone: candidate.agentPhone ?? null,
          isVerified: false,
        }
      : null,
  };
}

function AiAvatar() {
  return (
    <View style={styles.aiAvatar}>
      <Image source={APP_ICON} style={styles.aiAvatarImage} resizeMode="cover" />
    </View>
  );
}

function TypingDots() {
  const colors = useColors();
  const { t } = useT();
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const [messageIndex, setMessageIndex] = useState(0);
  const thinkingMessages = useMemo(() => THINKING_KEYS.map((k) => t(k)), [t]);

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

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex((i) => Math.min(i + 1, thinkingMessages.length - 1));
    }, 4000);
    return () => clearInterval(interval);
  }, [thinkingMessages.length]);

  const dotStyle = (dot: Animated.Value) => ({
    opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    transform: [{ translateY: dot.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
  });

  return (
    <View style={styles.thinkingRow}>
      <View style={styles.dotsRow}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View
            key={i}
            style={[styles.dot, { backgroundColor: colors.accent }, dotStyle(dot)]}
          />
        ))}
      </View>
      <Text style={[styles.thinkingText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
        {thinkingMessages[messageIndex]}
      </Text>
    </View>
  );
}

export function ChatBubble({ message, onFollowUp, onDiscoveryChoice, onAnalyse, onAnalyseProperty, analysingPropertyKey, onRetry, onConnect, onDismiss, onAgentDismiss, onUpgrade, onShowMore, onSearchResultLayout }: Props) {
  const colors = useColors();
  const { t } = useT();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const isUser = message.role === "user";

  if (message.type === "agent_contact" && (message.agentPhone || message.agentListingUrl)) {
    return (
      <AgentCallBubble
        agentName={message.agentName ?? null}
        agencyName={message.agencyName ?? null}
        agentAvatarUrl={message.agentAvatarUrl ?? null}
        agentPhone={message.agentPhone ?? null}
        listingUrl={message.agentListingUrl ?? null}
        propertyAddress={message.propertyAddress ?? ""}
        matchType={message.agentMatchType}
        onDismiss={() => onAgentDismiss?.(message.id)}
      />
    );
  }

  const isInteractiveClarification =
    (message.type === "subdivision_clarification" || message.type === "address_clarification" || message.type === "discovery_exhausted_choice") && message.clarification;
  if (isInteractiveClarification && message.clarification) {
    const { question, options } = message.clarification;
    const isDiscoveryChoice = message.type === "discovery_exhausted_choice";
    return (
      <View style={styles.aiRow}>
        <AiAvatar />
        <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border, flex: 1, gap: 10 }]}>
          <Text style={[styles.thinkingText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 14, lineHeight: 20 }]}>
            {question}
          </Text>
          <View style={{ gap: 8, marginTop: 4 }}>
            {options.map((opt, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => isDiscoveryChoice ? (onDiscoveryChoice ? onDiscoveryChoice(message, opt, i) : onFollowUp(opt)) : onAnalyse(opt)}
                style={{
                  backgroundColor: colors.accent + "12",
                  borderColor: colors.accent + "55",
                  borderWidth: 1,
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <Feather name={isDiscoveryChoice ? "search" : "map-pin"} size={13} color={colors.accent} />
                <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_500Medium", fontSize: 13, flex: 1 }} numberOfLines={2}>
                  {opt}
                </Text>
                <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
    );
  }

  if (message.type === "provider_upgrade_gate") {
    return (
      <ProviderUpgradeGateBubble
        onUpgrade={() => onUpgrade?.()}
        onDismiss={() => onDismiss?.(message.id)}
      />
    );
  }

  if (message.type === "provider_recommendation" && message.provider) {
    return (
      <ProviderRecommendationBubble
        provider={message.provider}
        intentType={message.intentType ?? "subdivision"}
        propertyAddress={message.propertyAddress ?? ""}
        onConnect={onConnect ?? (() => Promise.resolve())}
        onDismiss={() => onDismiss?.(message.id)}
      />
    );
  }

  if (message.type === "loading") {
    const isAnalysing = message.loadingMode === "analyse";
    if (isAnalysing) {
      return <AnalysisProgress retryLabel={message.retryLabel} />;
    }
    const wideScanHint = message.loadingHint?.kind === "wide_scan_subdivision";
    return (
      <View style={styles.aiRow}>
        <AiAvatar />
        <View style={[styles.loadingBubble, { backgroundColor: colors.card, borderColor: colors.border, gap: wideScanHint || message.retryLabel ? 6 : 0 }]}>
          <TypingDots />
          {message.retryLabel ? (
            <Text style={[styles.retryLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {message.retryLabel}
            </Text>
          ) : null}
          {wideScanHint ? (
            <View style={{ gap: 2 }}>
              <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>
                {t("loading.wide_scan_subdivision_title")}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 15 }}>
                {t("loading.wide_scan_subdivision_subtitle")}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  if (message.type === "report" && message.report) {
    return (
      <View style={styles.reportContainer}>
        <ReportErrorBoundary>
          <FeasibilityReportCard report={message.report} onFollowUp={onFollowUp} onAnalyseProperty={onAnalyseProperty} />
        </ReportErrorBoundary>
      </View>
    );
  }

  if (message.type === "report_group" && message.reportGroup) {
    return (
      <View style={styles.reportContainer}>
        <ReportErrorBoundary>
          <CombinedReportGroupCard group={message.reportGroup} onFollowUp={onFollowUp} onAnalyseProperty={onAnalyseProperty} />
        </ReportErrorBoundary>
      </View>
    );
  }

  if (message.type === "search") {
    const results = message.searchResults ?? [];
    const aiIntro = message.aiIntro;
    const showGenericListings = message.searchPresentation === "generic_listing";
    return (
      <View style={styles.searchContainer}>
        {aiIntro ? (
          <View style={styles.aiRow}>
            <AiAvatar />
            <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border, flex: 1 }]}>
              <Text style={[styles.noListingsText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
                {aiIntro}
              </Text>
            </View>
          </View>
        ) : null}
        <Text style={[styles.searchHeader, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
          {showGenericListings
            ? t(results.length === 1 ? "listing.count_one" : "listing.count_other", { n: results.length })
            : results.length === 1
            ? t("search.opportunity_one", { n: results.length })
            : t("search.opportunity_other", { n: results.length })}
        </Text>
        {results.map((candidate, i) => {
          const handleResultLayout = message.scrollToSearchResultIndex === i
            ? (event: { nativeEvent: { layout: { y: number; height: number } } }) => {
                onSearchResultLayout?.(message.id, i, event.nativeEvent.layout);
              }
            : undefined;
          if (showGenericListings) {
            const listing = browseListingFromCandidate(candidate);
            return (
              <View key={`${listing.id}-${i}`} onLayout={handleResultLayout}>
                <BrowseListingCard
                  listing={listing}
                  onShare={async () => {
                    try {
                      await shareListing(listing, getApiHeaders());
                    } catch (error) {
                      Alert.alert(
                        "Couldn't share listing",
                        error instanceof Error ? error.message : "Please try again.",
                      );
                    }
                  }}
                  onPress={() => router.push({
                    pathname: "/listing/[id]",
                    params: { id: listing.id, preview: JSON.stringify(listing) },
                  } as never)}
                />
              </View>
            );
          }
          return (
            <View key={i} onLayout={handleResultLayout}>
              <PropertyCard candidate={candidate} onAnalyse={onAnalyse} analysingPropertyKey={analysingPropertyKey} showSubdivisionDisclaimer={results.length === 1} />
            </View>
          );
        })}
        {results.length > 0 ? (
          <TouchableOpacity
            style={[styles.showMoreButton, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.78}
            onPress={() => onShowMore?.(message)}
            disabled={message.showMoreStatus === "loading"}
          >
            <Feather name={message.showMoreStatus === "loading" ? "loader" : "plus"} size={15} color={colors.accent} />
            <Text style={[styles.showMoreText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
              {message.showMoreStatus === "loading" ? t("search.finding_more") : t("search.show_more")}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  // Empty text messages are used to silently clear the loading bubble (e.g. after
  // a semantic "change provider" intent is detected). Render nothing for them.
  if (!isUser && message.type === "text" && !message.content?.trim() && !message.retryText) {
    return null;
  }

  if (isUser) {
    const handleLongPress = () => {
      Clipboard.setString(message.content);
      Alert.alert(t("search.copied_title"), t("search.copied_msg"));
    };
    return (
      <TouchableWithoutFeedback onLongPress={handleLongPress}>
        <View style={styles.userRow}>
          <View style={[styles.userBubble, { backgroundColor: colors.accent }]}>
            <Text style={[styles.userText, { fontFamily: "DM_Sans_400Regular" }]}>
              {message.content}
            </Text>
          </View>
        </View>
      </TouchableWithoutFeedback>
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
      <AiAvatar />
      <View style={[styles.aiBubble, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <SafeMarkdown
          content={message.content ?? ""}
          markdownStyles={markdownStyles as any}
          textStyle={{
            color: colors.foreground,
            fontFamily: "DM_Sans_400Regular",
            fontSize: 15,
            lineHeight: 23,
          }}
        />
        {!!message.retryText?.trim() && onRetry ? (
          <TouchableOpacity
            onPress={() => onRetry(message.retryText!)}
            style={[styles.retryButton, { borderColor: colors.border, backgroundColor: colors.muted }]}
            activeOpacity={0.7}
          >
            <Feather name="refresh-cw" size={13} color={colors.accent} />
            <Text style={[styles.retryButtonText, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]}>
              {t("search.try_again")}
            </Text>
          </TouchableOpacity>
        ) : null}
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
    overflow: "hidden",
    flexShrink: 0,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  aiAvatarImage: {
    width: 28,
    height: 28,
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
  thinkingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  thinkingText: {
    fontSize: 13,
    lineHeight: 19,
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
  showMoreButton: {
    alignSelf: "center",
    minHeight: 42,
    minWidth: 148,
    borderRadius: 21,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  showMoreText: {
    fontSize: 14,
  },
  noListingsText: {
    fontSize: 15,
    lineHeight: 23,
  },
  retryLabel: {
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 8,
    marginBottom: 4,
  },
  retryButtonText: {
    fontSize: 13,
  },
});
