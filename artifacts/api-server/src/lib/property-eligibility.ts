import type { LinzParcel } from "./linz";

export type PropertyTypology = "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
export type PropertyEligibilityConfidence = "verified" | "inferred" | "unknown";

export interface PropertyEligibilityInput {
  address: string;
  estateType?: string | null;
  legalDescription?: string | null;
  propertyType?: string | null;
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
  return /\b(unit\s+title|stratum|body\s+corporate|body\s+corp|accessory\s+unit|apartment|flat)\b/i.test(text)
    || /\bunit\s+[a-z]\b/i.test(text)
    || /\bunit\b/i.test(text);
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
  const { titleConfidence, titleIsFreehold } = inferTitleConfidence(text);
  const { typology, typologyConfidence } = inferTypology(input, text);
  const buildYearEligible = input.buildYear != null && input.buildYear < 2000;
  const landAreaParentOrTypologySuspect = hasSuspiciousUrbanLandFloorRatio(input);

  let subdivisionRejectReason: string | null = null;
  if (unitLikeSignal || crossLeaseSignal) subdivisionRejectReason = "unit_or_crosslease_signal";
  else if (!titleIsFreehold || titleConfidence !== "verified") subdivisionRejectReason = "title_not_confirmed_freehold";
  else if (typology !== "standalone") subdivisionRejectReason = "typology_not_confirmed_standalone";
  else if (landAreaParentOrTypologySuspect) subdivisionRejectReason = "land_area_parent_or_typology_suspect";
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
    || result.subdivisionRejectReason === "land_area_parent_or_typology_suspect";
}

export function eligibilityPlanningNote(result: PropertyEligibilityResult): string | null {
  if (!shouldForceSingleLotForEligibility(result)) return null;
  if (result.subdivisionRejectReason === "unit_or_crosslease_signal") {
    return "Unit title, cross-lease, stratum, or unit-like signals were detected, so this report does not treat the property as a standard standalone freehold subdivision site. Confirm the exact title and legal description before relying on any subdivision yield.";
  }
  if (result.subdivisionRejectReason === "land_area_parent_or_typology_suspect") {
    return "The reported land/floor relationship or title signals suggest the land area may be a parent or aggregate parcel, so standard subdivision yield has been capped until exact standalone freehold title area is confirmed.";
  }
  return "Standalone freehold title and typology were not confirmed, so this report caps standard subdivision yield until title, legal description, and property type are verified.";
}
