import type { LinzParcel } from "./linz";
import { calculatePotentialLots } from "./lot-calculator";
import { parseStreetNumberSuffix } from "./subdivision";
import { scrapeHomes } from "./scrapers/homes";

export type DiscoveryLandAreaSource = "realestate_api" | "realestate_page" | "homes" | "linz" | "propertyvalue" | "unknown";
export type DiscoveryLandAreaConfidence = "verified" | "unverified";

export interface DiscoveryLandAreaVerification {
  landArea: number | null;
  landAreaSource: DiscoveryLandAreaSource;
  landAreaConfidence: DiscoveryLandAreaConfidence;
  isParentParcelSuspect: boolean;
  isAlreadySubdividedChild: boolean;
}

export function isLetterSuffixedStreetNumber(address: string): boolean {
  const parsed = parseStreetNumberSuffix(address);
  return !!parsed?.letter;
}

function differsMaterially(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  const diff = Math.abs(a - b);
  const pct = diff / Math.max(a, b);
  return diff > 10 && pct > 0.05;
}

function suburbFromFormattedAddress(formattedAddress: string, fallbackAddress: string): string {
  const formattedSuburb = formattedAddress.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim();
  if (formattedSuburb) return formattedSuburb;
  return fallbackAddress.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim() || "";
}

export async function verifyDiscoveryLandArea(input: {
  address: string;
  listingLandArea: number | null | undefined;
  listingLandAreaSource?: DiscoveryLandAreaSource | null;
  listingLandAreaConfidence?: DiscoveryLandAreaConfidence | null;
  linzParcel?: LinzParcel | null;
  formattedAddress?: string | null;
  strictStandardSubdivision?: boolean;
  /**
   * When true, skip the homes.co.nz ScrapingBee fallback even if listing land
   * area is still unverified. The strict-subdivision discovery loop uses this
   * to avoid burning paid quota across an entire suburb queue — listings the
   * free sources can't verify become "indeterminate" and are re-screened by
   * the outer retry pass instead of falling through to ScrapingBee.
   */
  disablePaidScrapers?: boolean;
}): Promise<DiscoveryLandAreaVerification> {
  const isAlreadySubdividedChild = isLetterSuffixedStreetNumber(input.address);
  const listingArea = input.listingLandArea ?? null;
  const listingConfidence = input.listingLandAreaConfidence ?? "unverified";
  const listingSource = input.listingLandAreaSource ?? (listingArea != null ? "realestate_api" : "unknown");
  const linzArea = input.linzParcel?.area_sqm ?? null;

  let landArea = listingArea;
  let landAreaSource = listingSource;
  let landAreaConfidence = listingConfidence;

  if (landAreaConfidence !== "verified" && !isAlreadySubdividedChild && linzArea != null) {
    landArea = linzArea;
    landAreaSource = "linz";
    landAreaConfidence = "verified";
  }

  if (input.strictStandardSubdivision && landAreaConfidence !== "verified" && !input.disablePaidScrapers) {
    const formattedAddress = input.formattedAddress ?? input.address;
    const suburb = suburbFromFormattedAddress(formattedAddress, input.address);
    const homes = suburb
      ? await scrapeHomes(input.address, suburb, formattedAddress).catch(() => null)
      : null;
    if (homes?.land_area_sqm != null) {
      landArea = homes.land_area_sqm;
      landAreaSource = "homes";
      landAreaConfidence = "verified";
    }
  }

  const isParentParcelSuspect =
    isAlreadySubdividedChild ||
    differsMaterially(listingArea, landArea) ||
    differsMaterially(linzArea, landArea);

  return {
    landArea,
    landAreaSource,
    landAreaConfidence,
    isParentParcelSuspect,
    isAlreadySubdividedChild,
  };
}

export function passesStrictStandardSubdivisionScreen(input: {
  address: string;
  landArea?: number | null;
  zone?: string | null;
  potentialLots?: number | null;
  minLotSize?: number | null;
  landAreaConfidence?: DiscoveryLandAreaConfidence | null;
  isAlreadySubdividedChild?: boolean | null;
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown" | null;
  titleConfidence?: "verified" | "inferred" | "unknown" | null;
  subdivisionEligible?: boolean | null;
  buildYear?: number | null;
}): boolean {
  if (input.isAlreadySubdividedChild) return false;
  if (input.subdivisionEligible === false) return false;
  if (input.typology !== "standalone") return false;
  if (input.titleConfidence !== "verified") return false;
  if (input.buildYear == null || input.buildYear >= 2000) return false;
  if (input.landAreaConfidence !== "verified") return false;
  if (!input.landArea || input.landArea <= 0) return false;
  if (!input.zone) return false;
  const lotResult = calculatePotentialLots(input.landArea, input.zone);
  if (lotResult.min_lot_size <= 0) return false;
  if (input.landArea < lotResult.min_lot_size * 2) return false;
  return (input.potentialLots ?? lotResult.lots) >= 2 && lotResult.lots >= 2;
}

export function passesPreliminaryStandardSubdivisionScreen(input: {
  address: string;
  landArea?: number | null;
  zone?: string | null;
  potentialLots?: number | null;
  minLotSize?: number | null;
  landAreaConfidence?: DiscoveryLandAreaConfidence | null;
  isAlreadySubdividedChild?: boolean | null;
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown" | null;
  titleConfidence?: "verified" | "inferred" | "unknown" | null;
  subdivisionRejectReason?: string | null;
  buildYear?: number | null;
}): boolean {
  if (input.isAlreadySubdividedChild) return false;
  if (input.typology === "unit_apartment" || input.typology === "terrace_townhouse") return false;
  if (input.landAreaConfidence !== "verified") return false;
  if (!input.landArea || input.landArea <= 0) return false;
  if (!input.zone) return false;
  if (
    input.subdivisionRejectReason &&
    ![
      "build_year_unknown",
      "post_2000_build",
      "title_not_confirmed_freehold",
      "typology_not_confirmed_standalone",
    ].includes(input.subdivisionRejectReason)
  ) return false;

  const lotResult = calculatePotentialLots(input.landArea, input.zone);
  if (lotResult.min_lot_size <= 0) return false;
  if (input.landArea < lotResult.min_lot_size * 2) return false;
  return (input.potentialLots ?? lotResult.lots) >= 2 && lotResult.lots >= 2;
}
