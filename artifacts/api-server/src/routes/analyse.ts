import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, profiles, searches, feasibilityJobs, screeningJobs, salesAgentProfiles, listings, discoveryContinuations, withDbRetry, type DiscoveryContinuationState } from "@workspace/db";
import { agentAiUnlimited } from "../lib/agent-entitlements";
import { logger } from "../lib/logger";
import {
  generateFeasibilityReport,
  generateSearchResults,
  generateChatReply,
  generateUnifiedResponse,
  generateAnalysis,
  detectMode,
  extractChatIntent,
  inferLikelySuburbForUnresolvedProperty,
  hasNumberedStreetAddress,
  hasNonStandardSalePropertyReference,
  hasUnnumberedStreetLine,
  isListingBrowseIntent,
  isListingBrowseContinuation,
  sanitizeAssistantProse,
  resolveDelegatedDiscoverSuburb,
  detectFilterSpecFromText,
  Message,
  type ChatIntent,
} from "../lib/claude";
import { signToken, verifyActiveToken } from "../lib/auth";
import { extractNZAddress } from "../lib/address-parser";
import {
  extractCombinedListingAddressParts,
  fetchRealestateAgentForListingUrl,
  fetchRealestateListingByUrl,
  findSuburbInTextViaIndex,
  findLocationInTextViaIndex,
  getDistrictSiblings,
  findSuburbId,
  resolveRealestateLocation,
  resolveLocationToSuburbNames,
  type RealestateLocationResolution,
} from "../lib/scrapers/realestate-api";
import { suggestNearbySuburbs } from "../lib/claude";
import { runPropertyPipeline, hasCacheableCore, type PipelineResult } from "../lib/pipeline";
import { normaliseDiscoveryAddressKey } from "../lib/address-key";
import { getCachedRaw, upsertCachedRaw, bumpHitCount, backfillDerivedScores, PIPELINE_VERSION } from "../lib/property-cache";
import { upsertFeatureRowFromPipeline } from "../lib/property-feature-index";
import { shouldBackfillDerivedScores } from "../lib/derived-scores-backfill";
import { runCriteriaSearch, buildCriteriaSearchIntro, buildCriteriaSearchEmptyMessage } from "../lib/criteria-search";
import { detectPropertyDataLookup, buildPropertyDataLookupAnswer } from "../lib/property-data-lookup";
import { buildSitePlanForReport, SitePlanNoLocationError, fetchAerialTile, type GeoHint } from "../lib/site-plan";
import { dwellingConditionRiskBullet } from "../lib/dwelling-condition";
import { noteUserActivity } from "../lib/user-activity";
import { buildSubdivisionPathwayNote } from "../lib/lot-calculator";
import {
  canonicalBuildYearFromReport,
  filterRiskSummaryRemoveAsbestosBullets,
  filterRiskSummaryRemoveComparableReliabilityBullets,
  filterRiskSummaryRemoveIncompleteDataDisclaimerBullets,
  sanitizeReportScoresReasons,
} from "../lib/risk-summary";
import { ensureMinRiskSummaryBulletsFromReport, buildCrossLeaseRiskBullets, buildVeoliaRiskBullets, buildTitleInsight, isCrossLeaseEstate, type RiskBackfillContext } from "../lib/report-risk-backfill";
import { detectSubdivision, mergeSubdivisionCorrection } from "../lib/subdivision";
import { formatNZD } from "../lib/utils";
import { searchRealEstateListings, resolveDistrictToSuburbs, detectDirectionalAreaTerm } from "../lib/scrapers/realestate-search";
import { preScreenListingsFastDetailed, type PropertyCandidate } from "../lib/pre-screen";
import { isLinzTitleServiceAvailable } from "../lib/linz";
import {
  hasStandardSubdivisionYield,
  isDevelopmentDiscoveryIntent,
  isStandardSubdivisionDiscoveryIntent,
  shouldContinueDiscoveryDrain,
} from "../lib/discovery-intent";
import { parseOfferedTenuresFromAssistant, isBareTenureAffirmation, type Tenure } from "../lib/tenure-optin";
import {
  passesPreliminaryStandardSubdivisionScreen,
} from "../lib/discovery-land-area";
import {
  makeCacheKey,
  setListingCache,
  popNextListings,
  markShown,
  getShownUrls,
  getListingCache,
  restoreListingsAfterPop,
  getRemainingCount,
  addExcludedNonFreehold,
  getExcludedNonFreehold,
} from "../lib/listing-cache";
import type { ListingResult } from "../lib/scrapers/oneroof";
import { queueBackgroundScores, getCardScores } from "../lib/analysis-cache";
import { normaliseLocale } from "../lib/prompts";
import { terrainSlopeText, type TerrainContour } from "../lib/terrain-slope-copy";
import { buildListingTeaser } from "../lib/listing-teaser";
import { prioritizeSponsoredGenericCandidates } from "../lib/sponsored-ordering";
import { translateChatContent, translateReportNarrative, ensureChinese } from "../lib/translation";
import { assistantTrustResponseFor } from "../lib/assistant-trust-responses";
import {
  normaliseSelectedListingContext,
  applySelectedListingContextToReport,
  selectedListingContextFromHistory,
  selectedListingContextToHistoryMarker,
  selectedListingPhotoUrls,
  reconcileSelectedListingContextWithLiveListing,
  type SelectedListingContext,
} from "../lib/selected-listing-context";
import { resolveActiveListingContext } from "../lib/active-listing-context";
import { resolveAddressForAnalysis } from "../lib/address-clarification";
import { looksLikeUnitOrApartmentAddress } from "../lib/address-patterns";
import { buildPostAnalysisAnswers } from "../lib/post-analysis-answer";
import { buildReportFollowUpFallback } from "../lib/report-followup-fallback";
import { detectProviderRecommendationIntent } from "../lib/provider-recommendation-intent";
import { tryGeocodeAddress } from "../lib/geocode";
import {
  buildNearbyAmenityRequest,
  detectNearbyAmenityIntent,
  fetchNearbyAmenities,
  renderNearbyAmenitiesAnswer,
  reportSchoolZonesToAmenityResults,
  type NearbyAmenityTarget,
  type ReportSchoolZoneSummary,
} from "../lib/nearby-amenities";
import {
  buildRecentSalesQuery,
  detectRecentSalesIntent,
  fetchRecentSales,
  isRecentSalesContinuationText,
  renderRecentSalesTable,
  type RecentSaleRecord,
  type RecentSalesLocation,
} from "../lib/recent-sales";
import {
  CHAT_LIMITS,
  FREE_REPORT_LIMIT,
  SERVICE_PROVIDER_FREE_REPORT_LIMIT,
  STANDARD_REPORT_LIMIT,
  resolveChatLimitKey,
  resolveReportLimit,
} from "../lib/quotas";
import { ipRateLimit, userRateLimit, minutes, hours } from "../lib/rateLimit";
import { noteQuotaUsage, noteAbuseSignal } from "../lib/abuse";
import { matchCanary, buildCanaryReport } from "../lib/canaries";
import { protectReport } from "../lib/outputProtection";
import { usagePeriodExpired } from "../lib/billingPeriod";
import { resolveProviderEntitlement } from "../lib/provider-entitlements";
import { formatTitleTypeForDisplay } from "../lib/titleDisplay";
import { classifySiteCondition, siteStatusLabel } from "../lib/site-condition";
import { sendPushToUser } from "../lib/expo-push";
import { createNotificationItem, getUnreadAppBadgeCount } from "../lib/notification-state";
import { runAfterResponse } from "../lib/vercel-wait-until";
import { clearRecentShownForUserSuburb, getRecentShownForUser, recordShownForUser, type RecentShownListing } from "../lib/discovery-shown-memory";
import { loadExcludedNonFreehold, persistExcludedNonFreehold } from "../lib/discovery-excluded-store";
import {
  checkAndRecordAnonymousUsage,
  clearRecentShownForAnonymousSuburb,
  getAnonymousInstallHash,
  getIpHash,
  getRecentShownForAnonymous,
  recordAnonymousDiscoveryEvent,
  recordShownForAnonymous,
} from "../lib/anonymous-discovery";
import type { Logger } from "pino";

type ReqLike = { headers: Record<string, string | string[] | undefined> };
function localeFromReq(req: ReqLike) {
  return normaliseLocale(req.headers["x-locale"] ?? req.headers["accept-language"]);
}

function headerSingle(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  const v = headers[lower] ?? headers[name];
  if (Array.isArray(v)) return v[0]?.trim();
  return typeof v === "string" ? v.trim() : undefined;
}

/** Explicit device OS Chinese from mobile; null = legacy client (fall back to app locale). */
function osChineseFromReq(req: ReqLike): boolean | null {
  const raw = headerSingle(req.headers, "x-os-chinese")?.toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return null;
}

/** Whether titleType + schoolZones should be translated to Chinese with the rest of the zh narrative. */
function translateTitleSchoolFromReq(req: ReqLike, appLocale: ReturnType<typeof normaliseLocale>): boolean {
  const os = osChineseFromReq(req);
  if (os !== null) return os;
  return appLocale === "zh";
}

function recentSalesLocationFromResolution(hit: RealestateLocationResolution | null): RecentSalesLocation | null {
  if (!hit || hit.status === "invalid") return null;
  if (hit.status === "suburb") {
    return {
      title: hit.suburb.title,
      path: hit.suburb.fqSlug.replace(/_/g, "/"),
      kind: "suburb",
    };
  }
  if (hit.status === "district") {
    return {
      title: hit.district.title,
      path: hit.district.fqSlug.replace(/_/g, "/"),
      kind: "district",
    };
  }
  return {
    title: hit.region.title,
    path: hit.region.slug,
    kind: "region",
  };
}

async function resolveRecentSalesLocationFromContext(args: {
  messages: Message[];
  userText: string;
  intent: ChatIntent;
  reportCtx: { address?: string | null; suburb?: string | null } | null;
  discoveryChoiceSuburb?: string;
}): Promise<RecentSalesLocation | null> {
  const candidates = [
    args.discoveryChoiceSuburb,
    args.intent.suburb,
    args.userText,
    args.reportCtx?.suburb,
    ...args.messages.filter((m) => m.role === "user").slice(-8).reverse().map((m) => m.content),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    const hit = await findLocationInTextViaIndex(text).catch(() => null);
    const location = recentSalesLocationFromResolution(hit);
    if (location) return location;
  }
  return null;
}

function recentSalesConversationText(messages: Message[], userText: string): string {
  const userTurns = messages.filter((m) => m.role === "user").slice(-8).map((m) => m.content);
  if (!userTurns.includes(userText)) userTurns.push(userText);
  return userTurns.join("\n");
}

function hasExplicitAnalysisRequestText(message: string): boolean {
  const lower = message.toLowerCase();
  return /\b(analyse|analyze|analysis|feasibility|assess|evaluate|development\s+economics|run\s+(?:a\s+)?report|subdivid\w*|subdivision|split\s+into\s+\d|development\s+potential|developable)\b/i.test(lower) ||
    /(?:\u5206\u6790|\u53ef\u884c\u6027|\u8bc4\u4f30|\u8a55\u4f30|\u5f00\u53d1\u7ecf\u6d4e|\u958b\u767c\u7d93\u6fdf|\u8dd1\u4e00\u4e0b\u62a5\u544a|\u8dd1\u4e00\u4e0b\u5831\u544a|\u5206\u5272|\u7ec6\u5206|\u7d30\u5206|\u5f00\u53d1\u6f5c\u529b|\u958b\u767c\u6f5b\u529b)/u.test(message);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function reportAddressValue(report: Record<string, unknown> | null | undefined): string | null {
  if (!report) return null;
  const overview = recordValue(report["propertyOverview"]);
  return firstNonEmptyString(report["address"], overview?.["address"]);
}

function normaliseLooseAddress(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function addressLooksLikeSameProperty(a: string | null | undefined, b: string | null | undefined): boolean {
  const ak = normaliseLooseAddress(a);
  const bk = normaliseLooseAddress(b);
  return ak.length > 6 && bk.length > 6 && (ak.includes(bk) || bk.includes(ak));
}

async function resolveNearbyAmenityTarget(args: {
  addressCandidate?: string | null;
  report?: Record<string, unknown> | null;
  log?: Logger;
}): Promise<NearbyAmenityTarget | null> {
  const explicitAddress = args.addressCandidate?.trim() || null;
  if (explicitAddress) {
    const geo = await tryGeocodeAddress(explicitAddress).catch((err) => {
      args.log?.warn({ err, address: explicitAddress }, "Nearby amenities: explicit address geocode failed");
      return null;
    });
    if (geo) {
      return {
        address: geo.formatted || explicitAddress,
        lat: geo.lat,
        lng: geo.lng,
      };
    }
  }

  if (args.report) {
    const coords = extractReportCoordinates(args.report);
    const addr = reportAddressValue(args.report);
    if (
      coords &&
      (!explicitAddress || addressLooksLikeSameProperty(explicitAddress, addr))
    ) {
      return {
        address: addr ?? explicitAddress ?? "this property",
        lat: coords.lat,
        lng: coords.lng,
      };
    }
  }

  return null;
}

function extractReportSchoolZoneSummaries(report: Record<string, unknown> | null | undefined): ReportSchoolZoneSummary[] {
  if (!report) return [];
  const overview = recordValue(report["propertyOverview"]);
  const candidates = [
    report["schoolZones"],
    report["school_zones_detail"],
    overview?.["schoolZones"],
    overview?.["school_zones_detail"],
  ];
  const out: ReportSchoolZoneSummary[] = [];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const entry of candidate) {
      const record = recordValue(entry);
      if (!record) continue;
      const name = firstNonEmptyString(record["orgName"], record["sourceLabel"], record["schoolName"], record["name"]);
      if (!name) continue;
      out.push({
        name,
        level: firstNonEmptyString(record["level"], record["orgType"]),
        yearLevels: firstNonEmptyString(record["yearLevels"]),
        authority: firstNonEmptyString(record["authority"]),
        enrolmentScheme: firstNonEmptyString(record["enrolmentScheme"]),
      });
    }
  }

  const legacySchoolZones = recordValue(report["school_zones"]) ?? recordValue(overview?.["school_zones"]);
  if (legacySchoolZones) {
    for (const [level, raw] of Object.entries(legacySchoolZones)) {
      const name = firstNonEmptyString(raw);
      if (!name) continue;
      out.push({ name, level, yearLevels: null, authority: null, enrolmentScheme: null });
    }
  }

  const seen = new Set<string>();
  return out.filter((zone) => {
    const key = `${zone.level ?? ""}|${zone.name}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

async function buildNearbyAmenitiesAnswer(args: {
  message: string;
  report?: Record<string, unknown> | null;
  addressCandidate?: string | null;
  semanticTerms?: string[];
  locale: ReturnType<typeof normaliseLocale>;
  log?: Logger;
}): Promise<string | null> {
  const request = buildNearbyAmenityRequest(args.message, args.semanticTerms ?? []);
  if (request.categories.length === 0) return null;

  const target = await resolveNearbyAmenityTarget({
    addressCandidate: args.addressCandidate,
    report: args.report ?? null,
    log: args.log,
  });
  if (!target) return null;

  const schoolZones =
    request.categories.includes("school") && args.report
      ? extractReportSchoolZoneSummaries(args.report)
      : [];
  const zoneResults = schoolZones.length > 0 ? reportSchoolZonesToAmenityResults(schoolZones) : [];
  const liveCategories = request.categories.filter((category) => !(category === "school" && schoolZones.length > 0));
  const liveRequest = { ...request, categories: liveCategories };
  const liveResults = liveCategories.length > 0
    ? await fetchNearbyAmenities(target, liveRequest, { maxPerCategory: 5, includeDriveTimes: true })
    : [];
  const answer = renderNearbyAmenitiesAnswer({
    target,
    request,
    results: [...zoneResults, ...liveResults],
    searchedLiveAmenities: liveCategories.length > 0,
  });
  return args.locale === "zh" ? await ensureChinese(answer) : answer;
}

async function buildPostAnalysisAnswersForReport(
  message: string,
  report: Record<string, unknown> | null | undefined,
  locale: ReturnType<typeof normaliseLocale>,
  log?: Logger,
): Promise<string[]> {
  const answers = buildPostAnalysisAnswers(message, report, locale);
  if (!report || !detectNearbyAmenityIntent(message)) return answers;
  try {
    const nearby = await buildNearbyAmenitiesAnswer({ message, report, locale, log });
    if (nearby) answers.push(nearby);
  } catch (err) {
    log?.warn({ err, sample: message.slice(0, 100) }, "Nearby amenities: post-analysis answer failed");
  }
  return answers;
}

function postAnalysisPayload(answers: string[]): { postAnalysisAnswer: string | null; postAnalysisAnswers: string[] } {
  return {
    postAnalysisAnswer: answers.length > 0 ? answers.join("\n\n") : null,
    postAnalysisAnswers: answers,
  };
}

function deterministicProviderRecommendationPayload(message: string): {
  wantsProviderRecommendation?: true;
  wantsAnotherProvider?: true;
  suggestedDiscipline?: string | null;
} {
  const signal = detectProviderRecommendationIntent(message);
  return {
    ...(signal.wantsProviderRecommendation
      ? { wantsProviderRecommendation: true as const, suggestedDiscipline: signal.suggestedDiscipline }
      : {}),
    ...(signal.wantsAnotherProvider ? { wantsAnotherProvider: true as const } : {}),
  };
}

function nearbyAmenityClarification(addressCandidate: string | null | undefined, locale: ReturnType<typeof normaliseLocale>): string {
  const english = addressCandidate
    ? `I could not locate ${addressCandidate} closely enough to search nearby amenities. Please include the suburb or city.`
    : "Which address should I check nearby amenities around?";
  return locale === "zh"
    ? (addressCandidate
      ? `我还不能准确定位 ${addressCandidate}，请补充郊区或城市后我再查周边配套。`
      : "您想查询哪个地址周边的配套？")
    : english;
}

function firstPositiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const n = Number(value.replace(/[$,\s]/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function enrichRecentSalesRecordsFromCache(records: RecentSaleRecord[]): Promise<RecentSaleRecord[]> {
  const out: RecentSaleRecord[] = [];
  for (const record of records) {
    const key = normaliseDiscoveryAddressKey(record.address);
    const cached = key ? await getCachedRaw(key).catch(() => null) : null;
    const raw = cached?.rawData as any;
    if (!raw) {
      out.push(record);
      continue;
    }
    const titleRaw = firstNonEmptyString(
      raw.linz_title?.estate_type,
      raw.linz_title?.title_type,
      raw.linz_lrs_preview_result?.preview?.titles?.[0]?.title_type,
      raw.oneroof?.tenureText,
    );
    out.push({
      ...record,
      cvNzd: record.cvNzd ?? firstPositiveNumber(
        raw.propertyValue?.cv_nzd,
        raw.qv?.cv_nzd,
        raw.property_history?.cv_nzd,
        raw.oneroof?.cv_nzd,
        raw.homes?.cv_nzd,
        raw.hougarden?.cv_nzd,
      ),
      titleType: record.titleType ?? formatTitleTypeForDisplay(titleRaw),
      landAreaSqm: record.landAreaSqm ?? firstPositiveNumber(
        raw.propertyValue?.land_area_sqm,
        raw.property_history?.land_area_sqm,
        raw.qv?.land_area_sqm,
        raw.oneroof?.land_area_sqm,
        raw.homes?.land_area_sqm,
        raw.hougarden?.land_area_sqm,
        raw.derived_scores?.landArea,
      ),
      floorAreaSqm: record.floorAreaSqm ?? firstPositiveNumber(
        raw.propertyValue?.floor_area_sqm,
        raw.property_history?.floor_area_sqm,
        raw.qv?.floor_area_sqm,
        raw.oneroof?.floor_area_sqm,
        raw.homes?.floor_area_sqm,
        raw.hougarden?.floor_area_sqm,
      ),
      bedrooms: record.bedrooms ?? firstPositiveNumber(raw.propertyValue?.bedrooms, raw.qv?.bedrooms, raw.homes?.bedrooms),
      bathrooms: record.bathrooms ?? firstPositiveNumber(raw.propertyValue?.bathrooms, raw.qv?.bathrooms, raw.homes?.bathrooms),
    });
  }
  return out;
}

const router = Router();

/**
 * Finds the substring for the outermost `{ ... }` by brace depth, respecting
 * double-quoted JSON strings — avoids greedy `[\s\S]*` matching past truncated
 * or nested content.
 */
function extractLeadingJSONObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escape = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function tryParseReportJson(text: string): Record<string, unknown> | null {
  const blob = extractLeadingJSONObject(text.trim());
  if (!blob) return null;
  try {
    const v = JSON.parse(blob) as unknown;
    return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function extractJSON(text: string): unknown {
  const parsed = tryParseReportJson(text);
  if (parsed != null) return parsed;
  throw new Error("No valid JSON object found in response");
}

/**
 * Lightweight address-like hint for chat-mode routing.
 * We still defer canonical parsing to extractNZAddress, but this keeps the
 * expensive extraction path focused on messages that look like addresses.
 */
function looksLikeStreetAddress(text: string): boolean {
  return /\b(?:[a-z]?\d+[a-z]?\s*\/\s*)?\d+[a-zA-Z]?\s+[\w''-]+(?:\s+[\w''-]+){0,4}\s+(road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i.test(text);
}

/**
 * Build the deterministic Property Overview snapshot from the merged pipeline
 * output and mirror it into the report's `propertyOverview` block. The
 * snapshot is the single source of truth for follow-up chat answers and
 * guarantees that beds/baths/land/floor/CV stay consistent with the live
 * listing reconciliation done in `mergePropertyData`.
 */
export function applyOverviewSnapshot(
  parsed: Record<string, unknown>,
  merged: import("../lib/scrapers/merge").MergedPropertyData | null | undefined,
  resolvedAddress: string,
): void {
  if (!merged) {
    const unavailableSnapshot: Record<string, unknown> = {
      address: resolvedAddress,
      cv: null,
      cv_nzd: null,
      cv_year: null,
      landArea: null,
      land_area_sqm: null,
      floorArea: null,
      floor_area_sqm: null,
      buildYear: null,
      build_year: null,
      build_year_range: null,
      propertyType: null,
      siteStatus: "unknown",
      siteStatusLabel: siteStatusLabel("unknown"),
      bedrooms: null,
      bathrooms: null,
      zone: null,
      zone_code: null,
      titleType: null,
      titleResolutionSource: "unknown",
      typology: "unknown",
      typologyConfidence: "unknown",
      titleConfidence: "unknown",
      subdivisionEligible: null,
      subdivisionRejectReason: null,
      listingPrice: null,
      listing_price_nzd: null,
      isOnMarket: false,
      data_sources: {},
      discrepancies: [],
    };
    parsed.property_overview_snapshot = unavailableSnapshot;

    const existingOverview = (parsed.propertyOverview as Record<string, unknown> | undefined) ?? {};
    parsed.propertyOverview = {
      ...existingOverview,
      address: resolvedAddress,
      cv: null,
      cv_nzd: null,
      cv_year: null,
      landArea: null,
      land_area_sqm: null,
      floorArea: null,
      floor_area_sqm: null,
      buildYear: null,
      build_year: null,
      build_year_range: null,
      propertyType: null,
      siteStatus: "unknown",
      siteStatusLabel: siteStatusLabel("unknown"),
      bedrooms: null,
      bathrooms: null,
      zone: null,
      zone_code: null,
      titleType: null,
      titleResolutionSource: "unknown",
      typology: "unknown",
      typologyConfidence: "unknown",
      titleConfidence: "unknown",
      subdivisionEligible: null,
      subdivisionRejectReason: null,
      listingPrice: null,
      listing_price_nzd: null,
      isOnMarket: false,
      data_sources: {},
      discrepancies: [],
    };
    return;
  }
  const fmt = (n: number) => `$${n.toLocaleString("en-NZ")}`;
  const siteCondition = classifySiteCondition(merged);
  const snapshot: Record<string, unknown> = {
    address: resolvedAddress,
    cv: merged.cv_nzd != null && merged.cv_nzd > 0 ? fmt(merged.cv_nzd) : null,
    cv_nzd: merged.cv_nzd ?? null,
    cv_year: merged.cv_year ?? null,
    landArea: merged.land_area_sqm != null ? `${merged.land_area_sqm}m²` : null,
    land_area_sqm: merged.land_area_sqm ?? null,
    floorArea: merged.floor_area_sqm != null ? `${merged.floor_area_sqm}m²` : null,
    floor_area_sqm: merged.floor_area_sqm ?? null,
    buildYear: merged.build_year_range ?? (merged.build_year != null ? String(merged.build_year) : null),
    build_year: merged.build_year ?? null,
    build_year_range: merged.build_year_range ?? null,
    propertyType: merged.property_type ?? null,
    siteStatus: siteCondition.siteStatus,
    siteStatusLabel: siteStatusLabel(siteCondition.siteStatus),
    bedrooms: merged.bedrooms ?? null,
    bathrooms: merged.bathrooms ?? null,
    zone: merged.zone_description ?? merged.zone_code ?? null,
    zone_code: merged.zone_code ?? null,
    titleType: formatTitleTypeForDisplay(merged.estate_type?.trim() || null),
    titleResolutionSource: merged.titleResolutionSource ?? "unknown",
    typology: merged.typology ?? "unknown",
    typologyConfidence: merged.typologyConfidence ?? "unknown",
    titleConfidence: merged.titleConfidence ?? "unknown",
    subdivisionEligible: merged.subdivisionEligible ?? null,
    subdivisionRejectReason: merged.subdivisionRejectReason ?? null,
    listingPrice: merged.listing_price != null ? fmt(merged.listing_price) : null,
    listing_price_nzd: merged.listing_price ?? null,
    isOnMarket: merged.listing_active === true,
    data_sources: merged.data_sources ?? {},
    // Surfaces every value the live-listing reconciliation rewrote so the
    // report and follow-up chat can explain *why* the displayed figure
    // differs from council/QV records.
    discrepancies: merged.discrepancies ?? [],
  };
  parsed.property_overview_snapshot = snapshot;

  const existingOverview = (parsed.propertyOverview as Record<string, unknown> | undefined) ?? {};
  parsed.propertyOverview = {
    ...existingOverview,
    address: snapshot.address,
    cv: snapshot.cv,
    cv_year: snapshot.cv_year,
    landArea: snapshot.landArea,
    floorArea: snapshot.floorArea,
    buildYear: snapshot.buildYear,
    propertyType: snapshot.propertyType ?? existingOverview.propertyType ?? null,
    siteStatus: snapshot.siteStatus,
    siteStatusLabel: snapshot.siteStatusLabel,
    bedrooms: snapshot.bedrooms ?? null,
    bathrooms: snapshot.bathrooms ?? null,
    zone: snapshot.zone ?? existingOverview.zone,
    titleType: formatTitleTypeForDisplay(
      (snapshot.titleType ?? existingOverview.titleType) as string | null | undefined,
    ),
    titleResolutionSource: snapshot.titleResolutionSource ?? existingOverview.titleResolutionSource ?? "unknown",
    typology: snapshot.typology,
    typologyConfidence: snapshot.typologyConfidence,
    titleConfidence: snapshot.titleConfidence,
    subdivisionEligible: snapshot.subdivisionEligible,
    subdivisionRejectReason: snapshot.subdivisionRejectReason,
    listingPrice: snapshot.listingPrice,
    isOnMarket: snapshot.isOnMarket,
    discrepancies: snapshot.discrepancies,
  };
}

function buildDeterministicCostItems(costs: NonNullable<PipelineResult["costs"]>) {
  const cv = costs.land_cv_nzd ?? 0;
  const items = [
    { label: cv > 0 ? "Land (CV)" : "Land (CV — unavailable)", low: cv, high: cv },
    { label: "Demolition", low: costs.demo_low, high: costs.demo_high },
    { label: "Construction", low: costs.construction_low, high: costs.construction_high },
    { label: "Retaining Walls", low: costs.retaining_low, high: costs.retaining_high },
    { label: "Services & Infrastructure", low: costs.services_low, high: costs.services_high },
    { label: "Consents & Professionals", low: costs.consents_low, high: costs.consents_high },
    { label: "Finance (Holding)", low: costs.finance_low, high: costs.finance_high },
    { label: "Contingency", low: costs.contingency_low, high: costs.contingency_high },
  ];
  if (costs.tdr_ttr_required) {
    items.splice(4, 0, { label: "TDR/TTR transfer right", low: costs.tdr_ttr_low ?? 0, high: costs.tdr_ttr_high ?? 0 });
  }
  // Development contributions (IGC + council DC) apply app-wide; the Veolia line
  // only appears inside the Papakura franchise. Insert after Services so the
  // network-related costs read together. Both self-hide when zero.
  const servicesIdx = items.findIndex((i) => i.label === "Services & Infrastructure");
  const contributionItems: Array<{ label: string; low: number; high: number }> = [];
  if ((costs.contributions_low ?? 0) > 0 || (costs.contributions_high ?? 0) > 0) {
    contributionItems.push({ label: "Development contributions (IGC + council DC)", low: costs.contributions_low ?? 0, high: costs.contributions_high ?? 0 });
  }
  if (costs.veolia_in_zone && ((costs.veolia_low ?? 0) > 0 || (costs.veolia_high ?? 0) > 0)) {
    contributionItems.push({ label: "Veolia network charges (Papakura)", low: costs.veolia_low ?? 0, high: costs.veolia_high ?? 0 });
  }
  if (contributionItems.length > 0) {
    items.splice(servicesIdx + 1, 0, ...contributionItems);
  }
  // Land rate is a holding carry over the development horizon; label carries the annual figure.
  if ((costs.land_rate_low ?? 0) > 0 || (costs.land_rate_high ?? 0) > 0) {
    const annual = Math.round(costs.land_rate_annual ?? 0);
    const annualLabel = annual > 0 ? ` (~$${annual.toLocaleString("en-NZ")}/yr)` : "";
    items.push({ label: `Land rate (holding)${annualLabel}`, low: costs.land_rate_low ?? 0, high: costs.land_rate_high ?? 0 });
  }
  return items;
}

/**
 * Removes risk bullets that cite MHS / Mixed Housing Suburban when GIS zone_code
 * is not MHS — a frequent LLM mistake on Single House Zone sites (400m² vs 600m² rules).
 */
function filterRiskSummaryRemoveMhsBulletsWhenZoneIsNotMhs(bullets: string[], zoneCode: string | null | undefined): string[] {
  if (!zoneCode) return bullets;
  const z = zoneCode.trim().toUpperCase();
  if (z === "MHS") return bullets;
  return bullets.filter((b) => {
    if (/\bMHS\b/i.test(b)) return false;
    if (/mixed\s+housing\s+suburban/i.test(b)) return false;
    if (/混合住房郊区/.test(b)) return false;
    return true;
  });
}

/** Programme / capital bullets for high lot-yield sites — allowed (not comparable-data reliability). */
function appendMultiLotProgrammeRiskIfNeeded(bullets: string[], potentialLots: number): string[] {
  if (potentialLots < 4) return bullets;
  const isZh = bullets.some((b) => /[\u4e00-\u9fff]/.test(b));
  if (
    bullets.some((b) => /phased (construction|sales)|staged sales|分期|多期|资金占用|programme risk/i.test(b) || /资本|前期资金|去化/.test(b))
  ) {
    return bullets;
  }
  const en = `Intensive scheme (${potentialLots} potential lots): expect very high upfront capital, a multi-year construction programme, and usually phased unit sales — absorption and holding finance can stretch the timeline so money-weighted and annualised returns are typically lower than for quick single-lot projects.`;
  const zh = `大规模方案（约 ${potentialLots} 个潜在地块）：前期资金投入大、建设周期长，单位销售往往需分期推进，资金占用与市场去化会拉长回收期，资金加权与年化回报通常低于短周期的单地块项目。`;
  return [...bullets, isZh ? zh : en];
}

function appendRuralTransferRightRiskIfNeeded(bullets: string[], costs: NonNullable<PipelineResult["costs"]> | null | undefined): string[] {
  if (!costs?.tdr_ttr_required) return bullets;
  const isZh = bullets.some((b) => /[\u4e00-\u9fff]/.test(b));
  if (bullets.some((b) => /TDR|TTR|transferable rural site|transfer[- ]right|转移开发权|转移农村建房权/i.test(b))) return bullets;
  const en = "Rural/countryside subdivision may require a transferable rural site right (TDR/TTR); availability, price, and Council pathway confirmation can materially affect cost and timing.";
  const zh = "乡村/生活方式分区分割可能需要 TDR/TTR 转移开发权；其供应、价格及 Council 审批路径确认会显著影响成本与时间。";
  return [...bullets, isZh ? zh : en];
}

function deterministicTerrainSlopeText(
  contour: TerrainContour | null | undefined,
  slopeDegrees: number | null | undefined,
  locale: ReturnType<typeof normaliseLocale> = "en",
): string | null {
  return terrainSlopeText(contour, slopeDegrees, locale);
}

function filterRiskSummaryRemoveContradictoryTerrainBullets(
  bullets: string[],
  contour: TerrainContour | null | undefined,
): string[] {
  return bullets.filter((b) => {
    if (typeof b !== "string") return false;
    if (contour === "very_steep" && /steep\s+(slope|terrain|site)|very\s+steep|severe\s+terrain|extreme\s+(?:build|terrain|engineering)|极陡|高成本地形/i.test(b)) return true;
    if (contour !== "very_steep" && /very\s+steep|severe\s+terrain|extreme\s+(?:build|terrain|engineering)|极陡|高成本地形/i.test(b)) return false;
    if (contour !== "moderate" && /(moderate|medium)\s+(slope|terrain)|10\s*[-–]\s*15|中等坡|中坡/i.test(b)) return false;
    if (contour !== "steep" && /steep\s+(slope|terrain|site)|陡坡|地形陡峭/i.test(b)) return false;
    return true;
  });
}

type OverlayFamily = "volcanic" | "heritage" | "tree" | "flood" | "coastal" | "ridgeline" | "special";

const OVERLAY_FAMILY_PATTERNS: Record<OverlayFamily, RegExp> = {
  // Include CJK so LLM-written Chinese bullets are stripped when GIS did not return that overlay.
  volcanic: /volcanic|view\s*shaft|viewshaft|火山|景观廊|視廊|火山景观|景观视廊/i,
  heritage: /heritage|historic|遗产|歷史建築/i,
  tree: /notable\s+tree|protected\s+tree|显著树|显著树木|受保护树/i,
  flood: /flood|overland\s+flow|洪水|漫流|洪泛/i,
  coastal: /coastal|erosion\s+hazard|inundation|海岸|侵蚀|淹没/i,
  ridgeline: /ridgeline|山脊/i,
  special: /special\s+character|特色|特殊性质/i,
};

function overlayFamilies(overlays: Array<{ name?: unknown }>): Set<OverlayFamily> {
  const out = new Set<OverlayFamily>();
  for (const overlay of overlays) {
    const name = typeof overlay.name === "string" ? overlay.name : "";
    for (const [family, pattern] of Object.entries(OVERLAY_FAMILY_PATTERNS) as Array<[OverlayFamily, RegExp]>) {
      if (pattern.test(name)) out.add(family);
    }
  }
  return out;
}

function confirmedOverlayName(overlays: Array<{ name?: unknown }>, pattern: RegExp): boolean {
  return overlays.some((overlay) => {
    const name = typeof overlay.name === "string" ? overlay.name : "";
    return pattern.test(name);
  });
}

const SPECIFIC_OVERLAY_BULLET_GATES: Array<{ bullet: RegExp; confirmedName: RegExp }> = [
  {
    bullet: /coastal\s+erosion|erosion\s+hazard|shoreline\s+retreat|coastal\s+instability|ASCIE|海岸.*侵蚀|海岸.*侵蝕|岸线.*后退|海岸.*不稳定/i,
    confirmedName: /erosion|instability|ASCIE/i,
  },
  {
    bullet: /coastal\s+inundation|storm\s+tide|sea[-\s]?level\s+rise|minimum\s+floor\s+level|floor\s+level\s+control|海岸.*淹没|海岸.*淹沒|海平面上升/i,
    confirmedName: /inundation|storm/i,
  },
];

function filterRiskSummaryRemoveUnconfirmedOverlayBullets(
  bullets: string[],
  overlays: Array<{ name?: unknown }>,
): string[] {
  const confirmed = overlayFamilies(overlays);
  return bullets.filter((b) => {
    if (typeof b !== "string") return false;
    for (const gate of SPECIFIC_OVERLAY_BULLET_GATES) {
      if (gate.bullet.test(b) && !confirmedOverlayName(overlays, gate.confirmedName)) return false;
    }
    for (const [family, pattern] of Object.entries(OVERLAY_FAMILY_PATTERNS) as Array<[OverlayFamily, RegExp]>) {
      if (pattern.test(b) && !confirmed.has(family)) return false;
    }
    return true;
  });
}

function applyDeterministicPipelineOverrides(
  parsed: Record<string, unknown>,
  pipelineResult: PipelineResult,
  resolvedAddress: string,
  locale: ReturnType<typeof normaliseLocale> = "en",
): void {
  // For combined-listing children the pipeline has already restricted
  // merged.photo_urls to child-scope-matched listing photos (or none). Do NOT
  // re-add the address-fuzzy OneRoof gallery here — that would reintroduce the
  // unrelated photos we are deliberately suppressing in favour of Street View.
  const photoUrls = Array.from(new Set([
    ...(pipelineResult.merged?.photo_urls ?? []),
    ...(pipelineResult.suppressNonSubjectPhotos
      ? []
      : [
          ...(pipelineResult.oneroof?.photo_urls ?? []),
          ...(pipelineResult.oneroof?.main_photo_url ? [pipelineResult.oneroof.main_photo_url] : []),
        ]),
  ].filter(Boolean)));
  const photoUrl = photoUrls[0] ?? null;
  parsed.photoUrl = photoUrl;
  parsed.photoUrls = photoUrls;
  if (pipelineResult.hougarden?.overlay_map_image_base64) {
    parsed.overlay_map_image_base64 = pipelineResult.hougarden.overlay_map_image_base64;
  }

  applyOverviewSnapshot(parsed, pipelineResult.merged ?? null, resolvedAddress);

  const merged = pipelineResult.merged;
  const lots = pipelineResult.lots;
  const costs = pipelineResult.costs;
  const scenarios = pipelineResult.scenarios ?? [];
  const comparables = pipelineResult.comparables ?? [];
  const developmentStrategies = pipelineResult.developmentStrategies ?? [];

  if (merged) {
    parsed.data_sources = merged.data_sources ?? {};
    parsed.missing_critical_fields = merged.missing_critical_fields ?? [];
    const existingTerrain = (parsed.terrain as Record<string, unknown> | undefined) ?? {};
    parsed.terrain = {
      ...existingTerrain,
      classification: merged.contour ?? null,
      slope_degrees: merged.contour_slope_degrees ?? null,
      official_label: merged.contour_text ?? null,
      source: merged.contour_source ?? null,
      slope: deterministicTerrainSlopeText(merged.contour, merged.contour_slope_degrees, locale),
      steep_area_ratio: merged.contour_steep_area_ratio ?? null,
      moderate_area_ratio: merged.contour_moderate_area_ratio ?? null,
      local_slope_p90_degrees: merged.contour_local_slope_p90_degrees ?? null,
      local_slope_p95_degrees: merged.contour_local_slope_p95_degrees ?? null,
      sample_count: merged.contour_sample_count ?? null,
      large_site_terrain_adjusted: merged.large_site_terrain_adjusted ?? false,
    };
  }

  if (lots) {
    parsed.potential_lots = lots.lots;
    parsed.zone_label = lots.zone_label;

    // Keep propertyOverview.zone in sync with the authoritative deterministic zone_label.
    // applyOverviewSnapshot runs before this block using merged.zone_description which can
    // disagree with the zone_code → ZONE_RULES lookup (e.g. Hougarden description says
    // "Single House Zone" but code resolves to default MHS rules). Pin both to the same source.
    const overviewObj = parsed.propertyOverview as Record<string, unknown> | undefined;
    if (overviewObj && lots.zone_label) {
      overviewObj.zone = lots.zone_label;
    }

    const existingPlanning = (parsed.planning as Record<string, unknown> | undefined) ?? {};
    // Recompute from lot-calculator + merged GIS zone so summary/callout always match
    // propertyOverview (avoids stale or LLM-only subdivision prose with wrong m² or zone).
    const pathway =
      pipelineResult.subdivision_pathway ??
      (merged != null
        ? buildSubdivisionPathwayNote(
            merged.land_area_sqm == null ? null : lots.net_area_sqm,
            merged.zone_code ?? null,
            lots.lots,
            lots.min_lot_size,
            lots.zone_label,
          )
        : null);
    parsed.planning = {
      ...existingPlanning,
      // Always use the deterministic zone_label — never let the LLM's guess win here.
      // The LLM can hallucinate the wrong zone (e.g. MHS when actual is SHZ), which
      // propagates into the planning section and contradicts the zone shown in the
      // property overview and the deterministic subdivision pathway note.
      zone: lots.zone_label,
      potentialLots: lots.lots,
      standardVacantLots: pathway?.standardVacantLots ?? lots.lots,
      standardPathViable: pathway?.standardPathViable ?? pathway?.standard_path_viable ?? false,
      standardMinLotSize: pathway?.standardMinLotSize ?? (lots.min_lot_size > 0 ? lots.min_lot_size : null),
      designLedEligible: pathway?.designLedEligible ?? false,
      designLedYieldRange: pathway?.designLedYieldRange ?? null,
      designLedConfidence: pathway?.designLedConfidence ?? "none",
      designLedReasons: pathway?.designLedReasons ?? [],
      designLedBlockers: pathway?.designLedBlockers ?? [],
      designLedSummary: pathway?.designLedSummary ?? null,
      designLedDetail: pathway?.designLedDetail ?? null,
      grossAreaSqm: lots.gross_area_sqm,
      netAreaSqm: lots.net_area_sqm,
      easementAreaSqm: lots.easement_area_sqm,
      // Always use the deterministic subdivision note — overwrite any LLM-generated version
      subdivisionPathwayNote: pathway?.detail ?? (existingPlanning.subdivisionPathwayNote as string | undefined) ?? null,
      // Same source as pathway callout: pin summary prose so the LLM cannot contradict
      // net area, zone, or lot yield (e.g. wrong 750m² + MHS on an SHZ site).
      subdivisionSummary: pathway?.headline ?? (existingPlanning.subdivisionSummary as string | undefined),
      // Deterministic overlay list from GIS consensus — always overwrite the LLM output.
      // The LLM is instructed to copy overlays faithfully but can hallucinate entries
      // (e.g. "Special Character Area") that the GIS never reported. Pinning this here
      // guarantees the published report exactly matches the 3× consensus GIS result.
      overlays: (merged?.overlays ?? []).map((o) => ({ name: o.name, status: o.status, detail: o.detail })),
    };
  }

  if (costs) {
    parsed.cv_unavailable = costs.cv_unavailable;
    parsed.total_excludes_land = costs.total_excludes_land;
    parsed.totalCostLow = costs.total_low;
    parsed.totalCostHigh = costs.total_high;
    parsed.cost_per_unit_avg = costs.cost_per_unit_avg;
    parsed.costItems = buildDeterministicCostItems(costs);

    const existingTerrain = (parsed.terrain as Record<string, unknown> | undefined) ?? {};
    parsed.terrain = {
      ...existingTerrain,
      retainingCostLow: costs.retaining_low,
      retainingCostHigh: costs.retaining_high,
      retaining_area_sqm_estimate: costs.retaining_area_sqm_estimate ?? null,
      large_site_terrain_adjusted: costs.large_site_terrain_adjusted ?? existingTerrain.large_site_terrain_adjusted ?? false,
    };

    if (pipelineResult.asbestos_detail) {
      const ad = pipelineResult.asbestos_detail;
      const noExistingDwelling = costs.has_existing_dwelling === false || costs.demo_vacant === true;
      const asbestosNotes = noExistingDwelling
        ? "No existing dwelling was detected, so demolition and asbestos removal have not been included."
        : ad.notes;

      parsed.asbestos = {
        buildYear: merged?.build_year_range ?? (merged?.build_year ?? null),
        riskLevel: noExistingDwelling ? "low" : ad.risk,
        risk: noExistingDwelling ? "low" : ad.risk,
        flagged: noExistingDwelling ? false : ad.risk === "high",
        notes: asbestosNotes,
        worksafe_required: noExistingDwelling ? false : ad.risk === "high",
        demoCostLow: costs.demo_low,
        demoCostHigh: costs.demo_high,
      };

      // Sanitise riskSummary — remove any asbestos bullet the LLM may have
      // hallucinated (wrong build year, wrong risk era) and replace with a
      // factual bullet from the same deterministic data that drives parsed.asbestos.
      // Locale is inferred from whether existing bullets contain Chinese characters.
      const existingRisk = Array.isArray(parsed.riskSummary) ? (parsed.riskSummary as string[]) : [];
      const isZh = existingRisk.some((b) => /[\u4e00-\u9fff]/.test(b));
      const filteredBullets = filterRiskSummaryRemoveIncompleteDataDisclaimerBullets(
        filterRiskSummaryRemoveComparableReliabilityBullets(
          filterRiskSummaryRemoveAsbestosBullets(existingRisk),
        ),
      );

      const risk = noExistingDwelling ? "low" : ad.risk;
      const demoLow = costs.demo_low;
      const demoHigh = costs.demo_high;
      const buildYear = merged?.build_year ?? null;
      const costRange = `$${Math.round(demoLow / 1000)}k–$${Math.round(demoHigh / 1000)}k`;

      // Modern builds: no asbestos in riskSummary (detail stays in the asbestos panel if needed).
      // Post-1990 low-risk: same — users asked not to pad risk lists with negligible asbestos notes.
      const omitAsbestosFromRiskSummary =
        noExistingDwelling ||
        (buildYear != null && buildYear > 2000) ||
        (risk === "low" && buildYear != null && buildYear > 1990);

      if (!omitAsbestosFromRiskSummary) {
        let asbestosBullet: string;
        if (isZh) {
          if (risk === "low" && buildYear && buildYear < 1940) {
            asbestosBullet = `石棉风险低 — ${buildYear} 年建造（石棉使用前时代），拆除费用约 ${costRange}。`;
          } else if (risk === "high") {
            asbestosBullet = `石棉风险高 — ${buildYear ? `${buildYear} 年建造` : "建造年份未知"}（1940–1990 年建筑期），需持证评估员检查，拆除费用约 ${costRange}，须向 WorkSafe 申报。`;
          } else {
            asbestosBullet = `石棉风险未知 — 建造年份不明，拆除前须委托持证石棉评估师检查，以确定拆除费用。`;
          }
        } else {
          if (risk === "low" && buildYear && buildYear < 1940) {
            asbestosBullet = `Low asbestos risk — built ${buildYear} (pre-asbestos era); demolition cost estimate ${costRange}.`;
          } else if (risk === "high") {
            asbestosBullet = `Elevated asbestos risk — ${buildYear ? `built ${buildYear}` : "build year unknown"} (1940–1990 era); licensed removal required, demolition cost ${costRange}, WorkSafe notification needed.`;
          } else {
            asbestosBullet = `Asbestos risk unassessed — build year unknown; commission a licensed asbestos assessor before any demolition.`;
          }
        }

        parsed.riskSummary = [...filteredBullets, asbestosBullet];
      } else {
        parsed.riskSummary = filteredBullets;
      }
    }
  } else {
    delete parsed.cv_unavailable;
    delete parsed.total_excludes_land;
    delete parsed.totalCostLow;
    delete parsed.totalCostHigh;
    delete parsed.cost_per_unit_avg;
    delete parsed.costItems;
  }

  parsed.interest_rate_outlook = scenarios[0]?.interest_rate_outlook ?? parsed.interest_rate_outlook;
  parsed.roiScenarios = scenarios.map((s) => ({
    ...s,
    totalCost: s.total_cost_mid,
    grossProfit: s.gross_profit,
    roi: s.roi_percent,
    annualisedRoi: s.annualised_roi_percent,
  }));
  parsed.developmentStrategies = developmentStrategies;
  const recommendedStrategy = developmentStrategies.find((strategy) => strategy.recommendation === "recommended");
  if (recommendedStrategy) {
    parsed.recommendedDevelopmentStrategy = recommendedStrategy.id;
  } else {
    delete parsed.recommendedDevelopmentStrategy;
  }
  parsed.neighbourhoodContext = pipelineResult.neighbourhoodContext ?? null;
  parsed.transportContext = pipelineResult.transportContext ?? null;
  parsed.builtEnvironmentContext = pipelineResult.builtEnvironmentContext ?? null;

  if (pipelineResult.infrastructure.length > 0) {
    parsed.infrastructure = pipelineResult.infrastructure;
  }

  parsed.comparableSales = comparables;
  parsed.comparables_quality = pipelineResult.comparables_quality;
  if (comparables.length > 0) {
    const prices = comparables.map((c) => c.price_nzd).filter((p) => p > 0);
    const psms = comparables.map((c) => c.price_per_sqm).filter((p) => p > 0);
    parsed.avg_sale_price = prices.length > 0
      ? Math.round(prices.reduce((sum, p) => sum + p, 0) / prices.length)
      : null;
    parsed.avgPricePerSqm = psms.length > 0
      ? Math.round(psms.reduce((sum, p) => sum + p, 0) / psms.length)
      : null;
  } else {
    parsed.avg_sale_price = null;
    parsed.avgPricePerSqm = null;
  }

  const hadZhRiskIntent = (() => {
    const rs = parsed.riskSummary;
    return Array.isArray(rs) && (rs as string[]).some((b) => typeof b === "string" && /[\u4e00-\u9fff]/.test(b));
  })();

  let rs: string[] = Array.isArray(parsed.riskSummary)
    ? ([...(parsed.riskSummary as string[])] as string[])
    : [];

  rs = rs.filter((b) => typeof b === "string" && b.trim().length > 0);
  rs = filterRiskSummaryRemoveIncompleteDataDisclaimerBullets(
    filterRiskSummaryRemoveComparableReliabilityBullets(rs),
  );
  rs = filterRiskSummaryRemoveUnconfirmedOverlayBullets(rs, merged?.overlays ?? []);
  rs = filterRiskSummaryRemoveContradictoryTerrainBullets(rs, merged?.contour ?? null);
  rs = filterRiskSummaryRemoveMhsBulletsWhenZoneIsNotMhs(rs, merged?.zone_code ?? null);
  const canonYear = canonicalBuildYearFromReport(parsed, merged?.build_year ?? null);
  if ((costs != null && (costs.has_existing_dwelling === false || costs.demo_vacant === true)) || (canonYear != null && canonYear > 2000)) {
    rs = filterRiskSummaryRemoveAsbestosBullets(rs);
  }
  rs = appendRuralTransferRightRiskIfNeeded(
    appendMultiLotProgrammeRiskIfNeeded(rs, lots?.lots ?? 0),
    costs,
  );

  const isZhRisks = rs.some((b) => /[\u4e00-\u9fff]/.test(b)) || hadZhRiskIntent;

  const zoneLabelForBackfill =
    (lots?.zone_label as string | undefined) ??
    (parsed.zone_label as string | undefined) ??
    null;

  const backfillCtx: RiskBackfillContext = {
    isZh: isZhRisks,
    zoneCode: merged?.zone_code ?? null,
    zoneLabel: zoneLabelForBackfill,
    potentialLots: lots?.lots ?? 0,
    netAreaSqm: lots?.net_area_sqm ?? merged?.land_area_sqm ?? null,
    minLotSqm: lots?.min_lot_size ?? merged?.min_lot_size_sqm ?? null,
    overlays: (merged?.overlays ?? []).map((o) => ({ name: o.name, status: o.status })),
    contour: merged?.contour ?? null,
    infrastructure: pipelineResult.infrastructure.map((i) => ({
      name: i.name,
      location: i.location,
      risk: i.risk,
    })),
    estateType: merged?.estate_type ?? null,
    veoliaServiceZone:
      merged?.veolia_service_zone?.inServiceZone === true || costs?.veolia_in_zone === true,
  };
  rs = ensureMinRiskSummaryBulletsFromReport(rs, 3, backfillCtx);

  // Always surface the Veolia (Papakura) private-network guidance when the site
  // falls in the franchise area — same always-present treatment as cross-lease.
  if (backfillCtx.veoliaServiceZone) {
    const veoliaBullets = buildVeoliaRiskBullets(true, isZhRisks);
    if (veoliaBullets.length > 0) {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const veoliaHeads = new Set(veoliaBullets.map((b) => norm(b).slice(0, 36)));
      const remaining = rs.filter((b) => !veoliaHeads.has(norm(b).slice(0, 36)));
      rs = [...veoliaBullets, ...remaining];
    }
  }

  // Always surface cross-lease guidance when the title is cross-lease/stratum,
  // regardless of how many other risk bullets exist. Prepend (highest priority)
  // and drop any near-duplicate the LLM/backfill already emitted.
  if (isCrossLeaseEstate(merged?.estate_type ?? null)) {
    const crossLeaseBullets = buildCrossLeaseRiskBullets(merged?.estate_type ?? null, isZhRisks);
    if (crossLeaseBullets.length > 0) {
      const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
      const crossLeaseHeads = new Set(crossLeaseBullets.map((b) => norm(b).slice(0, 36)));
      const remaining = rs.filter((b) => !crossLeaseHeads.has(norm(b).slice(0, 36)));
      rs = [...crossLeaseBullets, ...remaining];
    }
  }

  // Redevelopment warning: listing claims (new build / townhouse / multi-unit)
  // conflicted with council records, so the recorded land/CV/yield likely
  // describe the PRE-development parent site. Surfaced as a dedicated block
  // for the UI banner AND prepended as the highest-priority risk bullet.
  const redev = pipelineResult.redevelopmentCheck;
  if (redev?.suspected) {
    const councilYearText = redev.councilBuildYear != null ? String(redev.councilBuildYear) : "an older";
    const message = isZhRisks
      ? `房源信息显示这是全新住宅（联排/多单元开发），但政府记录仍显示 ${councilYearText} 年的旧建筑 — 该地块很可能已被重新开发。下方的土地面积、CV 估值和分割潜力可能反映开发前的母地块，请勿据此做投资决策。`
      : `The listing indicates a brand-new dwelling, but council records still show a ${councilYearText} build on this parcel — the site has likely been redeveloped. The land area, CV, and subdivision yield below may describe the pre-development parent site; verify the current title before relying on them.`;
    parsed.redevelopmentWarning = {
      suspected: true,
      councilBuildYear: redev.councilBuildYear,
      listingEvidence: redev.listingClaims?.evidence ?? [],
      reasons: redev.reasons,
      message,
    };
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 40);
    rs = [message, ...rs.filter((b) => norm(b) !== norm(message))];
  } else {
    delete parsed.redevelopmentWarning;
  }

  parsed.dwellingCondition = pipelineResult.dwellingCondition ?? null;
  const conditionBullet = dwellingConditionRiskBullet(
    pipelineResult.dwellingCondition,
    lots?.lots ?? 0,
    isZhRisks,
  );
  if (conditionBullet) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 56);
    rs = [conditionBullet, ...rs.filter((b) => norm(b) !== norm(conditionBullet))];
  }

  if (pipelineResult.dataFreshness) {
    parsed.dataFreshness = pipelineResult.dataFreshness;
  }

  parsed.riskSummary = rs;

  // Deterministic "Land title" insight (cross-lease opportunity + risks). Source
  // of truth for the dedicated UI section; null for freehold/unknown so nothing renders.
  const titleInsight = buildTitleInsight(
    merged?.estate_type ?? null,
    formatTitleTypeForDisplay(merged?.estate_type?.trim() || null),
    isZhRisks,
  );
  if (titleInsight) {
    parsed.titleInsight = titleInsight;
  } else {
    delete parsed.titleInsight;
  }

  if (pipelineResult.school_zones_detail.length > 0) {
    parsed.schoolZones = pipelineResult.school_zones_detail;
  }

  if (pipelineResult.scores) {
    parsed.scores = pipelineResult.scores;
  } else {
    delete parsed.scores;
  }

  sanitizeReportScoresReasons(parsed.scores as Record<string, unknown> | undefined);
}

function buildDeterministicFallbackReport(
  pipelineResult: PipelineResult,
  resolvedAddress: string,
): Record<string, unknown> | null {
  const { merged, lots, costs, scores } = pipelineResult;
  // scores/costs are null whenever the development score is suppressed (e.g. a
  // genuine cross-lease/unit title). The report must
  // STILL be built from the confirmed facts — otherwise the analysis degrades
  // to prose, never saves to history, and the Plan tab (which needs the saved
  // report's historyId) shows "Site plan isn't available". Product rule: a
  // cross-lease may hide dev scores, but the site plan must always render.
  if (!merged || !lots) return null;

  const zoneLabel = lots.zone_label || merged.zone_description || merged.zone_code || "Unknown zone";
  const minLotSize = lots.min_lot_size ? `${lots.min_lot_size}m2` : null;
  const siteCondition = classifySiteCondition(merged);
  const riskSeed = [
    zoneLabel
      ? `${zoneLabel} controls should be checked against the intended building layout before assuming the full lot yield is practical.`
      : "The planning controls should be checked against the intended building layout before assuming the full lot yield is practical.",
    merged.contour
      ? `Terrain is classified as ${merged.contour}; earthworks and retaining allowances should follow the measured slope rather than a suburb-level assumption.`
      : "Confirm finished levels, stormwater paths, and service tie-ins early because they can materially affect consent design.",
  ];
  const finalRiskSeed = costs ? appendRuralTransferRightRiskIfNeeded(riskSeed, costs) : riskSeed;

  const parsed: Record<string, unknown> = {
    address: resolvedAddress,
    scores: scores ?? null,
    score_unavailable_reason: pipelineResult.raw_property?.derived_scores?.scoreUnavailableReason ?? null,
    propertyOverview: {
      address: resolvedAddress,
      cv: merged.cv_nzd != null ? `$${merged.cv_nzd.toLocaleString("en-NZ")}` : null,
      landArea: merged.land_area_sqm != null ? `${merged.land_area_sqm}m2` : null,
      floorArea: merged.floor_area_sqm != null ? `${merged.floor_area_sqm}m2` : null,
      buildYear: merged.build_year_range ?? (merged.build_year != null ? String(merged.build_year) : null),
      propertyType: merged.property_type ?? null,
      siteStatus: siteCondition.siteStatus,
      siteStatusLabel: siteStatusLabel(siteCondition.siteStatus),
      zone: zoneLabel,
      listingPrice: merged.listing_price != null ? `$${merged.listing_price.toLocaleString("en-NZ")}` : null,
      isOnMarket: merged.listing_active === true,
    },
    planning: {
      zone: zoneLabel,
      minLotSize,
      potentialLots: lots.lots,
      standardVacantLots: pipelineResult.subdivision_pathway?.standardVacantLots ?? lots.lots,
      standardPathViable: pipelineResult.subdivision_pathway?.standardPathViable ?? pipelineResult.subdivision_pathway?.standard_path_viable ?? false,
      standardMinLotSize: pipelineResult.subdivision_pathway?.standardMinLotSize ?? (lots.min_lot_size > 0 ? lots.min_lot_size : null),
      designLedEligible: pipelineResult.subdivision_pathway?.designLedEligible ?? false,
      designLedYieldRange: pipelineResult.subdivision_pathway?.designLedYieldRange ?? null,
      designLedConfidence: pipelineResult.subdivision_pathway?.designLedConfidence ?? "none",
      designLedReasons: pipelineResult.subdivision_pathway?.designLedReasons ?? [],
      designLedBlockers: pipelineResult.subdivision_pathway?.designLedBlockers ?? [],
      designLedSummary: pipelineResult.subdivision_pathway?.designLedSummary ?? null,
      designLedDetail: pipelineResult.subdivision_pathway?.designLedDetail ?? null,
      grossAreaSqm: lots.gross_area_sqm,
      netAreaSqm: lots.net_area_sqm,
      easementAreaSqm: lots.easement_area_sqm,
      overlays: merged.overlays.map((o) => ({ name: o.name, status: o.status, detail: o.detail })),
      easements: [],
      appurtenant_easements: [],
      easement_data_status: pipelineResult.easements.retrieval_status,
      easement_summary: pipelineResult.easements.summary,
      lot_impact_note: pipelineResult.easements.lot_impact_note ?? null,
      subdivisionSummary: pipelineResult.subdivision_pathway?.headline ?? null,
      subdivisionPathwayNote: pipelineResult.subdivision_pathway?.detail ?? null,
    },
    potential_lots: lots.lots,
    zone_label: zoneLabel,
    cv_unavailable: costs?.cv_unavailable ?? merged.cv_nzd == null,
    total_excludes_land: costs?.total_excludes_land ?? false,
    missing_critical_fields: merged.missing_critical_fields ?? [],
    data_sources: merged.data_sources ?? {},
    terrain: {
      classification: merged.contour ?? null,
      official_label: merged.contour_text ?? null,
      slope_degrees: merged.contour_slope_degrees ?? null,
      source: merged.contour_source ?? null,
      retainingCostLow: costs?.retaining_low ?? null,
      retainingCostHigh: costs?.retaining_high ?? null,
      steep_area_ratio: merged.contour_steep_area_ratio ?? null,
      moderate_area_ratio: merged.contour_moderate_area_ratio ?? null,
      local_slope_p90_degrees: merged.contour_local_slope_p90_degrees ?? null,
      local_slope_p95_degrees: merged.contour_local_slope_p95_degrees ?? null,
      sample_count: merged.contour_sample_count ?? null,
      retaining_area_sqm_estimate: costs?.retaining_area_sqm_estimate ?? null,
      large_site_terrain_adjusted: costs?.large_site_terrain_adjusted ?? merged.large_site_terrain_adjusted ?? false,
    },
    infrastructure: pipelineResult.infrastructure,
    costItems: costs ? buildDeterministicCostItems(costs) : [],
    totalCostLow: costs?.total_low ?? null,
    totalCostHigh: costs?.total_high ?? null,
    cost_per_unit_avg: costs?.cost_per_unit_avg ?? null,
    interest_rate_outlook: pipelineResult.scenarios[0]?.interest_rate_outlook ?? "stable",
    roiScenarios: [],
    developmentStrategies: pipelineResult.developmentStrategies ?? [],
    comparableSales: pipelineResult.comparables ?? [],
    comparables_quality: pipelineResult.comparables_quality,
    neighbourhoodContext: pipelineResult.neighbourhoodContext ?? null,
    transportContext: pipelineResult.transportContext ?? null,
    builtEnvironmentContext: pipelineResult.builtEnvironmentContext ?? null,
    avg_sale_price: null,
    avgPricePerSqm: null,
    riskSummary: finalRiskSeed,
    disclaimer: "These are indicative estimates only. Always engage a quantity surveyor, lawyer, and urban planner before making development decisions. Figures in NZD.",
  };

  applyDeterministicPipelineOverrides(parsed, pipelineResult, resolvedAddress);
  return parsed;
}

function emptyAnalyseFallback(address: string, locale: ReturnType<typeof normaliseLocale>): string {
  return locale === "zh"
    ? `我找到了「${address}」，但这次没有成功生成完整分析。请再试一次；如果仍然发生，我会继续用可用的地址、分区和地块数据生成保守版本。`
    : `I found ${address}, but I could not generate the full analysis this time. Please try once more; if a live source is unavailable, I will still build the report from the address, zoning, and parcel data I can verify.`;
}

function emptyChatFallback(locale: ReturnType<typeof normaliseLocale>): string {
  return locale === "zh"
    ? "我没有成功生成回复。请再试一次。"
    : "I could not generate a reply just now. Please try again.";
}

function titleCaseSuburb(suburb: string): string {
  return suburb
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === "st") return "St";
      if (lower === "mt") return "Mt";
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(" ");
}

function unavailablePropertyTopicReply(
  subject: string,
  nearbySuburb: string | null,
  locale: ReturnType<typeof normaliseLocale>,
): string {
  const cleanedSubject = subject.trim();
  const suburbLabel = nearbySuburb ? titleCaseSuburb(nearbySuburb) : null;
  if (locale === "zh") {
    const subjectText = cleanedSubject ? `「${cleanedSubject}」` : "这个物业";
    return suburbLabel
      ? `抱歉，${subjectText}目前暂不可用。要不要我帮你搜索 ${suburbLabel} 附近的在售房源？`
      : `抱歉，${subjectText}目前暂不可用。要不要我帮你搜索附近的在售房源？`;
  }

  const subjectText = cleanedSubject ? `"${cleanedSubject}"` : "that property";
  return suburbLabel
    ? `Sorry, ${subjectText} is currently unavailable. Would you like me to search what is on sale near ${suburbLabel}?`
    : `Sorry, ${subjectText} is currently unavailable. Would you like me to search what is on sale nearby?`;
}

function leadingAddressNumberForDisplay(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^([a-z]?\d+[a-z]?\s*\/\s*\d+[a-z]?|\d+[a-z]?)(?:\b|,)/i);
  return match ? match[1].replace(/\s+/g, "").toLowerCase() : null;
}

function displayAddressForAnalysis(analysisAddress: string, pipelineResult: PipelineResult): string {
  const formatted = pipelineResult.geocode?.formatted?.trim();
  if (!formatted) return analysisAddress;

  if (looksLikeUnitOrApartmentAddress(analysisAddress)) {
    const inputNumber = leadingAddressNumberForDisplay(analysisAddress);
    const formattedNumber = leadingAddressNumberForDisplay(formatted);
    if (!looksLikeUnitOrApartmentAddress(formatted) || (inputNumber && formattedNumber && inputNumber !== formattedNumber)) {
      return analysisAddress;
    }
  }

  return formatted;
}

// Simple edit-distance (Levenshtein) for fuzzy suburb matching
function editDistance(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Find suburbs to fall back to when the primary suburb has no listings.
 * Strategy: prefer LLM suggestions (the LLM can infer NZ geography candidates), then
 * top up with sister suburbs from the same realestate.co.nz district. Both
 * sources are de-duplicated and capped. No hand-curated map.
 */
async function resolveNearbySuburbs(suburb: string, max = 5): Promise<string[]> {
  const llm = await suggestNearbySuburbs(suburb, max).catch(() => [] as string[]);

  // Pull a few district siblings as a safety net for any suburbs the LLM
  // may not know about (smaller / less famous places).
  let siblings: string[] = [];
  try {
    const rec = await findSuburbId(suburb);
    if (rec) {
      const siblingRecs = await getDistrictSiblings(rec.id, 8);
      siblings = siblingRecs.map((r) => r.title.toLowerCase());
    }
  } catch { /* ignore */ }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of [...llm, ...siblings]) {
    const key = candidate.toLowerCase().trim();
    if (!key || key === suburb.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= max) break;
  }
  return out;
}

// ── Criteria-based re-ranking ──────────────────────────────────────────────────
// Applies rule-based score boosts derived from the LLM-extracted criteria string
// so that properties best matching the user's intent surface to the top before
// the final random pick.
function passesStandardSubdivisionSizeScreen(candidate: PropertyCandidate): boolean {
  return hasStandardSubdivisionYield(candidate) && passesPreliminaryStandardSubdivisionScreen(candidate);
}

function passesSubdivisionDiscoveryScreen(candidate: PropertyCandidate): boolean {
  // Opted-in non-freehold cards (cross-lease / leasehold / unit-title) are
  // informational cards the user explicitly asked to see — they can never pass
  // the freehold size / design-led screen (a cross-lease has no verified
  // individual land area), so admit them here. Without this they'd be picked
  // back out and the opt-in would dead-end to the exhausted choice. Only
  // opted-in candidates ever carry subdivisionTenureWarning (non-opted-in
  // non-freehold are dropped before becoming candidates).
  if (candidate.subdivisionTenureWarning) return true;
  return passesStandardSubdivisionSizeScreen(candidate) || candidate.designLedEligible === true;
}

function rankListingsForStrictSubdivision(listings: ListingResult[]): ListingResult[] {
  return [...listings].sort((a, b) => {
    const verifiedA = a.landAreaConfidence === "verified" && a.landArea != null;
    const verifiedB = b.landAreaConfidence === "verified" && b.landArea != null;
    if (verifiedA !== verifiedB) return verifiedA ? -1 : 1;
    const areaA = a.landArea ?? 0;
    const areaB = b.landArea ?? 0;
    return areaB - areaA;
  });
}

function buildDiscoveryCriteriaText(
  threadMessages: Message[] | undefined,
  currentUserText: string,
  intentCriteria: string | null,
): string {
  const recentUserTurns = (threadMessages ?? [])
    .filter((msg) => msg.role === "user")
    .slice(-4)
    .map((msg) => msg.content ?? "");
  return [...recentUserTurns, currentUserText, intentCriteria ?? ""].filter(Boolean).join(" ");
}

function isPlainListingBrowseWithoutDevelopment(userText: string): boolean {
  return isListingBrowseIntent(userText)
    && !isDevelopmentDiscoveryIntent(userText)
    && !isStandardSubdivisionDiscoveryIntent(userText);
}

function inferPresentationFromSearchText(text: string): DiscoverySearchPresentation {
  if (isDevelopmentDiscoveryIntent(text) || isStandardSubdivisionDiscoveryIntent(text)) {
    return "scored_screening";
  }
  return "generic_listing";
}

function findLastSubstantiveSearchPresentation(
  threadMessages: Message[] | undefined,
  currentUserText: string,
): DiscoverySearchPresentation | null {
  for (const msg of [...(threadMessages ?? [])].reverse()) {
    if (msg.role !== "user" || !msg.content) continue;
    const prevText = msg.content;
    if (prevText === currentUserText) continue;
    if (isDiscoverStreetContinuation(prevText)) continue;
    if (hasNumberedStreetAddress(prevText)) continue;
    return inferPresentationFromSearchText(prevText);
  }
  return null;
}

// True when this thread recently ran an AREA/DISCOVERY search (a discovery-intent
// user turn with no specific address, or our tenure-exclusion offer). Used to gate
// re-routing an intent correction ("I mean that is subdividable") back into the
// discover flow without hijacking a single-property report thread (where "is THIS
// subdividable?" should stay an analysis answer).
function threadHasRecentAreaDiscovery(messages: Message[] | undefined): boolean {
  for (const msg of [...(messages ?? [])].slice(-8)) {
    const text = msg.content ?? "";
    if (!text) continue;
    if (msg.role === "assistant" && parseOfferedTenuresFromAssistant(text).length > 0) return true;
    if (
      msg.role === "user" &&
      !hasNumberedStreetAddress(text) &&
      (isListingBrowseIntent(text) ||
        isStandardSubdivisionDiscoveryIntent(text) ||
        isDevelopmentDiscoveryIntent(text))
    ) {
      return true;
    }
  }
  return false;
}

function findRecentOfferedTenures(messages: Message[] | undefined): Tenure[] {
  for (const msg of [...(messages ?? [])].reverse().slice(0, 8)) {
    if (msg.role !== "assistant") continue;
    const offered = parseOfferedTenuresFromAssistant(msg.content ?? "");
    if (offered.length > 0) return offered;
  }
  return [];
}

function resolveDiscoveryPresentation(input: {
  userText: string;
  discoveryCriteria: string;
  intent?: Pick<ChatIntent, "discoveryPresentation"> | null;
  messages?: Message[];
  isFollowUp: boolean;
  continuePresentation?: DiscoverySearchPresentation;
  repeatShownAreaIntent?: boolean;
  forceNearbyDiscovery?: boolean;
}): DiscoverySearchPresentation {
  if (input.continuePresentation) return input.continuePresentation;

  // A continuation ("show me more …", "any others") inherits the prior
  // substantive search's presentation — it is NOT a fresh plain-browse reset.
  // Without this, "show me more property options" after a subdivision search is
  // misread as a fresh listing browse and flips to generic cards.
  if (input.isFollowUp && isListingBrowseContinuation(input.userText)) {
    return findLastSubstantiveSearchPresentation(input.messages, input.userText) ?? "generic_listing";
  }

  // A fresh market-availability request must reset to plain listing cards, even
  // if earlier turns were about subdivision/development.
  if (isPlainListingBrowseWithoutDevelopment(input.userText)) return "generic_listing";
  if (isDevelopmentDiscoveryIntent(input.userText) || isStandardSubdivisionDiscoveryIntent(input.userText)) {
    return "scored_screening";
  }

  if (input.intent?.discoveryPresentation) return input.intent.discoveryPresentation;

  const shouldInherit =
    input.repeatShownAreaIntent ||
    input.forceNearbyDiscovery ||
    (input.isFollowUp && isDiscoverStreetContinuation(input.userText)) ||
    (
      input.isFollowUp &&
      !isListingBrowseIntent(input.userText) &&
      !isDevelopmentDiscoveryIntent(input.userText) &&
      !isStandardSubdivisionDiscoveryIntent(input.userText)
    );
  if (shouldInherit) {
    return findLastSubstantiveSearchPresentation(input.messages, input.userText) ?? "generic_listing";
  }

  if (isDevelopmentDiscoveryIntent(input.discoveryCriteria) || isStandardSubdivisionDiscoveryIntent(input.discoveryCriteria)) {
    return "scored_screening";
  }
  return "generic_listing";
}

type DiscoverySuburbResolution =
  | { status: "valid"; suburb: string; original: string | null; kind: "suburb" | "district" | "region" }
  | { status: "invalid"; message: string };

function replaceFirstInsensitive(haystack: string, needle: string, replacement: string): string {
  if (!needle.trim()) return haystack;
  const index = haystack.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return haystack;
  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

async function resolveDiscoverySuburbName(
  suburb: string | null | undefined,
  locale: "en" | "zh",
  contextText?: string | null,
): Promise<DiscoverySuburbResolution | null> {
  const raw = suburb?.trim();
  if (!raw) return null;

  const districtChildren = resolveDistrictToSuburbs(raw);
  if (districtChildren && districtChildren.length > 0) {
    return { status: "valid", suburb: raw.toLowerCase(), original: null, kind: "district" };
  }

  const resolved = await resolveRealestateLocation(raw, contextText);
  if (resolved?.status === "suburb") {
    const normalized = resolved.suburb.title.toLowerCase();
    return {
      status: "valid",
      suburb: normalized,
      original: resolved.original ?? (normalized === raw.toLowerCase() ? null : raw),
      kind: "suburb",
    };
  }
  if (resolved?.status === "district") {
    const normalized = resolved.district.title.toLowerCase();
    return {
      status: "valid",
      suburb: normalized,
      original: resolved.original ?? (normalized === raw.toLowerCase() ? null : raw),
      kind: "district",
    };
  }
  if (resolved?.status === "region") {
    const normalized = resolved.region.title.toLowerCase();
    return {
      status: "valid",
      suburb: normalized,
      original: resolved.original ?? (normalized === raw.toLowerCase() ? null : raw),
      kind: "region",
    };
  }

  const closest = resolved?.status === "invalid" ? resolved.closest : null;
  const baseMessage = closest
    ? `I couldn't confidently match "${titleCaseSuburb(raw)}" to a NZ suburb, city, or region. Did you mean ${closest}? Please check the spelling and try again.`
    : `I couldn't confidently match "${titleCaseSuburb(raw)}" to a NZ suburb, city, or region. Please check the spelling and try again.`;
  return {
    status: "invalid",
    message: locale === "zh" ? await ensureChinese(baseMessage) : baseMessage,
  };
}

function rankByCriteria(candidates: PropertyCandidate[], criteria: string | null): PropertyCandidate[] {
  if (!criteria || candidates.length === 0) return candidates;
  const c = criteria.toLowerCase();

  // Parse intent signals from criteria text
  const wantsDevelopment  = isDevelopmentDiscoveryIntent(c);
  const wantsLargeLand    = /large|big|big\s+section|land\s+size|land\s+area|estate|wide|spacious/i.test(c);
  const wantsInvestment   = /invest|roi|yield|return|rental|income/i.test(c);
  const wantsLifestyle    = /lifestyle|rural|acreage|farm|rural/i.test(c);
  const wantsAffordable   = /afford|cheap|budget|value|low[\s-]cost/i.test(c);
  const wantsMinLand      = (() => {
    // "land over 600m²", "at least 700sqm", "bigger than 500", etc.
    const m = c.match(/(?:over|above|at\s+least|more\s+than|bigger\s+than|larger\s+than|minimum)\s+(\d+)\s*(?:m2|sqm|m²|square)/i)
           ?? c.match(/(\d{3,5})\s*(?:m2|sqm|m²)\s+(?:or\s+)?(?:more|plus|above|over)/i);
    return m ? parseInt(m[1], 10) : null;
  })();
  const wantsMaxLand      = (() => {
    const m = c.match(/(?:under|below|less\s+than|smaller\s+than|up\s+to)\s+(\d+)\s*(?:m2|sqm|m²|square)/i);
    return m ? parseInt(m[1], 10) : null;
  })();

  const DEVELOPMENT_ZONES = new Set(["THAB", "MHU", "MHU-H", "MHU-S", "MHS"]);

  const ranked = candidates.map((p) => {
    let boost = 0;
    const zone = (p.zone ?? "").toUpperCase().trim();
    const land = p.landArea ?? 0;

    if (wantsDevelopment) {
      const potentialLots = p.potentialLots ?? 1;
      const designLedMax = p.designLedYieldRange?.max ?? 0;
      if (potentialLots >= 4) boost += 4;
      else if (potentialLots >= 3) boost += 3;
      else if (potentialLots >= 2) boost += 2.4;
      else if (p.designLedEligible && designLedMax >= 2) boost += 1.2;
      else boost -= 2.5;

      if (DEVELOPMENT_ZONES.has(zone)) boost += 2;
      else if (zone === "SHZ" && potentialLots >= 2) boost += 0.5;
      else if (zone === "LLRZ" || zone === "CLZ" || zone === "RUR") boost -= 1.5;

      if (land >= 1200) boost += 1.5;
      else if (land >= 800) boost += 1.1;
      else if (land >= 600) boost += 0.7;
      else if (land > 0) boost -= 0.8;

      boost += p.scores.ease * 0.25;
    }

    if (wantsLargeLand) {
      // Scale boost with land area, capped at 3
      boost += Math.min(3, land / 400);
    }

    if (wantsMinLand !== null) {
      // Hard filter: strong negative if below minimum
      if (land > 0 && land < wantsMinLand) boost -= 5;
      else if (land >= wantsMinLand) boost += 1;
    }

    if (wantsMaxLand !== null && land > wantsMaxLand) {
      boost -= 3; // penalise over-sized sites
    }

    if (wantsInvestment) {
      boost += p.scores.roi * 0.5;
    }

    if (wantsLifestyle) {
      // Prefer larger land and rural-leaning zones
      boost += Math.min(2, land / 600);
      if (zone === "RUR" || zone === "LLRZ") boost += 1;
    }

    if (wantsAffordable) {
      boost += p.scores.cost * 0.4;
    }

    return { candidate: p, score: p.scores.composite + boost };
  });

  return ranked
    .sort((a, b) => b.score - a.score)
    .map((r) => r.candidate);
}

// Randomly pick up to `n` items from an array (Fisher-Yates partial shuffle)
function shufflePick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const end = Math.min(n, copy.length);
  for (let i = 0; i < end; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, end);
}

function pickRankedCandidates(candidates: PropertyCandidate[], criteria: string | null, n = 3): PropertyCandidate[] {
  const ranked = rankByCriteria(candidates, criteria);
  if (isStandardSubdivisionDiscoveryIntent(criteria)) {
    return ranked.filter(passesSubdivisionDiscoveryScreen).slice(0, n);
  }
  if (isDevelopmentDiscoveryIntent(criteria)) return ranked.slice(0, n);
  return shufflePick(ranked.slice(0, Math.max(n, 6)), n);
}

function isAlreadyShownAddress(address: string | null | undefined, shownKeys: Set<string>): boolean {
  if (shownKeys.size === 0) return false;
  const key = normaliseDiscoveryAddressKey(address);
  return !!key && shownKeys.has(key);
}

function filterAlreadyShownListings<T extends { address?: string | null }>(
  listings: T[],
  shownKeys: Set<string>,
): T[] {
  if (shownKeys.size === 0) return listings;
  return listings.filter((listing) => !isAlreadyShownAddress(listing.address, shownKeys));
}

function filterAlreadyShownCandidates(
  candidates: PropertyCandidate[],
  shownKeys: Set<string>,
): PropertyCandidate[] {
  if (shownKeys.size === 0) return candidates;
  return candidates.filter((candidate) => !isAlreadyShownAddress(candidate.address, shownKeys));
}

/**
 * Order a raw listing pool for a price-range search. Numeric prices outside the
 * range (`[minPrice, maxPrice * 1.1]`) are always dropped.
 *
 * When the user gave an explicit price range (`requireSourceBackedPrice`),
 * priced in-range listings lead and unpriced negotiation/auction listings
 * (`price == null`) follow — *included* rather than excluded, since dropping
 * them yields empty results in negotiation-heavy suburbs (Kohimarama, Remuera),
 * and the card clearly labels them "By negotiation". With no explicit range,
 * unpriced listings stay first-class in a single ranked stream (prior behaviour).
 */
function orderListingsByPriceTier(
  listings: ListingResult[],
  minPrice: number,
  maxPrice: number,
  isStrict: boolean,
  requireSourceBackedPrice: boolean,
): ListingResult[] {
  const rank = (xs: ListingResult[]) => (isStrict ? rankListingsForStrictSubdivision(xs) : xs);
  const inNumericRange = (l: ListingResult) =>
    l.price != null && l.price >= minPrice && l.price <= maxPrice * 1.1;
  if (!requireSourceBackedPrice) {
    return rank(listings.filter((l) => l.price == null || inNumericRange(l)));
  }
  const priced = listings.filter(inNumericRange);
  const unpriced = listings.filter((l) => l.price == null);
  return [...rank(priced), ...rank(unpriced)];
}

const INTERNAL_SPONSORED_LISTING_URL_PREFIX = "projectalpha://listing/";
const INTERNAL_SPONSORED_ADDRESS_KEY_PREFIX = "internal-listing:";

function internalSponsoredAddressKey(listingId: string): string {
  return `${INTERNAL_SPONSORED_ADDRESS_KEY_PREFIX}${listingId}`;
}

function internalSponsoredListingUrl(listingId: string): string {
  return `${INTERNAL_SPONSORED_LISTING_URL_PREFIX}${listingId}`;
}

function stablePositiveHash(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function sponsoredCompletenessScore(row: {
  imageUrls: string[];
  priceNzd: number | null;
  priceDisplay: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  floorAreaSqm: number | null;
  listingTitle: string | null;
  description: string | null;
  features: string[];
  agentAvatarUrl: string | null;
  agencyName: string | null;
}): number {
  let score = 0;
  if (row.imageUrls.length > 0) score += 3;
  if (row.imageUrls.length > 2) score += 1;
  if (row.priceNzd != null || row.priceDisplay) score += 2;
  if (row.bedrooms != null) score += 1;
  if (row.bathrooms != null) score += 1;
  if (row.landAreaSqm != null) score += 1;
  if (row.floorAreaSqm != null) score += 0.5;
  if (row.listingTitle?.trim()) score += 1;
  if ((row.description?.trim().length ?? 0) >= 80) score += 2;
  if (row.features.length > 0) score += 1;
  if (row.agentAvatarUrl) score += 1;
  if (row.agencyName?.trim()) score += 1;
  return score;
}

function shouldConsiderSponsoredGenericListing(args: {
  userId: string | null;
  suburb: string;
  isFollowUp: boolean;
  shownAddressKeys: Set<string>;
}): boolean {
  if (!args.isFollowUp) return true;
  const sponsoredShownCount = Array.from(args.shownAddressKeys).filter((key) =>
    key.startsWith(INTERNAL_SPONSORED_ADDRESS_KEY_PREFIX),
  ).length;
  if (sponsoredShownCount === 0) return true;
  return stablePositiveHash(`${args.userId ?? "anonymous"}:${args.suburb}:${args.shownAddressKeys.size}`) % 3 === 0;
}

async function pickSponsoredGenericListingCandidate(args: {
  userId: string | null;
  suburb: string;
  minPrice: number;
  maxPrice: number;
  isFollowUp: boolean;
  shownAddressKeys: Set<string>;
  log: { warn: (obj: unknown, msg?: string) => void };
}): Promise<PropertyCandidate | null> {
  const suburb = args.suburb.trim().toLowerCase();
  if (!suburb || !shouldConsiderSponsoredGenericListing(args)) return null;

  try {
    const rows = await withDbRetry(() =>
      db
        .select({
          id: listings.id,
          userId: listings.userId,
          address: listings.address,
          addressSuburb: listings.addressSuburb,
          addressCity: listings.addressCity,
          propertyType: listings.propertyType,
          bedrooms: listings.bedrooms,
          bathrooms: listings.bathrooms,
          toilets: listings.toilets,
          garages: listings.garages,
          landAreaSqm: listings.landAreaSqm,
          floorAreaSqm: listings.floorAreaSqm,
          priceNzd: listings.priceNzd,
          priceDisplay: listings.priceDisplay,
          listingTitle: listings.listingTitle,
          description: listings.description,
          imageUrls: listings.imageUrls,
          features: listings.features,
          createdAt: listings.createdAt,
          updatedAt: listings.updatedAt,
          agentName: profiles.fullName,
          agentAvatarUrl: profiles.avatarUrl,
          agentVerified: profiles.isVerified,
          agentPhone: profiles.phoneNumber,
          agencyName: salesAgentProfiles.agencyName,
        })
        .from(listings)
        .innerJoin(profiles, eq(profiles.id, listings.userId))
        .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, listings.userId))
        .where(and(
          eq(listings.status, "active" as const),
          eq(listings.listingType, "for_sale" as const),
          isNull(listings.removedAt),
          isNotNull(listings.approvedAt),
          sql`lower(coalesce(${listings.addressSuburb}, '')) = ${suburb}`,
          sql`(${listings.priceNzd} is null or (${listings.priceNzd} >= ${args.minPrice} and ${listings.priceNzd} <= ${Math.round(args.maxPrice * 1.1)}))`,
        ))
        .orderBy(desc(listings.updatedAt))
        .limit(60),
    );

    const eligible = rows.filter((row) => {
      if (args.shownAddressKeys.has(internalSponsoredAddressKey(row.id))) return false;
      if (isAlreadyShownAddress(row.address, args.shownAddressKeys)) return false;
      return true;
    });
    if (eligible.length === 0) return null;

    const bestByAgent = new Map<string, (typeof eligible)[number]>();
    for (const row of eligible) {
      const existing = bestByAgent.get(row.userId);
      if (!existing) {
        bestByAgent.set(row.userId, row);
        continue;
      }
      const rowScore = sponsoredCompletenessScore(row);
      const existingScore = sponsoredCompletenessScore(existing);
      if (rowScore > existingScore || (rowScore === existingScore && row.updatedAt.getTime() > existing.updatedAt.getTime())) {
        bestByAgent.set(row.userId, row);
      }
    }

    const ranked = Array.from(bestByAgent.values())
      .map((row) => {
        const freshnessDays = Math.max(0, (Date.now() - row.updatedAt.getTime()) / 86_400_000);
        const freshnessScore = Math.max(0, 8 - Math.min(8, freshnessDays / 7));
        const jitter = (stablePositiveHash(`${args.userId ?? "anonymous"}:${suburb}:${row.userId}:${row.id}`) % 1000) / 1000;
        return {
          row,
          score: sponsoredCompletenessScore(row) + freshnessScore + jitter,
        };
      })
      .sort((a, b) => b.score - a.score);

    const row = ranked[0]?.row;
    if (!row) return null;

    return {
      address: row.address,
      price: row.priceNzd ?? 0,
      landArea: row.landAreaSqm ?? undefined,
      scores: { ease: 0, cost: 0, roi: 0, composite: 0 },
      briefSummary: buildListingTeaser(row.description, {
        address: row.address,
        listingTitle: row.listingTitle,
        propertyType: row.propertyType,
        bedrooms: row.bedrooms,
        bathrooms: row.bathrooms,
        toilets: row.toilets,
        garages: row.garages,
        landAreaSqm: row.landAreaSqm,
        floorAreaSqm: row.floorAreaSqm,
        priceDisplay: row.priceDisplay,
      }) ?? undefined,
      listingUrl: internalSponsoredListingUrl(row.id),
      photoUrl: row.imageUrls[0],
      photoUrls: row.imageUrls,
      priceDisplay: row.priceDisplay ?? undefined,
      propertyType: row.propertyType,
      listingTitle: row.listingTitle,
      description: row.description,
      features: row.features,
      agentName: row.agentName,
      agencyName: row.agencyName,
      agentAvatarUrl: row.agentAvatarUrl,
      agentPhone: row.agentPhone,
      bedrooms: row.bedrooms ?? undefined,
      bathrooms: row.bathrooms ?? undefined,
      toilets: row.toilets ?? null,
      garages: row.garages ?? null,
      floorArea: row.floorAreaSqm ?? undefined,
      source: "internal",
      internalListingId: row.id,
      isSponsored: true,
      sponsoredLabel: "Sponsored",
    };
  } catch (err) {
    args.log.warn({ err, suburb }, "Discovery: failed to select sponsored generic listing");
    return null;
  }
}

async function mergeSponsoredGenericListingCandidate(args: {
  candidates: PropertyCandidate[];
  suburb: string | null;
  minPrice: number;
  maxPrice: number;
  isFollowUp: boolean;
  shownAddressKeys: Set<string>;
  userId: string | null;
  targetCount: number;
  log: { warn: (obj: unknown, msg?: string) => void };
}): Promise<PropertyCandidate[]> {
  if (!args.suburb || args.targetCount <= 0) {
    return prioritizeSponsoredGenericCandidates(args.candidates).slice(0, args.targetCount);
  }
  if (args.candidates.some((candidate) => candidate.isSponsored || candidate.sponsoredLabel?.trim())) {
    return prioritizeSponsoredGenericCandidates(args.candidates).slice(0, args.targetCount);
  }

  const sponsored = await pickSponsoredGenericListingCandidate({
    userId: args.userId,
    suburb: args.suburb,
    minPrice: args.minPrice,
    maxPrice: args.maxPrice,
    isFollowUp: args.isFollowUp,
    shownAddressKeys: args.shownAddressKeys,
    log: args.log,
  });
  if (!sponsored) return prioritizeSponsoredGenericCandidates(args.candidates).slice(0, args.targetCount);

  const sponsoredAddressKey = normaliseDiscoveryAddressKey(sponsored.address);
  const withoutDuplicate = args.candidates.filter((candidate) => {
    if (candidate.isSponsored) return false;
    const key = normaliseDiscoveryAddressKey(candidate.address);
    return !sponsoredAddressKey || key !== sponsoredAddressKey;
  });
  const merged = [...withoutDuplicate];
  merged.splice(0, 0, sponsored);
  return prioritizeSponsoredGenericCandidates(merged).slice(0, args.targetCount);
}

function pickDiscoveryCandidates(
  candidates: PropertyCandidate[],
  criteria: string | null,
  shownKeys: Set<string>,
  n = 3,
): PropertyCandidate[] {
  return pickRankedCandidates(filterAlreadyShownCandidates(candidates, shownKeys), criteria, n);
}

function appendUniqueDiscoveryCandidates(
  existing: PropertyCandidate[],
  next: PropertyCandidate[],
  targetCount = 3,
): PropertyCandidate[] {
  const seen = new Set(
    existing
      .map((candidate) => normaliseDiscoveryAddressKey(candidate.address))
      .filter((key): key is string => Boolean(key)),
  );
  const out = [...existing];
  for (const candidate of next) {
    const key = normaliseDiscoveryAddressKey(candidate.address);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(candidate);
    if (out.length >= targetCount) break;
  }
  return out;
}

async function hydrateGenericListingAgentDetails(
  candidates: PropertyCandidate[],
  log: { warn: (obj: unknown, msg?: string) => void },
): Promise<PropertyCandidate[]> {
  return Promise.all(candidates.map(async (candidate) => {
    if (candidate.agentName || candidate.agencyName || candidate.agentAvatarUrl || !candidate.listingUrl) {
      return candidate;
    }
    try {
      const agent = await fetchRealestateAgentForListingUrl(candidate.listingUrl);
      if (!agent) return candidate;
      return {
        ...candidate,
        agentName: agent.agentName,
        agencyName: agent.agencyName,
        agentAvatarUrl: agent.agentAvatarUrl,
        agentPhone: agent.agentPhone,
      };
    } catch (err) {
      log.warn({ err, listingUrl: candidate.listingUrl }, "Discovery: failed to hydrate generic listing agent");
      return candidate;
    }
  }));
}

/** Put prescreened-but-not-shown listings back at the front; failures / skipped at the back so we exhaust the suburb before falling back. */
function partitionBatchAfterPrescreen(
  batch: ListingResult[],
  screened: PropertyCandidate[],
  picked: PropertyCandidate[],
  criteria?: string | null,
  shownAddressKeys: Set<string> = new Set(),
): { putAtFront: ListingResult[]; putAtBack: ListingResult[] } {
  const pickedUrls = new Set(picked.map((p) => p.listingUrl).filter(Boolean));
  const screenedUrls = new Set(screened.map((s) => s.listingUrl).filter(Boolean));
  const subdivisionHardScreen = isStandardSubdivisionDiscoveryIntent(criteria);
  const subdivisionViableUrls = new Set(
    screened
      .filter(passesSubdivisionDiscoveryScreen)
      .map((s) => s.listingUrl)
      .filter(Boolean),
  );
  const putAtFront: ListingResult[] = [];
  const putAtBack: ListingResult[] = [];
  for (const l of batch) {
    if (pickedUrls.has(l.listingUrl)) continue;
    if (isAlreadyShownAddress(l.address, shownAddressKeys)) continue;
    if (screenedUrls.has(l.listingUrl)) {
      if (subdivisionHardScreen && !subdivisionViableUrls.has(l.listingUrl)) putAtBack.push(l);
      else putAtFront.push(l);
    }
    else putAtBack.push(l);
  }
  return { putAtFront, putAtBack };
}

async function prescreenPickRestoreBatch(
  cacheKey: string,
  batch: ListingResult[],
  criteria: string | null,
  preScreenOpts?: { allowMissingListingPrice?: boolean; pricePlaceholderNzd?: number; strictStandardSubdivision?: boolean; preliminarySubdivision?: boolean; developmentScreening?: boolean; verifyFreeholdTitle?: boolean; includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[] },
  shownAddressKeys: Set<string> = new Set(),
  n = 3,
  restoreUnpicked = true,
  indeterminateAccumulator?: ListingResult[],
): Promise<PropertyCandidate[]> {
  const visibleBatch = filterAlreadyShownListings(batch, shownAddressKeys);
  if (visibleBatch.length === 0) return [];
  const detailed = await preScreenListingsFastDetailed(visibleBatch, 5, null, preScreenOpts).catch(
    () => ({ candidates: [] as PropertyCandidate[], indeterminate: [] as ListingResult[], excludedTenures: { cross_lease: 0, leasehold: 0, unit_title: 0 }, excludedNonFreehold: [], drainComplete: Promise.resolve() }),
  );
  const screened = detailed.candidates;
  // Stash any non-freehold listings dropped while paging so a later "include
  // them" opt-in can re-screen exactly these with the tenure waiver.
  if (detailed.excludedNonFreehold.length > 0) {
    addExcludedNonFreehold(cacheKey, detailed.excludedNonFreehold);
  }
  if (indeterminateAccumulator && detailed.indeterminate.length > 0) {
    indeterminateAccumulator.push(...detailed.indeterminate);
  }
  const candidates = pickDiscoveryCandidates(screened, criteria, shownAddressKeys, n);
  const pickedUrls = candidates.map((c) => c.listingUrl).filter((u): u is string => Boolean(u));
  markShown(cacheKey, pickedUrls);
  const { putAtFront, putAtBack } = partitionBatchAfterPrescreen(visibleBatch, screened, candidates, criteria, shownAddressKeys);
  if (restoreUnpicked) restoreListingsAfterPop(cacheKey, putAtFront, putAtBack);
  return candidates;
}

/**
 * Run a discovery search across either a single suburb or, when the user typed
 * a Local-Board / district name like "orakei", every child suburb in parallel.
 *
 * Without this, district queries fell through `searchListingsByName` (couldn't
 * resolve "orakei" as a suburb), then through the HTML scraper fallback
 * (ScrapingBee burn), then sequentially through nearby suburbs — burning quota
 * and timing out. This composer fans out cheaply and shares the verdict cache
 * across child searches.
 *
 * Returns the merged listing pool plus the actual suburb(s) searched so
 * callers can log + cache key correctly. `isDistrictFanOut` is true when we
 * fanned out (used to set the loading-hint for change #6 below).
 */
// ─── Discovery candidate display sanity ─────────────────────────────────────
// Scrapers occasionally emit a malformed listing — e.g. an address of "Https:"
// (a URL fragment parsed as the street) or an absurd land area (34,844,385 m²).
// These must never reach a property card. Validate at the final step so junk
// from ANY source is dropped regardless of which scraper produced it.
const STREET_SUFFIX_RE =
  /\b(road|rd|street|st|avenue|ave|drive|dr|lane|ln|place|pl|crescent|cres|terrace|tce|way|close|grove|parade|pde|highway|hwy|court|ct|quay|esplanade|rise|mews|boulevard|blvd|loop|crest|heights|view|valley|bay|beach|point|pt|ridge|park|gardens)\b/i;

function isPlausibleStreetAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== "string") return false;
  const a = address.trim();
  if (a.length < 6) return false;
  // URL fragments / web chrome leaked into the address field.
  if (/^https?:?$/i.test(a)) return false;
  if (/https?:\/\//i.test(a) || /\bwww\.|\.co\.nz|\.com\b|\.net\b/i.test(a)) return false;
  // Must contain a letter (Latin or CJK).
  if (!/[a-z一-鿿]/i.test(a)) return false;
  // Address-like shape: a comma (street, suburb, region), OR a street number +
  // word, OR a recognised street-type suffix.
  return a.includes(",") || /\d+\s+\S+/.test(a) || STREET_SUFFIX_RE.test(a);
}

// Generous upper bound — legit lifestyle blocks can be large, but anything over
// ~200 ha in a residential discovery search is corrupt scraped data.
const MAX_SANE_LAND_AREA_SQM = 2_000_000;

function isSaneLandArea(landArea: number | null | undefined): boolean {
  if (landArea == null) return true; // unknown is allowed
  return Number.isFinite(landArea) && landArea >= 10 && landArea <= MAX_SANE_LAND_AREA_SQM;
}

/** Drop candidates with an implausible address; null out an insane land area so
 *  a single bad field doesn't discard an otherwise valid listing. */
function sanitizeDiscoveryCandidates(
  candidates: import("../lib/pre-screen").PropertyCandidate[],
): import("../lib/pre-screen").PropertyCandidate[] {
  return candidates
    .filter((c) => isPlausibleStreetAddress(c.address))
    .map((c) =>
      isSaneLandArea(c.landArea)
        ? c
        : { ...c, landArea: undefined, landAreaApprox: false, landAreaConfidence: undefined },
    );
}

async function searchSuburbOrDistrict(args: {
  suburb: string;
  minPrice: number;
  maxPrice: number;
  skipUrls: string[];
  includeNegotiation: boolean;
  firstBatchSize?: number;
  fetchAllPages: boolean;
  maxListings?: number;
  startOffset?: number;
  maxPages?: number;
  log: Logger;
}): Promise<{
  firstBatch: ListingResult[];
  remainingListings: ListingResult[];
  source: string;
  suburbsSearched: string[];
  isDistrictFanOut: boolean;
  nextOffset: number;
  totalAvailable: number | null;
  done: boolean;
}> {
  const liveLocation = await resolveRealestateLocation(args.suburb).catch(() => null);
  const childSuburbs = liveLocation?.status
    ? null
    : resolveDistrictToSuburbs(args.suburb);
  if (!childSuburbs || childSuburbs.length === 0) {
    const result = await searchRealEstateListings({
      suburb: args.suburb,
      minPrice: args.minPrice,
      maxPrice: args.maxPrice,
      skipUrls: args.skipUrls,
      includeNegotiation: args.includeNegotiation,
      firstBatchSize: args.firstBatchSize,
      fetchAllPages: args.fetchAllPages,
      maxListings: args.maxListings,
      startOffset: args.startOffset,
      maxPages: args.maxPages,
    });
    return {
      firstBatch: result.firstBatch,
      remainingListings: result.remainingListings,
      source: result.source,
      suburbsSearched: [args.suburb],
      isDistrictFanOut: false,
      nextOffset: result.nextOffset,
      totalAvailable: result.totalAvailable,
      done: result.done,
    };
  }

  args.log.info(
    { district: args.suburb, childSuburbs },
    "Discovery: typed input resolves to a district — fanning out across child suburbs in parallel",
  );

  // Cap maxListings per child so a district fan-out doesn't pull 500 × N. The
  // verdict cache + earlyBail downstream will short-circuit the heavy work
  // once we have enough candidates.
  const perChildMaxListings = args.maxListings != null
    ? Math.max(50, Math.ceil(args.maxListings / Math.max(1, childSuburbs.length)))
    : undefined;

  const settled = await Promise.allSettled(
    childSuburbs.map((nb) =>
      searchRealEstateListings({
        suburb: nb,
        minPrice: args.minPrice,
        maxPrice: args.maxPrice,
        skipUrls: args.skipUrls,
        includeNegotiation: args.includeNegotiation,
        firstBatchSize: args.firstBatchSize,
        // District fan-out cannot be resumed with one flat offset because each
        // child suburb has its own source cursor. Fetch every child suburb here
        // so a district-style query is still genuinely exhausted before fallback.
        fetchAllPages: true,
        maxListings: perChildMaxListings,
      }),
    ),
  );

  const firstBatch: ListingResult[] = [];
  const remainingListings: ListingResult[] = [];
  const seen = new Set<string>();
  let source = "realestate.co.nz";
  const suburbsSearched: string[] = [];

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const childSuburb = childSuburbs[i];
    if (r.status !== "fulfilled" || !r.value) continue;
    source = r.value.source;
    if (r.value.firstBatch.length + r.value.remainingListings.length > 0) {
      suburbsSearched.push(childSuburb);
    }
    for (const l of r.value.firstBatch) {
      const key = l.listingUrl || l.address;
      if (!seen.has(key)) {
        seen.add(key);
        firstBatch.push(l);
      }
    }
    for (const l of r.value.remainingListings) {
      const key = l.listingUrl || l.address;
      if (!seen.has(key)) {
        seen.add(key);
        remainingListings.push(l);
      }
    }
  }

  args.log.info(
    { district: args.suburb, suburbsSearched, firstBatch: firstBatch.length, remaining: remainingListings.length },
    "Discovery: district fan-out merged",
  );

  // District fan-out merges several suburbs into one pool; every child was
  // fetched with fetchAllPages=true above, so this merged set is complete.
  return { firstBatch, remainingListings, source, suburbsSearched, isDistrictFanOut: true, nextOffset: 0, totalAvailable: null, done: true };
}

async function topUpDiscoveryCandidates(
  cacheKey: string,
  existing: PropertyCandidate[],
  criteria: string | null,
  preScreenOpts: { allowMissingListingPrice?: boolean; pricePlaceholderNzd?: number; strictStandardSubdivision?: boolean; preliminarySubdivision?: boolean; developmentScreening?: boolean; verifyFreeholdTitle?: boolean; includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[] },
  shownAddressKeys: Set<string>,
  options: { batchSize?: number; nonStrictAttemptLimit?: number; targetCount?: number; indeterminateAccumulator?: ListingResult[] } = {},
): Promise<PropertyCandidate[]> {
  const batchSize = options.batchSize ?? 8;
  const nonStrictAttemptLimit = options.nonStrictAttemptLimit ?? 6;
  const targetCount = options.targetCount ?? 3;
  const strictStandardSubdivision = preScreenOpts.strictStandardSubdivision === true;
  const out = [...existing];
  let attempts = 0;

  while (shouldContinueDiscoveryDrain({
    currentCount: out.length,
    remainingCount: getRemainingCount(cacheKey),
    attempts,
    strictStandardSubdivision,
    nonStrictAttemptLimit,
    targetCount,
  })) {
    attempts++;
    const { listings: nextListings } = popNextListings(cacheKey, batchSize);
    if (nextListings.length === 0) break;
    const next = await prescreenPickRestoreBatch(
      cacheKey,
      nextListings,
      criteria,
      preScreenOpts,
      shownAddressKeys,
      Math.max(1, targetCount - out.length),
      !strictStandardSubdivision,
      options.indeterminateAccumulator,
    );
    out.push(...next);
  }

  return out.slice(0, targetCount);
}

function genericCandidateFromListing(listing: ListingResult): PropertyCandidate {
  const photoUrls = listing.photoUrls?.length ? listing.photoUrls : listing.photoUrl ? [listing.photoUrl] : undefined;
  const listingTitle = listing.listingTitle ?? listing.address.split(",")[0]?.trim() ?? listing.address;
  return {
    address: listing.address,
    price: listing.price ?? 0,
    landArea: listing.landArea ?? undefined,
    scores: { ease: 0, cost: 0, roi: 0, composite: 0 },
    briefSummary: buildListingTeaser(listing.description, {
      address: listing.address,
      listingTitle,
      propertyType: listing.propertyType ?? listing.listingCategory,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      landAreaSqm: listing.landArea,
      floorAreaSqm: listing.floorArea,
      priceDisplay: listing.priceText,
    }) ?? undefined,
    listingUrl: listing.listingUrl,
    photoUrl: listing.photoUrl ?? undefined,
    photoUrls,
    priceDisplay: listing.priceText || undefined,
    propertyType: listing.propertyType ?? listing.listingCategory ?? undefined,
    listingTitle,
    description: listing.description ?? undefined,
    features: listing.features?.length ? listing.features : undefined,
    agentName: listing.agentName ?? undefined,
    agencyName: listing.agencyName ?? undefined,
    agentAvatarUrl: listing.agentAvatarUrl ?? undefined,
    bedrooms: listing.bedrooms ?? undefined,
    bathrooms: listing.bathrooms ?? undefined,
    bedroomsApprox: listing.bedroomsApprox || undefined,
    bathroomsApprox: listing.bathroomsApprox || undefined,
    landAreaApprox: listing.landAreaApprox || undefined,
    landAreaSource: listing.landAreaSource,
    landAreaConfidence: listing.landAreaConfidence,
    isParentParcelSuspect: listing.isParentParcelSuspect || undefined,
    isAlreadySubdividedChild: listing.isAlreadySubdividedChild || undefined,
    priceApprox: listing.priceApprox || undefined,
    floorArea: listing.floorArea ?? undefined,
    floorAreaApprox: listing.floorAreaApprox || undefined,
    typology: "unknown",
    typologyConfidence: "unknown",
    titleConfidence: "unknown",
    screeningStatus: "preliminary",
    source: "curated",
  };
}

function pickGenericListingCandidates(
  listings: ListingResult[],
  shownAddressKeys: Set<string>,
  targetCount: number,
): PropertyCandidate[] {
  const candidates: PropertyCandidate[] = [];
  const seen = new Set<string>();
  for (const listing of listings) {
    if (isAlreadyShownAddress(listing.address, shownAddressKeys)) continue;
    const key = normaliseDiscoveryAddressKey(listing.address) || listing.listingUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(genericCandidateFromListing(listing));
    if (candidates.length >= targetCount) break;
  }
  return candidates;
}

function topUpGenericListingCandidates(
  cacheKey: string,
  existing: PropertyCandidate[],
  shownAddressKeys: Set<string>,
  targetCount = 3,
  batchSize = 8,
): PropertyCandidate[] {
  let out = [...existing];
  while (out.length < targetCount && getRemainingCount(cacheKey) > 0) {
    const { listings: nextListings } = popNextListings(cacheKey, batchSize);
    if (nextListings.length === 0) break;
    const next = pickGenericListingCandidates(nextListings, shownAddressKeys, targetCount - out.length);
    out = appendUniqueDiscoveryCandidates(out, next, targetCount);
    markShown(cacheKey, next.map((candidate) => candidate.listingUrl).filter((url): url is string => Boolean(url)));
    // popNextListings spliced `batchSize` rows out of the pool, but we only keep
    // up to (targetCount - out.length). Without restoring the overflow, every
    // "show more" silently discards the unpicked rows (~batchSize-targetCount per
    // tap), draining the pool far faster than it displays and faking exhaustion.
    // Restore the not-picked, not-already-shown rows to the FRONT so the next tap
    // serves them in original order. (Already-shown / intra-batch duplicates share
    // a picked key or are filtered here, so they're never restored — which also
    // means `leftover` is only non-empty once targetCount is reached, so the loop
    // still terminates.)
    const pickedKeys = new Set(
      next.map((candidate) => normaliseDiscoveryAddressKey(candidate.address) || candidate.listingUrl || ""),
    );
    const leftover = nextListings.filter((listing) => {
      const key = normaliseDiscoveryAddressKey(listing.address) || listing.listingUrl || "";
      return Boolean(key) && !pickedKeys.has(key) && !isAlreadyShownAddress(listing.address, shownAddressKeys);
    });
    if (leftover.length > 0) restoreListingsAfterPop(cacheKey, leftover, []);
  }
  return prioritizeSponsoredGenericCandidates(out).slice(0, targetCount);
}

// Resume window for "Show more". Long enough to survive an overnight / next-day
// gap (user closes the app and comes back later), and slid forward on every
// /discovery/next call (see saveContinuationState) so an active browse never
// expires mid-session. The durable shown-memory (30-day) stays separate.
const DISCOVERY_CONTINUATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Prefetch a couple of Show-more pages ahead (not just one) so the next tap is
// an instant cache hit even when a source window drains, instead of stalling
// into a live re-fetch / nearby-suburb screen mid-scroll.
const DISCOVERY_CONTINUATION_PREFETCH_COUNT = 9;
const DISCOVERY_CONTINUATION_PAGE_SIZE = 3;
// Generic browse paginates the source lazily: fetch this many API pages (100
// listings each) per window, then refill the pool one window at a time on
// Show-more. Keeps the first-load latency bounded on high-inventory suburbs
// (e.g. a 900-listing suburb loads 200 up front instead of all 900) while every
// subsequent Show-more stays an instant cache hit until a window genuinely drains.
const GENERIC_PAGE_WINDOW = 2;
// Subdivision/scored screening uses a larger window: the pool is ranked
// (best development sites first) before per-listing screening, so the initial
// window must be big enough to rank a meaningful set. There is NO hard count
// cap — when this ranked window drains, the cursor resumes the next window until
// the suburb is genuinely exhausted (true full exhaustion). Heavy per-listing
// screening stays incremental and is hidden by background prefetch.
const SUBDIVISION_PAGE_WINDOW = 5;

type DiscoverySearchPresentation = "generic_listing" | "scored_screening";

function continuationOwnerKey(userId: string | null, anonymousHash: string | null): string | null {
  if (userId) return `user:${userId}`;
  if (anonymousHash) return `anon:${anonymousHash}`;
  return null;
}

function candidateShownKey(candidate: Pick<PropertyCandidate, "address" | "listingUrl">): string {
  return normaliseDiscoveryAddressKey(candidate.address) || candidate.listingUrl || candidate.address;
}

function shownKeysFromCandidates(candidates: Array<Pick<PropertyCandidate, "address" | "listingUrl">>): Set<string> {
  const keys = new Set<string>();
  for (const candidate of candidates) {
    const addressKey = normaliseDiscoveryAddressKey(candidate.address);
    if (addressKey) keys.add(addressKey);
    if (candidate.listingUrl) keys.add(candidate.listingUrl);
  }
  return keys;
}

function filterCandidatesAlreadyShown<T extends Pick<PropertyCandidate, "address" | "listingUrl">>(
  candidates: T[],
  shownKeys: Set<string>,
): T[] {
  if (shownKeys.size === 0) return candidates;
  return candidates.filter((candidate) => {
    const addressKey = normaliseDiscoveryAddressKey(candidate.address);
    if (addressKey && shownKeys.has(addressKey)) return false;
    if (candidate.listingUrl && shownKeys.has(candidate.listingUrl)) return false;
    return true;
  });
}

function continuationState(row: { state: DiscoveryContinuationState | null }): DiscoveryContinuationState {
  return row.state && typeof row.state === "object" ? row.state : {};
}

async function saveContinuationState(
  id: string,
  state: DiscoveryContinuationState,
  exhausted: boolean,
): Promise<void> {
  await withDbRetry(() =>
    db
      .update(discoveryContinuations)
      // Slide the expiry forward on every save so an actively-browsing user
      // never hits the expiry guard mid-session, and a recently-used
      // continuation stays resumable for a full TTL of "come back later".
      .set({
        state,
        exhausted,
        updatedAt: new Date(),
        expiresAt: new Date(Date.now() + DISCOVERY_CONTINUATION_TTL_MS),
      })
      .where(eq(discoveryContinuations.id, id)),
  );
}

async function generateContinuationCandidates(args: {
  id: string;
  presentation: DiscoverySearchPresentation;
  suburb: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  state: DiscoveryContinuationState;
  shownKeys: Set<string>;
  count: number;
  log: Logger;
}): Promise<{ candidates: PropertyCandidate[]; state: DiscoveryContinuationState; exhausted: boolean }> {
  let remainingListings = Array.isArray(args.state.remainingListings)
    ? (args.state.remainingListings as ListingResult[])
    : [];
  const nearbyQueue = Array.isArray(args.state.nearbyQueue)
    ? [...(args.state.nearbyQueue as string[])]
    : [];
  let currentSuburb: string | null =
    typeof args.state.currentSuburb === "string" && args.state.currentSuburb
      ? args.state.currentSuburb
      : args.suburb;

  const minP = args.minPrice ?? 0;
  const maxP = args.maxPrice ?? 20_000_000;
  const requireSourceBackedPrice = args.state.requireSourceBackedPrice === true;

  // Pick the next page of candidates from a given listing pool, honouring the
  // presentation type. Returns the leftover pool so the caller can persist it.
  const pickFromPool = async (
    pool: ListingResult[],
  ): Promise<{ candidates: PropertyCandidate[]; nextRemaining: ListingResult[] }> => {
    const tempCacheKey = `continuation:${args.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    setListingCache(tempCacheKey, {
      remainingListings: [...pool],
      shownUrls: [],
      suburb: currentSuburb ?? args.suburb ?? "",
      minPrice: minP,
      maxPrice: maxP,
    });

    let candidates: PropertyCandidate[] = [];
    if (args.presentation === "generic_listing") {
      candidates = topUpGenericListingCandidates(tempCacheKey, [], args.shownKeys, args.count, 12);
      candidates = sanitizeDiscoveryCandidates(candidates);
    } else {
      const preScreenOpts = {
        pricePlaceholderNzd: 3_500_000,
        ...(args.state.preScreenOpts ?? {}),
        // Always let unpriced (negotiation/auction) listings through pre-screen
        // with a flagged scoring placeholder; orderListingsByPriceTier ranks
        // them after priced in-range matches and the card shows their real
        // "By negotiation" text rather than the placeholder number.
        allowMissingListingPrice: true,
      } as {
        allowMissingListingPrice?: boolean;
        pricePlaceholderNzd?: number;
        strictStandardSubdivision?: boolean;
        preliminarySubdivision?: boolean;
        developmentScreening?: boolean;
        verifyFreeholdTitle?: boolean;
        includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[];
      };
      candidates = await topUpDiscoveryCandidates(
        tempCacheKey,
        [],
        typeof args.state.criteria === "string" ? args.state.criteria : null,
        preScreenOpts,
        args.shownKeys,
        {
          batchSize: 12,
          nonStrictAttemptLimit: 3,
          targetCount: args.count,
        },
      );
      candidates = sanitizeDiscoveryCandidates(candidates);
      if (candidates.length > 0) {
        queueBackgroundScores(
          candidates.map((c) => ({
            address: c.address,
            listingUrl: c.listingUrl,
            price: c.price,
            landArea: c.landArea,
            landAreaConfidence: c.landAreaConfidence,
            isAlreadySubdividedChild: c.isAlreadySubdividedChild,
            zone: c.zone,
            buildYear: c.buildYear,
            typology: c.typology,
            titleConfidence: c.titleConfidence,
            subdivisionEligible: c.subdivisionEligible,
            subdivisionRejectReason: c.subdivisionRejectReason,
          })),
        );
      }
    }

    candidates = filterCandidatesAlreadyShown(candidates, args.shownKeys);
    if (args.presentation === "generic_listing" && candidates.length > 0) {
      candidates = await hydrateGenericListingAgentDetails(candidates, args.log);
    }
    const nextRemaining = (getListingCache(tempCacheKey)?.remainingListings ?? []) as ListingResult[];
    return { candidates, nextRemaining };
  };

  // Lazy-pagination cursor for the current suburb. Both presentations fetch the
  // source one window at a time, so when the pool drains we may still have more
  // pages of THIS suburb to pull before moving the nearby train forward.
  let pageOffset = typeof args.state.pageOffset === "number" ? args.state.pageOffset : 0;
  let pageTotal: number | null = typeof args.state.pageTotal === "number" ? args.state.pageTotal : null;
  // Default true: when unset (pre-pagination rows) there is nothing more to fetch.
  let pageDone = args.state.pageDone !== false;
  const isGeneric = args.presentation === "generic_listing";
  const isStrict = (args.state.preScreenOpts as { strictStandardSubdivision?: boolean } | undefined)?.strictStandardSubdivision === true;
  const pageWindow = isGeneric ? GENERIC_PAGE_WINDOW : SUBDIVISION_PAGE_WINDOW;

  // Pull one more window of the CURRENT suburb's source pages, advancing the
  // cursor. Returns the freshly-fetched, in-range, not-yet-shown listings (may be
  // empty if that window was all already shown — the caller loops to the next).
  const fetchCurrentSuburbWindow = async (): Promise<ListingResult[]> => {
    if (pageDone || !currentSuburb) return [];
    const win = await searchRealEstateListings({
      suburb: currentSuburb,
      minPrice: minP,
      maxPrice: maxP,
      startOffset: pageOffset,
      maxPages: pageWindow,
    }).catch((err) => {
      args.log.warn({ err, currentSuburb }, "Discovery train: window refill fetch failed");
      return null;
    });
    if (!win) { pageDone = true; return []; }
    pageOffset = win.nextOffset;
    pageTotal = win.totalAvailable;
    pageDone = win.done;
    return filterAlreadyShownListings(
      orderListingsByPriceTier(
        [...win.firstBatch, ...win.remainingListings],
        minP,
        maxP,
        isStrict,
        requireSourceBackedPrice,
      ),
      args.shownKeys,
    );
  };

  // Advance the train to the next queued nearby suburb: fetch its first window
  // and reset the per-suburb cursor (so the new suburb is then drained window by
  // window before the train advances again).
  const fetchNextNearbySuburb = async (): Promise<ListingResult[]> => {
    const nextSuburb = nearbyQueue.shift() as string;
    const fetched = await searchRealEstateListings({
      suburb: nextSuburb,
      minPrice: minP,
      maxPrice: maxP,
      maxPages: pageWindow,
    }).catch((err) => {
      args.log.warn({ err, nextSuburb }, "Discovery train: nearby suburb fetch failed");
      return null;
    });
    if (!fetched) return [];
    currentSuburb = nextSuburb;
    pageOffset = fetched.nextOffset;
    pageTotal = fetched.totalAvailable;
    pageDone = fetched.done;
    return filterAlreadyShownListings(
      orderListingsByPriceTier(
        [...fetched.firstBatch, ...fetched.remainingListings],
        minP,
        maxP,
        isStrict,
        requireSourceBackedPrice,
      ),
      args.shownKeys,
    );
  };

  const buildState = (remaining: ListingResult[]): DiscoveryContinuationState => ({
    ...args.state,
    remainingListings: remaining,
    nearbyQueue,
    currentSuburb: currentSuburb ?? undefined,
    pageOffset,
    pageTotal,
    pageDone,
  });

  // Drain order: current pool → more windows of the current suburb → next nearby
  // suburb → … Only exhausted once the pool is empty, the current suburb has no
  // more source pages, AND the nearby queue is empty. The origin and drained
  // suburbs are never revisited (they're not in the queue).
  for (;;) {
    while (remainingListings.length === 0 && (!pageDone || nearbyQueue.length > 0)) {
      let refill: ListingResult[] = [];
      if (!pageDone) {
        refill = await fetchCurrentSuburbWindow();
      } else if (nearbyQueue.length > 0) {
        refill = await fetchNextNearbySuburb();
      }
      if (refill.length > 0) remainingListings = refill;
      // Empty refill but more windows/suburbs remain → loop tries the next one;
      // pageOffset/queue always advance, so this terminates.
    }

    if (remainingListings.length === 0) {
      return { candidates: [], state: buildState([]), exhausted: true };
    }

    const poolSizeBeforePick = remainingListings.length;
    const { candidates, nextRemaining } = await pickFromPool(remainingListings);
    if (candidates.length > 0) {
      args.log.info(
        { id: args.id, presentation: args.presentation, candidates: candidates.length, remaining: nextRemaining.length, queue: nearbyQueue.length, pageDone, currentSuburb },
        "Discovery continuation: generated candidates",
      );
      return {
        candidates,
        state: buildState(nextRemaining),
        exhausted: nextRemaining.length === 0 && pageDone && nearbyQueue.length === 0,
      };
    }

    // This pool yielded nothing pickable.
    remainingListings = nextRemaining;
    if (remainingListings.length > 0 && remainingListings.length < poolSizeBeforePick) continue;
    if (remainingListings.length > 0) {
      // Pool still had items but none became candidates — bail to avoid a loop.
      return {
        candidates: [],
        state: buildState(nextRemaining),
        exhausted: pageDone && nearbyQueue.length === 0,
      };
    }
    if (pageDone && nearbyQueue.length === 0) {
      return { candidates: [], state: buildState([]), exhausted: true };
    }
    // else: pool empty but more windows/suburbs remain → loop refills.
  }
}

async function prefetchContinuationPage(id: string, requestedCount = DISCOVERY_CONTINUATION_PREFETCH_COUNT, log: Logger): Promise<void> {
  const [row] = await withDbRetry(() =>
    db
      .select()
      .from(discoveryContinuations)
      .where(eq(discoveryContinuations.id, id))
      .limit(1),
  );
  if (!row || row.exhausted || row.expiresAt <= new Date()) return;
  const state = continuationState(row);
  const existingReady = state.readyPages ?? [];
  const readyCount = existingReady.reduce((sum, page) => sum + (Array.isArray(page.candidates) ? page.candidates.length : 0), 0);
  if (readyCount >= DISCOVERY_CONTINUATION_PAGE_SIZE) return;
  const generated = await generateContinuationCandidates({
    id,
    presentation: row.searchPresentation === "generic_listing" ? "generic_listing" : "scored_screening",
    suburb: row.suburb,
    minPrice: row.minPrice,
    maxPrice: row.maxPrice,
    state,
    shownKeys: new Set(),
    count: requestedCount,
    log,
  });
  const readyPages = [...existingReady];
  if (generated.candidates.length > 0) readyPages.push({ candidates: generated.candidates });
  await saveContinuationState(
    id,
    { ...generated.state, readyPages },
    generated.exhausted,
  );
}

async function createDiscoveryContinuation(args: {
  ownerKey: string | null;
  presentation: DiscoverySearchPresentation;
  suburb: string | null;
  minPrice: number;
  maxPrice: number;
  cacheKey: string;
  criteria: string | null;
  preScreenOpts: Record<string, unknown>;
  initialCandidates: PropertyCandidate[];
  // Nearby "train" expansion seed. When present, Show-more auto-advances through
  // these suburbs as each drains (see generateContinuationCandidates).
  nearbyQueue?: string[];
  originSuburb?: string | null;
  // "user" when the queue is the user's explicitly-named suburbs (vs "nearby"
  // LLM suggestions) — controls how the hand-off notice is worded.
  queueSource?: "user" | "nearby";
  // Lazy-pagination cursor for the current suburb (generic browse). When the
  // suburb still has un-fetched source pages, the continuation pool is refilled
  // a window at a time on Show-more before the nearby train advances.
  pageOffset?: number;
  pageTotal?: number | null;
  pageDone?: boolean;
  requireSourceBackedPrice?: boolean;
  log: Logger;
}): Promise<string | null> {
  const cacheEntry = getListingCache(args.cacheKey);
  const remainingListings = cacheEntry?.remainingListings ?? [];
  // With a nearby queue we can keep going even if THIS suburb's pool is empty,
  // so only bail when there's nothing left to serve anywhere. The current suburb
  // may also have more un-fetched source pages (lazy pagination not yet done).
  const hasMoreToFetch = args.pageDone === false;
  if (remainingListings.length === 0 && (args.nearbyQueue?.length ?? 0) === 0 && !hasMoreToFetch) return null;
  const id = randomUUID();
  const initialShownKeys = shownKeysFromCandidates(args.initialCandidates);
  const state: DiscoveryContinuationState = {
    criteria: args.criteria,
    preScreenOpts: args.preScreenOpts,
    remainingListings,
    readyPages: [],
    ...(args.nearbyQueue?.length ? { nearbyQueue: args.nearbyQueue } : {}),
    ...(args.originSuburb ? { originSuburb: args.originSuburb } : {}),
    ...(args.queueSource ? { queueSource: args.queueSource } : {}),
    ...(args.suburb ? { currentSuburb: args.suburb } : {}),
    ...(args.requireSourceBackedPrice ? { requireSourceBackedPrice: true } : {}),
    ...(typeof args.pageOffset === "number" ? { pageOffset: args.pageOffset } : {}),
    ...(args.pageTotal !== undefined ? { pageTotal: args.pageTotal } : {}),
    ...(args.pageDone !== undefined ? { pageDone: args.pageDone } : {}),
  };
  await withDbRetry(() =>
    db.insert(discoveryContinuations).values({
      id,
      ownerKey: args.ownerKey,
      searchPresentation: args.presentation,
      suburb: args.suburb,
      minPrice: args.minPrice,
      maxPrice: args.maxPrice,
      cacheKey: args.cacheKey,
      state,
      exhausted: false,
      expiresAt: new Date(Date.now() + DISCOVERY_CONTINUATION_TTL_MS),
    }),
  );
  runAfterResponse(
    (async () => {
      const generated = await generateContinuationCandidates({
        id,
        presentation: args.presentation,
        suburb: args.suburb,
        minPrice: args.minPrice,
        maxPrice: args.maxPrice,
        state,
        shownKeys: initialShownKeys,
        count: DISCOVERY_CONTINUATION_PREFETCH_COUNT,
        log: args.log,
      });
      await saveContinuationState(
        id,
        {
          ...generated.state,
          readyPages: generated.candidates.length > 0 ? [{ candidates: generated.candidates }] : [],
        },
        generated.exhausted,
      );
    })().catch((err) => args.log.warn({ err, id }, "Discovery continuation: prefetch failed")),
  );
  return id;
}

/**
 * Outer "did we genuinely exhaust this suburb?" pass for strict-subdivision
 * discovery. When the primary drain returned 0 candidates but some listings
 * stayed indeterminate (zone / build year / land area couldn't be fetched
 * after the inner per-listing retries), back off and re-screen them with
 * progressively longer waits before reporting "no listings".
 *
 * This is deliberately bounded so the durable background job always has time
 * to persist a terminal result before the serverless invocation deadline.
 */
// Keep the retry ladder below the background job's serverless deadline. Long
// sleeps previously allowed Vercel to terminate the worker while its row still
// said `processing`, producing an endless loading bubble on mobile.
const INDETERMINATE_RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

async function reScreenIndeterminateListings(opts: {
  indeterminate: ListingResult[];
  criteria: string | null;
  preScreenOpts: { allowMissingListingPrice?: boolean; pricePlaceholderNzd?: number; strictStandardSubdivision?: boolean; preliminarySubdivision?: boolean; developmentScreening?: boolean; verifyFreeholdTitle?: boolean; includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[] };
  shownAddressKeys: Set<string>;
  targetCount: number;
  log: Logger;
}): Promise<PropertyCandidate[]> {
  const { criteria, preScreenOpts, shownAddressKeys, targetCount, log } = opts;
  let queue = [...opts.indeterminate];
  const found: PropertyCandidate[] = [];

  for (let i = 0; i < INDETERMINATE_RETRY_DELAYS_MS.length && queue.length > 0 && found.length < targetCount; i++) {
    const delayMs = INDETERMINATE_RETRY_DELAYS_MS[i];
    log.info(
      { attempt: i + 1, delayMs, queueSize: queue.length },
      "Discovery: outer indeterminate-listing retry — waiting before re-screen",
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const detailed = await preScreenListingsFastDetailed(queue, 5, null, preScreenOpts).catch(
      () => ({ candidates: [] as PropertyCandidate[], indeterminate: [] as ListingResult[], excludedTenures: { cross_lease: 0, leasehold: 0, unit_title: 0 }, excludedNonFreehold: [], drainComplete: Promise.resolve() }),
    );
    const fresh = pickDiscoveryCandidates(detailed.candidates, criteria, shownAddressKeys, targetCount - found.length);
    found.push(...fresh);
    // Listings that resolved this round (either as candidates or confirmed
    // rejects) drop out; only the ones still indeterminate go to the next loop.
    queue = detailed.indeterminate;
    log.info(
      { attempt: i + 1, found: fresh.length, stillIndeterminate: queue.length, totalFound: found.length },
      "Discovery: outer indeterminate-listing retry result",
    );
  }

  return found.slice(0, targetCount);
}

function normaliseStreetHintKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const STREET_TYPE_ALIASES: Record<string, string> = {
  road: "road",
  rd: "road",
  street: "street",
  st: "street",
  avenue: "avenue",
  ave: "avenue",
  crescent: "crescent",
  cres: "crescent",
  place: "place",
  pl: "place",
  drive: "drive",
  dr: "drive",
  way: "way",
  lane: "lane",
  ln: "lane",
  terrace: "terrace",
  tce: "terrace",
  parade: "parade",
  pde: "parade",
  close: "close",
  grove: "grove",
  rise: "rise",
  view: "view",
  heights: "heights",
  ridge: "ridge",
  court: "court",
  hill: "hill",
  mews: "mews",
  quay: "quay",
  boulevard: "boulevard",
  blvd: "boulevard",
  highway: "highway",
  hwy: "highway",
  motorway: "motorway",
  esplanade: "esplanade",
  mall: "mall",
  row: "row",
  walk: "walk",
  path: "path",
  track: "track",
};

const STREET_HINT_STOPWORDS = new Set([
  "what", "whats", "s", "which", "property", "properties", "house", "houses",
  "home", "homes", "land", "listing", "listings", "sale", "sell", "selling",
  "sold", "available", "market", "on", "in", "at", "near", "around", "along",
  "for", "the", "a", "an", "of", "and", "or", "to", "with", "street", "road",
  "suburb", "area", "find", "search", "show", "me", "please", "is", "are",
  "good", "best", "better", "subdivision", "subdivide", "subdividable",
  "opportunity", "opportunities", "development", "developable", "site",
  "sites", "zone", "zoned", "unitary", "potential", "anything", "else",
  "more", "other", "others", "another", "few", "keep", "looking", "options",
  "results",
]);

function canonicalStreetType(raw: string): string | null {
  return STREET_TYPE_ALIASES[raw.toLowerCase()] ?? null;
}

/** Unnumbered or numbered road + type, e.g. "marine parade" from user discover wording. */
function extractDiscoverStreetHint(text: string): string | null {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  const tokens = [...trimmed.matchAll(/[A-Za-z0-9']+/g)].map((match) => ({
    raw: match[0],
    lower: match[0].toLowerCase().replace(/^'+|'+$/g, ""),
  }));

  let best: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const type = canonicalStreetType(tokens[i]!.lower);
    if (!type) continue;

    let name = tokens.slice(Math.max(0, i - 5), i).map((t) => t.lower);
    while (name.length > 0 && (/^\d+[a-z]?$/.test(name[0]!) || STREET_HINT_STOPWORDS.has(name[0]!))) {
      name = name.slice(1);
    }
    while (name.length > 0 && STREET_HINT_STOPWORDS.has(name[name.length - 1]!)) {
      name = name.slice(0, -1);
    }

    if (name.length === 0 || name.length > 4) continue;
    if (name.some((part) => STREET_HINT_STOPWORDS.has(part))) continue;

    best = `${name.join(" ")} ${type}`;
  }

  return best;
}

function extractDiscoverStreetHintFromThread(
  threadMessages: Message[] | undefined,
  currentUserText: string,
  carryFromHistory = false,
): string | null {
  const fromCurrent = extractDiscoverStreetHint(currentUserText);
  if (fromCurrent) return fromCurrent;
  if (!carryFromHistory) return null;
  if (!threadMessages?.length) return null;
  for (const msg of [...threadMessages].reverse()) {
    if (msg.content === currentUserText) continue;
    if (msg.role !== "user" || !msg.content) continue;
    const h = extractDiscoverStreetHint(msg.content);
    if (h) return h;
  }
  return null;
}

function extractPreviousDiscoverStreetHint(
  threadMessages: Message[] | undefined,
  currentUserText: string,
): string | null {
  if (!threadMessages?.length) return null;
  for (const msg of [...threadMessages].reverse()) {
    if (msg.role !== "user" || !msg.content || msg.content === currentUserText) continue;
    const h = extractDiscoverStreetHint(msg.content);
    if (h) return h;
  }
  return null;
}

function isDiscoverStreetContinuation(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (/(?:\u663e\u793a|\u518d\u6765|\u7ed9\u6211|\u627e|\u770b).{0,6}\u66f4\u591a|\u8fd8\u6709(?:\u5417|\u6ca1\u6709)?|\u522b\u7684|\u5176\u4ed6|\u66f4\u591a(?:\u623f|\u5730|\u623f\u6e90|\u9009\u9879|\u7ed3\u679c)/.test(text)) return true;
  if (/^\d+[a-z]?\s*(?:号|號|number|no\.?|#)?\s*(?:呢|\?)?$/i.test(text.trim())) return true;
  return /any\s*(others?|more)|show\s*(me\s*)?more|more\s*(properties|options|results|sites)|what\s*else|other\s*properties|more\s*results|few\s*more|find\s*more|keep\s*looking|another\s*one|any\s*other|more\s*sites|other\s*options/i.test(lower);
}

function isRepeatShownAreaRequest(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (/^\[discovery_exhausted_choice:repeat_origin\]$/i.test(text.trim())) return true;
  if (/(show|see|display|bring\s+up|remind).{0,40}\b(again|same|previous|earlier|already|available)\b/i.test(lower)) return true;
  if (/\b(show|see)\s+(them|those|these|it)\s+again\b/i.test(lower)) return true;
  if (/\bwhat\s+is\s+available\b.{0,40}\bagain\b/i.test(lower)) return true;
  return /(?:再看|再给我|再給我|重新看|重新显示|重新顯示|看过的|看過的|之前的|已经看过|已經看過|再来一次|再來一次)/.test(text);
}

// Deterministic "include the cross-lease/leasehold/unit-title I set aside" chip
// command, e.g. "[discovery_include_tenures:cross_lease,leasehold]". Parsed
// straight into the opt-in set so the offer works regardless of phrasing, the
// LLM's parse, or whether the offer text survived in the conversation history.
function parseIncludeTenuresChoice(text: string): Tenure[] | null {
  const m = /^\[discovery_include_tenures:([a-z_,]+)\]$/i.exec(text.trim());
  if (!m) return null;
  const valid: readonly string[] = ["cross_lease", "leasehold", "unit_title"];
  const parsed = m[1]
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Tenure => valid.includes(s));
  return parsed.length > 0 ? parsed : null;
}

function isNearbyDiscoveryChoice(text: string): boolean {
  const lower = text.toLowerCase().trim();
  if (/^\[discovery_exhausted_choice:search_nearby\]$/i.test(text.trim())) return true;
  if (/\b(search|show|find|look|keep\s+looking).{0,25}\b(nearby|neighbouring|neighboring|surrounding|other\s+(suburbs|areas|neighbourhoods|neighborhoods))\b/i.test(lower)) return true;
  if (/^(nearby|search nearby|nearby suburbs|other suburbs|surrounding areas)$/i.test(lower)) return true;
  return /(?:附近|周边|周邊|邻近|鄰近|周围|周圍|其他区|其他區|附近郊区|附近郊區)/.test(text);
}

function hasRecentShownForSuburb(entries: RecentShownListing[], suburb: string | null | undefined): boolean {
  const normalized = suburb?.toLowerCase().trim();
  if (!normalized) return false;
  return entries.some((entry) => entry.suburb?.toLowerCase().trim() === normalized);
}

function buildDiscoveryExhaustedChoicePayload(
  suburb: string | null | undefined,
  presentation: string = "scored_screening",
  // Optional non-freehold offer (e.g. the cross-lease exclusion reminder) to
  // append to the question so the user can still ask to include those listings
  // even though the freehold pool is exhausted.
  extraNote?: string | null,
): string {
  const suburbLabel = suburb ? titleCaseSuburb(suburb) : "this area";
  const normalizedPresentation: DiscoverySearchPresentation =
    presentation === "generic_listing" ? "generic_listing" : "scored_screening";
  const baseQuestion = "I've shown you all properties that met the criteria in this area, including some from previous chats. Would you like to see them again or search nearby suburbs?";
  return JSON.stringify({
    clarificationType: "discovery_exhausted",
    // Echo the originating search's presentation + suburb so the client can
    // piggyback them back on the choice tap. This keeps the screening intent
    // (generic vs subdivision) and the *current* suburb authoritative across
    // the Glendowie → Meadowbank → next-nearby evolution, instead of forcing
    // the backend to re-derive them from fragile history/LLM inference.
    searchPresentation: normalizedPresentation,
    suburb: suburb ? suburbLabel : null,
    question: extraNote && extraNote.trim() ? `${baseQuestion}\n\n${extraNote.trim()}` : baseQuestion,
    options: [
      `Remind me what is available in ${suburbLabel} again`,
      "Search nearby",
    ],
    optionActions: ["repeat_origin", "search_nearby"],
  });
}

function formatDiscoveryPriceRange(minPrice: number, maxPrice: number, explicitPrice: boolean): string {
  if (!explicitPrice) return "";
  const fmt = (n: number) => `$${formatNZD(n)}`;
  return ` with a source-backed asking price between ${fmt(minPrice)} and ${fmt(maxPrice)}`;
}

function buildDiscoveryNoListingsIntro(args: {
  suburb: string | null | undefined;
  criteriaLabel: string;
  minPrice: number;
  maxPrice: number;
  explicitPrice: boolean;
  plainListingBrowse: boolean;
}): string {
  const suburbLabel = args.suburb ? titleCaseSuburb(args.suburb) : "this area";
  const criteria = args.criteriaLabel.trim();
  const criteriaText = criteria && !args.plainListingBrowse ? ` for ${criteria}` : "";
  const priceText = formatDiscoveryPriceRange(args.minPrice, args.maxPrice, args.explicitPrice);
  return `I couldn't find any matching listings in ${suburbLabel}${criteriaText}${priceText} right now. Try widening the budget, including price-by-negotiation listings, or searching nearby suburbs.`;
}

/**
 * Compose the "I left some properties out because subdivision needs a freehold
 * title" reminder. Only tenures with count > 0 that the user has NOT already
 * opted in to are mentioned; each gets its own caveat. Returns "" when there is
 * nothing to report (so the caller can skip appending). English copy — the whole
 * payload is run through translateChatContent for zh users, same as the
 * out-of-hours disclaimer.
 */
function buildTenureExclusionReminder(
  totals: { cross_lease: number; leasehold: number; unit_title: number },
  optIns: readonly ("cross_lease" | "leasehold" | "unit_title")[],
): string {
  const clauses: string[] = [];
  if (totals.cross_lease > 0 && !optIns.includes("cross_lease")) {
    const n = totals.cross_lease;
    clauses.push(`${n} cross-lease ${n === 1 ? "property" : "properties"} (a cross-lease can only be subdivided once every cross-lease owner consents to convert the title to freehold)`);
  }
  if (totals.leasehold > 0 && !optIns.includes("leasehold")) {
    const n = totals.leasehold;
    clauses.push(`${n} leasehold ${n === 1 ? "property" : "properties"} (leasehold land is very difficult to subdivide because you don't own the freehold)`);
  }
  if (totals.unit_title > 0 && !optIns.includes("unit_title")) {
    const n = totals.unit_title;
    clauses.push(`${n} unit-title ${n === 1 ? "property" : "properties"} (a unit title generally has to be converted to freehold before it can be subdivided)`);
  }
  if (clauses.length === 0) return "";
  const list = clauses.length === 1
    ? clauses[0]
    : clauses.slice(0, -1).join("; ") + "; and " + clauses[clauses.length - 1];
  return `I left out ${list} because subdivision needs a freehold title. Tell me if you'd like me to include any of these — I'll show them with a note on what's involved.`;
}

function isContextualAreaBrowseFollowup(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(?:this|same|current|the)\s+(?:suburb|area|neighbou?rhood)\b/i.test(lower) ||
    /\b(?:nearby|around here|in the area|in this area)\b/i.test(lower) ||
    /(?:\u8fd9|\u6b64).{0,4}(?:\u533a|\u533a\u57df|\u90ca\u533a|\u4e00\u5e26)|\u9644\u8fd1|\u540c\u533a/.test(text)
  );
}

function extractBareStreetNumberFollowup(text: string): string | null {
  const trimmed = text.trim();
  const patterns = [
    /^(?:what\s+about\s+)?(?:number\s+|no\.?\s*|#)?(\d+[a-z]?)(?:\s*(?:号|號))?\s*(?:呢|\?)?$/i,
    /^(\d+[a-z]?)\s*(?:号|號)\s*(?:呢|\?)?$/i,
  ];
  for (const pattern of patterns) {
    const m = trimmed.match(pattern);
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

function titleCaseStreetHint(hint: string): string {
  return hint
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

async function inferSuburbFromThread(
  threadMessages: Message[] | undefined,
  currentUserText: string,
): Promise<string | null> {
  if (!threadMessages?.length) return null;
  for (const msg of [...threadMessages].reverse()) {
    if (msg.role !== "user" || msg.content === currentUserText) continue;
    const prev = await parseDiscoverParams(msg.content ?? "");
    if (prev.suburb) return prev.suburb;
  }
  return null;
}

async function inferAddressFromBareStreetNumber(
  threadMessages: Message[] | undefined,
  currentUserText: string,
  fallbackSuburb?: string | null,
): Promise<string | null> {
  const number = extractBareStreetNumberFollowup(currentUserText);
  if (!number) return null;

  const streetHint = extractDiscoverStreetHintFromThread(threadMessages, currentUserText, true);
  if (!streetHint) return null;

  let suburb = fallbackSuburb?.trim() || null;
  if (!suburb) suburb = await inferSuburbFromThread(threadMessages, currentUserText);

  const address = `${number} ${titleCaseStreetHint(streetHint)}`;
  return suburb ? `${address}, ${suburb}` : address;
}

function appendContextSuburbIfSameStreet(
  address: string | null,
  threadMessages: Message[] | undefined,
  currentUserText: string,
  fallbackSuburb?: string | null,
): string | null {
  if (!address || address.includes(",") || !fallbackSuburb?.trim()) return address;

  const addressStreet = extractDiscoverStreetHint(address);
  const contextStreet = extractPreviousDiscoverStreetHint(threadMessages, currentUserText);
  if (!addressStreet || !contextStreet) return address;

  if (normaliseStreetHintKey(addressStreet) !== normaliseStreetHintKey(contextStreet)) return address;
  return `${address}, ${fallbackSuburb.trim()}`;
}

// When the previous assistant turn asked the user to pick a subdivision
// sub-lot (e.g. "4A Inglis Street, Mosgiel" / "4B Inglis Street, Mosgiel")
// and the user replies with something short that ISN'T a full address (no
// street number — e.g. just "Birkenhead"), that reply is almost always a
// correction to the SUBURB of the original address, not a brand-new
// discovery request. Recombine it with the parent street+number so the
// pipeline re-checks "4 Inglis Street, Birkenhead" from scratch (which will
// correctly default to the parent if it exists there, or offer that
// suburb's own sub-lots if it too turns out to be subdivided). The core
// merge/parse logic lives in lib/subdivision.ts (dependency-free, unit
// tested); this wraps it with the route's own address/browse-intent guards.
function detectPendingSubdivisionCorrection(
  threadMessages: Message[] | undefined,
  currentUserText: string,
): { mergedAddress: string } | null {
  if (hasNumberedStreetAddress(currentUserText) || looksLikeStreetAddress(currentUserText)) return null;
  if (isListingBrowseIntent(currentUserText)) return null;

  const lastAssistant = [...(threadMessages ?? [])].reverse().find((m) => m.role === "assistant");
  return mergeSubdivisionCorrection(lastAssistant?.content, currentUserText);
}

function rankListingsByStreetHint(listings: ListingResult[], hint: string | null): ListingResult[] {
  if (!hint?.trim()) return listings;
  const key = normaliseStreetHintKey(hint);
  if (key.length < 4) return listings;
  return [...listings].sort((a, b) => {
    const ma = normaliseStreetHintKey(a.address).includes(key) ? 1 : 0;
    const mb = normaliseStreetHintKey(b.address).includes(key) ? 1 : 0;
    return mb - ma;
  });
}

function filterListingsByStreetHint(listings: ListingResult[], hint: string | null): ListingResult[] {
  if (!hint?.trim()) return listings;
  const key = normaliseStreetHintKey(hint);
  if (key.length < 4) return listings;
  const matches = listings.filter((listing) => normaliseStreetHintKey(listing.address).includes(key));
  return matches.length > 0 ? matches : listings;
}

function hasExplicitPriceConstraint(text: string): boolean {
  return /(?:\$|budget|price|under|below|less than|up to|max(?:imum)?|between)\s*\$?\d/i.test(text)
    || /\d+(?:\.\d+)?\s*[mk]\s*(?:to|-)\s*\$?\d/i.test(text);
}

async function parseDiscoverParams(text: string): Promise<{ suburb: string | null; minPrice: number; maxPrice: number }> {
  // Resolve suburb against the live realestate.co.nz directory (1899 suburbs)
  // — no hand-curated list. Coverage tracks the data source automatically.
  const hit = await findLocationInTextViaIndex(text);
  const suburb = hit?.status === "suburb"
    ? hit.suburb.title.toLowerCase()
    : hit?.status === "district"
      ? hit.district.title.toLowerCase()
      : hit?.status === "region"
        ? hit.region.title.toLowerCase()
      : null;

  const pricePatterns = [
    /under\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /below\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /less than\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /up to\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
    /max(?:imum)?\s+\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i,
  ];

  const developmentSearch = isDevelopmentDiscoveryIntent(text);
  let maxPrice = developmentSearch ? 20_000_000 : 3_000_000;
  for (const p of pricePatterns) {
    const m = p.exec(text);
    if (m) {
      let v = parseFloat(m[1]);
      const suffix = m[2]?.toLowerCase();
      if (suffix === "m") v *= 1_000_000;
      else if (suffix === "k") v *= 1_000;
      else if (v < 100) v *= 1_000_000;
      maxPrice = Math.round(v);
      break;
    }
  }

  const rangeM = /\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)\s*(?:to|-)\s*\$?([0-9]+(?:\.[0-9]+)?)\s*([mk]?)/i.exec(text);
  let minPrice = developmentSearch ? 0 : Math.max(0, maxPrice - 1_500_000);
  if (rangeM) {
    let lo = parseFloat(rangeM[1]);
    const loS = rangeM[2]?.toLowerCase();
    if (loS === "m") lo *= 1_000_000;
    else if (loS === "k") lo *= 1_000;
    else if (lo < 100) lo *= 1_000_000;

    let hi = parseFloat(rangeM[3]);
    const hiS = rangeM[4]?.toLowerCase();
    if (hiS === "m") hi *= 1_000_000;
    else if (hiS === "k") hi *= 1_000;
    else if (hi < 100) hi *= 1_000_000;

    minPrice = Math.round(lo);
    maxPrice = Math.round(hi);
  }

  return { suburb, minPrice: Math.max(0, minPrice), maxPrice };
}

const INVALID_AUTH_SESSION = Symbol("invalid_auth_session");

function rejectInvalidAuthSession(res: any): void {
  res.status(401).json({
    error: "This account is now signed in on another device.",
    code: "SESSION_REPLACED",
  });
}

async function rejectAuthRequired(res: any, locale: ReturnType<typeof normaliseLocale>): Promise<void> {
  const baseMessage = "Create a free account or sign in to generate the full feasibility analysis.";
  const message = locale === "zh" ? await ensureChinese(baseMessage) : baseMessage;
  res.status(401).json({
    error: message,
    code: "AUTH_REQUIRED",
    message,
  });
}

async function getUserIdFromHeader(req: any): Promise<string | null | typeof INVALID_AUTH_SESSION> {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const payload = await verifyActiveToken(authHeader.slice(7)).catch(() => null);
  return payload?.sub ?? INVALID_AUTH_SESSION;
}

/** Unwrap Drizzle-wrapped pg errors so logs show SQLSTATE, detail, and column (not only "Failed query"). */
function pgErrorChain(err: unknown): Array<Record<string, unknown>> {
  const chain: Array<Record<string, unknown>> = [];
  let e: unknown = err;
  while (e && chain.length < 8) {
    if (typeof e === "object" && e !== null) {
      const o = e as Record<string, unknown>;
      chain.push({
        name: o.name,
        message: o.message,
        code: o.code,
        detail: o.detail,
        schema: o.schema,
        table: o.table,
        column: o.column,
        routine: o.routine,
      });
    }
    e =
      typeof e === "object" && e !== null && "cause" in e
        ? (e as { cause?: unknown }).cause
        : undefined;
  }
  return chain;
}

type FeasibilityLog = Pick<Logger, "warn" | "error" | "info">;
const STALE_FEASIBILITY_JOB_MS = 10 * 60 * 1000;
const STALE_SCREENING_JOB_MS = 4 * 60 * 1000;
const SCREENING_JOB_RUNTIME_MS = 210 * 1000;
const SCREENING_JOB_MAX_ATTEMPTS = 2;

function isStaleFeasibilityJob(job: { status: string; updatedAt: Date | string | null }): boolean {
  if (job.status !== "processing") return false;
  const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt > STALE_FEASIBILITY_JOB_MS;
}

function isStaleScreeningJob(job: { status: string; updatedAt: Date | string | null }): boolean {
  if (job.status !== "processing") return false;
  const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
  return !Number.isFinite(updatedAt) || Date.now() - updatedAt > STALE_SCREENING_JOB_MS;
}

function screeningJobDeadline(): Date {
  return new Date(Date.now() + SCREENING_JOB_RUNTIME_MS);
}

async function findReusableFeasibilityJob(args: {
  userId: string;
  queryAddress: string;
  analysisAddress: string;
}): Promise<{ id: string; status: string } | null> {
  const rows = await withDbRetry(() =>
    db
      .select({ id: feasibilityJobs.id, status: feasibilityJobs.status })
      .from(feasibilityJobs)
      .where(
        and(
          eq(feasibilityJobs.userId, args.userId),
          eq(feasibilityJobs.queryAddress, args.queryAddress),
          eq(feasibilityJobs.analysisAddress, args.analysisAddress),
          sql`${feasibilityJobs.status} in ('pending', 'processing')`,
          sql`${feasibilityJobs.createdAt} > now() - interval '6 hours'`,
        ),
      )
      .orderBy(desc(feasibilityJobs.createdAt))
      .limit(1),
  );
  return rows[0] ?? null;
}

type ScreeningJobMode = "generic_listing" | "scored_screening" | "unknown";
type ScreeningJobRequestPayload = {
  baseUrl?: string;
  headers?: Record<string, string | undefined>;
  body?: {
    messages?: Message[];
    currentReport?: object;
    message?: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    reportContext?: string;
    continuePresentation?: "generic_listing" | "scored_screening";
    discoveryChoiceSuburb?: string;
  };
};

function requestApiBase(req: any): string | undefined {
  const host = req.get?.("host");
  if (!host) return undefined;
  const protocol = req.protocol || "https";
  const baseUrl = typeof req.baseUrl === "string" && req.baseUrl ? req.baseUrl : "/api";
  return `${protocol}://${host}${baseUrl}`;
}

function fallbackApiBase(): string | undefined {
  const raw =
    process.env.PUBLIC_API_BASE ||
    process.env.EXPO_PUBLIC_API_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!raw) return undefined;
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
}

function latestUserMessage(messages: Message[] | undefined): string {
  for (const item of [...(messages ?? [])].reverse()) {
    if (item?.role === "user" && typeof item.content === "string" && item.content.trim()) {
      return item.content.trim();
    }
  }
  return "Screening search";
}

function shortQueryForPush(query: string): string {
  const compact = query.replace(/\s+/g, " ").trim();
  if (compact.length <= 70) return compact || "your search";
  return `${compact.slice(0, 67).trimEnd()}...`;
}

function screeningModeFromResult(result: unknown): ScreeningJobMode {
  if (!result || typeof result !== "object") return "unknown";
  const obj = result as Record<string, unknown>;
  if (typeof obj.mode !== "string" || obj.mode !== "discover") return "unknown";
  const content = typeof obj.content === "string" ? obj.content : "";
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const presentation = parsed.searchPresentation;
    if (presentation === "generic_listing" || presentation === "scored_screening") return presentation;
  } catch {
  }
  return "unknown";
}

async function createInternalTokenForUser(userId: string): Promise<string> {
  const [profile] = await withDbRetry(() =>
    db
      .select({
        email: profiles.email,
        role: profiles.role,
        activeSessionId: profiles.activeSessionId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
  );
  if (!profile) throw new Error("User profile not found for screening job");
  return signToken(userId, profile.email, profile.role, profile.activeSessionId ?? undefined);
}

async function processScreeningJob(jobId: string, log: FeasibilityLog): Promise<void> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - STALE_SCREENING_JOB_MS);
  const claimed = await withDbRetry(() =>
    db
      .update(screeningJobs)
      .set({
        status: "processing",
        stage: "running_discovery",
        progress: 10,
        attemptCount: sql`${screeningJobs.attemptCount} + 1`,
        heartbeatAt: now,
        deadlineAt: screeningJobDeadline(),
        error: null,
        updatedAt: now,
      })
      .where(and(
        eq(screeningJobs.id, jobId),
        sql`(
          ${screeningJobs.status} = 'pending'
          OR (
            ${screeningJobs.status} = 'processing'
            AND COALESCE(${screeningJobs.heartbeatAt}, ${screeningJobs.updatedAt}) < ${staleBefore}
            AND ${screeningJobs.attemptCount} < ${SCREENING_JOB_MAX_ATTEMPTS}
          )
        )`,
      ))
      .returning(),
  );
  const job = claimed[0];
  if (!job) return;

  try {
    const payload = (job.requestPayload ?? {}) as ScreeningJobRequestPayload;
    const baseUrl = (payload.baseUrl || fallbackApiBase())?.replace(/\/+$/, "");
    if (!baseUrl) throw new Error("No API base URL available for screening job");

    const token = await createInternalTokenForUser(job.userId);
    const locale = job.locale === "zh" ? "zh" : "en";
    const response = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "x-locale": locale,
        ...(payload.headers?.["x-os-chinese"] ? { "x-os-chinese": payload.headers["x-os-chinese"] } : {}),
      },
      body: JSON.stringify(payload.body ?? { messages: job.conversationHistory ?? [] }),
      signal: AbortSignal.timeout(SCREENING_JOB_RUNTIME_MS),
    });

    if (!response.ok) {
      let message = `Screening request failed with ${response.status}`;
      try {
        const body = await response.json() as { error?: string; message?: string };
        message = body.message || body.error || message;
      } catch {
        const text = await response.text().catch(() => "");
        if (text) message = text.slice(0, 300);
      }
      throw new Error(message);
    }

    const result = await response.json();
    const mode = screeningModeFromResult(result);
    await withDbRetry(() =>
      db
        .update(screeningJobs)
        .set({
          status: "completed",
          mode,
          resultJson: result,
          stage: "completed",
          progress: 100,
          heartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(screeningJobs.id, jobId)),
    );

    const query = shortQueryForPush(job.queryText);
    const title = locale === "zh" ? "筛选结果已就绪" : "Screening ready";
    const body = locale === "zh"
      ? `您请求的「${query}」筛选已完成，请打开应用查看。`
      : `Your screening results for "${query}" are ready. Open Project Alpha to view them.`;
    try {
      await createNotificationItem({
        userId: job.userId,
        kind: "screening_ready",
        sourceId: jobId,
        page: "search",
        title,
        body,
        metadata: { jobId, query: job.queryText, mode },
      });
      const badgeCount = await getUnreadAppBadgeCount(job.userId);
      void sendPushToUser(job.userId, title, body, {
        type: "screening_ready",
        jobId,
      }, {
        badgeCount,
      });
    } catch (err) {
      log.warn({ err }, "Screening-ready notification ledger write failed (non-fatal)");
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const status = timedOut ? "expired" : "failed";
    await withDbRetry(() =>
      db
        .update(screeningJobs)
        .set({
          status,
          stage: timedOut ? "deadline_reached" : "failed",
          progress: timedOut ? 95 : 100,
          heartbeatAt: new Date(),
          error: timedOut
            ? "Screening took too long because one or more data sources did not respond. Please retry."
            : err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(screeningJobs.id, jobId)),
    );
    log.error({ err, status }, "Background screening job failed");
  }
}

type CombinedReportFailure = {
  address: string;
  error: string;
};

type CombinedReportGroup = {
  kind: "combined_listing_group";
  packageAddress: string;
  childAddresses: string[];
  reports: Record<string, unknown>[];
  failures: CombinedReportFailure[];
  comparison: {
    summary: string;
    subdivisionView: string[];
    investmentView: string[];
    risks: string[];
    recommendedNextStep: string;
  };
  warnings: string[];
  historyId?: string | null;
  historyCreatedAt?: string | null;
};

function normaliseAnalysisAddressKey(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function selectedListingUrlFromHistory(
  history: Array<{ role: "user" | "assistant"; content: string }> | null | undefined,
  address: string,
): string | null {
  const selectedContext = selectedListingContextFromHistory(history);
  if (selectedContext?.listingUrl) return selectedContext.listingUrl;

  const target = normaliseAnalysisAddressKey(address);
  if (!target) return null;
  for (const item of [...(history ?? [])].reverse()) {
    const content = item.content ?? "";
    const matches = content.matchAll(/([^;\]\n|]+?)\|\|(https?:\/\/[^\s;\]]+)/gi);
    for (const match of matches) {
      const candidateAddress = match[1]?.replace(/^\[Search results shown:\s*/i, "").trim() ?? "";
      const listingUrl = match[2]?.trim() ?? "";
      if (!listingUrl) continue;
      const candidateKey = normaliseAnalysisAddressKey(candidateAddress);
      if (candidateKey && (candidateKey === target || candidateKey.includes(target) || target.includes(candidateKey))) {
        return listingUrl;
      }
    }
  }
  return null;
}

type PastedListingResolution =
  | { status: "none" }
  | { status: "unsupported"; urls: string[] }
  | { status: "unresolved"; urls: string[] }
  | { status: "resolved"; url: string; address: string; context: SelectedListingContext };

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return Array.from(new Set(matches.map((url) =>
    url
      .replace(/[)\]}。，、.!?]+$/g, "")
      .trim(),
  ).filter(Boolean)));
}

function isRealestateListingUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "realestate.co.nz" && /\/\d+(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

function selectedListingContextFromListing(listing: ListingResult, fallbackUrl: string): SelectedListingContext {
  return {
    address: listing.address,
    listingUrl: listing.listingUrl || fallbackUrl,
    photoUrl: listing.photoUrl ?? null,
    photoUrls: listing.photoUrls ?? (listing.photoUrl ? [listing.photoUrl] : []),
    price: listing.price ?? null,
    landArea: listing.landArea ?? null,
    floorArea: listing.floorArea ?? null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    bedroomsApprox: listing.bedroomsApprox ?? null,
    bathroomsApprox: listing.bathroomsApprox ?? null,
    landAreaApprox: listing.landAreaApprox ?? null,
    floorAreaApprox: listing.floorAreaApprox ?? null,
    priceApprox: listing.priceApprox ?? null,
    propertyType: listing.propertyType ?? listing.listingCategory ?? null,
    listingTitle: listing.listingTitle ?? null,
    source: "realestate.co.nz",
    agentName: listing.agentName ?? null,
    agencyName: listing.agencyName ?? null,
    matchConfidence: "verified",
    isActiveListing: true,
    isCombinedListing: listing.isCombinedListing ?? null,
    packageAddress: listing.isCombinedListing ? listing.address : null,
    childAddresses: null,
    aggregateFactsExcluded: listing.isCombinedListing ? true : null,
  };
}

async function resolvePastedPropertyListing(
  text: string,
  log: FeasibilityLog,
): Promise<PastedListingResolution> {
  const urls = extractUrlsFromText(text);
  if (urls.length === 0) return { status: "none" };

  const realestateUrls = urls.filter(isRealestateListingUrl);
  if (realestateUrls.length === 0) return { status: "unsupported", urls };

  for (const url of realestateUrls) {
    try {
      const listing = await fetchRealestateListingByUrl(url);
      if (listing?.address) {
        return {
          status: "resolved",
          url,
          address: listing.address,
          context: selectedListingContextFromListing(listing, url),
        };
      }
    } catch (err) {
      log.warn({ err, url }, "Pasted listing URL resolution failed");
    }
  }

  return { status: "unresolved", urls: realestateUrls };
}

function addressPromptForUnresolvedUrl(locale: ReturnType<typeof normaliseLocale>): string {
  return locale === "zh"
    ? "我无法从这个链接识别出可分析的房产地址。请粘贴完整的街道地址，或发送有效的 realestate.co.nz 房源链接。"
    : "I could not identify a property address from that link. Please paste the full street address, or send a valid realestate.co.nz property listing link.";
}

function resolveCombinedPackage(raw: string): { packageAddress: string; childAddresses: string[] } | null {
  const parsed = extractCombinedListingAddressParts(raw);
  if (!parsed) return null;
  const maxChildren = 10;
  if (parsed.childAddresses.length > maxChildren) {
    logger.warn(
      { packageAddress: parsed.packageAddress, detectedChildren: parsed.childAddresses.length, maxChildren },
      "Combined package child address count capped",
    );
  }
  return {
    packageAddress: parsed.packageAddress,
    childAddresses: parsed.childAddresses.slice(0, maxChildren),
  };
}

function reportAddress(report: Record<string, unknown>, fallback: string): string {
  const direct = typeof report.address === "string" && report.address.trim() ? report.address.trim() : "";
  const overview = report.propertyOverview;
  const overviewAddress =
    overview && typeof overview === "object" && typeof (overview as Record<string, unknown>).address === "string"
      ? ((overview as Record<string, unknown>).address as string).trim()
      : "";
  return direct || overviewAddress || fallback;
}

function numericScore(report: Record<string, unknown>, key: "composite" | "roi"): number | null {
  const scores = report.scores;
  if (!scores || typeof scores !== "object") return null;
  const value = (scores as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function potentialLots(report: Record<string, unknown>): number | null {
  const planning = report.planning;
  if (planning && typeof planning === "object") {
    const value = (planning as Record<string, unknown>).potentialLots;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  const legacy = report.potential_lots;
  return typeof legacy === "number" && Number.isFinite(legacy) ? legacy : null;
}

async function localiseCombinedComparison(
  comparison: CombinedReportGroup["comparison"],
  warnings: string[],
  locale: ReturnType<typeof normaliseLocale>,
): Promise<{ comparison: CombinedReportGroup["comparison"]; warnings: string[] }> {
  if (locale !== "zh") return { comparison, warnings };
  const [summary, recommendedNextStep, ...translatedLists] = await Promise.all([
    ensureChinese(comparison.summary),
    ensureChinese(comparison.recommendedNextStep),
    ...comparison.subdivisionView.map((s) => ensureChinese(s)),
    ...comparison.investmentView.map((s) => ensureChinese(s)),
    ...comparison.risks.map((s) => ensureChinese(s)),
    ...warnings.map((s) => ensureChinese(s)),
  ]);
  const subdivisionEnd = comparison.subdivisionView.length;
  const investmentEnd = subdivisionEnd + comparison.investmentView.length;
  const risksEnd = investmentEnd + comparison.risks.length;
  return {
    comparison: {
      summary,
      recommendedNextStep,
      subdivisionView: translatedLists.slice(0, subdivisionEnd),
      investmentView: translatedLists.slice(subdivisionEnd, investmentEnd),
      risks: translatedLists.slice(investmentEnd, risksEnd),
    },
    warnings: translatedLists.slice(risksEnd),
  };
}

/**
 * Pull a compact, LLM-friendly snapshot of a child report — covers everything
 * the combined-investment summary needs: zone, lots, CV, land/floor area,
 * build year, scores, listed price, and the headline subdivision pathway.
 */
function summariseChildReportForLLM(report: Record<string, unknown>, fallbackAddress: string): {
  address: string;
  zone: string | null;
  cv: string | null;
  landArea: string | null;
  floorArea: string | null;
  buildYear: string | null;
  bedrooms: string | null;
  bathrooms: string | null;
  potentialLots: number | null;
  compositeScore: number | null;
  roiScore: number | null;
  costScore: number | null;
  easeScore: number | null;
  subdivisionPathway: string | null;
  listingPrice: string | null;
} {
  const address = reportAddress(report, fallbackAddress);
  const overview = (report.propertyOverview as Record<string, unknown> | undefined) ?? {};
  const planning = (report.planning as Record<string, unknown> | undefined) ?? {};
  const scoresObj = (report.scores as Record<string, unknown> | undefined) ?? {};
  const subdivisionPathwayObj = (report.subdivisionPathway as Record<string, unknown> | undefined) ?? null;

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
    return null;
  };
  return {
    address,
    zone: str(overview.zone) ?? str(planning.zone),
    cv: str(overview.cv),
    landArea: str(overview.landArea),
    floorArea: str(overview.floorArea),
    buildYear: str(overview.buildYear),
    bedrooms: str(overview.bedrooms) ?? (typeof overview.bedrooms === "number" ? String(overview.bedrooms) : null),
    bathrooms: str(overview.bathrooms) ?? (typeof overview.bathrooms === "number" ? String(overview.bathrooms) : null),
    potentialLots: potentialLots(report),
    compositeScore: num(scoresObj.composite),
    roiScore: num(scoresObj.roi),
    costScore: num(scoresObj.cost),
    easeScore: num(scoresObj.ease),
    subdivisionPathway:
      str(subdivisionPathwayObj?.headline) ?? str(subdivisionPathwayObj?.detail) ?? null,
    listingPrice: str(report.listingPrice),
  };
}

/**
 * Render a child-report summary as a compact text block for the LLM prompt.
 */
function renderChildSummaryForPrompt(s: ReturnType<typeof summariseChildReportForLLM>): string {
  const facts: string[] = [`Address: ${s.address}`];
  if (s.zone) facts.push(`Zone: ${s.zone}`);
  if (s.cv) facts.push(`Council valuation: ${s.cv}`);
  if (s.landArea) facts.push(`Land area: ${s.landArea}`);
  if (s.floorArea) facts.push(`Floor area: ${s.floorArea}`);
  if (s.buildYear) facts.push(`Built: ${s.buildYear}`);
  if (s.bedrooms) facts.push(`Bedrooms: ${s.bedrooms}`);
  if (s.bathrooms) facts.push(`Bathrooms: ${s.bathrooms}`);
  if (s.potentialLots != null) facts.push(`Potential lots: ${s.potentialLots}`);
  if (s.compositeScore != null) facts.push(`Overall feasibility: ${s.compositeScore.toFixed(1)}/5`);
  if (s.roiScore != null) facts.push(`ROI score: ${s.roiScore.toFixed(1)}/5`);
  if (s.costScore != null) facts.push(`Cost score: ${s.costScore.toFixed(1)}/5`);
  if (s.easeScore != null) facts.push(`Ease score: ${s.easeScore.toFixed(1)}/5`);
  if (s.subdivisionPathway) facts.push(`Subdivision: ${s.subdivisionPathway}`);
  if (s.listingPrice) facts.push(`Listing price: ${s.listingPrice}`);
  return facts.join("\n  - ");
}

/**
 * Ask the LLM to write a real combined-package investment narrative based on
 * the actual child reports. Returns null on failure so the deterministic
 * fallback stays in place.
 */
async function generateCombinedInvestmentSummary(
  packageAddress: string,
  childSummaries: ReturnType<typeof summariseChildReportForLLM>[],
  failures: CombinedReportFailure[],
  locale: ReturnType<typeof normaliseLocale>,
): Promise<{
  summary: string;
  subdivisionView: string[];
  investmentView: string[];
  risks: string[];
  recommendedNextStep: string;
} | null> {
  if (childSummaries.length < 2) return null;
  const blocks = childSummaries
    .map((s, i) => `Property ${i + 1}:\n  - ${renderChildSummaryForPrompt(s)}`)
    .join("\n\n");
  const failuresBlock = failures.length > 0
    ? `\n\nReports that failed to generate (do not invent data for these — note the gap):\n${failures.map((f) => `- ${f.address}: ${f.error}`).join("\n")}`
    : "";
  const localeInstruction = locale === "zh"
    ? "Write all string values in fluent simplified Chinese (zh-CN). Do not translate the property addresses — keep them in English exactly as provided."
    : "Write all string values in clear professional English suited to a New Zealand property investor.";

  const prompt = `You are a senior New Zealand property investment analyst writing the COMBINED-PACKAGE summary for an investor who is considering buying the following addresses TOGETHER as one transaction.

PACKAGE ADDRESS (as listed):
${packageAddress}

PER-PROPERTY ANALYSIS (each address was analysed independently — values below are tied to the named address, NOT aggregated across the package):

${blocks}${failuresBlock}

Write a JSON object with these exact fields:

{
  "summary": "2-4 sentences. Explain the combined investment thesis: why these two titles together create (or do not create) a stronger play than either alone — think site assembly, joint subdivision, shared services, scale, holding cost. Reference each property by its actual street number. Be honest if the package is just two unrelated houses sold together.",
  "subdivisionView": [
    // One bullet per property, naming the property and stating its subdivision potential. Then one extra bullet covering whether COMBINING the titles unlocks more lots / a different pathway than the sum of the parts (e.g. boundary adjustment, joint resource consent, shared access lot).
  ],
  "investmentView": [
    // One bullet per property covering its standalone investment story (CV vs likely price, ROI score, hold-vs-develop). Plus one final bullet on the package-level economics: price allocation, joint financing, exit options if one title is sold first.
  ],
  "risks": [
    // 3-5 bullets. Always include: title/tenure verification, package price allocation, shared services/access. Add any property-specific risks (zoning, build year, slope) drawn from the actual data above.
  ],
  "recommendedNextStep": "1 sentence. The single most useful next action for the investor — which address to lead due diligence with, which professional to engage first, or which question to ask the agent."
}

Critical rules:
- ${localeInstruction}
- Never aggregate land area, bedrooms, bathrooms, or CV across properties — refer to them per-address.
- If a value is missing for a property, say so explicitly (e.g. "build year not confirmed for 7 Stanmore Road").
- Do not invent numbers. Use only what is in the per-property data above.
- Reply with ONLY the JSON object — no markdown, no preamble.`;

  try {
    const raw = await generateAnalysis(prompt, locale);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      summary?: unknown;
      subdivisionView?: unknown;
      investmentView?: unknown;
      risks?: unknown;
      recommendedNextStep?: unknown;
    };
    const stringArray = (v: unknown): string[] | null =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : null;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : null;
    const subdivisionView = stringArray(parsed.subdivisionView);
    const investmentView = stringArray(parsed.investmentView);
    const risks = stringArray(parsed.risks);
    const recommendedNextStep =
      typeof parsed.recommendedNextStep === "string" ? parsed.recommendedNextStep.trim() : null;
    if (!summary || !subdivisionView?.length || !investmentView?.length || !risks?.length || !recommendedNextStep) {
      logger.warn(
        { packageAddress, hasSummary: !!summary, sublen: subdivisionView?.length, invlen: investmentView?.length, risklen: risks?.length },
        "Combined investment LLM summary returned incomplete JSON — falling back to deterministic",
      );
      return null;
    }
    return { summary, subdivisionView, investmentView, risks, recommendedNextStep };
  } catch (err) {
    logger.warn({ err: (err as Error).message, packageAddress }, "Combined investment LLM summary failed — falling back to deterministic");
    return null;
  }
}

async function buildCombinedReportGroup(args: {
  packageAddress: string;
  childAddresses: string[];
  reports: Record<string, unknown>[];
  failures: CombinedReportFailure[];
  locale: ReturnType<typeof normaliseLocale>;
}): Promise<CombinedReportGroup> {
  const childSummaries = args.reports.map((report, idx) =>
    summariseChildReportForLLM(report, args.childAddresses[idx] ?? `Property ${idx + 1}`),
  );
  const reportSummaries = childSummaries.map((s) => ({
    address: s.address,
    composite: s.compositeScore,
    roi: s.roiScore,
    lots: s.potentialLots,
  }));
  const bestByComposite = reportSummaries
    .filter((r) => r.composite != null)
    .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))[0];
  const bestByLots = reportSummaries
    .filter((r) => r.lots != null)
    .sort((a, b) => (b.lots ?? 0) - (a.lots ?? 0))[0];

  const llmSummary = await generateCombinedInvestmentSummary(
    args.packageAddress,
    childSummaries,
    args.failures,
    args.locale,
  );

  const deterministicComparison: CombinedReportGroup["comparison"] = {
    summary: `This appears to be a combined listing package. Each address has been analysed separately so land area, title, services, zoning and return assumptions stay tied to the correct property.`,
    subdivisionView: reportSummaries.map((r) =>
      `${r.address}: ${r.lots != null ? `${r.lots} potential lot${r.lots === 1 ? "" : "s"} indicated by the individual report` : "subdivision yield is not confirmed in the individual report"}.`,
    ),
    investmentView: reportSummaries.map((r) =>
      `${r.address}: ${r.composite != null ? `${r.composite.toFixed(1)}/5 overall feasibility` : "overall feasibility score unavailable"}${r.roi != null ? `, ROI score ${r.roi.toFixed(1)}/5` : ""}.`,
    ),
    risks: [
      "Do not add the package land area to one address unless a planner or surveyor confirms the legal titles and sale structure.",
      "Treat shared driveways, services, easements and access as package-level due diligence items.",
      ...args.failures.map((f) => `${f.address}: report generation failed (${f.error}).`),
    ],
    recommendedNextStep: bestByLots
      ? `Start subdivision due diligence with ${bestByLots.address}, then compare the purchase price allocation across both titles.`
      : bestByComposite
        ? `Start commercial due diligence with ${bestByComposite.address}, then verify whether the package price fairly reflects both titles.`
        : "Verify title boundaries and package price allocation before relying on any combined-listing development assumptions.",
  };

  // Prefer the LLM narrative when available; always append the per-property
  // failure notes so they aren't lost.
  const comparison: CombinedReportGroup["comparison"] = llmSummary
    ? {
        summary: llmSummary.summary,
        subdivisionView: llmSummary.subdivisionView,
        investmentView: llmSummary.investmentView,
        risks: [
          ...llmSummary.risks,
          ...args.failures.map((f) => `${f.address}: report generation failed (${f.error}).`),
        ],
        recommendedNextStep: llmSummary.recommendedNextStep,
      }
    : deterministicComparison;

  const warnings = [
    "Combined listing facts are shown as listing context only. They are not used as verified facts for any one child property.",
  ];
  // The LLM is already prompted to emit text in the target locale (and to
  // preserve English addresses) so we only run the legacy translation step
  // when we fell back to the deterministic English copy.
  const finalComparison = llmSummary ? comparison : (await localiseCombinedComparison(comparison, warnings, args.locale)).comparison;
  const finalWarnings = llmSummary
    ? (args.locale === "zh" ? await Promise.all(warnings.map((w) => ensureChinese(w))) : warnings)
    : (await localiseCombinedComparison(comparison, warnings, args.locale)).warnings;
  return {
    kind: "combined_listing_group",
    packageAddress: args.packageAddress,
    childAddresses: args.childAddresses,
    reports: args.reports,
    failures: args.failures,
    comparison: finalComparison,
    warnings: finalWarnings,
  };
}

async function applyCombinedListingContextToReport(
  report: Record<string, unknown>,
  pipelineResult: PipelineResult | null,
  locale: ReturnType<typeof normaliseLocale>,
): Promise<void> {
  const listing = pipelineResult?.realestate_listing;
  if (!listing?.isCombinedListing) return;
  const parsed = extractCombinedListingAddressParts(listing.address);
  if (!parsed) return;
  const note = "The active listing appears to package multiple addresses. Package land, bedroom and bathroom figures were excluded from this single-property report.";
  const localisedNote = locale === "zh" ? await ensureChinese(note) : note;
  const context = {
    isCombinedListingMatch: true,
    packageAddress: parsed.packageAddress,
    childAddresses: parsed.childAddresses,
    aggregateFactsExcluded: true,
    note: localisedNote,
  };
  report.combinedListingContext = context;
  const overview = (report.propertyOverview as Record<string, unknown> | undefined) ?? {};
  report.propertyOverview = {
    ...overview,
    combinedListingContext: context,
  };
}

async function applyExplicitCombinedListingContextToReport(
  report: Record<string, unknown>,
  args: {
    packageAddress: string;
    childAddresses: string[];
    locale: ReturnType<typeof normaliseLocale>;
    listingUrl?: string | null;
  },
): Promise<void> {
  const note = "This property belongs to a combined listing package. Package land, bedroom, bathroom and price figures are excluded from this single-property report.";
  const localisedNote = args.locale === "zh" ? await ensureChinese(note) : note;
  const context = {
    isCombinedListingMatch: true,
    packageAddress: args.packageAddress,
    childAddresses: args.childAddresses,
    aggregateFactsExcluded: true,
    note: localisedNote,
  };
  report.combinedListingContext = context;
  const overview = (report.propertyOverview as Record<string, unknown> | undefined) ?? {};
  report.propertyOverview = {
    ...overview,
    combinedListingContext: context,
    listingUrl: args.listingUrl ?? overview.listingUrl ?? null,
  };
  report.selectedListingContext = {
    ...(report.selectedListingContext as Record<string, unknown> | undefined),
    address: args.packageAddress,
    listingUrl: args.listingUrl ?? null,
    isCombinedListing: true,
    packageAddress: args.packageAddress,
    childAddresses: args.childAddresses,
    aggregateFactsExcluded: true,
  };
}

async function runFeasibilityAnalyseCore(args: {
  address: string;
  analysisAddress: string;
  locale: ReturnType<typeof normaliseLocale>;
  translateTitleSchool: boolean;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  selectedListingUrl?: string | null;
  selectedListingContext?: SelectedListingContext | null;
  userId: string | null;
  log: FeasibilityLog;
  notifyWhenReady?: boolean;
  geocodeFallbackAddress?: string | null;
}): Promise<{
  report: Record<string, unknown>;
  savedSearchId: string | null;
  savedSearchCreatedAt: string | null;
}> {
  const { address, analysisAddress, locale, translateTitleSchool, conversationHistory, selectedListingUrl, selectedListingContext, userId, log } = args;
  const identity = args.geocodeFallbackAddress
    ? null
    : await detectSubdivision(analysisAddress).catch(() => null);
  const geocodeFallbackAddress = args.geocodeFallbackAddress
    ?? (identity?.classification === "same_title_aliases" ? identity.geocodeFallbackAddress : null);
  const selectedContext =
    normaliseSelectedListingContext(selectedListingContext) ??
    selectedListingContextFromHistory(conversationHistory);
  const preferredListingUrl =
    selectedContext?.listingUrl ?? selectedListingUrl ?? selectedListingUrlFromHistory(conversationHistory, analysisAddress);
  const preferredRealestateListingUrl =
    preferredListingUrl && /realestate\.co\.nz/i.test(preferredListingUrl) ? preferredListingUrl : null;

  // Global property cache: reuse the raw acquired data for this address if any
  // user has analysed it before. The derived/financial numbers still recompute
  // and the listing/photo fields still refetch live (see runPropertyPipeline).
  const addressKey = normaliseDiscoveryAddressKey(analysisAddress);
  const cachedEntry = addressKey ? await getCachedRaw(addressKey) : null;
  if (cachedEntry) {
    log.info({ addressKey, marker: "PROPERTY_CACHE_HIT", refreshedAt: cachedEntry.row.lastRefreshedAt }, "Property cache hit — skipping external acquisition");
  }

  let pipelineResult = await runPropertyPipeline(analysisAddress, {
    preferredRealestateListingUrl,
    selectedListingContext: selectedContext,
    cachedRaw: cachedEntry?.rawData ?? null,
    cachedRawAcquiredAt: cachedEntry ? new Date(cachedEntry.row.lastRefreshedAt as unknown as string | Date).toISOString() : null,
    geocodeFallbackAddress,
  }).catch((err) => {
    log.warn({ err }, "Pipeline failed during feasibility core — falling back to LLM-only report");
    return null;
  });

  // Conflict-triggered cache invalidation: the live listing claims a new
  // dwelling but the CACHED council records describe an old one — the parcel
  // may have been redeveloped since the cache row was written. Re-acquire live
  // once so the report reflects current records, and refresh the cache row.
  let forcedLiveRefresh = false;
  if (pipelineResult?.redevelopmentCheck?.suspected && pipelineResult.served_from_cache) {
    log.info(
      { addressKey, reasons: pipelineResult.redevelopmentCheck.reasons, marker: "PROPERTY_CACHE_CONFLICT_REFRESH" },
      "Redevelopment suspected on cached data — forcing live re-acquisition",
    );
    const fresh = await runPropertyPipeline(analysisAddress, {
      preferredRealestateListingUrl,
      selectedListingContext: selectedContext,
      cachedRaw: null,
      geocodeFallbackAddress,
    }).catch((err) => {
      log.warn({ err }, "Forced live re-acquisition failed — keeping cached-data result");
      return null;
    });
    if (fresh) {
      pipelineResult = fresh;
      forcedLiveRefresh = true;
    }
  }

  // Persist the raw acquired data globally (or refresh hit stats). Best-effort:
  // never let a cache write affect the user-facing result.
  if (pipelineResult && addressKey) {
    const displayAddress = displayAddressForAnalysis(analysisAddress, pipelineResult);
    if (cachedEntry && !forcedLiveRefresh) {
      void bumpHitCount(addressKey);
      // Backfill real scores onto old or scoreless cached rows so screening
      // cards match the report without resetting the raw-data freshness clock.
      if (shouldBackfillDerivedScores(cachedEntry.rawData.derived_scores, pipelineResult.raw_property?.derived_scores)) {
        void backfillDerivedScores(addressKey, pipelineResult.raw_property.derived_scores);
        // Keep the feature index in step with the backfilled scores, preserving
        // the cache row's freshness (never revive stale data on a cache-serve).
        upsertFeatureRowFromPipeline(pipelineResult, {
          addressKey,
          lastRefreshedAt: new Date(cachedEntry.row.lastRefreshedAt as unknown as string | Date),
          pipelineVersion: cachedEntry.row.pipelineVersion,
        });
      }
    } else if (hasCacheableCore(pipelineResult) && pipelineResult.raw_property) {
      await upsertCachedRaw({
        addressKey,
        rawData: pipelineResult.raw_property,
        canonicalParcelId: pipelineResult.linz_parcel?.parcel_id ?? null,
        canonicalTitleId: pipelineResult.linz_parcel?.title_no ?? pipelineResult.linz_title?.title_no ?? null,
        formattedAddress: displayAddress,
        lat: pipelineResult.geocode?.lat ?? null,
        lng: pipelineResult.geocode?.lng ?? null,
        suburb: pipelineResult.suburb ?? null,
        sourceUserId: userId,
      });
      upsertFeatureRowFromPipeline(pipelineResult, {
        addressKey,
        lastRefreshedAt: new Date(),
        pipelineVersion: PIPELINE_VERSION,
      });
    }
  }

  let report: Record<string, unknown>;
  const displayAddress = pipelineResult ? displayAddressForAnalysis(analysisAddress, pipelineResult) : analysisAddress;
  const deterministicReport = pipelineResult
    ? buildDeterministicFallbackReport(pipelineResult, displayAddress)
    : null;

  if (deterministicReport) {
    report = deterministicReport;
  } else {
    const raw = await generateFeasibilityReport(analysisAddress, conversationHistory || [], locale);
    report = extractJSON(raw) as Record<string, unknown>;
  }

  if (pipelineResult && report && typeof report === "object") {
    applyDeterministicPipelineOverrides(
      report,
      pipelineResult,
      displayAddress,
      locale,
    );
    applySelectedListingContextToReport(
      report,
      reconcileSelectedListingContextWithLiveListing(
        selectedContext ?? pipelineResult.selectedListingContext,
        pipelineResult.realestate_listing,
      ),
    );
    await applyCombinedListingContextToReport(report, pipelineResult, locale);
  }
  if (!pipelineResult && selectedContext) {
    applySelectedListingContextToReport(report, selectedContext);
  }

  if (locale === "zh") {
    report = await translateReportNarrative(report, { translateTitleAndSchoolFields: translateTitleSchool });
  }

  let savedSearchId: string | null = null;
  let savedSearchCreatedAt: string | null = null;
  if (userId) {
    await db.update(profiles).set({
      reportsUsedThisMonth: sql`${profiles.reportsUsedThisMonth} + 1`,
    }).where(eq(profiles.id, userId));

    try {
      const [row] = await db
        .insert(searches)
        .values({
          userId,
          query: address,
          address: displayAddress,
          resultJson: report as Record<string, unknown>,
        })
        .returning({ id: searches.id, createdAt: searches.createdAt });
      savedSearchId = row?.id ?? null;
      savedSearchCreatedAt = row?.createdAt ? new Date(row.createdAt as unknown as string).toISOString() : null;
    } catch (err) {
      log.error({ err }, "Failed to save analyse report to history");
    }

    if (savedSearchId && args.notifyWhenReady !== false) {
      const shortAddr = address.length > 90 ? `${address.slice(0, 87)}…` : address;
      const pushTitle = locale === "zh" ? "分析报告已就绪" : "Report ready";
      const pushBody =
        locale === "zh"
          ? `您请求的「${shortAddr}」分析已完成，请打开应用查看。`
          : `Your analysis for ${shortAddr} is ready — open the app to view it.`;
      try {
        await createNotificationItem({
          userId,
          kind: "report_ready",
          sourceId: savedSearchId,
          page: "history",
          title: pushTitle,
          body: pushBody,
          metadata: { searchId: savedSearchId, address: analysisAddress },
        });
        const badgeCount = await getUnreadAppBadgeCount(userId);
        void sendPushToUser(userId, pushTitle, pushBody, {
          type: "report_ready",
          searchId: savedSearchId,
        }, {
          badgeCount,
        }).catch((e) => log.warn({ e }, "Report-ready push failed (non-fatal)"));
      } catch (err) {
        log.warn({ err }, "Report-ready notification ledger write failed (non-fatal)");
      }
    }
  }

  return { report, savedSearchId, savedSearchCreatedAt };
}

async function runCombinedFeasibilityGroupCore(args: {
  packageAddress: string;
  childAddresses: string[];
  locale: ReturnType<typeof normaliseLocale>;
  translateTitleSchool: boolean;
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>;
  userId: string | null;
  log: FeasibilityLog;
  selectedListingUrl?: string | null;
}): Promise<{
  reportGroup: CombinedReportGroup;
  savedSearchId: string | null;
  savedSearchCreatedAt: string | null;
}> {
  const reports: Record<string, unknown>[] = [];
  const failures: CombinedReportFailure[] = [];

  const childRetryDelaysMs = [0, 1500, 5000];
  for (const childAddress of args.childAddresses) {
    try {
      let result: Awaited<ReturnType<typeof runFeasibilityAnalyseCore>> | null = null;
      let lastErr: unknown;
      for (let attempt = 0; attempt < childRetryDelaysMs.length; attempt++) {
        if (childRetryDelaysMs[attempt] > 0) {
          await new Promise((resolve) => setTimeout(resolve, childRetryDelaysMs[attempt]));
        }
        try {
          result = await runFeasibilityAnalyseCore({
            address: args.packageAddress,
            analysisAddress: childAddress,
            locale: args.locale,
            translateTitleSchool: args.translateTitleSchool,
            conversationHistory: args.conversationHistory,
            selectedListingUrl: args.selectedListingUrl ?? null,
            selectedListingContext: {
              address: args.packageAddress,
              listingUrl: args.selectedListingUrl ?? null,
              isCombinedListing: true,
              packageAddress: args.packageAddress,
              childAddresses: args.childAddresses,
              aggregateFactsExcluded: true,
            },
            userId: null,
            log: args.log,
          });
          break;
        } catch (err) {
          lastErr = err;
          args.log.warn({ err, childAddress, attempt: attempt + 1 }, "Combined listing child report attempt failed");
        }
      }
      if (!result) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? "child analysis failed"));
      await applyExplicitCombinedListingContextToReport(result.report, {
        packageAddress: args.packageAddress,
        childAddresses: args.childAddresses,
        locale: args.locale,
        listingUrl: args.selectedListingUrl ?? null,
      });
      reports.push(result.report);
    } catch (err) {
      failures.push({
        address: childAddress,
        error: err instanceof Error ? err.message : String(err),
      });
      args.log.warn({ err, childAddress }, "Combined listing child report failed");
    }
  }

  if (reports.length === 0) {
    throw new Error("No child reports could be generated for the combined listing.");
  }

  const reportGroup = await buildCombinedReportGroup({
    packageAddress: args.packageAddress,
    childAddresses: args.childAddresses,
    reports,
    failures,
    locale: args.locale,
  });

  let savedSearchId: string | null = null;
  let savedSearchCreatedAt: string | null = null;
  if (args.userId) {
    await db.update(profiles).set({
      reportsUsedThisMonth: sql`${profiles.reportsUsedThisMonth} + 1`,
    }).where(eq(profiles.id, args.userId));

    try {
      const [row] = await db
        .insert(searches)
        .values({
          userId: args.userId,
          query: args.packageAddress,
          address: args.packageAddress,
          resultJson: reportGroup as unknown as Record<string, unknown>,
        })
        .returning({ id: searches.id, createdAt: searches.createdAt });
      savedSearchId = row?.id ?? null;
      savedSearchCreatedAt = row?.createdAt ? new Date(row.createdAt as unknown as string).toISOString() : null;
      reportGroup.historyId = savedSearchId;
      reportGroup.historyCreatedAt = savedSearchCreatedAt;
      reportGroup.reports = reportGroup.reports.map((report) => ({
        ...report,
        historyId: savedSearchId,
        historyCreatedAt: savedSearchCreatedAt,
      }));
    } catch (err) {
      args.log.error({ err }, "Failed to save combined listing report group to history");
    }
  }

  return { reportGroup, savedSearchId, savedSearchCreatedAt };
}

async function processFeasibilityJob(jobId: string, log: FeasibilityLog): Promise<void> {
  const rows = await withDbRetry(() =>
    db.select().from(feasibilityJobs).where(eq(feasibilityJobs.id, jobId)).limit(1),
  );
  const job = rows[0];
  if (!job) return;
  if (job.status !== "pending" && !isStaleFeasibilityJob(job)) return;

  await withDbRetry(() =>
    db
      .update(feasibilityJobs)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(feasibilityJobs.id, jobId)),
  );

  try {
    const conv = (job.conversationHistory as Array<{ role: "user" | "assistant"; content: string }> | null) ?? [];
    const locale = (job.locale === "zh" ? "zh" : "en") as ReturnType<typeof normaliseLocale>;
    const combinedPackage = resolveCombinedPackage(job.queryAddress) ?? resolveCombinedPackage(job.analysisAddress);
    const result = combinedPackage
      ? await runCombinedFeasibilityGroupCore({
          packageAddress: combinedPackage.packageAddress,
          childAddresses: combinedPackage.childAddresses,
          locale,
          translateTitleSchool: Boolean(job.translateTitleSchool),
          conversationHistory: conv,
          userId: job.userId,
          log,
        })
      : await runFeasibilityAnalyseCore({
          address: job.queryAddress,
          analysisAddress: job.analysisAddress,
          locale,
          translateTitleSchool: Boolean(job.translateTitleSchool),
          conversationHistory: conv,
          userId: job.userId,
          log,
          notifyWhenReady: false,
        });
    await withDbRetry(() =>
      db
        .update(feasibilityJobs)
        .set({
          status: "completed",
          searchId: result.savedSearchId,
          updatedAt: new Date(),
        })
        .where(eq(feasibilityJobs.id, jobId)),
    );
    if (result.savedSearchId) {
      const shortAddr = job.queryAddress.length > 90 ? `${job.queryAddress.slice(0, 87)}…` : job.queryAddress;
      const pushTitle = locale === "zh" ? "分析报告已就绪" : "Report ready";
      const pushBody =
        locale === "zh"
          ? `您请求的「${shortAddr}」分析已完成，请打开应用查看。`
          : `Your analysis for ${shortAddr} is ready — open the app to view it.`;
      try {
        await createNotificationItem({
          userId: job.userId,
          kind: "report_ready",
          sourceId: result.savedSearchId,
          page: "history",
          title: pushTitle,
          body: pushBody,
          metadata: { searchId: result.savedSearchId, jobId, address: job.analysisAddress },
        });
        const badgeCount = await getUnreadAppBadgeCount(job.userId);
        void sendPushToUser(job.userId, pushTitle, pushBody, {
          type: "report_ready",
          searchId: result.savedSearchId,
          jobId,
        }, {
          badgeCount,
        }).catch((e) => log.warn({ e }, "Report-ready push failed (non-fatal)"));
      } catch (err) {
        log.warn({ err }, "Report-ready notification ledger write failed (non-fatal)");
      }
    }
  } catch (err) {
    await withDbRetry(() =>
      db
        .update(feasibilityJobs)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(feasibilityJobs.id, jobId)),
    );
    log.error({ err }, "Background feasibility job failed");
  }
}

router.post(
  "/analyse",
  // The crown-jewel endpoint: every call burns the AI pipeline and is the prime
  // target for distillation harvesting. Caps are far above any human's usage.
  ipRateLimit({ name: "analyse", windowMs: minutes(1), max: 30 }),
  ipRateLimit({ name: "analyse-hr", windowMs: hours(1), max: 200 }),
  userRateLimit({ name: "analyse", windowMs: minutes(1), max: 12 }),
  async (req, res) => {
  const { address, conversationHistory, async: asyncFlag, selectedListingUrl, selectedListingContext, addressConfirmed } = req.body as {
    address: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    async?: boolean;
    selectedListingUrl?: string | null;
    selectedListingContext?: SelectedListingContext | null;
    addressConfirmed?: boolean;
  };
  const normalisedSelectedListingContext = normaliseSelectedListingContext(selectedListingContext);

  const analyseLocale = localeFromReq({ headers: req.headers as Record<string, string | string[] | undefined> });

  if (!address) {
    res.status(400).json({ error: "address is required", code: "MISSING_ADDRESS" });
    return;
  }

  const userId = await getUserIdFromHeader(req);
  if (userId === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  if (!userId) {
    await rejectAuthRequired(res, analyseLocale);
    return;
  }
  noteUserActivity(userId, req.log);

  // Canary honeytokens (Layer 3): a request for a trap address is near-certain
  // scraping. Short-circuit with the fingerprint payload (no pipeline, no quota)
  // and log the hit. Real users never reach this — they don't know these exist.
  const canary = matchCanary(address);
  if (canary) {
    noteAbuseSignal({
      kind: "canary_hit",
      userId,
      ip: req.ip,
      detail: `canary ${canary.id} (${canary.label})`,
    });
    res.json({ report: buildCanaryReport(canary, address), type: "report", searchId: null });
    return;
  }

  if (userId) {
    let profile:
      | {
          id: string;
          role: string;
          subscriptionTier: string;
          reportsUsedThisMonth: number;
          lastResetAt: Date;
          subscriptionPeriodEndAt: Date | null;
          subscriptionStatus: string | null;
          stripeSubscriptionId: string | null;
          providerTrialStartedAt: Date | null;
          providerTrialEndsAt: Date | null;
          specialStatus: string | null;
          specialStatusExpiresAt: Date | null;
          createdAt: Date;
        }
      | undefined;
    try {
      const rows = await withDbRetry(() =>
        db
          .select({
            id: profiles.id,
            role: profiles.role,
            subscriptionTier: profiles.subscriptionTier,
            reportsUsedThisMonth: profiles.reportsUsedThisMonth,
            lastResetAt: profiles.lastResetAt,
            subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
            subscriptionStatus: profiles.subscriptionStatus,
            stripeSubscriptionId: profiles.stripeSubscriptionId,
            providerTrialStartedAt: profiles.providerTrialStartedAt,
            providerTrialEndsAt: profiles.providerTrialEndsAt,
            specialStatus: profiles.specialStatus,
            specialStatusExpiresAt: profiles.specialStatusExpiresAt,
            createdAt: profiles.createdAt,
          })
          .from(profiles)
          .where(eq(profiles.id, userId))
          .limit(1),
      );
      profile = rows[0];
    } catch (err) {
      req.log.error(
        { err, pg: pgErrorChain(err), userId },
        "Database error loading profiles row for /analyse quota check",
      );
      res.status(500).json({
        error: "Could not load account from database. If this persists, run db schema sync (e.g. pnpm --filter @workspace/db run push) and verify DATABASE_URL.",
        code: "PROFILE_DB_ERROR",
      });
      return;
    }

    if (profile) {
      const now = new Date();

      // ── Special admin-granted status (checked before plan limits) ──────────
      // "friends_family" → 9999/month, never expires
      // "supercharge"    → 60/month, auto-reverts to null after 6 months
      let specialLimit: number | null = null;
      if (profile.specialStatus === "friends_family") {
        specialLimit = 9999;
      } else if (profile.specialStatus === "supercharge") {
        if (profile.specialStatusExpiresAt && now >= profile.specialStatusExpiresAt) {
          // Status has expired — silently revert (fire-and-forget)
          void (async () => {
            try {
              await db
                .update(profiles)
                .set({ specialStatus: null, specialStatusExpiresAt: null })
                .where(eq(profiles.id, userId));
            } catch {
              // non-critical; next request will retry
            }
          })();
          // fall through to normal plan limit below
        } else {
          specialLimit = 60;
        }
      }

      const lastReset = new Date(profile.lastResetAt);
      const periodEnd = profile.subscriptionPeriodEndAt ? new Date(profile.subscriptionPeriodEndAt) : null;
      const periodExpired = usagePeriodExpired(now, lastReset, profile.subscriptionTier, periodEnd);

      const usedCount = periodExpired ? 0 : profile.reportsUsedThisMonth;
      if (periodExpired) {
        try {
          await withDbRetry(() =>
            db
              .update(profiles)
              .set({
                reportsUsedThisMonth: 0,
                messagesUsedThisMonth: 0,
                lastResetAt: now,
                subscriptionPeriodEndAt: null,
              })
              .where(eq(profiles.id, userId)),
          );
        } catch (err) {
          req.log.error({ err, pg: pgErrorChain(err), userId }, "Database error resetting profile usage period");
          res.status(500).json({
            error: "Could not update account usage in database.",
            code: "PROFILE_DB_ERROR",
          });
          return;
        }
      }

      // Use special limit if active, otherwise resolve from plan/role
      const providerEntitlement = resolveProviderEntitlement(profile);
      const effectiveTier =
        profile.role === "service_provider" && providerEntitlement.providerAccessActive
          ? "standard"
          : profile.subscriptionTier;
      const limit = specialLimit !== null ? specialLimit : resolveReportLimit(effectiveTier, profile.role);
      const isStandard = effectiveTier === "pro" || effectiveTier === "standard";

      // Detection only (Layer 2): a brand-new free account burning through its
      // small free quota is the fingerprint of a farmed harvesting account.
      noteQuotaUsage({
        userId,
        ip: req.ip,
        tier: effectiveTier,
        reportsUsedThisMonth: usedCount,
        reportLimit: limit,
        accountCreatedAt: profile.createdAt,
      });

      if (
        specialLimit === null &&
        profile.role === "service_provider" &&
        !providerEntitlement.providerAccessActive &&
        limit === SERVICE_PROVIDER_FREE_REPORT_LIMIT
      ) {
        const baseMsg = "Service provider accounts require an active subscription before generating feasibility reports.";
        const translatedMsg = analyseLocale === "zh" ? await ensureChinese(baseMsg) : baseMsg;
        res.status(402).json({
          error: translatedMsg,
          code: "SUBSCRIPTION_REQUIRED",
          reportsUsed: usedCount,
          limit,
        });
        return;
      }
      // Sales agents with an active plan (invite/lifetime within their AI-boost
      // window, or an active paid subscription) get unlimited AI search/analysis.
      let agentUnlimitedReports = false;
      {
        const [agentRow] = await withDbRetry(() =>
          db
            .select({ listingPlan: salesAgentProfiles.listingPlan, aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt })
            .from(salesAgentProfiles)
            .where(eq(salesAgentProfiles.userId, userId))
            .limit(1),
        );
        if (agentRow) {
          agentUnlimitedReports = agentAiUnlimited(
            { subscriptionStatus: profile.subscriptionStatus, subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt },
            agentRow,
          );
        }
      }

      if (!agentUnlimitedReports && usedCount >= limit) {
        const baseMsg = specialLimit !== null
          ? `You've used all ${limit} reports in your current billing period. Your limit refreshes next month.`
          : isStandard
          ? `You've used all ${STANDARD_REPORT_LIMIT} reports in your current billing period. Your limit refreshes when the period renews.`
          : `You've used all ${FREE_REPORT_LIMIT} free reports in your current billing period. Upgrade to Standard for more reports.`;
        const translatedMsg = analyseLocale === "zh" ? await ensureChinese(baseMsg) : baseMsg;
        res.status(402).json({
          error: translatedMsg,
          code: "LIMIT_REACHED",
          reportsUsed: usedCount,
          limit,
        });
        return;
      }
    }
  }

  try {
    const combinedPackage = resolveCombinedPackage(address);
    if (combinedPackage) {
      const translateTitleSchool = translateTitleSchoolFromReq(
        { headers: req.headers as Record<string, string | string[] | undefined> },
        analyseLocale,
      );
      const wantAsync = Boolean(asyncFlag) && Boolean(userId);
      if (wantAsync) {
        const existing = await findReusableFeasibilityJob({
          userId: userId!,
          queryAddress: address,
          analysisAddress: combinedPackage.packageAddress,
        });
        if (existing) {
          if (existing.status === "pending") {
            runAfterResponse(processFeasibilityJob(existing.id, req.log));
          }
          res.status(202).json({ type: "queued", jobId: existing.id, status: existing.status });
          return;
        }

        const rows = await withDbRetry(() =>
          db
            .insert(feasibilityJobs)
            .values({
              userId: userId!,
              status: "pending",
              queryAddress: address,
              analysisAddress: combinedPackage.packageAddress,
              locale: analyseLocale,
              translateTitleSchool,
              conversationHistory: conversationHistory ?? null,
            })
            .returning({ id: feasibilityJobs.id }),
        );
        const inserted = rows[0];
        if (!inserted?.id) {
          res.status(500).json({ error: "Could not queue background analysis.", code: "JOB_QUEUE_FAILED" });
          return;
        }
        runAfterResponse(processFeasibilityJob(inserted.id, req.log));
        res.status(202).json({ type: "queued", jobId: inserted.id, status: "queued" });
        return;
      }

      const result = await runCombinedFeasibilityGroupCore({
        packageAddress: combinedPackage.packageAddress,
        childAddresses: combinedPackage.childAddresses,
        locale: analyseLocale,
        translateTitleSchool,
        conversationHistory: conversationHistory || [],
        userId,
        log: req.log,
        selectedListingUrl: normalisedSelectedListingContext?.listingUrl ?? selectedListingUrl ?? null,
      });
      res.json({
        reportGroup: result.reportGroup,
        type: "combined_listing_group",
        searchId: result.savedSearchId,
        historyCreatedAt: result.savedSearchCreatedAt,
      });
      return;
    }

    const analysisInput = (await extractNZAddress(address).catch(() => null)) ?? address;
    // ── Subdivision pre-check ───────────────────────────────────────────────
    // If the user typed a parent street number that has been subdivided into
    // sub-lots (e.g. "66 Marine Parade" → 66A/66B/66C), don't run the pipeline
    // against stale parent data — ask which sub-lot they meant.
    const subdivision = await detectSubdivision(analysisInput).catch(() => null);
    if (subdivision?.isSubdivided) {
      const baseQuestion = `"${analysisInput}" looks like it has been subdivided into separate lots. Which one would you like me to analyse?`;
      const localisedQuestion = analyseLocale === "zh" ? await ensureChinese(baseQuestion) : baseQuestion;
      res.json({
        type: "clarification",
        clarificationType: "subdivision",
        question: localisedQuestion,
        options: subdivision.subLots,
        // Lets a later chat turn recover "4 Inglis Street" if the user replies
        // with just a suburb correction (e.g. "Birkenhead") instead of picking
        // one of the options — see detectPendingSubdivisionCorrection.
        parentAddress: subdivision.parentAddress,
      });
      return;
    }

    const sameTitleAlias = subdivision?.classification === "same_title_aliases";
    const addressResolution = sameTitleAlias
      ? { resolvedAddress: subdivision.canonicalAddress ?? analysisInput, clarification: null }
      : addressConfirmed
        ? { resolvedAddress: analysisInput, clarification: null }
        : await resolveAddressForAnalysis(analysisInput, analyseLocale);
    if (addressResolution.clarification) {
      res.json({
        type: "clarification",
        clarificationType: addressResolution.clarification.clarificationType,
        question: addressResolution.clarification.question,
        options: addressResolution.clarification.options,
      });
      return;
    }
    const analysisAddress = addressResolution.resolvedAddress || analysisInput;
    const selectedListingMarker = normalisedSelectedListingContext
      ? selectedListingContextToHistoryMarker(normalisedSelectedListingContext)
      : selectedListingUrl
        ? `[Selected listing for analysis: ${analysisAddress}||${selectedListingUrl}]`
        : null;
    const analysisConversationHistory =
      selectedListingMarker
        ? [
            ...(conversationHistory ?? []),
            { role: "assistant" as const, content: selectedListingMarker },
          ]
        : (conversationHistory ?? []);

    const wantAsync = Boolean(asyncFlag) && Boolean(userId);
    if (wantAsync) {
      const translateTitleSchool = translateTitleSchoolFromReq(
        { headers: req.headers as Record<string, string | string[] | undefined> },
        analyseLocale,
      );

      const existing = await findReusableFeasibilityJob({
        userId: userId!,
        queryAddress: address,
        analysisAddress,
      });
      if (existing) {
        if (existing.status === "pending") {
          runAfterResponse(processFeasibilityJob(existing.id, req.log));
        }
        res.status(202).json({ type: "queued", jobId: existing.id, status: existing.status });
        return;
      }

      let inserted: { id: string } | undefined;
      try {
        const rows = await withDbRetry(() =>
          db
            .insert(feasibilityJobs)
            .values({
              userId: userId!,
              status: "pending",
              queryAddress: address,
              analysisAddress,
              locale: analyseLocale,
              translateTitleSchool,
              conversationHistory: analysisConversationHistory,
            })
            .returning({ id: feasibilityJobs.id }),
        );
        inserted = rows[0];
      } catch (err) {
        req.log.error({ err }, "Failed to insert feasibility_jobs row");
        res.status(500).json({ error: "Could not queue background analysis.", code: "JOB_QUEUE_FAILED" });
        return;
      }
      if (!inserted?.id) {
        res.status(500).json({ error: "Could not queue background analysis.", code: "JOB_QUEUE_FAILED" });
        return;
      }
      runAfterResponse(processFeasibilityJob(inserted.id, req.log));
      res.status(202).json({ type: "queued", jobId: inserted.id, status: "queued" });
      return;
    }

    const translateTitleSchool = translateTitleSchoolFromReq(
      { headers: req.headers as Record<string, string | string[] | undefined> },
      analyseLocale,
    );
    const result = await runFeasibilityAnalyseCore({
      address,
      analysisAddress,
      geocodeFallbackAddress: sameTitleAlias ? subdivision.geocodeFallbackAddress : null,
      locale: analyseLocale,
      translateTitleSchool,
      conversationHistory: analysisConversationHistory,
      selectedListingUrl,
      selectedListingContext: normalisedSelectedListingContext,
      userId,
      log: req.log,
    });
    // Layer 3: degrade scores in the outbound copy only for flagged abusers
    // (no-op for everyone else; shadow-logs until ABUSE_DEGRADE_ENABLED).
    await protectReport(result.report as Record<string, unknown>, {
      userId,
      addressSeed: normaliseDiscoveryAddressKey(analysisAddress),
    });
    const postAnalysisAnswers = await buildPostAnalysisAnswersForReport(address, result.report, analyseLocale, req.log);
    res.json({
      report: result.report,
      type: "report",
      searchId: result.savedSearchId,
      historyCreatedAt: result.savedSearchCreatedAt,
      ...postAnalysisPayload(postAnalysisAnswers),
      ...deterministicProviderRecommendationPayload(address),
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to analyse property");
    res.status(500).json({
      error: "Failed to generate feasibility report. Please try again.",
      code: "ANALYSE_FAILED",
    });
  }
});

router.get("/analyse/jobs/:jobId", async (req, res) => {
  const jobId = (req.params as { jobId?: string }).jobId;
  const uid = await getUserIdFromHeader(req);
  if (uid === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  if (!jobId) {
    res.status(400).json({ error: "jobId is required", code: "MISSING_JOB_ID" });
    return;
  }
  if (!uid) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }
  try {
    const rows = await withDbRetry(() =>
      db.select().from(feasibilityJobs).where(eq(feasibilityJobs.id, jobId)).limit(1),
    );
    const job = rows[0];
    if (!job || job.userId !== uid) {
      res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      return;
    }
    if (job.status === "pending" || isStaleFeasibilityJob(job)) {
      runAfterResponse(processFeasibilityJob(job.id, req.log));
    }

    if (job.status === "completed" && job.searchId) {
      const searchId = job.searchId;
      const srows = await withDbRetry(() =>
        db
          .select({ resultJson: searches.resultJson, createdAt: searches.createdAt })
          .from(searches)
          .where(eq(searches.id, searchId))
          .limit(1),
      );
      const report = srows[0]?.resultJson as Record<string, unknown> | undefined;
      const historyCreatedAt = srows[0]?.createdAt
        ? new Date(srows[0].createdAt as unknown as string).toISOString()
        : null;
      const isGroup = report?.kind === "combined_listing_group";
      // Layer 3: degrade the outbound copy for flagged abusers (no-op otherwise;
      // the stored search row is untouched). Single-report path only.
      if (!isGroup) {
        await protectReport(report, {
          userId: uid,
          addressSeed: normaliseDiscoveryAddressKey((report?.address as string) ?? job.analysisAddress ?? ""),
        });
      }
      const postAnalysisAnswers = !isGroup && report
        ? await buildPostAnalysisAnswersForReport(job.queryAddress, report, job.locale === "zh" ? "zh" : "en", req.log)
        : [];
      res.json({
        status: job.status,
        searchId: job.searchId,
        historyCreatedAt,
        report: isGroup ? null : (report ?? null),
        reportGroup: isGroup ? report : null,
        ...postAnalysisPayload(postAnalysisAnswers),
        ...deterministicProviderRecommendationPayload(job.queryAddress),
      });
      return;
    }
    res.json({
      status: job.status,
      searchId: job.searchId,
      error: job.error,
    });
  } catch (err) {
    req.log.error({ err }, "GET /analyse/jobs/:jobId failed");
    res.status(500).json({ error: "Failed to load job", code: "JOB_LOAD_FAILED" });
  }
});

// ── POST /analyse/:searchId/refresh-photos ───────────────────────────────────
// Re-runs photo-only scrapers (Trade Me + Hougarden + Homes + AI fallback)
// for an existing search row and merges fresh photoUrls back into resultJson.
// Does NOT re-run the full feasibility analysis (no quota cost, no core scoring
// rerun) — only photo coverage is updated.
//
// Rate-limited to 1 request per searchId per 60s via an in-memory map.
function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function collectSitePlanAddressCandidates(report: Record<string, unknown>, rowAddress: string | null): string[] {
  const candidates: string[] = [];
  const add = (value: unknown) => {
    const text = stringValue(value);
    if (text) candidates.push(text);
  };

  add(report["address"]);
  add(rowAddress);
  const propertyOverview = report["propertyOverview"];
  if (propertyOverview && typeof propertyOverview === "object") {
    add((propertyOverview as Record<string, unknown>)["address"]);
  }

  const childAddresses = report["childAddresses"];
  if (Array.isArray(childAddresses)) {
    childAddresses.forEach(add);
  }

  const childReports = report["reports"];
  if (Array.isArray(childReports)) {
    for (const child of childReports) {
      if (!child || typeof child !== "object") continue;
      const childReport = child as Record<string, unknown>;
      add(childReport["address"]);
      const childOverview = childReport["propertyOverview"];
      if (childOverview && typeof childOverview === "object") {
        add((childOverview as Record<string, unknown>)["address"]);
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter((address) => {
    const key = normaliseDiscoveryAddressKey(address) || address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function resolveSitePlanAddress(
  report: Record<string, unknown>,
  rowAddress: string | null,
  requestedAddress: string | null,
): { address: string | null; forbidden: boolean } {
  const candidates = collectSitePlanAddressCandidates(report, rowAddress);
  if (!requestedAddress) return { address: candidates[0] ?? null, forbidden: false };

  const requestedKey = normaliseDiscoveryAddressKey(requestedAddress) || requestedAddress.toLowerCase();
  const allowed = candidates.some((candidate) => {
    const candidateKey = normaliseDiscoveryAddressKey(candidate) || candidate.toLowerCase();
    return candidateKey === requestedKey;
  });
  return { address: allowed ? requestedAddress : null, forbidden: !allowed };
}

router.get("/analyse/:searchId/site-plan", async (req, res) => {
  const searchId = (req.params as { searchId?: string }).searchId;
  const uid = await getUserIdFromHeader(req);
  if (uid === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  if (!searchId) {
    res.status(400).json({ error: "searchId is required", code: "MISSING_SEARCH_ID" });
    return;
  }
  if (!uid) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }

  try {
    const rows = await withDbRetry(() =>
      db
        .select({ userId: searches.userId, resultJson: searches.resultJson, address: searches.address })
        .from(searches)
        .where(eq(searches.id, searchId))
        .limit(1),
    );
    const row = rows[0];
    if (!row || row.userId !== uid) {
      res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      return;
    }

    const report = (row.resultJson ?? {}) as Record<string, unknown>;
    const requestedAddress = stringValue((req.query as Record<string, unknown>)["address"]);
    const resolved = resolveSitePlanAddress(report, typeof row.address === "string" ? row.address : null, requestedAddress);
    if (resolved.forbidden) {
      res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      return;
    }
    if (!resolved.address) {
      res.status(400).json({ error: "Report has no address for site plan", code: "MISSING_ADDRESS" });
      return;
    }

    const addressKey = normaliseDiscoveryAddressKey(resolved.address);
    const cachedEntry = addressKey ? await getCachedRaw(addressKey) : null;
    // Reuse coordinates the analysis already resolved (the report), so a flaky live re-geocode
    // never blocks the site plan for an already-analyzed property.
    const geoHint = extractReportCoordinates(report);
    const sitePlan = await buildSitePlanForReport(resolved.address, cachedEntry?.rawData ?? null, geoHint);
    res.setHeader("Cache-Control", "private, max-age=900");
    res.json(sitePlan);
  } catch (err) {
    if (err instanceof SitePlanNoLocationError) {
      req.log.warn({ searchId }, "GET /analyse/:searchId/site-plan: no coordinates available");
      res.status(422).json({ error: "Could not locate this property", code: "SITE_PLAN_NO_LOCATION" });
      return;
    }
    req.log.error({ err, searchId }, "GET /analyse/:searchId/site-plan failed");
    res.status(500).json({ error: "Failed to load site plan", code: "SITE_PLAN_FAILED" });
  }
});

/** Best-effort coordinate extraction from a saved report (resultJson). Schemas vary, so probe
 *  the common nestings for a plausible lat/lng pair. */
function extractReportCoordinates(report: Record<string, unknown>): GeoHint | null {
  const candidates: unknown[] = [
    report["geocode"],
    report["coordinates"],
    report["location"],
    report["propertyOverview"],
    report["property"],
    report,
  ];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const o = candidate as Record<string, unknown>;
    const lat = Number(o["lat"] ?? o["latitude"]);
    const lng = Number(o["lng"] ?? o["lon"] ?? o["long"] ?? o["longitude"]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
  }
  return null;
}

// Aerial tile proxy: injects the LINZ Basemaps key server-side so it never reaches the client,
// and lets the app render aerial tiles directly (no `sharp` compositing). Public imagery, so no
// auth — just an IP velocity cap to protect the key's quota. Tiles are heavily client-cached.
router.get(
  "/tiles/aerial/:z/:x/:y",
  ipRateLimit({ name: "aerial-tiles", windowMs: minutes(1), max: 600 }),
  async (req, res) => {
    const params = req.params as { z?: string; x?: string; y?: string };
    const z = Number(params.z);
    const x = Number(params.x);
    const y = Number(params.y);
    if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0) || z > 24) {
      res.status(400).json({ error: "Invalid tile coordinates", code: "BAD_TILE" });
      return;
    }
    try {
      const tile = await fetchAerialTile(z, x, y);
      if (!tile) {
        res.status(502).json({ error: "Aerial tile unavailable", code: "AERIAL_TILE_UNAVAILABLE" });
        return;
      }
      res.setHeader("Content-Type", tile.contentType);
      res.setHeader("Cache-Control", "public, max-age=86400, immutable");
      res.send(tile.body);
    } catch (err) {
      req.log.error({ err, z, x, y }, "GET /tiles/aerial failed");
      res.status(502).json({ error: "Aerial tile unavailable", code: "AERIAL_TILE_UNAVAILABLE" });
    }
  },
);

const refreshPhotosLastRunAt = new Map<string, number>();
const REFRESH_PHOTOS_COOLDOWN_MS = 60_000;

router.post("/analyse/:searchId/refresh-photos", async (req, res) => {
  const searchId = (req.params as { searchId?: string }).searchId;
  const uid = await getUserIdFromHeader(req);
  if (uid === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  if (!searchId) {
    res.status(400).json({ error: "searchId is required", code: "MISSING_SEARCH_ID" });
    return;
  }
  if (!uid) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }

  const now = Date.now();
  const last = refreshPhotosLastRunAt.get(searchId) ?? 0;
  if (now - last < REFRESH_PHOTOS_COOLDOWN_MS) {
    const retryAfterMs = REFRESH_PHOTOS_COOLDOWN_MS - (now - last);
    res
      .status(429)
      .json({ error: "Refresh too frequent — try again in a moment", retryAfterMs, code: "REFRESH_RATE_LIMITED" });
    return;
  }

  try {
    const rows = await withDbRetry(() =>
      db
        .select({ userId: searches.userId, resultJson: searches.resultJson, address: searches.address })
        .from(searches)
        .where(eq(searches.id, searchId))
        .limit(1),
    );
    const row = rows[0];
    if (!row || row.userId !== uid) {
      res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      return;
    }

    const report = (row.resultJson ?? {}) as Record<string, unknown>;
    const reportAddress =
      (typeof report["address"] === "string" && (report["address"] as string)) ||
      (typeof row.address === "string" && row.address) ||
      "";
    if (!reportAddress) {
      res.status(400).json({ error: "Report has no address to re-scrape", code: "MISSING_ADDRESS" });
      return;
    }

    refreshPhotosLastRunAt.set(searchId, now);

    // Run photo-only scrapers in parallel with a hard budget. Lazy-import so
    // this endpoint stays light when not called.
    const { scrapeTradeMePropertyPhotos } = await import("../lib/scrapers/trademe-property");
    const { scrapeHougardenPhotos } = await import("../lib/scrapers/hougarden-photos");
    const { scrapeHomesPhotos } = await import("../lib/scrapers/homes-photos");
    const { scrapeOneRoofPhotos } = await import("../lib/scrapers/oneroof-photos");

    const TIMEOUT_MS = 15_000;
    const withTimeout = <T>(p: Promise<T>, fallback: T): Promise<T> =>
      Promise.race([
        p,
        new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
      ]).catch(() => fallback);

    const [trademe, hougardenPhotos, homesPhotos, oneroofPhotos] = await Promise.all([
      withTimeout(scrapeTradeMePropertyPhotos(reportAddress), { photo_urls: [] as string[], listing_url: null, data_source: "trademe" as const, scraped_at: "" }),
      withTimeout(scrapeHougardenPhotos(reportAddress), { photo_urls: [] as string[], listing_url: null, data_source: "hougarden_photos" as const, scraped_at: "" }),
      withTimeout(scrapeHomesPhotos(reportAddress), { photo_urls: [] as string[], listing_url: null, data_source: "homes_photos" as const, scraped_at: "" }),
      withTimeout(scrapeOneRoofPhotos(reportAddress), { photo_urls: [] as string[], listing_url: null, data_source: "oneroof_photos" as const, scraped_at: "" }),
    ]);

    const existingPhotos: string[] = Array.isArray(report["photoUrls"])
      ? ((report["photoUrls"] as unknown[]).filter((u): u is string => typeof u === "string"))
      : [];
    const selectedListingContext = normaliseSelectedListingContext(report["selectedListingContext"])
      ?? normaliseSelectedListingContext((report["propertyOverview"] as Record<string, unknown> | undefined)?.["selectedListingContext"]);
    const resolvedActiveListing = await withTimeout(
      resolveActiveListingContext(reportAddress, {
        purpose: "feasibility",
        selectedListingContext,
      }),
      { context: selectedListingContext, realestateListing: null },
    );
    const selectedPhotos = selectedListingPhotoUrls(resolvedActiveListing.context ?? selectedListingContext);

    // OneRoof historical photos lead — they're typically higher quality than
    // Trade Me/Hougarden archives and most likely to exist for sold listings.
    const combined = Array.from(new Set([
      ...selectedPhotos,
      ...oneroofPhotos.photo_urls,
      ...trademe.photo_urls,
      ...hougardenPhotos.photo_urls,
      ...homesPhotos.photo_urls,
      ...existingPhotos,
    ].filter(Boolean)));

    const newPhotoUrl = combined[0] ?? (typeof report["photoUrl"] === "string" ? (report["photoUrl"] as string) : null);

    // Merge into resultJson WITHOUT overwriting any other field
    report["photoUrls"] = combined;
    report["photoUrl"] = newPhotoUrl;
    if (resolvedActiveListing.context) {
      applySelectedListingContextToReport(report, resolvedActiveListing.context);
    }

    await withDbRetry(() =>
      db
        .update(searches)
        .set({ resultJson: report as Record<string, unknown> })
        .where(eq(searches.id, searchId)),
    );

    req.log.info({
      searchId,
      address: reportAddress,
      photoSources: {
        activeListing: selectedPhotos.length,
        trademe: trademe.photo_urls.length,
        hougardenPhotos: hougardenPhotos.photo_urls.length,
        homesPhotos: homesPhotos.photo_urls.length,
        oneroofPhotos: oneroofPhotos.photo_urls.length,
      },
      totalAfter: combined.length,
    }, "Refresh photos: complete");

    res.json({
      ok: true,
      photoUrls: combined,
      photoUrl: newPhotoUrl,
      aiFallbackUsed: false,
    });
  } catch (err) {
    req.log.error({ err, searchId }, "POST /analyse/:searchId/refresh-photos failed");
    res.status(500).json({ error: "Failed to refresh photos", code: "REFRESH_FAILED" });
  }
});

// ── POST /translate-report ────────────────────────────────────────────────────
// Accepts a cached FeasibilityReport object and returns it with all narrative
// fields translated to Simplified Chinese. Used by the mobile client to
// retrofit English-language reports that were generated before on-device
// translation was in place.
router.post("/translate-report", async (req, res) => {
  const { report } = req.body as { report?: Record<string, unknown> };
  if (!report || typeof report !== "object") {
    res.status(400).json({ error: "report is required" });
    return;
  }
  try {
    const headerBag = { headers: req.headers as Record<string, string | string[] | undefined> };
    const translateTitleSchool = translateTitleSchoolFromReq(headerBag, localeFromReq(headerBag));
    const translated = await translateReportNarrative(report, { translateTitleAndSchoolFields: translateTitleSchool });
    res.json({ report: translated });
  } catch (err) {
    res.status(500).json({ error: "Translation failed" });
  }
});

router.post(
  "/search",
  // Supports anonymous browsing, so limit by IP only — no auth wall.
  ipRateLimit({ name: "search", windowMs: minutes(1), max: 40 }),
  async (req, res) => {
  const { query, suburb, minPrice, maxPrice } = req.body as {
    query: string;
    suburb?: string;
    minPrice?: number;
    maxPrice?: number;
    criteria?: string;
  };

  if (!query) {
    res.status(400).json({ error: "query is required", code: "MISSING_QUERY" });
    return;
  }

  const userId = await getUserIdFromHeader(req);
  if (userId === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }

  try {
    const raw = await generateSearchResults(query, suburb, minPrice, maxPrice, localeFromReq({ headers: req.headers as Record<string, string | string[] | undefined> }));
    const result = extractJSON(raw) as { suburb: string; candidates: unknown[] };

    if (userId) {
      await db.insert(searches).values({
        userId,
        query,
        address: suburb || null,
        resultJson: result as any,
      }).catch((err) => req.log.error({ err }, "Failed to save search to history"));
    }

    res.json({
      candidates: result.candidates || [],
      suburb: result.suburb || suburb || "",
      query,
      type: "search",
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to search properties");
    res.status(500).json({
      error: "Failed to search properties. Please try again.",
      code: "SEARCH_FAILED",
    });
  }
});

async function checkAndIncrementChatMessages(userId: string): Promise<{
  allowed: boolean;
  messagesUsed: number;
  nearLimit: boolean;
  isFreeLimit: boolean;
  subscriptionRequired?: boolean;
}> {
  const [profile] = await db
    .select({
      messagesUsedThisMonth: profiles.messagesUsedThisMonth,
      lastResetAt: profiles.lastResetAt,
      subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
      subscriptionStatus: profiles.subscriptionStatus,
      stripeSubscriptionId: profiles.stripeSubscriptionId,
      role: profiles.role,
      subscriptionTier: profiles.subscriptionTier,
      createdAt: profiles.createdAt,
      providerTrialStartedAt: profiles.providerTrialStartedAt,
      providerTrialEndsAt: profiles.providerTrialEndsAt,
      specialStatus: profiles.specialStatus,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  if (!profile) return { allowed: true, messagesUsed: 0, nearLimit: false, isFreeLimit: false };

  // Sales agents with an active plan get unlimited AI chat — bypass the limit.
  const [chatAgentRow] = await db
    .select({ listingPlan: salesAgentProfiles.listingPlan, aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt })
    .from(salesAgentProfiles)
    .where(eq(salesAgentProfiles.userId, userId))
    .limit(1);
  if (
    chatAgentRow &&
    agentAiUnlimited(
      { subscriptionStatus: profile.subscriptionStatus, subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt },
      chatAgentRow,
    )
  ) {
    return { allowed: true, messagesUsed: profile.messagesUsedThisMonth, nearLimit: false, isFreeLimit: false };
  }

  const tier = profile.subscriptionTier ?? "free";
  const role = profile.role ?? "general";
  const providerEntitlement = resolveProviderEntitlement(profile);
  const effectiveTier = role === "service_provider" && providerEntitlement.providerAccessActive ? "standard" : tier;
  if (role === "service_provider" && !providerEntitlement.providerAccessActive && tier !== "standard" && tier !== "pro") {
    return { allowed: false, messagesUsed: profile.messagesUsedThisMonth, nearLimit: true, isFreeLimit: false, subscriptionRequired: true };
  }
  const limitKey = resolveChatLimitKey(role, effectiveTier, profile.specialStatus);
  const { limit, warnAt } = CHAT_LIMITS[limitKey] ?? CHAT_LIMITS.default;
  const isFreeLimit = limitKey === "general_free";

  const now = new Date();
  const lastReset = new Date(profile.lastResetAt);
  const periodEnd = profile.subscriptionPeriodEndAt ? new Date(profile.subscriptionPeriodEndAt) : null;
  const periodExpired = usagePeriodExpired(now, lastReset, profile.subscriptionTier, periodEnd);

  let currentCount = periodExpired ? 0 : profile.messagesUsedThisMonth;

  if (periodExpired) {
    await db
      .update(profiles)
      .set({
        messagesUsedThisMonth: 0,
        reportsUsedThisMonth: 0,
        lastResetAt: now,
        subscriptionPeriodEndAt: null,
      })
      .where(eq(profiles.id, userId));
    currentCount = 0;
  }

  if (currentCount >= limit) {
    return { allowed: false, messagesUsed: currentCount, nearLimit: true, isFreeLimit };
  }

  await db
    .update(profiles)
    .set({ messagesUsedThisMonth: sql`${profiles.messagesUsedThisMonth} + 1` })
    .where(eq(profiles.id, userId));

  const newCount = currentCount + 1;
  return {
    allowed: true,
    messagesUsed: newCount,
    nearLimit: newCount >= warnAt,
    isFreeLimit,
  };
}

router.post(
  "/discovery/next",
  // Supports anonymous browsing, so limit by IP only — no auth wall.
  ipRateLimit({ name: "discovery", windowMs: minutes(1), max: 40 }),
  async (req, res) => {
  const requestLocale = localeFromReq({ headers: req.headers as Record<string, string | string[] | undefined> });
  const translateTitleSchool = translateTitleSchoolFromReq(
    { headers: req.headers as Record<string, string | string[] | undefined> },
    requestLocale,
  );
  const sendDiscoveryNextPayload = async (payload: Record<string, unknown>) => {
    if (requestLocale === "zh") {
      const translated = await translateChatContent(JSON.stringify(payload), "discover", requestLocale, translateTitleSchool)
        .catch(() => JSON.stringify(payload));
      try {
        res.json(JSON.parse(translated));
        return;
      } catch {
        // Fall through to raw JSON if translation returns malformed structured content.
      }
    }
    res.json(payload);
  };
  const {
    continuationToken,
    shownCandidates,
    claimCandidates,
    prefetchOnly,
    count: requestedCount,
  } = req.body as {
    continuationToken?: string;
    shownCandidates?: Array<Pick<PropertyCandidate, "address" | "listingUrl">>;
    claimCandidates?: Array<Pick<PropertyCandidate, "address" | "listingUrl">>;
    prefetchOnly?: boolean;
    count?: number;
  };
  const count = Math.max(1, Math.min(6, Number(requestedCount ?? DISCOVERY_CONTINUATION_PAGE_SIZE)));
  if (!continuationToken) {
    res.status(400).json({ error: "continuationToken is required", code: "MISSING_CONTINUATION_TOKEN" });
    return;
  }

  const userId = await getUserIdFromHeader(req);
  if (userId === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  const anonymousIpHash = userId ? null : getIpHash(req as any);
  const anonymousIdentityHash = userId
    ? null
    : getAnonymousInstallHash(req.headers as Record<string, unknown>) ?? anonymousIpHash;
  const ownerKey = continuationOwnerKey(userId, anonymousIdentityHash);

  try {
    const [row] = await withDbRetry(() =>
      db
        .select()
        .from(discoveryContinuations)
        .where(eq(discoveryContinuations.id, continuationToken))
        .limit(1),
    );
    if (!row || row.expiresAt <= new Date()) {
      res.status(410).json({ error: "Discovery continuation expired", code: "CONTINUATION_EXPIRED" });
      return;
    }
    if (row.ownerKey && row.ownerKey !== ownerKey) {
      res.status(403).json({ error: "Discovery continuation belongs to another session", code: "CONTINUATION_FORBIDDEN" });
      return;
    }

    const state = continuationState(row);
    const shownKeys = shownKeysFromCandidates(shownCandidates ?? []);
    const searchPresentation: DiscoverySearchPresentation =
      row.searchPresentation === "generic_listing" ? "generic_listing" : "scored_screening";
    // If this search wanted freehold title screening but the LINZ service is now
    // out of hours, the Show-more cards weren't title-verified — tag them so the
    // client keeps showing the "Title unverified" caveat (consistent with the
    // initial response). In-hours, screenOneFast already set titleStatus.
    const titleScreeningWantedForRow =
      (state.preScreenOpts as { verifyFreeholdTitle?: boolean } | undefined)?.verifyFreeholdTitle === true;
    const markTitleUnverifiedIfOutOfHours = (list: PropertyCandidate[]): void => {
      if (!titleScreeningWantedForRow || isLinzTitleServiceAvailable()) return;
      for (const candidate of list) {
        if (!candidate.titleStatus) candidate.titleStatus = "unverified";
      }
    };
    const recordServedCandidates = (served: Array<Pick<PropertyCandidate, "address" | "listingUrl" | "internalListingId">>) => {
      if (served.length === 0) return;
      const shownItems = served.map((c) => ({
        addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
        listingUrl: c.listingUrl ?? null,
        address: c.address ?? null,
        suburb: row.suburb ?? null,
      }));
      if (userId) {
        runAfterResponse(
          recordShownForUser(userId, shownItems).catch((err) =>
            req.log.warn({ err }, "Discovery continuation: failed to record account-level shown memory"),
          ),
        );
      } else if (anonymousIdentityHash) {
        runAfterResponse(
          recordShownForAnonymous(anonymousIdentityHash, shownItems).catch((err) =>
            req.log.warn({ err }, "Discovery continuation: failed to record anonymous shown memory"),
          ),
        );
      }
    };

    if (Array.isArray(claimCandidates) && claimCandidates.length > 0) {
      const claimKeys = shownKeysFromCandidates(claimCandidates);
      const readyPages = (state.readyPages ?? [])
        .map((page) => ({
          candidates: ((page.candidates ?? []) as PropertyCandidate[]).filter((candidate) => {
            const addressKey = normaliseDiscoveryAddressKey(candidate.address);
            if (addressKey && claimKeys.has(addressKey)) return false;
            if (candidate.listingUrl && claimKeys.has(candidate.listingUrl)) return false;
            return true;
          }),
        }))
        .filter((page) => page.candidates.length > 0);
      await saveContinuationState(row.id, { ...state, readyPages }, row.exhausted);
      recordServedCandidates(claimCandidates);
      runAfterResponse(prefetchContinuationPage(row.id, DISCOVERY_CONTINUATION_PREFETCH_COUNT, req.log).catch((err) =>
        req.log.warn({ err, id: row.id }, "Discovery continuation: claim prefetch failed"),
      ));
      res.json({ ok: true, continuationToken: row.exhausted ? null : row.id });
      return;
    }

    let readyPages = [...(state.readyPages ?? [])];
    let candidates: PropertyCandidate[] = [];

    if (prefetchOnly) {
      const firstReady = readyPages[0]?.candidates as PropertyCandidate[] | undefined;
      if (firstReady?.length) {
        const readyCandidates = filterCandidatesAlreadyShown(firstReady, shownKeys).slice(0, count);
        const responseCandidates = searchPresentation === "generic_listing"
          ? await hydrateGenericListingAgentDetails(readyCandidates, req.log)
          : readyCandidates;
        markTitleUnverifiedIfOutOfHours(responseCandidates);
        await sendDiscoveryNextPayload({
          candidates: responseCandidates,
          continuationToken: row.exhausted ? null : row.id,
          exhausted: row.exhausted,
          searchPresentation,
          suburb: state.currentSuburb ?? row.suburb,
          queueSource: state.queueSource,
        });
        return;
      }
      if (row.exhausted) {
        // Prefer the origin suburb so a fully-drained train's "see again"
        // restarts from where the user began (e.g. Glendowie), not the last
        // nearby suburb. Falls back to current/row suburb for non-train rows.
        const exhaustedSuburb = state.originSuburb ?? state.currentSuburb ?? row.suburb;
        const payload = JSON.parse(buildDiscoveryExhaustedChoicePayload(exhaustedSuburb, searchPresentation)) as { question: string; options: string[]; searchPresentation?: DiscoverySearchPresentation; suburb?: string | null };
        await sendDiscoveryNextPayload({
          candidates: [],
          continuationToken: null,
          exhausted: true,
          clarification: payload,
          searchPresentation,
        });
        return;
      }
      const generated = await generateContinuationCandidates({
        id: row.id,
        presentation: searchPresentation,
        suburb: row.suburb,
        minPrice: row.minPrice,
        maxPrice: row.maxPrice,
        state,
        shownKeys,
        count,
        log: req.log,
      });
      const nextReadyPages = generated.candidates.length > 0 ? [{ candidates: generated.candidates }] : [];
      await saveContinuationState(row.id, { ...generated.state, readyPages: nextReadyPages }, generated.exhausted);
      if (generated.exhausted && generated.candidates.length === 0) {
        // Freshly-discovered exhaustion during prefetch must still carry the
        // "see again / search nearby" choice payload, otherwise the client
        // stores prefetchedExhausted with no clarification and "Show more"
        // renders a silent, button-less message. Mirror the non-prefetch path.
        const exhaustedSuburb = generated.state.originSuburb ?? generated.state.currentSuburb ?? row.suburb;
        const payload = JSON.parse(buildDiscoveryExhaustedChoicePayload(exhaustedSuburb, searchPresentation)) as { question: string; options: string[]; searchPresentation?: DiscoverySearchPresentation; suburb?: string | null };
        await sendDiscoveryNextPayload({
          candidates: [],
          continuationToken: null,
          exhausted: true,
          clarification: payload,
          searchPresentation,
        });
        return;
      }
      markTitleUnverifiedIfOutOfHours(generated.candidates);
      await sendDiscoveryNextPayload({
        candidates: generated.candidates,
        continuationToken: generated.exhausted ? null : row.id,
        exhausted: generated.exhausted,
        searchPresentation,
        suburb: generated.state.currentSuburb ?? row.suburb,
        queueSource: generated.state.queueSource,
      });
      return;
    }

    while (readyPages.length > 0 && candidates.length === 0) {
      const [firstPage, ...restPages] = readyPages;
      const pageCandidates = filterCandidatesAlreadyShown(
        ((firstPage?.candidates ?? []) as PropertyCandidate[]),
        shownKeys,
      );
      candidates = pageCandidates.slice(0, count);
      const leftovers = pageCandidates.slice(count);
      readyPages = leftovers.length > 0
        ? [{ candidates: leftovers }, ...restPages]
        : restPages;
    }

    let nextState: DiscoveryContinuationState = { ...state, readyPages };
    let exhausted = row.exhausted;
    if (candidates.length === 0 && !row.exhausted) {
      const generated = await generateContinuationCandidates({
        id: row.id,
        presentation: searchPresentation,
        suburb: row.suburb,
        minPrice: row.minPrice,
        maxPrice: row.maxPrice,
        state: nextState,
        shownKeys,
        count,
        log: req.log,
      });
      candidates = generated.candidates;
      nextState = { ...generated.state, readyPages: [] };
      exhausted = generated.exhausted;
    }

    const servedAddressKeys = shownKeysFromCandidates(candidates);
    for (const key of servedAddressKeys) shownKeys.add(key);

    if (searchPresentation === "generic_listing" && candidates.length > 0) {
      candidates = await hydrateGenericListingAgentDetails(candidates, req.log);
    }

    await saveContinuationState(row.id, nextState, exhausted);

    if (candidates.length > 0) {
      recordServedCandidates(candidates);
      runAfterResponse(prefetchContinuationPage(row.id, DISCOVERY_CONTINUATION_PREFETCH_COUNT, req.log).catch((err) =>
        req.log.warn({ err, id: row.id }, "Discovery continuation: follow-up prefetch failed"),
      ));
    }

    if (candidates.length === 0) {
      const exhaustedSuburb = nextState.originSuburb ?? nextState.currentSuburb ?? row.suburb;
      const payload = JSON.parse(buildDiscoveryExhaustedChoicePayload(exhaustedSuburb, searchPresentation)) as { question: string; options: string[]; searchPresentation?: DiscoverySearchPresentation; suburb?: string | null };
      await sendDiscoveryNextPayload({
        candidates: [],
        continuationToken: exhausted ? null : row.id,
        exhausted: true,
        clarification: payload,
        searchPresentation,
      });
      return;
    }

    markTitleUnverifiedIfOutOfHours(candidates);
    const directPayload = {
      candidates,
      continuationToken: exhausted ? null : row.id,
      exhausted,
      searchPresentation,
      suburb: nextState.currentSuburb ?? row.suburb,
      queueSource: nextState.queueSource,
    };
    await sendDiscoveryNextPayload(directPayload);
  } catch (err) {
    req.log.error({ err }, "POST /discovery/next failed");
    res.status(500).json({ error: "Could not load more listings", code: "DISCOVERY_NEXT_FAILED" });
  }
});

router.post(
  "/screening/jobs",
  userRateLimit({ name: "screening-jobs", windowMs: minutes(1), max: 12 }),
  async (req, res) => {
    const screeningLocale = localeFromReq({ headers: req.headers as Record<string, string | string[] | undefined> });
    const userId = await getUserIdFromHeader(req);
    if (userId === INVALID_AUTH_SESSION) {
      rejectInvalidAuthSession(res);
      return;
    }
    if (!userId) {
      res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
      return;
    }

    const {
      messages,
      currentReport,
      message,
      conversationHistory,
      reportContext,
      continuePresentation,
      discoveryChoiceSuburb,
    } = (req.body as ScreeningJobRequestPayload["body"] | undefined) ?? {};
    const queryText = (typeof message === "string" && message.trim()) || latestUserMessage(messages) || "Screening search";
    const requestPayload: ScreeningJobRequestPayload = {
      baseUrl: requestApiBase(req),
      headers: {
        "x-locale": headerSingle(req.headers as Record<string, string | string[] | undefined>, "x-locale"),
        "x-os-chinese": headerSingle(req.headers as Record<string, string | string[] | undefined>, "x-os-chinese"),
      },
      body: {
        messages,
        currentReport,
        message,
        conversationHistory,
        reportContext,
        continuePresentation,
        discoveryChoiceSuburb,
      },
    };

    try {
      const rows = await withDbRetry(() =>
        db
          .insert(screeningJobs)
          .values({
            userId,
            status: "pending",
            stage: "queued",
            progress: 0,
            attemptCount: 0,
            deadlineAt: screeningJobDeadline(),
            queryText,
            locale: screeningLocale,
            conversationHistory: messages ?? conversationHistory ?? null,
            requestPayload,
          })
          .returning({ id: screeningJobs.id }),
      );
      const inserted = rows[0];
      if (!inserted?.id) {
        res.status(500).json({ error: "Could not queue background screening.", code: "JOB_QUEUE_FAILED" });
        return;
      }
      runAfterResponse(processScreeningJob(inserted.id, req.log));
      res.status(202).json({ type: "queued", jobId: inserted.id, status: "queued" });
    } catch (err) {
      req.log.error({ err }, "POST /screening/jobs failed");
      res.status(500).json({ error: "Could not queue background screening.", code: "JOB_QUEUE_FAILED" });
    }
  },
);

router.get("/screening/jobs/:jobId", async (req, res) => {
  const jobId = (req.params as { jobId?: string }).jobId;
  const userId = await getUserIdFromHeader(req);
  if (userId === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  if (!jobId) {
    res.status(400).json({ error: "jobId is required", code: "MISSING_JOB_ID" });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Unauthorized", code: "UNAUTHORIZED" });
    return;
  }

  try {
    const rows = await withDbRetry(() =>
      db.select().from(screeningJobs).where(eq(screeningJobs.id, jobId)).limit(1),
    );
    const job = rows[0];
    if (!job || job.userId !== userId) {
      res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
      return;
    }
    if (job.status === "processing" && isStaleScreeningJob(job) && job.attemptCount >= SCREENING_JOB_MAX_ATTEMPTS) {
      await withDbRetry(() =>
        db.update(screeningJobs).set({
          status: "expired",
          stage: "retry_limit_reached",
          progress: 100,
          error: "Screening could not finish after retrying unavailable data sources.",
          updatedAt: new Date(),
        }).where(eq(screeningJobs.id, job.id)),
      );
      job.status = "expired";
      job.stage = "retry_limit_reached";
      job.progress = 100;
      job.error = "Screening could not finish after retrying unavailable data sources.";
    } else if (job.status === "pending" || isStaleScreeningJob(job)) {
      runAfterResponse(processScreeningJob(job.id, req.log));
    }
    res.json({
      status: job.status,
      mode: job.mode,
      result: job.resultJson ?? null,
      error: job.error,
      stage: job.stage,
      progress: job.progress,
      attemptCount: job.attemptCount,
      updatedAt: job.updatedAt,
      deadlineAt: job.deadlineAt,
    });
  } catch (err) {
    req.log.error({ err }, "GET /screening/jobs/:jobId failed");
    res.status(500).json({ error: "Failed to load job", code: "JOB_LOAD_FAILED" });
  }
});

router.post(
  "/chat",
  // Chat has its own monthly quota; this just blunts scripted bursts.
  userRateLimit({ name: "chat", windowMs: minutes(1), max: 20 }),
  async (req, res) => {
  const chatLocale = localeFromReq({ headers: req.headers as Record<string, string | string[] | undefined> });
  const chatTranslateTitleSchool = translateTitleSchoolFromReq(
    { headers: req.headers as Record<string, string | string[] | undefined> },
    chatLocale,
  );
  const { messages, currentReport, message, conversationHistory, reportContext, continuePresentation, discoveryChoiceSuburb } = req.body as {
    messages?: Message[];
    currentReport?: object;
    message?: string;
    conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    reportContext?: string;
    // Set by the mobile "Show more" button — carries the presentation type of the
    // result block it belongs to so we continue that exact presentation regardless
    // of any intervening single-property analyse drill-down.
    continuePresentation?: "generic_listing" | "scored_screening";
    // Set by the exhausted-discovery choice chips ("see again" / "search nearby").
    // Carries the suburb the user is currently browsing so the repeat target /
    // nearby base is authoritative, instead of being re-inferred from the thread
    // (which fails once the conversation has moved on to a nearby suburb).
    discoveryChoiceSuburb?: string;
  };
  const continueGenericListing = continuePresentation === "generic_listing";
  const translateSafeChatContent = async (content: string, mode: string | undefined): Promise<string> => {
    const proseMode = mode !== "analyse" && mode !== "discover" && mode !== "clarification";
    const preSanitized = proseMode ? sanitizeAssistantProse(content, chatLocale) : content;
    const translated = await translateChatContent(preSanitized, mode, chatLocale, chatTranslateTitleSchool);
    return proseMode ? sanitizeAssistantProse(translated, chatLocale) : translated;
  };

  // Rate limiting per authenticated user. Actual limits are tiered and live in
  // ../lib/quotas.ts (CHAT_LIMITS). Keep the mobile mirror in sync.
  const chatUserId = await getUserIdFromHeader(req);
  if (chatUserId === INVALID_AUTH_SESSION) {
    rejectInvalidAuthSession(res);
    return;
  }
  const anonymousIpHash = chatUserId ? null : getIpHash(req as any);
  const anonymousIdentityHash = chatUserId
    ? null
    : getAnonymousInstallHash(req.headers as Record<string, unknown>) ?? anonymousIpHash;
  if (chatUserId) {
    try {
      const { allowed, messagesUsed, nearLimit, isFreeLimit, subscriptionRequired } = await checkAndIncrementChatMessages(chatUserId);
      if (!allowed) {
        if (subscriptionRequired) {
          const baseMessage = "Service provider accounts require an active subscription before using AI chat.";
          const localisedMessage = chatLocale === "zh" ? await ensureChinese(baseMessage) : baseMessage;
          res.status(402).json({
            error: "subscription_required",
            code: "subscription_required",
            messagesUsed,
            message: localisedMessage,
          });
          return;
        }
        const baseMessage = isFreeLimit
          ? "You've used all your free messages in this billing period. Upgrade to Standard for more."
          : "You've reached your monthly message limit. It refreshes when your billing cycle renews.";
        const localisedMessage = chatLocale === "zh" ? await ensureChinese(baseMessage) : baseMessage;
        res.status(429).json({
          error: "monthly_limit_reached",
          code: isFreeLimit ? "upgrade_required" : "monthly_limit_reached",
          messagesUsed,
          message: localisedMessage,
        });
        return;
      }
      // Attach to res.locals so we can surface nearLimit in response if needed
      res.locals.chatMessagesUsed = messagesUsed;
      res.locals.chatNearLimit = nearLimit;
    } catch {
      // Non-fatal — proceed even if rate limit check fails
    }
  }

  if (messages && messages.length > 0) {
    try {
      const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
      const userText = lastUserMessage?.content ?? "";
      const guardedTrustResponse = assistantTrustResponseFor(userText, chatLocale);
      if (guardedTrustResponse) {
        res.json({ content: sanitizeAssistantProse(guardedTrustResponse.content, chatLocale), mode: "text" });
        return;
      }

      // ─── LLM intent extraction ─────────────────────────────────────────────
      // Extract the address/suburb from the currently open report (if any) so
      // the LLM can resolve context references like "this area", "currently", etc.
      let reportCtx: { address?: string | null; suburb?: string | null } | null = null;
      if (currentReport) {
        const r = currentReport as Record<string, unknown>;
        const overview = r["propertyOverview"] as Record<string, unknown> | undefined;
        const addr = (r["address"] as string | null) ?? (overview?.["address"] as string | null) ?? null;
        // Extract suburb from address or pipeline suburb field
        let suburbFromReport = (r["suburb"] as string | null) ?? null;
        if (!suburbFromReport && addr) {
          const hit = await findSuburbInTextViaIndex(addr).catch(() => null);
          if (hit) suburbFromReport = hit.title.toLowerCase();
        }
        reportCtx = { address: addr, suburb: suburbFromReport };
      }

      // Already-shown addresses + URLs from conversation history (for follow-up de-duplication).
      // Two formats are handled:
      // 1. Mobile client: `[Search results shown: address||url; address2||url2]`
      // 2. Legacy/raw JSON: `{"candidates":[{"address":"...","listingUrl":"..."}]}`
      // Parsing both ensures deduplication survives server restarts and works across
      // all client versions — no extra storage needed.
      const alreadyShownFromHistory: string[] = [];
      const alreadyShownUrlsFromHistory: string[] = [];
      for (const msg of messages) {
        if (msg.role !== "assistant" || !msg.content) continue;
        const trimmed = msg.content.trim();

        // Mobile client report marker: [Feasibility report for address]
        const reportShownMatch = trimmed.match(/^\[Feasibility report for (.+)\]$/s);
        if (reportShownMatch) {
          const reportAddress = reportShownMatch[1].trim();
          if (reportAddress && reportAddress.toLowerCase() !== "property") {
            alreadyShownFromHistory.push(reportAddress);
          }
          continue;
        }

        // Mobile client format: [Search results shown: addr1||url1; addr2||url2]
        const searchShownMatch = trimmed.match(/^\[Search results shown: (.+)\]$/s);
        if (searchShownMatch) {
          const entries = searchShownMatch[1].split(";").map((s) => s.trim()).filter(Boolean);
          for (const entry of entries) {
            const sepIdx = entry.indexOf("||");
            if (sepIdx !== -1) {
              const addr = entry.slice(0, sepIdx).trim();
              const url = entry.slice(sepIdx + 2).trim();
              if (addr) alreadyShownFromHistory.push(addr);
              if (url) alreadyShownUrlsFromHistory.push(url);
            } else {
              // Older client format without URL — still capture address
              if (entry) alreadyShownFromHistory.push(entry);
            }
          }
          continue;
        }

        // Legacy raw-JSON format
        if (!trimmed.startsWith("{")) continue;
        try {
          const parsed = JSON.parse(trimmed) as { candidates?: Array<{ address?: unknown; listingUrl?: unknown }> };
          if (Array.isArray(parsed.candidates)) {
            for (const c of parsed.candidates) {
              if (typeof c.address === "string" && c.address) alreadyShownFromHistory.push(c.address);
              if (typeof c.listingUrl === "string" && c.listingUrl) alreadyShownUrlsFromHistory.push(c.listingUrl);
            }
          }
        } catch { /* not JSON, skip */ }
      }
      if (reportCtx?.address) alreadyShownFromHistory.push(reportCtx.address);
      const alreadyShownAddressKeys = new Set(
        alreadyShownFromHistory
          .map((address) => normaliseDiscoveryAddressKey(address))
          .filter((key) => key.length > 0),
      );
      const repeatShownAreaIntent = isRepeatShownAreaRequest(userText);
      const forceNearbyDiscovery = isNearbyDiscoveryChoice(userText);
      // Deterministic tenure opt-in from the "Show the N cross-lease" chip.
      const includeTenuresChoice = parseIncludeTenuresChoice(userText);
      const pastedListingResolution = await resolvePastedPropertyListing(userText, req.log);

      const intent = await extractChatIntent(messages, reportCtx, alreadyShownFromHistory, chatLocale);
      const semanticWantsDiscovery = intent.execution === "show_listing_cards" || intent.intentCategory === "property_discovery";
      const semanticWantsAnalysis =
        pastedListingResolution.status === "resolved" ||
        intent.execution === "run_feasibility_report" ||
        intent.intentCategory === "single_property_analysis";
      const mode =
        semanticWantsDiscovery ? "discover"
        : semanticWantsAnalysis ? "analyse"
        : intent.execution === "answer_in_chat" ? "followup"
        : intent.mode;

      const deterministicProviderIntent = detectProviderRecommendationIntent(userText);
      const wantsProviderRecommendation =
        intent.wantsProviderRecommendation || deterministicProviderIntent.wantsProviderRecommendation;
      const wantsAnotherProvider =
        intent.wantsAnotherProvider || deterministicProviderIntent.wantsAnotherProvider;
      const suggestedProviderDiscipline =
        intent.suggestedDiscipline ?? deterministicProviderIntent.suggestedDiscipline;

      // Provider recommendation signal derived from both semantic intent and
      // deterministic follow-up phrases. Included in every response so the
      // client can trigger the explicit check without relying on client-side
      // keyword matching.
      const providerSignal = {
        ...(wantsProviderRecommendation ? { wantsProviderRecommendation: true, suggestedDiscipline: suggestedProviderDiscipline ?? null } : {}),
        ...(wantsAnotherProvider ? { wantsAnotherProvider: true } : {}),
      };
      const latestAssistantText = [...messages].reverse().find((m) => m.role === "assistant")?.content ?? "";
      const recentAssistantAskedForSearchArea =
        /(suburb|area|neighbou?rhood|where should|which.+search|区域|郊区|哪个区|哪個區|地方|哪里|哪裡)/i.test(latestAssistantText);
      const shouldResolveDelegatedDiscover =
        !intent.suburb && (semanticWantsDiscovery || (intent.needsClarification && mode === "discover") || (recentAssistantAskedForSearchArea && semanticWantsDiscovery));
      const delegatedDiscoverSuburb = shouldResolveDelegatedDiscover
        ? await resolveDelegatedDiscoverSuburb(messages, userText, chatLocale).catch((err) => {
            req.log.warn({ err, sample: userText.slice(0, 80) }, "Delegated suburb resolution failed");
            return null;
          })
        : null;
      if (delegatedDiscoverSuburb) {
        req.log.info(
          {
            suburb: delegatedDiscoverSuburb.suburb,
            candidates: delegatedDiscoverSuburb.candidates,
            source: delegatedDiscoverSuburb.source,
            reasoning: delegatedDiscoverSuburb.reasoning,
          },
          "Discovery: user delegated suburb choice",
        );
      }
      const contextSuburb =
        intent.suburb ?? delegatedDiscoverSuburb?.suburb ?? reportCtx?.suburb ?? (await inferSuburbFromThread(messages, userText));
      const contextualBareAddress = await inferAddressFromBareStreetNumber(
        messages,
        userText,
        contextSuburb,
      );
      const hintedAddressRaw = looksLikeStreetAddress(userText)
        ? await extractNZAddress(userText).catch(() => null)
        : contextualBareAddress;
      const hintedAddress = appendContextSuburbIfSameStreet(
        hintedAddressRaw,
        messages,
        userText,
        contextSuburb,
      );

      // ─── Address hallucination guard ─────────────────────────────────────
      // When the LLM "corrects" a suburb the user typed (e.g. "melons bay" →
      // "Mission Bay"), the entire pipeline analyses the wrong property. We
      // detect this by checking whether the multi-word tokens in the
      // LLM-extracted address actually appear in the user's original text. If
      // the LLM introduced a suburb the user never mentioned, fall back to the
      // regex-extracted address or the raw user text.
      let validatedIntentAddress = intent.address;
      if (validatedIntentAddress && userText) {
        const userLower = userText.toLowerCase();
        const extractedLower = validatedIntentAddress.toLowerCase();
        // Pull suburb-like multi-word segments from the extracted address
        // (everything after the street number + street name + street type).
        const suburMatch = extractedLower.match(
          /,\s*([a-z][a-z ]+)/,
        );
        if (suburMatch) {
          const extractedSuburb = suburMatch[1].trim();
          // Check each multi-word suburb token against the user's raw input.
          // Allow for minor typos by checking if at least the first 5 chars
          // of the suburb appear somewhere in the user text.
          const suburbPrefix = extractedSuburb.slice(0, Math.min(5, extractedSuburb.length));
          if (
            !userLower.includes(extractedSuburb) &&
            !userLower.includes(suburbPrefix)
          ) {
            req.log.warn(
              { llmAddress: validatedIntentAddress, extractedSuburb, userText: userText.slice(0, 120) },
              "Address hallucination detected: LLM suburb not found in user text — falling back to regex/raw address",
            );
            validatedIntentAddress = null;
          }
        }
      }

      const forcedAnalyseAddressRaw =
        pastedListingResolution.status === "resolved"
          ? pastedListingResolution.address
          : validatedIntentAddress ?? hintedAddress ?? null;
      const suppressPromoteToAnalyse =
        pastedListingResolution.status !== "resolved" &&
        isListingBrowseIntent(userText) &&
        !hasNumberedStreetAddress(userText);
      const forcedAnalyseAddress = suppressPromoteToAnalyse ? null : forcedAnalyseAddressRaw;

      let effectiveMode =
        pastedListingResolution.status === "resolved"
          ? "analyse"
          :
        forcedAnalyseAddress && semanticWantsAnalysis && (mode === "discover" || (mode === "followup" && (contextualBareAddress || looksLikeStreetAddress(userText))))
          ? "analyse"
          : mode;
      // Deterministic non-freehold opt-in: when the prior assistant turn offered to
      // include excluded cross-lease/leasehold/unit-title listings and the user
      // replies with a bare affirmation, accept that offer (independent of the LLM's
      // includeTenures parse) and re-run the prior subdivision discovery with those
      // tenures included.
      const offeredTenures: Tenure[] = includeTenuresChoice
        ? includeTenuresChoice
        : isBareTenureAffirmation(userText)
          ? findRecentOfferedTenures(messages)
          : [];
      const affirmingTenureOffer = offeredTenures.length > 0;
      if (delegatedDiscoverSuburb && effectiveMode !== "analyse") {
        effectiveMode = "discover";
      }
      if (
        effectiveMode === "followup"
        && semanticWantsDiscovery
        && !hasNumberedStreetAddress(userText)
        && (
          detectMode(userText) === "discover" ||
          isListingBrowseIntent(userText) ||
          isContextualAreaBrowseFollowup(userText) ||
          isDiscoverStreetContinuation(userText)
        )
      ) {
        req.log.info({ sample: userText.slice(0, 100) }, "Chat routing: listing browse follow-up — using discover flow");
        effectiveMode = "discover";
      }
      if (
        effectiveMode !== "analyse"
        && !hasNumberedStreetAddress(userText)
        && (repeatShownAreaIntent || forceNearbyDiscovery)
      ) {
        req.log.info({ repeatShownAreaIntent, forceNearbyDiscovery }, "Chat routing: exhausted discovery choice - using discover flow");
        effectiveMode = "discover";
      }
      const analysisIsLikelyAreaOnly =
        !hasNumberedStreetAddress(userText)
        && (isListingBrowseIntent(userText) || hasUnnumberedStreetLine(userText))
        && !/\b(re-?analy[sz]e|redo|run again|analy[sz]e again|new analysis|re-?run|fresh analysis)\b/i.test(userText);
      if (effectiveMode === "analyse" && analysisIsLikelyAreaOnly) {
        req.log.info({ sample: userText.slice(0, 100) }, "Chat routing: area/listing query — using discover flow");
        effectiveMode = "discover";
      }
      // Accepting the "include the ones I left out" tenure offer must re-run the
      // discovery, not fall through to a prose reply that repeats "couldn't find".
      if (affirmingTenureOffer && effectiveMode !== "discover" && !hasNumberedStreetAddress(userText)) {
        req.log.info({ offeredTenures }, "Chat routing: tenure-inclusion affirmation — using discover flow");
        effectiveMode = "discover";
      }
      // Intent correction toward subdivision/development ("I mean that is
      // subdividable") inside a discovery thread: re-run discovery rather than
      // answering as prose about an open single-property report. Guarded by
      // threadHasRecentAreaDiscovery so "is this subdividable?" on a report thread
      // is never hijacked.
      if (
        effectiveMode !== "discover"
        && !hasNumberedStreetAddress(userText)
        && (isStandardSubdivisionDiscoveryIntent(userText) || isDevelopmentDiscoveryIntent(userText))
        && threadHasRecentAreaDiscovery(messages)
      ) {
        req.log.info({ sample: userText.slice(0, 100) }, "Chat routing: subdivision intent correction — using discover flow");
        effectiveMode = "discover";
      }
      // Explicit "Show more" button continuation: always run the discover flow so a
      // current report (from an analyse drill-down) can't capture it into followup
      // mode and expand the report instead of showing more cards.
      if (continuePresentation && effectiveMode !== "discover" && !hasNumberedStreetAddress(userText)) {
        req.log.info({ continuePresentation }, "Chat routing: Show more button — forcing discover flow to continue presentation");
        effectiveMode = "discover";
      }

      // Suburb (or other short) correction to a just-offered subdivision
      // sub-lot choice — e.g. the user replies "Birkenhead" after being asked
      // to pick between "4A Inglis Street, Mosgiel" / "4B Inglis Street,
      // Mosgiel". Takes priority over every discover-leaning override above:
      // this is never a fresh browse request, it's a correction to the
      // address the user already started giving us.
      const pendingSubdivisionCorrection = detectPendingSubdivisionCorrection(messages, userText);
      if (pendingSubdivisionCorrection) {
        req.log.info(
          { mergedAddress: pendingSubdivisionCorrection.mergedAddress, previousMode: effectiveMode },
          "Chat routing: suburb correction after subdivision clarification — forcing analyse flow",
        );
        effectiveMode = "analyse";
      }

      if (effectiveMode === "analyse" && mode !== "analyse" && forcedAnalyseAddress) {
        req.log.info(
          { address: forcedAnalyseAddress, originalMode: mode, intent_reasoning: intent.reasoning },
          "Address-like prompt detected — overriding discover intent to analyse",
        );
      }

      const wantsNearbyAmenities =
        detectNearbyAmenityIntent(userText) ||
        intent.execution === "answer_nearby_amenities" ||
        intent.intentCategory === "nearby_amenity_lookup";
      const directNearbyAmenityLookup = wantsNearbyAmenities && !hasExplicitAnalysisRequestText(userText);
      if (directNearbyAmenityLookup) {
        if (!chatUserId && anonymousIdentityHash) {
          try {
            const usage = await checkAndRecordAnonymousUsage({
              installHash: anonymousIdentityHash,
              ipHash: anonymousIpHash,
              eventType: "chat",
            });
            if (!usage.allowed) {
              const baseMessage = "You've reached today's guest search limit. Create a free account to keep searching.";
              const message = chatLocale === "zh" ? await ensureChinese(baseMessage) : baseMessage;
              res.status(429).json({
                error: message,
                code: "GUEST_LIMIT_REACHED",
                message,
                limit: usage.limit,
                used: usage.used,
              });
              return;
            }
          } catch (err) {
            req.log.warn({ err }, "Guest usage limit check failed");
          }
        }

        const amenityAddressCandidate = validatedIntentAddress ?? hintedAddress ?? null;
        try {
          const answer = await buildNearbyAmenitiesAnswer({
            message: userText,
            report: currentReport as Record<string, unknown> | null | undefined,
            addressCandidate: amenityAddressCandidate,
            semanticTerms: intent.nearbyAmenityTerms,
            locale: chatLocale,
            log: req.log,
          });
          if (answer) {
            const translated = await translateSafeChatContent(answer, "text");
            res.json({
              content: translated,
              mode: "text",
              intent: { intentCategory: "nearby_amenity_lookup" },
              ...providerSignal,
            });
            return;
          }
        } catch (err) {
          req.log.warn({ err, sample: userText.slice(0, 120) }, "Nearby amenities lookup failed");
        }

        const clarification = nearbyAmenityClarification(amenityAddressCandidate, chatLocale);
        const translated = await translateSafeChatContent(clarification, "clarification");
        res.json({
          content: translated,
          mode: "clarification",
          intent: { needsClarification: true, intentCategory: "nearby_amenity_lookup" },
          ...providerSignal,
        });
        return;
      }

      if (
        (pastedListingResolution.status === "unsupported" || pastedListingResolution.status === "unresolved") &&
        !forcedAnalyseAddress &&
        !hasNumberedStreetAddress(userText) &&
        !looksLikeStreetAddress(userText)
      ) {
        res.json({
          content: addressPromptForUnresolvedUrl(chatLocale),
          mode: "text",
          ...providerSignal,
        });
        return;
      }

      if (effectiveMode === "analyse" && !chatUserId) {
        await rejectAuthRequired(res, chatLocale);
        return;
      }

      if (!chatUserId && anonymousIdentityHash) {
        try {
          const usage = await checkAndRecordAnonymousUsage({
            installHash: anonymousIdentityHash,
            ipHash: anonymousIpHash,
            eventType: "chat",
          });
          if (!usage.allowed) {
            const baseMessage = "You've reached today's guest search limit. Create a free account to keep searching.";
            const message = chatLocale === "zh" ? await ensureChinese(baseMessage) : baseMessage;
            res.status(429).json({
              error: message,
              code: "GUEST_LIMIT_REACHED",
              message,
              limit: usage.limit,
              used: usage.used,
            });
            return;
          }
        } catch (err) {
          req.log.warn({ err }, "Guest usage limit check failed");
        }
      }

      const recentSalesText = recentSalesConversationText(messages, userText);
      const latestWantsRecentSales = detectRecentSalesIntent(userText);
      const continuesRecentSales = !latestWantsRecentSales && detectRecentSalesIntent(recentSalesText) && isRecentSalesContinuationText(userText);
      const wantsRecentSales =
        intent.execution === "show_recent_sales_table" ||
        intent.intentCategory === "recent_sales_lookup" ||
        latestWantsRecentSales ||
        continuesRecentSales;
      if (wantsRecentSales) {
        const location = await resolveRecentSalesLocationFromContext({
          messages,
          userText,
          intent,
          reportCtx,
          discoveryChoiceSuburb,
        });
        if (!location) {
          const question = "Which suburb, district, or region should I search for recent sold records?";
          const translated = await translateSafeChatContent(question, "clarification");
          res.json({
            content: translated,
            mode: "clarification",
            intent: { needsClarification: true, intentCategory: "recent_sales_lookup" },
            ...providerSignal,
          });
          return;
        }

        try {
          const query = buildRecentSalesQuery(location, recentSalesText);
          const salesResult = await fetchRecentSales(query);
          salesResult.records = await enrichRecentSalesRecordsFromCache(salesResult.records);
          const table = renderRecentSalesTable(salesResult);
          const translated = await translateSafeChatContent(table, "text");
          res.json({
            content: translated,
            mode: "text",
            intent: { intentCategory: "recent_sales_lookup", source: salesResult.source, fallbackUsed: salesResult.fallbackUsed },
            ...providerSignal,
          });
          return;
        } catch (err) {
          req.log.warn({ err, location }, "Recent sales lookup failed");
          const fallbackText = "I could not retrieve recent sold records right now. Please try again in a moment, or widen the suburb/time filter.";
          const translated = await translateSafeChatContent(fallbackText, "text");
          res.json({ content: translated, mode: "text", ...providerSignal });
          return;
        }
      }

      if (
        effectiveMode !== "analyse"
        && hasNonStandardSalePropertyReference(userText)
        && !forcedAnalyseAddress
      ) {
        const nearbySuburb =
          intent.suburb
          ?? await inferLikelySuburbForUnresolvedProperty(userText).catch(() => null);
        req.log.info(
          { sample: userText.slice(0, 100), nearbySuburb },
          "Chat routing: unresolved non-standard property label - returning unavailable topic prompt",
        );
        res.json({
          content: unavailablePropertyTopicReply(userText, nearbySuburb, chatLocale),
          mode: "text",
          intent: { unavailableProperty: true, suggestedSuburb: nearbySuburb },
          ...providerSignal,
        });
        return;
      }

      // ─── CLARIFICATION LOOP ─────────────────────────────────────────────────
      // When the LLM determines it can't proceed without more info (e.g. no suburb
      // for a discover search), return the clarification question immediately.
      // The next user reply will carry the answer in conversation history so the
      // intent extractor can resolve the suburb/price/address and proceed normally.
      // A "Search nearby"/"see again" choice chip already carries the base suburb
      // in discoveryChoiceSuburb, so we must NOT fall into the "Which suburb?"
      // clarification — the discover flow below seeds `suburb` from it and
      // auto-resolves nearby suburbs without asking.
      const choiceSuppliedSuburb =
        (forceNearbyDiscovery || repeatShownAreaIntent || Boolean(includeTenuresChoice)) && Boolean(discoveryChoiceSuburb?.trim());
      if (intent.needsClarification && intent.clarificationQuestion && effectiveMode !== "analyse" && !delegatedDiscoverSuburb && !choiceSuppliedSuburb) {
        req.log.info(
          { question: intent.clarificationQuestion, intent_reasoning: intent.reasoning },
          "Returning clarification question to user",
        );
        const translatedQuestion = await translateChatContent(intent.clarificationQuestion, "clarification", chatLocale, chatTranslateTitleSchool);
        res.json({
          content: translatedQuestion,
          mode: "clarification",
          intent: { needsClarification: true },
          ...providerSignal,
        });
        return;
      }

      // ─── SINGLE-PROPERTY VALUE LOOKUP (Q4) ───────────────────────────────
      // "What's the estimated market value / land area / zone of this property?"
      // is answered instantly from the cached analysis of the OPEN report — no
      // full re-run — with source + data age. Falls through to the normal chat
      // reply on a cache miss (which can run the pipeline and self-heal).
      if (effectiveMode === "followup" && reportCtx?.address) {
        const lookupField = detectPropertyDataLookup(userText);
        if (lookupField) {
          try {
            const cachedForLookup = await getCachedRaw(normaliseDiscoveryAddressKey(reportCtx.address));
            const answer = cachedForLookup
              ? buildPropertyDataLookupAnswer(lookupField, cachedForLookup.rawData, cachedForLookup.ageDays, reportCtx.address, chatLocale)
              : null;
            if (answer) {
              req.log.info({ field: lookupField, address: reportCtx.address }, "Value lookup: answered from cache");
              res.json({ content: answer, mode: "text", ...providerSignal });
              return;
            }
          } catch (err) {
            req.log.warn({ err }, "Value lookup failed — falling through to chat reply");
          }
        }
      }

      if (effectiveMode === "discover") {
        try {
          let recentShownEntries: RecentShownListing[] = [];
          // Keys/urls seeded specifically from the durable 30-day shown memory,
          // tracked apart from conversation-history keys so a brand-new chat that
          // dead-ends can tell "you've already seen everything here" from "nothing
          // matches here" and reset just the cross-chat memory (see fresh-chat
          // re-show below).
          const durableShownKeys = { addressKeys: new Set<string>(), urls: new Set<string>() };
          // A brand-new chat (the "+New" button) sends no prior assistant turns.
          // The user expects "+New" to be a clean slate, so a fresh conversation
          // ignores the account-level shown memory (and the in-memory shown URLs
          // below) and re-shows the suburb from the top. Continuing inside an
          // existing chat still seeds the memory so Show-more never repeats.
          const isFreshConversation = !(messages ?? []).some((m) => m.role === "assistant");
          const resetShownThisTurn = repeatShownAreaIntent || isFreshConversation;
          // ─── Account-level shown memory (30-day) ─────────────────────────
          // Seed the per-conversation dedup set with everything this account has
          // already been shown in the last 30 days, so a CONTINUING conversation
          // asking the same thing ("subdivision in St Heliers") continues with
          // unshown listings instead of restarting from property #1. Skipped on a
          // fresh "+New" chat (resetShownThisTurn) so it starts clean.
          if (chatUserId && !resetShownThisTurn) {
            try {
              const persisted = await getRecentShownForUser(chatUserId);
              recentShownEntries = persisted.entries;
              for (const k of persisted.addressKeys) { alreadyShownAddressKeys.add(k); durableShownKeys.addressKeys.add(k); }
              for (const u of persisted.urls) { alreadyShownUrlsFromHistory.push(u); durableShownKeys.urls.add(u); }
              if (persisted.addressKeys.length || persisted.urls.length) {
                req.log.info(
                  { keys: persisted.addressKeys.length, urls: persisted.urls.length },
                  "Discovery: seeded dedup set from account-level shown memory",
                );
              }
            } catch (err) {
              req.log.warn({ err }, "Discovery: failed to load account-level shown memory");
            }
          } else if (!chatUserId && anonymousIdentityHash && !resetShownThisTurn) {
            try {
              const persisted = await getRecentShownForAnonymous(anonymousIdentityHash);
              recentShownEntries = persisted.entries;
              for (const k of persisted.addressKeys) { alreadyShownAddressKeys.add(k); durableShownKeys.addressKeys.add(k); }
              for (const u of persisted.urls) { alreadyShownUrlsFromHistory.push(u); durableShownKeys.urls.add(u); }
              if (persisted.addressKeys.length || persisted.urls.length) {
                req.log.info(
                  { keys: persisted.addressKeys.length, urls: persisted.urls.length },
                  "Discovery: seeded dedup set from anonymous shown memory",
                );
              }
            } catch (err) {
              req.log.warn({ err }, "Discovery: failed to load anonymous shown memory");
            }
          }

          // ─── DISCOVER FLOW — using LLM-extracted intent ──────────────────
          // All parameters come from the intent object. Suburb may have been
          // inferred from the current report context when absent from the message.
          const contextualAreaBrowse = isContextualAreaBrowseFollowup(userText);
          let suburb = intent.suburb ?? delegatedDiscoverSuburb?.suburb ?? (contextualAreaBrowse ? reportCtx?.suburb ?? null : null);
          let discoveryPromptText = userText;
          // Exhausted-choice chips carry the suburb the user is actually browsing.
          // For "see again" / "search nearby" it is authoritative — use it as the
          // repeat target / nearby base so the conversation evolves (Glendowie →
          // Meadowbank → next) instead of snapping back to the original suburb.
          if ((repeatShownAreaIntent || forceNearbyDiscovery || includeTenuresChoice) && discoveryChoiceSuburb?.trim()) {
            suburb = discoveryChoiceSuburb.trim().toLowerCase();
          }
          const isFollowUp = intent.isFollowUp || contextualAreaBrowse || isDiscoverStreetContinuation(userText) || repeatShownAreaIntent || forceNearbyDiscovery;
          const discoveryCriteria = buildDiscoveryCriteriaText(messages, userText, intent.criteria);
          const searchPresentation = resolveDiscoveryPresentation({
            userText,
            discoveryCriteria,
            intent,
            messages,
            isFollowUp,
            continuePresentation,
            repeatShownAreaIntent,
            forceNearbyDiscovery,
          });
          // resolveDiscoveryPresentation already accounts for the "Show more"
          // button (continuePresentation), exhausted-result repeat/nearby choices,
          // typed continuations, and ambiguous follow-ups (inheriting the last
          // substantive search's presentation), so its result is the single source
          // of truth here.
          const plainListingBrowse = searchPresentation === "generic_listing";
          const wantsDevelopmentDiscovery = !plainListingBrowse && isDevelopmentDiscoveryIntent(discoveryCriteria);
          const includeNegotiation = intent.includeNegotiation || wantsDevelopmentDiscovery;
          const userTextHasPrice = intent.minPrice !== null || intent.maxPrice !== null;

          if (!suburb) {
            const hit = await findLocationInTextViaIndex(userText);
            if (hit?.status === "suburb") suburb = hit.suburb.title.toLowerCase();
            else if (hit?.status === "district") suburb = hit.district.title.toLowerCase();
            else if (hit?.status === "region") suburb = hit.region.title.toLowerCase();
          }
          // Directional / "central" area terms (EN + zh) are Auckland-context by
          // default. Resolve them to Auckland districts so we never fall back to
          // a NZ-wide keyword search (which surfaced Te Puke / Tawa for "central").
          if (!suburb) {
            const directional = detectDirectionalAreaTerm(userText);
            if (directional) {
              suburb = directional;
              req.log.info({ directional }, "Discovery: resolved directional area term to Auckland context");
            }
          }
          if (!suburb && isFollowUp && reportCtx?.suburb) {
            suburb = reportCtx.suburb.toLowerCase().trim();
          }

          // Default price range if LLM found no price constraint. Development
          // searches must scan high-value suburbs without a normal buyer-budget cap.
          const DEFAULT_MAX = wantsDevelopmentDiscovery ? 20_000_000 : 3_000_000;
          const DEFAULT_SPAN = wantsDevelopmentDiscovery ? DEFAULT_MAX : 1_500_000;
          let effectiveMinPrice = intent.minPrice ?? Math.max(0, (intent.maxPrice ?? DEFAULT_MAX) - DEFAULT_SPAN);
          let effectiveMaxPrice = intent.maxPrice ?? DEFAULT_MAX;
          // If the LLM didn't find a suburb, scan history messages with fast regex
          // (covers follow-ups like "show more" where no suburb is mentioned)
          if (!suburb && isFollowUp) {
            for (const msg of [...messages].reverse()) {
              if (msg.role === "user" && msg.content !== userText) {
                const { suburb: prevSuburb, minPrice: prevMin, maxPrice: prevMax } = await parseDiscoverParams(msg.content ?? "");
                if (prevSuburb) {
                  suburb = prevSuburb;
                  if (!userTextHasPrice) {
                    effectiveMinPrice = prevMin;
                    effectiveMaxPrice = prevMax;
                  }
                  break;
                }
              }
            }
          }

          const suburbResolution = await resolveDiscoverySuburbName(suburb, chatLocale, userText);
          if (suburbResolution?.status === "invalid") {
            req.log.info({ suburb, sample: userText.slice(0, 100) }, "Discovery: invalid suburb rejected before listing search");
            res.json({ content: suburbResolution.message, mode: "text", ...providerSignal });
            return;
          }
          if (suburbResolution?.status === "valid") {
            if (suburbResolution.original) {
              discoveryPromptText = replaceFirstInsensitive(userText, suburbResolution.original, titleCaseSuburb(suburbResolution.suburb));
              req.log.info(
                { original: suburbResolution.original, normalized: suburbResolution.suburb },
                "Discovery: normalized suburb before listing search",
              );
            }
            suburb = suburbResolution.suburb;
          }

          req.log.info({ suburb, effectiveMinPrice, effectiveMaxPrice, isFollowUp, includeNegotiation, wantsDevelopmentDiscovery, intent_reasoning: intent.reasoning }, "Discovery search started");

          // ─── CRITERIA SEARCH (reverse-engineering) ───────────────────────
          // When the user's criteria carry structured measurable constraints
          // (lots / slope / pipes / return), answer from the analysed-property
          // feature index — ONE card at a time — instead of the live browse. Only
          // MEASURED facts are surfaced, so we never assert an unverified physical
          // claim. Pagination reuses the same shown memory as the rest of
          // discovery: each shown card is recorded, so "show me another" advances.
          //
          // Criteria queries usually omit the suburb, so the actual search runs a
          // turn LATER on the suburb reply ("都可以" / a suburb name), which no
          // longer states the criteria. Recover the filterSpec from the recent
          // conversation so the clarification round-trip (and a bare "show me
          // another") still runs the criteria search rather than a plain browse.
          //
          // When the index has no match but the ask is lot-count-only, the LIVE
          // screening below can serve it (potentialLots is computed live): fall
          // through with this floor and post-filter the screened candidates.
          let criteriaLotsFloor: number | null = null;
          // Belt-and-braces: the LLM sometimes omits filterSpec even when the
          // message plainly states measurable criteria ("回报大于 7%"). The
          // deterministic regex runs on the CURRENT message as a guarantee —
          // without it, a criteria query silently degrades into a generic
          // subdivision screening, which contradicts what the user asked.
          let effectiveFilterSpec = intent.filterSpec ?? detectFilterSpecFromText(userText);
          // Only recover from history on a genuine continuation (answering the
          // suburb clarification, or "show me another") — never hijack a fresh
          // unrelated browse that happens to follow an earlier criteria search.
          if (!effectiveFilterSpec && (isFollowUp || Boolean(delegatedDiscoverSuburb))) {
            let seenUserTurns = 0;
            for (let i = messages.length - 1; i >= 0 && seenUserTurns < 3; i--) {
              const m = messages[i];
              if (m.role !== "user" || m.content === userText) continue;
              seenUserTurns++;
              const recovered = detectFilterSpecFromText(m.content ?? "");
              if (recovered) {
                effectiveFilterSpec = recovered;
                break;
              }
            }
          }
          const criteriaSpec = effectiveFilterSpec;
          if (criteriaSpec) {
            try {
              // "Anywhere" (a delegated suburb choice) searches the WHOLE analysed
              // index; otherwise scope to the named suburb(s). A named entry may be
              // a DISTRICT/CITY or a whole REGION ("hamilton", "waikato") rather
              // than a leaf suburb — resolveDiscoverySuburbName above accepts
              // those but passes the literal name through unexpanded, and no
              // analysed property's indexed suburb is ever a district/region
              // name. Expand each entry to its leaf-suburb names via the
              // realestate.co.nz directory (ALL NZ regions), falling back to the
              // static Auckland district map, then to the literal string.
              const criteriaLocationEntries = delegatedDiscoverSuburb
                ? []
                : [suburb, ...(intent.additionalSuburbs ?? [])]
                    .filter((s): s is string => !!s && s.trim().length > 0)
                    .map((s) => s.trim().toLowerCase());
              const criteriaSuburbs: string[] = [];
              for (const entry of criteriaLocationEntries) {
                const expansion = await resolveLocationToSuburbNames(entry).catch(() => null);
                if (expansion && expansion.suburbNames.length > 0) {
                  criteriaSuburbs.push(...expansion.suburbNames);
                } else {
                  criteriaSuburbs.push(...(resolveDistrictToSuburbs(entry) ?? [entry]));
                }
              }
              const displaySuburb = criteriaSuburbs.length > 0 ? suburb : null;
              const { candidates: criteriaCandidates, coverage } = await runCriteriaSearch(criteriaSpec, {
                suburbs: criteriaSuburbs,
                pageSize: 1,
                excludeDiscoveryKeys: durableShownKeys.addressKeys,
              });

              if (criteriaCandidates.length > 0) {
                const card = criteriaCandidates[0];
                const aiIntro = buildCriteriaSearchIntro(criteriaSpec, card, coverage, displaySuburb, chatLocale);
                // Record the shown card into the same 30-day shown memory the rest
                // of discovery uses, so the next "show me another" advances.
                const shownItem = {
                  addressKey: normaliseDiscoveryAddressKey(card.address),
                  listingUrl: null,
                  address: card.address ?? null,
                  suburb: suburb ?? null,
                };
                if (chatUserId) {
                  runAfterResponse(
                    recordShownForUser(chatUserId, [shownItem]).catch((err) =>
                      req.log.warn({ err }, "Criteria search: failed to record shown memory"),
                    ),
                  );
                } else if (anonymousIdentityHash) {
                  runAfterResponse(
                    recordShownForAnonymous(anonymousIdentityHash, [shownItem]).catch((err) =>
                      req.log.warn({ err }, "Criteria search: failed to record shown memory"),
                    ),
                  );
                }

                const responsePayload = JSON.stringify({
                  candidates: [card],
                  isMockData: false,
                  suburb: displaySuburb ?? "",
                  dataSource: "analysed_properties",
                  noListings: false,
                  aiIntro,
                  searchPresentation: "scored_screening",
                  continuationToken: null,
                  criteriaSearch: true,
                  hasMore: coverage.hasMore,
                });
                const translatedContent = await translateChatContent(responsePayload, "discover", chatLocale, chatTranslateTitleSchool);
                req.log.info({ suburb, criteriaSearch: true, hasMore: coverage.hasMore }, "Criteria search: card served");
                res.json({ content: translatedContent, mode: "discover", ...providerSignal });
                return;
              }

              // No analysed match yet. A lot-count-only ask CAN be served by the
              // live screening below (potentialLots is computed live) — fall
              // through with a floor instead of dead-ending. Terrain/pipes/ROI
              // cannot be verified from a live listing, so those stay an honest
              // empty message (with the Auckland-only caveat for lot/ROI asks).
              const liveServable =
                criteriaSpec.minPotentialLots != null &&
                criteriaSpec.maxSlopeDegrees == null &&
                criteriaSpec.infrastructureOnParcel.length === 0 &&
                criteriaSpec.minRoiPct == null;
              if (liveServable) {
                criteriaLotsFloor = criteriaSpec.minPotentialLots;
                req.log.info(
                  { suburb, floor: criteriaLotsFloor },
                  "Criteria search: index empty — falling through to live screening with lots floor",
                );
              } else {
                const emptyMsg = buildCriteriaSearchEmptyMessage(displaySuburb, chatLocale);
                req.log.info({ suburb, criteriaSearch: true, empty: true }, "Criteria search: no analysed match");
                res.json({ content: emptyMsg, mode: "text", ...providerSignal });
                return;
              }
            } catch (err) {
              req.log.warn({ err }, "Criteria search failed — falling through to normal discovery");
            }
          }

          let candidates: import("../lib/pre-screen").PropertyCandidate[] = [];
          let isMockData = false;
          let dataSource = "realestate.co.nz";
          let prescreenedIntro = "";
          // User-facing label for the intro text ONLY (the pick/ranking uses
          // discoveryCriteria separately). Derived from the resolved search TYPE,
          // never from raw intent.criteria — the latter accumulates words from
          // prior turns (e.g. "crosslease" from an earlier message) and would make
          // the intro contradict the cards actually shown.
          const criteriaLabel = plainListingBrowse ? "" : "subdivision potential";
          const strictStandardSubdivision = !plainListingBrowse && isStandardSubdivisionDiscoveryIntent(discoveryCriteria);
          const requireSourceBackedPrice = userTextHasPrice;
          // Return up to 3 cards for every discovery intent, including strict
          // subdivision. Strict subdivision used to early-bail at the first card
          // to save on its expensive per-listing screening; we now target 3 and
          // bump the strict-path concurrency/batch (1 -> 3) so finding 3 rare
          // matches stays close to the previous latency instead of tripling it.
          const discoveryTargetCount = 3;
          const discoveryScreenConcurrency = strictStandardSubdivision ? 3 : 5;
          const discoveryBatchSize = strictStandardSubdivision ? 3 : 8;
          // Title screening is wanted when the user asked for a freehold/fee-simple
          // title OR for any subdivision search (the strict screen already requires
          // verified freehold). We only actually hit LINZ in service hours; out of
          // hours we still show price+suburb matches with an "unverified" caveat.
          const titleScreeningWanted = intent.requiresFreeholdTitle || strictStandardSubdivision;
          const titleServiceAvailable = isLinzTitleServiceAvailable();
          const titleScreeningOutOfHours = titleScreeningWanted && !titleServiceAvailable;
          // Non-freehold tenures the user explicitly opted in to (cross-lease /
          // leasehold / unit-title). When set, those titles are kept (with a
          // warning) instead of being dropped; otherwise we count what we drop
          // so the assistant can offer to include them.
          // Union the LLM-parsed opt-in with any tenures the user just affirmed
          // (the deterministic "Yes include" path) so the cross-lease/leasehold/
          // unit-title listings the prior turn offered are now kept and shown.
          const tenureOptIns = Array.from(
            new Set<Tenure>([...(intent.includeTenures ?? []), ...offeredTenures]),
          );
          // Running tally of non-freehold listings dropped this turn, by tenure,
          // for the "I left some out…" reminder appended to the intro below.
          const excludedTenureTotals = { cross_lease: 0, leasehold: 0, unit_title: 0 };
          const addExcludedTenures = (t: { cross_lease: number; leasehold: number; unit_title: number }): void => {
            excludedTenureTotals.cross_lease += t.cross_lease;
            excludedTenureTotals.leasehold += t.leasehold;
            excludedTenureTotals.unit_title += t.unit_title;
          };
          // Actual dropped non-freehold listings this turn (cross-lease etc.),
          // accumulated key-independently so we can persist them durably for a
          // later "include them" reply (see persistExcludedNonFreehold).
          const excludedNonFreeholdThisTurn: Array<{ listing: unknown; tenure: "cross_lease" | "leasehold" | "unit_title" }> = [];
          let continuationCacheKey: string | null = null;
          let continuationPreScreenOpts: Record<string, unknown> | null = null;
          // Tracks the suburb the continuation row should be stamped with. It
          // advances to the nearby suburb once the search jumps there, so the
          // persisted row (and every later exhausted-choice prompt) references
          // where the user actually is — not the original suburb they started
          // from. Kept separate from `suburb` so the nearby intro prompts can
          // still say "couldn't find in <original>, here are some in <nearby>".
          let continuationSuburb: string | null = suburb;
          // Nearby "train" seed — only populated when the user explicitly chose
          // "Search nearby". `continuationNearbyQueue` is the ordered list of
          // further nearby suburbs to auto-expand into as each drains;
          // `continuationOriginSuburb` is where the train started so a later
          // "see again" can refresh the origin cleanly.
          let continuationNearbyQueue: string[] = [];
          let continuationOriginSuburb: string | null = null;
          // "user" once the user explicitly named more than one suburb, so the
          // hand-off reads as a continuation of their request rather than a nearby
          // suggestion. Carried into the continuation state.
          let queueSource: "user" | "nearby" | undefined;

          // Multi-suburb intent: the user named more than one suburb ("St Heliers
          // or Kohimarama"). Validate/normalise the extras the same way as the
          // primary, then seed the train UPFRONT so the primary suburb is served
          // to exhaustion first and Show-more advances through the rest in the
          // order the user said them (see generateContinuationCandidates).
          const userExtraSuburbs: string[] = [];
          if (suburb && intent.additionalSuburbs.length > 0) {
            for (const extra of intent.additionalSuburbs) {
              if (userExtraSuburbs.length >= 6) break;
              const resolved = await resolveDiscoverySuburbName(extra, chatLocale, userText).catch(() => null);
              if (resolved?.status === "invalid") continue;
              const name = resolved?.status === "valid" ? resolved.suburb : extra.toLowerCase().trim();
              if (name && name !== suburb && !userExtraSuburbs.includes(name)) userExtraSuburbs.push(name);
            }
          }
          if (userExtraSuburbs.length > 0) {
            continuationNearbyQueue = [...userExtraSuburbs];
            continuationOriginSuburb = suburb;
            queueSource = "user";
            req.log.info({ suburb, userExtraSuburbs }, "Discovery: seeded multi-suburb train from user intent");
          }
          // Lazy-pagination cursor for the continuation's current suburb. Generic
          // browse fetches only the first window of source pages up front; these
          // record where to resume and whether the suburb is already drained, so
          // generateContinuationCandidates can refill on Show-more without the
          // initial search blocking on the suburb's entire inventory.
          let continuationPageOffset = 0;
          let continuationPageTotal: number | null = null;
          let continuationPageDone = true;

          // Accumulator for listings that couldn't be conclusively screened
          // (zone/build-year/land-area source still failing after the per-listing
          // inner retries). After the primary + fallback search, if we ended
          // with 0 candidates and strict mode was on, we re-screen these with
          // longer waits before declaring "no listings".
          const strictIndeterminate: ListingResult[] = [];

          if (suburb) {
            if (repeatShownAreaIntent) {
              alreadyShownAddressKeys.clear();
              alreadyShownUrlsFromHistory.length = 0;
              if (chatUserId) {
                await clearRecentShownForUserSuburb(chatUserId, suburb).catch((err) =>
                  req.log.warn({ err, suburb }, "Discovery: failed to clear shown memory for repeat request"),
                );
              } else if (anonymousIdentityHash) {
                await clearRecentShownForAnonymousSuburb(anonymousIdentityHash, suburb).catch((err) =>
                  req.log.warn({ err, suburb }, "Discovery: failed to clear anonymous shown memory for repeat request"),
                );
              }
            }
            const streetHint = extractDiscoverStreetHintFromThread(messages, userText, isFollowUp);
            const cacheKey = makeCacheKey(suburb, effectiveMinPrice, effectiveMaxPrice, streetHint);
            const discoverPreOpts = {
              allowMissingListingPrice: true,
              pricePlaceholderNzd: wantsDevelopmentDiscovery && !userTextHasPrice
                ? 3_500_000
                : Math.max(600_000, Math.round((effectiveMinPrice + effectiveMaxPrice) / 2)),
              strictStandardSubdivision,
              preliminarySubdivision: strictStandardSubdivision,
              // Scored non-strict discovery (development/yield asks) still gets
              // the attribute prefilter + development gate so already-subdivided
              // children, units/terraces, and below-minimum parcels never
              // surface as "subdivision potential" cards.
              developmentScreening: !plainListingBrowse && !strictStandardSubdivision,
              // screenOneFast re-checks service hours and skips the LINZ lookup
              // out of hours, so passing this through is safe year-round.
              verifyFreeholdTitle: titleScreeningWanted,
              includeTenures: tenureOptIns,
            };
            continuationCacheKey = cacheKey;
            continuationPreScreenOpts = discoverPreOpts;
            req.log.info({ streetHint }, "Discovery: street hint for listing order");

            // "Show more" follow-up: only try the cache if we've actually shown results before.
            // When isFollowUp=true because the user answered a clarification question (first search
            // for this suburb), hasShownAny=false so we skip straight to the fresh search below.
            const hasShownAny = !resetShownThisTurn && getShownUrls(cacheKey).length > 0;

            if (isFollowUp && hasShownAny) {
              candidates = plainListingBrowse
                ? topUpGenericListingCandidates(
                    cacheKey,
                    [],
                    alreadyShownAddressKeys,
                    discoveryTargetCount,
                    discoveryBatchSize,
                  )
                : await topUpDiscoveryCandidates(
                    cacheKey,
                    [],
                    discoveryCriteria,
                    discoverPreOpts,
                    alreadyShownAddressKeys,
                    {
                      batchSize: discoveryBatchSize,
                      nonStrictAttemptLimit: 3,
                      targetCount: discoveryTargetCount,
                      indeterminateAccumulator: strictStandardSubdivision ? strictIndeterminate : undefined,
                    },
                  );
            }

            if (forceNearbyDiscovery && candidates.length === 0) {
              setListingCache(cacheKey, {
                remainingListings: [],
                shownUrls: [],
                suburb,
                minPrice: effectiveMinPrice,
                maxPrice: effectiveMaxPrice,
              });
            }

            // Fresh search when: first search, clarification answer, or cache exhausted.
            // Combine in-memory shown URLs with history-derived URLs so we still skip
            // previously-shown listings even after a server restart.
            let discoverySkipUrls: string[] = [];
            // Brand-new chats can dead-end purely because the durable 30-day shown
            // memory filtered out every listing already shown in a prior chat. When
            // that happens we clear just those seeded keys and re-run the fresh
            // search ONCE so the suburb re-shows from the top — but only on a genuine
            // dead-end, so a chat with unseen listings still surfaces those first and
            // the cross-chat anti-repeat is preserved.
            for (let freshSearchPass = 0; freshSearchPass < 2; freshSearchPass++) {
            if (candidates.length === 0 && !forceNearbyDiscovery) {
              discoverySkipUrls = Array.from(new Set([
                ...(resetShownThisTurn ? [] : getShownUrls(cacheKey)),
                ...(resetShownThisTurn ? [] : alreadyShownUrlsFromHistory),
              ]));
              req.log.info(
                { fromCache: getShownUrls(cacheKey).length, fromHistory: alreadyShownUrlsFromHistory.length, total: discoverySkipUrls.length },
                "Discovery: dedupe skipUrls assembled",
              );
              const searchResult = await searchSuburbOrDistrict({
                suburb,
                minPrice: effectiveMinPrice,
                maxPrice: effectiveMaxPrice,
                skipUrls: discoverySkipUrls,
                includeNegotiation,
                firstBatchSize: wantsDevelopmentDiscovery ? 24 : undefined,
                // Both presentations paginate lazily: fetch the first window of
                // source pages now, then refill the continuation pool one window at
                // a time on Show-more (see generateContinuationCandidates). Generic
                // uses a small window; subdivision/scored uses a larger one so the
                // ranked "best sites first" ordering applies over a meaningful set.
                // No hard count cap — the cursor drives true exhaustion in both
                // cases. Heavy per-listing screening stays incremental + prefetched.
                fetchAllPages: false,
                maxPages: plainListingBrowse ? GENERIC_PAGE_WINDOW : SUBDIVISION_PAGE_WINDOW,
                maxListings: undefined,
                log: req.log,
              }).catch((err) => { req.log.warn({ err }, "realestate.co.nz search failed"); return null; });

              if (searchResult) {
                // Capture the lazy-pagination cursor so the continuation can resume
                // the next window of THIS suburb on Show-more — for both generic and
                // subdivision/scored (true exhaustion, no cap).
                continuationPageOffset = searchResult.nextOffset;
                continuationPageTotal = searchResult.totalAvailable;
                continuationPageDone = searchResult.done;
                req.log.info(
                  {
                    suburb,
                    rawFirstBatch: searchResult.firstBatch.length,
                    rawRemainingWindow: searchResult.remainingListings.length,
                    totalAvailable: searchResult.totalAvailable,
                    nextOffset: searchResult.nextOffset,
                    done: searchResult.done,
                    requireSourceBackedPrice,
                  },
                  "Discovery: source window fetched",
                );
              }

              if (searchResult && searchResult.firstBatch.length > 0) {
                const firstRanked = orderListingsByPriceTier(searchResult.firstBatch, effectiveMinPrice, effectiveMaxPrice, strictStandardSubdivision, requireSourceBackedPrice);
                const remainingRanked = orderListingsByPriceTier(searchResult.remainingListings, effectiveMinPrice, effectiveMaxPrice, strictStandardSubdivision, requireSourceBackedPrice);
                const firstFiltered = filterAlreadyShownListings(rankListingsByStreetHint(
                  filterListingsByStreetHint(firstRanked, streetHint),
                  streetHint,
                ), alreadyShownAddressKeys);
                const remainingFiltered = filterAlreadyShownListings(rankListingsByStreetHint(
                  filterListingsByStreetHint(remainingRanked, streetHint),
                  streetHint,
                ), alreadyShownAddressKeys);

                const priorShown = resetShownThisTurn ? [] : [...getShownUrls(cacheKey)];
                setListingCache(cacheKey, {
                  remainingListings: [...remainingFiltered],
                  shownUrls: priorShown,
                  suburb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                });
                if (plainListingBrowse) {
                  candidates = pickGenericListingCandidates(firstFiltered, alreadyShownAddressKeys, discoveryTargetCount);
                  markShown(
                    cacheKey,
                    candidates.map((c) => c.listingUrl).filter((u): u is string => Boolean(u)),
                  );
                  candidates = topUpGenericListingCandidates(
                    cacheKey,
                    candidates,
                    alreadyShownAddressKeys,
                    discoveryTargetCount,
                    discoveryBatchSize,
                  );
                  const criteriaContext = criteriaLabel ? ` matching criteria: ${criteriaLabel}` : "";
                  const introPromptGeneric = `The user asked: "${discoveryPromptText}". You found some matching listings in ${suburb || "the area"}${criteriaContext}. In 1 sentence, acknowledge this result conversationally. Do NOT mention a specific number; say "a few", "some", or "a handful". Never mention any external website, data source, URL, or platform name. Call them listings/properties only; do not call them development sites or development land. Be natural and brief; no JSON.`;
                  prescreenedIntro = await generateAnalysis(introPromptGeneric, chatLocale).catch(() => "");
                  req.log.info({ fetched: firstFiltered.length, cached: remainingFiltered.length, picked: candidates.length }, "realestate.co.nz: selected generic listing cards");
                } else {
                req.log.info({ fetched: firstFiltered.length, cached: remainingFiltered.length }, "realestate.co.nz: prescreening listings");
                // Run pre-screening and AI intro generation in parallel to save time.
                // In strict-subdivision mode we early-bail once the first legally
                // plausible candidate surfaces. Full practical feasibility waits
                // until the user taps Start analysis.
                const criteriaContext = criteriaLabel ? ` matching criteria: ${criteriaLabel}` : "";
                const resultKind = wantsDevelopmentDiscovery ? "development-focused listings" : "listings";
                const introPromptPreScreen = `The user asked: "${discoveryPromptText}". You found some matching ${resultKind} in ${suburb || "the area"}${criteriaContext}. In 1 sentence, acknowledge this result conversationally. Do NOT mention a specific number; say "a few", "some", or "a handful". Never mention any external website, data source, URL, or platform name. If the user's exact request did not explicitly ask for development, subdivision, yield, or redevelopment, call them listings/properties only; do not call them development sites or development land. Be natural and brief; no JSON.`;
                const preScreenOptsWithBail = strictStandardSubdivision
                  ? { ...discoverPreOpts, earlyBailAt: discoveryTargetCount }
                  : discoverPreOpts;
                const [screenedDetailed, introFromPreScreen] = await Promise.all([
                  preScreenListingsFastDetailed(firstFiltered, discoveryScreenConcurrency, null, preScreenOptsWithBail).catch(
                    () => ({ candidates: [] as PropertyCandidate[], indeterminate: [] as ListingResult[], excludedTenures: { cross_lease: 0, leasehold: 0, unit_title: 0 }, excludedNonFreehold: [], drainComplete: Promise.resolve() }),
                  ),
                  generateAnalysis(introPromptPreScreen, chatLocale).catch(() => ""),
                ]);
                const screened = screenedDetailed.candidates;
                addExcludedTenures(screenedDetailed.excludedTenures);
                // Keep the dropped non-freehold listings so a later "include them"
                // opt-in can re-screen exactly these with the tenure waiver — both
                // in-memory (warm-instance fast path) and accumulated for durable
                // persistence below.
                if (screenedDetailed.excludedNonFreehold.length > 0) {
                  addExcludedNonFreehold(cacheKey, screenedDetailed.excludedNonFreehold);
                  excludedNonFreeholdThisTurn.push(...screenedDetailed.excludedNonFreehold);
                }
                if (strictStandardSubdivision) strictIndeterminate.push(...screenedDetailed.indeterminate);
                if (strictStandardSubdivision) {
                  // Detach the remaining drain so the verdict cache warms in the
                  // background while we reply to the user.
                  runAfterResponse(screenedDetailed.drainComplete.catch(() => {}));
                }
                candidates = pickDiscoveryCandidates(screened, discoveryCriteria, alreadyShownAddressKeys, discoveryTargetCount);
                const pickedUrls = candidates.map((c) => c.listingUrl).filter((u): u is string => Boolean(u));
                markShown(cacheKey, pickedUrls);
                const { putAtFront, putAtBack } = partitionBatchAfterPrescreen(firstFiltered, screened, candidates, discoveryCriteria, alreadyShownAddressKeys);
                if (strictStandardSubdivision) {
                  // Keep the suburb queue intact for one-at-a-time "show more".
                  // Cached verdicts make already-screened rejects cheap to skip.
                  restoreListingsAfterPop(cacheKey, putAtFront, putAtBack);
                } else {
                  restoreListingsAfterPop(cacheKey, putAtFront, putAtBack);
                }
                prescreenedIntro = introFromPreScreen;

                candidates = await topUpDiscoveryCandidates(
                  cacheKey,
                  candidates,
                  discoveryCriteria,
                  discoverPreOpts,
                  alreadyShownAddressKeys,
                  {
                    batchSize: discoveryBatchSize,
                    nonStrictAttemptLimit: 6,
                    targetCount: discoveryTargetCount,
                    indeterminateAccumulator: strictStandardSubdivision ? strictIndeterminate : undefined,
                  },
                );
                }
              }
            }
            // Only retry after a genuine fresh-chat dead-end caused by the durable
            // shown memory: clear just those seeded keys and loop once to re-show
            // the suburb from the top. A chat with unseen listings never reaches
            // here (candidates > 0), so cross-chat anti-repeat stays intact.
            const deadEndFromShownMemory =
              freshSearchPass === 0 &&
              candidates.length === 0 &&
              !isFollowUp &&
              !repeatShownAreaIntent &&
              !forceNearbyDiscovery &&
              !streetHint &&
              (durableShownKeys.addressKeys.size > 0 || durableShownKeys.urls.size > 0);
            if (!deadEndFromShownMemory) break;
            for (const k of durableShownKeys.addressKeys) alreadyShownAddressKeys.delete(k);
            if (durableShownKeys.urls.size > 0) {
              const keptUrls = alreadyShownUrlsFromHistory.filter((u) => !durableShownKeys.urls.has(u));
              alreadyShownUrlsFromHistory.length = 0;
              alreadyShownUrlsFromHistory.push(...keptUrls);
            }
            req.log.info({ suburb }, "Discovery: fresh-chat dead-end on durable shown memory — resetting and re-showing suburb");
            }

            // ── SOURCE WINDOW REFILL ─────────────────────────────────────────
            // If the first source window did not produce enough displayable
            // cards, keep advancing the same suburb before declaring exhaustion
            // or jumping nearby. This is the initial-response counterpart to
            // generateContinuationCandidates' lazy source pagination.
            while (
              candidates.length < discoveryTargetCount &&
              !forceNearbyDiscovery &&
              suburb &&
              !streetHint &&
              !continuationPageDone &&
              getRemainingCount(cacheKey) === 0
            ) {
              const nextWindow = await searchRealEstateListings({
                suburb,
                minPrice: effectiveMinPrice,
                maxPrice: effectiveMaxPrice,
                skipUrls: discoverySkipUrls,
                includeNegotiation,
                firstBatchSize: wantsDevelopmentDiscovery ? 24 : undefined,
                startOffset: continuationPageOffset,
                maxPages: plainListingBrowse ? GENERIC_PAGE_WINDOW : SUBDIVISION_PAGE_WINDOW,
              }).catch((err) => {
                req.log.warn({ err, suburb, offset: continuationPageOffset }, "Discovery: source window refill failed");
                return null;
              });

              if (!nextWindow) break;
              continuationPageOffset = nextWindow.nextOffset;
              continuationPageTotal = nextWindow.totalAvailable;
              continuationPageDone = nextWindow.done;

              const rankedWindow = orderListingsByPriceTier(
                [...nextWindow.firstBatch, ...nextWindow.remainingListings],
                effectiveMinPrice,
                effectiveMaxPrice,
                strictStandardSubdivision,
                requireSourceBackedPrice,
              );
              const windowFiltered = filterAlreadyShownListings(rankListingsByStreetHint(
                filterListingsByStreetHint(rankedWindow, streetHint),
                streetHint,
              ), alreadyShownAddressKeys);

              if (windowFiltered.length === 0) continue;

              setListingCache(cacheKey, {
                remainingListings: windowFiltered,
                shownUrls: repeatShownAreaIntent ? [] : [...getShownUrls(cacheKey)],
                suburb,
                minPrice: effectiveMinPrice,
                maxPrice: effectiveMaxPrice,
              });

              if (plainListingBrowse) {
                candidates = topUpGenericListingCandidates(
                  cacheKey,
                  candidates,
                  alreadyShownAddressKeys,
                  discoveryTargetCount,
                  discoveryBatchSize,
                );
              } else {
                candidates = await topUpDiscoveryCandidates(
                  cacheKey,
                  candidates,
                  discoveryCriteria,
                  discoverPreOpts,
                  alreadyShownAddressKeys,
                  {
                    batchSize: discoveryBatchSize,
                    nonStrictAttemptLimit: 6,
                    targetCount: discoveryTargetCount,
                    indeterminateAccumulator: strictStandardSubdivision ? strictIndeterminate : undefined,
                  },
                );
              }
            }

            // ── OPTED-IN NON-FREEHOLD RE-SCREEN ────────────────────────────────
            // When the user accepted the "include the cross-lease/leasehold I left
            // out" offer, re-screen exactly those listings (captured at screen time)
            // with the tenure waiver. Deterministic — it does not depend on a fresh
            // re-search re-surfacing the same listing. Sourced from BOTH the
            // in-memory stash (warm-instance fast path) AND the durable DB store, so
            // it works even when the offer turn and this turn hit different
            // serverless instances — instead of falling through to the exhausted choice.
            if (tenureOptIns.length > 0 && candidates.length < discoveryTargetCount) {
              const inMemory = getExcludedNonFreehold(cacheKey);
              const durable = await loadExcludedNonFreehold(
                continuationOwnerKey(chatUserId, anonymousIdentityHash),
                suburb,
              ).catch(() => []);
              const usedDurable = inMemory.length === 0 && durable.length > 0;
              const byKey = new Map<string, ListingResult>();
              for (const e of [...inMemory, ...durable]) {
                if (!tenureOptIns.includes(e.tenure)) continue;
                const listing = e.listing as ListingResult;
                const key = (listing.listingUrl?.trim().toLowerCase()) || listing.address?.toLowerCase().trim();
                if (!key || byKey.has(key)) continue;
                byKey.set(key, listing);
              }
              const freshStashed = filterAlreadyShownListings([...byKey.values()], alreadyShownAddressKeys);
              if (freshStashed.length > 0) {
                const optInDetailed = await preScreenListingsFastDetailed(
                  freshStashed,
                  discoveryScreenConcurrency,
                  null,
                  discoverPreOpts,
                ).catch(() => null);
                const optInPicked = optInDetailed
                  ? pickDiscoveryCandidates(
                      optInDetailed.candidates,
                      discoveryCriteria,
                      alreadyShownAddressKeys,
                      discoveryTargetCount - candidates.length,
                    )
                  : [];
                if (optInPicked.length > 0) {
                  markShown(cacheKey, optInPicked.map((c) => c.listingUrl).filter((u): u is string => Boolean(u)));
                  candidates.push(...optInPicked);
                }
                req.log.info(
                  { suburb, tenureOptIns, source: usedDurable ? "durable_db" : "in_memory", stashed: freshStashed.length, optInCandidates: optInPicked.length },
                  "Discovery: re-screened opted-in non-freehold listings",
                );
              }
            }

            // ── NEARBY SUBURB FALLBACK ─────────────────────────────────────────
            const exhaustedByShownMemory =
              !repeatShownAreaIntent
              && !forceNearbyDiscovery
              && isFollowUp
              && candidates.length === 0
              && !streetHint
              && getRemainingCount(cacheKey) === 0
              && continuationPageDone
              && (
                getShownUrls(cacheKey).length > 0
                || alreadyShownFromHistory.length > 0
                || hasRecentShownForSuburb(recentShownEntries, suburb)
              );
            if (exhaustedByShownMemory) {
              // Freehold pool is exhausted, but non-freehold listings (cross-lease
              // etc.) were never shown. Still surface the "I left out N cross-lease…"
              // offer so the user can ask to include them — replying "yes/include"
              // re-runs discovery with the tenure opted in (cross-lease cards then
              // surface via the screen waiver in pre-screen.ts).
              const exhaustedTenureReminder = buildTenureExclusionReminder(excludedTenureTotals, tenureOptIns);
              const exhaustedPayload = buildDiscoveryExhaustedChoicePayload(
                suburb,
                plainListingBrowse ? "generic_listing" : "scored_screening",
                exhaustedTenureReminder || undefined,
              );
              const translatedExhausted = await translateChatContent(exhaustedPayload, "clarification", chatLocale, chatTranslateTitleSchool);
              // Durably persist the offered (excluded) listings so a later
              // "include them" reply can re-screen them even on a cold instance.
              if (excludedNonFreeholdThisTurn.length > 0) {
                runAfterResponse(
                  persistExcludedNonFreehold({
                    ownerKey: continuationOwnerKey(chatUserId, anonymousIdentityHash),
                    suburb,
                    cacheKey,
                    items: excludedNonFreeholdThisTurn,
                  }).catch((err) => req.log.warn({ err }, "Discovery: failed to persist excluded non-freehold (exhausted path)")),
                );
              }
              res.json({ content: translatedExhausted, mode: "clarification", ...providerSignal });
              return;
            }

            // Only after the primary suburb queue is empty: avoid jumping to neighbours
            // when we still have unscanned listings or prescreen returned no UI rows this round.
            if (candidates.length < discoveryTargetCount && suburb && !streetHint && getRemainingCount(cacheKey) === 0 && continuationPageDone && (!strictStandardSubdivision || forceNearbyDiscovery)) {
              const primaryCandidateCount = candidates.length;
              // When the user explicitly named more suburbs, advance into THOSE
              // first (in order) before any LLM-suggested neighbours, so an empty
              // primary still flows St Heliers → Kohimarama as requested.
              const llmNearby = await resolveNearbySuburbs(suburb, 8);
              const nearbyList = userExtraSuburbs.length > 0
                ? [...userExtraSuburbs, ...llmNearby.filter((s) => !userExtraSuburbs.includes(s.toLowerCase()))]
                : llmNearby;
              // Run nearby-suburb scrapes concurrently and return as soon as the first
              // one yields any listings — keeps tail latency bounded when the slow
              // Playwright fallback is in play.
              req.log.info(
                { suburb, nearbyList, strictStandardSubdivision },
                strictStandardSubdivision
                  ? "Discovery: primary suburb exhausted, screening nearby suburbs sequentially for strict subdivision"
                  : "Discovery: primary suburb empty, racing nearby suburb searches",
              );
              type FallbackHit = { nearbySuburb: string; fallbackResult: Awaited<ReturnType<typeof searchRealEstateListings>> };
              const strictFallbackResults: FallbackHit[] = [];
              if (strictStandardSubdivision) {
                for (const nb of nearbyList) {
                  const res = await searchRealEstateListings({
                    suburb: nb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                    skipUrls: alreadyShownUrlsFromHistory,
                    includeNegotiation,
                    firstBatchSize: wantsDevelopmentDiscovery ? 18 : undefined,
                    // Windowed (no hard cap): fetch the first ranked window now; the
                    // continuation resumes deeper pages of the chosen suburb on
                    // Show-more until it's genuinely exhausted.
                    maxPages: SUBDIVISION_PAGE_WINDOW,
                  }).catch((err) => {
                    req.log.warn({ err, nearbySuburb: nb }, "Discovery: strict nearby suburb search failed");
                    return null;
                  });
                  if (res && res.firstBatch.length > 0) {
                    strictFallbackResults.push({ nearbySuburb: nb, fallbackResult: res });
                  }
                }
              }
              const racers = strictStandardSubdivision ? [] : nearbyList.map(
                (nb): Promise<FallbackHit> =>
                  searchRealEstateListings({
                    suburb: nb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                    skipUrls: alreadyShownUrlsFromHistory,
                    includeNegotiation,
                    firstBatchSize: wantsDevelopmentDiscovery ? 18 : undefined,
                    // Window the first nearby suburb too (the train refills it and
                    // later suburbs one window at a time, no hard cap): a small
                    // window for generic, a larger ranked window for scored.
                    maxPages: plainListingBrowse ? GENERIC_PAGE_WINDOW : SUBDIVISION_PAGE_WINDOW,
                  }).then((res) => {
                    if (!res || res.firstBatch.length === 0) {
                      // Reject so Promise.any moves on; if all reject we fall through to no-listings
                      return Promise.reject(new Error(`empty:${nb}`));
                    }
                    return { nearbySuburb: nb, fallbackResult: res };
                  }),
              );

              // Bound total wait time so when ScrapingBee is down and all Playwright
              // fetches are slow, we don't keep the user waiting for the laggard.
              const FALLBACK_DEADLINE_MS = 25_000;
              const deadline = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), FALLBACK_DEADLINE_MS),
              );
              const winner: FallbackHit | null = racers.length === 0
                ? null
                : await Promise.race([
                    Promise.any(racers).catch(() => null),
                    deadline,
                  ]);

              const orderedResults: FallbackHit[] = strictStandardSubdivision ? strictFallbackResults : (winner ? [winner] : []);

              for (const { nearbySuburb, fallbackResult } of orderedResults) {
                if (fallbackResult && fallbackResult.firstBatch.length > 0) {
                  const orderedFallback = orderListingsByPriceTier(
                    fallbackResult.firstBatch,
                    effectiveMinPrice,
                    effectiveMaxPrice,
                    strictStandardSubdivision,
                    requireSourceBackedPrice,
                  );
                  const filtered = filterAlreadyShownListings(rankListingsByStreetHint(
                    orderedFallback,
                    streetHint,
                  ), alreadyShownAddressKeys);
                  if (filtered.length > 0) {
                    const fallbackCacheKey = makeCacheKey(nearbySuburb, effectiveMinPrice, effectiveMaxPrice);
                    continuationCacheKey = fallbackCacheKey;
                    // The conversation has now moved to the nearby suburb — stamp
                    // the continuation row (and thus future exhausted prompts) with
                    // it so the suburb evolves instead of pinning to the original.
                    continuationSuburb = nearbySuburb;
                    continuationPreScreenOpts = discoverPreOpts;
                    // Carry the nearby suburb's lazy-pagination cursor so the train
                    // can refill it window-by-window before advancing — for both
                    // generic and subdivision/scored (no hard cap, true exhaustion).
                    continuationPageOffset = fallbackResult.nextOffset;
                    continuationPageTotal = fallbackResult.totalAvailable;
                    continuationPageDone = fallbackResult.done;
                    const priorShownFallback = [...getShownUrls(fallbackCacheKey)];
                    setListingCache(fallbackCacheKey, {
                      remainingListings: filterAlreadyShownListings(rankListingsByStreetHint(
                        orderListingsByPriceTier(fallbackResult.remainingListings, effectiveMinPrice, effectiveMaxPrice, strictStandardSubdivision, requireSourceBackedPrice),
                        streetHint,
                      ), alreadyShownAddressKeys),
                      shownUrls: priorShownFallback,
                      suburb: nearbySuburb, minPrice: effectiveMinPrice, maxPrice: effectiveMaxPrice,
                    });
                    if (plainListingBrowse) {
                      const fallbackPicked = pickGenericListingCandidates(
                        filtered,
                        alreadyShownAddressKeys,
                        Math.max(1, discoveryTargetCount - candidates.length),
                      );
                      candidates = appendUniqueDiscoveryCandidates(candidates, fallbackPicked, discoveryTargetCount);
                      markShown(
                        fallbackCacheKey,
                        fallbackPicked.map((c) => c.listingUrl).filter((u): u is string => Boolean(u)),
                      );
                      candidates = topUpGenericListingCandidates(
                        fallbackCacheKey,
                        candidates,
                        alreadyShownAddressKeys,
                        discoveryTargetCount,
                        discoveryBatchSize,
                      );
                      if (candidates.length > primaryCandidateCount) {
                        const criteriaContextFallback = criteriaLabel ? ` (${criteriaLabel})` : "";
                        const introPromptFallback = primaryCandidateCount === 0
                          ? `The user asked about ${suburb}${criteriaContextFallback} but no listings were found there right now. You found some properties in nearby ${nearbySuburb}. In 1 sentence acknowledge this naturally. Do NOT mention a specific number; say "a few", "some", or "a handful". Call them listings/properties only; do not call them development sites or development land. Be brief; no JSON.`
                          : `The user asked about ${suburb}${criteriaContextFallback}. You found some matching properties there and added nearby options from ${nearbySuburb} to round out the results. In 1 sentence acknowledge this naturally. Do NOT mention a specific number; say "a few", "some", or "a handful". Call them listings/properties only; do not call them development sites or development land. Be brief; no JSON.`;
                        prescreenedIntro = await generateAnalysis(introPromptFallback, chatLocale).catch(() => "");
                        if (forceNearbyDiscovery || userExtraSuburbs.length > 0) {
                          // Seed the train: the remaining suburbs (this one is
                          // being served now) become the auto-expand queue. With
                          // user-named suburbs this preserves their stated order.
                          continuationNearbyQueue = nearbyList.filter((s) => s.toLowerCase() !== nearbySuburb.toLowerCase());
                          continuationOriginSuburb = suburb;
                          queueSource = userExtraSuburbs.length > 0 ? "user" : "nearby";
                        }
                        req.log.info({ nearbySuburb, count: candidates.length, queue: continuationNearbyQueue.length }, "Discovery: nearby generic fallback succeeded");
                        break;
                      }
                      continue;
                    }
                    const criteriaContextFallback = criteriaLabel ? ` (${criteriaLabel})` : "";
                    const introPromptFallback = primaryCandidateCount === 0
                      ? `The user asked about ${suburb}${criteriaContextFallback} but no listings were found there right now. You found some properties in nearby ${nearbySuburb}. In 1 sentence acknowledge this naturally (e.g. "I couldn't find anything in ${suburb} right now, but here are some nearby options in ${nearbySuburb}:"). Do NOT mention a specific number; say "a few", "some", or "a handful". If the user's exact request did not explicitly ask for development, subdivision, yield, or redevelopment, call them listings/properties only; do not call them development sites or development land. Be brief; no JSON.`
                      : `The user asked about ${suburb}${criteriaContextFallback}. You found some matching properties there and added nearby options from ${nearbySuburb} to round out the results. In 1 sentence acknowledge this naturally. Do NOT mention a specific number; say "a few", "some", or "a handful". If the user's exact request did not explicitly ask for development, subdivision, yield, or redevelopment, call them listings/properties only; do not call them development sites or development land. Be brief; no JSON.`;
                    const [screenedFallbackDetailed, introFallback] = await Promise.all([
                      preScreenListingsFastDetailed(filtered, discoveryScreenConcurrency, null, {
                        ...discoverPreOpts,
                        ...(strictStandardSubdivision ? { earlyBailAt: discoveryTargetCount } : {}),
                      }).catch(
                        () => ({ candidates: [] as PropertyCandidate[], indeterminate: [] as ListingResult[], excludedTenures: { cross_lease: 0, leasehold: 0, unit_title: 0 }, excludedNonFreehold: [], drainComplete: Promise.resolve() }),
                      ),
                      generateAnalysis(introPromptFallback, chatLocale).catch(() => ""),
                    ]);
                    const screenedFallback = screenedFallbackDetailed.candidates;
                    addExcludedTenures(screenedFallbackDetailed.excludedTenures);
                    if (strictStandardSubdivision) strictIndeterminate.push(...screenedFallbackDetailed.indeterminate);
                    if (strictStandardSubdivision) {
                      runAfterResponse(screenedFallbackDetailed.drainComplete.catch(() => {}));
                    }
                    const fallbackPicked = pickDiscoveryCandidates(
                      screenedFallback,
                      discoveryCriteria,
                      alreadyShownAddressKeys,
                      Math.max(1, discoveryTargetCount - candidates.length),
                    );
                    candidates = appendUniqueDiscoveryCandidates(candidates, fallbackPicked, discoveryTargetCount);
                    markShown(
                      fallbackCacheKey,
                      fallbackPicked.map((c) => c.listingUrl).filter((u): u is string => Boolean(u)),
                    );
                    const { putAtFront: fbFront, putAtBack: fbBack } = partitionBatchAfterPrescreen(
                      filtered,
                      screenedFallback,
                      fallbackPicked,
                      discoveryCriteria,
                      alreadyShownAddressKeys,
                    );
                    if (strictStandardSubdivision) {
                      // Keep nearby fallback queues intact for one-at-a-time follow-up.
                      restoreListingsAfterPop(fallbackCacheKey, fbFront, fbBack);
                    } else {
                      restoreListingsAfterPop(fallbackCacheKey, fbFront, fbBack);
                    }

                    candidates = await topUpDiscoveryCandidates(
                      fallbackCacheKey,
                      candidates,
                      discoveryCriteria,
                      discoverPreOpts,
                      alreadyShownAddressKeys,
                      {
                        batchSize: discoveryBatchSize,
                        nonStrictAttemptLimit: 6,
                        targetCount: discoveryTargetCount,
                        indeterminateAccumulator: strictStandardSubdivision ? strictIndeterminate : undefined,
                      },
                    );

                    if (candidates.length > primaryCandidateCount) {
                      prescreenedIntro = introFallback;
                      if (forceNearbyDiscovery || userExtraSuburbs.length > 0) {
                        continuationNearbyQueue = nearbyList.filter((s) => s.toLowerCase() !== nearbySuburb.toLowerCase());
                        continuationOriginSuburb = suburb;
                        queueSource = userExtraSuburbs.length > 0 ? "user" : "nearby";
                      }
                      req.log.info({ nearbySuburb, count: candidates.length, queue: continuationNearbyQueue.length }, "Discovery: nearby suburb fallback succeeded");
                      break;
                    }
                  }
                }
              }
            }
          }

          // ── Outer indeterminate re-screen ────────────────────────────────
          // If the strict-subdivision discovery ended with 0 candidates but
          // some listings stayed indeterminate (upstream sources kept failing
          // even after the per-listing inner retries), wait with progressively
          // longer backoffs and re-screen them before reporting "no listings".
          // This honours the "keep retrying with increasing waiting time"
          // guarantee — we don't tell the user nothing matches until every
          // listing has actually been evaluated against the criteria.
          if (
            strictStandardSubdivision &&
            candidates.length === 0 &&
            strictIndeterminate.length > 0
          ) {
            // De-dupe indeterminate listings that piled up across the primary
            // search and the nearby-suburb fallback.
            const seen = new Set<string>();
            const uniqueIndeterminate = strictIndeterminate.filter((l) => {
              const key = l.listingUrl || l.address;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            req.log.info(
              { suburb, indeterminateCount: uniqueIndeterminate.length },
              "Discovery: strict subdivision ended with 0 candidates — running outer indeterminate-listing retry pass",
            );
            const retried = await reScreenIndeterminateListings({
              indeterminate: uniqueIndeterminate,
              criteria: discoveryCriteria,
              preScreenOpts: {
                allowMissingListingPrice: true,
                pricePlaceholderNzd: wantsDevelopmentDiscovery && !userTextHasPrice
                  ? 3_500_000
                  : Math.max(600_000, Math.round((effectiveMinPrice + effectiveMaxPrice) / 2)),
                strictStandardSubdivision: true,
                preliminarySubdivision: true,
                verifyFreeholdTitle: titleScreeningWanted,
              },
              shownAddressKeys: alreadyShownAddressKeys,
              targetCount: discoveryTargetCount,
              log: req.log,
            });
            if (retried.length > 0) {
              candidates = retried;
              req.log.info(
                { suburb, recovered: retried.length },
                "Discovery: outer retry recovered listings that were previously indeterminate",
              );
            }
          }

          // Final display guard: never let a malformed listing (URL-fragment
          // address, absurd land area) reach a property card.
          candidates = sanitizeDiscoveryCandidates(candidates);
          if (plainListingBrowse) {
            candidates = await mergeSponsoredGenericListingCandidate({
              candidates,
              suburb,
              minPrice: effectiveMinPrice,
              maxPrice: effectiveMaxPrice,
              isFollowUp,
              shownAddressKeys: alreadyShownAddressKeys,
              userId: chatUserId,
              targetCount: discoveryTargetCount,
              log: req.log,
            });
            candidates = await hydrateGenericListingAgentDetails(candidates, req.log);
            if (candidates.some((candidate) => candidate.isSponsored)) {
              dataSource = "Project Alpha + realestate.co.nz";
            }
          }

          // Lot-count criteria floor (index-empty fall-through): only show live
          // candidates that actually model to the asked lot count — standard
          // vacant-lot maths or design-led yield. Without this, "split into 4"
          // would surface 2-lot cards that contradict the ask.
          if (criteriaLotsFloor != null && candidates.length > 0) {
            const floor = criteriaLotsFloor;
            const before = candidates.length;
            candidates = candidates.filter(
              (c) => (c.potentialLots ?? 0) >= floor || (c.designLedYieldRange?.max ?? 0) >= floor,
            );
            req.log.info({ floor, before, after: candidates.length }, "Criteria search: applied live lots floor");
          }

          const noListings = candidates.length === 0;

          // Use pre-computed intro if available, otherwise generate one now for the no-results case
          let aiIntro = noListings
            ? buildDiscoveryNoListingsIntro({
                suburb,
                criteriaLabel,
                minPrice: effectiveMinPrice,
                maxPrice: effectiveMaxPrice,
                explicitPrice: userTextHasPrice,
                plainListingBrowse,
              })
            : prescreenedIntro;
          if (!aiIntro) {
            try {
              const criteriaContextGeneral = criteriaLabel ? ` (${criteriaLabel})` : "";
              const genericListingSource = plainListingBrowse && candidates.some((candidate) => candidate.isSponsored)
                ? "from available Project Alpha and marketplace listings"
                : "in the current market";
              const introPrompt = noListings
                ? `The user asked: "${discoveryPromptText}". No matching listings were found right now for ${suburb || "this area"}${criteriaContextGeneral}. In 1-2 sentences, acknowledge this warmly and suggest they try a different suburb, adjust their budget, or check back soon. Never mention any external website, data source, URL, or platform name. Do NOT output any JSON.`
                : `The user asked: "${discoveryPromptText}". You found some matching properties in ${suburb || "the area"} ${genericListingSource}${criteriaContextGeneral}. In 1 sentence, acknowledge the results conversationally. Do NOT mention a specific number; say "a few", "some", or "a handful". Never mention any external website, data source, URL, or platform name. If the user's exact request did not explicitly ask for development, subdivision, yield, or redevelopment, call them listings/properties only; do not call them development sites or development land. Be natural and brief; no JSON.`;
              aiIntro = await generateAnalysis(introPrompt, chatLocale).catch(() => "");
            } catch { /* silent */ }
          }

          // When this turn shows opted-in non-freehold cards (the user asked to
          // include the cross-lease / leasehold / unit-title we'd set aside), lead
          // with an intro that matches those cards instead of the generic "found
          // subdividable properties" — otherwise the response contradicts what's
          // shown (the reported "I've found a few crosslease listings" over
          // freehold cards, and vice-versa). The neighbour-acquisition note below
          // still appends for the cross-lease specifics.
          const shownTenureWarnings = new Set(
            candidates.map((c) => c.subdivisionTenureWarning).filter((w): w is "cross_lease" | "leasehold" | "unit_title" => Boolean(w)),
          );
          if (tenureOptIns.length > 0 && shownTenureWarnings.size > 0) {
            const tenureWord = shownTenureWarnings.has("cross_lease")
              ? "cross-lease"
              : shownTenureWarnings.has("leasehold")
                ? "leasehold"
                : "unit-title";
            const optInSuburbLabel = suburb ? titleCaseSuburb(suburb) : "this area";
            aiIntro = `Here are the ${tenureWord} listings you asked me to include in ${optInSuburbLabel}.`;
          }

          // Out-of-hours title screening: the LINZ title service is closed, so
          // freehold couldn't be verified. Tag the candidates "unverified" so the
          // neutral "Title unverified / 产权待核实" chip shows on the cards, but do
          // NOT surface any explanation about service hours — that operational
          // detail must never be exposed to customers (in any language).
          if (titleScreeningOutOfHours && candidates.length > 0) {
            for (const candidate of candidates) {
              if (!candidate.titleStatus) candidate.titleStatus = "unverified";
            }
          }

          // Non-freehold exclusion reminder: when this search dropped cross-lease
          // / leasehold / unit-title titles the user hadn't opted in to, tell them
          // why and offer to include them (shown with a warning). Skipped entirely
          // when nothing was dropped or everything dropped was already opted in.
          const tenureReminder = buildTenureExclusionReminder(excludedTenureTotals, tenureOptIns);
          if (tenureReminder) {
            aiIntro = aiIntro ? `${aiIntro}\n\n${tenureReminder}` : tenureReminder;
          }

          // When opted-in cross-lease listings are among the cards (they surface
          // without a verified individual land area, since a cross-lease can't be
          // subdivided on its own title), add the neighbour-acquisition guidance
          // once above the cards rather than on each one.
          const hasCrossLeaseCard = candidates.some((c) => c.subdivisionTenureWarning === "cross_lease");
          if (hasCrossLeaseCard) {
            const crossLeaseAdvice =
              "Note: these are cross-lease properties — they can't be subdivided on their current title. Acquiring the neighbouring cross-lease unit(s) and converting the shared title to freehold is what unlocks the subdivision potential here.";
            aiIntro = aiIntro ? `${aiIntro}\n\n${crossLeaseAdvice}` : crossLeaseAdvice;
          }

          if (!plainListingBrowse && candidates.length > 0) {
            queueBackgroundScores(
              candidates.map((c) => ({
                address: c.address,
                listingUrl: c.listingUrl,
                price: c.price,
                landArea: c.landArea,
                landAreaConfidence: c.landAreaConfidence,
                isAlreadySubdividedChild: c.isAlreadySubdividedChild,
                zone: c.zone,
                buildYear: c.buildYear,
                typology: c.typology,
                titleConfidence: c.titleConfidence,
                subdivisionEligible: c.subdivisionEligible,
                subdivisionRejectReason: c.subdivisionRejectReason,
              })),
            );
          }

          // Persist these cards to the account-level 30-day shown memory so the
          // next conversation (any device) continues with unshown listings.
          if (chatUserId && candidates.length > 0) {
            const shownItems = candidates.map((c) => ({
              addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
              listingUrl: c.listingUrl ?? null,
              address: c.address ?? null,
              suburb: suburb ?? null,
            }));
            runAfterResponse(
              recordShownForUser(chatUserId, shownItems).catch((err) =>
                req.log.warn({ err }, "Discovery: failed to record account-level shown memory"),
              ),
            );
          } else if (!chatUserId && anonymousIdentityHash && candidates.length > 0) {
            const shownItems = candidates.map((c) => ({
              addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
              listingUrl: c.listingUrl ?? null,
              address: c.address ?? null,
              suburb: suburb ?? null,
            }));
            runAfterResponse(
              recordShownForAnonymous(anonymousIdentityHash, shownItems).catch((err) =>
                req.log.warn({ err }, "Discovery: failed to record anonymous shown memory"),
              ),
            );
          }

          if (!chatUserId && anonymousIdentityHash) {
            runAfterResponse(
              recordAnonymousDiscoveryEvent({
                installHash: anonymousIdentityHash,
                ipHash: anonymousIpHash,
                mode: plainListingBrowse ? "generic_listing" : "scored_screening",
                suburb,
                // Analytics keeps the real extracted criteria (criteriaLabel is now
                // a canonical display label, not the user's actual ask).
                criteria: intent.criteria ?? null,
                locale: chatLocale,
                query: userText,
                resultCount: candidates.length,
              }).catch((err) =>
                req.log.warn({ err }, "Discovery: failed to record anonymous discovery event"),
              ),
            );
          }

          const continuationToken = !noListings
            ? await createDiscoveryContinuation({
                ownerKey: continuationOwnerKey(chatUserId, anonymousIdentityHash),
                presentation: plainListingBrowse ? "generic_listing" : "scored_screening",
                suburb: continuationSuburb,
                minPrice: effectiveMinPrice,
                maxPrice: effectiveMaxPrice,
                cacheKey: continuationCacheKey ?? "",
                criteria: discoveryCriteria,
                preScreenOpts: continuationPreScreenOpts ?? {},
                initialCandidates: candidates,
                nearbyQueue: continuationNearbyQueue,
                originSuburb: continuationOriginSuburb,
                queueSource,
                pageOffset: continuationPageOffset,
                pageTotal: continuationPageTotal,
                pageDone: continuationPageDone,
                requireSourceBackedPrice: userTextHasPrice,
                log: req.log,
              }).catch((err) => {
                req.log.warn({ err }, "Discovery continuation: failed to create token");
                return null;
              })
            : null;

          req.log.info(
            {
              suburb: continuationSuburb,
              resultCount: candidates.length,
              continuationCreated: Boolean(continuationToken),
              remainingPool: continuationCacheKey ? getRemainingCount(continuationCacheKey) : 0,
              pageDone: continuationPageDone,
              pageOffset: continuationPageOffset,
              pageTotal: continuationPageTotal,
              requireSourceBackedPrice,
            },
            "Discovery: response assembled",
          );

          // Structured version of the "I left out N cross-lease" offer so the
          // client can render a deterministic "Show the N cross-lease" chip
          // (the free-text reply path still works). Mirrors the tenureReminder
          // condition: tenures that were dropped this turn and not yet opted in.
          const tenureOfferEntries = (["cross_lease", "leasehold", "unit_title"] as const)
            .filter((tn) => excludedTenureTotals[tn] > 0 && !tenureOptIns.includes(tn))
            .map((tn) => ({ tenure: tn, count: excludedTenureTotals[tn] }));
          const responsePayload = JSON.stringify({
            candidates,
            isMockData,
            suburb: continuationSuburb,
            dataSource,
            noListings,
            aiIntro,
            searchPresentation,
            continuationToken,
            tenureOffer: tenureOfferEntries.length > 0
              ? { suburb: continuationSuburb, entries: tenureOfferEntries }
              : undefined,
          });
          const translatedContent = await translateChatContent(responsePayload, "discover", chatLocale, chatTranslateTitleSchool);
          // Durably persist the offered (excluded) non-freehold listings so a
          // later "include them" reply can re-screen them even on a cold instance.
          if (excludedNonFreeholdThisTurn.length > 0) {
            runAfterResponse(
              persistExcludedNonFreehold({
                ownerKey: continuationOwnerKey(chatUserId, anonymousIdentityHash),
                suburb,
                cacheKey: continuationCacheKey,
                items: excludedNonFreeholdThisTurn,
              }).catch((err) => req.log.warn({ err }, "Discovery: failed to persist excluded non-freehold")),
            );
          }
          res.json({ content: translatedContent, mode: "discover", ...providerSignal });
          return;
        } catch (err) {
          req.log.warn({ err }, "Discovery mode error — falling through to AI");
        }
      }

      if (effectiveMode === "analyse") {
        const explicitCombinedPackage = resolveCombinedPackage(userText);
        if (explicitCombinedPackage) {
          req.log.info(
            { packageAddress: explicitCombinedPackage.packageAddress, childAddresses: explicitCombinedPackage.childAddresses },
            "Chat analyse: running combined listing package analysis",
          );
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Accel-Buffering", "no");
          let heartbeatFired = false;
          const heartbeat = setInterval(() => {
            try {
              if (!res.writableEnded) { res.write(" "); heartbeatFired = true; }
            } catch { /* ignore */ }
          }, 8_000);
          const sendCombinedAnalyseResponse = (data: object) => {
            clearInterval(heartbeat);
            if (res.writableEnded) return;
            const payload = { ...data, ...providerSignal };
            if (heartbeatFired) {
              try { res.write(JSON.stringify(payload)); res.end(); } catch { /* ignore */ }
            } else {
              res.json(payload);
            }
          };

          try {
            const result = await runCombinedFeasibilityGroupCore({
              packageAddress: explicitCombinedPackage.packageAddress,
              childAddresses: explicitCombinedPackage.childAddresses,
              locale: chatLocale,
              translateTitleSchool: chatTranslateTitleSchool,
              conversationHistory: messages,
              userId: chatUserId,
              log: req.log,
            });
            const translatedContent = await translateChatContent(
              JSON.stringify(result.reportGroup),
              "analyse",
              chatLocale,
              chatTranslateTitleSchool,
            );
            sendCombinedAnalyseResponse({
              content: translatedContent,
              mode: "analyse",
              searchId: result.savedSearchId,
              historyCreatedAt: result.savedSearchCreatedAt,
            });
          } catch (err) {
            clearInterval(heartbeat);
            req.log.error({ err }, "Chat combined listing package analysis failed");
            if (!res.writableEnded) {
              res.status(500).json({ error: "Combined listing package analysis failed" });
            }
          }
          return;
        }

        // Address priority:
        // 0. A short suburb/text correction to a just-offered subdivision
        //    clarification (e.g. "Birkenhead" after being asked to pick
        //    between "4A/4B Inglis Street, Mosgiel") — merged with the parent
        //    street+number from that clarification.
        // 1. LLM extracted it directly from the current message (validated against hallucination)
        // 2. extractNZAddress regex on the current message
        // 3. extractNZAddress on prior history messages
        // 4. Raw address-like text from the user's message (last resort — strips
        //    non-address prefixes and sends the remaining tokens to the geocoder)
        const pastedSelectedListingContext =
          pastedListingResolution.status === "resolved"
            ? normaliseSelectedListingContext(pastedListingResolution.context)
            : null;
        let extractedAddress: string | null =
          pendingSubdivisionCorrection?.mergedAddress ??
          (pastedListingResolution.status === "resolved"
            ? pastedListingResolution.address
            : forcedAnalyseAddress ?? null);

        if (!extractedAddress) {
          extractedAddress = await extractNZAddress(userText).catch(() => null);
        }

        if (!extractedAddress) {
          for (const msg of [...messages].reverse()) {
            if (msg.role === "user" && msg.content !== userText) {
              const prev = await extractNZAddress(msg.content).catch(() => null);
              if (prev) { extractedAddress = prev; break; }
            }
          }
        }

        // Last-resort: if no extractor found an address but the intent is
        // clearly "analyse" and the message contains something that looks like
        // a street address, extract it with a simple regex. This catches cases
        // where the LLM hallucinated (and was caught above) and
        // extractNZAddress also failed because the suburb wasn't in its regex.
        if (!extractedAddress && looksLikeStreetAddress(userText)) {
          const addrMatch = userText.match(
            /\b((?:[a-z]?\d+[a-z]?\s*\/\s*)?\d+[a-zA-Z]?\s+[\w''-]+(?:\s+[\w''-]+){0,5}\s+(?:road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)(?:\s+[\w''-]+){0,3})\b/i,
          );
          if (addrMatch) {
            extractedAddress = addrMatch[1].trim();
            req.log.info(
              { rawExtracted: extractedAddress },
              "Address: LLM + extractNZAddress both failed — using raw regex from user text",
            );
          }
        }

        // ── Safety-net guard: if the extracted address matches the already-analysed
        // currentReport (i.e. this is a follow-up, not a new property), and the user
        // has NOT explicitly asked to re-run the analysis, skip the pipeline entirely
        // and fall through to generateUnifiedResponse which uses the confirmed report data.
        // This prevents external API inconsistencies (e.g. different zone labels on repeat
        // fetches) from overwriting the verified data shown to the user in the same session.
        const RE_ANALYSE_TRIGGERS = /\b(re-?analy[sz]e|redo|run again|analy[sz]e again|new analysis|re-?run|fresh analysis)\b/i;
        if (extractedAddress && currentReport && !RE_ANALYSE_TRIGGERS.test(userText)) {
          const r = currentReport as Record<string, unknown>;
          const reportAddr: string | null =
            (r["address"] as string | null) ??
            ((r["propertyOverview"] as Record<string, unknown> | undefined)?.["address"] as string | null) ??
            null;
          if (reportAddr) {
            const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (normalise(reportAddr) === normalise(extractedAddress)) {
              req.log.info(
                { address: extractedAddress },
                "Follow-up about already-analysed property — skipping pipeline, using currentReport",
              );
              // Fall through to generateUnifiedResponse below (mode will be treated as followup)
              const { content, mode: responseMode } = await generateUnifiedResponse(messages, currentReport, "followup", chatLocale);
              const safeContent = content.trim() || emptyChatFallback(chatLocale);
              const safeMode = content.trim() ? responseMode : "text";
              const translated = await translateSafeChatContent(safeContent, safeMode);
              res.json({ content: translated, mode: safeMode, ...providerSignal });
              return;
            }
          }
        }

        const aiResponseEarly = null;
        void aiResponseEarly;

        if (extractedAddress) {
          // ── Subdivision pre-check ─────────────────────────────────────────
          // Same logic as the direct /analyse route — bail before the heavy
          // pipeline if the parent number was actually subdivided.
          const subdivision = await detectSubdivision(extractedAddress).catch(() => null);
          if (subdivision?.isSubdivided) {
            const subdivisionPayload = JSON.stringify({
              clarificationType: "subdivision",
              question: `"${extractedAddress}" looks like it has been subdivided into separate lots. Which one would you like me to analyse?`,
              options: subdivision.subLots,
              // Lets a later chat turn recover "4 Inglis Street" if the user
              // replies with just a suburb correction (e.g. "Birkenhead")
              // instead of picking one of the options — see
              // detectPendingSubdivisionCorrection.
              parentAddress: subdivision.parentAddress,
            });
            const translatedSubdivision = await translateChatContent(subdivisionPayload, "clarification", chatLocale, chatTranslateTitleSchool);
            res.json({
              content: translatedSubdivision,
              mode: "clarification",
            });
            return;
          }

          const sameTitleAlias = subdivision?.classification === "same_title_aliases";
          const addressResolution = sameTitleAlias
            ? { resolvedAddress: subdivision.canonicalAddress ?? extractedAddress, clarification: null }
            : await resolveAddressForAnalysis(extractedAddress, chatLocale);
          if (addressResolution.clarification) {
            const addressPayload = JSON.stringify(addressResolution.clarification);
            const translatedAddress = await translateChatContent(addressPayload, "clarification", chatLocale, chatTranslateTitleSchool);
            res.json({
              content: translatedAddress,
              mode: "clarification",
            });
            return;
          }
          const analysisAddress = addressResolution.resolvedAddress || extractedAddress;

          req.log.info({ address: analysisAddress, originalAddress: extractedAddress }, "Running property pipeline for analyse mode");

          // Keep-alive heartbeat — sends a silent space every 8 s so the reverse
          // proxy doesn't close the connection during the long pipeline + LLM run.
          // The client uses resp.json() which buffers the full body; JSON.parse
          // ignores leading whitespace so the injected spaces are harmless.
          //
          // IMPORTANT: once res.write() is called the HTTP headers are committed.
          // After that, res.json() will crash with ERR_HTTP_HEADERS_SENT because
          // it tries to re-set Content-Type. We track whether the heartbeat fired
          // and use write+end instead of json() in that case.
          res.setHeader("Content-Type", "application/json");
          res.setHeader("X-Accel-Buffering", "no");
          let heartbeatFired = false;
          const _heartbeat = setInterval(() => {
            try {
              if (!res.writableEnded) { res.write(" "); heartbeatFired = true; }
            } catch { /* ignore */ }
          }, 8_000);

          // Helper: send the final JSON response safely regardless of whether
          // the heartbeat has already committed the response headers.
          const sendAnalyseResponse = (data: object) => {
            clearInterval(_heartbeat);
            if (res.writableEnded) return;
            const payload = { ...data, ...providerSignal };
            if (heartbeatFired) {
              // Headers already committed — write body directly
              try { res.write(JSON.stringify(payload)); res.end(); } catch { /* ignore */ }
            } else {
              res.json(payload);
            }
          };

          const chatAddressKey = normaliseDiscoveryAddressKey(analysisAddress);
          const chatCachedEntry = chatAddressKey ? await getCachedRaw(chatAddressKey) : null;
          if (chatCachedEntry) {
            req.log.info({ addressKey: chatAddressKey, marker: "PROPERTY_CACHE_HIT" }, "Property cache hit — skipping external acquisition");
          }

          const chatSelectedListingContext =
            pastedSelectedListingContext ??
            selectedListingContextFromHistory(conversationHistory);
          const chatPreferredListingUrl =
            chatSelectedListingContext?.listingUrl ??
            selectedListingUrlFromHistory(conversationHistory, analysisAddress);

          let pipelineResult = await runPropertyPipeline(analysisAddress, {
            geocodeFallbackAddress: sameTitleAlias ? subdivision.geocodeFallbackAddress : null,
            preferredRealestateListingUrl:
              chatPreferredListingUrl && /realestate\.co\.nz/i.test(chatPreferredListingUrl)
                ? chatPreferredListingUrl
                : null,
            selectedListingContext: chatSelectedListingContext,
            cachedRaw: chatCachedEntry?.rawData ?? null,
            cachedRawAcquiredAt: chatCachedEntry ? new Date(chatCachedEntry.row.lastRefreshedAt as unknown as string | Date).toISOString() : null,
          }).catch((err) => {
            req.log.warn({ err }, "Pipeline failed — falling back to AI-only analysis");
            return null;
          });

          // Conflict-triggered cache invalidation — see the feasibility-core
          // call site for rationale (live listing claims vs cached records).
          let chatForcedLiveRefresh = false;
          if (pipelineResult?.redevelopmentCheck?.suspected && pipelineResult.served_from_cache) {
            req.log.info(
              { addressKey: chatAddressKey, reasons: pipelineResult.redevelopmentCheck.reasons, marker: "PROPERTY_CACHE_CONFLICT_REFRESH" },
              "Redevelopment suspected on cached data — forcing live re-acquisition",
            );
            const fresh = await runPropertyPipeline(analysisAddress, {
              geocodeFallbackAddress: sameTitleAlias ? subdivision.geocodeFallbackAddress : null,
              preferredRealestateListingUrl:
                chatPreferredListingUrl && /realestate\.co\.nz/i.test(chatPreferredListingUrl)
                  ? chatPreferredListingUrl
                  : null,
              selectedListingContext: chatSelectedListingContext,
              cachedRaw: null,
            }).catch((err) => {
              req.log.warn({ err }, "Forced live re-acquisition failed — keeping cached-data result");
              return null;
            });
            if (fresh) {
              pipelineResult = fresh;
              chatForcedLiveRefresh = true;
            }
          }

          const chatDisplayAddress = pipelineResult ? displayAddressForAnalysis(analysisAddress, pipelineResult) : analysisAddress;

          if (pipelineResult && chatAddressKey) {
            if (chatCachedEntry && !chatForcedLiveRefresh) {
              void bumpHitCount(chatAddressKey);
              // Backfill real scores onto old or scoreless cached rows so
              // screening cards match the report without resetting freshness.
              if (shouldBackfillDerivedScores(chatCachedEntry.rawData.derived_scores, pipelineResult.raw_property?.derived_scores)) {
                void backfillDerivedScores(chatAddressKey, pipelineResult.raw_property.derived_scores);
                upsertFeatureRowFromPipeline(pipelineResult, {
                  addressKey: chatAddressKey,
                  lastRefreshedAt: new Date(chatCachedEntry.row.lastRefreshedAt as unknown as string | Date),
                  pipelineVersion: chatCachedEntry.row.pipelineVersion,
                });
              }
            } else if (hasCacheableCore(pipelineResult) && pipelineResult.raw_property) {
              await upsertCachedRaw({
                addressKey: chatAddressKey,
                rawData: pipelineResult.raw_property,
                canonicalParcelId: pipelineResult.linz_parcel?.parcel_id ?? null,
                canonicalTitleId: pipelineResult.linz_parcel?.title_no ?? pipelineResult.linz_title?.title_no ?? null,
                formattedAddress: chatDisplayAddress,
                lat: pipelineResult.geocode?.lat ?? null,
                lng: pipelineResult.geocode?.lng ?? null,
                suburb: pipelineResult.suburb ?? null,
                sourceUserId: chatUserId,
              });
              upsertFeatureRowFromPipeline(pipelineResult, {
                addressKey: chatAddressKey,
                lastRefreshedAt: new Date(),
                pipelineVersion: PIPELINE_VERSION,
              });
            }
          }

          if (pipelineResult) {
            const deterministicReport = buildDeterministicFallbackReport(
              pipelineResult,
              chatDisplayAddress,
            );

            if (deterministicReport) {
              applySelectedListingContextToReport(
                deterministicReport,
                chatSelectedListingContext ?? pipelineResult.selectedListingContext,
              );
              let savedSearchId: string | null = null;
              let savedSearchCreatedAt: string | null = null;

              if (chatUserId) {
                try {
                  const [row] = await db.insert(searches).values({
                    userId: chatUserId,
                    query: extractedAddress,
                    address: chatDisplayAddress,
                    resultJson: deterministicReport as any,
                  }).returning({ id: searches.id, createdAt: searches.createdAt });
                  savedSearchId = row?.id ?? null;
                  savedSearchCreatedAt = row?.createdAt ? new Date(row.createdAt as unknown as string).toISOString() : null;
                  req.log.info({ address: analysisAddress, originalAddress: extractedAddress }, "Chat deterministic analysis saved to history");
                } catch (err) {
                  req.log.error({ err }, "Failed to save deterministic chat analysis to history");
                }
              }

              const postAnalysisAnswers = await buildPostAnalysisAnswersForReport(userText, deterministicReport, chatLocale, req.log);
              // `content` stays a stringified report so legacy clients (which
              // render the card by parsing content JSON) keep working; zh users
              // get the narrative translated while the JSON stays parseable.
              const deterministicContent = await translateChatContent(
                JSON.stringify(deterministicReport),
                "analyse",
                chatLocale,
                chatTranslateTitleSchool,
              );
              sendAnalyseResponse({
                content: deterministicContent,
                mode: "analyse",
                report: deterministicReport,
                searchId: savedSearchId,
                historyCreatedAt: savedSearchCreatedAt,
                ...postAnalysisPayload(postAnalysisAnswers),
              });
              return;
            }

            const failedStr =
              pipelineResult.failed_sources.length > 0
                ? `\nFailed sources (treat as unknown): ${pipelineResult.failed_sources.join(", ")}`
                : "";

            const {
              merged, geocode, linz_parcel, contour, property_history, asbestos,
              asbestos_detail, lots, costs, comparables, comparables_quality,
              scenarios, scores, suburb, easements, developmentStrategies,
              subdivision_pathway,
            } = pipelineResult;

            let enrichedContent: string;

            if (merged && lots && costs && scores) {
              const interestOutlook = scenarios[0]?.interest_rate_outlook ?? "stable";
              const scenarioLines = scenarios.length > 0
                ? scenarios.map((s) => {
                    const caseLines = (s.cases ?? []).map((c) =>
                      `    [${c.case.toUpperCase()}] GDV $${formatNZD(c.gdv)} (×${c.gdv_multiplier.toFixed(2)}), ` +
                      `Profit $${formatNZD(c.gross_profit)}, ROI ${c.roi_percent.toFixed(1)}%, ` +
                      `Ann. ${c.annualised_roi_percent.toFixed(1)}% p.a., Viable: ${c.viable}`
                    ).join("\n");
                    return `  ${s.years}-year (base GDV $${formatNZD(s.gdv)}, cost $${formatNZD(s.total_cost_mid)}):\n${caseLines}`;
                  }).join("\n")
                : "  ROI scenarios unavailable — no real fetched comparable sales were available. Do not estimate GDV or ROI.";

              const cvNzd = costs.land_cv_nzd ?? 0;
              const cvNote = cvNzd > 0
                ? `$${formatNZD(cvNzd)} (confirmed from ${(merged as any).data_sources?.cv_nzd || "Hougarden/OneRoof"})`
                : `NOT AVAILABLE from any data source — cv_unavailable is TRUE. Set propertyOverview.cv to null in the JSON output. ROI calculations exclude land cost.`;

              const cvSource = (merged as any).data_sources?.cv_nzd ?? null;
              const landSource = (merged as any).data_sources?.land_area_sqm ?? null;
              const floorSource = (merged as any).data_sources?.floor_area_sqm ?? null;
              const contourSlope = (merged as any).contour_slope_degrees ?? null;
              const contourSrc = (merged as any).contour_source ?? null;
              const contourTxt = (merged as any).contour_text ?? null;
              const missingCritical = (merged as any).missing_critical_fields ?? [];
              const siteCondition = classifySiteCondition(merged);
              const siteConditionLabel = siteStatusLabel(siteCondition.siteStatus);
              const comparablePrices = comparables.map((c) => c.price_nzd).filter((p) => p > 0);
              const comparablePsms = comparables.map((c) => c.price_per_sqm).filter((p) => p > 0);
              const avgComparableSale = comparablePrices.length > 0
                ? Math.round(comparablePrices.reduce((sum, p) => sum + p, 0) / comparablePrices.length)
                : null;
              const avgComparablePsm = comparablePsms.length > 0
                ? Math.round(comparablePsms.reduce((sum, p) => sum + p, 0) / comparablePsms.length)
                : null;
              const roiExitPriceSource = (merged as any).data_sources?.roi_exit_price ?? null;
              const roiPriceBasis = roiExitPriceSource
                ? "based on the backend's low-confidence subject listing/CV fallback because real comparable sale pricing was unavailable"
                : "based on real fetched comparable data";
              const lotBreakdown = scenarios[0]
                ? `${lots.lots} lots × ${scenarios[0].sqm_per_lot}m² each → estimated ~${formatNZD(scenarios[0].gdv_per_lot)} per lot (${roiPriceBasis})`
                : `${lots.lots} potential lot${lots.lots === 1 ? "" : "s"}; sale price and ROI not calculated because no real comparable sales were fetched`;
              const avgComparableSaleText = avgComparableSale != null
                ? `$${formatNZD(avgComparableSale)}`
                : "unavailable — no real fetched comparable sales";
              const strategyLines = (developmentStrategies ?? []).map((strategy) => {
                const baseHorizon =
                  strategy.roiScenarios.length > 0
                    ? strategy.roiScenarios.reduce((a, b) => (a.years <= b.years ? a : b))
                    : undefined;
                const baseCase = baseHorizon?.cases.find((c) => c.case === "base");
                const roiText = baseCase
                  ? `base ROI ${baseCase.roi_percent.toFixed(1)}%, GDV $${formatNZD(baseCase.gdv)}, profit $${formatNZD(baseCase.gross_profit)}`
                  : "ROI unavailable because no real comparable sale pricing was fetched";
                return `  - ${strategy.title} [${strategy.recommendation}]: ${strategy.rationale} Total cost $${formatNZD(strategy.totalCostLow)}–$${formatNZD(strategy.totalCostHigh)}; ${roiText}.`;
              }).join("\n");
              const recommendedStrategy = developmentStrategies?.find((strategy) => strategy.recommendation === "recommended");

              enrichedContent = `Analyse this NZ property for development feasibility.${failedStr}

ADDRESS: ${chatDisplayAddress}
SUBURB: ${suburb}

OVERLAY DATA — AUTHORITATIVE (Auckland Council GIS + Hougarden text analysis):
⚠️  IMPORTANT: planning.overlays MUST contain ONLY the overlays listed below. Do NOT invent "clear" or any other entries for overlays not in this list — absence from GIS/Hougarden means we have no data, not that the overlay is clear.
${merged.overlays.length > 0
  ? merged.overlays.map((o) => `  - ${o.name}: ${o.status.toUpperCase()} — ${o.detail}`).join("\n")
  : "  (no overlays detected by GIS or Hougarden for this property)"}

PROPERTY DATA (from LINZ, Hougarden, OneRoof, Auckland Council GIS):
${JSON.stringify(merged, null, 2)}

PRE-COMPUTED SCORES — copy these numbers exactly, do not recalculate or second-guess them:
  Ease of development: ${scores.ease}/5
  Reasons: ${scores.ease_reasons.join("; ")}

  Cost score: ${scores.cost}/5
  Reasons: ${scores.cost_reasons.join("; ")}

  ROI score: ${scores.roi}/5
  Reasons: ${scores.roi_reasons.join("; ")}

  Composite score: ${scores.composite}/5

SUBDIVISION PATHWAY (pre-computed — copy into subdivisionSummary verbatim, do NOT invent different lot counts):
  Standard vacant-lot path viable: ${subdivision_pathway?.standard_path_viable ?? false}
  Standard vacant lots: ${subdivision_pathway?.standardVacantLots ?? lots.lots}
  Standard minimum lot size: ${subdivision_pathway?.standardMinLotSize ?? lots.min_lot_size}
  Design-led eligible: ${subdivision_pathway?.designLedEligible ?? false}
  Design-led yield range: ${subdivision_pathway?.designLedYieldRange ? `${subdivision_pathway.designLedYieldRange.min}-${subdivision_pathway.designLedYieldRange.max}` : "none"}
  Design-led confidence: ${subdivision_pathway?.designLedConfidence ?? "none"}
  Design-led reasons: ${(subdivision_pathway?.designLedReasons ?? []).join("; ") || "none"}
  Design-led blockers: ${(subdivision_pathway?.designLedBlockers ?? []).join("; ") || "none"}
  Headline: ${subdivision_pathway?.headline ?? "unknown"}
  Detail: ${subdivision_pathway?.detail ?? "See zone rules."}

PRE-COMPUTED FINANCIALS — use verbatim:
  Potential lots: ${lots.lots}
  Zone: ${lots.zone_label} (${merged.zone_code ?? "unknown"})
  Site condition: ${siteConditionLabel} (${siteCondition.siteStatus}); existing dwelling detected: ${siteCondition.hasExistingDwelling}. ${siteCondition.hasExistingDwelling ? "Existing-dwelling options may be considered." : "Do not include demolition or asbestos-removal cost, and do not recommend holding/refurbishing an existing dwelling."}
  Land / CV: ${cvNote}
  Land area: ${merged.land_area_sqm != null ? `${merged.land_area_sqm}m² (confirmed from ${landSource ?? "selected source"})` : "NOT AVAILABLE for the subject property. If this is a unit, do not use parent parcel/site area; set propertyOverview.landArea to null."}
  CV unavailable: ${costs.cv_unavailable}
  Missing critical fields: ${missingCritical.join(", ") || "none"}

  Total development cost (${costs.cv_unavailable ? "EXCLUDES land — CV unavailable" : "INCLUDES land"}):
    Low:  $${formatNZD(costs.total_low)}
    High: $${formatNZD(costs.total_high)}
  Cost per unit (avg): $${formatNZD(costs.cost_per_unit_avg)}

  Lot breakdown: ${lotBreakdown}
  NZ interest rate outlook: ${interestOutlook.toUpperCase()} (RBNZ OCR trajectory)${interestOutlook === "falling" ? " — BULL case enabled (+20% upside)" : ""}

  ROI Scenarios (Bear/Base/Bull cases per time horizon):
${scenarioLines}

  Comparables quality: ${comparables_quality}
  Avg comparable sale: ${avgComparableSaleText}
  ROI exit price source: ${roiExitPriceSource ?? "real fetched comparable sales"}

  Development strategy scenarios (computed — copy these numbers verbatim):
${strategyLines || "  unavailable"}
  Recommended development strategy: ${recommendedStrategy ? `${recommendedStrategy.title} — ${recommendedStrategy.rationale}` : "unavailable"}

ASBESTOS: ${siteCondition.hasExistingDwelling ? `${asbestos_detail.risk} risk - ${asbestos_detail.notes}` : "not applicable - no existing dwelling was detected, so demolition and asbestos removal are not included"}

EASEMENTS & RIGHTS OF WAY (from LINZ title memorials):
Retrieval status: ${easements.retrieval_status}
${easements.retrieval_status === "retrieved"
  ? `Source: LINZ title memorials (table 51695 — NZ Title Memorials List)
Burdening encumbrances: ${easements.burdening.length}
Appurtenant (benefit) easements: ${easements.appurtenant.length}
Has burdening ROW: ${easements.access_row_burdening}
Has burdening drainage easement: ${easements.drainage_burdening}
Has burdening power easement: ${easements.power_burdening}
Has building covenant: ${easements.building_covenant}
Estimated burdening area: ${easements.total_burdening_area_sqm}m²
Net subdividable area after easements: ${merged.land_area_sqm != null ? `${lots.net_area_sqm}m² (gross: ${lots.gross_area_sqm}m²)` : "not available because the subject land area is unknown"}
Lot impact: ${easements.lot_impact_note ?? "None identified"}
Summary: ${easements.summary}
Burdening easements detail:
${easements.burdening.map((e, i) => `  ${i + 1}. [${e.type}] ${e.description} — est. ${e.estimated_area_sqm ?? "?"}m² — severity: ${e.severity}`).join("\n") || "  None"}
Appurtenant easements detail:
${easements.appurtenant.map((e, i) => `  ${i + 1}. [${e.type}] ${e.description}`).join("\n") || "  None"}`
  : easements.retrieval_status === "api_error"
    ? "Easement memorial detail was not available for this automated snapshot. In planning.subdivisionSummary only (never in riskSummary), briefly recommend confirming registered interests on title through normal conveyancing due diligence before subdivision or building consent. Do NOT mention failed APIs, missing fetches, LINZ, or any data-source/provider names."
    : easements.retrieval_status === "no_title"
      ? "Title memorial extract was not attached to this parcel snapshot. In planning.subdivisionSummary only (never in riskSummary), recommend confirming easements and rights of way through standard conveyancing due diligence before consent. Do NOT mention failed lookups, unavailable databases, or provider names."
      : "No burdening memorials were parsed from the supplied title extract for this snapshot — registered interests may still exist. If helpful, note in subdivisionSummary (not riskSummary) that buyers typically verify title with their solicitor before consent. Do NOT attribute this to a named agency or say data failed to load."}

YOUR TASK:
Return a FeasibilityReport JSON using ALL of the above data. Follow this EXACT schema:
{
  "address": "full address",
  "scores": {
    "ease": ${scores.ease}, "cost": ${scores.cost}, "roi": ${scores.roi}, "composite": ${scores.composite},
    "ease_reasons": [${scores.ease_reasons.map((r) => `"${r}"`).join(", ")}],
    "cost_reasons": [${scores.cost_reasons.map((r) => `"${r}"`).join(", ")}],
    "roi_reasons": [${scores.roi_reasons.map((r) => `"${r}"`).join(", ")}]
  },
  "propertyOverview": {
    "address": "...",
    "cv": ${cvNzd > 0 ? `"$${formatNZD(cvNzd)}"` : "null"},
    "landArea": ${merged.land_area_sqm != null ? `"${merged.land_area_sqm}m²"` : "null"},
    "floorArea": "${merged.floor_area_sqm != null ? `${merged.floor_area_sqm}m²` : "null"}",
    "buildYear": ${merged.build_year_range ? `"${merged.build_year_range}"` : (merged.build_year != null ? `"${merged.build_year}"` : "null")},
    "propertyType": ${JSON.stringify(merged.property_type ?? null)},
    "siteStatus": ${JSON.stringify(siteCondition.siteStatus)},
    "siteStatusLabel": ${JSON.stringify(siteConditionLabel)},
    "zone": "...",
    "titleType": ${merged.estate_type ? JSON.stringify(formatTitleTypeForDisplay(merged.estate_type) ?? merged.estate_type) : "null"},
    "titleResolutionSource": ${JSON.stringify(merged.titleResolutionSource ?? "unknown")},
    "typology": ${JSON.stringify(merged.typology ?? "unknown")},
    "typologyConfidence": ${JSON.stringify(merged.typologyConfidence ?? "unknown")},
    "titleConfidence": ${JSON.stringify(merged.titleConfidence ?? "unknown")},
    "subdivisionEligible": ${merged.subdivisionEligible ?? "null"},
    "subdivisionRejectReason": ${merged.subdivisionRejectReason ? JSON.stringify(merged.subdivisionRejectReason) : "null"},
    "listingPrice": null, "isOnMarket": false
  },
  "planning": {
    "zone": "...",
    "minLotSize": "Xm²",
    "potentialLots": ${lots.lots},
    "standardVacantLots": ${subdivision_pathway?.standardVacantLots ?? lots.lots},
    "standardPathViable": ${subdivision_pathway?.standardPathViable ?? subdivision_pathway?.standard_path_viable ?? false},
    "standardMinLotSize": ${subdivision_pathway?.standardMinLotSize ?? (lots.min_lot_size > 0 ? lots.min_lot_size : "null")},
    "designLedEligible": ${subdivision_pathway?.designLedEligible ?? false},
    "designLedYieldRange": ${subdivision_pathway?.designLedYieldRange ? JSON.stringify(subdivision_pathway.designLedYieldRange) : "null"},
    "designLedConfidence": "${subdivision_pathway?.designLedConfidence ?? "none"}",
    "designLedReasons": ${JSON.stringify(subdivision_pathway?.designLedReasons ?? [])},
    "designLedBlockers": ${JSON.stringify(subdivision_pathway?.designLedBlockers ?? [])},
    "designLedSummary": ${JSON.stringify(subdivision_pathway?.designLedSummary ?? null)},
    "designLedDetail": ${JSON.stringify(subdivision_pathway?.designLedDetail ?? null)},
    "grossAreaSqm": ${lots.gross_area_sqm},
    "netAreaSqm": ${lots.net_area_sqm},
    "easementAreaSqm": ${lots.easement_area_sqm},
    "overlays": [/* Copy ONLY from the OVERLAY DATA section above — do NOT add any overlay not listed there */],
    "easements": ${easements.burdening.length > 0
      ? JSON.stringify(easements.burdening.map((e) => ({
          type: e.type,
          burden: e.burden,
          description: e.description,
          estimated_width_m: e.estimated_width_m,
          estimated_area_sqm: e.estimated_area_sqm,
          severity: e.severity,
        })))
      : "[]"},
    "appurtenant_easements": ${easements.appurtenant.length > 0
      ? JSON.stringify(easements.appurtenant.map((e) => ({ type: e.type, description: e.description })))
      : "[]"},
    "easement_data_status": "${easements.retrieval_status}",
    "easement_summary": ${JSON.stringify(easements.summary)},
    "lot_impact_note": ${JSON.stringify(easements.lot_impact_note ?? null)},
    "subdivisionSummary": "...",
    "subdivisionPathwayNote": "${subdivision_pathway?.detail ?? ""}"
  },
  "potential_lots": ${lots.lots},
  "zone_label": "${lots.zone_label}",
  "cv_unavailable": ${costs.cv_unavailable},
  "total_excludes_land": ${costs.cv_unavailable},
  "missing_critical_fields": ${JSON.stringify(missingCritical)},
  "data_sources": {
    "cv_nzd": ${cvSource ? `"${cvSource}"` : "null"},
    "land_area_sqm": ${landSource ? `"${landSource}"` : "null"},
    "floor_area_sqm": ${floorSource ? `"${floorSource}"` : "null"}
  },
  "asbestos": { "buildYear": ${merged.build_year_range ? `"${merged.build_year_range}"` : (merged.build_year != null ? `"${merged.build_year}"` : "null")}, "riskLevel": "${siteCondition.hasExistingDwelling ? asbestos_detail.risk : "low"}", "risk": "${siteCondition.hasExistingDwelling ? asbestos_detail.risk : "low"}", "flagged": ${siteCondition.hasExistingDwelling && asbestos_detail.risk === "high"}, "notes": ${JSON.stringify(siteCondition.hasExistingDwelling ? asbestos_detail.notes : "No existing dwelling was detected, so demolition and asbestos removal have not been included.")}, "worksafe_required": ${siteCondition.hasExistingDwelling && asbestos_detail.risk === "high"}, "demoCostLow": ${costs.demo_low}, "demoCostHigh": ${costs.demo_high} },
  "terrain": {
    "classification": ${merged.contour ? `"${merged.contour}"` : "null"},
    "official_label": ${contourTxt ? `"${contourTxt}"` : "null"},
    "slope_degrees": ${contourSlope ?? "null"},
    "slope": ${merged.contour ? `"${contourTxt ? contourTxt : `~${contourSlope ?? "?"}° slope`} — ${merged.contour}"` : "null"},
    "source": ${contourSrc ? `"${contourSrc}"` : "null"},
    "retainingCostLow": ${costs.retaining_low},
    "retainingCostHigh": ${costs.retaining_high},
    "steep_area_ratio": ${merged.contour_steep_area_ratio ?? "null"},
    "moderate_area_ratio": ${merged.contour_moderate_area_ratio ?? "null"},
    "local_slope_p90_degrees": ${merged.contour_local_slope_p90_degrees ?? "null"},
    "local_slope_p95_degrees": ${merged.contour_local_slope_p95_degrees ?? "null"},
    "sample_count": ${merged.contour_sample_count ?? "null"},
    "retaining_area_sqm_estimate": ${costs.retaining_area_sqm_estimate ?? "null"},
    "large_site_terrain_adjusted": ${costs.large_site_terrain_adjusted ?? merged.large_site_terrain_adjusted ?? false}
  },
  "infrastructure": [ { "name": "Wastewater|Stormwater|Water Supply", "location": "on-parcel|boundary|neighbour|public-land|unknown", "distance_metres": <number or null>, "estimatedCostLow": <NZD or null>, "estimatedCostHigh": <NZD or null>, "risk": "low|moderate|high", "note": "..." } ],
  "costItems": [
    ${cvNzd > 0 ? `{ "label": "Land (CV)", "low": ${cvNzd}, "high": ${cvNzd} },` : `{ "label": "Land (CV — unavailable)", "low": 0, "high": 0 },`}
    { "label": "Demolition", "low": ${costs.demo_low}, "high": ${costs.demo_high} },
    { "label": "Construction", "low": ${costs.construction_low}, "high": ${costs.construction_high} },
    { "label": "Retaining Walls", "low": ${costs.retaining_low}, "high": ${costs.retaining_high} },
    { "label": "TDR/TTR transfer right", "low": ${costs.tdr_ttr_low ?? 0}, "high": ${costs.tdr_ttr_high ?? 0} },
    { "label": "Services & Infrastructure", "low": ${costs.services_low}, "high": ${costs.services_high} },
    { "label": "Consents & Professionals", "low": ${costs.consents_low}, "high": ${costs.consents_high} },
    { "label": "Finance (Holding)", "low": ${costs.finance_low}, "high": ${costs.finance_high} },
    { "label": "Contingency", "low": ${costs.contingency_low}, "high": ${costs.contingency_high} }
  ],
  "totalCostLow": ${costs.total_low},
  "totalCostHigh": ${costs.total_high},
  "cost_per_unit_avg": ${costs.cost_per_unit_avg},
  "interest_rate_outlook": "${interestOutlook}",
  "roiScenarios": [
${scenarios.map((s) => {
  const casesJson = (s.cases ?? []).map((c) =>
    `      { "case": "${c.case}", "label": "${c.label}", "gdv": ${c.gdv}, "gdv_multiplier": ${c.gdv_multiplier.toFixed(2)}, "gross_profit": ${c.gross_profit}, "roi_percent": ${c.roi_percent.toFixed(1)}, "annualised_roi_percent": ${c.annualised_roi_percent.toFixed(1)}, "viable": ${c.viable} }`
  ).join(",\n");
  return `    { "years": ${s.years}, "gdv": ${s.gdv}, "gdv_per_lot": ${s.gdv_per_lot}, "sqm_per_lot": ${s.sqm_per_lot}, "lots": ${s.lots}, "total_cost_mid": ${s.total_cost_mid}, "gross_profit": ${s.gross_profit}, "roi_percent": ${s.roi_percent.toFixed(1)}, "annualised_roi_percent": ${s.annualised_roi_percent.toFixed(1)}, "viable": ${s.viable}, "cv_unavailable": ${costs.cv_unavailable}, "cases": [\n${casesJson}\n    ] }`;
}).join(",\n")}
  ],
  "developmentStrategies": ${JSON.stringify(developmentStrategies ?? [])},
  "recommendedDevelopmentStrategy": ${recommendedStrategy ? `"${recommendedStrategy.id}"` : "null"},
  "comparableSales": ${JSON.stringify(comparables)},
  "comparables_quality": "${comparables_quality}",
  "avg_sale_price": ${avgComparableSale ?? "null"},
  "avgPricePerSqm": ${avgComparablePsm ?? "null"},
  "riskSummary": ["At least 3 bullets, each grounded in THIS property zone/overlays/terrain/infrastructure/lots/title from the facts above — no source-availability wording", "second distinct site or planning point", "third risk or opportunity", "optional fourth", "optional fifth"],
  "disclaimer": "These are indicative estimates only. Always engage a quantity surveyor, lawyer, and urban planner before making any development decisions. Figures in NZD."
}
CRITICAL RULES:
- If cv_unavailable is true: set propertyOverview.cv to null, include a riskSummary note about CV being unavailable.
- If propertyOverview.siteStatus is "vacant_land" or existing dwelling detected is false: do not include demolition or asbestos-removal risk/cost, and do not describe "do nothing" or refurbishment as the recommended development action.
- If terrain.classification is null: terrain data was unavailable — keep it null, do not guess.
- Infrastructure location "unknown" means GIS data was unavailable — keep as "unknown", do not guess.
- comparableSales MUST be exactly the array provided above. If it is empty, keep it empty. roiScenarios MUST still be exactly the pre-computed roiScenarios above when provided; do not delete backend-computed low-confidence CV/listing fallback ROI scenarios. Never invent comparable sale addresses, dates, prices, or ROI sale-price assumptions.
- developmentStrategies MUST be exactly the array provided above. Do not invent strategy ROI numbers or alter the recommendedDevelopmentStrategy.
- Fill in ALL fields. Mark truly unknown fields as null (not empty string, not 0).
- Write riskSummary items as specific, developer-focused 1-sentence statements about THIS property. **Minimum 3 bullets** (prefer 4–5), each clearly tied to the injected zone, overlays, terrain, infrastructure, potential lots, or title — never to whether information was "available", never naming LINZ/Quotable Value/listing portals/council IT systems, and never saying data "failed to fetch" or that due diligence is required *because* automated data was missing.
- NEVER include riskSummary bullets that reference comparable sales, market data availability, exit-price uncertainty, GDV reliability, or any data-source gaps — directly or indirectly. NEVER say that key facts (land area, zoning, planning data) were missing or not obtained, or that site-specific risks cannot be identified because data was incomplete — such bullets are stripped. Any such bullet (e.g. "comparable data is limited", "exit price is hard to predict", "market sales data is scarce") is stripped server-side and degrades the response. riskSummary must describe physical, planning, terrain, flood, coastal, heritage, OR (when potentialLots >= 4) programme/capital intensity — staged construction and sales, long tie-up of capital, absorption risk — without blaming data quality or report completeness. If build year is after 2000, do NOT mention asbestos in riskSummary (server strips these); the asbestos JSON block is sufficient.
- The same rule applies to scores.ease_reasons, scores.cost_reasons, and scores.roi_reasons: never cite missing database matches, unavailable real-time sources, inability to confirm zoning/land area, assumptions about location ("assuming this site…"), missing comparables, or exit-price quantification difficulty — such lines are stripped from the property card.
- When potentialLots from the pipeline is 4 or more: roiScenarios MUST remain exactly as provided in the injected strategies; the modelled timelines already use longer exit horizons for multi-unit schemes. Keep scores.roi_reasons honest about multi-year delivery where relevant (do not imply a quick flip).
- When designLedEligible is true: clearly separate the conservative standard vacant-lot yield from the design-led land-use + subdivision consent opportunity. Use cautious wording like "may be worth testing" and "subject to consent and site layout"; never use "guaranteed", "bypass", or "automatically approved".
- Return ONLY valid JSON, no markdown fences, no other text.`;
            } else {
              const dataSummary = {
                address: chatDisplayAddress,
                suburb,
                geocode: geocode ? { lat: geocode.lat, lng: geocode.lng } : null,
                merged_property: merged,
                contour,
                infrastructure: pipelineResult.infrastructure,
                linz: linz_parcel,
                property_history,
                asbestos,
                data_sources: merged?.data_sources ?? {},
                failed_sources: pipelineResult.failed_sources,
              };

              enrichedContent = `Analyse this NZ property for development feasibility. Real data has been fetched from PropertyValue, Hougarden, OneRoof, LINZ, and Auckland Council GIS sources.${failedStr}

VERIFIED PROPERTY DATA:
${JSON.stringify(dataSummary, null, 2)}

CRITICAL: Land (CV) cost MUST be a realistic NZD estimate based on the suburb, zone, and land area — never use $0. Research current Auckland Council CV rates for the suburb.
CRITICAL: Do not invent comparable sales. If real comparable sales were not fetched, return comparableSales: [], comparables_quality: "unavailable", avg_sale_price: null, and avgPricePerSqm: null. Keep any backend-provided roiScenarios/developmentStrategies exactly as supplied; only leave roiScenarios empty when the backend supplied none.

Generate a complete FeasibilityReport JSON following your system instructions exactly. Use the fetched data as your primary source — prefer confirmed data over estimates. Where data is missing or a source failed, estimate conservatively where appropriate and describe physical/site risks in riskSummary — but NEVER mention comparable sales data, market data gaps, exit-price uncertainty, any data-source limitations, nor any language that implies the report is incomplete or unreliable because land area, zoning, or key planning facts were not captured. Return ONLY valid JSON — no markdown code fences, no other text.`;
            }

            let rawContent = "";
            try {
              rawContent = await generateAnalysis(enrichedContent, chatLocale);
            } catch (err) {
              req.log.warn({ err }, "Analysis model returned no usable report - using deterministic fallback");
            }

            // Inject deterministic source-backed fields. If the model returns
            // empty or malformed output, still send a complete report assembled
            // from the verified pipeline data so the client never renders a
            // blank assistant bubble.
            let content = "";
            let analyseResponseMode = "analyse";
            const parsed = tryParseReportJson(rawContent);
            if (parsed != null) {
              applyDeterministicPipelineOverrides(
                parsed,
                pipelineResult,
                chatDisplayAddress,
                chatLocale,
              );
              applySelectedListingContextToReport(
                parsed,
                chatSelectedListingContext ?? pipelineResult.selectedListingContext,
              );
              content = JSON.stringify(parsed);
            } else {
              const deterministicFallback = buildDeterministicFallbackReport(
                pipelineResult,
                chatDisplayAddress,
              );
              if (deterministicFallback) {
                applySelectedListingContextToReport(
                  deterministicFallback,
                  chatSelectedListingContext ?? pipelineResult.selectedListingContext,
                );
                content = JSON.stringify(deterministicFallback);
              } else if (rawContent.trim()) {
                content = rawContent.trim();
                analyseResponseMode = "text";
              } else {
                content = emptyAnalyseFallback(chatDisplayAddress, chatLocale);
                analyseResponseMode = "text";
              }
            }

            // Persist to search history (non-blocking; invalid/truncated model JSON skips save)
            const chatSaveUserId = await getUserIdFromHeader(req);
            const activeChatSaveUserId = chatSaveUserId === INVALID_AUTH_SESSION ? null : chatSaveUserId;
            let savedSearchId: string | null = null;
            let savedSearchCreatedAt: string | null = null;
            const parsedForSave = tryParseReportJson(content);
            if (activeChatSaveUserId) {
              if (parsedForSave != null) {
                try {
                  const [row] = await db.insert(searches).values({
                    userId: activeChatSaveUserId,
                    query: extractedAddress,
                    address: chatDisplayAddress,
                    resultJson: parsedForSave as any,
                  }).returning({ id: searches.id, createdAt: searches.createdAt });
                  savedSearchId = row?.id ?? null;
                  savedSearchCreatedAt = row?.createdAt ? new Date(row.createdAt as unknown as string).toISOString() : null;
                  req.log.info({ address: analysisAddress, originalAddress: extractedAddress }, "Chat analysis saved to history");
                } catch (err) {
                  req.log.error({ err }, "Failed to save chat analysis to history");
                }
              } else {
                req.log.warn(
                  { query: extractedAddress.slice(0, 80), contentChars: content.length },
                  "Chat analysis not saved — model output was not parseable JSON (often truncation or malformed JSON)",
                );
              }
            }

            const translatedAnalyse = await translateChatContent(content, analyseResponseMode, chatLocale, chatTranslateTitleSchool);
            const postAnalysisAnswers = parsedForSave != null
              ? await buildPostAnalysisAnswersForReport(userText, parsedForSave, chatLocale, req.log)
              : [];
            sendAnalyseResponse({
              content: translatedAnalyse,
              mode: analyseResponseMode,
              ...(parsedForSave != null
                ? (parsedForSave["kind"] === "combined_listing_group"
                  ? { reportGroup: parsedForSave }
                  : { report: parsedForSave })
                : {}),
              searchId: savedSearchId,
              historyCreatedAt: savedSearchCreatedAt,
              ...postAnalysisPayload(postAnalysisAnswers),
            });
            return;
          }
          // pipelineResult was null — generate AI-only response inside the heartbeat
          // context so we can use sendAnalyseResponse (avoids ERR_HTTP_HEADERS_SENT
          // if the heartbeat already committed the response headers).
          try {
            const { content: aiContent, mode: aiMode } = await generateUnifiedResponse(messages, currentReport, effectiveMode, chatLocale);
            const safeContent = aiContent.trim() || emptyAnalyseFallback(analysisAddress, chatLocale);
            const safeMode = aiContent.trim() ? aiMode : "text";
            const translatedAi = await translateSafeChatContent(safeContent, safeMode);
            sendAnalyseResponse({ content: translatedAi, mode: safeMode });
          } catch {
            const fallback = chatLocale === "zh"
              ? await ensureChinese("Failed to generate reply. Please try again.")
              : "Failed to generate reply. Please try again.";
            sendAnalyseResponse({ error: fallback, code: "CHAT_FAILED" });
          }
          return;
        }

      }

      let content: string;
      let responseMode: string;
      try {
        const generated = await generateUnifiedResponse(messages, currentReport, effectiveMode, chatLocale);
        content = generated.content;
        responseMode = generated.mode;
      } catch (genErr) {
        // Every model attempt failed (provider outage, timeout, context limit).
        // A follow-up about an open report can still be answered from the stored
        // report data — far better than the client's "couldn't reach the
        // service" retry loop. Anything else gets an honest, retryable message.
        req.log.error({ err: genErr, effectiveMode }, "Chat reply generation failed on every model");
        const offlineAnswer =
          effectiveMode === "followup"
            ? buildReportFollowUpFallback(userText, (currentReport ?? null) as Record<string, unknown> | null, chatLocale)
            : null;
        if (offlineAnswer) {
          res.json({ content: sanitizeAssistantProse(offlineAnswer, chatLocale), mode: "text", ...providerSignal });
          return;
        }
        const unavailable =
          chatLocale === "zh"
            ? "AI 助手暂时不可用，请稍后重试。"
            : "The AI assistant is temporarily unavailable. Please try again in a moment.";
        res.status(503).json({ error: unavailable, message: unavailable, code: "AI_UNAVAILABLE" });
        return;
      }

      // Safety net A: if the AI said "I'm searching..." but the discover pipeline didn't run,
      // extract the suburb from the AI's text and actually run the search now.
      const isSearchingPhrase = /\b(searching|i'm searching|i am searching|let me search|looking for properties|i'll search|i will search)\b/i.test(content);
      if (isSearchingPhrase && responseMode !== "discover") {
        // Try the user text first (most reliable), then scan the AI's response for a known suburb,
        // then try a last-resort phrase extraction from user text for unmapped suburbs.
        const { suburb: userSuburb, minPrice, maxPrice } = await parseDiscoverParams(userText);
        const aiHit = userSuburb == null ? await findLocationInTextViaIndex(content) : null;
        const suburb = userSuburb ?? (
          aiHit?.status === "suburb" ? aiHit.suburb.title.toLowerCase()
            : aiHit?.status === "district" ? aiHit.district.title.toLowerCase()
              : aiHit?.status === "region" ? aiHit.region.title.toLowerCase()
              : null
        );
        const safetyNetCriteria = buildDiscoveryCriteriaText(messages, userText, null);
        const safetyNetFollowUp = isDiscoverStreetContinuation(userText);
        const searchPresentationSafetyNet = resolveDiscoveryPresentation({
          userText,
          discoveryCriteria: safetyNetCriteria,
          intent,
          messages,
          isFollowUp: safetyNetFollowUp,
          continuePresentation,
          repeatShownAreaIntent,
          forceNearbyDiscovery,
        });
        let plainListingBrowseSafetyNet = searchPresentationSafetyNet === "generic_listing";
        if (continuePresentation) {
          // Explicit "Show more" button signal — honour it directly (same as discover flow above)
          plainListingBrowseSafetyNet = continueGenericListing;
        } else if (!plainListingBrowseSafetyNet && safetyNetFollowUp) {
          // Inherit presentation type from history on typed continuation signals (same logic as discover flow above)
          for (const msg of [...messages].reverse()) {
            if (msg.role !== "user" || !msg.content) continue;
            const prevText = msg.content;
            if (prevText === userText) continue;
            if (isDiscoverStreetContinuation(prevText) && !isListingBrowseIntent(prevText)) continue;
            if (hasNumberedStreetAddress(prevText)) continue; // skip single-property analyse drill-downs
            if (isPlainListingBrowseWithoutDevelopment(prevText)) plainListingBrowseSafetyNet = true;
            break;
          }
        }
        plainListingBrowseSafetyNet = searchPresentationSafetyNet === "generic_listing";
        const wantsDevelopmentSafetyNet = !plainListingBrowseSafetyNet && isDevelopmentDiscoveryIntent(safetyNetCriteria);
        const strictStandardSubdivisionSafetyNet = !plainListingBrowseSafetyNet && isStandardSubdivisionDiscoveryIntent(safetyNetCriteria);
        const includeNegotiation = wantsDevelopmentSafetyNet || /negotiat|without\s+price|no\s+price|poa|tender|auction/i.test(userText);

        if (suburb) {
          req.log.info({ suburb, aiContent: content.slice(0, 100) }, "AI said 'searching' — running actual discover pipeline");
          try {
            const streetHintSn = extractDiscoverStreetHintFromThread(
              messages,
              userText,
              isDiscoverStreetContinuation(userText),
            );
            const cacheKey = makeCacheKey(suburb, minPrice, maxPrice, streetHintSn);
            const shownUrls = Array.from(new Set([
              ...getShownUrls(cacheKey),
              ...alreadyShownUrlsFromHistory,
            ]));
            const requireSourceBackedPriceSn = hasExplicitPriceConstraint(userText);
            const discoverPreOptsSn = {
              allowMissingListingPrice: true,
              pricePlaceholderNzd: wantsDevelopmentSafetyNet
                ? 3_500_000
                : Math.max(600_000, Math.round((minPrice + maxPrice) / 2)),
              strictStandardSubdivision: strictStandardSubdivisionSafetyNet,
              preliminarySubdivision: strictStandardSubdivisionSafetyNet,
              developmentScreening: !plainListingBrowseSafetyNet && !strictStandardSubdivisionSafetyNet,
            };
            const safetyNetTargetCount = discoverPreOptsSn.strictStandardSubdivision ? 1 : 3;
            const safetyNetScreenConcurrency = discoverPreOptsSn.strictStandardSubdivision ? 1 : 5;
            const safetyNetBatchSize = discoverPreOptsSn.strictStandardSubdivision ? 1 : 8;
            const searchResult = await searchRealEstateListings({
              suburb, minPrice, maxPrice, skipUrls: shownUrls, includeNegotiation,
              firstBatchSize: wantsDevelopmentSafetyNet ? 24 : undefined,
              // Windowed fetch (no hard cap) to bound latency — this safety-net
              // branch shows a one-shot result and builds no continuation.
              maxPages: plainListingBrowseSafetyNet ? GENERIC_PAGE_WINDOW : SUBDIVISION_PAGE_WINDOW,
            }).catch(() => null);

            if (searchResult && searchResult.firstBatch.length > 0) {
              const firstRanked = orderListingsByPriceTier(searchResult.firstBatch, minPrice, maxPrice, discoverPreOptsSn.strictStandardSubdivision, requireSourceBackedPriceSn);
              const remainingRanked = orderListingsByPriceTier(searchResult.remainingListings, minPrice, maxPrice, discoverPreOptsSn.strictStandardSubdivision, requireSourceBackedPriceSn);
              const firstFiltered = filterAlreadyShownListings(rankListingsByStreetHint(
                filterListingsByStreetHint(firstRanked, streetHintSn),
                streetHintSn,
              ), alreadyShownAddressKeys);
              const remainingFiltered = filterAlreadyShownListings(rankListingsByStreetHint(
                filterListingsByStreetHint(remainingRanked, streetHintSn),
                streetHintSn,
              ), alreadyShownAddressKeys);
              const priorShownSn = [...getShownUrls(cacheKey)];
              setListingCache(cacheKey, {
                remainingListings: remainingFiltered,
                shownUrls: priorShownSn,
                suburb, minPrice, maxPrice,
              });
              if (plainListingBrowseSafetyNet) {
                let discoverCandidates = pickGenericListingCandidates(firstFiltered, alreadyShownAddressKeys, safetyNetTargetCount);
                markShown(
                  cacheKey,
                  discoverCandidates.map((c) => c.listingUrl).filter((u): u is string => Boolean(u)),
                );
                discoverCandidates = topUpGenericListingCandidates(
                  cacheKey,
                  discoverCandidates,
                  alreadyShownAddressKeys,
                  safetyNetTargetCount,
                  safetyNetBatchSize,
                );

                discoverCandidates = sanitizeDiscoveryCandidates(discoverCandidates);
                discoverCandidates = await mergeSponsoredGenericListingCandidate({
                  candidates: discoverCandidates,
                  suburb,
                  minPrice,
                  maxPrice,
                  isFollowUp: isDiscoverStreetContinuation(userText),
                  shownAddressKeys: alreadyShownAddressKeys,
                  userId: chatUserId,
                  targetCount: safetyNetTargetCount,
                  log: req.log,
                });
                discoverCandidates = await hydrateGenericListingAgentDetails(discoverCandidates, req.log);

                if (discoverCandidates.length > 0) {
                  if (chatUserId) {
                    const shownItems = discoverCandidates.map((c) => ({
                      addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
                      listingUrl: c.listingUrl ?? null,
                      address: c.address ?? null,
                      suburb: suburb ?? null,
                    }));
                    runAfterResponse(
                      recordShownForUser(chatUserId, shownItems).catch((err) =>
                        req.log.warn({ err }, "Discovery: failed to record account-level shown memory (safety net generic)"),
                      ),
                    );
                  } else if (anonymousIdentityHash) {
                    const shownItems = discoverCandidates.map((c) => ({
                      addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
                      listingUrl: c.listingUrl ?? null,
                      address: c.address ?? null,
                      suburb: suburb ?? null,
                    }));
                    runAfterResponse(
                      recordShownForAnonymous(anonymousIdentityHash, shownItems).catch((err) =>
                        req.log.warn({ err }, "Discovery: failed to record anonymous shown memory (safety net generic)"),
                      ),
                    );
                  }
                  if (!chatUserId && anonymousIdentityHash) {
                    runAfterResponse(
                      recordAnonymousDiscoveryEvent({
                        installHash: anonymousIdentityHash,
                        ipHash: anonymousIpHash,
                        mode: "generic_listing",
                        suburb,
                        criteria: safetyNetCriteria || null,
                        locale: chatLocale,
                        query: userText,
                        resultCount: discoverCandidates.length,
                      }).catch((err) =>
                        req.log.warn({ err }, "Discovery: failed to record anonymous discovery event (safety net generic)"),
                      ),
                    );
                  }
                  const payload = JSON.stringify({
                    candidates: discoverCandidates,
                    isMockData: false,
                    suburb,
                    dataSource: discoverCandidates.some((candidate) => candidate.isSponsored) ? "Project Alpha + realestate.co.nz" : "realestate.co.nz",
                    noListings: false,
                    aiIntro: content,
                    searchPresentation: "generic_listing",
                  });
                  const translatedPayload = await translateChatContent(payload, "discover", chatLocale, chatTranslateTitleSchool);
                  res.json({ content: translatedPayload, mode: "discover", ...providerSignal });
                  return;
                }
              }
              const screenedSnDetailed = await preScreenListingsFastDetailed(
                firstFiltered,
                safetyNetScreenConcurrency,
                null,
                discoverPreOptsSn.strictStandardSubdivision
                  ? { ...discoverPreOptsSn, earlyBailAt: safetyNetTargetCount }
                  : discoverPreOptsSn,
              ).catch(
                () => ({ candidates: [] as PropertyCandidate[], indeterminate: [] as ListingResult[], excludedTenures: { cross_lease: 0, leasehold: 0, unit_title: 0 }, excludedNonFreehold: [], drainComplete: Promise.resolve() }),
              );
              if (discoverPreOptsSn.strictStandardSubdivision) {
                runAfterResponse(screenedSnDetailed.drainComplete.catch(() => {}));
              }
              const screenedSn = screenedSnDetailed.candidates;
              let discoverCandidates = pickDiscoveryCandidates(screenedSn, safetyNetCriteria, alreadyShownAddressKeys, safetyNetTargetCount);
              markShown(
                cacheKey,
                discoverCandidates.map((c) => c.listingUrl).filter((u): u is string => Boolean(u)),
              );
              const { putAtFront: snFront, putAtBack: snBack } = partitionBatchAfterPrescreen(
                firstFiltered,
                screenedSn,
                discoverCandidates,
                safetyNetCriteria,
                alreadyShownAddressKeys,
              );
              restoreListingsAfterPop(cacheKey, snFront, snBack);

              discoverCandidates = await topUpDiscoveryCandidates(
                cacheKey,
                discoverCandidates,
                safetyNetCriteria,
                discoverPreOptsSn,
                alreadyShownAddressKeys,
                {
                  batchSize: safetyNetBatchSize,
                  nonStrictAttemptLimit: 6,
                  targetCount: safetyNetTargetCount,
                },
              );

              // Final display guard (same as the main discovery path).
              discoverCandidates = sanitizeDiscoveryCandidates(discoverCandidates);
              if (plainListingBrowseSafetyNet) {
                discoverCandidates = await mergeSponsoredGenericListingCandidate({
                  candidates: discoverCandidates,
                  suburb,
                  minPrice,
                  maxPrice,
                  isFollowUp: isDiscoverStreetContinuation(userText),
                  shownAddressKeys: alreadyShownAddressKeys,
                  userId: chatUserId,
                  targetCount: safetyNetTargetCount,
                  log: req.log,
                });
                discoverCandidates = await hydrateGenericListingAgentDetails(discoverCandidates, req.log);
              }

              if (discoverCandidates.length > 0) {
                const safetyNetDataSource = plainListingBrowseSafetyNet && discoverCandidates.some((candidate) => candidate.isSponsored)
                  ? "Project Alpha + realestate.co.nz"
                  : "realestate.co.nz";
                if (!plainListingBrowseSafetyNet) {
                  queueBackgroundScores(
                    discoverCandidates.map((c) => ({
                      address: c.address,
                      listingUrl: c.listingUrl,
                      price: c.price,
                      landArea: c.landArea,
                      landAreaConfidence: c.landAreaConfidence,
                      isAlreadySubdividedChild: c.isAlreadySubdividedChild,
                      zone: c.zone,
                      buildYear: c.buildYear,
                      typology: c.typology,
                      titleConfidence: c.titleConfidence,
                      subdivisionEligible: c.subdivisionEligible,
                      subdivisionRejectReason: c.subdivisionRejectReason,
                    })),
                  );
                }
                if (chatUserId) {
                  const shownItems = discoverCandidates.map((c) => ({
                    addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
                    listingUrl: c.listingUrl ?? null,
                    address: c.address ?? null,
                    suburb: suburb ?? null,
                  }));
                  runAfterResponse(
                    recordShownForUser(chatUserId, shownItems).catch((err) =>
                      req.log.warn({ err }, "Discovery: failed to record account-level shown memory (safety net)"),
                    ),
                  );
                } else if (anonymousIdentityHash) {
                  const shownItems = discoverCandidates.map((c) => ({
                    addressKey: c.internalListingId ? internalSponsoredAddressKey(c.internalListingId) : normaliseDiscoveryAddressKey(c.address),
                    listingUrl: c.listingUrl ?? null,
                    address: c.address ?? null,
                    suburb: suburb ?? null,
                  }));
                  runAfterResponse(
                    recordShownForAnonymous(anonymousIdentityHash, shownItems).catch((err) =>
                      req.log.warn({ err }, "Discovery: failed to record anonymous shown memory (safety net)"),
                    ),
                  );
                }
                if (!chatUserId && anonymousIdentityHash) {
                  runAfterResponse(
                    recordAnonymousDiscoveryEvent({
                      installHash: anonymousIdentityHash,
                      ipHash: anonymousIpHash,
                      mode: plainListingBrowseSafetyNet ? "generic_listing" : "scored_screening",
                      suburb,
                      criteria: safetyNetCriteria || null,
                      locale: chatLocale,
                      query: userText,
                      resultCount: discoverCandidates.length,
                    }).catch((err) =>
                      req.log.warn({ err }, "Discovery: failed to record anonymous discovery event (safety net)"),
                    ),
                  );
                }
                const aiIntro = content;
                const payload = JSON.stringify({
                  candidates: discoverCandidates,
                  isMockData: false,
                  suburb,
                  dataSource: safetyNetDataSource,
                  noListings: false,
                  aiIntro,
                  searchPresentation: searchPresentationSafetyNet,
                });
                const translatedPayload = await translateChatContent(payload, "discover", chatLocale, chatTranslateTitleSchool);
                res.json({ content: translatedPayload, mode: "discover", ...providerSignal });
                return;
              }
            }
            // No results — use AI's text as the no-results message
            const noResultMsg = `${content.trim()} Unfortunately, I couldn't find any matching listings right now in ${suburb}. Try a different suburb or adjust your budget.`;
            const translatedNoResult = await translateSafeChatContent(noResultMsg, "text");
            res.json({ content: translatedNoResult, mode: "text" });
            return;
          } catch (searchErr) {
            req.log.warn({ searchErr }, "Fallback discover search failed — using AI text response");
          }
        }
      }

      // Safety net B: catch any raw JSON the AI leaked and re-classify it properly
      if (responseMode !== "discover" && responseMode !== "analyse") {
        const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
        if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
          try {
            const parsed = JSON.parse(cleaned);
            if (parsed && Array.isArray(parsed.candidates)) {
              // Leaked discover JSON — render as property cards
              const translatedLeaked = await translateChatContent(cleaned, "discover", chatLocale, chatTranslateTitleSchool);
              res.json({ content: translatedLeaked, mode: "discover" });
              return;
            }
            if (parsed && (parsed.reportId || (parsed.address && parsed.zoning) || parsed.propertyOverview)) {
              // Leaked feasibility report JSON — render as analyse report
              const translatedReport = await translateChatContent(JSON.stringify(parsed), "analyse", chatLocale, chatTranslateTitleSchool);
              res.json({ content: translatedReport, mode: "analyse" });
              return;
            }
          } catch {
            const isLikelyBrokenJson = /^\s*\{[\s\S]{20,}/.test(cleaned);
            if (isLikelyBrokenJson) {
              const fallbackMsg = "I'm sorry, I couldn't generate that right now. Please try again.";
              const translatedFallback = await translateSafeChatContent(fallbackMsg, "text");
              res.json({ content: translatedFallback, mode: "text" });
              return;
            }
          }
        }
      }

      const finalContent = content.trim() || emptyChatFallback(chatLocale);
      const finalMode = content.trim() ? responseMode : "text";
      const translatedFinal = await translateSafeChatContent(finalContent, finalMode);
      res.json({ content: translatedFinal, mode: finalMode, ...providerSignal });
    } catch (error) {
      req.log.error({ err: error }, "Failed to generate unified chat reply");
      res.status(500).json({
        error: "Failed to generate reply. Please try again.",
        code: "CHAT_FAILED",
      });
    }
    return;
  }

  if (!message) {
    res.status(400).json({ error: "message is required", code: "MISSING_MESSAGE" });
    return;
  }

  try {
    const guardedTrustResponse = assistantTrustResponseFor(message, chatLocale);
    if (guardedTrustResponse) {
      res.json({ message: sanitizeAssistantProse(guardedTrustResponse.content, chatLocale), type: "chat" });
      return;
    }

    const reply = await generateChatReply(
      message,
      conversationHistory || [],
      reportContext,
      chatLocale,
    );
    res.json({ message: sanitizeAssistantProse(reply, chatLocale), type: "chat" });
  } catch (error) {
    req.log.error({ err: error }, "Failed to generate chat reply");
    res.status(500).json({
      error: "Failed to generate reply. Please try again.",
      code: "CHAT_FAILED",
    });
  }
});

// Keep the historical verbose diagnostic available without shadowing the
// canonical /pipeline-test route registered after this router.
router.get("/analyse/pipeline-test-debug", async (req, res) => {
  const address = (req.query["address"] as string) || "8 Hampton Drive St Heliers Auckland";

  req.log.info({ address }, "Pipeline test started");

  try {
    const startedAt = Date.now();
    const pipelineResult = await runPropertyPipeline(address);
    const merged = pipelineResult.merged;
    const diagnostics = {
      failed_sources: pipelineResult.failed_sources,
      data_sources: merged?.data_sources ?? {},
      missing_critical_fields: merged?.missing_critical_fields ?? [],
      coverage: {
        cv_nzd: merged?.cv_nzd ?? null,
        build_year: merged?.build_year ?? null,
        floor_area_sqm: merged?.floor_area_sqm ?? null,
        land_area_sqm: merged?.land_area_sqm ?? null,
      },
      financials: {
        cv_unavailable: pipelineResult.costs?.cv_unavailable ?? null,
        total_excludes_land: pipelineResult.costs?.total_excludes_land ?? null,
        total_low: pipelineResult.costs?.total_low ?? null,
        total_high: pipelineResult.costs?.total_high ?? null,
      },
      lots: pipelineResult.lots
        ? {
            lots: pipelineResult.lots.lots,
            zone_label: pipelineResult.lots.zone_label,
            gross_area_sqm: pipelineResult.lots.gross_area_sqm,
            net_area_sqm: pipelineResult.lots.net_area_sqm,
            easement_area_sqm: pipelineResult.lots.easement_area_sqm,
          }
        : null,
      timing_ms: pipelineResult.timing_ms,
    };

    const debug = {
      address_input: pipelineResult.address_input,
      geocode: pipelineResult.geocode,
      failed_sources: pipelineResult.failed_sources,
      timing_ms: pipelineResult.timing_ms,
      raw_linz_parcel: {
        parcel_id: pipelineResult.linz_parcel?.parcel_id,
        area_sqm: pipelineResult.linz_parcel?.area_sqm,
        title_no: pipelineResult.linz_parcel?.title_no,
      },
      raw_hougarden: {
        cv_nzd: pipelineResult.hougarden?.cv_nzd,
        land_area_sqm: pipelineResult.hougarden?.land_area_sqm,
        floor_area_sqm: pipelineResult.hougarden?.floor_area_sqm,
        build_year: pipelineResult.hougarden?.build_year,
        zone_code: pipelineResult.hougarden?.zone_code,
      },
      raw_oneroof: {
        found: pipelineResult.oneroof?.found,
        cv_nzd: pipelineResult.oneroof?.cv_nzd,
        land_area_sqm: pipelineResult.oneroof?.land_area_sqm,
        floor_area_sqm: pipelineResult.oneroof?.floor_area_sqm,
        build_year: pipelineResult.oneroof?.build_year,
        last_sale_price: pipelineResult.oneroof?.last_sale_price,
      },
      raw_propertyvalue: {
        property_id: pipelineResult.propertyValue?.property_id,
        cv_nzd: pipelineResult.propertyValue?.cv_nzd,
        cv_year: pipelineResult.propertyValue?.cv_year,
        land_area_sqm: pipelineResult.propertyValue?.land_area_sqm,
        floor_area_sqm: pipelineResult.propertyValue?.floor_area_sqm,
        build_year: pipelineResult.propertyValue?.build_year,
        bedrooms: pipelineResult.propertyValue?.bedrooms,
        bathrooms: pipelineResult.propertyValue?.bathrooms,
      },
      raw_contour: pipelineResult.contour,
      merged_final: {
        cv_nzd: pipelineResult.merged?.cv_nzd,
        land_area_sqm: pipelineResult.merged?.land_area_sqm,
        floor_area_sqm: pipelineResult.merged?.floor_area_sqm,
        zone_code: pipelineResult.merged?.zone_code,
        contour: pipelineResult.merged?.contour,
        contour_slope_degrees: pipelineResult.merged?.contour_slope_degrees,
        contour_source: pipelineResult.merged?.contour_source,
        data_sources: pipelineResult.merged?.data_sources,
        missing_critical_fields: pipelineResult.merged?.missing_critical_fields,
      },
      infrastructure: pipelineResult.infrastructure,
      costs_summary: {
        land_cv_nzd: pipelineResult.costs?.land_cv_nzd,
        cv_unavailable: pipelineResult.costs?.cv_unavailable,
        total_low: pipelineResult.costs?.total_low,
        total_high: pipelineResult.costs?.total_high,
        retaining_unknown: pipelineResult.costs?.retaining_unknown,
      },
      roi_first_scenario: pipelineResult.scenarios[0],
    };

    req.log.info(debug, "Pipeline test result");
    res.json({
      status: "ok",
      address,
      elapsed_ms: Date.now() - startedAt,
      diagnostics,
      pipeline: debug,
    });
  } catch (err) {
    req.log.error({ err }, "Pipeline test failed");
    res.status(500).json({ error: String(err) });
  }
});

router.get(
  "/analyse/card-scores",
  // Returns scores for many addresses at once (a prime harvest vector), but is
  // also called as the user scrolls listings — so the cap is generous. The IP
  // cap also covers anonymous callers (no token → no per-account limit).
  ipRateLimit({ name: "card-scores", windowMs: minutes(1), max: 240 }),
  userRateLimit({ name: "card-scores", windowMs: minutes(1), max: 120 }),
  async (req, res) => {
  const raw = req.query.addresses;
  const addresses: string[] = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === "string"
      ? [raw]
      : [];
  const rawUrls = req.query.urls;
  const urls: string[] = Array.isArray(rawUrls)
    ? (rawUrls as string[])
    : typeof rawUrls === "string"
      ? [rawUrls]
      : [];

  if (addresses.length === 0) {
    res.json([]);
    return;
  }

  const results = getCardScores(addresses.map((address, index) => ({
    address,
    listingUrl: urls[index] || null,
  })));
  res.json(results);
});

export default router;
