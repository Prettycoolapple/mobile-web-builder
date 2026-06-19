import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import {
  cacheReportPhotos,
  deleteReportPhotos,
  reportPhotoSignature,
} from "@/lib/reportPhotoCache";
import { getCurrentLocale } from "@/lib/i18n";
import { translateReportViaApi } from "@/lib/translateReport";
import { getApiBase } from "@/lib/api";

export type MessageRole = "user" | "assistant";

export interface ServiceProvider {
  id: string;
  fullName: string | null;
  companyName: string | null;
  discipline: string | null;
  bio: string | null;
  recommendationCount: number;
  avatarUrl: string | null;
  isVerified?: boolean;
  contactNumber?: string | null;
  addressSuburb?: string | null;
  addressCity?: string | null;
  primaryLanguage?: string | null;
  secondaryLanguage?: string | null;
}

/**
 * Honest expectation-setting hint shown under the loading spinner. Set by the
 * /loading-hint/check endpoint when the LLM classifies the user's message as
 * an area-wide subdivision sweep (e.g. "what's subdividable in orakei") so
 * the user knows the wait is normal, not a hang.
 */
export interface LoadingHint {
  kind: "wide_scan_subdivision";
  etaSecondsMin: number;
  etaSecondsMax: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type: "text" | "report" | "report_group" | "search" | "loading" | "provider_recommendation" | "provider_upgrade_gate" | "agent_contact" | "subdivision_clarification" | "address_clarification" | "discovery_exhausted_choice";
  clarification?: {
    question: string;
    options: string[];
    optionActions?: Array<"repeat_origin" | "search_nearby">;
  };
  loadingMode?: "analyse" | "discover" | "followup";
  loadingHint?: LoadingHint;
  retryLabel?: string;
  retryText?: string;
  report?: FeasibilityReport;
  reportGroup?: FeasibilityReportGroup;
  searchResults?: PropertyCandidate[];
  searchPresentation?: "generic_listing" | "scored_screening";
  scrollToSearchResultIndex?: number;
  // The suburb this result block is browsing. Stored so the exhausted-discovery
  // choice chips can piggyback it back to the backend (keeping the repeat/nearby
  // suburb authoritative as the conversation moves Glendowie → Meadowbank → next).
  suburb?: string;
  continuationToken?: string | null;
  prefetchedSearchResults?: PropertyCandidate[];
  prefetchedContinuationToken?: string | null;
  prefetchedExhausted?: boolean;
  // Suburb of the prefetched batch — used to show a "now showing nearby X" note
  // and advance message.suburb when the nearby "train" jumps suburbs.
  prefetchedSuburb?: string;
  // Whether the queued suburbs are the user's own list ("user") or LLM nearby
  // suggestions ("nearby") — controls the hand-off wording on advance.
  prefetchedQueueSource?: "user" | "nearby";
  prefetchedClarification?: {
    question: string;
    options: string[];
    searchPresentation?: "generic_listing" | "scored_screening";
    suburb?: string | null;
  };
  showMoreStatus?: "idle" | "loading" | "ready";
  isMockData?: boolean;
  aiIntro?: string;
  provider?: ServiceProvider;
  intentType?: string;
  propertyAddress?: string;
  agentName?: string | null;
  agentPhone?: string | null;
  agencyName?: string | null;
  agentAvatarUrl?: string | null;
  agentMatchType?: "subject" | "suburb";
  agentListingUrl?: string | null;
  backgroundJobId?: string;
}

export interface Score {
  ease: number;
  cost: number;
  roi: number;
  composite: number;
  ease_reasons?: string[];
  cost_reasons?: string[];
  roi_reasons?: string[];
}

export interface PropertyOverview {
  address: string;
  cv?: string;
  landArea?: string;
  floorArea?: string;
  buildYear?: string;
  /** Reconciled dwelling type (e.g. House, Townhouse, Unit). */
  propertyType?: string | null;
  siteStatus?: "vacant_land" | "has_dwelling" | "unknown";
  siteStatusLabel?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  zone?: string;
  /** LINZ estate description / tenure (e.g. Fee Simple, Cross lease). */
  titleType?: string | null;
  titleResolutionSource?: "lrs" | "lrs_cache" | "listing" | "scraped_page" | "ai_snippet" | "unknown";
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
  typologyConfidence?: "verified" | "inferred" | "unknown";
  titleConfidence?: "verified" | "inferred" | "unknown";
  subdivisionEligible?: boolean | null;
  subdivisionRejectReason?: string | null;
  listingPrice?: string;
  listingUrl?: string | null;
  listingSource?: string | null;
  isOnMarket?: boolean;
  selectedListingContext?: SelectedListingContext;
  combinedListingContext?: CombinedListingContext;
}

export interface TitleInsight {
  titleType: string;
  isCrossLease: boolean;
  opportunity: string | null;
  risks: string[];
}

export interface CombinedListingContext {
  isCombinedListingMatch: boolean;
  packageAddress: string;
  childAddresses: string[];
  aggregateFactsExcluded: boolean;
  note: string;
}

export interface PlanningOverlay {
  name: string;
  // "control" = an AUP development Control (e.g. Height/Subdivision Variation),
  // surfaced for information; can be value-positive and is score-neutral.
  status: "clear" | "moderate" | "restricted" | "control";
  detail: string;
}

export interface EasementEntry {
  type: "right_of_way" | "drainage" | "power" | "services" | "covenant" | "encroachment" | "other";
  burden: "burdening" | "appurtenant" | "unknown";
  description: string;
  estimated_width_m?: number | null;
  estimated_area_sqm?: number | null;
  severity?: "minor" | "moderate" | "significant";
}

export type DesignLedConfidence = "none" | "low" | "medium";

export interface DesignLedYieldRange {
  min: number;
  max: number;
}

export interface PlanningInfo {
  zone?: string;
  minLotSize?: string;
  potentialLots?: number;
  standardVacantLots?: number;
  standardPathViable?: boolean;
  standardMinLotSize?: number | null;
  designLedEligible?: boolean;
  designLedYieldRange?: DesignLedYieldRange | null;
  designLedConfidence?: DesignLedConfidence;
  designLedReasons?: string[];
  designLedBlockers?: string[];
  designLedSummary?: string | null;
  designLedDetail?: string | null;
  grossAreaSqm?: number;
  netAreaSqm?: number;
  easementAreaSqm?: number;
  overlays?: PlanningOverlay[];
  easements?: EasementEntry[];
  appurtenant_easements?: { type: string; description: string }[];
  easement_summary?: string;
  easement_data_status?: "retrieved" | "no_memorials" | "api_error" | "no_title";
  lot_impact_note?: string | null;
  subdivisionSummary?: string;
  subdivisionPathwayNote?: string | null;
}

export interface AsbestosInfo {
  buildYear?: string;
  riskLevel: "low" | "moderate" | "high" | "unknown";
  risk?: "low" | "high" | "unknown";
  flagged: boolean;
  notes?: string;
  worksafe_required?: boolean;
  demoCostLow?: number;
  demoCostHigh?: number;
  worksafeNote?: string;
}

export interface TerrainInfo {
  classification: "flat" | "subtle" | "gentle" | "moderate" | "steep" | "very_steep" | null;
  slope?: string;
  slope_degrees?: number | null;
  retainingCostLow?: number;
  retainingCostHigh?: number;
  source?: string;
  steep_area_ratio?: number | null;
  moderate_area_ratio?: number | null;
  local_slope_p90_degrees?: number | null;
  local_slope_p95_degrees?: number | null;
  sample_count?: number | null;
  retaining_area_sqm_estimate?: number | null;
  large_site_terrain_adjusted?: boolean;
}

export interface InfrastructureService {
  name: string;
  location: "on-parcel" | "boundary" | "neighbour" | "public-land" | "off-parcel" | "unknown";
  distance_metres?: number | null;
  estimatedCostLow?: number;
  estimatedCostHigh?: number;
  estimated_cost_low?: number;
  estimated_cost_high?: number;
  risk: "low" | "moderate" | "high";
  note?: string;
}

export interface CostItem {
  label: string;
  low: number;
  high: number;
}

export interface ROICaseResult {
  case: "bear" | "base" | "bull";
  label: string;
  gdv: number;
  gdv_multiplier: number;
  gross_profit: number;
  roi_percent: number;
  annualised_roi_percent: number;
  viable: boolean;
}

export interface ROIScenario {
  years: number;
  gdv: number;
  gdv_per_lot?: number;
  sqm_per_lot?: number;
  lots?: number;
  totalCost?: number;
  total_cost_mid?: number;
  grossProfit?: number;
  gross_profit?: number;
  roi?: number;
  roi_percent?: number;
  annualisedRoi?: number;
  annualised_roi_percent?: number;
  isBest?: boolean;
  viable?: boolean;
  cases?: ROICaseResult[];
  interest_rate_outlook?: "falling" | "stable" | "rising";
  cv_unavailable?: boolean;
}

export type DevelopmentStrategyId = "hold_existing" | "refurbish" | "demolish_rebuild" | "integrated_consent";
export type DevelopmentStrategyRecommendation = "recommended" | "viable" | "not_recommended";
export type RefurbishmentScope = "none" | "light" | "moderate" | "heavy";

export interface DevelopmentStrategyCostItem {
  label: string;
  low: number;
  high: number;
}

export interface DevelopmentStrategyScenario {
  id: DevelopmentStrategyId;
  title: string;
  recommendation: DevelopmentStrategyRecommendation;
  confidence: number;
  rationale: string;
  rationale_zh?: string;
  assumptions: string[];
  refurbishScope?: RefurbishmentScope;
  totalCostLow: number;
  totalCostHigh: number;
  costPerUnitAvg: number;
  costItems?: DevelopmentStrategyCostItem[];
  roiScenarios: ROIScenario[];
}

export interface ComparableSale {
  address: string;
  saleDate?: string;
  sale_date?: string | null;
  price?: number;
  price_nzd?: number;
  size?: number;
  land_sqm?: number;
  floor_sqm?: number;
  pricePerSqm?: number;
  price_per_sqm?: number;
  cv_nzd?: number | null;
  build_year?: number | null;
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
  distanceM?: number | null;
  source?: "oneroof_sold" | "realestate_active_listing" | "licensed_provider" | "unknown";
  relevanceScore?: number;
  selectionReason?: string;
}

export interface NeighbourhoodSignal {
  level: "none" | "low" | "moderate" | "high" | "unknown";
  count: number;
  assessedLots: number;
  confidence: "high" | "medium" | "low" | "unknown";
}

export interface NeighbourhoodContext {
  assessedLots: number;
  radiusM: number;
  publicHousingSignal: NeighbourhoodSignal;
  /** @deprecated Retained for old saved reports; active UI ignores surrounding typology. */
  terraceHousingSignal?: NeighbourhoodSignal;
  confidence: "high" | "medium" | "low" | "unknown";
  marketAdjustment: {
    gdvMultiplier: number;
    applied: boolean;
    reason: string | null;
  };
  reasons: string[];
}

export interface TransportStopContext {
  name: string;
  mode: "bus" | "train" | "ferry" | "unknown";
  distanceM: number;
  routeCount: number;
  serviceIntensity: "frequent" | "regular" | "limited" | "unknown";
}

export interface TransportContext {
  publicTransport: {
    accessTier: "excellent" | "good" | "limited" | "poor" | "unknown";
    nearestStop: TransportStopContext | null;
    nearestByMode: TransportStopContext[];
    confidence: "high" | "medium" | "low" | "unknown";
  };
  /** @deprecated Retained for old saved reports; active UI ignores highway context. */
  highwayAccess?: {
    name: string | null;
    distanceM: number | null;
    accessTier: "excellent" | "good" | "neutral" | "remote" | "exposureRisk" | "unknown";
    exposureTier: "low" | "moderate" | "high" | "unknown";
    confidence: "high" | "medium" | "low" | "unknown";
  };
  cityCommute: {
    centreName: string | null;
    distanceKm: number | null;
    durationMinutes?: number | null;
    convenienceTier: "excellent" | "good" | "limited" | "poor" | "unknown";
    confidence: "high" | "medium" | "low" | "unknown";
  };
  roiInfluence: {
    influence: "positive" | "neutral" | "negative" | "mixed";
    reasons: string[];
    numericAdjustmentApplied: false;
  };
}

export interface BuiltEnvironmentExample {
  address: string | null;
  distanceM: number | null;
  buildYear: number | null;
  buildYearRange: string | null;
  status?: "old" | "modern" | "new" | "unknown";
}

export interface BuiltEnvironmentNearbyStatus {
  address: string | null;
  status: "old" | "modern" | "new" | "unknown";
  buildYear: number | null;
  buildYearRange: string | null;
  distanceM: number | null;
}

export interface BuiltEnvironmentContext {
  radiusM: number;
  assessedProperties: number;
  knownBuildYearCount: number;
  modernCount: number;
  post2000Count: number;
  oldCount: number;
  unknownCount: number;
  modernShare: number;
  post2000Share: number;
  medianBuildYear: number | null;
  subjectBuildYear: number | null;
  subjectBuildYearRange: string | null;
  signal: "last_missing_piece" | "mixed_renewal" | "older_environment" | "insufficient_data" | "unknown";
  confidence: "high" | "medium" | "low" | "unknown";
  reasons: string[];
  nearbyExamples: BuiltEnvironmentExample[];
  nearbyStatus?: BuiltEnvironmentNearbyStatus[];
  statusCounts?: {
    old: number;
    modern: number;
    new: number;
    unknown: number;
  };
  renewedShare?: number;
  newCount?: number;
}

/** MoE Schools Directory enrichment for home-zone listing text (Hougarden). */
export interface SchoolZoneDetail {
  level: "primary" | "intermediate" | "secondary" | "composite" | "other";
  sourceLabel: string;
  orgName: string | null;
  orgType: string | null;
  authority: string | null;
  authorityCategory: "public" | "state_integrated" | "private" | "unknown";
  equityIndex: string | null;
  enrolmentScheme: string | null;
  roll: number | null;
  matched: boolean;
  institutionType?: string | null;
  yearLevels?: string | null;
}

export interface FeasibilityReport {
  address: string;
  /** Server search-history row id when this report was persisted. */
  historyId?: string | null;
  /** Server-created timestamp for history ordering when available. */
  historyCreatedAt?: string | null;
  scores: Score;
  propertyOverview?: PropertyOverview;
  /** Deterministic "Land title" insight — present only for cross-lease/stratum titles. */
  titleInsight?: TitleInsight | null;
  planning?: PlanningInfo;
  potential_lots?: number;
  zone_label?: string;
  asbestos?: AsbestosInfo;
  terrain?: TerrainInfo;
  infrastructure?: InfrastructureService[];
  costItems?: CostItem[];
  totalCostLow?: number;
  totalCostHigh?: number;
  total_excludes_land?: boolean;
  cv_unavailable?: boolean;
  cost_per_unit_avg?: number;
  roiScenarios?: ROIScenario[];
  developmentStrategies?: DevelopmentStrategyScenario[];
  recommendedDevelopmentStrategy?: DevelopmentStrategyId | null;
  interest_rate_outlook?: "falling" | "stable" | "rising";
  comparableSales?: ComparableSale[];
  comparables_quality?: "live" | "estimated" | "unavailable";
  neighbourhoodContext?: NeighbourhoodContext | null;
  transportContext?: TransportContext | null;
  builtEnvironmentContext?: BuiltEnvironmentContext | null;
  avgPricePerSqm?: number | null;
  avg_sale_price?: number | null;
  /** Enriched state/intermediate/secondary zone schools (MoE directory). */
  schoolZones?: SchoolZoneDetail[];
  riskSummary?: string[];
  /** Listing claims conflicted with council records — parcel likely redeveloped. */
  redevelopmentWarning?: {
    suspected: boolean;
    councilBuildYear?: number | null;
    listingEvidence?: string[];
    reasons?: string[];
    message: string;
  } | null;
  /** When the underlying raw property data was acquired ("data as at"). */
  dataFreshness?: { acquiredAt: string; fromCache: boolean } | null;
  disclaimer?: string;
  overlay_map_image_base64?: string;
  data_sources?: Record<string, string>;
  missing_critical_fields?: string[];
  photoUrl?: string;
  photoUrls?: string[];
  /**
   * On-device file URIs of property photos already downloaded for this report.
   * Populated lazily by `lib/reportPhotoCache.ts` so the report still shows
   * the correct photograph after the original CDN URL has rotated. Persisted
   * with the session and cleared when the user deletes the report.
   */
  cachedPhotoUris?: string[];
  /** Signature of the remote report photo sources used to populate cachedPhotoUris. */
  cachedPhotoSignature?: string;
  selectedListingContext?: SelectedListingContext;
  combinedListingContext?: CombinedListingContext;
}

export interface FeasibilityReportGroup {
  kind: "combined_listing_group";
  packageAddress: string;
  childAddresses: string[];
  reports: FeasibilityReport[];
  failures?: Array<{ address: string; error: string }>;
  comparison: {
    summary: string;
    subdivisionView: string[];
    investmentView: string[];
    risks: string[];
    recommendedNextStep: string;
  };
  warnings?: string[];
  historyId?: string | null;
  historyCreatedAt?: string | null;
}

export interface PropertyCandidate {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  scores: Score;
  scoresLoading?: boolean;
  briefSummary?: string;
  potentialLots?: number;
  minLotSize?: number;
  standardVacantLots?: number;
  standardPathViable?: boolean;
  standardMinLotSize?: number | null;
  designLedEligible?: boolean;
  designLedYieldRange?: DesignLedYieldRange | null;
  designLedConfidence?: DesignLedConfidence;
  designLedReasons?: string[];
  designLedBlockers?: string[];
  designLedSummary?: string | null;
  designLedDetail?: string | null;
  photoUrl?: string;
  photoUrls?: string[];
  listingUrl?: string;
  priceDisplay?: string;
  propertyType?: string | null;
  listingTitle?: string | null;
  description?: string | null;
  features?: string[];
  agentName?: string | null;
  agencyName?: string | null;
  agentAvatarUrl?: string | null;
  agentPhone?: string | null;
  source?: "internal" | "curated";
  internalListingId?: string;
  isSponsored?: boolean;
  sponsoredLabel?: string;
  bedrooms?: number;
  bathrooms?: number;
  toilets?: number | null;
  garages?: number | null;
  /** True when listing sources disagreed on the count — render as "~3 bd". */
  bedroomsApprox?: boolean;
  bathroomsApprox?: boolean;
  /** True when listing sources disagreed on land area / price — render as "~503 m²" / "~$1.25M". */
  landAreaApprox?: boolean;
  landAreaSource?: "realestate_api" | "realestate_page" | "homes" | "linz" | "propertyvalue" | "unknown";
  landAreaConfidence?: "verified" | "unverified";
  isParentParcelSuspect?: boolean;
  isAlreadySubdividedChild?: boolean;
  priceApprox?: boolean;
  /**
   * True when `price` is an internal scoring placeholder (listing had no
   * source-backed asking price). Show `priceDisplay` text instead of the number.
   */
  priceIsPlaceholder?: boolean;
  /** Floor (dwelling) area in m². */
  floorArea?: number;
  floorAreaApprox?: boolean;
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
  typologyConfidence?: "verified" | "inferred" | "unknown";
  titleConfidence?: "verified" | "inferred" | "unknown";
  /** Land tenure for the card (e.g. "Freehold"); set only when title screening ran. */
  titleType?: string | null;
  /** "verified" = LINZ confirmed freehold; "unverified" = couldn't confirm (shown with caveat). */
  titleStatus?: "verified" | "unverified";
  /** Set when the user opted in to a non-freehold tenure: the card shows a warning chip about the subdivision catch instead of the freehold tick. */
  subdivisionTenureWarning?: "cross_lease" | "leasehold" | "unit_title";
  subdivisionEligible?: boolean;
  subdivisionRejectReason?: string | null;
  buildYear?: number | null;
  /** Listing claims conflicted with council records — parcel likely redeveloped. */
  redevelopmentSuspected?: boolean;
  screeningStatus?: "preliminary" | "verified";
  screeningNotes?: string[];
  builtEnvironmentContext?: BuiltEnvironmentContext | null;
  isCombinedListing?: boolean;
  packageAddress?: string;
  childAddresses?: string[];
  aggregateFactsExcluded?: boolean;
}

export interface SelectedListingContext {
  address?: string | null;
  listingUrl?: string | null;
  photoUrl?: string | null;
  photoUrls?: string[] | null;
  price?: number | null;
  landArea?: number | null;
  floorArea?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  bedroomsApprox?: boolean | null;
  bathroomsApprox?: boolean | null;
  landAreaApprox?: boolean | null;
  floorAreaApprox?: boolean | null;
  priceApprox?: boolean | null;
  propertyType?: string | null;
  listingTitle?: string | null;
  source?: string | null;
  isCombinedListing?: boolean | null;
  packageAddress?: string | null;
  childAddresses?: string[] | null;
  aggregateFactsExcluded?: boolean | null;
}

export interface CandidateScoreUpdate {
  ease: number;
  cost: number;
  roi: number;
  composite: number;
  landArea?: number;
  zone?: string | null;
  potentialLots?: number;
  minLotSize?: number | null;
  standardVacantLots?: number;
  standardPathViable?: boolean;
  standardMinLotSize?: number | null;
  designLedEligible?: boolean;
  designLedYieldRange?: DesignLedYieldRange | null;
  designLedConfidence?: DesignLedConfidence;
  designLedReasons?: string[];
  designLedBlockers?: string[];
  designLedSummary?: string | null;
  designLedDetail?: string | null;
  builtEnvironmentContext?: BuiltEnvironmentContext | null;
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  currentReport?: FeasibilityReport;
  currentReportGroup?: FeasibilityReportGroup;
  /** User rated the first LLM reply (thumbs up/down). */
  firstLlmResponseRating?: "up" | "down";
  /** Opened from History — skip first-turn rating prompt. */
  skipFirstTurnRating?: boolean;
}

interface ChatContextValue {
  sessions: Session[];
  currentSessionId: string | null;
  currentSession: Session | null;
  createSession: () => string;
  startNewChat: () => void;
  switchSession: (id: string) => void;
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => void;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>, sessionId?: string) => void;
  updateLastMessage: (updates: Partial<ChatMessage>, sessionId?: string) => void;
  updateLastMessageIfType: (expectedType: ChatMessage["type"], updates: Partial<ChatMessage>, sessionId?: string) => void;
  replaceBackgroundAnalyseMessage: (jobId: string, msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => void;
  removeMessage: (messageId: string, sessionId?: string) => void;
  updateCandidateScores: (
    scoreMap: Record<string, CandidateScoreUpdate>,
    sessionId?: string,
  ) => void;
  setCurrentReport: (report: FeasibilityReport) => void;
  setCurrentReportGroup: (group: FeasibilityReportGroup) => void;
  deleteSession: (id: string) => void;
  openHistoryReport: (address: string, report: FeasibilityReport) => string;
  openHistoryReportGroup: (address: string, group: FeasibilityReportGroup) => string;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  setFirstLlmResponseRating: (sessionId: string, rating: "up" | "down") => void;
  /** Increment to signal the server-side search history list may have new rows (e.g. after /analyse). */
  searchHistoryTick: number;
  bumpSearchHistory: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const BASE_STORAGE_KEY = "@devfeasible/sessions";

function getStorageKey(userId: string | null | undefined): string {
  return userId ? `${BASE_STORAGE_KEY}/${userId}` : BASE_STORAGE_KEY;
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

/** A session worth persisting/syncing: has at least one real (non-loading) message. */
function sessionHasContent(s: Session): boolean {
  return s.messages.some((m) => m.type !== "loading" && m.content.length > 0);
}

/** Strip on-device-only fields (file URIs invalid on other devices) before syncing. */
function stripReportForSync<T extends FeasibilityReport | undefined>(report: T): T {
  if (!report) return report;
  const { cachedPhotoUris, cachedPhotoSignature, ...rest } = report;
  return rest as T;
}

function stripGroupForSync(group?: FeasibilityReportGroup): FeasibilityReportGroup | undefined {
  if (!group) return group;
  return { ...group, reports: group.reports.map((r) => stripReportForSync(r)) };
}

/**
 * Serialisable copy of a session for cross-device sync: drops transient loading
 * bubbles and on-device photo cache paths. The full conversation (every text,
 * report, search result and provider card) is otherwise preserved verbatim.
 */
function stripSessionForSync(s: Session): Session {
  return {
    ...s,
    currentReport: stripReportForSync(s.currentReport),
    currentReportGroup: stripGroupForSync(s.currentReportGroup),
    messages: s.messages
      .filter((m) => m.type !== "loading")
      .map((m) => {
        if (m.type === "report" && m.report) return { ...m, report: stripReportForSync(m.report) };
        if (m.type === "report_group" && m.reportGroup) return { ...m, reportGroup: stripGroupForSync(m.reportGroup)! };
        return m;
      }),
  };
}

type RemoteConversation = {
  id: string;
  title?: string;
  data?: Partial<Session>;
  updatedAt?: number | null;
  createdAt?: number | null;
};

/** Rebuild a Session from a server-synced conversation row. */
function hydrateRemoteSession(rc: RemoteConversation): Session {
  const data = (rc.data && typeof rc.data === "object" ? rc.data : {}) as Partial<Session>;
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const updatedAt =
    typeof data.updatedAt === "number" ? data.updatedAt : typeof rc.updatedAt === "number" ? rc.updatedAt : Date.now();
  const createdAt =
    typeof data.createdAt === "number" ? data.createdAt : typeof rc.createdAt === "number" ? rc.createdAt : updatedAt;
  return {
    ...data,
    id: rc.id,
    title: (typeof data.title === "string" && data.title) || rc.title || "",
    messages,
    createdAt,
    updatedAt,
  } as Session;
}

function normaliseAddressKey(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function addressMatchKeys(address: string): string[] {
  const full = normaliseAddressKey(address);
  const streetPart = address.split(",")[0]?.trim() ?? "";
  const street = /\d/.test(streetPart) ? normaliseAddressKey(streetPart) : "";
  return Array.from(new Set([full, street].filter(Boolean)));
}

/** True if the string contains no CJK characters — used to detect untranslated English fields. */
function isEnglishText(s: unknown): boolean {
  if (typeof s !== "string" || !s.trim()) return false;
  return !/[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
}

/** True when a report has at least one LLM-narrative field still in English (ASCII-only prose). */
function reportHasEnglishNarrative(report: FeasibilityReport): boolean {
  const scores = report.scores;
  if (scores) {
    for (const key of ["ease_reasons", "cost_reasons", "roi_reasons"] as const) {
      const arr = scores[key];
      if (Array.isArray(arr) && arr.some((x) => isEnglishText(x))) return true;
    }
  }
  const planning = report.planning;
  if (planning) {
    if (isEnglishText(planning.subdivisionPathwayNote)) return true;
    if (isEnglishText(planning.subdivisionSummary)) return true;
    if (isEnglishText(planning.designLedSummary)) return true;
    if (isEnglishText(planning.designLedDetail)) return true;
    if (Array.isArray(planning.designLedReasons) && planning.designLedReasons.some((x) => isEnglishText(x))) return true;
    if (Array.isArray(planning.designLedBlockers) && planning.designLedBlockers.some((x) => isEnglishText(x))) return true;
    if (isEnglishText(planning.easement_summary)) return true;
    if (Array.isArray(planning.overlays)) {
      for (const o of planning.overlays) {
        if (isEnglishText(o.detail)) return true;
      }
    }
  }
  if (report.riskSummary?.some((r) => isEnglishText(r))) return true;
  if (isEnglishText(report.disclaimer)) return true;
  if (isEnglishText(report.neighbourhoodContext?.marketAdjustment?.reason)) return true;
  if (report.neighbourhoodContext?.reasons?.some((r) => isEnglishText(r))) return true;
  if (report.transportContext?.roiInfluence?.reasons?.some((r) => isEnglishText(r))) return true;
  if (isEnglishText(report.asbestos?.notes)) return true;
  if (isEnglishText(report.propertyOverview?.titleType)) return true;
  if (isEnglishText(report.terrain?.slope)) return true;

  if (report.costItems?.some((ci) => isEnglishText(ci.label))) return true;

  const strategies = report.developmentStrategies;
  if (strategies?.length) {
    for (const s of strategies) {
      const zhRationale =
        typeof s.rationale_zh === "string" && s.rationale_zh.trim().length > 0 && !isEnglishText(s.rationale_zh);
      if (!zhRationale && isEnglishText(s.rationale)) return true;
      if (typeof s.rationale_zh === "string" && s.rationale_zh.trim() && isEnglishText(s.rationale_zh)) return true;
      if (s.assumptions?.some((a) => isEnglishText(a))) return true;
      if (s.costItems?.some((ci) => isEnglishText(ci.label))) return true;
    }
  }

  return false;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user, getApiHeaders } = useAuth();
  const userId = user?.id ?? null;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchHistoryTick, setSearchHistoryTick] = useState(0);

  // Cross-device conversation sync bookkeeping.
  // syncedUpdatedAtRef: last updatedAt we successfully pushed (or pulled) per
  // session id, so we only push genuinely-changed conversations.
  const syncedUpdatedAtRef = useRef<Map<string, number>>(new Map());
  // pullDone: gates pushes until the initial server pull has merged, so a
  // fresh-install device doesn't overwrite server state before reading it.
  // State (not a ref) so the push effect re-runs and flushes the moment the
  // pull completes, even for conversations started during the pull window.
  const [pullDone, setPullDone] = useState(false);
  const getApiHeadersRef = useRef(getApiHeaders);
  getApiHeadersRef.current = getApiHeaders;

  const bumpSearchHistory = useCallback(() => {
    setSearchHistoryTick((n) => n + 1);
  }, []);

  const saveSessions = useCallback((newSessions: Session[]) => {
    const storageKey = getStorageKey(userId);
    const withMessages = newSessions.filter(
      (s) => s.messages.some((m) => m.type !== "loading" && m.content.length > 0),
    );
    AsyncStorage.setItem(storageKey, JSON.stringify(withMessages));
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const storageKey = getStorageKey(userId);
    setSessions([]);
    setCurrentSessionId(null);
    // Different user → re-evaluate every report's photo cache once and reset
    // the cross-device sync bookkeeping.
    photoCacheAttemptsRef.current = new Set();
    syncedUpdatedAtRef.current = new Map();
    setPullDone(false);

    (async () => {
      // 1) Load this device's locally-cached conversations first for instant UI.
      let localSessions: Session[] = [];
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as Session[];
          localSessions = parsed.filter(sessionHasContent);
        }
      } catch {}
      if (cancelled) return;
      setSessions(localSessions);
      if (localSessions.length > 0) setCurrentSessionId(localSessions[0].id);

      // 2) Pull conversations saved from any device and merge (last-write-wins).
      if (userId) {
        try {
          const resp = await fetch(`${getApiBase()}/conversations`, { headers: getApiHeadersRef.current() });
          if (resp.ok) {
            const data = (await resp.json()) as { conversations?: RemoteConversation[] };
            if (!cancelled && Array.isArray(data.conversations) && data.conversations.length > 0) {
              const remote = data.conversations;
              setSessions((prev) => {
                const byId = new Map(prev.map((s) => [s.id, s]));
                let changed = false;
                for (const rc of remote) {
                  if (!rc || typeof rc.id !== "string") continue;
                  const remoteUpdated = typeof rc.updatedAt === "number" ? rc.updatedAt : 0;
                  const local = byId.get(rc.id);
                  if (!local) {
                    const hydrated = hydrateRemoteSession(rc);
                    if (!sessionHasContent(hydrated)) continue;
                    byId.set(rc.id, hydrated);
                    syncedUpdatedAtRef.current.set(rc.id, hydrated.updatedAt);
                    changed = true;
                  } else if (remoteUpdated > (local.updatedAt ?? 0)) {
                    const hydrated = hydrateRemoteSession(rc);
                    byId.set(rc.id, hydrated);
                    syncedUpdatedAtRef.current.set(rc.id, hydrated.updatedAt);
                    changed = true;
                  } else if (remoteUpdated === (local.updatedAt ?? 0)) {
                    // Already in sync — record so we don't redundantly re-push.
                    syncedUpdatedAtRef.current.set(rc.id, local.updatedAt ?? 0);
                  }
                  // else: local copy is newer → leave it for the push effect.
                }
                if (!changed) return prev;
                const merged = Array.from(byId.values()).sort(
                  (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
                );
                saveSessions(merged);
                return merged;
              });
              // Open the most recent conversation if the device had none locally.
              setCurrentSessionId((prev) => {
                if (prev) return prev;
                const newest = [...remote]
                  .filter((rc) => rc && typeof rc.id === "string")
                  .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
                return newest?.id ?? null;
              });
            }
          }
        } catch {}
      }
      if (!cancelled) setPullDone(true);
    })();

    return () => { cancelled = true; };
  }, [userId, saveSessions]);

  // Push locally-changed conversations to the server (debounced) so they're
  // available on the user's other devices. Runs only after the initial pull so
  // a fresh device can't clobber server state before reading it.
  useEffect(() => {
    if (!userId || !pullDone) return;
    const changed = sessions.filter(
      (s) => sessionHasContent(s) && syncedUpdatedAtRef.current.get(s.id) !== s.updatedAt,
    );
    if (changed.length === 0) return;

    const handle = setTimeout(async () => {
      const snapshot = changed.map((s) => ({ id: s.id, updatedAt: s.updatedAt }));
      try {
        const resp = await fetch(`${getApiBase()}/conversations`, {
          method: "POST",
          headers: { ...getApiHeadersRef.current(), "Content-Type": "application/json" },
          body: JSON.stringify({
            conversations: changed.map((s) => ({
              id: s.id,
              title: s.title,
              updatedAt: s.updatedAt,
              createdAt: s.createdAt,
              messageCount: s.messages.filter((m) => m.type !== "loading").length,
              data: stripSessionForSync(s),
            })),
          }),
        });
        if (resp.ok) {
          for (const snap of snapshot) syncedUpdatedAtRef.current.set(snap.id, snap.updatedAt);
        }
      } catch {}
    }, 1500);

    return () => clearTimeout(handle);
  }, [sessions, userId, pullDone]);

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  const createSession = useCallback(() => {
    const id = generateId();
    const newSession: Session = {
      id,
      title: "New Analysis",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => {
      const updated = [newSession, ...prev];
      saveSessions(updated);
      return updated;
    });
    setCurrentSessionId(id);
    return id;
  }, [saveSessions]);

  const startNewChat = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const switchSession = useCallback((id: string) => {
    setCurrentSessionId(id);
  }, []);

  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => {
      const fullMsg: ChatMessage = {
        ...msg,
        id: generateId(),
        timestamp: Date.now(),
      };
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const newMessages = [...s.messages, fullMsg];
          let title = s.title;
          if (s.messages.length === 0 && msg.role === "user") {
            title = msg.content.slice(0, 40) + (msg.content.length > 40 ? "…" : "");
          }
          return { ...s, messages: newMessages, title, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const updateLastMessage = useCallback(
    (updates: Partial<ChatMessage>, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = [...s.messages];
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], ...updates };
          }
          return { ...s, messages, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          let changed = false;
          const messages = s.messages.map((m) => {
            if (m.id !== messageId) return m;
            changed = true;
            return { ...m, ...updates };
          });
          return changed ? { ...s, messages, updatedAt: Date.now() } : s;
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  /**
   * Like updateLastMessage but only writes if the last message is still of
   * the expected `type`. Used by background hint requests that race the main
   * chat response — once the loading bubble is replaced, attaching extra
   * fields to the new bubble would be wrong.
   */
  const updateLastMessageIfType = useCallback(
    (expectedType: ChatMessage["type"], updates: Partial<ChatMessage>, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = [...s.messages];
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0 && messages[lastIdx].type === expectedType) {
            messages[lastIdx] = { ...messages[lastIdx], ...updates };
          }
          return { ...s, messages, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const replaceBackgroundAnalyseMessage = useCallback(
    (jobId: string, msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => {
      if (!jobId) return;
      const fullMsg: ChatMessage = {
        ...msg,
        id: generateId(),
        timestamp: Date.now(),
      };
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        let shouldSave = false;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const currentReport = msg.type === "report" && msg.report ? msg.report : s.currentReport;
          const currentReportGroup = msg.type === "report_group" && msg.reportGroup ? msg.reportGroup : s.currentReportGroup;
          const idx = s.messages.findIndex((m) => m.backgroundJobId === jobId);
          if (idx < 0) {
            shouldSave = true;
            // Preserve backgroundJobId on the appended message too, so a later
            // re-render of the same completed job REPLACES this one in place
            // instead of appending a second copy (the duplicate-message bug).
            return { ...s, messages: [...s.messages, { ...fullMsg, backgroundJobId: jobId }], currentReport, currentReportGroup, updatedAt: Date.now() };
          }
          const messages = [...s.messages];
          const existing = messages[idx]!;
          messages[idx] = {
            ...fullMsg,
            id: existing.id,
            timestamp: existing.timestamp,
            // Keep the job id on the resolved message so repeat renders are
            // idempotent (findIndex above still matches → replace, never append).
            backgroundJobId: jobId,
          };
          shouldSave = true;
          return { ...s, messages, currentReport, currentReportGroup, updatedAt: Date.now() };
        });
        if (shouldSave) saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const removeMessage = useCallback(
    (messageId: string, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = s.messages.filter((m) => m.id !== messageId);
          if (messages.length === s.messages.length) return s;
          return { ...s, messages, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const updateCandidateScores = useCallback(
    (
      scoreMap: Record<string, CandidateScoreUpdate>,
      sessionId?: string,
    ) => {
      const normMap: Record<string, CandidateScoreUpdate> = {};
      for (const [addr, data] of Object.entries(scoreMap)) {
        for (const key of addressMatchKeys(addr)) {
          normMap[key] = data;
        }
      }
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = s.messages.map((m) => {
            if (m.type !== "search" || !m.searchResults) return m;
            const updatedResults = m.searchResults.map((c) => {
              const update = addressMatchKeys(c.address).map((key) => normMap[key]).find(Boolean);
              if (!update) return c;
              const {
                landArea,
                zone,
                potentialLots,
                minLotSize,
                standardVacantLots,
                standardPathViable,
                standardMinLotSize,
                designLedEligible,
                designLedYieldRange,
                designLedConfidence,
                designLedReasons,
                designLedBlockers,
                designLedSummary,
                designLedDetail,
                builtEnvironmentContext,
                ...scoreFields
              } = update;
              return {
                ...c,
                scores: { ...c.scores, ...scoreFields },
                scoresLoading: false,
                ...(landArea != null ? { landArea } : {}),
                ...(zone != null ? { zone } : {}),
                ...(potentialLots != null ? { potentialLots } : {}),
                ...(minLotSize !== undefined ? { minLotSize: minLotSize ?? undefined } : {}),
                ...(standardVacantLots != null ? { standardVacantLots } : {}),
                ...(standardPathViable !== undefined ? { standardPathViable } : {}),
                ...(standardMinLotSize !== undefined ? { standardMinLotSize } : {}),
                ...(designLedEligible !== undefined ? { designLedEligible } : {}),
                ...(designLedYieldRange !== undefined ? { designLedYieldRange } : {}),
                ...(designLedConfidence !== undefined ? { designLedConfidence } : {}),
                ...(designLedReasons !== undefined ? { designLedReasons } : {}),
                ...(designLedBlockers !== undefined ? { designLedBlockers } : {}),
                ...(designLedSummary !== undefined ? { designLedSummary } : {}),
                ...(designLedDetail !== undefined ? { designLedDetail } : {}),
                ...(builtEnvironmentContext !== undefined ? { builtEnvironmentContext } : {}),
              };
            });
            return { ...m, searchResults: updatedResults };
          });
          return { ...s, messages, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const setCurrentReport = useCallback(
    (report: FeasibilityReport) => {
      setSessions((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          return { ...s, currentReport: report, currentReportGroup: undefined };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const setCurrentReportGroup = useCallback(
    (group: FeasibilityReportGroup) => {
      setSessions((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          return { ...s, currentReportGroup: group, currentReport: group.reports[0] };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const setFirstLlmResponseRating = useCallback(
    (sessionId: string, rating: "up" | "down") => {
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === sessionId ? { ...s, firstLlmResponseRating: rating, updatedAt: Date.now() } : s,
        );
        saveSessions(updated);
        return updated;
      });
    },
    [saveSessions],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== id);
        saveSessions(updated);
        return updated;
      });
      if (currentSessionId === id) {
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.id !== id);
          setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null);
          return prev;
        });
      }
      // Drop on-device property photos owned by this session so they don't
      // linger after the user deletes the report.
      deleteReportPhotos(id).catch(() => {});
      // Remove the synced copy so the conversation doesn't return on the next
      // cross-device pull.
      syncedUpdatedAtRef.current.delete(id);
      if (userId) {
        fetch(`${getApiBase()}/conversations/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: getApiHeadersRef.current(),
        }).catch(() => {});
      }
    },
    [currentSessionId, saveSessions, userId],
  );

  // Tracks reports we've already attempted to cache photos for, keyed by
  // `${sessionId}::${messageId|"current"}::${photoSignature}`. Lets the effect
  // below run safely on every session mutation without re-downloading or
  // hammering Street View when an attempt yielded zero usable photos.
  const photoCacheAttemptsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    type Pending = {
      sessionId: string;
      messageId: string | null;
      report: FeasibilityReport;
      attemptKey: string;
    };

    const pending: Pending[] = [];
    for (const session of sessions) {
      const collect = (report: FeasibilityReport, messageId: string | null) => {
        const sig = reportPhotoSignature(report);
        if ((report.cachedPhotoUris?.length ?? 0) > 0 && report.cachedPhotoSignature === sig) return;
        const attemptKey = `${session.id}::${messageId ?? "current"}::${sig}`;
        if (photoCacheAttemptsRef.current.has(attemptKey)) return;
        pending.push({ sessionId: session.id, messageId, report, attemptKey });
      };
      if (session.currentReport) collect(session.currentReport, null);
      if (session.currentReportGroup) {
        for (const report of session.currentReportGroup.reports) collect(report, null);
      }
      for (const msg of session.messages) {
        if (msg.type === "report" && msg.report) collect(msg.report, msg.id);
        if (msg.type === "report_group" && msg.reportGroup) {
          for (const report of msg.reportGroup.reports) collect(report, msg.id);
        }
      }
    }

    if (pending.length === 0) return;

    for (const item of pending) {
      photoCacheAttemptsRef.current.add(item.attemptKey);
    }

    void (async () => {
      for (const item of pending) {
        if (cancelled) return;
        const uris = await cacheReportPhotos(item.sessionId, item.report);
        if (cancelled || uris.length === 0) continue;

        setSessions((prev) => {
          let mutated = false;
          const next = prev.map((s) => {
            if (s.id !== item.sessionId) return s;

            let updatedSession = s;
            const patch = (target: FeasibilityReport): FeasibilityReport => ({
              ...target,
              cachedPhotoUris: uris,
              cachedPhotoSignature: reportPhotoSignature(item.report),
            });

            if (
              item.messageId === null &&
              s.currentReport &&
              reportPhotoSignature(s.currentReport) === reportPhotoSignature(item.report) &&
              s.currentReport.cachedPhotoSignature !== reportPhotoSignature(item.report)
            ) {
              updatedSession = { ...updatedSession, currentReport: patch(s.currentReport) };
              mutated = true;
            }
            if (item.messageId === null && s.currentReportGroup) {
              let groupChanged = false;
              const reports = s.currentReportGroup.reports.map((report) => {
                if (
                  reportPhotoSignature(report) !== reportPhotoSignature(item.report) ||
                  report.cachedPhotoSignature === reportPhotoSignature(item.report)
                ) {
                  return report;
                }
                groupChanged = true;
                return patch(report);
              });
              if (groupChanged) {
                updatedSession = { ...updatedSession, currentReportGroup: { ...s.currentReportGroup, reports } };
                mutated = true;
              }
            }

            if (item.messageId !== null) {
              let messagesChanged = false;
              const newMessages = s.messages.map((m) => {
                if (m.id !== item.messageId) return m;
                if (m.report) {
                  if (m.report.cachedPhotoSignature === reportPhotoSignature(item.report)) return m;
                  messagesChanged = true;
                  return { ...m, report: patch(m.report) };
                }
                if (m.reportGroup) {
                  let groupChanged = false;
                  const reports = m.reportGroup.reports.map((report) => {
                    if (
                      reportPhotoSignature(report) !== reportPhotoSignature(item.report) ||
                      report.cachedPhotoSignature === reportPhotoSignature(item.report)
                    ) {
                      return report;
                    }
                    groupChanged = true;
                    return patch(report);
                  });
                  if (!groupChanged) return m;
                  messagesChanged = true;
                  return { ...m, reportGroup: { ...m.reportGroup, reports } };
                }
                return m;
              });
              if (messagesChanged) {
                updatedSession = { ...updatedSession, messages: newMessages };
                mutated = true;
              }
            }

            return updatedSession;
          });

          if (!mutated) return prev;
          saveSessions(next);
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessions, saveSessions]);

  // When the device locale is zh, back-translate any cached report messages
  // whose narrative fields are still in English (generated before translation
  // was active). Runs once per session change; skips reports already translated.
  const translatedReportIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (getCurrentLocale() !== "zh") return;
    let cancelled = false;
    (async () => {
      const headers = getApiHeaders();
      for (const session of sessions) {
        for (const msg of session.messages) {
          if (msg.type !== "report" || !msg.report) continue;
          const key = `${session.id}::${msg.id}`;
          if (translatedReportIdsRef.current.has(key)) continue;
          if (!reportHasEnglishNarrative(msg.report)) {
            translatedReportIdsRef.current.add(key);
            continue;
          }
          const translated = await translateReportViaApi(msg.report, headers);
          if (cancelled) return;
          if (!translated) {
            translatedReportIdsRef.current.add(key);
            continue;
          }
          translatedReportIdsRef.current.add(key);
          setSessions((prev) => {
            const next = prev.map((s) => {
              if (s.id !== session.id) return s;
              const newMessages = s.messages.map((m) =>
                m.id === msg.id ? { ...m, report: translated } : m,
              );
              const newCurrentReport =
                s.currentReport && reportHasEnglishNarrative(s.currentReport)
                  ? translated
                  : s.currentReport;
              return { ...s, messages: newMessages, currentReport: newCurrentReport };
            });
            saveSessions(next);
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessions, getApiHeaders, saveSessions]);

  const openHistoryReport = useCallback(
    (address: string, report: FeasibilityReport): string => {
      const now = Date.now();
      const sessionId = generateId();
      const newSession: Session = {
        id: sessionId,
        title: address.slice(0, 50),
        messages: [
          {
            id: generateId(),
            role: "user",
            content: address,
            timestamp: now,
            type: "text",
          },
          {
            id: generateId(),
            role: "assistant",
            content: "",
            timestamp: now + 1,
            type: "report",
            report,
          },
        ],
        createdAt: now,
        updatedAt: now,
        currentReport: report,
        skipFirstTurnRating: true,
      };
      setSessions((prev) => {
        const updated = [newSession, ...prev];
        saveSessions(updated);
        return updated;
      });
      setCurrentSessionId(sessionId);
      return sessionId;
    },
    [saveSessions],
  );

  const openHistoryReportGroup = useCallback(
    (address: string, group: FeasibilityReportGroup): string => {
      const now = Date.now();
      const sessionId = generateId();
      const newSession: Session = {
        id: sessionId,
        title: address.slice(0, 50),
        messages: [
          {
            id: generateId(),
            role: "user",
            content: address,
            timestamp: now,
            type: "text",
          },
          {
            id: generateId(),
            role: "assistant",
            content: "",
            timestamp: now + 1,
            type: "report_group",
            reportGroup: group,
          },
        ],
        createdAt: now,
        updatedAt: now,
        currentReport: group.reports[0],
        currentReportGroup: group,
        skipFirstTurnRating: true,
      };
      setSessions((prev) => {
        const updated = [newSession, ...prev];
        saveSessions(updated);
        return updated;
      });
      setCurrentSessionId(sessionId);
      return sessionId;
    },
    [saveSessions],
  );

  return (
    <ChatContext.Provider
      value={{
        sessions,
        currentSessionId,
        currentSession,
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
        deleteSession,
        openHistoryReport,
        openHistoryReportGroup,
        isLoading,
        setIsLoading,
        setFirstLlmResponseRating,
        searchHistoryTick,
        bumpSearchHistory,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
