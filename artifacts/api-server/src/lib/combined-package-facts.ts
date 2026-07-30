import type { ListingResult } from "./scrapers/oneroof";

export type CombinedPackageFacts = {
  listingPriceNzd: number | null;
  listingPriceApprox: boolean;
  advertisedLandAreaSqm: number | null;
  advertisedLandAreaApprox: boolean;
  listingUrl: string | null;
  source: "realestate.co.nz";
};

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Package listings frequently omit structured land area even though the agent
 * states it in the marketing copy. Only accept area wording that explicitly
 * says the figure is combined/total, so a proposed dwelling floor area or one
 * child's advertised site area cannot be mistaken for the package landholding.
 */
export function extractAdvertisedCombinedLandArea(
  description: string | null | undefined,
): { areaSqm: number; approximate: boolean } | null {
  const text = (description ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const patterns = [
    /\bcombined\s+(?:landholding|land\s+(?:area|size)|site\s+area|total)\s*(?:of|:|-)?\s*(approximately|approx(?:imately)?\.?|about|circa)?\s*([\d,.]+)\s*(?:m(?:2|\u00b2)|sqm|square\s+metres?)(?=$|[^a-z0-9])/i,
    /\b(?:land\s+(?:area|size)\s*:\s*)?combined\s+total\s*(?:of|:|-)?\s*(approximately|approx(?:imately)?\.?|about|circa)?\s*([\d,.]+)\s*(?:m(?:2|\u00b2)|sqm|square\s+metres?)(?=$|[^a-z0-9])/i,
    /\b(approximately|approx(?:imately)?\.?|about|circa)?\s*([\d,.]+)\s*(?:m(?:2|\u00b2)|sqm|square\s+metres?)\s+(?:of\s+)?combined\s+(?:land|site)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const areaSqm = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(areaSqm) || areaSqm <= 0 || areaSqm > 10_000_000) continue;
    return {
      areaSqm,
      approximate: Boolean(match[1]) || /\bapprox/i.test(match[0]),
    };
  }
  return null;
}

/**
 * The numeric price attached to a semantically confirmed multi-address listing
 * is the consideration for that listing as a whole. It must never be copied to
 * every child title as though each title were independently priced.
 */
export function combinedPackageFactsFromListing(
  listing: ListingResult | null | undefined,
): CombinedPackageFacts | null {
  if (!listing) return null;
  const land = extractAdvertisedCombinedLandArea(listing.description);
  const listingPriceNzd = positiveNumber(listing.price);
  if (listingPriceNzd == null && land == null && !listing.listingUrl) return null;
  return {
    listingPriceNzd,
    listingPriceApprox: listing.priceApprox === true,
    advertisedLandAreaSqm: land?.areaSqm ?? null,
    advertisedLandAreaApprox: land?.approximate ?? false,
    listingUrl: listing.listingUrl || null,
    source: "realestate.co.nz",
  };
}
