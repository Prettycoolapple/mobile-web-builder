import { logger } from "../logger";
import type { LinzLrsAddressTitlePreview, LinzParcel } from "../linz";
import type { Overlay, ZoneResult } from "../auckland-council";
import type { InfrastructureItem } from "../infrastructure";
import type { HougardenData } from "./hougarden";
import type { OneRoofData, ComparableSale, ListingResult } from "./oneroof";
import type { QVData } from "./qv";
import type { HomesData } from "./homes";
import type { PropertyValueData } from "./propertyvalue";
import { addressLineAppearsInText, addressesLikelyMatch } from "./realestate-api";
import type { PropertyHistory } from "../property-data";
import type { PropertyEligibilityConfidence, PropertyTypology } from "../property-eligibility";
import type { TitleResolutionSource } from "../title-resolution";

export interface MergedPropertyData {
  cv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  build_year_range: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zone_code: string | null;
  zone_description: string | null;
  min_lot_size_sqm: number | null;
  overlays: Overlay[];
  school_zones: { primary: string | null; intermediate: string | null; secondary: string | null };
  last_sale_price: number | null;
  last_sale_date: string | null;
  listing_active: boolean;
  listing_price: number | null;
  main_photo_url: string | null;
  photo_urls: string[];
  overlay_map_image_base64: string | null;
  comparables: ComparableSale[];
  data_sources: Record<string, string>;
  /**
   * Human-readable notes describing each material disagreement that the merge
   * had to resolve (e.g. live OneRoof listing overriding council floor area).
   * Surfaced into the property_overview_snapshot so the report UI and the
   * follow-up chat can stay consistent about *why* a value was chosen.
   */
  discrepancies: string[];
  contour: "flat" | "subtle" | "gentle" | "moderate" | "steep" | "very_steep" | null;
  contour_slope_degrees: number | null;
  contour_source: string | null;
  contour_text: string | null;
  contour_steep_area_ratio?: number | null;
  contour_moderate_area_ratio?: number | null;
  contour_local_slope_p90_degrees?: number | null;
  contour_local_slope_p95_degrees?: number | null;
  contour_sample_count?: number | null;
  large_site_terrain_adjusted?: boolean;
  retaining_area_sqm_estimate?: number | null;
  asbestos_risk: "low" | "high" | "unknown";
  infrastructure: InfrastructureItem[];
  missing_critical_fields: string[];
  /** LINZ title estate description when resolved (e.g. Fee Simple / cross lease). */
  estate_type: string | null;
  titleResolutionSource?: TitleResolutionSource;
  lrsStatus?: string | null;
  property_type?: string | null;
  listing_title?: string | null;
  listing_url?: string | null;
  typology?: PropertyTypology;
  typologyConfidence?: PropertyEligibilityConfidence;
  titleConfidence?: PropertyEligibilityConfidence;
  subdivisionEligible?: boolean | null;
  subdivisionRejectReason?: string | null;
  /**
   * Whether the property appears to fall within the Veolia (Papakura) private
   * water & wastewater franchise area. Set from the geocoded lat/lng in the
   * pipeline (see detectVeoliaServiceZone) — a pure function of location, so it
   * is recomputed every serve rather than cached.
   */
  veolia_service_zone?: import("../veolia-service-zone").VeoliaServiceZone | null;
}

// ─── Simple "first non-null" helper ──────────────────────────────────────────
function first<T>(label: string, sources: Record<string, string>, ...candidates: Array<[string, T | null | undefined]>): T | null {
  for (const [src, val] of candidates) {
    if (val != null && val !== undefined) {
      sources[label] = src;
      return val;
    }
  }
  return null;
}

// ─── Smart CV merge: pick the value with the most recent valuation year ───────
// All NZ scrapers pull from the same Auckland Council ratings database. If
// sources differ it is because one cached an older valuation year. The most
// recent year is always the ground truth.
function bestCV(
  sources: Record<string, string>,
  candidates: Array<{ src: string; cv_nzd: number | null | undefined; cv_year: number | null | undefined }>,
): { cv_nzd: number | null; cv_year: number | null } {
  let bestNzd: number | null = null;
  let bestYear: number | null = null;
  let bestSrc: string | null = null;

  for (const c of candidates) {
    if (c.cv_nzd == null) continue;
    const year = c.cv_year ?? null;
    if (bestNzd === null) {
      // First valid value — take it
      bestNzd = c.cv_nzd; bestYear = year; bestSrc = c.src;
    } else if (year != null && (bestYear == null || year > bestYear)) {
      // More recent valuation year — upgrade
      bestNzd = c.cv_nzd; bestYear = year; bestSrc = c.src;
    }
  }

  if (bestSrc) sources["cv_nzd"] = bestSrc;
  return { cv_nzd: bestNzd, cv_year: bestYear };
}

// ─── Smart build-year merge: precision-aware with conflict detection ───────────
// Some sources expose only a built decade (e.g. "2010s") and our scraper stores
// that as the decade start (2010). Prefer a nearby exact year (e.g. 2016) over
// a rounded decade value so users see the actual build year where available.
function resolveBuildYear(
  sources: Record<string, string>,
  candidates: Array<{ src: string; build_year: number | null | undefined }>,
): { build_year: number | null; note: string | null } {
  const valid = candidates.filter((c): c is { src: string; build_year: number } => c.build_year != null);
  if (valid.length === 0) return { build_year: null, note: null };
  if (valid.length === 1) {
    sources["build_year"] = valid[0].src;
    return { build_year: valid[0].build_year, note: null };
  }

  const exact = valid.filter((c) => c.build_year % 10 !== 0);
  const decade = valid.filter((c) => c.build_year % 10 === 0);

  if (exact.length > 0) {
    const exactGroups: Array<{ key: number; members: typeof exact }> = [];
    for (const item of exact) {
      const existing = exactGroups.find((g) => Math.abs(item.build_year - g.key) <= 3);
      if (existing) {
        existing.members.push(item);
      } else {
        exactGroups.push({ key: item.build_year, members: [item] });
      }
    }
    exactGroups.sort((a, b) => {
      if (b.members.length !== a.members.length) return b.members.length - a.members.length;
      const aHasOr = a.members.some((m) => m.src === "oneroof");
      const bHasOr = b.members.some((m) => m.src === "oneroof");
      if (aHasOr !== bHasOr) return aHasOr ? -1 : 1;
      // Prefer newer year on tie — records often lag replacements; property pages update sooner
      return b.key - a.key;
    });

    const winner = exactGroups[0];
    const year = Math.round(winner.members.reduce((sum, m) => sum + m.build_year, 0) / winner.members.length);
    sources["build_year"] = winner.members.length > 1
      ? `exact-consensus(${winner.members.map((m) => m.src).join(",")})`
      : winner.members[0].src;

    const nearbyDecade = decade.find((d) => Math.abs(d.build_year - year) <= 9);
    if (nearbyDecade) {
      return {
        build_year: year,
        note: `Build year: exact source ${sources["build_year"]} reports ${year}; rounded decade value ${nearbyDecade.build_year} from ${nearbyDecade.src} was ignored.`,
      };
    }

    if (exactGroups.length > 1 || decade.length > 0) {
      logger.warn(
        { selected: `${sources["build_year"]}:${year}`, rejected: valid.filter((v) => Math.abs(v.build_year - year) > 3).map((v) => `${v.src}:${v.build_year}`) },
        "Build year conflict between sources — using exact-year source",
      );
    }
    return { build_year: year, note: null };
  }

  // Group values that are within ±3 years of each other
  const groups: Array<{ key: number; members: Array<{ src: string; build_year: number }> }> = [];
  for (const item of valid) {
    const existing = groups.find((g) => Math.abs(item.build_year - g.key) <= 3);
    if (existing) {
      existing.members.push(item);
    } else {
      groups.push({ key: item.build_year, members: [item] });
    }
  }

  // Sort groups: largest first, then prefer OneRoof / newer year on tie
  groups.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    const aHasOr = a.members.some((m) => m.src === "oneroof");
    const bHasOr = b.members.some((m) => m.src === "oneroof");
    if (aHasOr !== bHasOr) return aHasOr ? -1 : 1;
    return b.key - a.key; // newer year on tie (see exact-group rationale)
  });

  const winner = groups[0];
  const avgYear = Math.round(
    winner.members.reduce((sum, m) => sum + m.build_year, 0) / winner.members.length,
  );

  if (groups.length > 1) {
    logger.warn(
      { agreed: winner.members.map((m) => `${m.src}:${m.build_year}`), rejected: groups.slice(1).flatMap((g) => g.members.map((m) => `${m.src}:${m.build_year}`)) },
      "Build year conflict between sources — using majority/earliest group",
    );
  }

  sources["build_year"] = winner.members.length > 1
    ? `consensus(${winner.members.map((m) => m.src).join(",")})`
    : winner.members[0].src;

  return { build_year: avgYear, note: null };
}

// ─── Smart floor-area merge: median of credible values ───────────────────────
// Scrapers may include/exclude garage (20-40m² diff). Median filters outliers.
// Values outside [40, 2000] m² are treated as parse errors and excluded.
function medianFloorArea(
  sources: Record<string, string>,
  candidates: Array<{ src: string; floor_area_sqm: number | null | undefined }>,
): number | null {
  const valid = candidates.filter(
    (c): c is { src: string; floor_area_sqm: number } =>
      c.floor_area_sqm != null && c.floor_area_sqm >= 40 && c.floor_area_sqm <= 2000,
  );

  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => a.floor_area_sqm - b.floor_area_sqm);

  if (sorted.length === 2) {
    const [lo, hi] = sorted;
    if ((hi.floor_area_sqm - lo.floor_area_sqm) / lo.floor_area_sqm > 0.2) {
      const stable = sorted.find((v) => v.src !== "realestate.co.nz") ?? lo;
      logger.warn(
        { values: valid.map((v) => `${v.src}:${v.floor_area_sqm}`), selected: `${stable.src}:${stable.floor_area_sqm}` },
        "Floor area has one uncorroborated listing outlier - using stable source",
      );
      sources["floor_area_sqm"] = `${stable.src} (preferred over uncorroborated listing outlier)`;
      return stable.floor_area_sqm;
    }
  }

  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1].floor_area_sqm + sorted[mid].floor_area_sqm) / 2)
    : sorted[mid].floor_area_sqm;

  // Log if sources differ significantly (>20%)
  if (valid.length > 1) {
    const max = sorted[sorted.length - 1].floor_area_sqm;
    const min = sorted[0].floor_area_sqm;
    if ((max - min) / min > 0.2) {
      logger.warn(
        { values: valid.map((v) => `${v.src}:${v.floor_area_sqm}`), median },
        "Floor area varies >20% across sources — using median",
      );
    }
  }

  sources["floor_area_sqm"] = valid.length > 1
    ? `median(${valid.map((v) => v.src).join(",")})`
    : valid[0].src;

  return median;
}

function areaClose(a: number, b: number, tolerancePct: number): boolean {
  const pct = Math.abs(a - b) / Math.max(a, b);
  return pct <= tolerancePct;
}

function corroboratingAreaSource(
  target: number,
  candidates: Array<{ src: string; value: number | null | undefined }>,
  tolerancePct: number,
): { src: string; value: number } | null {
  for (const candidate of candidates) {
    if (candidate.value == null) continue;
    if (areaClose(candidate.value, target, tolerancePct)) {
      return { src: candidate.src, value: candidate.value };
    }
  }
  return null;
}

function shouldUseLiveAreaOverride(
  current: number | null,
  liveValue: number | null | undefined,
  liveApprox: boolean | undefined,
  corroborators: Array<{ src: string; value: number | null | undefined }>,
  tolerancePct: number,
): { use: boolean; corroborator: { src: string; value: number } | null } {
  if (liveValue == null) return { use: false, corroborator: null };
  if (liveApprox) return { use: false, corroborator: null };
  if (current == null) return { use: true, corroborator: null };
  if (areaClose(current, liveValue, tolerancePct)) return { use: false, corroborator: null };
  const corroborator = corroboratingAreaSource(liveValue, corroborators, tolerancePct);
  return { use: !!corroborator, corroborator };
}

function positiveRoomCount(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function roomCountConsensus(
  label: "Bedrooms" | "Bathrooms",
  current: number | null,
  currentSource: string | undefined,
  candidates: Array<{ src: string; value: number | null | undefined }>,
): { value: number | null; source: string | null; note: string | null } {
  const votes = candidates.flatMap((candidate) => {
    const value = positiveRoomCount(candidate.value);
    return value == null ? [] : [{ src: candidate.src, value }];
  });
  if (votes.length < 2) return { value: current, source: null, note: null };

  const tally = new Map<number, number>();
  for (const vote of votes) tally.set(vote.value, (tally.get(vote.value) ?? 0) + 1);
  if (tally.size < 2) return { value: current, source: null, note: null };

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const [consensusValue, consensusCount] = ranked[0]!;
  const runnerUpCount = ranked[1]?.[1] ?? 0;
  // A tie retains the existing source precedence. Only a strict modal result
  // is strong enough to replace a subject-matched off-market profile value.
  if (consensusCount <= runnerUpCount) return { value: current, source: null, note: null };

  const voteSummary = ranked
    .map(([value, count]) => `${count} source${count === 1 ? "" : "s"}: ${value}`)
    .join(", ");
  const selectedSource = current === consensusValue ? null : "consensus";
  return {
    value: consensusValue,
    source: selectedSource,
    note: `${label}: address-matched off-market records disagree (${voteSummary}). Using the ${consensusCount}/${votes.length} source consensus of ${consensusValue}.`,
  };
}

function propertyValueHasStrongDwellingEvidence(propertyValue: PropertyValueData | null): boolean {
  if (!propertyValue) return false;
  const improvements = propertyValue.property_improvements?.trim() ?? "";
  return (
    (propertyValue.iv_nzd != null && propertyValue.iv_nzd > 0) ||
    propertyValue.build_year != null ||
    (propertyValue.floor_area_sqm != null && propertyValue.floor_area_sqm >= 30) ||
    (propertyValue.bedrooms != null && propertyValue.bedrooms > 0) ||
    /\b(?:DWG|dwelling|house|home)\b/i.test(improvements)
  );
}

function hasUnitOrCrossLeaseListingSignal(listing: ListingResult | null): boolean {
  if (!listing) return false;
  const text = [
    listing.propertyType,
    listing.listingCategory,
    listing.tenureText,
    listing.legalDescription,
  ].filter(Boolean).join(" ").toLowerCase();
  return /\b(unit\s+title|unit\s+[a-z]\b|accessory\s+unit|unit|stratum|body\s+corporate|cross\s*lease|crosslease|flat|apartment)\b/i.test(text);
}

function inferLifestyleZone(
  propertyValue: PropertyValueData | null,
  landAreaSqm: number | null,
): { code: string; description: string; minLotSizeSqm: number } | null {
  const typeText = [
    propertyValue?.property_type,
    propertyValue?.property_sub_type,
  ].filter(Boolean).join(" ").toLowerCase();
  const area = landAreaSqm ?? propertyValue?.land_area_sqm ?? null;

  if (area != null && area >= 8000 && /\blifestyle\b/.test(typeText)) {
    return {
      code: "CLZ",
      description: "Countryside Living Zone",
      minLotSizeSqm: 10000,
    };
  }

  return null;
}

function normaliseAddressScope(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/[^a-z0-9&+]+/g, "");
}

function realestateListingScopedToSubject(
  listing: ListingResult | null,
  analysedAddress: string | null | undefined,
): boolean {
  if (!listing?.isCombinedListing) return true;
  const listingScope = normaliseAddressScope(listing.address);
  const subjectScope = normaliseAddressScope(analysedAddress);
  return !!listingScope && listingScope === subjectScope;
}

function isInactiveRealestateListing(listing: ListingResult | null): boolean {
  return /sold|withdrawn|expired|archived|closed/i.test(listing?.listingStatus ?? "");
}

function sourceAddressMatchesSubject(
  analysedAddress: string | null | undefined,
  confirmedAddress: string | null | undefined,
): boolean {
  if (!confirmedAddress) return true;
  const target = analysedAddress ?? "";
  const targetUnit = firstLineStreetNumberUnit(target);
  const confirmedUnit = firstLineStreetNumberUnit(confirmedAddress);
  if (targetUnit && confirmedUnit) {
    if (targetUnit.number !== confirmedUnit.number) return false;
    if (targetUnit.suffix !== confirmedUnit.suffix) return false;
  }
  return addressesLikelyMatch(target, confirmedAddress) || addressLineAppearsInText(target, confirmedAddress);
}

function firstLineStreetNumberUnit(value: string | null | undefined): { number: string; suffix: string } | null {
  const firstLine = String(value ?? "")
    .replace(/^https?:\/\/[^/]+\/address\//i, "")
    .replace(/[-_/]+/g, " ")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const match = firstLine.match(/\b(\d+)\s*([a-z])?\b/);
  if (!match) return null;
  return {
    number: match[1],
    suffix: match[2] ?? "",
  };
}

function analysedAddressHasChildSuffix(value: string | null | undefined): boolean {
  const unit = firstLineStreetNumberUnit(value);
  return !!unit?.suffix;
}

function analysedAddressLooksUnitLike(value: string | null | undefined): boolean {
  const firstLine = String(value ?? "").split(",")[0]?.trim() ?? "";
  return (
    analysedAddressHasChildSuffix(value) ||
    /^(?:unit|flat|apartment|apt)\b/i.test(firstLine) ||
    /^\d+\s*\/\s*\d+/i.test(firstLine)
  );
}

function liveLrsTitles(preview: LinzLrsAddressTitlePreview | null | undefined) {
  return (preview?.titles ?? []).filter((title) => /^live$/i.test(title.title_status?.trim() ?? ""));
}

function isFeeSimpleTitle(type: string | null | undefined): boolean {
  return /^(?:fee\s*simple|freehold)$/i.test(type?.trim() ?? "");
}

function titleClearlySpansMultipleParcels(legalDescriptions: string[]): boolean {
  if (legalDescriptions.length > 1) return true;
  const legal = legalDescriptions.join(" ");
  return (
    /\b(?:lots|sections)\s+\d+/i.test(legal) ||
    /\b(?:lot|section)\s+\d+\s*(?:-|,|&|\band\b)\s*\d+/i.test(legal)
  );
}

function exactMultiParcelTitleArea(preview: LinzLrsAddressTitlePreview | null | undefined): number | null {
  const live = liveLrsTitles(preview);
  if (live.length !== 1) return null;
  const title = live[0]!;
  if (!isFeeSimpleTitle(title.title_type)) return null;
  if (!titleClearlySpansMultipleParcels(title.legal_descriptions)) return null;
  const area = title.indicative_area_sqm;
  return area != null && Number.isFinite(area) && area >= 10 && area <= 100_000_000 ? Math.round(area) : null;
}

function titlePreviewConfirmsStandalone(preview: LinzLrsAddressTitlePreview | null | undefined): boolean | null {
  if (!preview) return null;
  const live = liveLrsTitles(preview);
  if (live.length !== 1) return false;
  return isFeeSimpleTitle(live[0]!.title_type);
}

function knownNonStandaloneProperty(
  address: string | null | undefined,
  realestateListing: ListingResult | null,
  oneroof: OneRoofData | null,
  propertyValue: PropertyValueData | null,
): boolean {
  if (analysedAddressLooksUnitLike(address)) return true;
  const text = [
    realestateListing?.propertyType,
    realestateListing?.listingCategory,
    realestateListing?.tenureText,
    realestateListing?.legalDescription,
    oneroof?.tenureText,
    propertyValue?.property_type,
    propertyValue?.property_sub_type,
    ...(propertyValue?.legal_descriptions ?? []),
  ].filter(Boolean).join(" ");
  return /\b(unit\s*title|unit\s+[a-z]\b|accessory\s+unit|stratum|body\s+corporate|cross\s*lease|crosslease|flat|apartment)\b/i.test(text);
}

export function mergePropertyData(
  linz: LinzParcel | null,
  hougarden: HougardenData | null,
  oneroof: OneRoofData | null,
  councilZone: ZoneResult | null,
  councilOverlays: Overlay[],
  extra?: {
    contour: "flat" | "subtle" | "gentle" | "moderate" | "steep" | "very_steep" | null;
    contour_slope_degrees?: number | null;
    contour_source?: string | null;
    contour_text?: string | null;
    contour_steep_area_ratio?: number | null;
    contour_moderate_area_ratio?: number | null;
    contour_local_slope_p90_degrees?: number | null;
    contour_local_slope_p95_degrees?: number | null;
    contour_sample_count?: number | null;
    large_site_terrain_adjusted?: boolean;
    retaining_area_sqm_estimate?: number | null;
    asbestos_risk: "low" | "high" | "unknown";
    infrastructure: InfrastructureItem[];
    property_history?: PropertyHistory | null;
    qv?: QVData | null;
    homes?: HomesData | null;
    propertyValue?: PropertyValueData | null;
    linz_lrs_title_preview?: LinzLrsAddressTitlePreview | null;
    analysed_address?: string | null;
    /** Active address-matched listing from realestate.co.nz. */
    realestate_listing?: ListingResult | null;
    /** Exact active listing the user tapped from a discovery card. */
    preferred_realestate_listing_url?: string | null;
    /** Active listing images from realestate.co.nz when OneRoof has none. */
    realestate_photo_urls?: string[] | null;
    selected_listing_context?: { propertyType?: string | null; listingTitle?: string | null; listingUrl?: string | null } | null;
  },
): MergedPropertyData {
  const sources: Record<string, string> = {};
  const ph = extra?.property_history ?? null;
  const qv = extra?.qv ?? null;
  const homes = extra?.homes ?? null;
  const propertyValue = extra?.propertyValue ?? null;
  const realestateListingRaw = extra?.realestate_listing ?? null;
  const realestateListing = realestateListingScopedToSubject(realestateListingRaw, extra?.analysed_address)
    ? realestateListingRaw
    : null;
  const selectedRealestateListing =
    !!extra?.preferred_realestate_listing_url &&
    !!realestateListing?.listingUrl &&
    realestateListing.listingUrl === extra.preferred_realestate_listing_url;
  const hasIgnoredCombinedListing = !!realestateListingRaw?.isCombinedListing && !realestateListing;

  // PropertyValue resolves an address via a FUZZY suggestion match, so for an
  // unlisted property it can lock onto a neighbour. Only trust its
  // subject-specific facts (bed/bath) when the address it confirmed plausibly
  // matches the address we analysed. When it confirmed a *different* address,
  // prefer "unavailable" (null) over a wrong number. (A null confirmation is
  // left as-is — we can't prove it's wrong, and OneRoof/realestate take
  // precedence in the `first()` order anyway.)
  const propertyValueMatchesSubject =
    !propertyValue ||
    sourceAddressMatchesSubject(extra?.analysed_address, propertyValue.address_confirmed);
  const homesMatchesSubject =
    !homes ||
    sourceAddressMatchesSubject(extra?.analysed_address, homes.address_confirmed);
  const qvMatchesSubject =
    !qv ||
    sourceAddressMatchesSubject(extra?.analysed_address, qv.address_confirmed);
  const propertyValueBeds = propertyValueMatchesSubject ? propertyValue?.bedrooms : null;
  const propertyValueBaths = propertyValueMatchesSubject ? propertyValue?.bathrooms : null;
  const propertyValueLandArea = propertyValueMatchesSubject ? propertyValue?.land_area_sqm : null;
  const propertyValueFloorArea = propertyValueMatchesSubject ? propertyValue?.floor_area_sqm : null;
  const propertyValueBuildYearRange = propertyValueMatchesSubject ? propertyValue?.build_year_range : null;
  const propertyValueBuildYear = propertyValueMatchesSubject && !propertyValueBuildYearRange ? propertyValue?.build_year : null;
  const homesBeds = homesMatchesSubject ? homes?.bedrooms : null;
  const homesBaths = homesMatchesSubject ? homes?.bathrooms : null;
  const homesLandArea = homesMatchesSubject ? homes?.land_area_sqm : null;
  const homesFloorArea = homesMatchesSubject ? homes?.floor_area_sqm : null;
  const homesBuildYearRange = homesMatchesSubject ? homes?.build_year_range : null;
  const homesBuildYear = homesMatchesSubject && !homesBuildYearRange ? homes?.build_year : null;
  const qvBeds = qvMatchesSubject ? qv?.bedrooms : null;
  const qvBaths = qvMatchesSubject ? qv?.bathrooms : null;
  const qvLandArea = qvMatchesSubject ? qv?.land_area_sqm : null;
  const qvFloorArea = qvMatchesSubject ? qv?.floor_area_sqm : null;
  const qvBuildYearRange = qvMatchesSubject ? qv?.build_year_range : null;
  const qvBuildYear = qvMatchesSubject && !qvBuildYearRange ? qv?.build_year : null;
  if (propertyValue && !propertyValueMatchesSubject) {
    logger.info(
      { analysed: extra?.analysed_address, confirmed: propertyValue.address_confirmed },
      "Merge: PropertyValue confirmed a different address — ignoring its bed/bath",
    );
  }

  // Land area: LINZ is the authoritative cadastral measurement — always wins.
  const propertyHistorySource = ph?.sources_confirmed.some((source) => source.includes("Palmerston North City Council"))
    ? "pncc_council_rating_gis"
    : ph?.sources_confirmed.some((source) => source.includes("Whakatane District Council"))
      ? "whakatane_council_rating_gis"
      : ph?.sources_confirmed.some((source) => source.includes("Southland District Council"))
        ? "southland_council_rating_gis"
        : ph?.sources_confirmed.some((source) => source.includes("Western Bay of Plenty District Council"))
          ? "western_bay_council_rating_gis"
          : "auckland_council_gis";

  const analysedIsChildAddress = analysedAddressHasChildSuffix(extra?.analysed_address);
  const exactChildLandCandidates: Array<[string, number | null | undefined]> = analysedIsChildAddress
    ? [
        ["propertyvalue", propertyValueLandArea],
        ["qv", qvLandArea],
        ["homes", homesLandArea],
        ["realestate.co.nz", realestateListing?.landArea],
      ]
    : [];

  const nonStandaloneProperty = knownNonStandaloneProperty(
    extra?.analysed_address,
    realestateListing,
    oneroof,
    propertyValue,
  );
  const titleStandalone = titlePreviewConfirmsStandalone(extra?.linz_lrs_title_preview);
  const hasMultipleLiveTitles = liveLrsTitles(extra?.linz_lrs_title_preview).length > 1;
  const verifiedChristchurchRatingArea =
    ph?.land_area_source === "christchurch_council_rating_unit" &&
    ph.land_area_scope === "rating_unit" &&
    !nonStandaloneProperty &&
    !hasMultipleLiveTitles &&
    titleStandalone !== false
      ? ph.land_area_sqm
      : null;
  const verifiedMultiParcelTitleArea = !nonStandaloneProperty
    ? exactMultiParcelTitleArea(extra?.linz_lrs_title_preview)
    : null;
  const landResolutionNotes: string[] = [];
  const propertyLevelArea = verifiedChristchurchRatingArea ?? verifiedMultiParcelTitleArea;
  const propertyLevelSource = verifiedChristchurchRatingArea != null
    ? "christchurch_council_rating_unit"
    : verifiedMultiParcelTitleArea != null
      ? "linz_lrs_title"
      : null;

  if (propertyLevelArea != null && linz?.area_sqm != null && !areaClose(propertyLevelArea, linz.area_sqm, 0.1)) {
    landResolutionNotes.push(
      `Land area: the exact ${propertyLevelSource === "christchurch_council_rating_unit" ? "Christchurch Council rating unit" : "LINZ fee-simple title"} is ${propertyLevelArea}m² while the address point intersects one ${linz.area_sqm}m² cadastral parcel. Using the complete property-level area.`,
    );
  }
  if (
    ph?.land_area_source === "christchurch_council_rating_unit" &&
    ph.land_area_sqm != null &&
    verifiedChristchurchRatingArea == null
  ) {
    landResolutionNotes.push(
      `Land area: Christchurch Council returned a ${ph.land_area_sqm}m² rating unit, but unit/cross-lease or multiple-title safeguards could not confirm it as this property's standalone land. The existing parcel/source value was retained.`,
    );
  }

  const land_area_sqm = first("land_area_sqm", sources,
    ...exactChildLandCandidates,
    [propertyLevelSource ?? "property_level", propertyLevelArea],
    ["linz", linz?.area_sqm],
    [ph?.land_area_source ?? "auckland_council_gis", ph?.land_area_sqm],
    ["propertyvalue", propertyValueLandArea],
    ["qv", qvLandArea],
    ["homes", homesLandArea],
    ["hougarden", hougarden?.land_area_sqm],
    ["oneroof", oneroof?.land_area_sqm],
    ["realestate.co.nz", realestateListing?.landArea],
  );

  // CV: pick the valuation with the most recent year, not just the first non-null.
  const { cv_nzd, cv_year } = bestCV(sources, [
    { src: propertyHistorySource, cv_nzd: ph?.cv_nzd, cv_year: ph?.cv_year },
    { src: "propertyvalue",      cv_nzd: propertyValue?.cv_nzd, cv_year: propertyValue?.cv_year },
    { src: "oneroof",            cv_nzd: oneroof?.cv_nzd,  cv_year: oneroof?.cv_year },
    { src: "hougarden",          cv_nzd: hougarden?.cv_nzd, cv_year: undefined },
    { src: "qv",                 cv_nzd: qv?.cv_nzd,       cv_year: qv?.cv_year },
    { src: "homes",              cv_nzd: homes?.cv_nzd,    cv_year: undefined },
  ]);

  // Build year: prefer exact source years over rounded decade values.
  const buildYearResult = resolveBuildYear(sources, [
    { src: "propertyvalue",      build_year: propertyValueBuildYear },
    { src: "oneroof",            build_year: oneroof?.listing_active ? oneroof.build_year : null },
    { src: "hougarden",          build_year: hougarden?.build_year },
    { src: "auckland_council_gis", build_year: ph?.build_year },
    { src: "qv",                 build_year: qvBuildYear },
    { src: "homes",              build_year: homesBuildYear },
  ]);
  let build_year = buildYearResult.build_year;
  // Keep decade/range-only records approximate instead of manufacturing an exact year.
  const rawRange = build_year == null ? (propertyValueBuildYearRange ?? qvBuildYearRange ?? homesBuildYearRange ?? null) : null;
  let build_year_range = build_year == null ? rawRange : null;

  // Floor area: median of credible values.
  let floor_area_sqm = medianFloorArea(sources, [
    { src: "propertyvalue",      floor_area_sqm: propertyValueFloorArea },
    { src: "oneroof",            floor_area_sqm: oneroof?.floor_area_sqm },
    { src: "realestate.co.nz",   floor_area_sqm: realestateListing?.floorArea },
    { src: "hougarden",          floor_area_sqm: hougarden?.floor_area_sqm },
    { src: "auckland_council_gis", floor_area_sqm: ph?.floor_area_sqm },
    { src: "qv",                 floor_area_sqm: qvFloorArea },
    { src: "homes",              floor_area_sqm: homesFloorArea },
  ]);

  const oneroofLiveBeds = oneroof?.listing_active ? oneroof?.bedrooms : null;
  const oneroofProfileBeds = oneroof?.listing_active ? null : oneroof?.bedrooms;
  const oneroofLiveBaths = oneroof?.listing_active ? oneroof?.bathrooms : null;
  const oneroofProfileBaths = oneroof?.listing_active ? null : oneroof?.bathrooms;

  let bedrooms = first("bedrooms", sources,
    ["realestate.co.nz", realestateListing?.bedrooms],
    ["oneroof (live listing)", oneroofLiveBeds],
    ["homes",   homesBeds],
    ["qv",      qvBeds],
    ["oneroof", oneroofProfileBeds],
    ["propertyvalue", propertyValueBeds],
  );
  let bathrooms = first("bathrooms", sources,
    ["realestate.co.nz", realestateListing?.bathrooms],
    ["oneroof (live listing)", oneroofLiveBaths],
    ["homes",   homesBaths],
    ["qv",      qvBaths],
    ["oneroof", oneroofProfileBaths],
    ["propertyvalue", propertyValueBaths],
  );
  let property_type = first("property_type", sources,
    ["realestate.co.nz", realestateListing?.propertyType],
    ["selected_listing", extra?.selected_listing_context?.propertyType],
    ["propertyvalue", propertyValue?.property_type],
    [ph?.land_area_source ?? "auckland_council_gis", ph?.property_type],
  );
  const listing_title = realestateListing?.listingTitle ?? extra?.selected_listing_context?.listingTitle ?? null;
  const listing_url = realestateListing?.listingUrl ?? extra?.selected_listing_context?.listingUrl ?? null;

  // Track human-readable discrepancy notes for everything the live-listing
  // reconciliation rewrites. Surfaced via MergedPropertyData.discrepancies so
  // the report UI and the follow-up chat can stay aligned on *why* a value
  // was chosen.
  const discrepancies: string[] = [];
  discrepancies.push(...landResolutionNotes);
  if (buildYearResult.note) discrepancies.push(buildYearResult.note);

  // Rating feeds occasionally expose a stray bed/bath count on an otherwise
  // clearly vacant section. Prefer the address-matched valuation classification
  // when it says Vacant, has zero improvement value, and no active listing says
  // a dwelling now exists. This prevents a phantom bathroom from triggering
  // demolition and existing-house costs (481 Pukehina Parade is one example).
  const propertyValueConfirmsVacant = propertyValueMatchesSubject
    && /\b(?:vacant|bare\s+land|section)\b/i.test([
      propertyValue?.property_sub_type,
      propertyValue?.land_use_primary,
      propertyValue?.property_improvements,
    ].filter(Boolean).join(" "));
  const qvConfirmsNoImprovements = !!qv && (
    qvMatchesSubject
    && (qv.iv_nzd == null || qv.iv_nzd === 0)
    && qv.floor_area_sqm == null
    && qv.build_year == null
    && qv.bedrooms == null
    && qv.bathrooms == null
  );
  const hasActiveDwellingListing = !!oneroof?.listing_active || !!realestateListing;
  if (
    propertyValueConfirmsVacant &&
    !propertyValueHasStrongDwellingEvidence(propertyValue) &&
    qvConfirmsNoImprovements &&
    !hasActiveDwellingListing
  ) {
    build_year = null;
    build_year_range = null;
    floor_area_sqm = null;
    bedrooms = null;
    bathrooms = null;
    property_type = "Vacant land / section";
    for (const key of ["build_year", "floor_area_sqm", "bedrooms", "bathrooms"]) delete sources[key];
    sources["property_type"] = "propertyvalue (vacant valuation record)";
    discrepancies.push(
      "Address-matched valuation records classify the property as vacant land with zero improvement value, so dwelling-only fields were left unavailable.",
    );
  }
  if (hasIgnoredCombinedListing) {
    discrepancies.push(
      `Active realestate.co.nz listing "${realestateListingRaw.address}" appears to package multiple addresses, so its bed/bath/floor/land figures were not used for this single-property report.`,
    );
    sources["realestate_listing"] = "ignored combined listing";
  }

  // Live-listing reconciliation:
  // When OneRoof shows the property is *currently listed for sale*, the listing
  // data is being actively maintained by the agent and reflects the property
  // *as it is today* (post-renovation, post-subdivision, post-extension).
  // Council/QV records can lag by years. If the active-listing values
  // materially disagree with the consensus, prefer the listing.
  let live_land_area_sqm: number | null = null;
  if (oneroof?.listing_active) {
    if (oneroof.floor_area_sqm != null && floor_area_sqm != null) {
      const delta = Math.abs(oneroof.floor_area_sqm - floor_area_sqm) / floor_area_sqm;
      const override = shouldUseLiveAreaOverride(
        floor_area_sqm,
        oneroof.floor_area_sqm,
        false,
        [
          { src: "realestate.co.nz", value: realestateListing?.floorArea },
          { src: "propertyvalue", value: propertyValueFloorArea },
          { src: "auckland_council_gis", value: ph?.floor_area_sqm },
          { src: "qv", value: qvFloorArea },
          { src: "homes", value: homesFloorArea },
          { src: "hougarden", value: hougarden?.floor_area_sqm },
        ],
        0.15,
      );
      if (delta > 0.15 && override.use) {
        logger.info(
          { previous: floor_area_sqm, listing: oneroof.floor_area_sqm, delta },
          "Merge: live OneRoof listing overrides floor area (>15% disagreement)",
        );
        discrepancies.push(
          `Floor area: live OneRoof listing reports ${oneroof.floor_area_sqm}m² vs council/QV consensus ${floor_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the live listing as the most current measurement.`,
        );
        floor_area_sqm = oneroof.floor_area_sqm;
        sources["floor_area_sqm"] = "oneroof (live listing)";
      } else if (delta > 0.15) {
        logger.warn(
          { current: floor_area_sqm, listing: oneroof.floor_area_sqm, delta },
          "Merge: ignored uncorroborated OneRoof floor-area outlier",
        );
      }
    } else if (oneroof.floor_area_sqm != null && floor_area_sqm == null) {
      floor_area_sqm = oneroof.floor_area_sqm;
      sources["floor_area_sqm"] = "oneroof (live listing)";
    }
    if (oneroof.bedrooms != null && bedrooms != null && oneroof.bedrooms !== bedrooms) {
      logger.info(
        { previous: bedrooms, listing: oneroof.bedrooms },
        "Merge: live OneRoof listing overrides bedroom count",
      );
      discrepancies.push(
        `Bedrooms: live OneRoof listing reports ${oneroof.bedrooms} vs council/QV record ${bedrooms}. Using the live listing.`,
      );
      bedrooms = oneroof.bedrooms;
      sources["bedrooms"] = "oneroof (live listing)";
    } else if (oneroof.bedrooms != null && bedrooms == null) {
      bedrooms = oneroof.bedrooms;
      sources["bedrooms"] = "oneroof (live listing)";
    }
    if (oneroof.bathrooms != null && bathrooms != null && oneroof.bathrooms !== bathrooms) {
      logger.info(
        { previous: bathrooms, listing: oneroof.bathrooms },
        "Merge: live OneRoof listing overrides bathroom count",
      );
      discrepancies.push(
        `Bathrooms: live OneRoof listing reports ${oneroof.bathrooms} vs council/QV record ${bathrooms}. Using the live listing.`,
      );
      bathrooms = oneroof.bathrooms;
      sources["bathrooms"] = "oneroof (live listing)";
    } else if (oneroof.bathrooms != null && bathrooms == null) {
      bathrooms = oneroof.bathrooms;
      sources["bathrooms"] = "oneroof (live listing)";
    }
    // Land area: LINZ is cadastral truth, but if the live listing materially
    // disagrees (>10%) it usually means the parcel was subdivided after the
    // last LINZ refresh and the listing reflects the new title size.
    if (oneroof.land_area_sqm != null && land_area_sqm != null) {
      const delta = Math.abs(oneroof.land_area_sqm - land_area_sqm) / land_area_sqm;
      const override = shouldUseLiveAreaOverride(
        land_area_sqm,
        oneroof.land_area_sqm,
        false,
        [
          { src: "realestate.co.nz", value: realestateListing?.landArea },
          { src: "propertyvalue", value: propertyValueLandArea },
          { src: "auckland_council_gis", value: ph?.land_area_sqm },
          { src: "qv", value: qvLandArea },
          { src: "homes", value: homesLandArea },
          { src: "hougarden", value: hougarden?.land_area_sqm },
        ],
        0.1,
      );
      if (delta > 0.1 && override.use) {
        logger.info(
          { previous: land_area_sqm, listing: oneroof.land_area_sqm, delta },
          "Merge: live OneRoof listing overrides land area (>10% disagreement — likely post-subdivision)",
        );
        discrepancies.push(
          `Land area: live OneRoof listing reports ${oneroof.land_area_sqm}m² vs LINZ cadastre ${land_area_sqm}m² (${(delta * 100).toFixed(0)}% difference — usually a recent subdivision). Using the live listing.`,
        );
        live_land_area_sqm = oneroof.land_area_sqm;
        sources["land_area_sqm"] = "oneroof (live listing)";
      } else if (delta > 0.1) {
        logger.warn(
          { cadastral: land_area_sqm, listing: oneroof.land_area_sqm, delta },
          "Merge: ignored uncorroborated OneRoof land-area outlier",
        );
      }
    }
  }

  // realestate.co.nz active-listing reconciliation:
  // In production the browser scrapers are often disabled, but the
  // realestate.co.nz JSON API still gives us structured active listing data.
  // Treat an address-matched active listing as fresher than static valuation
  // records for bed/bath/floor counts.
  if (realestateListing) {
    if (realestateListing.floorArea != null && floor_area_sqm != null) {
      const delta = Math.abs(realestateListing.floorArea - floor_area_sqm) / floor_area_sqm;
      const override = shouldUseLiveAreaOverride(
        floor_area_sqm,
        realestateListing.floorArea,
        realestateListing.floorAreaApprox,
        [
          { src: "oneroof", value: oneroof?.floor_area_sqm },
          { src: "propertyvalue", value: propertyValueFloorArea },
          { src: "auckland_council_gis", value: ph?.floor_area_sqm },
          { src: "qv", value: qvFloorArea },
          { src: "homes", value: homesFloorArea },
          { src: "hougarden", value: hougarden?.floor_area_sqm },
        ],
        0.15,
      );
      if (delta > 0.15 && override.use) {
        logger.info(
          { previous: floor_area_sqm, listing: realestateListing.floorArea, delta },
          "Merge: active realestate.co.nz listing overrides floor area (>15% disagreement)",
        );
        discrepancies.push(
          `Floor area: active realestate.co.nz listing reports ${realestateListing.floorArea}m² vs council/QV consensus ${floor_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the active listing.`,
        );
        floor_area_sqm = realestateListing.floorArea;
        sources["floor_area_sqm"] = "realestate.co.nz (active listing)";
      } else if (delta > 0.15) {
        logger.warn(
          { current: floor_area_sqm, listing: realestateListing.floorArea, delta, approximate: realestateListing.floorAreaApprox },
          "Merge: ignored uncorroborated realestate.co.nz floor-area outlier",
        );
      }
    } else if (realestateListing.floorArea != null && floor_area_sqm == null) {
      floor_area_sqm = realestateListing.floorArea;
      sources["floor_area_sqm"] = "realestate.co.nz (active listing)";
    }

    if (realestateListing.bedrooms != null && bedrooms != null && realestateListing.bedrooms !== bedrooms) {
      logger.info(
        { previous: bedrooms, listing: realestateListing.bedrooms },
        "Merge: active realestate.co.nz listing overrides bedroom count",
      );
      discrepancies.push(
        `Bedrooms: active realestate.co.nz listing reports ${realestateListing.bedrooms} vs council/QV record ${bedrooms}. Using the active listing.`,
      );
      bedrooms = realestateListing.bedrooms;
      sources["bedrooms"] = "realestate.co.nz (active listing)";
    } else if (realestateListing.bedrooms != null && bedrooms == null) {
      bedrooms = realestateListing.bedrooms;
      sources["bedrooms"] = "realestate.co.nz (active listing)";
    }

    if (realestateListing.bathrooms != null && bathrooms != null && realestateListing.bathrooms !== bathrooms) {
      logger.info(
        { previous: bathrooms, listing: realestateListing.bathrooms },
        "Merge: active realestate.co.nz listing overrides bathroom count",
      );
      discrepancies.push(
        `Bathrooms: active realestate.co.nz listing reports ${realestateListing.bathrooms} vs council/QV record ${bathrooms}. Using the active listing.`,
      );
      bathrooms = realestateListing.bathrooms;
      sources["bathrooms"] = "realestate.co.nz (active listing)";
    } else if (realestateListing.bathrooms != null && bathrooms == null) {
      bathrooms = realestateListing.bathrooms;
      sources["bathrooms"] = "realestate.co.nz (active listing)";
    }

    if (realestateListing.landArea != null && land_area_sqm != null) {
      const delta = Math.abs(realestateListing.landArea - land_area_sqm) / land_area_sqm;
      const exactUnitChildArea =
        hasUnitOrCrossLeaseListingSignal(realestateListing) &&
        realestateListing.landAreaConfidence === "verified" &&
        !realestateListing.landAreaApprox &&
        realestateListing.landArea < land_area_sqm;
      const selectedListingSubjectArea =
        selectedRealestateListing &&
        !realestateListing.isCombinedListing &&
        !hasUnitOrCrossLeaseListingSignal(realestateListing) &&
        realestateListing.landAreaConfidence === "verified";
      const override = shouldUseLiveAreaOverride(
        land_area_sqm,
        realestateListing.landArea,
        realestateListing.landAreaApprox,
        [
          { src: "oneroof", value: oneroof?.land_area_sqm },
          { src: "propertyvalue", value: propertyValueLandArea },
          { src: "auckland_council_gis", value: ph?.land_area_sqm },
          { src: "qv", value: qvLandArea },
          { src: "homes", value: homesLandArea },
          { src: "hougarden", value: hougarden?.land_area_sqm },
        ],
        0.1,
      );
      if (delta > 0.1 && (override.use || exactUnitChildArea || selectedListingSubjectArea)) {
        logger.info(
          { previous: land_area_sqm, listing: realestateListing.landArea, delta, exactUnitChildArea, selectedListingSubjectArea },
          "Merge: active realestate.co.nz listing overrides land area (>10% disagreement)",
        );
        discrepancies.push(
          selectedListingSubjectArea
            ? `Land area: selected active realestate.co.nz listing reports ${realestateListing.landArea}m² vs parcel/GIS record ${land_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the selected listing's subject land area for this report.`
            : `Land area: active realestate.co.nz listing reports ${realestateListing.landArea}m² vs LINZ cadastre ${land_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the active listing.`,
        );
        live_land_area_sqm = realestateListing.landArea;
        sources["land_area_sqm"] = selectedListingSubjectArea
          ? "realestate.co.nz (selected active listing)"
          : "realestate.co.nz (active listing)";
      } else if (delta > 0.1) {
        logger.warn(
          { cadastral: land_area_sqm, listing: realestateListing.landArea, delta, approximate: realestateListing.landAreaApprox },
          "Merge: ignored uncorroborated realestate.co.nz land-area outlier",
        );
      }
    }
  }
  let final_land_area_sqm = live_land_area_sqm ?? land_area_sqm;
  if (
    selectedRealestateListing &&
    realestateListing?.landArea == null &&
    final_land_area_sqm != null
  ) {
    discrepancies.push(
      `Land area: selected active realestate.co.nz listing does not publish a subject land area, so parcel/council backfill (${final_land_area_sqm}m²) was excluded to avoid showing stale parent-site land.`,
    );
    final_land_area_sqm = null;
    sources["land_area_sqm"] = "unavailable_selected_active_listing";
  }
  if (hasIgnoredCombinedListing && propertyValue && propertyValueMatchesSubject) {
    if (propertyValueLandArea != null && final_land_area_sqm !== propertyValueLandArea) {
      discrepancies.push(
        `Land area: active package listing/parcel context indicated ${final_land_area_sqm ?? "unknown"}m², but PropertyValue resolved the analysed child address at ${propertyValueLandArea}m². Using the child-property value.`,
      );
      final_land_area_sqm = propertyValueLandArea;
      sources["land_area_sqm"] = "propertyvalue (child address; combined listing excluded)";
    }
    if (propertyValueFloorArea != null && floor_area_sqm !== propertyValueFloorArea) {
      floor_area_sqm = propertyValueFloorArea;
      sources["floor_area_sqm"] = "propertyvalue (child address; combined listing excluded)";
    }
    if (propertyValue.bedrooms != null && bedrooms !== propertyValue.bedrooms) {
      bedrooms = propertyValue.bedrooms;
      sources["bedrooms"] = "propertyvalue (child address; combined listing excluded)";
    }
    if (propertyValue.bathrooms != null && bathrooms !== propertyValue.bathrooms) {
      bathrooms = propertyValue.bathrooms;
      sources["bathrooms"] = "propertyvalue (child address; combined listing excluded)";
    }
  }

  // Active listing facts have already won above. For off-market profiles use
  // a strict modal result across address-matched sources, making the answer
  // stable when one scraper is temporarily unavailable or parses a bad value.
  if (!hasActiveDwellingListing) {
    const bedroomConsensus = roomCountConsensus("Bedrooms", bedrooms, sources["bedrooms"], [
      { src: "homes", value: homesBeds },
      { src: "qv", value: qvBeds },
      { src: "oneroof", value: oneroofProfileBeds },
      { src: "propertyvalue", value: propertyValueBeds },
    ]);
    if (bedroomConsensus.note) discrepancies.push(bedroomConsensus.note);
    if (bedroomConsensus.source) sources["bedrooms"] = bedroomConsensus.source;
    bedrooms = bedroomConsensus.value;

    const bathroomConsensus = roomCountConsensus("Bathrooms", bathrooms, sources["bathrooms"], [
      { src: "homes", value: homesBaths },
      { src: "qv", value: qvBaths },
      { src: "oneroof", value: oneroofProfileBaths },
      { src: "propertyvalue", value: propertyValueBaths },
    ]);
    if (bathroomConsensus.note) discrepancies.push(bathroomConsensus.note);
    if (bathroomConsensus.source) sources["bathrooms"] = bathroomConsensus.source;
    bathrooms = bathroomConsensus.value;
  }

  // OneRoof property page often shows the year agents use in marketing; prefer it when it
  // resolves ambiguity (newer build, or exact year vs a rounded decade elsewhere). Not gated
  // on listing_active — the same HTML is used for sold/inactive property pages.
  if (oneroof?.build_year != null) {
    const orY = oneroof.build_year;
    if (build_year == null) {
      build_year = orY;
      sources["build_year"] = "oneroof";
    } else if (orY % 10 !== 0 && build_year % 10 === 0 && Math.abs(orY - build_year) <= 9) {
      logger.info({ consensusDecade: build_year, oneroofExact: orY }, "Merge: OneRoof exact build year over decade from other source(s)");
      discrepancies.push(
        `Build year: OneRoof reports ${orY} (exact year) vs rounded decade ${build_year} from other records. Using OneRoof.`,
      );
      build_year = orY;
      sources["build_year"] = "oneroof (exact vs decade)";
    } else if (oneroof.listing_active && orY > build_year + 3) {
      logger.info({ previous: build_year, oneroof: orY }, "Merge: OneRoof reports newer build year (replacement / record lag)");
      discrepancies.push(
        `Build year: OneRoof reports ${orY} vs other sources ${build_year}. Using OneRoof (likely newer dwelling or records not yet updated).`,
      );
      build_year = orY;
      sources["build_year"] = "oneroof (newer year)";
    }
  }

  const final_build_year = build_year;
  let final_build_year_range = build_year_range;
  const buildYearSource = sources["build_year"] ?? "";
  if (!final_build_year_range && buildYearSource.includes("propertyvalue") && propertyValue?.build_year_range) {
    final_build_year_range = propertyValue.build_year_range;
  } else if (!final_build_year_range && buildYearSource.includes("qv") && qv?.build_year_range) {
    final_build_year_range = qv.build_year_range;
  } else if (!final_build_year_range && buildYearSource.includes("homes") && homes?.build_year_range) {
    final_build_year_range = homes.build_year_range;
  }

  // Auckland Council GIS is the authoritative overlay source. Hougarden text can
  // mention nearby/generic overlay names and has caused false report risks such
  // as volcanic viewshafts on sites where the AUP maps show none.
  const overlays: Overlay[] = councilOverlays;
  sources["overlays"] = "auckland_council_gis";

  let zone_code: string | null = null;
  let zone_description: string | null = null;
  let min_lot_size_sqm: number | null = null;
  const inferredLifestyleZone = inferLifestyleZone(propertyValue, final_land_area_sqm);
  if (hougarden?.zone_code) {
    zone_code = hougarden.zone_code;
    zone_description = hougarden.zone_description;
    sources["zone"] = "hougarden";
  } else if (councilZone?.zone_code && councilZone.zone_code !== "UNKNOWN") {
    zone_code = councilZone.zone_code;
    zone_description = councilZone.zone_description;
    min_lot_size_sqm = councilZone.min_lot_size_sqm;
    sources["zone"] = "auckland_council_gis";
  } else if (inferredLifestyleZone) {
    zone_code = inferredLifestyleZone.code;
    zone_description = inferredLifestyleZone.description;
    min_lot_size_sqm = inferredLifestyleZone.minLotSizeSqm;
    sources["zone"] = "propertyvalue (lifestyle land inferred)";
  }

  if (!min_lot_size_sqm && zone_code) {
    const LOT_SIZES: Record<string, number> = {
      THAB: 0, MHU: 300, MHS: 400, SHZ: 600, LLRZ: 4000, RCSZ: 2000, LDRZ: 600, FUZ: 0,
      CLZ: 10000, RUR: 40000, LSZ: 1200,
      BPZ: 0, CCZ: 0, GBZ: 0, BPIZ: 0, LCZ: 0, MCZ: 0, MUZ: 0, NCZ: 0, TCZ: 0,
    };
    min_lot_size_sqm = LOT_SIZES[zone_code] ?? null;
  }

  const last_sale_price = first("last_sale_price", sources, ["oneroof", oneroof?.last_sale_price]);
  const last_sale_date  = first("last_sale_date",  sources, ["oneroof", oneroof?.last_sale_date]);
  // Listing price: when OneRoof confirms the property is currently on market,
  // its asking price is the freshest figure; prefer it unconditionally.
  const listing_price = oneroof?.listing_active && oneroof.listing_price != null
    ? (sources["listing_price"] = "oneroof (live listing)", oneroof.listing_price)
    : realestateListing?.price != null
      ? (sources["listing_price"] = "realestate.co.nz (active listing)", realestateListing.price)
      : null;

  const school_zones          = hougarden?.school_zones ?? { primary: null, intermediate: null, secondary: null };
  // Listing hero photos only. Do not carry generic property-record galleries
  // into feasibility reports; if no listing photos exist, mobile falls back to
  // Google Street View / satellite.
  const photo_urls = Array.from(new Set([
    ...(oneroof?.listing_active ? (oneroof.photo_urls ?? []) : []),
    ...(oneroof?.listing_active && oneroof.main_photo_url ? [oneroof.main_photo_url] : []),
    ...(realestateListing?.photoUrls ?? []),
    ...(realestateListing?.photoUrl ? [realestateListing.photoUrl] : []),
    ...(extra?.realestate_photo_urls ?? []),
  ].filter(Boolean)));
  const main_photo_url        = photo_urls[0] ?? null;
  const overlay_map_image_base64 = hougarden?.overlay_map_image_base64 ?? null;

  const comparables: ComparableSale[] = oneroof?.comparables ?? [];
  sources["comparables"] = comparables.length >= 3 ? "oneroof" : "oneroof (limited)";

  const missing_critical_fields: string[] = [];
  if (cv_nzd === null)                                                          missing_critical_fields.push("cv_nzd");
  if (final_land_area_sqm === null)                                             missing_critical_fields.push("land_area_sqm");
  if (extra?.contour === null || extra?.contour === undefined)                  missing_critical_fields.push("contour");

  logger.info({ sources, missing_critical_fields, cv_nzd, cv_year, land_area_sqm: final_land_area_sqm, build_year: final_build_year, floor_area_sqm, discrepancies }, "Merge: data sources selected");

  return {
    cv_nzd,
    cv_year,
    land_area_sqm: final_land_area_sqm,
    floor_area_sqm,
    build_year: final_build_year,
    build_year_range: final_build_year_range,
    bedrooms,
    bathrooms,
    zone_code,
    zone_description,
    min_lot_size_sqm,
    overlays,
    school_zones,
    last_sale_price,
    last_sale_date,
    listing_active: (oneroof?.listing_active ?? false) || (!!realestateListing && !isInactiveRealestateListing(realestateListing)),
    listing_price,
    main_photo_url,
    photo_urls,
    overlay_map_image_base64,
    comparables,
    data_sources: sources,
    discrepancies,
    contour: extra?.contour ?? null,
    contour_slope_degrees: extra?.contour_slope_degrees ?? null,
    contour_source: extra?.contour_source ?? null,
    contour_text: extra?.contour_text ?? null,
    contour_steep_area_ratio: extra?.contour_steep_area_ratio ?? null,
    contour_moderate_area_ratio: extra?.contour_moderate_area_ratio ?? null,
    contour_local_slope_p90_degrees: extra?.contour_local_slope_p90_degrees ?? null,
    contour_local_slope_p95_degrees: extra?.contour_local_slope_p95_degrees ?? null,
    contour_sample_count: extra?.contour_sample_count ?? null,
    large_site_terrain_adjusted: extra?.large_site_terrain_adjusted ?? false,
    retaining_area_sqm_estimate: extra?.retaining_area_sqm_estimate ?? null,
    asbestos_risk: extra?.asbestos_risk ?? "unknown",
    infrastructure: extra?.infrastructure ?? [],
    missing_critical_fields,
    estate_type: null,
    titleResolutionSource: "unknown",
    lrsStatus: null,
    property_type,
    listing_title,
    listing_url,
    typology: "unknown",
    typologyConfidence: "unknown",
    titleConfidence: "unknown",
    subdivisionEligible: null,
    subdivisionRejectReason: null,
  };
}
