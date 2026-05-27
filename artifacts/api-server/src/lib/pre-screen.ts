import { logger } from "./logger";
import { geocodeAddress } from "./geocode";
import { scrapeHougarden } from "./scrapers/hougarden";
import { fetchUnitaryPlanZone, fetchOverlays, type ZoneResult, type Overlay } from "./auckland-council";
import type { ListingResult } from "./scrapers/oneroof";
import { calculatePotentialLots } from "./lot-calculator";
import { fetchLINZParcel } from "./linz";
import { fetchPropertyHistory } from "./property-data";
import { scrapePropertyValue } from "./scrapers/propertyvalue";
import {
  assessPropertyEligibility,
  shouldSuppressParentLandAreaForEligibility,
  type PropertyEligibilityConfidence,
  type PropertyTypology,
} from "./property-eligibility";
import {
  passesStrictStandardSubdivisionScreen,
  verifyDiscoveryLandArea,
  type DiscoveryLandAreaConfidence,
  type DiscoveryLandAreaSource,
} from "./discovery-land-area";
import { strictAttributePrefilter } from "./strict-prefilter";
import { getScreenVerdict, setScreenVerdict } from "./listing-cache";

export interface PropertyCandidate {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  scores: { ease: number; cost: number; roi: number; composite: number };
  briefSummary?: string;
  potentialLots?: number;
  minLotSize?: number;
  listingUrl?: string;
  photoUrl?: string;
  bedrooms?: number;
  bathrooms?: number;
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
  /** Floor (dwelling) area in m², extracted from listing og:description / JSON-LD. */
  floorArea?: number;
  /** True when og:description and page JSON-LD disagree on floor area. */
  floorAreaApprox?: boolean;
  typology?: PropertyTypology;
  typologyConfidence?: PropertyEligibilityConfidence;
  titleConfidence?: PropertyEligibilityConfidence;
  subdivisionEligible?: boolean;
  subdivisionRejectReason?: string | null;
  buildYear?: number | null;
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
): string {
  const zonePart = zone ? `${zone} zoned` : "Zoning TBC";
  const lotPart = lots > 1 ? `${lots} lots potentially feasible before site constraints` : "Single dwelling only on raw lot-size screen";
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
  },
): Promise<{
  zone: ZoneResult | null;
  resolvedOverlays: Overlay[];
  linzParcel: Awaited<ReturnType<typeof fetchLINZParcel>> | null;
  propertyHistory: Awaited<ReturnType<typeof fetchPropertyHistory>> | null;
  propertyValue: Awaited<ReturnType<typeof scrapePropertyValue>> | null;
  failedSources: string[];
}> {
  let zone: ZoneResult | null = null;
  let resolvedOverlays: Overlay[] = [];
  let linzParcel: Awaited<ReturnType<typeof fetchLINZParcel>> | null = null;
  let propertyHistory: Awaited<ReturnType<typeof fetchPropertyHistory>> | null = null;
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
    const needsPropertyHistory: boolean = opts.strictStandardSubdivision && !propertyHistory?.build_year;
    const needsPropertyValue: boolean = opts.shouldFetchPropertyValue && !propertyValue;

    const zonePromise: Promise<ZoneResult | null> = needsZone
      ? fetchUnitaryPlanZone(geo.lat, geo.lng)
      : Promise.resolve(zone);
    const overlaysPromise: Promise<Overlay[]> = needsOverlays
      ? fetchOverlays(geo.lat, geo.lng)
      : Promise.resolve(resolvedOverlays);
    const linzPromise: Promise<Awaited<ReturnType<typeof fetchLINZParcel>> | null> = needsLinz
      ? fetchLINZParcel(geo.lat, geo.lng)
      : Promise.resolve(linzParcel);
    const propertyHistoryPromise: Promise<Awaited<ReturnType<typeof fetchPropertyHistory>> | null> = needsPropertyHistory
      ? fetchPropertyHistory(listing.address, geo.lat, geo.lng)
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
    if (opts.strictStandardSubdivision && !propertyHistory?.build_year && !propertyValue?.build_year) failedSources.push("build_year");
    if (opts.shouldFetchPropertyValue && !propertyValue) failedSources.push("propertyvalue");

    if (!opts.strictStandardSubdivision) break;

    // In strict mode, only the essentials need to succeed before we stop
    // retrying. Zone + a build-year source are the two hard requirements; land
    // area we can verify from listing/homes/propertyValue as well.
    const haveBuildYear = !!(propertyHistory?.build_year || propertyValue?.build_year);
    const haveLandSignal = !!(linzParcel || listing.landArea != null || propertyValue?.land_area_sqm);
    if (zone && haveBuildYear && haveLandSignal) break;
  }

  return { zone, resolvedOverlays, linzParcel, propertyHistory, propertyValue, failedSources };
}

async function screenOneFast(
  listing: ListingResult,
  options?: {
    allowMissingListingPrice?: boolean;
    pricePlaceholderNzd?: number;
    strictStandardSubdivision?: boolean;
  },
): Promise<ScreenVerdict> {
  try {
    if (isApartmentAddress(listing.address)) {
      logger.debug({ address: listing.address }, "Pre-screen: skipping apartment/unit address");
      return { kind: "rejected", reason: "apartment_or_unit_address" };
    }

    // Cheap listing-attribute prefilter — rejects ~40-60% of a suburb queue
    // before any backend fetch when strict-subdivision discovery is on.
    if (options?.strictStandardSubdivision) {
      const prefilter = strictAttributePrefilter(listing);
      if (prefilter.kind === "reject") {
        logger.debug({ address: listing.address, reason: prefilter.reason }, "Pre-screen: strict attribute prefilter rejected listing");
        return { kind: "rejected", reason: `prefilter:${prefilter.reason}` };
      }
    }

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
    });

    const zone = zoneRecord?.zone_code ?? null;

    const preliminaryEligibility = assessPropertyEligibility({
      address: listing.address,
      estateType: listing.tenureText,
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
      buildYear: propertyHistory?.build_year ?? propertyValue?.build_year ?? null,
      zoneCode: zone,
      potentialLots: null,
      minLotSize: null,
      isCombinedListingAggregate: listing.isCombinedListing,
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
    if (price == null && options?.allowMissingListingPrice) {
      price = options.pricePlaceholderNzd ?? 1_750_000;
      priceApprox = true;
    }
    if (!price) return { kind: "rejected", reason: "no_price" };

    const { lots, minLotSize } = estimateLotCapacity(zone, land ?? null);
    const eligibility = assessPropertyEligibility({
          address: listing.address,
          estateType: listing.tenureText,
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
          buildYear: propertyHistory?.build_year ?? propertyValue?.build_year ?? null,
          zoneCode: zone,
          potentialLots: lots,
          minLotSize,
          isCombinedListingAggregate: listing.isCombinedListing,
        });
    if (options?.strictStandardSubdivision && !passesStrictStandardSubdivisionScreen({
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
      buildYear: propertyHistory?.build_year ?? null,
    })) {
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
          buildYear: propertyHistory?.build_year ?? propertyValue?.build_year ?? null,
          failedSources,
        },
        "Pre-screen: rejected strict subdivision candidate",
      );
      // Distinguish a confirmed reject (we know enough to say "no") from an
      // indeterminate one (essential data still missing even after retries).
      // The outer discovery loop re-screens indeterminate listings with longer
      // waits before declaring "no listings". We base this on the actual
      // decision inputs rather than which sources happened to fail — e.g. if
      // build year is known but >= 2000 the listing is a real reject, even if
      // some redundant source (LINZ / PropertyValue) was unavailable.
      const haveAnyBuildYear = propertyHistory?.build_year != null || propertyValue?.build_year != null;
      const isIndeterminate =
        !haveAnyBuildYear ||
        !zone ||
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
    const scores = quickScore(zone, resolvedOverlays, land ?? null, price);

    const candidate: PropertyCandidate = {
      address: listing.address,
      price,
      landArea: land ?? undefined,
      zone: zone ?? undefined,
      scores,
      briefSummary: makeSummary(zone, lots, minLotSize, resolvedOverlays, land ?? null),
      potentialLots: lots,
      minLotSize: minLotSize ?? undefined,
      listingUrl: listing.listingUrl,
      photoUrl: listing.photoUrl ?? undefined,
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
      floorArea: listing.floorArea ?? undefined,
      floorAreaApprox: listing.floorAreaApprox || undefined,
      typology: eligibility?.typology,
      typologyConfidence: eligibility?.typologyConfidence,
      titleConfidence: eligibility?.titleConfidence,
      subdivisionEligible: eligibility?.subdivisionEligible,
      subdivisionRejectReason: eligibility?.subdivisionRejectReason,
      buildYear: propertyHistory?.build_year ?? propertyValue?.build_year ?? null,
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
  if (options?.strictStandardSubdivision) {
    const cached = getScreenVerdict(listing);
    if (cached) {
      logger.debug({ address: listing.address, verdict: cached.kind }, "Pre-screen: verdict cache hit");
      return cached;
    }
  }
  const verdict = await screenOneFast(listing, options);
  if (options?.strictStandardSubdivision) setScreenVerdict(listing, verdict);
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
    /** Resolve once this many candidates have been collected; keep draining the rest in the background. */
    earlyBailAt?: number;
    /** Called each time a candidate is found, in order of completion (not score-sorted). */
    onCandidate?: (candidate: PropertyCandidate) => void;
  },
): Promise<PreScreenDetailedResult> {
  const nonApartments = listings.filter((l) => !isApartmentAddress(l.address));
  const results: PropertyCandidate[] = [];
  const indeterminate: ListingResult[] = [];
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

  const sorted = results.sort((a, b) => b.scores.composite - a.scores.composite);
  const candidates = resultCap == null ? sorted : sorted.slice(0, resultCap);
  return { candidates, indeterminate, drainComplete };
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
  },
): Promise<PropertyCandidate[]> {
  const detailed = await preScreenListingsFastDetailed(listings, maxConcurrent, resultCap, options);
  return detailed.candidates;
}

async function screenOne(listing: ListingResult): Promise<PropertyCandidate | null> {
  try {
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
      photoUrl: listing.photoUrl ?? undefined,
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
