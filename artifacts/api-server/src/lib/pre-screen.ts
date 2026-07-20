import { logger } from "./logger";
import { geocodeAddress } from "./geocode";
import { scrapeHougarden } from "./scrapers/hougarden";
import type { ZoneResult, Overlay } from "./auckland-council";
import type { ListingResult } from "./scrapers/oneroof";
import { extractCombinedListingAddressParts } from "./scrapers/realestate-api";
import {
  assessSubdivisionPathways,
  calculatePotentialLots,
  type DesignLedConfidence,
  type DesignLedYieldRange,
} from "./lot-calculator";
import { fetchLINZParcel, fetchLINZChildAddressCount, screenAddressFreehold, isLinzTitleServiceAvailable, tenureCategoryFromEstate } from "./linz";
import type { PropertyHistory } from "./property-data";
import { scrapePropertyValue } from "./scrapers/propertyvalue";
import {
  assessPropertyEligibility,
  shouldSuppressParentLandAreaForEligibility,
  type PropertyEligibilityConfidence,
  type PropertyTypology,
} from "./property-eligibility";
import {
  passesPreliminaryStandardSubdivisionScreen,
  passesStrictStandardSubdivisionScreen,
  verifyDiscoveryLandArea,
  type DiscoveryLandAreaConfidence,
  type DiscoveryLandAreaSource,
} from "./discovery-land-area";
import { strictAttributePrefilter } from "./strict-prefilter";
import { extractListingClaims, detectRedevelopmentConflict, hasAmbiguousListingSignals } from "./listing-claims";
import { extractListingClaimsLLM } from "./listing-claims-llm";
import { getScreenVerdict, setScreenVerdict } from "./listing-cache";
import {
  fetchPlanningOverlaysForReport,
  fetchPlanningZoneForReport,
  fetchPropertyHistoryForReport,
} from "./regional-planning-fetchers";
import { planningProviderMetadata } from "./regional-planning";
import {
  assessRegionalSubdivisionPathways,
  calculateRegionalPotentialLots,
  regionalPlanningRuleStatus,
} from "./regional-rules";

export interface PropertyCandidate {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  scores: { ease: number; cost: number; roi: number; composite: number };
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
  listingUrl?: string;
  photoUrl?: string;
  photoUrls?: string[];
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
  /** True when listing sources disagreed on the count — UI can render "~3 bd". */
  bedroomsApprox?: boolean;
  bathroomsApprox?: boolean;
  /** True when listing sources disagree on land area / price — UI renders "~503 m²" / "~$1.25M". */
  landAreaApprox?: boolean;
  landAreaSource?: DiscoveryLandAreaSource;
  landAreaConfidence?: DiscoveryLandAreaConfidence;
  isParentParcelSuspect?: boolean;
  isAlreadySubdividedChild?: boolean;
  priceApprox?: boolean;
  /**
   * True when `price` is an internal scoring placeholder (the listing had no
   * source-backed asking price — POA / auction / negotiation). The number must
   * NOT be shown as the listing's price; render `priceDisplay` text instead.
   */
  priceIsPlaceholder?: boolean;
  /** Floor (dwelling) area in m², extracted from listing og:description / JSON-LD. */
  floorArea?: number;
  /** True when og:description and page JSON-LD disagree on floor area. */
  floorAreaApprox?: boolean;
  typology?: PropertyTypology;
  typologyConfidence?: PropertyEligibilityConfidence;
  titleConfidence?: PropertyEligibilityConfidence;
  /**
   * Land tenure displayed on the card. "Freehold" when LINZ confirmed fee
   * simple; otherwise the confirmed estate (only freehold survives screening,
   * so this is "Freehold" or absent). Set only when title screening ran.
   */
  titleType?: string | null;
  /**
   * Outcome of freehold title screening for this candidate:
   *  - "verified"   = LINZ confirmed the title (freehold).
   *  - "unverified" = title screening was requested but LINZ couldn't confirm
   *    (new build with no title yet, address mismatch, or service unavailable /
   *    out-of-hours) — shown with a caveat rather than dropped.
   * Absent when title screening did not run for this search.
   */
  titleStatus?: "verified" | "unverified";
  /**
   * Set when the user opted in to a non-freehold tenure: LINZ positively
   * confirmed this title is cross-lease / leasehold / unit-title, and the user
   * asked to see it anyway. The card shows a warning chip explaining the
   * subdivision catch instead of the freehold tick. titleType carries the
   * display name ("Cross Lease" etc.) and titleStatus stays "verified" (the
   * title IS confirmed — just not freehold).
   */
  subdivisionTenureWarning?: "cross_lease" | "leasehold" | "unit_title";
  subdivisionEligible?: boolean;
  subdivisionRejectReason?: string | null;
  buildYear?: number | null;
  /**
   * True when the listing's own claims (new build / townhouse / multi-unit)
   * conflict with council records — the parcel was likely demolished and
   * redeveloped, so recorded land area / build year describe the
   * pre-development parent site.
   */
  redevelopmentSuspected?: boolean;
  screeningStatus?: "preliminary" | "verified";
  /** Why this card is preliminary. Absent for a verified council-rule screen. */
  screeningConfidenceReason?: "local_rules_not_modelled" | "source_data_incomplete";
  planningProviderId?: string;
  planningProviderName?: string;
  screeningNotes?: string[];
  isCombinedListing?: boolean;
  packageAddress?: string;
  childAddresses?: string[];
  aggregateFactsExcluded?: boolean;
}

/**
 * A strict-subdivision screen returns either a candidate (passed all rules) or
 * a verdict describing why we couldn't pass it. "indeterminate" means an
 * essential source (zone / build year / land area) failed transiently after
 * retries — the outer discovery loop should re-screen these with longer waits
 * before reporting "no listings".
 */
export type ScreenVerdict =
  | { kind: "candidate"; candidate: PropertyCandidate }
  | { kind: "rejected"; reason: string }
  | { kind: "indeterminate"; reason: string };

const SCREEN_SOURCE_RETRY_DELAYS_MS = [500, 1500, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const ZONE_EASE_SCORE: Record<string, number> = {
  THAB: 4.5, "MHU-H": 4.5, "MHU-S": 4.5, MHU: 4.0,
  TBC: 4.0, TC: 4.0, LC: 4.0, MHS: 3.5,
  SHZ: 2.0, LDRZ: 1.8, LSZ: 1.5, LLRZ: 1.5, CLZ: 1.3, RUR: 1.0,
};

function zoneEase(zone: string | null): number {
  if (!zone) return 3.0;
  const upper = zone.toUpperCase().trim();
  return ZONE_EASE_SCORE[upper] ?? 3.0;
}

function overlayPenalty(overlays: Array<{ status: string }>): number {
  return overlays.reduce((sum, o) => {
    if (o.status === "restricted") return sum + 0.5;
    if (o.status === "moderate") return sum + 0.25;
    return sum;
  }, 0);
}

function normaliseZoneForLotCapacity(zone: string | null): string | null {
  const zUpper = (zone ?? "").toUpperCase().trim();
  if (!zUpper) return null;
  if (zUpper === "MHU-H" || zUpper === "MHU-S") return "MHU";
  if (zUpper === "TBC" || zUpper === "TC" || zUpper === "LC") return null;
  return zUpper;
}

function estimateLotCapacity(zone: string | null, land: number | null): { lots: number; minLotSize: number | null } {
  if (!land || land < 200) return { lots: 1, minLotSize: null };
  const lotResult = calculatePotentialLots(land, normaliseZoneForLotCapacity(zone));
  return {
    lots: lotResult.lots,
    minLotSize: lotResult.min_lot_size > 0 ? lotResult.min_lot_size : null,
  };
}

function hasVerifiedListingLandArea(listing: ListingResult): boolean {
  return listing.landArea != null && listing.landAreaConfidence === "verified";
}

function quickScore(
  zone: string | null,
  overlays: Array<{ status: string }>,
  land: number | null,
  price: number,
): { ease: number; cost: number; roi: number; composite: number } {
  const { lots } = estimateLotCapacity(zone, land);
  const ease = Math.max(0.5, Math.min(5.0, zoneEase(zone) - overlayPenalty(overlays)));

  const costPerLot = lots > 0 ? price / lots : price;
  const costScore =
    costPerLot < 400_000 ? 5.0
    : costPerLot < 600_000 ? 4.0
    : costPerLot < 800_000 ? 3.0
    : costPerLot < 1_100_000 ? 2.0
    : costPerLot < 1_400_000 ? 1.5
    : 1.0;

  const roiScore = lots >= 4 ? 4.5 : lots >= 3 ? 4.0 : lots >= 2 ? 3.5 : 2.0;

  const composite = parseFloat(((ease * 0.3) + (costScore * 0.3) + (roiScore * 0.4)).toFixed(1));
  return { ease: Math.round(ease * 2) / 2, cost: costScore, roi: roiScore, composite };
}

function makeSummary(
  zone: string | null,
  lots: number,
  minLotSize: number | null,
  overlays: Array<{ status: string; name: string }>,
  land: number | null,
  designLed?: { designLedEligible?: boolean; designLedYieldRange?: DesignLedYieldRange | null } | null,
): string {
  const zonePart = zone ? `${zone} zoned` : "Zoning TBC";
  const designRange = designLed?.designLedYieldRange;
  const lotPart = designLed?.designLedEligible && designRange
    ? `Standard path: ${lots} lot${lots === 1 ? "" : "s"}; design-led consent may unlock ${designRange.min}-${designRange.max} subdivided lots`
    : lots > 1
      ? `${lots} lots potentially feasible before site constraints`
      : "Single dwelling only on raw lot-size screen";
  const overlayNames = overlays.filter(o => o.status !== "clear").map(o => o.name).slice(0, 2);
  const overlayPart = overlayNames.length > 0 ? `Overlays: ${overlayNames.join(", ")}.` : "No major overlays.";
  const sizePart = land ? `${land}sqm site.` : "";
  const rulePart = minLotSize ? `Quick screen uses ~${minLotSize}sqm/lot.` : null;
  return [zonePart, sizePart, lotPart + ".", rulePart, overlayPart, "Pre-screen estimate only."].filter(Boolean).join(" ");
}

function isApartmentAddress(address: string): boolean {
  const a = address.trim();
  return /^[\dA-Za-z]+\/[\dA-Za-z]+/i.test(a) ||
    /^[\d&, ]+\/\d+/i.test(a) ||
    /^(unit|apt|apartment|level|flat|suite)\s+[\dA-Za-z]/i.test(a) ||
    /^\d+[A-Za-z]+\/\d+/i.test(a);
}

function listingGeo(listing: ListingResult): { lat: number; lng: number; formatted: string; suburb: string | null } | null {
  const lat = listing.lat;
  const lng = listing.lng;
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    formatted: listing.address,
    suburb: listing.address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim() || null,
  };
}

/**
 * Fetches the essential data sources for pre-screening a single listing. In
 * strict-subdivision mode it loops with exponential backoff so a transiently
 * failed zone/build-year/land-area source doesn't silently knock a listing out
 * of consideration. Returns the resolved sources and a list of sources that
 * stayed broken after all retries.
 */
async function fetchScreenSourcesWithRetry(
  listing: ListingResult,
  geo: { lat: number; lng: number; formatted: string },
  opts: {
    shouldVerifyLandArea: boolean;
    shouldFetchPropertyValue: boolean;
    strictStandardSubdivision: boolean;
    preliminarySubdivision: boolean;
  },
): Promise<{
  zone: ZoneResult | null;
  resolvedOverlays: Overlay[];
  linzParcel: Awaited<ReturnType<typeof fetchLINZParcel>> | null;
  propertyHistory: PropertyHistory | null;
  propertyValue: Awaited<ReturnType<typeof scrapePropertyValue>> | null;
  failedSources: string[];
}> {
  let zone: ZoneResult | null = null;
  let resolvedOverlays: Overlay[] = [];
  let linzParcel: Awaited<ReturnType<typeof fetchLINZParcel>> | null = null;
  let propertyHistory: PropertyHistory | null = null;
  let propertyValue: Awaited<ReturnType<typeof scrapePropertyValue>> | null = null;
  let failedSources: string[] = [];

  const maxAttempts = opts.strictStandardSubdivision ? SCREEN_SOURCE_RETRY_DELAYS_MS.length + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      const waitMs = SCREEN_SOURCE_RETRY_DELAYS_MS[attempt - 1];
      logger.info(
        { address: listing.address, attempt, waitMs, failedSources },
        "Pre-screen: retrying failed essential sources for strict subdivision screen",
      );
      await sleep(waitMs);
    }

    const needsZone: boolean = !zone;
    const needsOverlays: boolean = resolvedOverlays.length === 0 && attempt === 0;
    const needsLinz: boolean = opts.shouldVerifyLandArea && !linzParcel;
    const needsPropertyHistory: boolean =
      opts.strictStandardSubdivision && !opts.preliminarySubdivision && !propertyHistory?.build_year;
    const needsPropertyValue: boolean = opts.shouldFetchPropertyValue && !propertyValue;

    const zonePromise: Promise<ZoneResult | null> = needsZone
      ? fetchPlanningZoneForReport(geo.lat, geo.lng, listing.address)
      : Promise.resolve(zone);
    const overlaysPromise: Promise<Overlay[]> = needsOverlays
      ? fetchPlanningOverlaysForReport(geo.lat, geo.lng, null, { address: listing.address })
      : Promise.resolve(resolvedOverlays);
    const linzPromise: Promise<Awaited<ReturnType<typeof fetchLINZParcel>> | null> = needsLinz
      ? fetchLINZParcel(geo.lat, geo.lng)
      : Promise.resolve(linzParcel);
    const propertyHistoryPromise: Promise<PropertyHistory | null> = needsPropertyHistory
      ? fetchPropertyHistoryForReport(listing.address, geo.lat, geo.lng)
      : Promise.resolve(propertyHistory);
    const propertyValuePromise: Promise<Awaited<ReturnType<typeof scrapePropertyValue>> | null> = needsPropertyValue
      ? scrapePropertyValue(listing.address, geo.formatted)
      : Promise.resolve(propertyValue);

    const [zoneResult, overlaysResult, linzParcelResult, propertyHistoryResult, propertyValueResult] = await Promise.allSettled([
      zonePromise,
      overlaysPromise,
      linzPromise,
      propertyHistoryPromise,
      propertyValuePromise,
    ]);

    if (zoneResult.status === "fulfilled" && zoneResult.value) zone = zoneResult.value;
    if (overlaysResult.status === "fulfilled" && overlaysResult.value) resolvedOverlays = overlaysResult.value;
    if (linzParcelResult.status === "fulfilled" && linzParcelResult.value) linzParcel = linzParcelResult.value;
    if (propertyHistoryResult.status === "fulfilled" && propertyHistoryResult.value) propertyHistory = propertyHistoryResult.value;
    if (propertyValueResult.status === "fulfilled" && propertyValueResult.value) propertyValue = propertyValueResult.value;

    failedSources = [];
    if (!zone) failedSources.push("zone");
    if (opts.shouldVerifyLandArea && !linzParcel) failedSources.push("linz");
    if (opts.strictStandardSubdivision && !opts.preliminarySubdivision && !propertyHistory?.build_year && !propertyValue?.build_year) failedSources.push("build_year");
    if (opts.shouldFetchPropertyValue && !propertyValue) failedSources.push("propertyvalue");

    if (!opts.strictStandardSubdivision) break;

    // In strict mode, only the essentials need to succeed before we stop
    // retrying. Zone + a build-year source are the two hard requirements; land
    // area we can verify from listing/homes/propertyValue as well.
    const haveBuildYear = opts.preliminarySubdivision || !!(propertyHistory?.build_year || propertyValue?.build_year);
    const haveLandSignal = !!(linzParcel || listing.landArea != null || propertyValue?.land_area_sqm);
    if (zone && haveBuildYear && haveLandSignal) break;
  }

  return { zone, resolvedOverlays, linzParcel, propertyHistory, propertyValue, failedSources };
}

/** Display name shown on the card for an opted-in non-freehold tenure. */
const TENURE_DISPLAY_NAME: Record<"cross_lease" | "leasehold" | "unit_title", string> = {
  cross_lease: "Cross Lease",
  leasehold: "Leasehold",
  unit_title: "Unit Title",
};

async function screenOneFast(
  listing: ListingResult,
  options?: {
    allowMissingListingPrice?: boolean;
    pricePlaceholderNzd?: number;
    strictStandardSubdivision?: boolean;
    preliminarySubdivision?: boolean;
    /**
     * Scored development/opportunity discovery (the non-strict scored path).
     * Applies the attribute prefilter (keeping bare sections — they ARE
     * development stock) and a development-eligibility gate: already-subdivided
     * children, unit/terrace typologies, and parcels below every viable pathway
     * (standard 2-lot AND design-led minimums) are rejected instead of being
     * scored and shown as "subdivision potential".
     */
    developmentScreening?: boolean;
    /**
     * Verify freehold/fee-simple title against LINZ. Set only when the user's
     * intent calls for it (requiresFreeholdTitle, or any subdivision search —
     * the strict screen already requires verified freehold). Caller is
     * responsible for only enabling this in service hours; this function
     * re-checks isLinzTitleServiceAvailable() defensively.
     */
    verifyFreeholdTitle?: boolean;
    /**
     * Non-freehold tenures the user opted in to seeing despite the subdivision
     * catch. A LINZ-confirmed non-freehold listing whose tenure is in this set
     * is KEPT (with a warning) and screened on land/zone potential only (the
     * eligibility tenure waiver), instead of being dropped. Empty/absent = drop
     * every non-freehold title as usual.
     */
    includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[];
  },
): Promise<ScreenVerdict> {
  try {
    if (isApartmentAddress(listing.address)) {
      logger.debug({ address: listing.address }, "Pre-screen: skipping apartment/unit address");
      return { kind: "rejected", reason: "apartment_or_unit_address" };
    }

    // Cheap listing-attribute prefilter — rejects ~40-60% of a suburb queue
    // before any backend fetch. Applies to strict subdivision AND scored
    // development discovery (development keeps bare sections — they're stock).
    if (options?.strictStandardSubdivision || options?.developmentScreening) {
      const prefilter = strictAttributePrefilter(listing, {
        keepSections: !options?.strictStandardSubdivision,
      });
      if (prefilter.kind === "reject") {
        logger.debug({ address: listing.address, reason: prefilter.reason }, "Pre-screen: strict attribute prefilter rejected listing");
        return { kind: "rejected", reason: `prefilter:${prefilter.reason}` };
      }
    }

    // Freehold title screening (authoritative LINZ tenure). Done right after the
    // cheap prefilter so a positively non-freehold listing is dropped BEFORE the
    // heavier zone/parcel/PropertyValue fetches, and so a confirmed freehold
    // estate can feed the eligibility assessments below (the strict subdivision
    // screen hard-requires verified freehold title). Bounded concurrency + the
    // LRS preview cache keep this cheap and race-free. The result is carried onto
    // the candidate card; "caveat" means LINZ couldn't confirm (new build with no
    // title yet, mismatch, or service blip) — shown as "unverified", never dropped.
    let verifiedEstateType: string | null = null;
    let titleType: string | null | undefined;
    let titleStatus: "verified" | "unverified" | undefined;
    // When the user opted in to a non-freehold tenure, a positively-confirmed
    // match is kept (with a warning) and the eligibility assessment screens it
    // on land/zone potential only — see waiveTenureForSubdivision below.
    let tenureWarning: "cross_lease" | "leasehold" | "unit_title" | undefined;
    let waiveTenureForSubdivision: "cross_lease" | "leasehold" | "unit_title" | null = null;
    if (options?.verifyFreeholdTitle && isLinzTitleServiceAvailable()) {
      const fh = await screenAddressFreehold(listing.address);
      if (fh.decision === "reject") {
        const cat = tenureCategoryFromEstate(fh.estate);
        if (cat && cat !== "freehold" && options?.includeTenures?.includes(cat)) {
          // User opted in: surface it with a warning instead of dropping it. The
          // estate is fed through as verified (LINZ confirmed the title — it's
          // just not freehold) so the title-confidence gate passes; the tenure
          // waiver below skips the freehold/standalone-typology requirements.
          logger.info({ address: listing.address, estate: fh.estate, tenure: cat }, "Pre-screen: kept opted-in non-freehold title");
          verifiedEstateType = fh.estate;
          titleType = TENURE_DISPLAY_NAME[cat];
          titleStatus = "verified";
          tenureWarning = cat;
          waiveTenureForSubdivision = cat;
        } else {
          // Encode the tenure in the reason so the batch driver can count which
          // tenures were excluded (drives the "I left some out…" reminder).
          logger.info({ address: listing.address, estate: fh.estate }, "Pre-screen: rejected — LINZ title is not freehold");
          return { kind: "rejected", reason: `not_freehold_title:${cat ?? "unknown"}` };
        }
      } else if (fh.decision === "keep") {
        verifiedEstateType = fh.estate;
        titleType = fh.titleType;
        titleStatus = "verified";
      } else {
        titleStatus = "unverified";
      }
    }

    // Structured claims from the listing's marketing copy — the only source
    // that knows about a NEW dwelling on a parcel whose council/valuation
    // records still describe the demolished one.
    const claims = extractListingClaims(listing);

    const geo = listingGeo(listing) ?? await geocodeAddress(listing.address);
    const shouldVerifyLandArea: boolean =
      options?.strictStandardSubdivision === true ||
      listing.landAreaApprox === true ||
      listing.landArea == null ||
      !hasVerifiedListingLandArea(listing);
    const shouldFetchPropertyValue: boolean = shouldVerifyLandArea || options?.strictStandardSubdivision === true;

    const {
      zone: zoneRecord,
      resolvedOverlays,
      linzParcel,
      propertyHistory,
      propertyValue,
      failedSources,
    } = await fetchScreenSourcesWithRetry(listing, geo, {
      shouldVerifyLandArea,
      shouldFetchPropertyValue,
      strictStandardSubdivision: options?.strictStandardSubdivision === true,
      preliminarySubdivision: options?.preliminarySubdivision === true,
    });

    const planningProvider = planningProviderMetadata({
      address: listing.address,
      lat: geo.lat,
      lng: geo.lng,
    });
    const regionalRuleStatus = regionalPlanningRuleStatus(
      planningProvider,
      zoneRecord,
      listing.landArea ?? linzParcel?.area_sqm ?? propertyValue?.land_area_sqm ?? null,
      resolvedOverlays,
    );
    const isRegionalProvider = Boolean(planningProvider && planningProvider.providerId !== "auckland-legacy");
    const localRulesModelled = !isRegionalProvider
      || regionalRuleStatus.automaticYieldClaimsAllowed
      || (regionalRuleStatus.automaticRoiAllowed && regionalRuleStatus.sourceLabel != null);
    const preliminaryLocalRules = isRegionalProvider && !localRulesModelled;
    const zone = isRegionalProvider
      ? (regionalRuleStatus.regionalZoneCode ?? zoneRecord?.zone_code ?? null)
      : (zoneRecord?.zone_code ?? null);

    // Council/valuation sources lag redevelopment — a listing-stated
    // completion year is the only build year that knows about the new
    // dwelling, so it wins when present.
    const councilBuildYear = propertyHistory?.build_year ?? propertyValue?.build_year ?? null;
    const resolvedBuildYear = claims.completionYear ?? councilBuildYear;
    // Optional LINZ probe (env-flag gated, one free HTTP call in strict mode):
    // unit-style child addresses at the parent address mean the parcel has
    // already been developed.
    const linzChildProbe = options?.strictStandardSubdivision
      ? await fetchLINZChildAddressCount(listing.address).catch(() => null)
      : null;
    const redevelopment = detectRedevelopmentConflict({
      claims,
      councilBuildYear,
      listingFloorAreaSqm: listing.floorArea ?? null,
      councilFloorAreaSqm: propertyHistory?.floor_area_sqm ?? propertyValue?.floor_area_sqm ?? null,
      linzChildAddressCount: linzChildProbe?.childCount ?? null,
    });
    if (redevelopment.suspected && options?.strictStandardSubdivision) {
      logger.info(
        { address: listing.address, councilBuildYear, reasons: redevelopment.reasons },
        "Pre-screen: rejected — listing claims conflict with council records (parcel likely redeveloped)",
      );
      return { kind: "rejected", reason: "redevelopment_suspected_stale_council_data" };
    }

    const preliminaryEligibility = assessPropertyEligibility({
      address: listing.address,
      estateType: listing.tenureText,
      verifiedEstateType,
      waiveTenureForSubdivision,
      legalDescription: [
        listing.legalDescription,
        ...(propertyValue?.legal_descriptions ?? []),
      ].filter(Boolean).join(" "),
      propertyType: propertyHistory?.property_type ?? propertyValue?.property_type,
      propertySubType: propertyValue?.property_sub_type,
      propertyValueLegalDescriptions: propertyValue?.legal_descriptions,
      landUsePrimary: propertyValue?.land_use_primary,
      propertyImprovements: propertyValue?.property_improvements,
      listingPropertyType: listing.propertyType,
      listingCategory: listing.listingCategory,
      listingTenureText: listing.tenureText,
      listingLegalDescription: listing.legalDescription,
      linzParcel,
      landAreaSqm: listing.landArea ?? propertyValue?.land_area_sqm ?? null,
      floorAreaSqm: listing.floorArea ?? propertyHistory?.floor_area_sqm ?? propertyValue?.floor_area_sqm,
      buildYear: resolvedBuildYear,
      zoneCode: zone,
      potentialLots: null,
      minLotSize: null,
      isCombinedListingAggregate: listing.isCombinedListing,
      listingClaims: claims,
    });
    const suppressParentLandArea = shouldSuppressParentLandAreaForEligibility(preliminaryEligibility);
    const listingLandAreaForVerification =
      suppressParentLandArea && listing.landAreaConfidence !== "verified"
        ? propertyValue?.land_area_sqm ?? null
        : listing.landArea ?? propertyValue?.land_area_sqm ?? null;
    const landAreaFromPropertyValue =
      propertyValue?.land_area_sqm != null && listing.landArea == null && listingLandAreaForVerification === propertyValue.land_area_sqm;
    const listingLandAreaSource =
      landAreaFromPropertyValue
        ? "propertyvalue"
        : listing.landAreaSource;

    const verifiedLand = await verifyDiscoveryLandArea({
      address: listing.address,
      listingLandArea: listingLandAreaForVerification,
      listingLandAreaSource,
      listingLandAreaConfidence: landAreaFromPropertyValue ? "verified" : listing.landAreaConfidence,
      linzParcel: suppressParentLandArea ? null : linzParcel,
      formattedAddress: geo.formatted,
      strictStandardSubdivision: options?.strictStandardSubdivision && !suppressParentLandArea,
      // Never burn ScrapingBee quota in the strict-subdivision discovery loop.
      // A listing the free sources can't verify becomes "indeterminate" and is
      // re-screened by the outer retry pass after a longer wait.
      disablePaidScrapers: options?.strictStandardSubdivision === true,
    });
    const land = verifiedLand.landArea;
    const landAreaApprox =
      verifiedLand.landAreaConfidence !== "verified" ||
      listing.landAreaApprox ||
      verifiedLand.isParentParcelSuspect ||
      undefined;
    let price = listing.price;
    let priceApprox = listing.priceApprox ?? false;
    let priceIsPlaceholder = false;
    if (price == null && options?.allowMissingListingPrice) {
      price = options.pricePlaceholderNzd ?? 1_750_000;
      priceApprox = true;
      // Internal scoring stand-in only — the card must show the negotiation/
      // auction text (priceDisplay), never this fabricated number.
      priceIsPlaceholder = true;
    }
    if (!price) return { kind: "rejected", reason: "no_price" };

    const regionalLotAssessment = calculateRegionalPotentialLots({
      provider: planningProvider,
      zone: zoneRecord,
      landAreaSqm: land ?? null,
      easementAreaSqm: 0,
      overlays: resolvedOverlays,
    });
    const fallbackCapacity = estimateLotCapacity(zone, land ?? null);
    const lots = regionalLotAssessment?.lotResult.lots ?? fallbackCapacity.lots;
    const minLotSize = regionalLotAssessment?.lotResult.min_lot_size
      ? regionalLotAssessment.lotResult.min_lot_size
      : fallbackCapacity.minLotSize;
    const designLedSubdivisionPathwayVerified =
      regionalRuleStatus.automaticRoiAllowed
      && !regionalRuleStatus.automaticYieldClaimsAllowed
      && regionalRuleStatus.sourceLabel != null;
    const packageParts = extractCombinedListingAddressParts(listing.address);
    const eligibility = assessPropertyEligibility({
          address: listing.address,
          estateType: listing.tenureText,
          verifiedEstateType,
          waiveTenureForSubdivision,
          legalDescription: [
            listing.legalDescription,
            ...(propertyValue?.legal_descriptions ?? []),
          ].filter(Boolean).join(" "),
          propertyType: propertyHistory?.property_type ?? propertyValue?.property_type,
          propertySubType: propertyValue?.property_sub_type,
          propertyValueLegalDescriptions: propertyValue?.legal_descriptions,
          landUsePrimary: propertyValue?.land_use_primary,
          propertyImprovements: propertyValue?.property_improvements,
          listingPropertyType: listing.propertyType,
          listingCategory: listing.listingCategory,
          listingTenureText: listing.tenureText,
          listingLegalDescription: listing.legalDescription,
          linzParcel,
          landAreaSqm: land,
          floorAreaSqm: listing.floorArea ?? propertyHistory?.floor_area_sqm ?? propertyValue?.floor_area_sqm,
          buildYear: resolvedBuildYear,
          zoneCode: zone,
          potentialLots: lots,
          minLotSize,
          designLedSubdivisionPathwayVerified,
          isCombinedListingAggregate: listing.isCombinedListing,
          listingClaims: claims,
        });
    const standardSubdivisionPasses = options?.preliminarySubdivision
      ? passesPreliminaryStandardSubdivisionScreen({
          address: listing.address,
          landArea: land,
          zone,
          potentialLots: lots,
          minLotSize,
          landAreaConfidence: verifiedLand.landAreaConfidence,
          isAlreadySubdividedChild: verifiedLand.isAlreadySubdividedChild,
          typology: eligibility?.typology,
          titleConfidence: eligibility?.titleConfidence,
          subdivisionRejectReason: eligibility?.subdivisionRejectReason,
          buildYear: resolvedBuildYear,
          tenureWaived: waiveTenureForSubdivision != null,
        })
      : passesStrictStandardSubdivisionScreen({
      address: listing.address,
      landArea: land,
      zone,
      potentialLots: lots,
      minLotSize,
      landAreaConfidence: verifiedLand.landAreaConfidence,
      isAlreadySubdividedChild: verifiedLand.isAlreadySubdividedChild,
      typology: eligibility?.typology,
      titleConfidence: eligibility?.titleConfidence,
      subdivisionEligible: eligibility?.subdivisionEligible,
      buildYear: claims.completionYear ?? propertyHistory?.build_year ?? null,
      tenureWaived: waiveTenureForSubdivision != null,
    });
    const subdivisionPathwayInput = {
      netAreaSqm: land ?? null,
      zoneCode: normaliseZoneForLotCapacity(zone),
      zoneLabel: zoneRecord?.zone_description ?? null,
      standardVacantLots: lots,
      minLotSqm: minLotSize,
      typology: eligibility?.typology,
      titleConfidence: eligibility?.titleConfidence,
      landAreaConfidence: verifiedLand.landAreaConfidence,
      isAlreadySubdividedChild: verifiedLand.isAlreadySubdividedChild,
      buildYear: resolvedBuildYear,
      parcelBbox: linzParcel?.bbox ?? null,
      overlays: resolvedOverlays,
    };
    const designLedAssessment = assessRegionalSubdivisionPathways({
      ...subdivisionPathwayInput,
      provider: planningProvider,
      zone: zoneRecord,
    }) ?? assessSubdivisionPathways(subdivisionPathwayInput);
    const packageSubdivisionPasses =
      Boolean(packageParts) &&
      lots >= 2 &&
      minLotSize != null &&
      verifiedLand.landAreaConfidence === "verified" &&
      verifiedLand.isAlreadySubdividedChild !== true;
    const designLedPasses = designLedAssessment.designLedEligible;
    // Development-eligibility gate for the scored non-strict path: a card
    // presented as a development/subdivision opportunity must not be an
    // already-subdivided child, a unit/terrace dwelling, or a parcel that fails
    // BOTH the standard vacant-lot maths (2 × zone minimum, e.g. MHS 400 m²/lot)
    // and the design-led pathway minimums. Softer than the strict screen (no
    // freehold-verified or pre-2000 build-year requirement) but hard on the
    // physically-impossible cases.
    if (options?.developmentScreening && !options?.strictStandardSubdivision) {
      if (verifiedLand.isAlreadySubdividedChild === true) {
        logger.info({ address: listing.address }, "Pre-screen: development gate rejected already-subdivided child");
        return { kind: "rejected", reason: "development_gate:already_subdivided_child" };
      }
      if (eligibility?.typology === "unit_apartment" || eligibility?.typology === "terrace_townhouse") {
        logger.info({ address: listing.address, typology: eligibility.typology }, "Pre-screen: development gate rejected multi-unit typology");
        return { kind: "rejected", reason: `development_gate:typology_${eligibility.typology}` };
      }
      const noViablePathway =
        land != null && minLotSize != null && lots < 2 && !designLedPasses && !packageSubdivisionPasses;
      if (noViablePathway) {
        logger.info(
          { address: listing.address, landArea: land, zone, minLotSize, lots },
          "Pre-screen: development gate rejected parcel below every viable pathway",
        );
        return { kind: "rejected", reason: `development_gate:below_viable_pathway:${land}m2_min${minLotSize}` };
      }
    }
    const preliminaryNationwidePass =
      preliminaryLocalRules
      && verifiedLand.landAreaConfidence === "verified"
      && verifiedLand.isAlreadySubdividedChild !== true
      && eligibility?.typology === "standalone"
      && (eligibility?.titleConfidence === "verified" || titleStatus === "unverified")
      && (resolvedBuildYear == null || resolvedBuildYear < 2000);
    if (options?.strictStandardSubdivision && !standardSubdivisionPasses && !packageSubdivisionPasses && !designLedPasses && !preliminaryNationwidePass) {
      logger.info(
        {
          address: listing.address,
          landArea: land,
          zone,
          lots,
          minLotSize,
          landAreaConfidence: verifiedLand.landAreaConfidence,
          isAlreadySubdividedChild: verifiedLand.isAlreadySubdividedChild,
          typology: eligibility?.typology,
          titleConfidence: eligibility?.titleConfidence,
          subdivisionRejectReason: eligibility?.subdivisionRejectReason,
          buildYear: resolvedBuildYear,
          failedSources,
        },
        "Pre-screen: rejected strict subdivision candidate",
      );
      // Cross-lease the user explicitly opted in to: it can never pass the
      // standard freehold subdivision screen (you can't subdivide a cross-lease
      // on its own title), so it always lands here — but the user asked to see
      // these anyway. Surface it as an informational candidate (standardPathViable
      // stays false; the card carries the cross-lease warning + the neighbour-
      // acquisition note added below) instead of dropping it as rejected or
      // indeterminate on missing/unverified land area.
      if (waiveTenureForSubdivision !== "cross_lease") {
        // Distinguish a confirmed reject (we know enough to say "no") from an
        // indeterminate one (essential data still missing even after retries).
        // The outer discovery loop re-screens indeterminate listings with longer
        // waits before declaring "no listings". We base this on the actual
        // decision inputs rather than which sources happened to fail — e.g. if
        // build year is known but >= 2000 the listing is a real reject, even if
        // some redundant source (LINZ / PropertyValue) was unavailable.
        const haveAnyBuildYear = resolvedBuildYear != null;
        const isIndeterminate =
          (!options?.preliminarySubdivision && !haveAnyBuildYear) ||
          (!zone && !preliminaryLocalRules) ||
          verifiedLand.landAreaConfidence !== "verified" ||
          eligibility?.typology === "unknown" ||
          eligibility?.titleConfidence === "unknown";
        if (isIndeterminate) {
          return {
            kind: "indeterminate",
            reason: failedSources.length > 0
              ? `essential_sources_failed:${failedSources.join(",")}`
              : "missing_data_after_retry",
          };
        }
        return { kind: "rejected", reason: eligibility?.subdivisionRejectReason ?? "strict_screen_failed" };
      }
    }
    // LLM tie-breaker (final-acceptance check only, never in the bulk
    // prefilter): the copy mentions townhouse/terrace but the deterministic
    // extractor couldn't classify it. One small LLM call decides whether the
    // dwelling IS one before we publish this as a subdividable candidate. The
    // LLM can only make the verdict safer — a deterministic pass stands unless
    // the LLM finds a concrete risk flag.
    // Skipped for an opted-in cross-lease: a cross-lease is inherently a
    // multi-unit development, so this check would always reject it — but the
    // user explicitly asked to see these as informational (buy-the-neighbour) cards.
    if (
      options?.strictStandardSubdivision &&
      waiveTenureForSubdivision !== "cross_lease" &&
      hasAmbiguousListingSignals(listing)
    ) {
      const llmClaims = await extractListingClaimsLLM(listing).catch(() => null);
      if (llmClaims && (llmClaims.dwellingIsTownhouse || llmClaims.isNewBuild || llmClaims.multiUnitDevelopment)) {
        logger.info(
          { address: listing.address, evidence: llmClaims.evidence },
          "Pre-screen: LLM tie-breaker rejected ambiguous listing copy",
        );
        return { kind: "rejected", reason: `llm_claims:${llmClaims.evidence[0] ?? "ambiguous_copy_resolved_to_risk"}` };
      }
    }

    // For councils without a modelled local rule pack, keep the score deliberately
    // neutral on yield. It is still useful for ranking title/land/price candidates,
    // but must not smuggle Auckland lot assumptions into a nationwide result.
    const scores = preliminaryLocalRules
      ? quickScore(null, resolvedOverlays, null, price)
      : quickScore(zone, resolvedOverlays, land ?? null, price);

    const candidate: PropertyCandidate = {
      address: listing.address,
      price,
      landArea: land ?? undefined,
      zone: zone ?? undefined,
      scores,
      briefSummary: makeSummary(zone, lots, minLotSize, resolvedOverlays, land ?? null, designLedAssessment),
      potentialLots: preliminaryLocalRules ? undefined : lots,
      minLotSize: preliminaryLocalRules ? undefined : (minLotSize ?? undefined),
      standardVacantLots: preliminaryLocalRules ? undefined : designLedAssessment.standardVacantLots,
      standardPathViable: preliminaryLocalRules ? false : (standardSubdivisionPasses || packageSubdivisionPasses),
      standardMinLotSize: preliminaryLocalRules ? null : designLedAssessment.standardMinLotSize,
      designLedEligible: designLedAssessment.designLedEligible,
      designLedYieldRange: designLedAssessment.designLedYieldRange,
      designLedConfidence: designLedAssessment.designLedConfidence,
      designLedReasons: designLedAssessment.designLedReasons,
      designLedBlockers: designLedAssessment.designLedBlockers,
      designLedSummary: designLedAssessment.designLedSummary,
      designLedDetail: designLedAssessment.designLedDetail,
      listingUrl: listing.listingUrl,
      photoUrl: listing.photoUrl ?? undefined,
      photoUrls: listing.photoUrls?.length ? listing.photoUrls : listing.photoUrl ? [listing.photoUrl] : undefined,
      priceDisplay: listing.priceText || undefined,
      propertyType: claims.dwellingIsTownhouse ? "Townhouse" : (listing.propertyType ?? listing.listingCategory ?? undefined),
      listingTitle: listing.listingTitle ?? listing.address.split(",")[0]?.trim() ?? listing.address,
      description: listing.description ?? undefined,
      features: listing.features?.length ? listing.features : undefined,
      agentName: listing.agentName ?? undefined,
      agencyName: listing.agencyName ?? undefined,
      agentAvatarUrl: listing.agentAvatarUrl ?? undefined,
      bedrooms: listing.bedrooms ?? undefined,
      bathrooms: listing.bathrooms ?? undefined,
      bedroomsApprox: listing.bedroomsApprox || undefined,
      bathroomsApprox: listing.bathroomsApprox || undefined,
      landAreaApprox: landAreaApprox || undefined,
      landAreaSource: verifiedLand.landAreaSource,
      landAreaConfidence: verifiedLand.landAreaConfidence,
      isParentParcelSuspect: verifiedLand.isParentParcelSuspect || undefined,
      isAlreadySubdividedChild: verifiedLand.isAlreadySubdividedChild || undefined,
      priceApprox: priceApprox || undefined,
      priceIsPlaceholder: priceIsPlaceholder || undefined,
      floorArea: listing.floorArea ?? undefined,
      floorAreaApprox: listing.floorAreaApprox || undefined,
      typology: packageParts ? "standalone" : eligibility?.typology,
      typologyConfidence: packageParts ? "inferred" : eligibility?.typologyConfidence,
      titleConfidence: packageParts ? "inferred" : eligibility?.titleConfidence,
      titleType: titleType ?? undefined,
      titleStatus,
      subdivisionTenureWarning: tenureWarning,
      subdivisionEligible: packageParts ? packageSubdivisionPasses : eligibility?.subdivisionEligible,
      subdivisionRejectReason: packageParts ? "combined_listing_aggregate" : eligibility?.subdivisionRejectReason,
      buildYear: resolvedBuildYear,
      redevelopmentSuspected: redevelopment.suspected || undefined,
      screeningStatus: preliminaryLocalRules || options?.preliminarySubdivision ? "preliminary" : "verified",
      screeningConfidenceReason: preliminaryLocalRules ? "local_rules_not_modelled" : undefined,
      planningProviderId: planningProvider?.providerId,
      planningProviderName: planningProvider?.providerName,
      screeningNotes: [
        ...(waiveTenureForSubdivision === "cross_lease"
          ? ["Cross-lease title — it can't be subdivided on its own. Acquiring the neighbouring cross-lease unit(s) and converting the shared title to freehold can unlock subdivision potential."]
          : []),
        ...(redevelopment.suspected
          ? [`Listing claims conflict with council records — parcel likely redeveloped (${redevelopment.reasons.join("; ")}).`]
          : []),
        ...(designLedPasses && !standardSubdivisionPasses && !packageSubdivisionPasses
          ? ["Design-led consent opportunity; standard vacant-lot screen remains conservative."]
          : preliminaryLocalRules
            ? ["Preliminary opportunity screen only; local subdivision rules are not modelled for this council yet, so no local-rule-dependent yield is claimed."]
          : options?.preliminarySubdivision
            ? ["Preliminary active-listing subdivision screen; build year is checked in the full analysis."]
            : ["Verified pre-screen."]),
      ],
      isCombinedListing: Boolean(packageParts || listing.isCombinedListing),
      packageAddress: packageParts?.packageAddress,
      childAddresses: packageParts?.childAddresses,
      aggregateFactsExcluded: Boolean(packageParts || listing.isCombinedListing),
    };
    return { kind: "candidate", candidate };
  } catch (err) {
    logger.warn({ err, address: listing.address }, "Pre-screen fast: failed for listing");
    return { kind: "indeterminate", reason: `screen_error:${(err as Error).message}` };
  }
}

export interface PreScreenDetailedResult {
  candidates: PropertyCandidate[];
  /** Listings that couldn't be conclusively screened because an essential source failed after retries. Caller can re-screen these with longer waits. */
  indeterminate: ListingResult[];
  /**
   * Count of listings dropped because LINZ positively confirmed a non-freehold
   * title the user had NOT opted in to, by tenure. Drives the "I left some
   * cross-lease / leasehold properties out…" reminder. Counts only the
   * foreground batch (what the user is about to see); the background drain runs
   * after the response is built.
   */
  excludedTenures: { cross_lease: number; leasehold: number; unit_title: number };
  /**
   * The actual listings dropped because LINZ confirmed a non-freehold title the
   * user had NOT opted in to, paired with the confirmed tenure. The discovery
   * loop stashes these (see listing-cache) so a later "include them" opt-in can
   * re-screen exactly these listings with the tenure waiver — without depending
   * on an unreliable fresh re-search to re-surface the same listing.
   */
  excludedNonFreehold: Array<{ listing: ListingResult; tenure: "cross_lease" | "leasehold" | "unit_title" }>;
  /**
   * When early-bail fires, this resolves once the entire pool finishes
   * screening in the background — useful for warming the verdict cache so
   * "show more" follow-ups are instant. Always present, even when no
   * early-bail happened (resolves immediately in that case).
   */
  drainComplete: Promise<void>;
}

/**
 * Cache-aware screen wrapper. Strict-subdivision discovery touches the same
 * listings repeatedly (outer indeterminate-retry pass, "show more" follow-ups,
 * district fan-out where one suburb's pool overlaps with another). Reading
 * the verdict cache first avoids re-fetching LINZ + AC GIS + propertyValue.
 */
async function cachedScreenOneFast(
  listing: ListingResult,
  options?: Parameters<typeof screenOneFast>[1],
): Promise<ScreenVerdict> {
  // Freehold-screened verdicts live in a separate cache namespace so a verdict
  // formed with the freehold gate is never served to a non-freehold search. The
  // opt-in set is folded into the key too: a "rejected (cross-lease)" verdict
  // cached for a plain freehold search must NOT shadow a search that opted in to
  // cross-lease (where the same listing is now kept).
  const optInSuffix =
    options?.includeTenures && options.includeTenures.length > 0
      ? "|" + [...options.includeTenures].sort().join(",")
      : "";
  const variant = options?.verifyFreeholdTitle ? `freehold${optInSuffix}` : undefined;
  const shouldCache = options?.strictStandardSubdivision === true || options?.verifyFreeholdTitle === true;
  if (shouldCache) {
    const cached = getScreenVerdict(listing, variant);
    if (cached) {
      logger.debug({ address: listing.address, verdict: cached.kind }, "Pre-screen: verdict cache hit");
      return cached;
    }
  }
  const verdict = await screenOneFast(listing, options);
  if (shouldCache) setScreenVerdict(listing, verdict, variant);
  return verdict;
}

/**
 * Same as preScreenListingsFast but also returns the listings that couldn't be
 * conclusively screened. Use this from the discovery loop so the outer pass
 * can re-screen indeterminate listings with extended backoff before reporting
 * "no listings match" to the user.
 *
 * When `earlyBailAt` is set, resolves as soon as that many candidates are
 * collected — the remaining batches continue draining in the background and
 * write their verdicts into the screen-verdict cache so the next "show more"
 * is instant. `drainComplete` on the result awaits that background work.
 */
export async function preScreenListingsFastDetailed(
  listings: ListingResult[],
  maxConcurrent = 5,
  resultCap: number | null = 3,
  options?: {
    allowMissingListingPrice?: boolean;
    pricePlaceholderNzd?: number;
    strictStandardSubdivision?: boolean;
    preliminarySubdivision?: boolean;
    /** Scored development discovery — attribute prefilter + development gate (see screenOneFast). */
    developmentScreening?: boolean;
    /** Verify freehold/fee-simple title against LINZ (see screenOneFast). */
    verifyFreeholdTitle?: boolean;
    /** Non-freehold tenures the user opted in to seeing despite the subdivision catch (see screenOneFast). */
    includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[];
    /** Resolve once this many candidates have been collected; keep draining the rest in the background. */
    earlyBailAt?: number;
    /** Called each time a candidate is found, in order of completion (not score-sorted). */
    onCandidate?: (candidate: PropertyCandidate) => void;
  },
): Promise<PreScreenDetailedResult> {
  const nonApartments = listings.filter((l) => !isApartmentAddress(l.address));
  const results: PropertyCandidate[] = [];
  const indeterminate: ListingResult[] = [];
  const excludedTenures = { cross_lease: 0, leasehold: 0, unit_title: 0 };
  const excludedNonFreehold: Array<{ listing: ListingResult; tenure: "cross_lease" | "leasehold" | "unit_title" }> = [];
  // Count the dropped non-freehold listing AND keep the listing object so an
  // "include them" opt-in can re-screen exactly this listing later (the listing
  // is otherwise discarded after the first-batch screen and lost to the opt-in).
  const recordExcluded = (verdict: ScreenVerdict, listing: ListingResult): void => {
    if (verdict.kind !== "rejected" || !verdict.reason.startsWith("not_freehold_title:")) return;
    const cat = verdict.reason.slice("not_freehold_title:".length);
    if (cat === "cross_lease" || cat === "leasehold" || cat === "unit_title") {
      excludedTenures[cat]++;
      excludedNonFreehold.push({ listing, tenure: cat });
    }
  };
  const queue = [...nonApartments];
  const queueListings = [...nonApartments];
  const earlyBailAt = options?.earlyBailAt;

  // Phase 1: drain batches up until either the queue is empty or earlyBail
  // fires. When earlyBail fires we capture the rest of the queue and return
  // a drainComplete promise that keeps screening in the background.
  let drainComplete: Promise<void> = Promise.resolve();

  while (queue.length > 0) {
    const batch = queue.splice(0, maxConcurrent);
    const batchOriginals = queueListings.splice(0, maxConcurrent);
    const batchResults = await Promise.all(batch.map((listing) => cachedScreenOneFast(listing, options)));
    for (let i = 0; i < batchResults.length; i++) {
      const r = batchResults[i];
      if (r.kind === "candidate") {
        results.push(r.candidate);
        options?.onCandidate?.(r.candidate);
      } else if (r.kind === "indeterminate") {
        indeterminate.push(batchOriginals[i]);
      } else {
        recordExcluded(r, batchOriginals[i]);
      }
    }
    if (earlyBailAt != null && results.length >= earlyBailAt && queue.length > 0) {
      // Continue draining the remaining queue in a detached chain — fills the
      // verdict cache so the next "show more" doesn't re-fetch.
      const remainingQueue = queue.splice(0);
      const remainingOriginals = queueListings.splice(0);
      drainComplete = (async () => {
        try {
          while (remainingQueue.length > 0) {
            const bgBatch = remainingQueue.splice(0, maxConcurrent);
            const bgOriginals = remainingOriginals.splice(0, maxConcurrent);
            const bgResults = await Promise.all(bgBatch.map((listing) => cachedScreenOneFast(listing, options)));
            for (let i = 0; i < bgResults.length; i++) {
              const r = bgResults[i];
              if (r.kind === "candidate") {
                results.push(r.candidate);
                options?.onCandidate?.(r.candidate);
              } else if (r.kind === "indeterminate") {
                indeterminate.push(bgOriginals[i]);
              } else {
                // Keep the non-freehold tally complete past the early-bail so the
                // "I left out N cross-lease…" reminder reflects the whole pool.
                recordExcluded(r, bgOriginals[i]);
              }
            }
          }
        } catch (err) {
          logger.warn({ err, marker: "BACKGROUND_DRAIN" }, "Pre-screen: background drain errored — verdict cache may be incomplete");
        }
      })();
      break;
    }
  }

  const sorted = results.sort((a, b) => {
    const rank = (candidate: PropertyCandidate): number => {
      if ((candidate.standardPathViable === true || (candidate.potentialLots ?? 1) >= 2) && candidate.designLedEligible !== true) return 0;
      if (candidate.standardPathViable === true || (candidate.potentialLots ?? 1) >= 2) return 0;
      if (candidate.designLedEligible === true) return 1;
      return 2;
    };
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return b.scores.composite - a.scores.composite;
  });
  const candidates = resultCap == null ? sorted : sorted.slice(0, resultCap);
  return { candidates, indeterminate, excludedTenures, excludedNonFreehold, drainComplete };
}

export async function preScreenListingsFast(
  listings: ListingResult[],
  maxConcurrent = 5,
  /** After sorting by composite score; `null` = return all successful screens (discovery pagination). Default 3 keeps legacy behaviour. */
  resultCap: number | null = 3,
  options?: {
    /** POA / auction / negotiation listings often have `price: null` — still surface them in discover using a placeholder for scoring. */
    allowMissingListingPrice?: boolean;
    /** Mid-range estimate when allowing missing prices (defaults ~mid-market if omitted). */
    pricePlaceholderNzd?: number;
    strictStandardSubdivision?: boolean;
    preliminarySubdivision?: boolean;
    /** Scored development discovery — attribute prefilter + development gate (see screenOneFast). */
    developmentScreening?: boolean;
    /** Verify freehold/fee-simple title against LINZ (see screenOneFast). */
    verifyFreeholdTitle?: boolean;
    /** Non-freehold tenures the user opted in to seeing despite the subdivision catch (see screenOneFast). */
    includeTenures?: ("cross_lease" | "leasehold" | "unit_title")[];
  },
): Promise<PropertyCandidate[]> {
  const detailed = await preScreenListingsFastDetailed(listings, maxConcurrent, resultCap, options);
  return detailed.candidates;
}

async function screenOne(listing: ListingResult): Promise<PropertyCandidate | null> {
  try {
    const claims = extractListingClaims(listing);
    const geo = await geocodeAddress(listing.address);

    const hougarden = await scrapeHougarden(geo.lat, geo.lng, listing.address).catch(() => null);

    const zone = hougarden?.zone_code ?? listing.zone;
    const overlays = hougarden?.overlays ?? [];
    const land = hougarden?.land_area_sqm ?? listing.landArea;
    const price = listing.price ?? hougarden?.cv_nzd ?? 0;

    if (!price) return null;

    const { lots, minLotSize } = estimateLotCapacity(zone, land);
    const scores = quickScore(zone, overlays, land, price);

    return {
      address: listing.address,
      price,
      landArea: land ?? undefined,
      zone: zone ?? undefined,
      scores,
      briefSummary: makeSummary(zone, lots, minLotSize, overlays, land),
      potentialLots: lots,
      minLotSize: minLotSize ?? undefined,
      listingUrl: listing.listingUrl,
      photoUrl: listing.photoUrl ?? undefined,
      photoUrls: listing.photoUrls?.length ? listing.photoUrls : listing.photoUrl ? [listing.photoUrl] : undefined,
      priceDisplay: listing.priceText || undefined,
      propertyType: claims.dwellingIsTownhouse ? "Townhouse" : (listing.propertyType ?? listing.listingCategory ?? undefined),
      listingTitle: listing.listingTitle ?? listing.address.split(",")[0]?.trim() ?? listing.address,
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
    };
  } catch (err) {
    logger.warn({ err, address: listing.address }, "Pre-screen: failed for listing");
    return null;
  }
}

export async function preScreenListings(
  listings: ListingResult[],
  maxConcurrent = 3,
): Promise<PropertyCandidate[]> {
  const results: PropertyCandidate[] = [];
  const queue = [...listings];

  while (queue.length > 0) {
    const batch = queue.splice(0, maxConcurrent);
    const batchResults = await Promise.all(batch.map(screenOne));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }

  return results
    .sort((a, b) => b.scores.composite - a.scores.composite)
    .slice(0, 5);
}
