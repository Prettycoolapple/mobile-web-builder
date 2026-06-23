/**
 * Web mirror of the mobile ChatContext data model
 * (artifacts/mobile/context/ChatContext.tsx). These interfaces are the shape of
 * the `data` blob synced to GET/POST /conversations, so they MUST stay
 * structurally compatible with mobile — a session written here has to render in
 * the mobile History page and vice-versa.
 *
 * On-device-only fields the mobile app adds (cachedPhotoUris/cachedPhotoSignature)
 * are intentionally omitted here; we never produce them on web.
 */

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

export interface LoadingHint {
  kind: "wide_scan_subdivision";
  etaSecondsMin: number;
  etaSecondsMax: number;
}

export type MessageType =
  | "text"
  | "report"
  | "report_group"
  | "search"
  | "loading"
  | "provider_recommendation"
  | "provider_upgrade_gate"
  | "agent_contact"
  | "subdivision_clarification"
  | "address_clarification"
  | "discovery_exhausted_choice";

export interface Clarification {
  question: string;
  options: string[];
  optionActions?: Array<"repeat_origin" | "search_nearby" | "include_tenures">;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type: MessageType;
  clarification?: Clarification;
  tenureOfferTenures?: Array<"cross_lease" | "leasehold" | "unit_title">;
  loadingMode?: "analyse" | "discover" | "followup";
  loadingHint?: LoadingHint;
  retryLabel?: string;
  retryText?: string;
  report?: FeasibilityReport;
  reportGroup?: FeasibilityReportGroup;
  searchResults?: PropertyCandidate[];
  searchPresentation?: "generic_listing" | "scored_screening";
  suburb?: string;
  continuationToken?: string | null;
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
  agentMatchType?: "subject" | "suburb" | null;
  agentListingUrl?: string | null;
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
  propertyType?: string | null;
  siteStatus?: "vacant_land" | "has_dwelling" | "unknown";
  siteStatusLabel?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  zone?: string;
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
  statusCounts?: { old: number; modern: number; new: number; unknown: number };
  renewedShare?: number;
  newCount?: number;
}

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
  historyId?: string | null;
  historyCreatedAt?: string | null;
  scores: Score;
  propertyOverview?: PropertyOverview;
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
  schoolZones?: SchoolZoneDetail[];
  riskSummary?: string[];
  redevelopmentWarning?: {
    suspected: boolean;
    councilBuildYear?: number | null;
    listingEvidence?: string[];
    reasons?: string[];
    message: string;
  } | null;
  dataFreshness?: { acquiredAt: string; fromCache: boolean } | null;
  disclaimer?: string;
  overlay_map_image_base64?: string;
  data_sources?: Record<string, string>;
  missing_critical_fields?: string[];
  photoUrl?: string;
  photoUrls?: string[];
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
  bedroomsApprox?: boolean;
  bathroomsApprox?: boolean;
  landAreaApprox?: boolean;
  landAreaSource?: "realestate_api" | "realestate_page" | "homes" | "linz" | "propertyvalue" | "unknown";
  landAreaConfidence?: "verified" | "unverified";
  isParentParcelSuspect?: boolean;
  isAlreadySubdividedChild?: boolean;
  priceApprox?: boolean;
  priceIsPlaceholder?: boolean;
  floorArea?: number;
  floorAreaApprox?: boolean;
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
  typologyConfidence?: "verified" | "inferred" | "unknown";
  titleConfidence?: "verified" | "inferred" | "unknown";
  titleType?: string | null;
  titleStatus?: "verified" | "unverified";
  subdivisionTenureWarning?: "cross_lease" | "leasehold" | "unit_title";
  subdivisionEligible?: boolean;
  subdivisionRejectReason?: string | null;
  buildYear?: number | null;
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
  firstLlmResponseRating?: "up" | "down";
  skipFirstTurnRating?: boolean;
}

/** Selected-listing context from a candidate, used to seed full analysis. */
export function selectedListingContextFromCandidate(c: PropertyCandidate): SelectedListingContext {
  return {
    address: c.address,
    listingUrl: c.listingUrl ?? null,
    photoUrl: c.photoUrl ?? c.photoUrls?.[0] ?? null,
    photoUrls: c.photoUrls ?? (c.photoUrl ? [c.photoUrl] : []),
    price: c.priceIsPlaceholder ? null : c.price ?? null,
    landArea: c.landArea ?? null,
    floorArea: c.floorArea ?? null,
    bedrooms: c.bedrooms ?? null,
    bathrooms: c.bathrooms ?? null,
    bedroomsApprox: c.bedroomsApprox ?? null,
    bathroomsApprox: c.bathroomsApprox ?? null,
    landAreaApprox: c.landAreaApprox ?? null,
    floorAreaApprox: c.floorAreaApprox ?? null,
    priceApprox: c.priceApprox ?? null,
    propertyType: c.propertyType ?? null,
    listingTitle: c.listingTitle ?? null,
    source: c.source ?? null,
    isCombinedListing: c.isCombinedListing ?? null,
    packageAddress: c.packageAddress ?? null,
    childAddresses: c.childAddresses ?? null,
    aggregateFactsExcluded: c.aggregateFactsExcluded ?? null,
  };
}

export function isFeasibilityReportGroup(value: unknown): value is FeasibilityReportGroup {
  return (
    !!value &&
    typeof value === "object" &&
    (value as FeasibilityReportGroup).kind === "combined_listing_group" &&
    Array.isArray((value as FeasibilityReportGroup).reports)
  );
}

export function isFeasibilityReport(p: unknown): p is FeasibilityReport {
  return !!p && typeof p === "object" && ("scores" in (p as object) || "address" in (p as object));
}
