import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AppState,
  DeviceEventEmitter,
  View,
  Text,
  TextInput,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Pressable,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Alert,
  Animated,
  type GestureResponderEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as StoreReview from "expo-store-review";
import { Audio } from "expo-av";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useChat, ChatMessage, FeasibilityReport, FeasibilityReportGroup, LoadingHint, PropertyCandidate, SelectedListingContext, ServiceProvider, type CandidateScoreUpdate } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { useNotifications } from "@/context/NotificationContext";

import { ChatBubble } from "@/components/ChatBubble";
import { ResponseRatingBar } from "@/components/ResponseRatingBar";
import { PaywallModal } from "@/components/PaywallModal";
import { BrowseFilters } from "@/components/BrowseFilters";
import { BrowseListingCard } from "@/components/BrowseListingCard";
import { setBaseUrl } from "@workspace/api-client-react";
import { getApiBase as resolveApiBase, getApiOrigin } from "@/lib/api";
import { useT, isOSChineseLocale } from "@/lib/i18n";
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";
import { normaliseAddressKey } from "@/lib/address-key";
import { resolveChatQuota } from "@/lib/quotas";
import { consumePendingShareToken, openShareToken } from "@/lib/propertyShares";
import { BrowseListing, BrowseListingFilters, fetchBrowseListings, selectedListingContextFromBrowse } from "@/lib/browseListings";

setBaseUrl(getApiOrigin() || null);

const RECORDING_CANCEL_SWIPE_UP_PX = 56;
const RECORDING_HOLD_TO_START_MS = 450;
const RECORDING_START_WATCHDOG_MS = 8_000;
const RECORDING_MAX_DURATION_MS = 90_000;
const RECORDING_STOP_TIMEOUT_MS = 5_000;
const TRANSCRIBE_TIMEOUT_MS = 45_000;
const SHOW_EXPLORE_HEADER_BUTTON = false;

/** Prefer top-level report address, then property overview (some API payloads only set the latter). */
function resolveReportAddress(report: FeasibilityReport | null | undefined): string {
  if (!report) return "";
  const top = typeof report.address === "string" ? report.address.trim() : "";
  if (top) return top;
  const ov = report.propertyOverview?.address;
  return typeof ov === "string" ? ov.trim() : "";
}

function selectedListingContextFromCandidate(candidate: PropertyCandidate): SelectedListingContext {
  return {
    address: candidate.address,
    listingUrl: candidate.listingUrl ?? null,
    photoUrl: candidate.photoUrl ?? candidate.photoUrls?.[0] ?? null,
    photoUrls: candidate.photoUrls ?? (candidate.photoUrl ? [candidate.photoUrl] : []),
    price: candidate.priceIsPlaceholder ? null : candidate.price ?? null,
    landArea: candidate.landArea ?? null,
    floorArea: candidate.floorArea ?? null,
    bedrooms: candidate.bedrooms ?? null,
    bathrooms: candidate.bathrooms ?? null,
    bedroomsApprox: candidate.bedroomsApprox ?? null,
    bathroomsApprox: candidate.bathroomsApprox ?? null,
    landAreaApprox: candidate.landAreaApprox ?? null,
    floorAreaApprox: candidate.floorAreaApprox ?? null,
    priceApprox: candidate.priceApprox ?? null,
    propertyType: candidate.propertyType ?? null,
    listingTitle: candidate.listingTitle ?? null,
    source: candidate.source ?? null,
    isCombinedListing: candidate.isCombinedListing ?? null,
    packageAddress: candidate.packageAddress ?? null,
    childAddresses: candidate.childAddresses ?? null,
    aggregateFactsExcluded: candidate.aggregateFactsExcluded ?? null,
  };
}

function stopAndUnloadRecordingWithTimeout(recording: Audio.Recording): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("Recording stop timed out"));
    }, RECORDING_STOP_TIMEOUT_MS);

    recording.stopAndUnloadAsync()
      .then(() => resolve())
      .catch(reject)
      .finally(() => clearTimeout(timeoutId));
  });
}

function withHistoryMetadata(
  report: FeasibilityReport,
  searchId?: string | null,
  historyCreatedAt?: string | null,
): FeasibilityReport {
  if (!searchId && !historyCreatedAt) return report;
  return {
    ...report,
    historyId: searchId ?? report.historyId ?? null,
    historyCreatedAt: historyCreatedAt ?? report.historyCreatedAt ?? null,
  };
}

function withGroupHistoryMetadata(
  group: FeasibilityReportGroup,
  searchId?: string | null,
  historyCreatedAt?: string | null,
): FeasibilityReportGroup {
  if (!searchId && !historyCreatedAt) return group;
  return {
    ...group,
    historyId: searchId ?? group.historyId ?? null,
    historyCreatedAt: historyCreatedAt ?? group.historyCreatedAt ?? null,
    reports: group.reports.map((report) => withHistoryMetadata(report, searchId, historyCreatedAt)),
  };
}

type BackgroundAnalyseJob = {
  jobId: string;
  userId: string;
  sessionId: string;
  address: string;
  createdAt: number;
};

type BackgroundScreeningJob = {
  jobId: string;
  userId: string;
  sessionId: string;
  query: string;
  presentation?: ChatMessage["searchPresentation"];
  createdAt: number;
};

const BACKGROUND_ANALYSE_JOBS_KEY = "@devfeasible/background-analyse-jobs";
const BACKGROUND_SCREENING_JOBS_KEY = "@devfeasible/background-screening-jobs";
const APP_RATING_STATE_KEY = "@devfeasible/app-rating-state";
const ANALYSE_DISCLAIMER_DISMISSED_KEY = "@devfeasible/analyse-disclaimer-dismissed";
const PENDING_GUEST_ANALYSE_ACTION_KEY = "@devfeasible/pending-guest-analyse-action";
const HOME_MODE_KEY = "@devfeasible/home-mode";
const BROWSE_MODE_ENABLED = true;
const BROWSE_PAGE_SIZE = 5;
const BROWSE_PREFETCH_LIMIT = 10;
const APP_RATING_CHAT_THRESHOLD = 3;
const APP_RATING_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

const DEFAULT_BROWSE_FILTERS: BrowseListingFilters = {
  listingType: "for_sale",
  limit: BROWSE_PAGE_SIZE,
  sort: "recommended",
};

function getAnalyseDisclaimerDismissedKey(userId?: string | null): string {
  return userId ? `${ANALYSE_DISCLAIMER_DISMISSED_KEY}:${userId}` : ANALYSE_DISCLAIMER_DISMISSED_KEY;
}

function browseFiltersKey(filters: BrowseListingFilters): string {
  const stable = {
    q: filters.q?.trim() ?? "",
    propertyType: filters.propertyType ?? "",
    bedrooms: filters.bedrooms?.trim() ?? "",
    bathrooms: filters.bathrooms?.trim() ?? "",
    saleMethod: filters.saleMethod ?? "",
    sort: filters.sort ?? "recommended",
  };
  return JSON.stringify(stable);
}

type PendingAnalyseAction =
  | { type: "send"; text: string }
  | { type: "analyse"; address: string; selectedPhotoUrl?: string | null; selectedListingUrl?: string | null; selectedListingContext?: SelectedListingContext | null; analysisKey?: string };

type DiscoveryNextResponse = {
  candidates?: PropertyCandidate[];
  continuationToken?: string | null;
  exhausted?: boolean;
  searchPresentation?: ChatMessage["searchPresentation"];
  // The suburb this batch is for. During nearby "train" expansion it advances
  // as each suburb drains — the client shows a one-line note when it changes.
  suburb?: string;
  // "user" when the queued suburbs are the user's own list (so the hand-off note
  // omits "nearby"); "nearby" for LLM-suggested neighbours.
  queueSource?: "user" | "nearby";
  clarification?: {
    question: string;
    options: string[];
    optionActions?: Array<"repeat_origin" | "search_nearby">;
    // Echoed from the exhausted payload so the choice chip can piggyback the
    // authoritative presentation + suburb (origin, on full-train drain).
    searchPresentation?: ChatMessage["searchPresentation"];
    suburb?: string | null;
  };
};

// A non-OK /discovery/next outcome. "expired" → the continuation can't be
// resumed (token expired or owned by another session); "transient" → a
// server/network blip the user can retry.
type DiscoveryNextError = { error: "expired" | "transient" };

function isDiscoveryNextError(value: unknown): value is DiscoveryNextError {
  return Boolean(value) && typeof (value as DiscoveryNextError).error === "string";
}

// Build the deterministic "Show the N cross-lease" opt-in chip from a discover
// payload's structured tenureOffer, or null when there's nothing set aside. The
// chip reuses the discovery_exhausted_choice rendering + onDiscoveryChoice path.
function buildTenureOfferChipMessage(
  parsed: {
    suburb?: string;
    tenureOffer?: { suburb?: string; entries?: Array<{ tenure: "cross_lease" | "leasehold" | "unit_title"; count: number }> };
  },
  searchPresentation: ChatMessage["searchPresentation"],
  t: (key: string, vars?: Record<string, string | number>) => string,
): Omit<ChatMessage, "id" | "timestamp"> | null {
  const entries = parsed.tenureOffer?.entries;
  if (!entries || entries.length === 0) return null;
  return {
    role: "assistant",
    content: "",
    type: "discovery_exhausted_choice",
    clarification: {
      question: t("search.tenure_offer_q"),
      options: [t("search.tenure_offer_show")],
      optionActions: ["include_tenures"],
    },
    searchPresentation,
    suburb: parsed.tenureOffer?.suburb ?? parsed.suburb,
    tenureOfferTenures: entries.map((e) => e.tenure),
  };
}

function detectClientMode(text: string): "analyse" | "discover" | "followup" {
  const lowerText = text.toLowerCase();
  const isDiscoverQuery =
    lowerText.match(/find\s+|search\s+|discover\s+|looking\s+for\s+|show\s+me\s+properties|subdividable|subdivision\s+opp|development\s+sites|lifestyle\s+prop|investment\s+prop/) ||
    lowerText.match(/any\s+(others?|more|properties|homes|houses|sections|land)|show\s+(me\s+)?more|more\s+(properties|options|results|sites)|what\s+else|anything\s+else|few\s+more|find\s+more|keep\s+looking|another\s+one|any\s+other|more\s+sites|other\s+options/) ||
    lowerText.match(/properties\s+(for\s+sale|on\s+sale|available|listed|in\s+)/i) ||
    lowerText.match(/(for\s+sale|on\s+sale|on\s+the\s+market)\s+in/i) ||
    lowerText.match(/what.*market|on.*market|market.*in/i);

  if (isDiscoverQuery) return "discover";

  const hasAddress =
    text.match(
      /\d+[a-zA-Z]?(?:\s*\/\s*\d+[a-zA-Z]?)?\s+[\w']+(?:\s+[\w']+){0,4}\s+(road|street|ave|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|esplanade|quay|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i,
    ) ||
    lowerText.match(/analys[ei]|feasibility|check|assess|evaluate|(?:^|[\s，。!?])(?:分析|可行性|评估)/);

  return hasAddress ? "analyse" : "followup";
}

function isCombinedPackageAnalyseRequest(text: string): boolean {
  const normalised = text.toLowerCase();
  const hasPackageSignal =
    /combined\s+(listing\s+)?package|full\s+package|package\s+analysis|analyse\s+.*package|analyze\s+.*package/i.test(text) ||
    /组合|完整组合|打包|整包/.test(text);
  const hasMultiAddressSignal =
    /\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b[\s\S]{0,80}(?:&|\+| and | 和 |及)[\s\S]{0,80}\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b/i.test(text) ||
    /\b\d+[a-z]?\s+[^,&+]+(?:street|st|road|rd|avenue|ave|place|pl|drive|dr|terrace|tce|crescent|cres)\b[\s\S]{0,80}(?:&|\+| and | 和 |及)\s*\d+[a-z]?\b/i.test(text);
  return hasPackageSignal && (hasMultiAddressSignal || normalised.includes("package") || /组合|整包|打包/.test(text));
}

function isLongRunningSubdivisionDiscover(text: string, mode: "analyse" | "discover" | "followup"): boolean {
  if (mode !== "discover") return false;
  return /subdivi|sub[-\s]?divide|subdivision|分割|分地|细分|細分|可分割|可细分|可細分/i.test(text);
}

function serializeSearchMessageForChat(message: ChatMessage): string {
  const results = (message.searchResults ?? [])
    .map((result) => `${result.address}||${result.listingUrl ?? ""}`)
    .join("; ");
  const parts = [`[Search results shown: ${results}]`];
  const aiIntro = message.aiIntro?.trim();
  if (aiIntro) parts.push(`[Assistant search note: ${aiIntro}]`);
  return parts.join("\n");
}

async function readBackgroundAnalyseJobs(): Promise<BackgroundAnalyseJob[]> {
  try {
    const raw = await AsyncStorage.getItem(BACKGROUND_ANALYSE_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((job): job is BackgroundAnalyseJob =>
      job &&
      typeof job === "object" &&
      typeof job.jobId === "string" &&
      typeof job.userId === "string" &&
      typeof job.sessionId === "string" &&
      typeof job.address === "string" &&
      typeof job.createdAt === "number",
    );
  } catch {
    return [];
  }
}

async function writeBackgroundAnalyseJobs(jobs: BackgroundAnalyseJob[]): Promise<void> {
  await AsyncStorage.setItem(BACKGROUND_ANALYSE_JOBS_KEY, JSON.stringify(jobs));
}

async function upsertBackgroundAnalyseJob(job: BackgroundAnalyseJob): Promise<void> {
  const jobs = await readBackgroundAnalyseJobs();
  const withoutCurrent = jobs.filter((item) => item.jobId !== job.jobId);
  await writeBackgroundAnalyseJobs([job, ...withoutCurrent].slice(0, 20));
}

async function removeBackgroundAnalyseJob(jobId: string): Promise<void> {
  const jobs = await readBackgroundAnalyseJobs();
  await writeBackgroundAnalyseJobs(jobs.filter((job) => job.jobId !== jobId));
}

async function readBackgroundScreeningJobs(): Promise<BackgroundScreeningJob[]> {
  try {
    const raw = await AsyncStorage.getItem(BACKGROUND_SCREENING_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((job): job is BackgroundScreeningJob =>
      job &&
      typeof job === "object" &&
      typeof job.jobId === "string" &&
      typeof job.userId === "string" &&
      typeof job.sessionId === "string" &&
      typeof job.query === "string" &&
      typeof job.createdAt === "number",
    );
  } catch {
    return [];
  }
}

async function writeBackgroundScreeningJobs(jobs: BackgroundScreeningJob[]): Promise<void> {
  await AsyncStorage.setItem(BACKGROUND_SCREENING_JOBS_KEY, JSON.stringify(jobs));
}

async function upsertBackgroundScreeningJob(job: BackgroundScreeningJob): Promise<void> {
  const jobs = await readBackgroundScreeningJobs();
  const withoutCurrent = jobs.filter((item) => item.jobId !== job.jobId);
  await writeBackgroundScreeningJobs([job, ...withoutCurrent].slice(0, 20));
}

async function removeBackgroundScreeningJob(jobId: string): Promise<void> {
  const jobs = await readBackgroundScreeningJobs();
  await writeBackgroundScreeningJobs(jobs.filter((job) => job.jobId !== jobId));
}

type AppRatingState = {
  completed?: boolean;
  rating?: number;
  promptCount?: number;
  chatCompletions?: number;
  lastPromptAt?: number;
  lastTriggeredMessageKey?: string;
};

function appRatingStorageKey(userId: string): string {
  return `${APP_RATING_STATE_KEY}/${userId}`;
}

async function readAppRatingState(userId: string): Promise<AppRatingState> {
  try {
    const raw = await AsyncStorage.getItem(appRatingStorageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeAppRatingState(userId: string, state: AppRatingState): Promise<void> {
  await AsyncStorage.setItem(appRatingStorageKey(userId), JSON.stringify(state));
}


// Keywords that indicate the user explicitly wants a service provider referral/recommendation.
// Checked against the lowercased user message before sending to /api/chat.
const RECOMMENDATION_KEYWORDS = [
  "recommend", "referral", "refer", "refer me", "anyone you know",
  "know anyone", "suggest", "who can help", "who should i", "who do i",
  "find someone", "find a builder", "find an architect", "find a planner",
  "find an engineer", "service provider", "provider", "specialist",
  "professional", "consultant", "expert", "connect me", "get someone",
  "hire someone", "need a builder", "need an architect", "need a planner",
  "need an engineer", "do you have anyone", "have anyone",
  "anyone to recommend", "anyone good", "who else", "anyone else",
];

function asksForOthers(textLower: string): boolean {
  return [
    "other", "another", "someone else", "else", "different", "different provider",
    "还有", "另外", "别的", "其他", "再推荐", "换一个", "換一個",
  ].some((kw) => textLower.includes(kw));
}

function extractJSON(text: string): unknown | null {
  try {
    const stripped = text.replace(/```(?:json)?\s*/gi, "").replace(/```\s*/g, "").trim();
    const match = stripped.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}
  return null;
}

function isFeasibilityReportGroup(value: unknown): value is FeasibilityReportGroup {
  return !!value &&
    typeof value === "object" &&
    (value as FeasibilityReportGroup).kind === "combined_listing_group" &&
    Array.isArray((value as FeasibilityReportGroup).reports);
}

// Removes any JSON-looking blocks from a text string so raw JSON is never
// shown to the user in the chat. If the string is *only* JSON, returns a
// friendly fallback message instead. The fallback is picked based on the
// caller's active locale so Chinese-OS users get a Chinese message.
function sanitizeForDisplay(text: string, formatErrorFallback: string): string {
  if (!text) return "";
  const stripped = text
    .replace(/```(?:json)?[\s\S]*?```/gi, "")
    .replace(/\{[\s\S]*\}/g, "")
    .replace(/\[[\s\S]*\]/g, "")
    .trim();
  if (!stripped || stripped.length < 4) {
    return formatErrorFallback;
  }
  return stripped;
}

/** Brief confirmation after address suggestion bubble — maps to top geocoded suggestion. */
function isBareAffirmativeReply(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 48) return false;
  const lower = trimmed.toLowerCase();

  const neg =
    /\b(no|nah|nope|not\s+really|incorrect|wrong|different|actually\b|instead|cancel|rather not)\b/i.test(lower) ||
    /^[\u4e0d\u662f]/.test(trimmed) ||
    /[\u932f\u4e86]|不是|不太对|不對/i.test(trimmed);
  if (neg) return false;

  if (/^(yes|yep|yeah|sure|ok|okay|please|correct|right|exactly)$/i.test(lower)) return true;
  if (
    /^(that's right|that's the one|that's it|go ahead|go for it|sounds good|looks good)$/i.test(lower)
  ) {
    return true;
  }
  const zhBare =
    /^(是的|對對|對的|對|好|好啊|没问题|沒問題|可以|行行|確認|就这|就這樣|就这样)$/u.test(trimmed);
  return zhBare;
}

function getFirstTurnResponseMode(messages: ChatMessage[]): string | null {
  const assistant = messages.filter((m) => m.role === "assistant" && m.type !== "loading");
  if (assistant.length !== 1) return null;
  const a = assistant[0];
  if (a.type === "report") return "analyse";
  if (a.type === "report_group") return "analyse";
  if (a.type === "search") return "discover";
  return "text";
}

export default function SearchScreen() {
  const { t } = useT();
  const SUGGESTION_QUERIES = [
    t("search.suggestion_1"),
    t("search.suggestion_2"),
    t("search.suggestion_3"),
  ];
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const routeParams = useLocalSearchParams<{
    analyseListingId?: string;
    analyseAddress?: string;
    analysePhotoUrl?: string;
    analyseListingUrl?: string;
    analyseListingContext?: string;
    analyseNewChat?: string;
    exploreAskSuburb?: string;
  }>();
  const { getApiHeaders, refreshProfile, user } = useAuth();
  const {
    currentSession,
    currentSessionId,
    createSession,
    startNewChat,
    switchSession,
    addMessage,
    updateMessage,
    updateLastMessage,
    updateLastMessageIfType,
    replaceBackgroundAnalyseMessage,
    removeMessage,
    updateCandidateScores,
    setCurrentReport,
    setCurrentReportGroup,
    isLoading,
    setIsLoading,
    setFirstLlmResponseRating,
    bumpSearchHistory,
  } = useChat();
  const { markPageRead } = useNotifications();

  const [inputText, setInputText] = useState("");
  const [homeMode, setHomeMode] = useState<"ask" | "browse">("ask");
  const [browseFilters, setBrowseFilters] = useState<BrowseListingFilters>(DEFAULT_BROWSE_FILTERS);
  const [appliedBrowseFilters, setAppliedBrowseFilters] = useState<BrowseListingFilters>(DEFAULT_BROWSE_FILTERS);
  const [browseFiltersExpanded, setBrowseFiltersExpanded] = useState(false);
  const [browseListings, setBrowseListings] = useState<BrowseListing[]>([]);
  const [browseNextCursor, setBrowseNextCursor] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseRefreshing, setBrowseRefreshing] = useState(false);
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [messageLimitReached, setMessageLimitReached] = useState(false);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingCancelArmed, setRecordingCancelArmed] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const isLoadingRef = useRef(isLoading);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingStartYRef = useRef<number | null>(null);
  const recordingCurrentYRef = useRef<number | null>(null);
  const recordingCancelArmedRef = useRef(false);
  const recordingStartInFlightRef = useRef(false);
  const recordingPressActiveRef = useRef(false);
  const recordingStartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingStartWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingMaxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceInterruptionNoticePendingRef = useRef(false);
  const [showMicHoldHint, setShowMicHoldHint] = useState(false);
  const micHoldHintOpacity = useRef(new Animated.Value(0)).current;
  const micHoldHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownRecommendationReportIds = useRef<Set<string>>(new Set());
  const lastCheckedFollowUpCount = useRef<Map<string, number>>(new Map());
  const providerRecommendationKeysRef = useRef<Set<string>>(new Set());
  const prefetchingContinuationRef = useRef<Set<string>>(new Set());
  // Guards against rapid "Show more" taps firing concurrent /discovery/next
  // requests on the same continuation token (the button's disabled state only
  // applies after an async re-render). Keyed by message id.
  const showMoreInFlightRef = useRef<Set<string>>(new Set());
  // Always-current mirror of currentSession?.messages — used in async timer
  // callbacks where the closure would otherwise hold stale captured state.
  const sessionMessagesRef = useRef<ChatMessage[]>([]);
  const checkedFollowupIds = useRef<Set<string>>(new Set());
  const lastReportIdRef = useRef<string | null>(null);

  const reportMessageHeightsRef = useRef<Map<string, number>>(new Map());
  const messageHeightsRef = useRef<Map<string, number>>(new Map());
  const pendingSearchScrollTargetRef = useRef<{ messageId: string; index: number } | null>(null);
  const browseQueuedListingsRef = useRef<BrowseListing[]>([]);
  const browsePreloadRef = useRef<{ key: string; listings: BrowseListing[]; nextCursor: string | null } | null>(null);
  const browseLoadedKeyRef = useRef<string | null>(null);
  const browsePreloadInFlightRef = useRef(false);
  const cardScorePollRef = useRef<{ addresses: string[]; sessionId: string; intervalId: ReturnType<typeof setInterval> | null }>({ addresses: [], sessionId: "", intervalId: null });
  const handleAnalyseRef = useRef<((address: string, selectedPhotoUrl?: string | null, selectedListingUrl?: string | null, selectedListingContext?: SelectedListingContext | null, skipAnalyseDisclaimer?: boolean, analysisKey?: string, forceNewSession?: boolean) => Promise<void>) | null>(null);
  const handleSendRef = useRef<((overrideText?: string, skipAnalyseDisclaimer?: boolean, continuePresentation?: "generic_listing" | "scored_screening", discoveryChoiceSuburb?: string, displayText?: string) => Promise<void>) | null>(null);
  const processedRouteAnalyseRef = useRef<string | null>(null);
  const processedShareTokenRef = useRef<string | null>(null);
  // Set when the Explore page hands off "Explore by suburb": the next user message
  // is the suburb name, which we route into subdivision-intent screening.
  const pendingSuburbScreeningRef = useRef(false);
  const processedExploreAskSuburbRef = useRef<string | null>(null);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [analysingPropertyKey, setAnalysingPropertyKey] = useState<string | null>(null);
  const [analyseDisclaimerVisible, setAnalyseDisclaimerVisible] = useState(false);
  const [analyseDisclaimerDontRemind, setAnalyseDisclaimerDontRemind] = useState(false);
  const [analyseDisclaimerDismissed, setAnalyseDisclaimerDismissed] = useState(false);
  const [guestAnalysisPromptVisible, setGuestAnalysisPromptVisible] = useState(false);
  const pendingAnalyseActionRef = useRef<PendingAnalyseAction | null>(null);

  const handlePurchaseSuccess = useCallback(() => {
    setMessageLimitReached(false);
    refreshProfile().catch(() => {});
  }, [refreshProfile]);

  const addProviderRecommendationOnce = useCallback((args: {
    sessionId: string;
    provider: ServiceProvider;
    intentType: string;
    propertyAddress: string;
  }): boolean => {
    const key = `${args.sessionId}:${args.provider.id}`;
    const freshMsgs = sessionMessagesRef.current;
    const alreadyVisible = freshMsgs.some(
      (m) => m.type === "provider_recommendation" && m.provider?.id === args.provider.id,
    );
    if (alreadyVisible || providerRecommendationKeysRef.current.has(key)) return false;

    providerRecommendationKeysRef.current.add(key);
    addMessage({
      role: "assistant",
      content: "",
      type: "provider_recommendation",
      provider: args.provider,
      intentType: args.intentType,
      propertyAddress: args.propertyAddress,
    }, args.sessionId);
    return true;
  }, [addMessage]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    AsyncStorage.getItem(getAnalyseDisclaimerDismissedKey(user?.id))
      .then((value) => setAnalyseDisclaimerDismissed(value === "true"))
      .catch(() => {});
  }, [user?.id]);

  useEffect(() => {
    if (!BROWSE_MODE_ENABLED) {
      setHomeMode("ask");
      AsyncStorage.setItem(HOME_MODE_KEY, "ask").catch(() => {});
      return;
    }
    AsyncStorage.getItem(HOME_MODE_KEY)
      .then((value) => {
        if (value === "ask" || (BROWSE_MODE_ENABLED && value === "browse")) setHomeMode(value);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!BROWSE_MODE_ENABLED) return;
    AsyncStorage.setItem(HOME_MODE_KEY, homeMode).catch(() => {});
  }, [homeMode]);

  const shouldShowAnalyseDisclaimer = useCallback(
    () => !analyseDisclaimerDismissed,
    [analyseDisclaimerDismissed],
  );

  const openAnalyseDisclaimer = useCallback((action: PendingAnalyseAction) => {
    pendingAnalyseActionRef.current = action;
    setAnalyseDisclaimerDontRemind(false);
    setAnalyseDisclaimerVisible(true);
  }, []);

  const promptSignInForAnalysis = useCallback(async (action: PendingAnalyseAction) => {
    await AsyncStorage.setItem(PENDING_GUEST_ANALYSE_ACTION_KEY, JSON.stringify(action)).catch(() => {});
    setGuestAnalysisPromptVisible(true);
  }, []);

  const closeGuestAnalysisPrompt = useCallback(() => {
    setGuestAnalysisPromptVisible(false);
  }, []);

  const openGuestAnalysisLogin = useCallback(() => {
    setGuestAnalysisPromptVisible(false);
    router.push("/(auth)/login" as never);
  }, [router]);

  const openGuestAnalysisSignup = useCallback(() => {
    setGuestAnalysisPromptVisible(false);
    router.push("/(auth)/signup" as never);
  }, [router]);

  const chatQuota = user ? resolveChatQuota(user.role, user.subscriptionTier, user.specialStatus) : null;

  useEffect(() => {
    if (!user || !chatQuota) return;
    const used = user.messagesUsedThisMonth ?? 0;
    setMessageLimitReached(used >= chatQuota.limit);
  }, [user, chatQuota]);

  const loadBrowseListings = useCallback(async (options?: { refresh?: boolean; append?: boolean; cursor?: string | null; filters?: BrowseListingFilters }) => {
    const activeFilters = {
      ...(options?.filters ?? appliedBrowseFilters),
      listingType: "for_sale" as const,
      limit: options?.append ? BROWSE_PREFETCH_LIMIT : BROWSE_PREFETCH_LIMIT,
    };
    const activeKey = browseFiltersKey(activeFilters);
    const append = options?.append === true;
    if (append && browseQueuedListingsRef.current.length > 0) {
      const next = browseQueuedListingsRef.current.slice(0, BROWSE_PAGE_SIZE);
      browseQueuedListingsRef.current = browseQueuedListingsRef.current.slice(BROWSE_PAGE_SIZE);
      setBrowseListings((prev) => [...prev, ...next]);
      return;
    }
    const cursor = options?.cursor ?? null;
    if (append && !cursor) return;
    if (append) setBrowseLoadingMore(true);
    else if (options?.refresh) setBrowseRefreshing(true);
    else setBrowseLoading(true);
    setBrowseError(null);
    try {
      const result = await fetchBrowseListings(getApiHeaders(), {
        ...activeFilters,
        cursor: append ? cursor : null,
        limit: BROWSE_PREFETCH_LIMIT,
      });
      const visible = result.listings.slice(0, BROWSE_PAGE_SIZE);
      browseQueuedListingsRef.current = result.listings.slice(BROWSE_PAGE_SIZE);
      if (!append) browseLoadedKeyRef.current = activeKey;
      setBrowseListings((prev) => append ? [...prev, ...visible] : visible);
      setBrowseNextCursor(result.nextCursor);
    } catch (error) {
      setBrowseError(error instanceof Error ? error.message : "Could not load listings.");
    } finally {
      setBrowseLoading(false);
      setBrowseRefreshing(false);
      setBrowseLoadingMore(false);
    }
  }, [appliedBrowseFilters, getApiHeaders]);

  useEffect(() => {
    if (!BROWSE_MODE_ENABLED) return;
    if (homeMode !== "browse") return;
    if (browseLoadedKeyRef.current === browseFiltersKey(appliedBrowseFilters)) return;
    void loadBrowseListings();
  }, [homeMode, appliedBrowseFilters, loadBrowseListings]);

  const preloadBrowseListings = useCallback(async () => {
    if (!BROWSE_MODE_ENABLED || browsePreloadInFlightRef.current) return;
    browsePreloadInFlightRef.current = true;
    const preloadFilters = { ...DEFAULT_BROWSE_FILTERS, limit: BROWSE_PREFETCH_LIMIT };
    try {
      const result = await fetchBrowseListings(getApiHeaders(), preloadFilters);
      browsePreloadRef.current = {
        key: browseFiltersKey(preloadFilters),
        listings: result.listings,
        nextCursor: result.nextCursor,
      };
    } catch {
      // Silent: Browse can still load normally when opened.
    } finally {
      browsePreloadInFlightRef.current = false;
    }
  }, [getApiHeaders, user]);

  useEffect(() => {
    if (!BROWSE_MODE_ENABLED) return;
    void preloadBrowseListings();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void preloadBrowseListings();
    });
    return () => sub.remove();
  }, [preloadBrowseListings]);

  const applyBrowseFilters = useCallback(() => {
    const next = {
      ...browseFilters,
      minPrice: undefined,
      maxPrice: undefined,
      minLandArea: undefined,
      minFloorArea: undefined,
      listingType: "for_sale" as const,
      limit: BROWSE_PAGE_SIZE,
      cursor: null,
    };
    browseQueuedListingsRef.current = [];
    browseLoadedKeyRef.current = null;
    setBrowseNextCursor(null);
    setAppliedBrowseFilters(next);
    setBrowseFiltersExpanded(false);
    Keyboard.dismiss();
    if (homeMode !== "browse") setHomeMode("browse");
    else if (browseFiltersKey(next) === browseFiltersKey(appliedBrowseFilters)) void loadBrowseListings({ filters: next });
  }, [appliedBrowseFilters, browseFilters, homeMode, loadBrowseListings]);

  const openBrowseMode = useCallback(() => {
    const defaultKey = browseFiltersKey({ ...DEFAULT_BROWSE_FILTERS, limit: BROWSE_PREFETCH_LIMIT });
    const draftKey = browseFiltersKey(browseFilters);
    setHomeMode("browse");
    setBrowseFiltersExpanded(false);
    if (draftKey === browseFiltersKey(DEFAULT_BROWSE_FILTERS) && browsePreloadRef.current?.key === defaultKey) {
      const preloaded = browsePreloadRef.current;
      browseQueuedListingsRef.current = preloaded.listings.slice(BROWSE_PAGE_SIZE);
      browseLoadedKeyRef.current = browseFiltersKey(DEFAULT_BROWSE_FILTERS);
      setAppliedBrowseFilters(DEFAULT_BROWSE_FILTERS);
      setBrowseListings(preloaded.listings.slice(0, BROWSE_PAGE_SIZE));
      setBrowseNextCursor(preloaded.nextCursor);
      return;
    }
    applyBrowseFilters();
  }, [applyBrowseFilters, browseFilters]);

  const openAskMode = useCallback(() => {
    setHomeMode("ask");
    setBrowseFiltersExpanded(false);
    Keyboard.dismiss();
  }, []);

  const messages = currentSession?.messages || [];
  const hasSearchContent = messages.length > 0;

  useFocusEffect(
    useCallback(() => {
      if (user && hasSearchContent) void markPageRead("search");
    }, [hasSearchContent, markPageRead, user]),
  );

  const scrollToNewestMessage = useCallback(() => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    setShowJumpToLatest(false);
  }, []);

  const scrollToReportPropertyCard = useCallback((messageId: string) => {
    let attempts = 0;
    const run = () => {
      attempts += 1;
      const itemHeight = reportMessageHeightsRef.current.get(messageId) ?? 0;
      if (itemHeight > 0 && listViewportHeight > 0) {
        const offset = Math.max(0, itemHeight - listViewportHeight + 16);
        flatListRef.current?.scrollToOffset({ offset, animated: true });
        setShowJumpToLatest(offset > 80);
        return;
      }
      if (attempts < 10) {
        setTimeout(run, 80);
      }
    };
    setTimeout(run, 80);
  }, [listViewportHeight]);

  const handleSearchResultLayout = useCallback((messageId: string, index: number, layout: { y: number; height: number }) => {
    const pending = pendingSearchScrollTargetRef.current;
    if (!pending || pending.messageId !== messageId || pending.index !== index) return;

    let attempts = 0;
    const run = () => {
      attempts += 1;
      const latestPending = pendingSearchScrollTargetRef.current;
      if (!latestPending || latestPending.messageId !== messageId || latestPending.index !== index) return;

      const messageHeight = messageHeightsRef.current.get(messageId) ?? 0;
      if (messageHeight <= 0 || layout.height <= 0 || messageHeight < layout.y + layout.height) {
        if (attempts < 8) setTimeout(run, 60);
        return;
      }

      const messageIndex = messages.findIndex((message) => message.id === messageId);
      const newerMessagesHeight = messageIndex >= 0
        ? messages
            .slice(messageIndex + 1)
            .reduce((sum, message) => sum + (messageHeightsRef.current.get(message.id) ?? 0), 0)
        : 0;

      const offset = Math.max(0, newerMessagesHeight + messageHeight - layout.y - layout.height + 12);
      pendingSearchScrollTargetRef.current = null;
      flatListRef.current?.scrollToOffset({ offset, animated: true });
      setShowJumpToLatest(offset > 80);

      const sessionId = currentSessionId ?? currentSession?.id;
      if (sessionId) {
        setTimeout(() => {
          updateMessage(messageId, { scrollToSearchResultIndex: undefined }, sessionId);
        }, 250);
      }
    };
    setTimeout(run, 40);
  }, [currentSession?.id, currentSessionId, messages, updateMessage]);

  const showRatingStrip = useMemo(() => {
    if (!currentSession?.id || currentSession.skipFirstTurnRating) return false;
    const assistantDone = currentSession.messages.filter(
      (m) => m.role === "assistant" && m.type !== "loading",
    );
    const userDone = currentSession.messages.filter((m) => m.role === "user");
    return assistantDone.length === 1 && userDone.length >= 1;
  }, [currentSession]);

  const submitFirstTurnRating = useCallback(
    (rating: "up" | "down", reason?: string) => {
      const sid = currentSessionId;
      if (!sid || !currentSession) return;
      setFirstLlmResponseRating(sid, rating);
      const responseMode = getFirstTurnResponseMode(currentSession.messages);
      const body: Record<string, unknown> = {
        clientSessionId: sid,
        rating,
        responseMode,
      };
      if (rating === "down" && reason && reason.trim().length > 0) {
        body.reason = reason.trim();
      }
      void fetch(`${resolveApiBase()}/feedback/llm`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
    },
    [currentSessionId, currentSession, getApiHeaders, setFirstLlmResponseRating],
  );

  useEffect(() => {
    const msgs = currentSession?.messages ?? [];
    const latestMsg = msgs[msgs.length - 1];
    if (latestMsg?.type === "report" && latestMsg.id !== lastReportIdRef.current) {
      lastReportIdRef.current = latestMsg.id;
      scrollToReportPropertyCard(latestMsg.id);
    }
  }, [currentSession?.messages, scrollToReportPropertyCard]);

  // Keep sessionMessagesRef in sync so timer callbacks can read fresh message
  // state without relying on stale closures.
  useEffect(() => {
    sessionMessagesRef.current = currentSession?.messages ?? [];
  });

  useEffect(() => {
    if (user?.role !== "general") return;
    const msgs = currentSession?.messages ?? [];

    // Find the most recent report in this session
    const reportMessages = msgs.filter((m) => m.type === "report" && m.report);
    if (reportMessages.length === 0) return;
    const lastReport = reportMessages[reportMessages.length - 1];

    // Never show a second recommendation for the same report
    if (shownRecommendationReportIds.current.has(lastReport.id)) return;

    // Don't show if a recommendation is already visible in the chat
    const alreadyHasRecommendation = msgs.some((m) => m.type === "provider_recommendation");
    if (alreadyHasRecommendation) return;

    // Count assistant text messages that appeared AFTER the last report (follow-ups)
    const reportIdx = msgs.findIndex((m) => m.id === lastReport.id);
    const msgsAfterReport = reportIdx >= 0 ? msgs.slice(reportIdx + 1) : [];
    const followUpCount = msgsAfterReport.filter(
      (m) => m.role === "assistant" && m.type === "text",
    ).length;

    // Only fire if followUpCount changed since the last check for this report,
    // so we don't hammer the endpoint on every render
    const lastCount = lastCheckedFollowUpCount.current.get(lastReport.id) ?? -1;
    if (followUpCount <= lastCount) return;
    lastCheckedFollowUpCount.current.set(lastReport.id, followUpCount);

    // Delay slightly so the UI settles before the recommendation bubble appears
    const timer = setTimeout(async () => {
      try {
        // Re-read messages at fire time rather than relying on the closure-captured
        // `msgs` — this prevents a race condition where the explicit /recommendations
        // check (triggered from the finally block at +1200 ms) adds a provider card
        // before this timer fires at +2500 ms and the stale guard misses it.
        const freshMsgs = sessionMessagesRef.current;
        if (freshMsgs.some((m) => m.type === "provider_recommendation")) return;

        const apiBase = resolveApiBase();
        const headers = getApiHeaders();
        const conversationHistory = freshMsgs
          .filter((m) => m.type === "text" || m.type === "report")
          .map((m) => ({ role: m.role, content: m.type === "text" ? m.content : `[Report for ${m.report?.address ?? "property"}]` }));

        const resp = await fetch(`${apiBase}/recommendations/check`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            report: lastReport.report,
            conversationHistory,
            followUpCount,
            excludeProviderIds: freshMsgs
              .filter((m) => m.type === "provider_recommendation" && m.provider?.id)
              .map((m) => m.provider!.id),
          }),
        });
        // Free users hitting the provider-DM gate. The auto check is silent
        // by design (the user didn't ask), so we don't open the paywall here
        // — that's reserved for explicit user actions handled below.
        if (resp.status === 402) return;
        if (!resp.ok) return;
        const data = await resp.json() as {
          shouldRecommend: boolean;
          provider: ServiceProvider | null;
          intentType: string;
          upgradeRequired?: boolean;
        };
        if (data.shouldRecommend && data.provider && currentSessionId) {
          shownRecommendationReportIds.current.add(lastReport.id);
          addProviderRecommendationOnce({
            sessionId: currentSessionId,
            provider: data.provider,
            intentType: data.intentType,
            propertyAddress: resolveReportAddress(lastReport.report),
          });
        }
      } catch (err) {
        console.log("Recommendation check failed:", err);
      }
    }, 2500);

    return () => clearTimeout(timer);
  }, [currentSession?.messages, user?.role, getApiHeaders, addProviderRecommendationOnce, currentSessionId]);

  const handleConnect = useCallback(async (providerId: string, propertyAddress: string) => {
    try {
      const apiBase = resolveApiBase();
      const headers = getApiHeaders();
      const msgs = currentSession?.messages ?? [];
      const lastReportMsg = [...msgs].reverse().find((m) => m.type === "report" && m.report);
      const report = lastReportMsg?.report ?? null;
      const resolvedProviderId = String(providerId ?? "").trim();
      const resolvedPropertyAddress =
        String(propertyAddress ?? "").trim() ||
        resolveReportAddress(report) ||
        resolveReportAddress(currentSession?.currentReport ?? undefined);
      if (!resolvedProviderId || !resolvedPropertyAddress) {
        throw new Error(t("bubble.recommend.connect_missing_context"));
      }
      const resp = await fetch(`${apiBase}/recommendations/connect`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          providerId: resolvedProviderId,
          propertyAddress: resolvedPropertyAddress,
          report,
        }),
      });
      if (resp.status === 402) {
        const last = msgs[msgs.length - 1];
        if (last?.type !== "provider_upgrade_gate") {
          addMessage({
            role: "assistant",
            content: "",
            type: "provider_upgrade_gate",
          }, currentSessionId ?? undefined);
        }
        setShowPaywall(true);
        return;
      }
      if (!resp.ok) {
        const err = await resp.json() as { error?: string };
        throw new Error(err.error ?? "Connect failed");
      }
      const { threadId } = await resp.json() as { threadId: string };
      router.push(`/chat/${threadId}` as any);
    } catch (err) {
      console.log("Connect failed:", err);
      throw err;
    }
  }, [getApiHeaders, router, currentSession, t]);

  const handleDismiss = useCallback((messageId: string) => {
    removeMessage(messageId);
  }, [removeMessage]);

  useEffect(() => {
    if (user?.role !== "general") return;
    const msgs = currentSession?.messages ?? [];
    const latestReport = [...msgs].reverse().find((m) => m.type === "report" && m.report)?.report;
    const reportForAgentLookup = currentSession?.currentReport ?? latestReport;
    if (!reportForAgentLookup) return;

    const lastAssistantText = [...msgs].reverse().find(
      (m) => m.role === "assistant" && m.type === "text",
    );
    if (!lastAssistantText) return;
    if (checkedFollowupIds.current.has(lastAssistantText.id)) return;

    const alreadyHasAgentBubble = msgs.some((m) => m.type === "agent_contact");
    if (alreadyHasAgentBubble) return;

    // Hard guard: never fire the passive agent-contact lookup when the user is
    // working with a combined listing package. The '分析完整组合' button sends a
    // distinct package-analyse prompt and the result is a report_group — neither
    // belongs in the agent-contact bubble.
    const lastUserMessage = [...msgs].reverse().find((m) => m.role === "user" && m.type === "text");
    if (lastUserMessage && isCombinedPackageAnalyseRequest(lastUserMessage.content)) return;
    if (currentSession?.currentReportGroup) return;
    const hasReportGroupInSession = msgs.some((m) => m.type === "report_group");
    if (hasReportGroupInSession) return;

    if (![...msgs].reverse().some((m) => m.role === "user")) return;

    checkedFollowupIds.current.add(lastAssistantText.id);

    const timer = setTimeout(async () => {
      try {
        const apiBase = resolveApiBase();
        const headers = getApiHeaders();
        const address = resolveReportAddress(reportForAgentLookup);
        if (!address) return;
        const selectedListingContext =
          reportForAgentLookup.selectedListingContext ??
          ((reportForAgentLookup.propertyOverview as any)?.selectedListingContext as SelectedListingContext | undefined) ??
          null;
        const conversationHistory = msgs
          .filter((m) => m.type === "text")
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content }));

        const agentCtrl = new AbortController();
        const agentTimer = setTimeout(() => agentCtrl.abort(), 30_000);
        const resp = await fetch(`${apiBase}/agent-contact/lookup`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            address,
            messages: conversationHistory,
            listingUrl: selectedListingContext?.listingUrl ?? (reportForAgentLookup.propertyOverview as any)?.listingUrl ?? null,
            selectedListingContext,
          }),
          signal: agentCtrl.signal,
        }).finally(() => clearTimeout(agentTimer));
        if (!resp.ok) return;

        const data = await resp.json() as {
          wantsAgentContact: boolean;
          found?: boolean;
          isListed?: boolean;
          agentName?: string | null;
          agentPhone?: string | null;
          agencyName?: string | null;
          agentAvatarUrl?: string | null;
          propertyAddress?: string;
          matchType?: "subject" | "suburb" | null;
          listingAddress?: string | null;
          listingUrl?: string | null;
        };

        if (data.wantsAgentContact && data.found && data.isListed && (data.agentPhone || data.listingUrl)) {
          addMessage({
            role: "assistant",
            content: "",
            type: "agent_contact",
            agentName: data.agentName ?? null,
            agentPhone: data.agentPhone ?? null,
            agencyName: data.agencyName ?? null,
            agentAvatarUrl: data.agentAvatarUrl ?? null,
            propertyAddress: data.listingAddress ?? address,
            agentMatchType: data.matchType ?? "subject",
            agentListingUrl: data.listingUrl ?? null,
          }, currentSessionId ?? undefined);
        }
      } catch (err) {
        console.log("Agent contact lookup failed:", err);
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [currentSession?.messages, currentSession?.currentReport, currentSession?.currentReportGroup, user?.role, getApiHeaders, addMessage, currentSessionId]);

  const handleAgentDismiss = useCallback((_messageId: string) => {}, []);

  const getApiBase = useCallback(() => resolveApiBase(), []);

  const startCardScorePoll = useCallback(
    (candidates: Array<Pick<PropertyCandidate, "address" | "listingUrl">>, sessionId: string) => {
      if (cardScorePollRef.current.intervalId) {
        clearInterval(cardScorePollRef.current.intervalId);
      }
      const addresses = candidates.map((c) => c.address);
      cardScorePollRef.current = { addresses, sessionId, intervalId: null };

      let attempts = 0;
      const MAX_ATTEMPTS = 20;

      const poll = async () => {
        attempts++;
        if (attempts > MAX_ATTEMPTS) {
          clearInterval(cardScorePollRef.current.intervalId!);
          return;
        }
        try {
          const apiBase = getApiBase();
          const params = addresses.map((a) => `addresses[]=${encodeURIComponent(a)}`).join("&");
          const urlParams = candidates
            .map((c) => `urls[]=${encodeURIComponent(c.listingUrl ?? "")}`)
            .join("&");
          const resp = await fetch(`${apiBase}/analyse/card-scores?${params}${urlParams ? `&${urlParams}` : ""}`, {
            headers: getApiHeaders(),
          });
          if (!resp.ok) return;
          const results = await resp.json() as Array<{
            address: string;
            status: string;
            scores?: { ease: number; cost: number; roi: number; composite: number };
            landArea?: number;
            zone?: string | null;
            potentialLots?: number;
            minLotSize?: number | null;
            standardVacantLots?: number;
            standardPathViable?: boolean;
            standardMinLotSize?: number | null;
            designLedEligible?: boolean;
            designLedYieldRange?: { min: number; max: number } | null;
            designLedConfidence?: "none" | "low" | "medium";
            designLedReasons?: string[];
            designLedBlockers?: string[];
            designLedSummary?: string | null;
            designLedDetail?: string | null;
          }>;

          const readyScores: Record<string, CandidateScoreUpdate> = {};
          let allDone = results.length > 0;
          for (const r of results) {
            if (r.status === "pending") { allDone = false; continue; }
            if (r.status === "ready" && r.scores) {
              readyScores[r.address] = {
                ...r.scores,
                ...(r.landArea != null ? { landArea: r.landArea } : {}),
                ...(r.zone !== undefined ? { zone: r.zone } : {}),
                ...(r.potentialLots != null ? { potentialLots: r.potentialLots } : {}),
                ...(r.minLotSize !== undefined ? { minLotSize: r.minLotSize } : {}),
                ...(r.standardVacantLots != null ? { standardVacantLots: r.standardVacantLots } : {}),
                ...(r.standardPathViable !== undefined ? { standardPathViable: r.standardPathViable } : {}),
                ...(r.standardMinLotSize !== undefined ? { standardMinLotSize: r.standardMinLotSize } : {}),
                ...(r.designLedEligible !== undefined ? { designLedEligible: r.designLedEligible } : {}),
                ...(r.designLedYieldRange !== undefined ? { designLedYieldRange: r.designLedYieldRange } : {}),
                ...(r.designLedConfidence !== undefined ? { designLedConfidence: r.designLedConfidence } : {}),
                ...(r.designLedReasons !== undefined ? { designLedReasons: r.designLedReasons } : {}),
                ...(r.designLedBlockers !== undefined ? { designLedBlockers: r.designLedBlockers } : {}),
                ...(r.designLedSummary !== undefined ? { designLedSummary: r.designLedSummary } : {}),
                ...(r.designLedDetail !== undefined ? { designLedDetail: r.designLedDetail } : {}),
              };
            }
          }

          if (Object.keys(readyScores).length > 0) {
            updateCandidateScores(readyScores, sessionId);
          }

          if (allDone) {
            clearInterval(cardScorePollRef.current.intervalId!);
          }
        } catch {}
      };

      const id = setInterval(poll, 4000);
      cardScorePollRef.current.intervalId = id;
      poll();
    },
    [getApiBase, getApiHeaders, updateCandidateScores],
  );

  const fetchDiscoveryNext = useCallback(
    async (message: ChatMessage, count = 6, prefetchOnly = false): Promise<DiscoveryNextResponse | DiscoveryNextError | null> => {
      if (!message.continuationToken) return null;
      const resp = await fetch(`${getApiBase()}/discovery/next`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          continuationToken: message.continuationToken,
          shownCandidates: message.searchResults ?? [],
          prefetchOnly,
          count,
        }),
      });
      if (!resp.ok) {
        // 410 = continuation expired, 403 = belongs to another session. Neither
        // can be resumed, so the caller surfaces the "see again / search nearby"
        // choice. Everything else (5xx) is transient → caller offers a retry.
        return { error: resp.status === 410 || resp.status === 403 ? "expired" : "transient" };
      }
      return (await resp.json()) as DiscoveryNextResponse;
    },
    [getApiBase, getApiHeaders],
  );

  const claimDiscoveryCandidates = useCallback(
    async (continuationToken: string | null | undefined, candidates: PropertyCandidate[]) => {
      if (!continuationToken || candidates.length === 0) return;
      await fetch(`${getApiBase()}/discovery/next`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({
          continuationToken,
          claimCandidates: candidates.map((candidate) => ({
            address: candidate.address,
            listingUrl: candidate.listingUrl,
          })),
        }),
      }).catch(() => {});
    },
    [getApiBase, getApiHeaders],
  );

  const prefetchDiscoveryNext = useCallback(
    async (message: ChatMessage, sessionId: string) => {
      if (!message.continuationToken) return;
      if (message.prefetchedSearchResults?.length || message.prefetchedExhausted || message.showMoreStatus === "loading") return;
      const key = `${sessionId}:${message.id}:${message.continuationToken}`;
      if (prefetchingContinuationRef.current.has(key)) return;
      prefetchingContinuationRef.current.add(key);
      try {
        const data = await fetchDiscoveryNext(message, 9, true);
        // No prefetch available (no token, or expired/transient error). Leave the
        // message as-is; the manual Show-more tap surfaces the choice/retry.
        if (!data || isDiscoveryNextError(data)) return;
        updateMessage(message.id, {
          prefetchedSearchResults: data.candidates ?? [],
          prefetchedContinuationToken: data.continuationToken ?? null,
          prefetchedExhausted: Boolean(data.exhausted),
          prefetchedClarification: data.clarification,
          prefetchedSuburb: data.suburb,
          prefetchedQueueSource: data.queueSource,
          showMoreStatus: "ready",
        }, sessionId);
      } finally {
        prefetchingContinuationRef.current.delete(key);
      }
    },
    [fetchDiscoveryNext, updateMessage],
  );

  const showDiscoveryExhaustedChoice = useCallback(
    (
      clarification:
        | { question: string; options: string[]; optionActions?: Array<"repeat_origin" | "search_nearby">; searchPresentation?: ChatMessage["searchPresentation"]; suburb?: string | null }
        | undefined,
      sessionId: string,
      context?: { searchPresentation?: ChatMessage["searchPresentation"]; suburb?: string },
    ) => {
      // The exhausted payload echoes the authoritative presentation + suburb
      // (the origin suburb on a fully-drained train), so prefer it; fall back to
      // the originating message's context only when the payload omits them.
      const resolvedPresentation = clarification?.searchPresentation ?? context?.searchPresentation;
      const resolvedSuburb = (clarification?.suburb ?? undefined) ?? context?.suburb;
      addMessage({
        role: "assistant",
        content: "",
        type: "discovery_exhausted_choice",
        // The backend always sends a clarification with two options now; this
        // fallback only fires if it's ever missing. Never render empty options
        // (that produces a silent, button-less message). The default labels are
        // chosen to match the backend's repeat/nearby intent detectors so the
        // round-trip still routes correctly.
        clarification: clarification
          ? { question: clarification.question, options: clarification.options, optionActions: clarification.optionActions }
          : {
              question: t("search.exhausted_question"),
              options: [t("search.exhausted_see_again"), t("search.exhausted_nearby")],
              optionActions: ["repeat_origin", "search_nearby"],
            },
        // Piggyback these back to /chat on the chip tap (keeps intent + the
        // refresh/expand suburb authoritative).
        searchPresentation: resolvedPresentation,
        suburb: resolvedSuburb,
      }, sessionId);
    },
    [addMessage, t],
  );

  const appendContinuationCandidates = useCallback(
    (
      message: ChatMessage,
      candidates: PropertyCandidate[],
      continuationToken: string | null | undefined,
      exhausted: boolean | undefined,
      clarification:
        | { question: string; options: string[]; optionActions?: Array<"repeat_origin" | "search_nearby">; searchPresentation?: ChatMessage["searchPresentation"]; suburb?: string | null }
        | undefined,
      sessionId: string,
      claimServed = false,
      nextSuburb?: string,
      queueSource?: "user" | "nearby",
    ) => {
      if (candidates.length === 0) {
        updateMessage(message.id, {
          continuationToken: continuationToken ?? null,
          prefetchedSearchResults: undefined,
          prefetchedContinuationToken: undefined,
          prefetchedExhausted: undefined,
          prefetchedClarification: undefined,
          prefetchedSuburb: undefined,
          showMoreStatus: "idle",
        }, sessionId);
        showDiscoveryExhaustedChoice(clarification, sessionId, {
          searchPresentation: message.searchPresentation,
          suburb: message.suburb,
        });
        return;
      }
      // Drop any incoming candidate already shown for this message (by listing URL
      // or normalised address) so a raced/duplicate continuation response can't
      // render duplicate cards. Defence-in-depth alongside the in-flight guard.
      const existingResults = message.searchResults ?? [];
      const seenKeys = new Set<string>();
      for (const existing of existingResults) {
        const url = existing.listingUrl?.trim().toLowerCase();
        if (url) seenKeys.add(url);
        const addrKey = normaliseAddressKey(existing.address);
        if (addrKey) seenKeys.add(addrKey);
      }
      const dedupedCandidates = candidates.filter((candidate) => {
        const url = candidate.listingUrl?.trim().toLowerCase();
        const addrKey = normaliseAddressKey(candidate.address);
        if ((url && seenKeys.has(url)) || (addrKey && seenKeys.has(addrKey))) return false;
        if (url) seenKeys.add(url);
        if (addrKey) seenKeys.add(addrKey);
        return true;
      });
      if (dedupedCandidates.length === 0) {
        // Response carried only already-shown listings (e.g. a duplicate/raced
        // request). Don't end browsing — just refresh the token so the next tap
        // can fetch genuinely new cards.
        updateMessage(message.id, {
          continuationToken: continuationToken ?? null,
          prefetchedSearchResults: undefined,
          prefetchedContinuationToken: undefined,
          prefetchedExhausted: undefined,
          prefetchedClarification: undefined,
          prefetchedSuburb: undefined,
          showMoreStatus: "idle",
        }, sessionId);
        return;
      }
      // Nearby "train" advanced to a new suburb — show a brief one-line note
      // before the new cards so the suburb change is obvious.
      const advancedSuburb =
        nextSuburb && message.suburb && nextSuburb.toLowerCase() !== message.suburb.toLowerCase()
          ? nextSuburb
          : undefined;
      if (advancedSuburb) {
        // User-named suburbs ("St Heliers or Kohimarama") read as a continuation
        // of their request; LLM-suggested ones read as "nearby".
        const handoffKey = queueSource === "user" ? "search.now_showing" : "search.now_showing_nearby";
        addMessage({ role: "assistant", content: t(handoffKey, { suburb: advancedSuburb }), type: "text" }, sessionId);
      }
      const firstNewResultIndex = message.searchResults?.length ?? 0;
      const nextResults = [...existingResults, ...dedupedCandidates];
      if (claimServed) {
        void claimDiscoveryCandidates(message.continuationToken, dedupedCandidates);
      }
      pendingSearchScrollTargetRef.current = { messageId: message.id, index: firstNewResultIndex };
      updateMessage(message.id, {
        searchResults: nextResults,
        scrollToSearchResultIndex: firstNewResultIndex,
        continuationToken: continuationToken ?? null,
        ...(nextSuburb ? { suburb: nextSuburb } : {}),
        prefetchedSearchResults: undefined,
        prefetchedContinuationToken: undefined,
        prefetchedExhausted: undefined,
        prefetchedClarification: undefined,
        prefetchedSuburb: undefined,
        showMoreStatus: exhausted ? "idle" : "idle",
      }, sessionId);
      if (message.searchPresentation !== "generic_listing") {
        startCardScorePoll(dedupedCandidates.map((c) => ({ address: c.address, listingUrl: c.listingUrl })), sessionId);
      }
    },
    [addMessage, claimDiscoveryCandidates, showDiscoveryExhaustedChoice, startCardScorePoll, t, updateMessage],
  );

  const handleShowMore = useCallback(
    async (message: ChatMessage) => {
      const sessionId = currentSessionId ?? currentSession?.id;
      if (!sessionId) return;
      // Drop the tap if this message already has a "show more" in flight — the
      // button's disabled state only takes effect after an async re-render, so
      // rapid taps could otherwise fire concurrent same-token requests.
      if (showMoreInFlightRef.current.has(message.id)) return;
      showMoreInFlightRef.current.add(message.id);
      // Show the processing state immediately on tap — before any branch — so the
      // button never looks stuck while a slow nearby re-scrape runs in the
      // background. Reset in the finally; the append paths set their own final state.
      updateMessage(message.id, { showMoreStatus: "loading" }, sessionId);
      try {
        const prefetched = message.prefetchedSearchResults ?? [];
        if (prefetched.length > 0 || message.prefetchedExhausted) {
          appendContinuationCandidates(
            message,
            prefetched,
            message.prefetchedContinuationToken,
            message.prefetchedExhausted,
            message.prefetchedClarification,
            sessionId,
            true,
            message.prefetchedSuburb,
            message.prefetchedQueueSource,
          );
          return;
        }
        if (!message.continuationToken) {
          // No continuation token means the immediate pool for this suburb drained
          // and no nearby-suburb queue was seeded (e.g. the first page already
          // filled, so the backend never set up the train). Rather than dead-ending
          // the button, fire the same nearby-expansion discovery that typing
          // "show more" / tapping "Search nearby" runs — it re-scrapes adjacent
          // suburbs and appends a fresh result set.
          await handleSendRef.current?.(
            "[discovery_exhausted_choice:search_nearby]",
            false,
            message.searchPresentation,
            message.suburb,
            t("search.show_more"),
          );
          return;
        }
        // A thrown fetch (network failure) is a transient error, same as a 5xx.
        const data = await fetchDiscoveryNext(message, 3).catch((): DiscoveryNextError => ({ error: "transient" }));
        if (!data) {
          return;
        }
        if (isDiscoveryNextError(data)) {
          if (data.error === "expired") {
            // The continuation can't be resumed (expired / another session).
            // Drop the dead token so we stop hammering it, and surface the same
            // "see again / search nearby" choice the user would get on a normal
            // pool drain — never a silent revert.
            updateMessage(message.id, { continuationToken: null }, sessionId);
            showDiscoveryExhaustedChoice(undefined, sessionId, {
              searchPresentation: message.searchPresentation,
              suburb: message.suburb,
            });
          } else {
            // Transient: keep the token so the next tap retries, and tell the user.
            addMessage({ role: "assistant", content: t("search.show_more_retry"), type: "text" }, sessionId);
          }
          return;
        }
        appendContinuationCandidates(
          message,
          data.candidates ?? [],
          data.continuationToken,
          data.exhausted,
          data.clarification,
          sessionId,
          false,
          data.suburb,
          data.queueSource,
        );
      } finally {
        showMoreInFlightRef.current.delete(message.id);
        // Clear the processing state. The append paths replace the message with
        // its own final state (idle); this covers the tokenless nearby dispatch
        // and early returns so the button never stays stuck on the spinner.
        updateMessage(message.id, { showMoreStatus: "idle" }, sessionId);
      }
    },
    [addMessage, appendContinuationCandidates, currentSession?.id, currentSessionId, fetchDiscoveryNext, showDiscoveryExhaustedChoice, updateMessage, t],
  );

  useEffect(() => {
    const sessionId = currentSessionId ?? currentSession?.id;
    if (!sessionId) return;
    for (const message of currentSession?.messages ?? []) {
      if (message.type !== "search") continue;
      if (!message.continuationToken) continue;
      if (message.prefetchedSearchResults?.length || message.prefetchedExhausted || message.showMoreStatus === "loading") continue;
      void prefetchDiscoveryNext(message, sessionId);
    }
  }, [currentSession?.id, currentSession?.messages, currentSessionId, prefetchDiscoveryNext]);

  const maybeTriggerAppRatingPrompt = useCallback(
    async (kind: "chat" | "report", messageKey: string) => {
      if (Platform.OS === "web" || !user?.id) return;
      const state = await readAppRatingState(user.id);
      if (state.completed || state.lastTriggeredMessageKey === messageKey) return;

      const chatCompletions = (state.chatCompletions ?? 0) + (kind === "chat" ? 1 : 0);
      const nextState: AppRatingState = {
        ...state,
        chatCompletions,
        lastTriggeredMessageKey: messageKey,
      };
      await writeAppRatingState(user.id, nextState);

      const promptCount = nextState.promptCount ?? 0;
      const lastPromptAt = nextState.lastPromptAt ?? 0;
      const snoozed = lastPromptAt > 0 && Date.now() - lastPromptAt < APP_RATING_SNOOZE_MS;
      const shouldPrompt = kind === "report" || chatCompletions >= APP_RATING_CHAT_THRESHOLD;
      if (!shouldPrompt || promptCount >= 2 || snoozed) return;

      await writeAppRatingState(user.id, {
        ...nextState,
        promptCount: promptCount + 1,
        lastPromptAt: Date.now(),
        completed: promptCount + 1 >= 2,
      });

      try {
        if (await StoreReview.hasAction()) {
          await StoreReview.requestReview();
        }
      } catch {}
    },
    [user?.id],
  );

  useEffect(() => {
    if (!currentSession?.id || currentSession.skipFirstTurnRating) return;
    const latest = currentSession.messages[currentSession.messages.length - 1];
    if (!latest || latest.role !== "assistant") return;
    const key = `${currentSession.id}:${latest.id}`;
    if (latest.type === "report" && latest.report) {
      void maybeTriggerAppRatingPrompt("report", key);
      return;
    }
    if (latest.type === "text" && latest.content.trim() && !latest.retryText) {
      void maybeTriggerAppRatingPrompt("chat", key);
    }
  }, [currentSession?.id, currentSession?.messages, currentSession?.skipFirstTurnRating, maybeTriggerAppRatingPrompt]);

  const trackBackgroundAnalyseJob = useCallback(
    async (jobId: string | null | undefined, sessionId: string, address: string) => {
      if (!jobId || !user?.id) return;
      await upsertBackgroundAnalyseJob({
        jobId,
        userId: user.id,
        sessionId,
        address,
        createdAt: Date.now(),
      });
    },
    [user?.id],
  );

  const trackBackgroundScreeningJob = useCallback(
    async (
      jobId: string | null | undefined,
      sessionId: string,
      query: string,
      presentation?: ChatMessage["searchPresentation"],
    ) => {
      if (!jobId || !user?.id) return;
      await upsertBackgroundScreeningJob({
        jobId,
        userId: user.id,
        sessionId,
        query,
        presentation,
        createdAt: Date.now(),
      });
    },
    [user?.id],
  );

  // JobIds whose terminal result has already been rendered this session. The
  // mount / AppState-active / 30s-interval triggers can otherwise race and render
  // the same completed job twice — and because the rendered message no longer
  // carries the loading bubble, the second render would append a duplicate.
  const resolvedBackgroundJobIdsRef = useRef<Set<string>>(new Set());

  const backgroundJobPollInFlightRef = useRef(false);
  const pollBackgroundAnalyseJobs = useCallback(async () => {
    if (!user?.id || backgroundJobPollInFlightRef.current) return;
    backgroundJobPollInFlightRef.current = true;
    try {
      const stored = await readBackgroundAnalyseJobs();
      const jobs = stored.filter((job) => job.userId === user.id);
      for (const job of jobs) {
        if (resolvedBackgroundJobIdsRef.current.has(job.jobId)) {
          await removeBackgroundAnalyseJob(job.jobId);
          continue;
        }
        try {
          const resp = await fetch(`${getApiBase()}/analyse/jobs/${job.jobId}`, {
            headers: getApiHeaders(),
          });
          if (!resp.ok) continue;
          const data = (await resp.json()) as {
            status: string;
            searchId?: string | null;
            historyCreatedAt?: string | null;
            report?: FeasibilityReport | null;
            reportGroup?: FeasibilityReportGroup | null;
            error?: string | null;
          };

          if (data.status === "completed") {
            await removeBackgroundAnalyseJob(job.jobId);
            resolvedBackgroundJobIdsRef.current.add(job.jobId);
            if (data.reportGroup && isFeasibilityReportGroup(data.reportGroup)) {
              const groupWithHistory = withGroupHistoryMetadata(data.reportGroup, data.searchId, data.historyCreatedAt);
              if (currentSessionId === job.sessionId) {
                setCurrentReportGroup(groupWithHistory);
              }
              replaceBackgroundAnalyseMessage(job.jobId, { role: "assistant", content: "", type: "report_group", reportGroup: groupWithHistory }, job.sessionId);
              for (const report of groupWithHistory.reports) {
                if (report.scores && report.address) {
                  updateCandidateScores({ [report.address]: report.scores }, job.sessionId);
                }
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
            } else if (data.report && data.report.scores) {
              const reportWithHistory = withHistoryMetadata(data.report, data.searchId, data.historyCreatedAt);
              if (currentSessionId === job.sessionId) {
                setCurrentReport(reportWithHistory);
              }
              replaceBackgroundAnalyseMessage(job.jobId, { role: "assistant", content: "", type: "report", report: reportWithHistory }, job.sessionId);
              if (reportWithHistory.scores && reportWithHistory.address) {
                updateCandidateScores({ [reportWithHistory.address]: reportWithHistory.scores }, job.sessionId);
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
            }
          } else if (data.status === "failed") {
            await removeBackgroundAnalyseJob(job.jobId);
            resolvedBackgroundJobIdsRef.current.add(job.jobId);
            replaceBackgroundAnalyseMessage(job.jobId, {
              role: "assistant",
              type: "text",
              content: data.error || t("search.cant_reach"),
              retryText: job.address,
            }, job.sessionId);
          }
        } catch {
          // The next foreground/resume poll will try again.
        }
      }
    } finally {
      backgroundJobPollInFlightRef.current = false;
    }
  }, [
    bumpSearchHistory,
    currentSessionId,
    getApiBase,
    getApiHeaders,
    replaceBackgroundAnalyseMessage,
    refreshProfile,
    setCurrentReport,
    setCurrentReportGroup,
    t,
    updateCandidateScores,
    user?.id,
  ]);

  const renderBackgroundScreeningResult = useCallback(
    (job: BackgroundScreeningJob, result: unknown) => {
      const data = result && typeof result === "object"
        ? result as { content?: string; mode?: string }
        : null;
      if (!data) {
        replaceBackgroundAnalyseMessage(job.jobId, {
          role: "assistant",
          type: "text",
          content: t("search.cant_reach"),
          retryText: job.query,
        }, job.sessionId);
        return;
      }

      if (data.mode === "clarification") {
        try {
          const parsed = JSON.parse(data.content ?? "{}") as {
            clarificationType?: string;
            question?: string;
            options?: string[];
            optionActions?: Array<"repeat_origin" | "search_nearby">;
            searchPresentation?: ChatMessage["searchPresentation"];
            suburb?: string | null;
          };
          if (parsed.clarificationType === "subdivision" && Array.isArray(parsed.options) && parsed.options.length > 0) {
            replaceBackgroundAnalyseMessage(job.jobId, {
              role: "assistant",
              type: "subdivision_clarification",
              content: "",
              clarification: { question: parsed.question || t("search.which_lot"), options: parsed.options },
            }, job.sessionId);
            return;
          }
          if (parsed.clarificationType === "address" && Array.isArray(parsed.options)) {
            replaceBackgroundAnalyseMessage(job.jobId, {
              role: "assistant",
              type: "address_clarification",
              content: "",
              clarification: { question: parsed.question || t("search.confirm_address_intro"), options: parsed.options },
            }, job.sessionId);
            return;
          }
          if (parsed.clarificationType === "discovery_exhausted" && Array.isArray(parsed.options)) {
            replaceBackgroundAnalyseMessage(job.jobId, {
              role: "assistant",
              type: "discovery_exhausted_choice",
              content: "",
              clarification: {
                question: parsed.question || t("search.no_listings_msg"),
                options: parsed.options,
                optionActions: parsed.optionActions,
              },
              searchPresentation: parsed.searchPresentation ?? job.presentation,
              suburb: parsed.suburb ?? undefined,
            }, job.sessionId);
            return;
          }
        } catch {
        }
        replaceBackgroundAnalyseMessage(job.jobId, {
          role: "assistant",
          type: "text",
          content: data.content || t("search.could_clarify"),
          retryText: job.query,
        }, job.sessionId);
        return;
      }

      if (data.mode === "discover") {
        try {
          const parsed = extractJSON(data.content ?? "{}") as {
            candidates?: PropertyCandidate[];
            aiIntro?: string;
            searchPresentation?: ChatMessage["searchPresentation"];
            suburb?: string;
            continuationToken?: string | null;
            tenureOffer?: { suburb?: string; entries?: Array<{ tenure: "cross_lease" | "leasehold" | "unit_title"; count: number }> };
          };
          if (Array.isArray(parsed.candidates) && parsed.candidates.length > 0) {
            const searchPresentation = parsed.searchPresentation === "generic_listing" ? "generic_listing" : "scored_screening";
            replaceBackgroundAnalyseMessage(job.jobId, {
              role: "assistant",
              type: "search",
              searchResults: parsed.candidates,
              content: "",
              aiIntro: parsed.aiIntro ?? "",
              searchPresentation,
              suburb: parsed.suburb,
              continuationToken: parsed.continuationToken ?? null,
            }, job.sessionId);
            const tenureChip = buildTenureOfferChipMessage(parsed, searchPresentation, t);
            if (tenureChip) addMessage(tenureChip, job.sessionId);
            if (searchPresentation !== "generic_listing") {
              startCardScorePoll(
                parsed.candidates.map((candidate) => ({ address: candidate.address, listingUrl: candidate.listingUrl })),
                job.sessionId,
              );
            }
            return;
          }
          replaceBackgroundAnalyseMessage(job.jobId, {
            role: "assistant",
            type: "text",
            content: parsed.aiIntro || t("search.no_listings_msg"),
            retryText: job.query,
          }, job.sessionId);
          return;
        } catch {
        }
      }

      replaceBackgroundAnalyseMessage(job.jobId, {
        role: "assistant",
        type: "text",
        content: data.content || t("search.cant_reach"),
        retryText: job.query,
      }, job.sessionId);
    },
    [addMessage, replaceBackgroundAnalyseMessage, startCardScorePoll, t],
  );

  const backgroundScreeningPollInFlightRef = useRef(false);
  const pollBackgroundScreeningJobs = useCallback(async () => {
    if (!user?.id || backgroundScreeningPollInFlightRef.current) return;
    backgroundScreeningPollInFlightRef.current = true;
    try {
      const stored = await readBackgroundScreeningJobs();
      const jobs = stored.filter((job) => job.userId === user.id);
      for (const job of jobs) {
        if (resolvedBackgroundJobIdsRef.current.has(job.jobId)) {
          await removeBackgroundScreeningJob(job.jobId);
          continue;
        }
        try {
          const resp = await fetch(`${getApiBase()}/screening/jobs/${job.jobId}`, {
            headers: getApiHeaders(),
          });
          if (!resp.ok) continue;
          const data = await resp.json() as {
            status: string;
            result?: unknown;
            error?: string | null;
          };

          if (data.status === "completed") {
            await removeBackgroundScreeningJob(job.jobId);
            resolvedBackgroundJobIdsRef.current.add(job.jobId);
            renderBackgroundScreeningResult(job, data.result);
          } else if (data.status === "failed") {
            await removeBackgroundScreeningJob(job.jobId);
            resolvedBackgroundJobIdsRef.current.add(job.jobId);
            replaceBackgroundAnalyseMessage(job.jobId, {
              role: "assistant",
              type: "text",
              content: data.error || t("search.cant_reach"),
              retryText: job.query,
            }, job.sessionId);
          }
        } catch {
          // The next foreground/resume poll will try again.
        }
      }
    } finally {
      backgroundScreeningPollInFlightRef.current = false;
    }
  }, [
    getApiBase,
    getApiHeaders,
    renderBackgroundScreeningResult,
    replaceBackgroundAnalyseMessage,
    t,
    user?.id,
  ]);

  useEffect(() => {
    if (!user?.id) return;
    void pollBackgroundAnalyseJobs();
    void pollBackgroundScreeningJobs();
    const jobReadySub = DeviceEventEmitter.addListener("projectAlpha:backgroundJobsReady", () => {
      void pollBackgroundAnalyseJobs();
      void pollBackgroundScreeningJobs();
    });
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void pollBackgroundAnalyseJobs();
        void pollBackgroundScreeningJobs();
      }
    });
    const intervalId = setInterval(() => {
      if (AppState.currentState === "active") {
        void pollBackgroundAnalyseJobs();
        void pollBackgroundScreeningJobs();
      }
    }, 30000);
    return () => {
      jobReadySub.remove();
      appStateSub.remove();
      clearInterval(intervalId);
    };
  }, [pollBackgroundAnalyseJobs, pollBackgroundScreeningJobs, user?.id]);

  const handleSend = useCallback(async (overrideText?: string, skipAnalyseDisclaimer = false, continuePresentation?: "generic_listing" | "scored_screening", discoveryChoiceSuburb?: string, displayText?: string) => {
    // Explore-by-suburb hand-off: the user typed a suburb in response to our
    // prompt, so screen that suburb for subdivision opportunities. Compose an
    // explicit subdivision-intent query (so /chat classifies it as scored
    // screening) while showing the user's bare suburb text in the bubble.
    if (pendingSuburbScreeningRef.current && overrideText === undefined) {
      const suburbReply = inputText.trim();
      if (suburbReply && !isLoading) {
        pendingSuburbScreeningRef.current = false;
        await handleSendRef.current?.(
          `Find properties with subdivision potential in ${suburbReply}`,
          skipAnalyseDisclaimer,
          "scored_screening",
          suburbReply,
          suburbReply,
        );
        return;
      }
    }
    const text = (overrideText !== undefined ? overrideText : inputText).trim();
    if (!text && !isLoading) return;
    if (isLoading) return;
    const visibleText = (displayText ?? text).trim();
    const detectedMode = detectClientMode(text);
    if (!user && detectedMode === "analyse") {
      await promptSignInForAnalysis({ type: "send", text });
      return;
    }
    if (!skipAnalyseDisclaimer && detectedMode === "analyse" && shouldShowAnalyseDisclaimer()) {
      openAnalyseDisclaimer({ type: "send", text });
      return;
    }

    const sessionIdEarly = currentSessionId ?? createSession();
    const pendingAddressPick = [...(currentSession?.messages ?? [])]
      .reverse()
      .find((m) => m.type === "address_clarification" && (m.clarification?.options?.length ?? 0) > 0);
    if (pendingAddressPick?.clarification?.options?.[0] && isBareAffirmativeReply(text)) {
      await handleAnalyseRef.current?.(pendingAddressPick.clarification.options[0]);
      return;
    }

    setInputText("");
    inputRef.current?.clear();
    Keyboard.dismiss();

    const sessionId = sessionIdEarly;
    addMessage({ role: "user", content: visibleText, type: "text" }, sessionId);
    setIsLoading(true);

    const lowerText = text.toLowerCase();
    // Client-side keyword gate for first-time "find me a professional" requests.
    // The "change the current provider" case is handled purely by the LLM signal
    // (llmWantsAnotherProvider) so no trigger words are hardcoded for that path.
    const isExplicitRecommendationRequest =
      user?.role === "general" &&
      RECOMMENDATION_KEYWORDS.some((kw) => lowerText.includes(kw));

    // Captures the LLM-derived recommendation signals from the /chat response so
    // the finally block can trigger /recommendations/check even when the keyword
    // list above doesn't match (e.g. Chinese, nuanced phrasing).
    let llmWantsRecommendation = false;
    let llmWantsAnotherProvider = false;
    let llmSuggestedDiscipline: string | null = null;

    addMessage({ role: "assistant", content: "", type: "loading", loadingMode: detectedMode as any }, sessionId);

    // Fire-and-forget: classify whether this is an area-wide subdivision sweep
    // ("what's subdividable in orakei", "找北岸有什么可分割的"). The LLM-driven
    // endpoint returns in ~1-2 s, well before the heavy discovery work
    // finishes, so the loading bubble can honestly tell the user this kind of
    // search usually takes 1-5 min. Failures are silent — the bubble just
    // shows the normal spinner if the classifier never responds.
    if (detectedMode !== "analyse") {
      (async () => {
        try {
          const hintHistory = [
            ...(currentSession?.messages ?? [])
              .filter((m) => m.type === "text")
              .slice(-5)
              .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            { role: "user" as const, content: text },
          ];
          const ctrl = new AbortController();
          const timeout = setTimeout(() => ctrl.abort(), 10_000);
          const resp = await fetch(`${getApiBase()}/loading-hint/check`, {
            method: "POST",
            headers: getApiHeaders(),
            body: JSON.stringify({ messages: hintHistory }),
            signal: ctrl.signal,
          }).finally(() => clearTimeout(timeout));
          if (!resp.ok) return;
          const data = await resp.json() as { loadingHint?: LoadingHint | null };
          if (!data?.loadingHint) return;
          // Only attach the hint if the loading bubble is still showing — if
          // the main response already replaced it, dropping the hint is the
          // right call.
          updateLastMessageIfType("loading", { loadingHint: data.loadingHint }, sessionId);
        } catch {
          // Silent — the hint is informational only.
        }
      })();
    }

    const currentReport =
      currentSession?.currentReport ??
      [...(currentSession?.messages ?? [])].reverse().find((m) => m.type === "report" && m.report)?.report;
    const currentReportContext = currentSession?.currentReportGroup ?? currentReport;
    const agentAddress = resolveReportAddress(currentReport);
    const selectedListingContext =
      currentReport?.selectedListingContext ??
      ((currentReport?.propertyOverview as any)?.selectedListingContext as SelectedListingContext | undefined) ??
      null;
    const isPackageAnalysisRequest = isCombinedPackageAnalyseRequest(text);
    const shouldLookupListingAgent =
      user?.role === "general" &&
      !!agentAddress &&
      !isPackageAnalysisRequest;

    if (shouldLookupListingAgent) {
      try {
        const conversationHistory = [
          ...(currentSession?.messages ?? [])
            .filter((m) => m.type === "text")
            .slice(-5)
            .map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: text },
        ];
        const agentCtrl = new AbortController();
        const agentTimer = setTimeout(() => agentCtrl.abort(), 30_000);
        const resp = await fetch(`${getApiBase()}/agent-contact/lookup`, {
          method: "POST",
          headers: getApiHeaders(),
          body: JSON.stringify({
            address: agentAddress,
            messages: conversationHistory,
            listingUrl: selectedListingContext?.listingUrl ?? ((currentReport?.propertyOverview as any)?.listingUrl as string | undefined) ?? null,
            selectedListingContext,
          }),
          signal: agentCtrl.signal,
        }).finally(() => clearTimeout(agentTimer));

        if (resp.status === 402) {
          setShowPaywall(true);
          updateLastMessage({ type: "text", content: t("search.usage_used_upgrade") }, sessionId);
          return;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const data = await resp.json() as {
          wantsAgentContact: boolean;
          found?: boolean;
          isListed?: boolean;
          agentName?: string | null;
          agentPhone?: string | null;
          agencyName?: string | null;
          agentAvatarUrl?: string | null;
          matchType?: "subject" | "suburb" | null;
          listingAddress?: string | null;
          listingUrl?: string | null;
        };

        if (!data.wantsAgentContact) {
          // Not an agent-contact request; keep the normal chat flow running.
        } else if (data.found && data.isListed && (data.agentPhone || data.listingUrl)) {
          updateLastMessage({
            role: "assistant",
            content: "",
            type: "agent_contact",
            agentName: data.agentName ?? null,
            agentPhone: data.agentPhone ?? null,
            agencyName: data.agencyName ?? null,
            agentAvatarUrl: data.agentAvatarUrl ?? null,
            propertyAddress: data.listingAddress ?? agentAddress,
            agentMatchType: data.matchType ?? "subject",
            agentListingUrl: data.listingUrl ?? null,
          }, sessionId);
          setIsLoading(false);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        } else {
          updateLastMessage({
            type: "text",
            content: data.isListed === false
              ? t("bubble.agent.not_on_market", { address: agentAddress.split(",")[0] ?? agentAddress })
              : t("bubble.agent.no_callable"),
          }, sessionId);
          setIsLoading(false);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          return;
        }
      } catch (err) {
        // Network error on the pre-flight agent-contact check. We don't know
        // whether the user wanted agent info or not, so don't short-circuit
        // with an agent-specific error — fall through to the main chat call
        // so the LLM can handle the question normally.
        console.log("Agent contact lookup failed (falling through to chat):", err);
      }
    }

    /** Chat-driven feasibility runs can exceed 3 minutes; OS may suspend the app in background. */
    const isLongRunningAnalyseChat =
      detectedMode === "analyse" ||
      isLongRunningSubdivisionDiscover(text, detectedMode);
    const MAX_RETRIES = 5;
    const CHAT_TIMEOUT_MS = 200_000;
    const ANALYSE_CHAT_TIMEOUT_MS = 420_000;
    const SUBDIVISION_DISCOVER_TIMEOUT_MS = 600_000;
    const TIMEOUT_MS = isLongRunningSubdivisionDiscover(text, detectedMode)
      ? SUBDIVISION_DISCOVER_TIMEOUT_MS
      : isLongRunningAnalyseChat
        ? ANALYSE_CHAT_TIMEOUT_MS
        : CHAT_TIMEOUT_MS;

    const currentMessages = currentSession?.messages ?? [];
    const allMessages = [
      ...currentMessages
        .filter((m) => m.type === "text" || m.type === "report" || m.type === "report_group" || m.type === "search" || m.type === "agent_contact")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.type === "text"
            ? m.content
            : m.type === "report"
              ? `[Feasibility report for ${m.report?.address || "property"}]`
              : m.type === "report_group"
                ? `[Combined listing reports shown: ${(m.reportGroup?.reports ?? []).map((r) => r.address).join("; ")}]`
                : m.type === "agent_contact"
                  // Represent the completed agent lookup as a short assistant summary so the
                  // LLM knows this topic is already resolved and doesn't re-answer it on the
                  // next turn.
                  ? `[Listing agent contact card shown for ${m.propertyAddress ?? "the property"}: ${m.agentName ?? "agent details"}]`
                  : serializeSearchMessageForChat(m),
        })),
      { role: "user" as const, content: text },
    ];
    const headers = getApiHeaders();

    const useBackgroundAnalyse = detectedMode === "analyse" && Boolean(user) && Platform.OS !== "web";
    const useBackgroundScreening = detectedMode === "discover" && Boolean(user) && Platform.OS !== "web";

    // Warms the backend in case it's cold-starting. Pings /healthz repeatedly
    // (short timeout per ping) until it responds OK or we give up. Returns true
    // if the service responded, false otherwise.
    const warmUpService = async (maxWaitMs: number = 45_000): Promise<boolean> => {
      const start = Date.now();
      let pingAttempt = 0;
      while (Date.now() - start < maxWaitMs) {
        pingAttempt++;
        try {
          const c = new AbortController();
          const t = setTimeout(() => c.abort(), 5_000);
          const r = await fetch(`${getApiBase()}/healthz`, { method: "GET", signal: c.signal });
          clearTimeout(t);
          if (r.ok) return true;
        } catch {
          // ignore and retry
        }
        await new Promise<void>((res) => setTimeout(res, Math.min(3000, 1000 + pingAttempt * 500)));
      }
      return false;
    };

    try {
      if (useBackgroundScreening) {
        try {
          const qCtrl = new AbortController();
          const qT = setTimeout(() => qCtrl.abort(), 60_000);
          const r = await fetch(`${getApiBase()}/screening/jobs`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              messages: allMessages,
              currentReport: currentReportContext,
              continuePresentation,
              discoveryChoiceSuburb,
            }),
            signal: qCtrl.signal,
          });
          clearTimeout(qT);

          if (r.status === 401) {
            updateLastMessage({ type: "text", content: t("search.session_expired") }, sessionId);
            return;
          }
          if (r.status === 202) {
            const queued = await r.json().catch(() => ({} as { jobId?: string }));
            await trackBackgroundScreeningJob(queued.jobId, sessionId, text, continuePresentation);
            updateLastMessage({
              type: "loading",
              content: "",
              loadingMode: "discover",
              retryLabel: t("search.screening_background"),
              backgroundJobId: queued.jobId,
            }, sessionId);
            return;
          }
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }
        } catch {
          // Fall through to the existing foreground path if queueing is unavailable.
        }
      }

      if (useBackgroundAnalyse) {
        try {
          const qCtrl = new AbortController();
          const qT = setTimeout(() => qCtrl.abort(), 60_000);
          const r = await fetch(`${getApiBase()}/analyse`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              address: text,
              conversationHistory: allMessages,
              async: true,
            }),
            signal: qCtrl.signal,
          });
          clearTimeout(qT);

          if (r.status === 402) {
            const err = await r.json().catch(() => ({} as { error?: string }));
            updateLastMessage({ type: "text", content: (err as { error?: string })?.error || t("search.usage_used_upgrade") }, sessionId);
            setShowPaywall(true);
            return;
          }
          if (r.status === 401) {
            updateLastMessage({ type: "text", content: t("search.session_expired") }, sessionId);
            return;
          }
          if (r.status === 202) {
            const queued = await r.json().catch(() => ({} as { jobId?: string }));
            await trackBackgroundAnalyseJob(queued.jobId, sessionId, text);
            updateLastMessage({
              type: "loading",
              content: "",
              loadingMode: "analyse",
              retryLabel: t("search.analyse_background"),
              backgroundJobId: queued.jobId,
            }, sessionId);
            return;
          }
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }

          const data = (await r.json()) as {
            report?: FeasibilityReport;
            reportGroup?: FeasibilityReportGroup;
            type: string;
            searchId?: string | null;
            historyCreatedAt?: string | null;
            clarificationType?: string;
            question?: string;
            options?: string[];
            optionActions?: Array<"repeat_origin" | "search_nearby">;
            searchPresentation?: ChatMessage["searchPresentation"];
            suburb?: string | null;
          };

          if (data.type === "clarification" && data.clarificationType === "subdivision" && Array.isArray(data.options) && data.options.length > 0) {
            updateLastMessage({
              type: "subdivision_clarification",
              content: "",
              clarification: { question: data.question || t("search.which_lot"), options: data.options },
            }, sessionId);
            return;
          }
          if (data.type === "clarification" && data.clarificationType === "address" && Array.isArray(data.options)) {
            updateLastMessage({
              type: "address_clarification",
              content: "",
              clarification: { question: data.question || t("search.confirm_address_intro"), options: data.options },
            }, sessionId);
            return;
          }
          if (data.type === "clarification" && data.clarificationType === "discovery_exhausted" && Array.isArray(data.options)) {
            updateLastMessage({
              type: "discovery_exhausted_choice",
              content: "",
              clarification: { question: data.question || t("search.no_listings_msg"), options: data.options, optionActions: data.optionActions },
              searchPresentation: data.searchPresentation,
              suburb: data.suburb ?? undefined,
            }, sessionId);
            return;
          }
          if (data.reportGroup && isFeasibilityReportGroup(data.reportGroup)) {
            const groupWithHistory = withGroupHistoryMetadata(data.reportGroup, data.searchId, data.historyCreatedAt);
            setCurrentReportGroup(groupWithHistory);
            updateLastMessage({ type: "report_group", reportGroup: groupWithHistory, content: "" }, sessionId);
            for (const report of groupWithHistory.reports) {
              if (report.scores && report.address) {
                updateCandidateScores({ [report.address]: report.scores }, sessionId);
              }
            }
            refreshProfile().catch(() => {});
            bumpSearchHistory();
            return;
          }
          if (data.report && data.report.scores) {
            const reportWithHistory = withHistoryMetadata(data.report, data.searchId, data.historyCreatedAt);
            setCurrentReport(reportWithHistory);
            updateLastMessage({ type: "report", report: reportWithHistory, content: "" }, sessionId);
            if (reportWithHistory.scores && reportWithHistory.address) {
              updateCandidateScores({ [reportWithHistory.address]: reportWithHistory.scores }, sessionId);
            }
            refreshProfile().catch(() => {});
            bumpSearchHistory();
            return;
          }
          updateLastMessage({ type: "text", content: t("search.could_clarify"), retryText: text }, sessionId);
        } catch {
          updateLastMessage({ type: "text", content: t("search.cant_reach"), retryText: text }, sessionId);
        }
        return;
      }

      let lastErr: any = null;
      let attempt = 0;
      // Feasibility-via-chat uses the same long retry strategy as /analyse so
      // backgrounding or locking the device does not exhaust a small retry budget.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt++;
        if (attempt > 1) {
          const isRetryableLast = lastErr?.name === "AbortError" || lastErr?.isServerError || lastErr?.isNetworkError;
          if (isRetryableLast) {
            updateLastMessage({
              type: "loading",
              content: "",
              loadingMode: detectedMode as "analyse" | "discover" | "followup",
              retryLabel: t("search.waking"),
            }, sessionId);
            const woke = await warmUpService();
            if (!woke) {
              if (!isLongRunningAnalyseChat) {
                break;
              }
              const backoffMs = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)));
              await new Promise<void>((r) => setTimeout(r, backoffMs));
              updateLastMessage({
                type: "loading",
                content: "",
                loadingMode: "analyse",
              }, sessionId);
            }
          }
          updateLastMessage({
            type: "loading",
            content: "",
            loadingMode: detectedMode as "analyse" | "discover" | "followup",
            retryLabel:
              !isLongRunningAnalyseChat && attempt >= MAX_RETRIES
                ? t("search.still_fetching")
                : t("search.fetching"),
          }, sessionId);
          await new Promise<void>((r) => setTimeout(r, 1500));
        }

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

          const resp = await fetch(`${getApiBase()}/chat`, {
            method: "POST",
            headers,
            body: JSON.stringify({ messages: allMessages, currentReport: currentReportContext, continuePresentation, discoveryChoiceSuburb }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!resp.ok) {
            const err = (await resp.json()) as { error?: string; code?: string; message?: string };
            if (resp.status === 401 && err.code === "AUTH_REQUIRED" && !user) {
              updateLastMessage({ type: "text", content: err.message || t("guest_analysis.body") }, sessionId);
              setIsLoading(false);
              await promptSignInForAnalysis({ type: "send", text });
              return;
            }
            if (resp.status === 429 && err.code === "GUEST_LIMIT_REACHED") {
              updateLastMessage({ type: "text", content: err.message || t("guest_analysis.limit") }, sessionId);
              setIsLoading(false);
              return;
            }
            if (resp.status === 429 && err.error === "monthly_limit_reached") {
              const isUpgrade = err.code === "upgrade_required";
              setMessageLimitReached(true);
              updateLastMessage({
                type: "text",
                content: isUpgrade
                  ? t("search.usage_limit_short")
                  : t("search.usage_limit_short_free"),
              }, sessionId);
              if (isUpgrade) setShowPaywall(true);
              setIsLoading(false);
              return;
            }
            throw Object.assign(new Error(err.error || "Server error"), { isServerError: true, statusCode: resp.status });
          }

          // Always read as text first, then parse — avoids issues where resp.json()
          // fails on responses with leading whitespace (heartbeat spaces) and consumes
          // the body stream before any fallback can read it.
          const responseText = await resp.text();
          let data: {
            content: string;
            mode: string;
            searchId?: string | null;
            historyCreatedAt?: string | null;
            wantsProviderRecommendation?: boolean;
            wantsAnotherProvider?: boolean;
            suggestedDiscipline?: string | null;
          };
          try {
            data = JSON.parse(responseText.trim()) as typeof data;
          } catch {
            // Body may itself be a raw feasibility report or discover payload
            const fallback = extractJSON(responseText) as { content?: string; mode?: string } | null;
            data = { content: fallback?.content ?? responseText, mode: fallback?.mode ?? "" };
          }

          // Capture LLM-derived provider recommendation signals for use in finally.
          if (data.wantsProviderRecommendation && user?.role === "general") {
            llmWantsRecommendation = true;
            llmSuggestedDiscipline = data.suggestedDiscipline ?? null;
          }
          if (data.wantsAnotherProvider && user?.role === "general") {
            llmWantsAnotherProvider = true;
            llmWantsRecommendation = true;
          }
          // Both first-time recommendation and "change provider" suppress LLM text —
          // the finally block shows the provider card directly.
          if ((data.wantsProviderRecommendation || data.wantsAnotherProvider) && user?.role === "general") {
            updateLastMessage({ type: "text", content: "" }, sessionId);
            return;
          }

          // Helper: check if a parsed object looks like a feasibility report
          const isFeasibilityReport = (p: unknown): p is FeasibilityReport =>
            !!p && typeof p === "object" && ("scores" in (p as object) || "address" in (p as object));

          // Universal JSON-content guard — regardless of `mode`, if the content
          // contains a JSON object/array, try to interpret it as a structured
          // result. This prevents raw JSON from ever leaking into the chat as
          // visible text.
          const rawContent = data.content ?? "";
          const trimmed = rawContent.trim();
          const hasJsonShape = /\{[\s\S]*\}|\[[\s\S]*\]/.test(trimmed);
          const maybeParsed = hasJsonShape
            ? (extractJSON(trimmed) as
                | { candidates?: PropertyCandidate[]; isMockData?: boolean; noListings?: boolean; aiIntro?: string; searchPresentation?: ChatMessage["searchPresentation"]; suburb?: string; continuationToken?: string | null }
                | FeasibilityReportGroup
                | null)
            : null;

          if (data.mode === "clarification") {
            try {
              const parsed = JSON.parse(data.content) as { clarificationType?: string; question: string; options: string[]; optionActions?: Array<"repeat_origin" | "search_nearby">; searchPresentation?: ChatMessage["searchPresentation"]; suburb?: string | null };
              if (parsed.clarificationType === "subdivision" && Array.isArray(parsed.options) && parsed.options.length > 0) {
                updateLastMessage({
                  type: "subdivision_clarification",
                  content: "",
                  clarification: { question: parsed.question, options: parsed.options },
                }, sessionId);
                return;
              }
              if (parsed.clarificationType === "address" && Array.isArray(parsed.options)) {
                updateLastMessage({
                  type: "address_clarification",
                  content: "",
                  clarification: {
                    question: parsed.question || t("search.confirm_address_intro"),
                    options: parsed.options,
                  },
                }, sessionId);
                return;
              }
              if (parsed.clarificationType === "discovery_exhausted" && Array.isArray(parsed.options)) {
                updateLastMessage({
                  type: "discovery_exhausted_choice",
                  content: "",
                  clarification: {
                    question: parsed.question || t("search.no_listings_msg"),
                    options: parsed.options,
                    optionActions: parsed.optionActions,
                  },
                  // Carry the originating search's context so the chip tap can
                  // piggyback the screening intent + current suburb back to /chat.
                  searchPresentation: parsed.searchPresentation,
                  suburb: parsed.suburb ?? undefined,
                }, sessionId);
                return;
              }
              updateLastMessage({ type: "text", content: parsed.question || t("search.could_clarify") }, sessionId);
            } catch {
              updateLastMessage({ type: "text", content: data.content || t("search.could_clarify") }, sessionId);
            }
            return;
          }
          if (data.mode === "analyse") {
            if (isFeasibilityReportGroup(maybeParsed)) {
              const groupObj = withGroupHistoryMetadata(maybeParsed, data.searchId, data.historyCreatedAt);
              setCurrentReportGroup(groupObj);
              updateLastMessage({ type: "report_group", reportGroup: groupObj, content: "" }, sessionId);
              for (const report of groupObj.reports) {
                if (report.scores && report.address) {
                  updateCandidateScores({ [report.address]: report.scores }, sessionId);
                }
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
            } else if (maybeParsed && isFeasibilityReport(maybeParsed)) {
              const reportObj = withHistoryMetadata(maybeParsed as unknown as FeasibilityReport, data.searchId, data.historyCreatedAt);
              setCurrentReport(reportObj);
              updateLastMessage({ type: "report", report: reportObj, content: "" }, sessionId);
              if (reportObj.scores && reportObj.address) {
                updateCandidateScores({ [reportObj.address]: reportObj.scores }, sessionId);
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
            } else {
              updateLastMessage({ type: "text", content: sanitizeForDisplay(rawContent, t("search.format_error")) }, sessionId);
            }
          } else if (data.mode === "discover") {
            const searchPayload = !isFeasibilityReportGroup(maybeParsed) ? maybeParsed : null;
            const aiIntro = searchPayload?.aiIntro ?? "";
            if (searchPayload?.candidates && searchPayload.candidates.length > 0) {
              const searchPresentation = searchPayload.searchPresentation === "generic_listing" ? "generic_listing" : "scored_screening";
              updateLastMessage({ type: "search", searchResults: searchPayload.candidates, content: "", aiIntro, searchPresentation, suburb: searchPayload.suburb, continuationToken: searchPayload.continuationToken ?? null }, sessionId);
              const tenureChip = buildTenureOfferChipMessage(searchPayload, searchPresentation, t);
              if (tenureChip) addMessage(tenureChip, sessionId);
              if (searchPresentation !== "generic_listing") {
                startCardScorePoll(searchPayload.candidates.map((c: PropertyCandidate) => ({ address: c.address, listingUrl: c.listingUrl })), sessionId);
              }
            } else {
              const noResultMsg = aiIntro || t("search.no_listings_msg");
              updateLastMessage({ type: "text", content: noResultMsg }, sessionId);
            }
          } else {
            // Mode is unknown / followup / text. If the payload looks like a
            // structured result, render it as such — otherwise treat as text
            // but always strip any JSON before displaying.
            if (isFeasibilityReportGroup(maybeParsed)) {
              const groupObj = withGroupHistoryMetadata(maybeParsed, data.searchId, data.historyCreatedAt);
              setCurrentReportGroup(groupObj);
              updateLastMessage({ type: "report_group", reportGroup: groupObj, content: "" }, sessionId);
              for (const report of groupObj.reports) {
                if (report.scores && report.address) {
                  updateCandidateScores({ [report.address]: report.scores }, sessionId);
                }
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
            } else if (isFeasibilityReport(maybeParsed)) {
              const reportObj = withHistoryMetadata(maybeParsed as unknown as FeasibilityReport, data.searchId, data.historyCreatedAt);
              setCurrentReport(reportObj);
              updateLastMessage({ type: "report", report: reportObj, content: "" }, sessionId);
              if (reportObj.scores && reportObj.address) {
                updateCandidateScores({ [reportObj.address]: reportObj.scores }, sessionId);
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
            } else {
              const searchPayload = !isFeasibilityReportGroup(maybeParsed) ? maybeParsed : null;
              if (searchPayload?.candidates && searchPayload.candidates.length > 0) {
                const searchPresentation = searchPayload.searchPresentation === "generic_listing" ? "generic_listing" : "scored_screening";
                updateLastMessage({ type: "search", searchResults: searchPayload.candidates, content: "", searchPresentation, suburb: searchPayload.suburb, continuationToken: searchPayload.continuationToken ?? null }, sessionId);
              } else if (hasJsonShape) {
                updateLastMessage({ type: "text", content: sanitizeForDisplay(rawContent, t("search.format_error")) }, sessionId);
              } else {
                updateLastMessage({ type: "text", content: rawContent }, sessionId);
              }
            }
          }
          return;
        } catch (err: any) {
          // Plain network failures (e.g. cold-start, DNS, dropped connection)
          // surface as TypeError. Tag them so the warm-up path triggers next loop.
          if (err && err.name === "TypeError" && !err.statusCode) {
            err.isNetworkError = true;
          }
          lastErr = err;
          // Retry on server errors, network errors, and timeouts; bail otherwise
          const isRetryable =
            err?.name === "AbortError" || err?.isServerError || err?.isNetworkError;
          if (!isRetryable) break;
          if (!isLongRunningAnalyseChat && attempt >= MAX_RETRIES) break;
        }
      }

      const isTimeout = lastErr?.name === "AbortError";
      const statusCode = lastErr?.statusCode;
      const finalContent =
        isTimeout
          ? t("search.slow_data")
          : statusCode === 402
            ? t("search.usage_used_upgrade")
            : statusCode === 401
              ? t("search.session_expired")
              : isLongRunningAnalyseChat
                ? t("search.slow_data")
                : t("search.cant_reach");
      if (statusCode === 402) setShowPaywall(true);
      updateLastMessage({ type: "text", content: finalContent, retryText: text }, sessionId);
    } finally {
      setIsLoading(false);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      refreshProfile().catch(() => {});

      // Fire the explicit /recommendations/check when:
      //   (a) keyword detection matched (fast, client-side), OR
      //   (b) the LLM detected provider recommendation intent in the chat response.
      // This covers English keywords, Chinese expressions, and nuanced phrasing alike.
      if (isExplicitRecommendationRequest || llmWantsRecommendation) {
        const reportSnapshot = currentReport;
        const capturedSessionId = sessionId;
        const capturedHeaders = headers;
        const capturedText = lowerText;

        // Discipline: prefer the LLM-derived discipline (semantically richer),
        // fall back to client-side keyword mapping for common English terms.
        const disciplineMap: [string, string][] = [
          ["architect", "architect_designer"],
          ["designer", "architect_designer"],
          ["planner", "planner"],
          ["engineer", "engineer"],
          ["quantity surveyor", "quantity_surveyor"],
          ["qs", "quantity_surveyor"],
        ];
        const keywordDiscipline =
          disciplineMap.find(([kw]) => capturedText.includes(kw))?.[1] ?? null;
        const preferredDiscipline = llmSuggestedDiscipline ?? keywordDiscipline;
        // For "change provider" the loading bubble is already cleared; no need to wait for animation.
        const providerCheckDelay = llmWantsAnotherProvider ? 200 : 1200;

        setTimeout(async () => {
          try {
            const apiBase = getApiBase();
            const freshMsgs = sessionMessagesRef.current;
            const resp = await fetch(`${apiBase}/recommendations/check`, {
              method: "POST",
              headers: capturedHeaders,
              body: JSON.stringify({
                report: reportSnapshot ?? {},
                conversationHistory: [],
                explicitRequest: true,
                askForOthers: llmWantsAnotherProvider,
                preferredDiscipline,
                excludeProviderIds: freshMsgs
                  .filter((m) => m.type === "provider_recommendation" && m.provider?.id)
                  .map((m) => m.provider!.id),
              }),
            });
            if (resp.status === 402) {
              addMessage({
                role: "assistant",
                content: "",
                type: "provider_upgrade_gate",
              }, capturedSessionId);
              setShowPaywall(true);
              return;
            }
            if (!resp.ok) return;
            const data = await resp.json() as {
              shouldRecommend: boolean;
              provider: ServiceProvider | null;
              intentType: string;
              upgradeRequired?: boolean;
              providersExhausted?: boolean;
            };
            if (data.shouldRecommend && data.provider && data.upgradeRequired) {
              addMessage({
                role: "assistant",
                content: "",
                type: "provider_upgrade_gate",
              }, capturedSessionId);
              setShowPaywall(true);
              return;
            }
            if (data.shouldRecommend && data.provider) {
              addProviderRecommendationOnce({
                sessionId: capturedSessionId,
                provider: data.provider,
                intentType: data.intentType,
                propertyAddress: resolveReportAddress(reportSnapshot as FeasibilityReport | undefined),
              });
            } else if (data.providersExhausted || (!data.shouldRecommend && !data.provider)) {
              addMessage({
                role: "assistant",
                content: t("recommendations.providers_busy"),
                type: "text",
              }, capturedSessionId);
            }
          } catch {}
        }, providerCheckDelay);
      }
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
    setCurrentReportGroup,
    setIsLoading,
    getApiBase,
    getApiHeaders,
    refreshProfile,
    bumpSearchHistory,
    trackBackgroundAnalyseJob,
    trackBackgroundScreeningJob,
    addProviderRecommendationOnce,
    shouldShowAnalyseDisclaimer,
    openAnalyseDisclaimer,
    promptSignInForAnalysis,
    user?.role,
    user?.subscriptionTier,
    user,
    t,
  ]);

  const handleFollowUp = useCallback(
    (question: string) => {
      void handleSend(question);
    },
    [handleSend],
  );

  // Exhausted-discovery choice chips ("see again" / "search nearby"). Unlike a
  // plain follow-up, these piggyback the originating search's presentation +
  // suburb so the backend keeps the screening intent (generic vs subdivision)
  // and the current suburb authoritative instead of re-deriving them.
  const handleDiscoveryChoice = useCallback(
    (message: ChatMessage, option: string, optionIndex: number) => {
      const action = message.clarification?.optionActions?.[optionIndex] ?? (optionIndex === 1 ? "search_nearby" : "repeat_origin");
      if (action === "include_tenures") {
        // Deterministic cross-lease/leasehold/unit-title opt-in — re-screens
        // exactly the listings we set aside, no free-text/LLM dependence.
        const tenures = message.tenureOfferTenures ?? ["cross_lease"];
        const command = `[discovery_include_tenures:${tenures.join(",")}]`;
        void handleSend(command, false, message.searchPresentation, message.suburb, option);
        return;
      }
      const command = action === "search_nearby"
        ? "[discovery_exhausted_choice:search_nearby]"
        : "[discovery_exhausted_choice:repeat_origin]";
      void handleSend(command, false, message.searchPresentation, message.suburb, option);
    },
    [handleSend],
  );

  const handleAnalyse = useCallback(
    async (
      address: string,
      selectedPhotoUrl?: string | null,
      selectedListingUrl?: string | null,
      selectedListingContext?: SelectedListingContext | null,
      skipAnalyseDisclaimer = false,
      analysisKey?: string,
      forceNewSession = false,
    ) => {
      if (isLoading) return;
      if (!user) {
        await promptSignInForAnalysis({ type: "analyse", address, selectedPhotoUrl, selectedListingUrl, selectedListingContext, analysisKey });
        return;
      }
      if (!skipAnalyseDisclaimer && shouldShowAnalyseDisclaimer()) {
        openAnalyseDisclaimer({ type: "analyse", address, selectedPhotoUrl, selectedListingUrl, selectedListingContext, analysisKey });
        return;
      }
      setInputText("");
      Keyboard.dismiss();
      setAnalysingPropertyKey(analysisKey ?? (selectedListingUrl || address).trim());

      const sessionId = forceNewSession ? createSession() : currentSessionId ?? createSession();

      addMessage({ role: "user", content: t("search.analyse_prefix", { address }), type: "text" }, sessionId);
      setIsLoading(true);
      addMessage({ role: "assistant", content: "", type: "loading", loadingMode: "analyse" }, sessionId);
      setTimeout(scrollToNewestMessage, 80);
      setTimeout(scrollToNewestMessage, 260);

      const currentMessages = forceNewSession ? [] : currentSession?.messages ?? [];
      const conversationHistory = currentMessages
        .filter((m) => m.type === "text" || m.type === "report" || m.type === "report_group")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.type === "text"
            ? m.content
            : m.type === "report_group"
              ? `[Combined listing reports for ${(m.reportGroup?.reports ?? []).map((r) => r.address).join("; ")}]`
              : `[Report for ${(m as any).report?.address ?? "property"}]`,
        }));

      // Resilient analyse loop — silently retries forever (with exponential
      // backoff, capped at 30s) until we either get a usable response or the
      // server tells us it's a terminal user-facing error (402 / 401).
      let attempt = 0;
      try {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          attempt++;
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 420_000);

            const resp = await fetch(`${getApiBase()}/analyse`, {
              method: "POST",
              headers: getApiHeaders(),
              body: JSON.stringify({
                address,
                conversationHistory,
                selectedListingUrl,
                selectedListingContext,
                async: Platform.OS !== "web",
              }),
              signal: controller.signal,
            });
            clearTimeout(timeoutId);

            if (resp.status === 202) {
              const queued = await resp.json().catch(() => ({} as { jobId?: string }));
              await trackBackgroundAnalyseJob(queued.jobId, sessionId, address);
              updateLastMessage({
                type: "loading",
                content: "",
                loadingMode: "analyse",
                retryLabel: t("search.analyse_background"),
                backgroundJobId: queued.jobId,
              }, sessionId);
              return;
            }

            if (resp.status === 402) {
              const err = await resp.json().catch(() => ({} as { error?: string }));
              updateLastMessage({ type: "text", content: (err as any)?.error || t("search.usage_used_upgrade") }, sessionId);
              setShowPaywall(true);
              return;
            }
            if (resp.status === 401) {
              updateLastMessage({ type: "text", content: t("search.session_expired") }, sessionId);
              return;
            }

            if (!resp.ok) {
              // Server error — fall through to the retry path
              throw new Error(`HTTP ${resp.status}`);
            }

            const data = (await resp.json()) as {
              report?: FeasibilityReport;
              reportGroup?: FeasibilityReportGroup;
              type: string;
              searchId?: string | null;
              historyCreatedAt?: string | null;
              clarificationType?: string;
              question?: string;
              options?: string[];
              optionActions?: Array<"repeat_origin" | "search_nearby">;
              searchPresentation?: ChatMessage["searchPresentation"];
              suburb?: string | null;
            };

            if (data.type === "clarification" && data.clarificationType === "subdivision" && Array.isArray(data.options) && data.options.length > 0) {
              updateLastMessage({
                type: "subdivision_clarification",
                content: "",
                clarification: { question: data.question || t("search.which_lot"), options: data.options },
              }, sessionId);
              return;
            }

            if (data.type === "clarification" && data.clarificationType === "address" && Array.isArray(data.options)) {
              updateLastMessage({
                type: "address_clarification",
                content: "",
                clarification: { question: data.question || t("search.confirm_address_intro"), options: data.options },
              }, sessionId);
              return;
            }
            if (data.type === "clarification" && data.clarificationType === "discovery_exhausted" && Array.isArray(data.options)) {
              updateLastMessage({
                type: "discovery_exhausted_choice",
                content: "",
                clarification: { question: data.question || t("search.no_listings_msg"), options: data.options, optionActions: data.optionActions },
                searchPresentation: data.searchPresentation,
                suburb: data.suburb ?? undefined,
              }, sessionId);
              return;
            }

            if (data.reportGroup && isFeasibilityReportGroup(data.reportGroup)) {
              const groupWithHistory = withGroupHistoryMetadata(data.reportGroup, data.searchId, data.historyCreatedAt);
              setCurrentReportGroup(groupWithHistory);
              updateLastMessage({ type: "report_group", reportGroup: groupWithHistory, content: "" }, sessionId);
              for (const report of groupWithHistory.reports) {
                if (report.scores && report.address) {
                  updateCandidateScores({ [report.address]: report.scores }, sessionId);
                }
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
              return;
            }

            if (data.report && data.report.scores) {
              const reportWithHistory = withHistoryMetadata(data.report, data.searchId, data.historyCreatedAt);
              const patchedReport: FeasibilityReport = (
                !data.report.photoUrl && selectedPhotoUrl
              ) ? { ...reportWithHistory, photoUrl: selectedPhotoUrl } : reportWithHistory;
              setCurrentReport(patchedReport);
              updateLastMessage({ type: "report", report: patchedReport, content: "" }, sessionId);
              if (patchedReport.scores && patchedReport.address) {
                updateCandidateScores({ [patchedReport.address]: patchedReport.scores }, sessionId);
              }
              refreshProfile().catch(() => {});
              bumpSearchHistory();
              return;
            }

            // Got a 200 but no report — treat as a transient generation miss
            // and keep trying so the user never sees a "failed" message.
            throw new Error("empty_report");
          } catch {
            // Keep loading indicator up; back off and retry.
            const backoffMs = Math.min(30_000, 1000 * Math.pow(2, Math.min(attempt - 1, 5)));
            await new Promise((r) => setTimeout(r, backoffMs));
            // Continue the loop
          }
        }
      } finally {
        setIsLoading(false);
        setAnalysingPropertyKey(null);
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
      setCurrentReportGroup,
      setIsLoading,
      getApiBase,
      getApiHeaders,
      refreshProfile,
      bumpSearchHistory,
      trackBackgroundAnalyseJob,
      shouldShowAnalyseDisclaimer,
      openAnalyseDisclaimer,
      promptSignInForAnalysis,
      scrollToNewestMessage,
      t,
      user,
    ],
  );

  useLayoutEffect(() => {
    handleAnalyseRef.current = handleAnalyse;
  }, [handleAnalyse]);

  useLayoutEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const handleCardAnalyse = useCallback(
    (
      address: string,
      selectedPhotoUrl?: string | null,
      selectedListingUrl?: string | null,
      selectedListingContext?: SelectedListingContext | null,
      analysisKey?: string,
    ) => {
      void handleAnalyse(address, selectedPhotoUrl, selectedListingUrl, selectedListingContext, false, analysisKey);
    },
    [handleAnalyse],
  );

  const handleAnalyseProperty = useCallback(
    (address: string) => {
      startNewChat();
      void handleAnalyse(address, null, null, null, false);
    },
    [startNewChat, handleAnalyse],
  );

  useEffect(() => {
    const address = typeof routeParams.analyseAddress === "string" ? routeParams.analyseAddress.trim() : "";
    const key = typeof routeParams.analyseListingId === "string"
      ? `${routeParams.analyseListingId}:${routeParams.analyseNewChat === "1" ? "new" : "current"}`
      : address;
    if (!address || !key || processedRouteAnalyseRef.current === key) return;
    processedRouteAnalyseRef.current = key;
    setHomeMode("ask");
    if (routeParams.analyseNewChat === "1") startNewChat();
    let selectedListingContext: SelectedListingContext | null = null;
    if (typeof routeParams.analyseListingContext === "string" && routeParams.analyseListingContext.trim()) {
      try {
        selectedListingContext = JSON.parse(routeParams.analyseListingContext) as SelectedListingContext;
      } catch {
        selectedListingContext = null;
      }
    }
    void handleAnalyse(
      address,
      typeof routeParams.analysePhotoUrl === "string" ? routeParams.analysePhotoUrl || null : null,
      typeof routeParams.analyseListingUrl === "string" ? routeParams.analyseListingUrl || null : null,
      selectedListingContext,
      false,
      undefined,
      routeParams.analyseNewChat === "1",
    );
  }, [
    handleAnalyse,
    routeParams.analyseAddress,
    routeParams.analyseListingContext,
    routeParams.analyseListingId,
    routeParams.analyseListingUrl,
    routeParams.analyseNewChat,
    routeParams.analysePhotoUrl,
    startNewChat,
  ]);

  // Explore "Explore by suburb" hand-off: seed the assistant prompt asking which
  // suburb, then arm the suburb-screening branch in handleSend for the reply. The
  // param carries a unique token so repeat hand-offs re-trigger.
  useEffect(() => {
    const token = typeof routeParams.exploreAskSuburb === "string" ? routeParams.exploreAskSuburb : "";
    if (!token || processedExploreAskSuburbRef.current === token) return;
    processedExploreAskSuburbRef.current = token;
    setHomeMode("ask");
    const sessionId = currentSessionId ?? createSession();
    addMessage({ role: "assistant", content: t("explore.suburb_prompt"), type: "text" }, sessionId);
    pendingSuburbScreeningRef.current = true;
  }, [routeParams.exploreAskSuburb, currentSessionId, createSession, addMessage, t]);

  useEffect(() => {
    if (!user || isLoading) return;

    let cancelled = false;

    async function openPendingShare() {
      const token = await consumePendingShareToken();
      if (!token || processedShareTokenRef.current === token) return;
      processedShareTokenRef.current = token;

      try {
        const share = await openShareToken(token, getApiHeaders());
        if (cancelled) return;

        if (share.kind === "candidate") {
          const rawCandidate = share.payload.candidate as PropertyCandidate;
          const candidate: PropertyCandidate = {
            ...rawCandidate,
            address: rawCandidate.address || share.address,
            scores: rawCandidate.scores ?? { ease: 0, cost: 0, roi: 0, composite: 0 },
          };
          await handleAnalyse(
            candidate.address,
            candidate.photoUrl ?? candidate.photoUrls?.[0] ?? null,
            candidate.listingUrl ?? null,
            selectedListingContextFromCandidate(candidate),
            true,
            candidate.listingUrl ?? candidate.address,
          );
          return;
        }

        if (share.kind === "listing") {
          const listing = {
            ...share.payload.listing,
            address: share.payload.listing.address || share.address,
          };
          const listingContext = selectedListingContextFromBrowse(listing);
          await handleAnalyse(
            listing.address,
            listingContext.photoUrl ?? null,
            listingContext.listingUrl ?? null,
            listingContext,
            true,
            listingContext.listingUrl ?? listing.id ?? listing.address,
          );
          return;
        }

        const rerun = share.payload.rerun;
        await handleAnalyse(
          rerun.address || share.address,
          rerun.selectedPhotoUrl ?? null,
          rerun.selectedListingUrl ?? null,
          rerun.selectedListingContext ?? null,
          true,
        );
      } catch {
        if (cancelled) return;
        const sessionId = currentSessionId ?? createSession();
        addMessage({
          role: "assistant",
          content: "This shared property link could not be opened. It may have expired.",
          type: "text",
        }, sessionId);
      }
    }

    void openPendingShare();

    return () => {
      cancelled = true;
    };
  }, [addMessage, createSession, currentSessionId, getApiHeaders, handleAnalyse, isLoading, router, user]);

  const confirmAnalyseDisclaimer = useCallback(async () => {
    const action = pendingAnalyseActionRef.current;
    pendingAnalyseActionRef.current = null;
    setAnalyseDisclaimerVisible(false);

    if (analyseDisclaimerDontRemind) {
      setAnalyseDisclaimerDismissed(true);
      await AsyncStorage.setItem(getAnalyseDisclaimerDismissedKey(user?.id), "true").catch(() => {});
    }

    if (!action) return;
    if (action.type === "send") {
      await handleSend(action.text, true);
    } else {
      await handleAnalyse(action.address, action.selectedPhotoUrl, action.selectedListingUrl, action.selectedListingContext, true, action.analysisKey);
    }
  }, [analyseDisclaimerDontRemind, handleAnalyse, handleSend, user?.id]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const raw = await AsyncStorage.getItem(PENDING_GUEST_ANALYSE_ACTION_KEY).catch(() => null);
      if (!raw || cancelled) return;
      await AsyncStorage.removeItem(PENDING_GUEST_ANALYSE_ACTION_KEY).catch(() => {});
      try {
        const action = JSON.parse(raw) as PendingAnalyseAction;
        if (action.type === "send") {
          await handleSend(action.text);
        } else if (action.type === "analyse") {
          await handleAnalyse(action.address, action.selectedPhotoUrl, action.selectedListingUrl, action.selectedListingContext, false, action.analysisKey);
        }
      } catch {
        // Ignore malformed stale guest actions.
      }
    })();
    return () => { cancelled = true; };
  }, [handleAnalyse, handleSend, user]);

  // Drain a queued analyse action whenever the Search tab regains focus. This
  // is how a tap from another screen (e.g. "Analyse" on a Watchlist card) runs
  // its analysis even though this tab is already mounted, so the on-mount /
  // on-login effect above won't re-fire.
  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      let cancelled = false;
      (async () => {
        const raw = await AsyncStorage.getItem(PENDING_GUEST_ANALYSE_ACTION_KEY).catch(() => null);
        if (!raw || cancelled) return;
        await AsyncStorage.removeItem(PENDING_GUEST_ANALYSE_ACTION_KEY).catch(() => {});
        try {
          const action = JSON.parse(raw) as PendingAnalyseAction;
          if (action.type === "send") {
            await handleSend(action.text);
          } else if (action.type === "analyse") {
            await handleAnalyse(action.address, action.selectedPhotoUrl, action.selectedListingUrl, action.selectedListingContext, false, action.analysisKey);
          }
        } catch {
          // Ignore malformed stale actions.
        }
      })();
      return () => { cancelled = true; };
    }, [handleAnalyse, handleSend, user]),
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const handleLayout = (event: { nativeEvent: { layout: { height: number } } }) => {
        messageHeightsRef.current.set(item.id, event.nativeEvent.layout.height);
        if (item.type === "report") {
            reportMessageHeightsRef.current.set(item.id, event.nativeEvent.layout.height);
        }
      };

      return (
        <View onLayout={handleLayout}>
          <ChatBubble
            message={item}
            onFollowUp={handleFollowUp}
            onDiscoveryChoice={handleDiscoveryChoice}
            onAnalyse={handleCardAnalyse}
            onAnalyseProperty={handleAnalyseProperty}
            analysingPropertyKey={analysingPropertyKey}
            onRetry={handleSend}
            onConnect={(providerId) => handleConnect(providerId, item.propertyAddress ?? "")}
            onDismiss={handleDismiss}
            onAgentDismiss={handleAgentDismiss}
            onUpgrade={() => setShowPaywall(true)}
            onShowMore={handleShowMore}
            onSearchResultLayout={handleSearchResultLayout}
          />
        </View>
      );
    },
    [handleFollowUp, handleDiscoveryChoice, handleCardAnalyse, handleAnalyseProperty, analysingPropertyKey, handleSend, handleConnect, handleDismiss, handleAgentDismiss, handleShowMore, handleSearchResultLayout],
  );

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const isEmpty = messages.length === 0;

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const TAB_BAR_HEIGHT = Platform.OS === "web" ? 84 : 49;
  const tabBarOffset = Platform.OS === "web" ? TAB_BAR_HEIGHT : TAB_BAR_HEIGHT + insets.bottom;
  const canSend = inputText.trim().length > 0 && !isLoading && !messageLimitReached;

  const armRecordingCancel = useCallback((armed: boolean) => {
    if (recordingCancelArmedRef.current === armed) return;
    recordingCancelArmedRef.current = armed;
    setRecordingCancelArmed(armed);
    if (armed) {
      void Haptics.selectionAsync();
    }
  }, []);

  const clearScheduledRecordingStart = useCallback(() => {
    if (recordingStartTimerRef.current) {
      clearTimeout(recordingStartTimerRef.current);
      recordingStartTimerRef.current = null;
    }
  }, []);

  const clearRecordingWatchdogs = useCallback(() => {
    if (recordingStartWatchdogRef.current) {
      clearTimeout(recordingStartWatchdogRef.current);
      recordingStartWatchdogRef.current = null;
    }
    if (recordingMaxDurationTimerRef.current) {
      clearTimeout(recordingMaxDurationTimerRef.current);
      recordingMaxDurationTimerRef.current = null;
    }
  }, []);

  const hideMicHoldReminder = useCallback((animated = true) => {
    if (micHoldHintTimerRef.current) {
      clearTimeout(micHoldHintTimerRef.current);
      micHoldHintTimerRef.current = null;
    }
    micHoldHintOpacity.stopAnimation();
    if (!animated) {
      micHoldHintOpacity.setValue(0);
      setShowMicHoldHint(false);
      return;
    }
    Animated.timing(micHoldHintOpacity, {
      toValue: 0,
      duration: 140,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setShowMicHoldHint(false);
    });
  }, [micHoldHintOpacity]);

  const resetVoiceCapture = useCallback(async (options?: { notify?: boolean }) => {
    clearScheduledRecordingStart();
    clearRecordingWatchdogs();
    hideMicHoldReminder(false);
    const activeRecording = recordingRef.current;
    recordingRef.current = null;
    recordingStartYRef.current = null;
    recordingCurrentYRef.current = null;
    recordingCancelArmedRef.current = false;
    recordingStartInFlightRef.current = false;
    recordingPressActiveRef.current = false;
    setRecordingCancelArmed(false);
    setRecording(null);
    setIsRecording(false);
    setIsTranscribing(false);

    if (activeRecording) {
      await stopAndUnloadRecordingWithTimeout(activeRecording).catch((err) => {
        console.log("Failed to reset recording", err);
      });
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});

    if (options?.notify) {
      Alert.alert(t("search.voice_reset_title"), t("search.voice_reset_body"));
    }
  }, [clearRecordingWatchdogs, clearScheduledRecordingStart, hideMicHoldReminder, t]);

  const showMicHoldReminder = useCallback(() => {
    if (messageLimitReached) return;
    if (micHoldHintTimerRef.current) {
      clearTimeout(micHoldHintTimerRef.current);
      micHoldHintTimerRef.current = null;
    }
    setShowMicHoldHint(true);
    micHoldHintOpacity.stopAnimation();
    micHoldHintOpacity.setValue(0);
    Animated.spring(micHoldHintOpacity, {
      toValue: 1,
      friction: 8,
      tension: 120,
      useNativeDriver: true,
    }).start();
    void Haptics.selectionAsync();
    micHoldHintTimerRef.current = setTimeout(() => {
      micHoldHintTimerRef.current = null;
      hideMicHoldReminder(true);
    }, 2200);
  }, [hideMicHoldReminder, messageLimitReached, micHoldHintOpacity]);

  useEffect(() => () => {
    if (micHoldHintTimerRef.current) {
      clearTimeout(micHoldHintTimerRef.current);
      micHoldHintTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      const hasActiveVoiceCapture =
        !!recordingRef.current ||
        recordingStartInFlightRef.current ||
        !!recordingStartTimerRef.current;

      if (state === "inactive" || state === "background") {
        if (hasActiveVoiceCapture) {
          voiceInterruptionNoticePendingRef.current = true;
          void resetVoiceCapture();
        }
        return;
      }

      if (state === "active" && voiceInterruptionNoticePendingRef.current) {
        voiceInterruptionNoticePendingRef.current = false;
        Alert.alert(t("search.voice_reset_title"), t("search.voice_reset_body"));
      }
    });

    return () => subscription.remove();
  }, [resetVoiceCapture, t]);

  useEffect(() => () => {
    clearScheduledRecordingStart();
    clearRecordingWatchdogs();
    const activeRecording = recordingRef.current;
    recordingRef.current = null;
    if (activeRecording) {
      void stopAndUnloadRecordingWithTimeout(activeRecording)
        .catch((err) => console.log("Failed to unload recording on screen cleanup", err))
        .finally(() => {
          void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
        });
    } else {
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
  }, [clearRecordingWatchdogs, clearScheduledRecordingStart]);

  const handleRecordingPressMove = useCallback((event: GestureResponderEvent) => {
    recordingCurrentYRef.current = event.nativeEvent.pageY;
    if (!isRecording && !recordingRef.current) return;
    const startY = recordingStartYRef.current;
    if (startY == null) return;
    const currentY = event.nativeEvent.pageY;
    armRecordingCancel(startY - currentY >= RECORDING_CANCEL_SWIPE_UP_PX);
  }, [armRecordingCancel, isRecording]);

  const beginRecording = useCallback(async () => {
    try {
      if (messageLimitReached || recordingRef.current || recordingStartInFlightRef.current) return;
      recordingStartInFlightRef.current = true;
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== "granted") {
        clearRecordingWatchdogs();
        recordingStartInFlightRef.current = false;
        recordingPressActiveRef.current = false;
        recordingStartYRef.current = null;
        recordingCurrentYRef.current = null;
        return;
      }

      if (!recordingPressActiveRef.current) {
        clearRecordingWatchdogs();
        recordingStartInFlightRef.current = false;
        return;
      }

      recordingStartWatchdogRef.current = setTimeout(() => {
        if (recordingStartInFlightRef.current) {
          void resetVoiceCapture({ notify: true });
        }
      }, RECORDING_START_WATCHDOG_MS);

      // Fire the confirmation buzz BEFORE the audio session enters record mode.
      // iOS suppresses UIFeedbackGenerator haptics while a recording session is
      // active, so firing after createAsync() made the buzz unreliable on the
      // 2nd+ hold (the session stays primed after a swipe-up cancel). Doing it
      // here guarantees a strong, consistent vibration on every tap-and-hold,
      // both on the home search and inside a chat (same code path).
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      if (!recordingPressActiveRef.current) {
        clearRecordingWatchdogs();
        await stopAndUnloadRecordingWithTimeout(newRecording).catch(() => {});
        await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
        recordingStartInFlightRef.current = false;
        return;
      }
      if (recordingStartWatchdogRef.current) {
        clearTimeout(recordingStartWatchdogRef.current);
        recordingStartWatchdogRef.current = null;
      }
      recordingRef.current = newRecording;
      setRecording(newRecording);
      setIsRecording(true);
      recordingStartInFlightRef.current = false;
      recordingMaxDurationTimerRef.current = setTimeout(() => {
        if (recordingRef.current) {
          void resetVoiceCapture({ notify: true });
        }
      }, RECORDING_MAX_DURATION_MS);
      const startY = recordingStartYRef.current;
      const currentY = recordingCurrentYRef.current;
      if (startY != null && currentY != null) {
        armRecordingCancel(startY - currentY >= RECORDING_CANCEL_SWIPE_UP_PX);
      }
    } catch (err) {
      console.log("Failed to start recording", err);
      clearRecordingWatchdogs();
      recordingRef.current = null;
      recordingStartInFlightRef.current = false;
      recordingPressActiveRef.current = false;
      recordingStartYRef.current = null;
      recordingCurrentYRef.current = null;
      recordingCancelArmedRef.current = false;
      setRecording(null);
      setIsRecording(false);
      setRecordingCancelArmed(false);
      void Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
  }, [armRecordingCancel, clearRecordingWatchdogs, messageLimitReached, resetVoiceCapture]);

  const startRecording = useCallback((event?: GestureResponderEvent) => {
    if (messageLimitReached || recordingRef.current || recordingStartInFlightRef.current) return;
    hideMicHoldReminder(false);
    clearScheduledRecordingStart();
    recordingPressActiveRef.current = true;
    const pageY = event?.nativeEvent.pageY ?? null;
    recordingStartYRef.current = pageY;
    recordingCurrentYRef.current = pageY;
    recordingCancelArmedRef.current = false;
    setRecordingCancelArmed(false);
    recordingStartTimerRef.current = setTimeout(() => {
      recordingStartTimerRef.current = null;
      if (!recordingPressActiveRef.current) return;
      void beginRecording();
    }, RECORDING_HOLD_TO_START_MS);
  }, [beginRecording, clearScheduledRecordingStart, hideMicHoldReminder, messageLimitReached]);

  useEffect(() => clearScheduledRecordingStart, [clearScheduledRecordingStart]);

  const cancelRecording = useCallback(async () => {
    clearScheduledRecordingStart();
    clearRecordingWatchdogs();
    const activeRecording = recordingRef.current ?? recording;
    recordingRef.current = null;
    recordingStartYRef.current = null;
    recordingCurrentYRef.current = null;
    recordingCancelArmedRef.current = false;
    recordingStartInFlightRef.current = false;
    recordingPressActiveRef.current = false;
    setRecordingCancelArmed(false);
    setRecording(null);
    setIsRecording(false);
    setIsTranscribing(false);
    if (!activeRecording) {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      return;
    }
    try {
      await stopAndUnloadRecordingWithTimeout(activeRecording);
      // Release the recording audio session so it doesn't stay primed and
      // suppress the next tap-and-hold's confirmation haptic.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      console.log("Failed to cancel recording", err);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
    }
  }, [clearRecordingWatchdogs, clearScheduledRecordingStart, recording]);

  const stopRecording = useCallback(async () => {
    if (recordingCancelArmedRef.current) {
      await cancelRecording();
      return;
    }
    let reachedTranscribe = false;
    const releasedBeforeHoldStarted =
      recordingPressActiveRef.current &&
      !!recordingStartTimerRef.current &&
      !recordingRef.current &&
      !recordingStartInFlightRef.current;
    recordingPressActiveRef.current = false;
    clearScheduledRecordingStart();
    clearRecordingWatchdogs();
    const activeRecording = recordingRef.current ?? recording;
    if (!activeRecording) {
      if (releasedBeforeHoldStarted) showMicHoldReminder();
      recordingStartInFlightRef.current = false;
      recordingStartYRef.current = null;
      recordingCurrentYRef.current = null;
      recordingCancelArmedRef.current = false;
      setRecordingCancelArmed(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      return;
    }
    try {
      setIsRecording(false);
      await stopAndUnloadRecordingWithTimeout(activeRecording);
      const uri = activeRecording.getURI();
      recordingRef.current = null;
      recordingStartYRef.current = null;
      recordingCurrentYRef.current = null;
      recordingCancelArmedRef.current = false;
      recordingStartInFlightRef.current = false;
      recordingPressActiveRef.current = false;
      setRecording(null);
      setRecordingCancelArmed(false);
      // Release the recording audio session so it doesn't stay primed and
      // suppress the next tap-and-hold's confirmation haptic.
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (uri) {
        reachedTranscribe = true;
        setIsTranscribing(true);
        const formData = new FormData();
        formData.append("file", {
          uri,
          name: "audio.m4a",
          type: "audio/m4a",
        } as any);

        // Omit Content-Type to let fetch generate the multipart boundary
        const { "Content-Type": _ct, ...headersWithoutContentType } = getApiHeaders();

        const transcribeController = new AbortController();
        const transcribeTimeout = setTimeout(() => transcribeController.abort(), TRANSCRIBE_TIMEOUT_MS);
        const res = await fetch(`${resolveApiBase()}/transcribe`, {
          method: "POST",
          headers: headersWithoutContentType,
          body: formData,
          signal: transcribeController.signal,
        }).finally(() => clearTimeout(transcribeTimeout));

        if (res.ok) {
          const data = await res.json() as { text?: string };
          const transcript = data.text?.trim() ?? "";
          if (transcript.length > 0) {
            setIsTranscribing(false);
            if (isLoadingRef.current) {
              setInputText(transcript);
              inputRef.current?.focus();
              Alert.alert(t("search.voice_busy_title"), t("search.voice_busy_body"));
            } else {
              void handleSend(transcript);
            }
          } else {
            // Recording captured but no speech detected — don't leave the user
            // staring at a vanished overlay with no explanation.
            setIsTranscribing(false);
            Alert.alert(t("search.voice_failed_title"), t("search.voice_failed_body"));
          }
        } else {
          setIsTranscribing(false);
          Alert.alert(t("search.voice_failed_title"), t("search.voice_failed_body"));
        }
      }
    } catch (err) {
      console.log("Failed to stop recording", err);
      recordingRef.current = null;
      recordingStartYRef.current = null;
      recordingCurrentYRef.current = null;
      recordingCancelArmedRef.current = false;
      recordingStartInFlightRef.current = false;
      recordingPressActiveRef.current = false;
      setRecording(null);
      setIsRecording(false);
      setIsTranscribing(false);
      setRecordingCancelArmed(false);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      // Only surface the error if we'd already reached the transcription stage;
      // a bare stop/unload glitch shouldn't pop an alert.
      if (reachedTranscribe) {
        Alert.alert(t("search.voice_failed_title"), t("search.voice_failed_body"));
      }
    }
  }, [cancelRecording, clearRecordingWatchdogs, clearScheduledRecordingStart, recording, getApiHeaders, handleSend, showMicHoldReminder, t]);

  const renderMicButton = useCallback(() => (
    <View style={styles.micButtonSlot}>
      {showMicHoldHint ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.micHoldHint,
            {
              opacity: micHoldHintOpacity,
              transform: [
                {
                  translateY: micHoldHintOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [8, 0],
                  }),
                },
                {
                  scale: micHoldHintOpacity.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.96, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.micHoldHintText}>{t("search.voice_hold_hint")}</Text>
          <View style={styles.micHoldHintTail} />
        </Animated.View>
      ) : null}
      <View
        style={[
          styles.micBtn,
          {
            backgroundColor: isRecording ? (recordingCancelArmed ? "#991b1b" : "#ef4444") : "transparent",
            opacity: isRecording ? 1 : 0.85,
          },
        ]}
        onStartShouldSetResponder={() => true}
        onResponderGrant={startRecording}
        onResponderMove={handleRecordingPressMove}
        onResponderRelease={stopRecording}
        onResponderTerminate={cancelRecording}
        accessibilityRole="button"
        accessibilityLabel={t("search.voice_hold_hint")}
      >
        <Feather name="mic" size={18} color={isRecording ? "#fff" : colors.mutedForeground} />
      </View>
    </View>
  ), [cancelRecording, colors.mutedForeground, handleRecordingPressMove, isRecording, micHoldHintOpacity, recordingCancelArmed, showMicHoldHint, startRecording, stopRecording, t]);

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
            <Text style={[styles.appName, { fontFamily: "SpaceGrotesk_700Bold", letterSpacing: -0.4 }]}>
              {isOSChineseLocale() ? "奥房" : "Project Alpha"}
            </Text>
          </View>
          <View style={styles.headerActions}>
            {SHOW_EXPLORE_HEADER_BUTTON ? (
              <TouchableOpacity
                style={[styles.exploreBtn, { borderColor: "rgba(250,249,246,0.22)" }]}
                onPress={() => router.push("/explore" as never)}
                activeOpacity={0.75}
              >
                <Feather name="compass" size={14} color="rgba(250,249,246,0.78)" />
                <Text style={[styles.exploreBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("explore.header_button")}</Text>
              </TouchableOpacity>
            ) : null}
            {BROWSE_MODE_ENABLED && (isEmpty || homeMode === "browse") ? (
              <TouchableOpacity
                style={[styles.browseModeBtn, { borderColor: "rgba(250,249,246,0.22)", backgroundColor: homeMode === "browse" ? colors.accent : "transparent" }]}
                onPress={homeMode === "browse" ? openAskMode : openBrowseMode}
                activeOpacity={0.78}
              >
                <Feather name={homeMode === "browse" ? "message-circle" : "list"} size={14} color={homeMode === "browse" ? "#fff" : "rgba(250,249,246,0.78)"} />
                <Text style={[styles.browseModeBtnText, { color: homeMode === "browse" ? "#fff" : "rgba(250,249,246,0.78)", fontFamily: "DM_Sans_600SemiBold" }]}>
                  {homeMode === "browse" ? t("browse.ask_mode") : t("browse.header_button")}
                </Text>
              </TouchableOpacity>
            ) : null}
            {!user && (
              <TouchableOpacity
                style={[styles.signInBtn, { borderColor: "rgba(250,249,246,0.22)" }]}
                onPress={() => router.push("/(auth)/login" as never)}
                activeOpacity={0.75}
              >
                <Feather name="user-plus" size={13} color="rgba(250,249,246,0.78)" />
                <Text style={[styles.signInBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("guest.sign_in")}</Text>
              </TouchableOpacity>
            )}
            {user?.role === "sales_agent" && (
              <>
                <TouchableOpacity
                  style={[styles.myListingsBtn, { borderColor: "rgba(250,249,246,0.22)" }]}
                  onPress={() => router.push("/my-listings")}
                  activeOpacity={0.75}
                >
                  <Feather name="list" size={14} color="rgba(250,249,246,0.75)" />
                  <Text style={[styles.myListingsBtnText, { fontFamily: "DM_Sans_500Medium" }]}>{t("search.listings")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addListingBtn, { backgroundColor: colors.accent }]}
                  onPress={() => router.push("/add-listing")}
                  activeOpacity={0.8}
                >
                  <Feather name="plus" size={13} color="#fff" />
                  <Text style={[styles.addListingBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("search.add_listing")}</Text>
                </TouchableOpacity>
              </>
            )}
            {homeMode !== "browse" && !isEmpty && (
              <TouchableOpacity
                style={[styles.newChatBtn, { borderColor: "rgba(250,249,246,0.18)" }]}
                onPress={startNewChat}
                activeOpacity={0.7}
              >
                <Feather name="plus" size={14} color="rgba(250,249,246,0.65)" />
                <Text style={[styles.newChatText, { fontFamily: "DM_Sans_500Medium" }]}>{t("search.new")}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {currentSession?.currentReport && (
          <View style={[styles.contextBanner, { borderTopColor: "rgba(250,249,246,0.08)" }]}>
            <Feather name="map-pin" size={12} color={colors.accent} />
            <Text style={[styles.contextAddress, { color: "rgba(250,249,246,0.75)", fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
              {currentSession.currentReport.address || currentSession.currentReport.propertyOverview?.address || t("search.property_loaded")}
            </Text>
            {/* Hide the composite badge when land area is unknown — the score is
                unreliable, so the report shows a contact-the-agent prompt instead. */}
            {String(currentSession.currentReport.propertyOverview?.landArea ?? "").trim() ? (
              <View style={[styles.contextBadge, { backgroundColor: colors.accent + "22" }]}>
                <Text style={[styles.contextBadgeText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                  {formatCompositeScoreForDisplay(Number(currentSession.currentReport.scores?.composite ?? 0))}/5
                </Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      {/* Empty / Search state */}
      {BROWSE_MODE_ENABLED && homeMode === "browse" ? (
        <View style={[styles.browseRoot, { paddingBottom: tabBarOffset }]}>
          <BrowseFilters
            filters={browseFilters}
            onChange={setBrowseFilters}
            onSubmit={applyBrowseFilters}
            expanded={browseFiltersExpanded}
            onExpandedChange={setBrowseFiltersExpanded}
          />
          {browseLoading && browseListings.length === 0 ? (
            <View style={styles.browseCenter}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={[styles.browseEmptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.loading")}</Text>
              <Text style={[styles.browseEmptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("browse.loading_hint")}</Text>
            </View>
          ) : browseError && browseListings.length === 0 ? (
            <View style={styles.browseCenter}>
              <Feather name="alert-circle" size={28} color={colors.mutedForeground} />
              <Text style={[styles.browseEmptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.unavailable")}</Text>
              <Text style={[styles.browseEmptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{browseError}</Text>
              <TouchableOpacity style={[styles.browseRetry, { borderColor: colors.border }]} onPress={() => loadBrowseListings()}>
                <Text style={[styles.browseRetryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{t("browse.try_again")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
              data={browseListings}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <BrowseListingCard
                  listing={item}
                  onPress={() => router.push({
                    pathname: "/listing/[id]",
                    params: { id: item.id, preview: JSON.stringify(item) },
                  } as never)}
                />
              )}
              contentContainerStyle={styles.browseList}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="interactive"
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  refreshing={browseRefreshing}
                  onRefresh={() => loadBrowseListings({ refresh: true })}
                  tintColor={colors.accent}
                />
              }
              onScrollBeginDrag={() => {
                Keyboard.dismiss();
                if (browseFiltersExpanded) setBrowseFiltersExpanded(false);
              }}
              onEndReached={() => {
                if ((browseQueuedListingsRef.current.length > 0 || browseNextCursor) && !browseLoadingMore) {
                  void loadBrowseListings({ append: true, cursor: browseNextCursor });
                }
              }}
              onEndReachedThreshold={0.6}
              ListHeaderComponent={
                <View style={styles.browseHeaderCopy}>
                  <Text style={[styles.browseTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.title")}</Text>
                  <Text style={[styles.browseSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                    {t("browse.subtitle")}
                  </Text>
                </View>
              }
              ListEmptyComponent={
                <View style={styles.browseCenter}>
                  <Feather name="search" size={30} color={colors.mutedForeground} />
                  <Text style={[styles.browseEmptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.empty_title")}</Text>
                  <Text style={[styles.browseEmptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                    {t("browse.empty_body")}
                  </Text>
                </View>
              }
              ListFooterComponent={browseLoadingMore ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 16 }} /> : null}
            />
          )}
          {browseLoading && browseListings.length > 0 ? (
            <View style={styles.browseLoadingOverlay} pointerEvents="auto">
              <View style={[styles.browseLoadingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ActivityIndicator color={colors.accent} size="large" />
                <Text style={[styles.browseEmptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.loading")}</Text>
                <Text style={[styles.browseEmptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("browse.loading_hint")}</Text>
              </View>
            </View>
          ) : null}
        </View>
      ) : isEmpty ? (
        <Pressable style={{ flex: 1 }} onPress={Keyboard.dismiss}>
          <View style={[styles.landingContainer, { paddingBottom: tabBarOffset }]}>
            <View style={styles.landingContent}>
              <Text style={[styles.landingTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                {t("search.welcome_title")}
              </Text>
              <Text style={[styles.landingSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("search.welcome_subtitle")}
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
                  placeholder={t("search.placeholder")}
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
                {!inputText.trim() && renderMicButton()}
              </View>

              {/* Suggestion chips — each chip must not shrink so text stays readable */}
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
                    <Text
                      style={[styles.suggestionText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                      numberOfLines={1}
                    >
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
            ListHeaderComponent={
              showRatingStrip ? (
                <ResponseRatingBar
                  sessionRating={currentSession?.firstLlmResponseRating}
                  onRate={submitFirstTurnRating}
                />
              ) : null
            }
            contentContainerStyle={[styles.messageList, { paddingBottom: 16 }]}
            onLayout={(event) => setListViewportHeight(event.nativeEvent.layout.height)}
            onScroll={(event) => {
              setShowJumpToLatest(event.nativeEvent.contentOffset.y > 80);
            }}
            scrollEventThrottle={80}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
            nestedScrollEnabled
          />

          {showJumpToLatest && (
            <TouchableOpacity
              style={[
                styles.jumpToLatestBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  shadowColor: colors.shadow,
                  bottom: keyboardVisible ? 96 : tabBarOffset + 86,
                },
              ]}
              onPress={scrollToNewestMessage}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Jump to newest message"
            >
              <Feather name="arrow-down" size={18} color={colors.accent} />
            </TouchableOpacity>
          )}

          {messageLimitReached ? (
            <View style={[styles.limitWarningBar, { backgroundColor: "#FEF2F2", borderTopColor: "#FECACA" }]}>
              <Feather name="slash" size={13} color="#DC2626" />
              <Text style={[styles.limitWarningText, { color: "#991B1B", fontFamily: "DM_Sans_500Medium" }]}>
                {t("search.usage_limit_bar")}
              </Text>
            </View>
          ) : chatQuota && (user?.messagesUsedThisMonth ?? 0) >= chatQuota.warnAt ? (
            <View style={[styles.limitWarningBar, { backgroundColor: "#FFFBEB", borderTopColor: "#FDE68A" }]}>
              <Feather name="alert-triangle" size={13} color="#D97706" />
              <Text style={[styles.limitWarningText, { color: "#92400E", fontFamily: "DM_Sans_500Medium" }]}>
                {t("search.usage_limit_approaching")}
              </Text>
            </View>
          ) : null}

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
                style={[styles.input, { color: messageLimitReached ? colors.mutedForeground : colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder={
                  messageLimitReached
                    ? chatQuota?.isFree
                      ? t("profile.limit_reached_free")
                      : t("profile.limit_reached_standard")
                    : t("search.placeholder")
                }
                placeholderTextColor={colors.mutedForeground}
                value={messageLimitReached ? "" : inputText}
                onChangeText={messageLimitReached ? undefined : setInputText}
                editable={!messageLimitReached}
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
              {!inputText.trim() && !messageLimitReached && renderMicButton()}
            </View>
          </View>
        </>
      )}

      {(isRecording || isTranscribing) && (
        <View style={styles.recordingOverlay} pointerEvents="none">
          <View style={styles.recordingOverlayCenter}>
            {isTranscribing ? (
              <>
                <ActivityIndicator color="#fff" size="small" style={{ marginBottom: 10 }} />
                <Text style={styles.recordingOverlayText}>{t("search.voice_transcribing")}</Text>
              </>
            ) : (
              <Text style={styles.recordingOverlayText}>
                {recordingCancelArmed ? t("search.voice_stop") : t("search.voice_listening")}
              </Text>
            )}
          </View>
        </View>
      )}

      <PaywallModal
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
        onPurchaseSuccess={handlePurchaseSuccess}
      />
      <Modal
        visible={guestAnalysisPromptVisible}
        transparent
        animationType="fade"
        onRequestClose={closeGuestAnalysisPrompt}
      >
        <View style={styles.guestPromptRoot}>
          <View style={styles.guestPromptBackdrop} />
          <View style={styles.guestPromptCenter}>
            <View style={[styles.guestPromptCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.guestPromptIcon, { backgroundColor: colors.accent + "18" }]}>
                <Feather name="lock" size={20} color={colors.accent} />
              </View>
              <Text style={[styles.guestPromptTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                {t("guest_analysis.title")}
              </Text>
              <Text style={[styles.guestPromptBody, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("guest_analysis.body")}
              </Text>
              <View style={styles.guestPromptBenefits}>
                {[
                  "guest_analysis.benefit_analysis",
                  "guest_analysis.benefit_history",
                  "guest_analysis.benefit_security",
                ].map((key) => (
                  <View key={key} style={styles.guestPromptBenefitRow}>
                    <View style={[styles.guestPromptBenefitIcon, { backgroundColor: colors.accent + "16" }]}>
                      <Feather name="check" size={12} color={colors.accent} />
                    </View>
                    <Text style={[styles.guestPromptBenefitText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                      {t(key)}
                    </Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.guestPromptPrimaryBtn, { backgroundColor: colors.accent }]}
                onPress={openGuestAnalysisSignup}
                activeOpacity={0.85}
              >
                <Text style={[styles.guestPromptPrimaryText, { fontFamily: "DM_Sans_700Bold" }]}>
                  {t("signup.create_account")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.guestPromptSecondaryBtn, { borderColor: colors.border }]}
                onPress={openGuestAnalysisLogin}
                activeOpacity={0.78}
              >
                <Text style={[styles.guestPromptSecondaryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                  {t("login.submit")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.guestPromptCancelBtn}
                onPress={closeGuestAnalysisPrompt}
                activeOpacity={0.7}
              >
                <Text style={[styles.guestPromptCancelText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={analyseDisclaimerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setAnalyseDisclaimerVisible(false)}
      >
        <View style={styles.disclaimerModalRoot}>
          <View style={styles.disclaimerBackdrop} />
          <View style={styles.disclaimerCenter}>
            <View style={[styles.disclaimerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.disclaimerTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                {t("analyse_disclaimer.title")}
              </Text>
              <Text style={[styles.disclaimerBody, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("analyse_disclaimer.body")}
              </Text>
              <TouchableOpacity
                style={styles.disclaimerCheckRow}
                onPress={() => setAnalyseDisclaimerDontRemind((value) => !value)}
                activeOpacity={0.75}
              >
                <View style={[
                  styles.disclaimerCheckbox,
                  {
                    borderColor: analyseDisclaimerDontRemind ? colors.accent : colors.border,
                    backgroundColor: analyseDisclaimerDontRemind ? colors.accent : "transparent",
                  },
                ]}>
                  {analyseDisclaimerDontRemind && <Feather name="check" size={14} color="#fff" />}
                </View>
                <Text style={[styles.disclaimerCheckText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  {t("analyse_disclaimer.dont_remind")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.disclaimerOkBtn, { backgroundColor: colors.accent }]}
                onPress={confirmAnalyseDisclaimer}
                activeOpacity={0.85}
              >
                <Text style={[styles.disclaimerOkText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                  {t("common.ok")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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
  exploreBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  exploreBtnText: {
    fontSize: 13,
    color: "rgba(250,249,246,0.78)",
  },
  browseModeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  browseModeBtnText: {
    fontSize: 13,
  },
  signInBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  signInBtnText: {
    fontSize: 13,
    color: "rgba(250,249,246,0.78)",
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
    paddingBottom: 2,
  },
  micButtonSlot: {
    width: 36,
    height: 36,
    marginLeft: 4,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    zIndex: 5,
  },
  micBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  micHoldHint: {
    position: "absolute",
    right: -4,
    bottom: 46,
    minWidth: 142,
    maxWidth: 176,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "#201915",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12,
  },
  micHoldHintText: {
    color: "#fffaf3",
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
    fontFamily: "DM_Sans_700Bold",
  },
  micHoldHintTail: {
    position: "absolute",
    right: 16,
    bottom: -6,
    width: 12,
    height: 12,
    backgroundColor: "#201915",
    transform: [{ rotate: "45deg" }],
  },
  recordingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(28,28,28,0.58)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 80,
    elevation: 80,
  },
  recordingOverlayCenter: {
    minWidth: 188,
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.42)",
    alignItems: "center",
  },
  recordingOverlayText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_700Bold",
    fontSize: 22,
    lineHeight: 28,
    textAlign: "center",
  },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    // Critical: prevent the ScrollView from squashing individual chips
    flexShrink: 0,
  },
  suggestionText: {
    fontSize: 13,
    lineHeight: 18,
    // Don't allow wrapping — the chip is sized to its content
    flexShrink: 0,
  },
  // ── Chat state ─────────────────────────────────────────────────────
  browseRoot: {
    flex: 1,
    position: "relative",
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  browseList: {
    gap: 13,
    paddingTop: 12,
    paddingBottom: 20,
  },
  browseHeaderCopy: {
    gap: 3,
    paddingBottom: 2,
  },
  browseTitle: {
    fontSize: 22,
    lineHeight: 28,
  },
  browseSubtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  browseCenter: {
    flex: 1,
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 10,
  },
  browseEmptyTitle: {
    fontSize: 17,
    textAlign: "center",
  },
  browseEmptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  browseRetry: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  browseRetryText: {
    fontSize: 13,
  },
  messageList: {
    gap: 4,
    paddingTop: 16,
  },
  jumpToLatestBtn: {
    position: "absolute",
    right: 18,
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 10,
    elevation: 5,
    zIndex: 20,
  },
  limitWarningBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderTopWidth: 1,
  },
  limitWarningText: { fontSize: 12, flex: 1, lineHeight: 18 },
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
  guestPromptRoot: {
    flex: 1,
  },
  guestPromptBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.46)",
  },
  guestPromptCenter: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  browseLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: "rgba(28, 25, 23, 0.34)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  browseLoadingCard: {
    width: "100%",
    maxWidth: 320,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 8,
  },
  guestPromptCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 14,
  },
  guestPromptIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  guestPromptTitle: {
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  guestPromptBody: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  guestPromptBenefits: {
    gap: 10,
    marginBottom: 20,
  },
  guestPromptBenefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  guestPromptBenefitIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  guestPromptBenefitText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  guestPromptPrimaryBtn: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  guestPromptPrimaryText: {
    color: "#fff",
    fontSize: 16,
  },
  guestPromptSecondaryBtn: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  guestPromptSecondaryText: {
    fontSize: 15,
  },
  guestPromptCancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 14,
    paddingBottom: 2,
  },
  guestPromptCancelText: {
    fontSize: 14,
  },
  disclaimerModalRoot: {
    flex: 1,
  },
  disclaimerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.42)",
  },
  disclaimerCenter: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  disclaimerCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  disclaimerTitle: {
    fontSize: 18,
    lineHeight: 24,
    marginBottom: 10,
  },
  disclaimerBody: {
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 18,
  },
  disclaimerCheckRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    marginBottom: 14,
  },
  disclaimerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  disclaimerCheckText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  disclaimerOkBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  disclaimerOkText: {
    color: "#fff",
    fontSize: 16,
  },
});
