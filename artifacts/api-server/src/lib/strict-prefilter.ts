import type { ListingResult } from "./scrapers/oneroof";
import { isLetterSuffixedStreetNumber } from "./discovery-land-area";
import { assessPropertyEligibility } from "./property-eligibility";
import { extractListingClaims } from "./listing-claims";
import { looksLikeUnitOrApartmentAddress } from "./address-patterns";

export type PrefilterVerdict =
  | { kind: "reject"; reason: string }
  | { kind: "pass" };

/**
 * Smallest two-lot combined land area we'd ever consider feasible under the
 * Auckland Unitary Plan. MHS allows ~300 m² minimums in some controls but the
 * dominant residential controls (MHS / MHU / THAB) all need >500 m² to fit two
 * lots once net area, access, and yard rules are honoured. A verified land
 * area below this threshold is impossible regardless of zone — safe to reject
 * without any backend fetch.
 */
const STRICT_TWO_LOT_MIN_SQM = 500;

const UNIT_PROPERTY_TYPE_RE = /\b(unit|apartment|flat|townhouse|terrace|terraced|duplex)\b/i;
const SECTION_PROPERTY_TYPE_RE = /\b(section|lifestyle|farm|bare\s*land|vacant\s*land)\b/i;
const NON_FREEHOLD_TENURE_RE = /(cross\s*lease|unit\s*title|leasehold|stratum\s*estate|company\s*share|licence\s*to\s*occupy|licence-to-occupy)/i;

/**
 * Free, synchronous gate that rejects a for-sale listing when its own
 * attributes alone prove it cannot satisfy the strict-subdivision criteria.
 *
 * Returns `pass` for anything ambiguous — the caller then runs the full
 * `screenOneFast` pipeline (LINZ + Auckland Council + propertyValue) to make
 * the final call. Returns `reject` only when no downstream fetch could
 * possibly change the verdict.
 *
 * Used as the first step of strict-subdivision discovery to eliminate ~40-60%
 * of a suburb queue with zero REST calls.
 */
export function strictAttributePrefilter(listing: ListingResult): PrefilterVerdict {
  if (looksLikeUnitOrApartmentAddress(listing.address)) {
    return { kind: "reject", reason: "apartment_or_unit_address_format" };
  }
  if (isLetterSuffixedStreetNumber(listing.address)) {
    return { kind: "reject", reason: "already_subdivided_child_letter_suffix" };
  }

  if (typeof listing.propertyType === "string" && listing.propertyType.trim()) {
    if (UNIT_PROPERTY_TYPE_RE.test(listing.propertyType)) {
      return { kind: "reject", reason: `property_type:${listing.propertyType.trim()}` };
    }
    if (SECTION_PROPERTY_TYPE_RE.test(listing.propertyType)) {
      return { kind: "reject", reason: `property_type:${listing.propertyType.trim()}` };
    }
  }

  if (typeof listing.tenureText === "string" && NON_FREEHOLD_TENURE_RE.test(listing.tenureText)) {
    return { kind: "reject", reason: `tenure:${listing.tenureText.trim()}` };
  }

  // Structured claims from the listing's own marketing copy. A dwelling
  // marketed as a brand-new build, a townhouse, or one unit of a multi-unit
  // development can never be a standard knock-down subdivision candidate —
  // no downstream LINZ/council fetch can change that, and those (lagging)
  // sources are exactly what let redeveloped parcels slip through before.
  const claims = extractListingClaims(listing);
  const claimEvidence = claims.evidence[0] ?? "";
  if (claims.isNewBuild || (claims.completionYear ?? 0) >= 2000) {
    return { kind: "reject", reason: `listing_claims_new_build:${claimEvidence}` };
  }
  if (claims.multiUnitDevelopment) {
    return { kind: "reject", reason: `listing_claims_multi_unit:${claimEvidence}` };
  }
  if (claims.dwellingIsTownhouse) {
    return { kind: "reject", reason: `listing_claims_dwelling_is_townhouse:${claimEvidence}` };
  }

  if (
    listing.landArea != null
    && listing.landAreaConfidence === "verified"
    && listing.landArea < STRICT_TWO_LOT_MIN_SQM
  ) {
    return {
      kind: "reject",
      reason: `verified_land_area_below_two_lot_minimum:${listing.landArea}m²<${STRICT_TWO_LOT_MIN_SQM}m²`,
    };
  }

  // Ask the existing eligibility engine — it can spot unit/cross-lease signals
  // hiding in legalDescription / listingCategory even when propertyType is
  // generic "House". We only act on the strongest, most specific verdicts —
  // verified unit/terrace typology or a verified cross-lease signal. Anything
  // weaker (e.g. subdivisionEligible=false derived from missing build year /
  // missing zone) lets the real pipeline run, because those missing fields
  // will be filled in by LINZ + AC GIS during screenOneFast.
  const eligibility = assessPropertyEligibility({
    address: listing.address,
    legalDescription: listing.legalDescription,
    listingPropertyType: listing.propertyType,
    listingCategory: listing.listingCategory,
    listingTenureText: listing.tenureText,
    listingLegalDescription: listing.legalDescription,
    landAreaSqm: listing.landArea ?? null,
    isCombinedListingAggregate: listing.isCombinedListing,
    listingClaims: claims,
  });
  if (
    (eligibility.typology === "unit_apartment" || eligibility.typology === "terrace_townhouse")
    && eligibility.typologyConfidence === "verified"
  ) {
    return { kind: "reject", reason: `verified_typology:${eligibility.typology}` };
  }
  if (eligibility.crossLeaseSignal && eligibility.titleConfidence === "verified") {
    return { kind: "reject", reason: "verified_cross_lease" };
  }

  return { kind: "pass" };
}
