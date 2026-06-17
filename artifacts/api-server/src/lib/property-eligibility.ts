import type { LinzParcel } from "./linz";
import type { ListingClaims } from "./listing-claims";

export type PropertyTypology = "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
export type PropertyEligibilityConfidence = "verified" | "inferred" | "unknown";

export interface PropertyEligibilityInput {
  address: string;
  estateType?: string | null;
  /**
   * Estate/tenure resolved authoritatively from a LINZ title lookup (e.g.
   * "Fee Simple", "Cross Lease", "Unit Title", "Stratum", "Leasehold"). When
   * present this overrides text inference and sets titleConfidence to "verified".
   * Leave null/undefined when LINZ could not confirm the title (new builds with
   * no title yet, address mismatch, service unavailable) — the assessment then
   * falls back to inferring tenure from listing/council copy as before.
   */
  verifiedEstateType?: string | null;
  legalDescription?: string | null;
  propertyType?: string | null;
  propertySubType?: string | null;
  propertyValueLegalDescriptions?: string[] | null;
  landUsePrimary?: string | null;
  propertyImprovements?: string | null;
  listingPropertyType?: string | null;
  listingCategory?: string | null;
  listingTenureText?: string | null;
  listingLegalDescription?: string | null;
  linzParcel?: Pick<LinzParcel, "appellation" | "legal_description" | "topology_type" | "title_no" | "area_sqm"> | null;
  landAreaSqm?: number | null;
  floorAreaSqm?: number | null;
  buildYear?: number | null;
  buildYearRange?: string | null;
  zoneCode?: string | null;
  potentialLots?: number | null;
  minLotSize?: number | null;
  isCombinedListingAggregate?: boolean | null;
  /**
   * Discovery opt-in: the user has explicitly asked to include this non-freehold
   * tenure despite the subdivision catch (shown with a warning chip). When set,
   * the assessment screens the parcel on land/zone potential only — the
   * tenure/typology-driven rejections (cross-lease/unit signal, title-not-
   * freehold, non-standalone typology, parent-land suspicion) are waived so a
   * big-enough, correctly-zoned cross-lease/leasehold/unit-title site passes;
   * the structural gates (new-build, build-year, zone/min-lot, two-lot land
   * requirement) still apply. Null/undefined = normal strict screening.
   */
  waiveTenureForSubdivision?: "cross_lease" | "leasehold" | "unit_title" | null;
  /**
   * Structured claims extracted from the listing's own marketing copy
   * (see listing-claims.ts). Deliberately NOT folded into corpus() — raw
   * marketing text is full of "potential to build townhouses STCA" copy that
   * would falsely flag genuine do-up sites.
   */
  listingClaims?: ListingClaims | null;
}

export interface PropertyEligibilityResult {
  typology: PropertyTypology;
  typologyConfidence: PropertyEligibilityConfidence;
  titleConfidence: PropertyEligibilityConfidence;
  subdivisionEligible: boolean;
  subdivisionRejectReason: string | null;
  unitLikeSignal: boolean;
  crossLeaseSignal: boolean;
  titleIsFreehold: boolean;
  buildYearEligible: boolean;
  landAreaParentOrTypologySuspect: boolean;
}

export interface SubjectLandAreaInput {
  eligibility: PropertyEligibilityResult;
  currentLandAreaSqm: number | null | undefined;
  currentLandAreaSource?: string | null;
  propertyValueLandAreaSqm?: number | null;
  listingLandAreaSqm?: number | null;
  listingLandAreaSource?: string | null;
  listingLandAreaConfidence?: "verified" | "unverified" | null;
  listingLandAreaApprox?: boolean | null;
}

export interface SubjectLandAreaResult {
  landAreaSqm: number | null;
  source: string;
  suppressedParentLandArea: boolean;
  note: string | null;
}

const RESIDENTIAL_URBAN_ZONES = new Set(["MHS", "MHU", "MHU-H", "MHU-S", "THAB", "SHZ", "LDRZ", "LSZ"]);
const RURAL_ZONES = new Set(["CLZ", "LLRZ", "RCSZ", "RUR"]);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function corpus(input: PropertyEligibilityInput): string {
  return [
    input.address,
    input.estateType,
    input.legalDescription,
    input.propertyType,
    input.propertySubType,
    ...(input.propertyValueLegalDescriptions ?? []),
    input.landUsePrimary,
    input.propertyImprovements,
    input.listingPropertyType,
    input.listingCategory,
    input.listingTenureText,
    input.listingLegalDescription,
    input.linzParcel?.appellation,
    input.linzParcel?.legal_description,
    input.linzParcel?.topology_type,
    input.linzParcel?.title_no,
  ].map(cleanText).filter(Boolean).join(" ").toLowerCase();
}

function hasLotDpSignal(text: string): boolean {
  return /\blot\s+\d+[a-z]?\b[\s\S]{0,80}\b(?:dp|deposited\s+plan)\s*\d+\b/i.test(text)
    || /\b(?:dp|deposited\s+plan)\s*\d+\b[\s\S]{0,80}\blot\s+\d+[a-z]?\b/i.test(text);
}

function hasUnitLikeSignal(text: string): boolean {
  const normalized = text.replace(/\bsingle\s+unit\s+excluding\s+bach\b/gi, "single dwelling excluding bach");
  return /\b(unit\s+title|stratum|body\s+corporate|body\s+corp|ownership\s+home\s+units?|home\s+unit|principal\s+unit|accessory\s+unit|apartment|flat)\b/i.test(normalized)
    || /\bunit\s+[a-z0-9]\b/i.test(normalized);
}

function hasCrossLeaseSignal(text: string): boolean {
  return /\b(cross\s*lease|crosslease|leasehold)\b/i.test(text);
}

function hasTownhouseSignal(text: string): boolean {
  return /\b(townhouse|terrace|terraced|row\s+house|duplex|attached)\b/i.test(text);
}

function hasStandaloneSignal(input: PropertyEligibilityInput, text: string): boolean {
  const propertyTypeText = [
    input.propertyType,
    input.propertySubType,
    input.listingPropertyType,
    input.listingCategory,
  ].map(cleanText).join(" ").toLowerCase();
  if (/\b(house|dwelling|residential\s+dwelling|single\s+family|standalone|villa|bungalow)\b/i.test(propertyTypeText)) {
    return true;
  }
  return /\b(freehold|fee\s+simple)\b/i.test(text) && hasLotDpSignal(text);
}

function isUrbanResidential(zoneCode: string | null | undefined): boolean {
  const z = zoneCode?.toUpperCase().trim();
  return !!z && RESIDENTIAL_URBAN_ZONES.has(z);
}

function isRural(zoneCode: string | null | undefined): boolean {
  const z = zoneCode?.toUpperCase().trim();
  return !!z && RURAL_ZONES.has(z);
}

/**
 * Title tenure from an authoritative LINZ estate type. Returns null when the
 * estate is absent/unrecognised so the caller falls back to text inference.
 */
function titleFromVerifiedEstate(estateType: string | null | undefined): {
  titleConfidence: PropertyEligibilityConfidence;
  titleIsFreehold: boolean;
} | null {
  const raw = (estateType ?? "").trim();
  if (!raw) return null;
  if (/\b(fee\s*simple|freehold)\b/i.test(raw)) {
    return { titleConfidence: "verified", titleIsFreehold: true };
  }
  if (/\b(cross[-\s]*lease|crosslease|unit\s*title|stratum|leasehold)\b/i.test(raw)) {
    return { titleConfidence: "verified", titleIsFreehold: false };
  }
  return null;
}

function inferTitleConfidence(text: string): {
  titleConfidence: PropertyEligibilityConfidence;
  titleIsFreehold: boolean;
} {
  if (hasUnitLikeSignal(text) || hasCrossLeaseSignal(text)) {
    return { titleConfidence: "verified", titleIsFreehold: false };
  }
  if (/\b(fee\s+simple|freehold)\b/i.test(text)) {
    return { titleConfidence: "verified", titleIsFreehold: true };
  }
  if (hasLotDpSignal(text)) {
    return { titleConfidence: "verified", titleIsFreehold: true };
  }
  return { titleConfidence: "unknown", titleIsFreehold: false };
}

function inferTypology(input: PropertyEligibilityInput, text: string): {
  typology: PropertyTypology;
  typologyConfidence: PropertyEligibilityConfidence;
} {
  if (hasUnitLikeSignal(text) || hasCrossLeaseSignal(text)) {
    return { typology: "unit_apartment", typologyConfidence: "verified" };
  }
  // The listing's own self-description of the dwelling ("brand new townhouses",
  // propertyType: Townhouse) is as authoritative as a labelled property type —
  // the IS-vs-COULD-BUILD disambiguation already happened in listing-claims.ts.
  if (input.listingClaims?.dwellingIsTownhouse) {
    return { typology: "terrace_townhouse", typologyConfidence: "verified" };
  }
  if (hasTownhouseSignal(text)) {
    return { typology: "terrace_townhouse", typologyConfidence: "inferred" };
  }
  if (hasStandaloneSignal(input, text)) {
    return { typology: "standalone", typologyConfidence: /\b(house|dwelling|standalone)\b/i.test(text) ? "inferred" : "verified" };
  }
  return { typology: "unknown", typologyConfidence: "unknown" };
}

function hasSuspiciousUrbanLandFloorRatio(input: PropertyEligibilityInput): boolean {
  const land = input.landAreaSqm ?? null;
  const floor = input.floorAreaSqm ?? null;
  if (!land || !floor || floor <= 0 || land <= 0) return false;
  if (!isUrbanResidential(input.zoneCode) || isRural(input.zoneCode)) return false;
  if (land < 700) return false;
  const ratio = floor / land;
  const text = corpus(input);
  if (ratio >= 0.18) return false;
  return hasUnitLikeSignal(text) || hasCrossLeaseSignal(text) || !hasStandaloneSignal(input, text);
}

export function assessPropertyEligibility(input: PropertyEligibilityInput): PropertyEligibilityResult {
  const text = corpus(input);
  const unitLikeSignal = hasUnitLikeSignal(text);
  const crossLeaseSignal = hasCrossLeaseSignal(text);
  // A LINZ-verified estate type wins over text inference; fall back to copy.
  const { titleConfidence, titleIsFreehold } =
    titleFromVerifiedEstate(input.verifiedEstateType) ?? inferTitleConfidence(text);
  const { typology, typologyConfidence } = inferTypology(input, text);
  const buildYearEligible = input.buildYear != null && input.buildYear < 2000;
  const landAreaParentOrTypologySuspect = hasSuspiciousUrbanLandFloorRatio(input);

  const claims = input.listingClaims ?? null;
  const claimsNewBuild = !!claims && (claims.isNewBuild || (claims.completionYear ?? 0) >= 2000);

  // Opt-in: the user accepted this non-freehold tenure, so screen on land/zone
  // potential only — the tenure- and typology-driven gates below are waived
  // (the title is surfaced to the user via a warning chip instead of dropping
  // the listing). Structural gates still apply.
  const tenureWaived = input.waiveTenureForSubdivision != null;

  let subdivisionRejectReason: string | null = null;
  if (!tenureWaived && (unitLikeSignal || crossLeaseSignal)) subdivisionRejectReason = "unit_or_crosslease_signal";
  // A dwelling marketed as a new build can never satisfy the pre-2000 build
  // doctrine, regardless of what (lagging) council records say.
  else if (claimsNewBuild) subdivisionRejectReason = "listing_claims_new_build";
  else if (claims?.multiUnitDevelopment) subdivisionRejectReason = "listing_claims_multi_unit_development";
  else if (!tenureWaived && (!titleIsFreehold || titleConfidence !== "verified")) subdivisionRejectReason = "title_not_confirmed_freehold";
  else if (!tenureWaived && typology !== "standalone") subdivisionRejectReason = "typology_not_confirmed_standalone";
  else if (!tenureWaived && landAreaParentOrTypologySuspect) subdivisionRejectReason = "land_area_parent_or_typology_suspect";
  else if (input.isCombinedListingAggregate) subdivisionRejectReason = "combined_listing_aggregate";
  else if (input.buildYear == null) subdivisionRejectReason = "build_year_unknown";
  else if (!buildYearEligible) subdivisionRejectReason = "post_2000_build";
  else if (!input.zoneCode || !input.minLotSize || input.minLotSize <= 0) subdivisionRejectReason = "zone_or_min_lot_unknown";
  else if ((input.potentialLots ?? 0) < 2) subdivisionRejectReason = "insufficient_land_for_two_lots";

  return {
    typology,
    typologyConfidence,
    titleConfidence,
    subdivisionEligible: subdivisionRejectReason == null,
    subdivisionRejectReason,
    unitLikeSignal,
    crossLeaseSignal,
    titleIsFreehold,
    buildYearEligible,
    landAreaParentOrTypologySuspect,
  };
}

export function shouldForceSingleLotForEligibility(result: PropertyEligibilityResult): boolean {
  return result.subdivisionRejectReason === "unit_or_crosslease_signal"
    || result.subdivisionRejectReason === "title_not_confirmed_freehold"
    || result.subdivisionRejectReason === "typology_not_confirmed_standalone"
    || result.subdivisionRejectReason === "land_area_parent_or_typology_suspect"
    || result.subdivisionRejectReason === "listing_claims_new_build"
    || result.subdivisionRejectReason === "listing_claims_multi_unit_development";
}

export function shouldSuppressParentLandAreaForEligibility(result: PropertyEligibilityResult): boolean {
  return result.subdivisionRejectReason === "unit_or_crosslease_signal"
    || result.subdivisionRejectReason === "land_area_parent_or_typology_suspect"
    || result.unitLikeSignal
    || result.crossLeaseSignal
    || result.landAreaParentOrTypologySuspect;
}

function trustedVerifiedListingArea(input: SubjectLandAreaInput): number | null {
  const area = input.listingLandAreaSqm ?? null;
  if (area == null || area <= 0) return null;
  if (input.listingLandAreaConfidence !== "verified") return null;
  if (input.listingLandAreaApprox === true) return null;
  const source = (input.listingLandAreaSource ?? "").toLowerCase();
  if (source === "linz" || source.includes("council") || source.includes("gis")) return null;
  return area;
}

export function resolveSubjectLandAreaForEligibility(input: SubjectLandAreaInput): SubjectLandAreaResult {
  const current = input.currentLandAreaSqm ?? null;
  if (!shouldSuppressParentLandAreaForEligibility(input.eligibility)) {
    return {
      landAreaSqm: current,
      source: input.currentLandAreaSource ?? (current != null ? "unknown" : "unavailable"),
      suppressedParentLandArea: false,
      note: null,
    };
  }

  const propertyValueArea = input.propertyValueLandAreaSqm ?? null;
  if (propertyValueArea != null && propertyValueArea > 0) {
    return {
      landAreaSqm: propertyValueArea,
      source: "propertyvalue",
      suppressedParentLandArea: current != null && current !== propertyValueArea,
      note: current != null && current !== propertyValueArea
        ? `PropertyValue/title signals indicate this is not a standalone freehold site, so parent parcel land area was replaced with the subject land area from PropertyValue (${propertyValueArea}m²).`
        : null,
    };
  }

  const listingArea = trustedVerifiedListingArea(input);
  if (listingArea != null) {
    return {
      landAreaSqm: listingArea,
      source: "realestate.co.nz (verified subject listing)",
      suppressedParentLandArea: current != null && current !== listingArea,
      note: current != null && current !== listingArea
        ? `Listing/title signals indicate this is not a standalone freehold site, so parent parcel land area was replaced with the verified subject listing land area (${listingArea}m²).`
        : null,
    };
  }

  return {
    landAreaSqm: null,
    source: "unavailable_unit_or_non_standalone",
    suppressedParentLandArea: current != null,
    note: current != null
      ? "PropertyValue/title signals indicate this is a unit or non-standalone title, so parent parcel land area was excluded from the subject-property report."
      : null,
  };
}

export function eligibilityPlanningNote(result: PropertyEligibilityResult): string | null {
  if (!shouldForceSingleLotForEligibility(result)) return null;
  if (result.subdivisionRejectReason === "unit_or_crosslease_signal") {
    return "Unit title, cross-lease, stratum, or unit-like signals were detected, so this report does not treat the property as a standard standalone freehold subdivision site. Confirm the exact title and legal description before relying on any subdivision yield.";
  }
  if (result.subdivisionRejectReason === "land_area_parent_or_typology_suspect") {
    return "The reported land/floor relationship or title signals suggest the land area may be a parent or aggregate parcel, so standard subdivision yield has been capped until exact standalone freehold title area is confirmed.";
  }
  if (result.subdivisionRejectReason === "listing_claims_new_build") {
    return "The listing markets this dwelling as a new or near-new build, so it cannot satisfy the pre-2000 build criterion for a standard knock-down subdivision. Any recorded land area or build year may describe the pre-development parent site.";
  }
  if (result.subdivisionRejectReason === "listing_claims_multi_unit_development") {
    return "The listing indicates this property is part of a multi-unit development, so the parcel has likely already been developed. Recorded land area and valuation data may describe the pre-development parent site.";
  }
  return "Standalone freehold title and typology were not confirmed, so this report caps standard subdivision yield until title, legal description, and property type are verified.";
}
