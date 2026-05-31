import { logger } from "./logger";
import {
  normaliseSelectedListingContext,
  selectedListingPhotoUrls,
  type SelectedListingContext,
} from "./selected-listing-context";
import {
  addressLineAppearsInText,
  fetchRealestateListingByUrl,
  fetchRealestateListingForAddress,
  extractCombinedListingAddressParts,
} from "./scrapers/realestate-api";
import type { ListingResult } from "./scrapers/oneroof";
import { extractBedsBaths } from "./scrapers/bed-bath-extractor";
import { parseArea, parseNZDollar } from "./scrapers/scraper-parsers";
import { scrapeHomesPhotos } from "./scrapers/homes-photos";
import { scrapeOneRoofPhotos } from "./scrapers/oneroof-photos";
import { scrapeTradeMePropertyPhotos } from "./scrapers/trademe-property";
import { fetchWithScrapingBee } from "./scrapers/scrapingbee";

export type ActiveListingPurpose = "feasibility" | "agent_contact" | "subdivision_screen";

export interface ActiveListingResolution {
  context: SelectedListingContext | null;
  realestateListing: ListingResult | null;
}

interface ResolveOptions {
  purpose?: ActiveListingPurpose;
  suburb?: string | null;
  formattedAddress?: string | null;
  preferredRealestateListingUrl?: string | null;
  selectedListingContext?: SelectedListingContext | null;
  // When true, only the realestate.co.nz exact match is allowed; the
  // speculative homes/oneroof/trademe photo-page sources are skipped. Used for
  // combined-listing children, whose individual sub-addresses are not
  // separately listed — fuzzy photo pages there return a neighbouring/parent
  // gallery, so we'd rather return null and let the caller use Street View.
  suppressSpeculativePhotoSources?: boolean;
}

interface ListingPageFacts {
  bedrooms: number | null;
  bathrooms: number | null;
  bedroomsApprox: boolean | null;
  bathroomsApprox: boolean | null;
  price: number | null;
  landArea: number | null;
  floorArea: number | null;
  agentName: string | null;
  agentPhone: string | null;
  agencyName: string | null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  return null;
}

function contextFromRealestateListing(listing: ListingResult): SelectedListingContext {
  const photoUrls = Array.from(new Set([
    ...(listing.photoUrls ?? []),
    ...(listing.photoUrl ? [listing.photoUrl] : []),
  ]));
  const useListingFacts = listing.isCombinedListing !== true;
  const packageParts = extractCombinedListingAddressParts(listing.address);
  return {
    address: listing.address,
    listingUrl: listing.listingUrl,
    photoUrl: photoUrls[0] ?? null,
    photoUrls,
    price: useListingFacts ? finiteNumber(listing.price) : null,
    landArea: useListingFacts ? finiteNumber(listing.landArea) : null,
    floorArea: useListingFacts ? finiteNumber(listing.floorArea) : null,
    bedrooms: useListingFacts ? finiteNumber(listing.bedrooms) : null,
    bathrooms: useListingFacts ? finiteNumber(listing.bathrooms) : null,
    bedroomsApprox: useListingFacts ? (listing.bedroomsApprox ?? null) : null,
    bathroomsApprox: useListingFacts ? (listing.bathroomsApprox ?? null) : null,
    landAreaApprox: useListingFacts ? (listing.landAreaApprox ?? null) : null,
    floorAreaApprox: useListingFacts ? (listing.floorAreaApprox ?? null) : null,
    priceApprox: useListingFacts ? (listing.priceApprox ?? null) : null,
    source: "realestate.co.nz",
    matchConfidence: "verified",
    isActiveListing: true,
    isCombinedListing: listing.isCombinedListing ?? Boolean(packageParts),
    packageAddress: packageParts?.packageAddress ?? null,
    childAddresses: packageParts?.childAddresses ?? [],
    aggregateFactsExcluded: listing.isCombinedListing ?? Boolean(packageParts),
  };
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function addressMatchesListing(address: string, url: string, text: string): boolean {
  const parts = address.split(",").map((p) => p.replace(/\b\d{4}\b/g, "").trim()).filter(Boolean);
  const suburb = parts[1]?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
  const haystack = `${url} ${text}`.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const streetOk = addressLineAppearsInText(address, text);
  const suburbOk = !suburb || haystack.includes(suburb);
  return streetOk && suburbOk;
}

function extractFirst(patterns: RegExp[], text: string): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

function extractAgentLikeFacts(text: string): Pick<ListingPageFacts, "agentName" | "agentPhone" | "agencyName"> {
  const phoneRaw = text.match(/(?:\+64\s?|0)(?:800[\s-]?\d{6}|[27]\d[\s-]?\d{3}[\s-]?\d{4}|[39]\s?\d{3}[\s-]?\d{4})/)?.[0] ?? null;
  const rawAgentName =
    extractFirst([
      /(?:listed by|presented by|contact|agent|call|enquire)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/i,
      /\b([A-Z][a-z]+\s+[A-Z][a-z]+)\s+(?:at|from|of|with)\s+(?:Ray White|Harcourts|Barfoot|Bayleys|The Kings|LJ Hooker|Premium|UP)/,
    ], text);
  const agentName = rawAgentName?.replace(/\s+(?:from|at|of|with)$/i, "").trim() || null;
  const knownAgencies = [
    "Ray White",
    "Harcourts",
    "Barfoot & Thompson",
    "Barfoot and Thompson",
    "Bayleys",
    "The Kings Of Real Estate",
    "The Kings of Real Estate",
    "LJ Hooker",
    "Premium Real Estate",
    "UP Real Estate",
  ];
  const agencyName = knownAgencies.find((agency) => text.toLowerCase().includes(agency.toLowerCase())) ?? null;
  return {
    agentName,
    agentPhone: phoneRaw ? phoneRaw.replace(/[\s().-]/g, "").replace(/^0/, "+64") : null,
    agencyName,
  };
}

export function extractListingFactsFromHtml(html: string): ListingPageFacts {
  const text = stripHtmlToText(html);
  const bedsBaths = extractBedsBaths(text);
  const bedroomsApprox = /\b\d+\+\s*(?:bed|bedroom|beds|卧)/i.test(text) ? true : null;
  const bathroomsApprox = /\b\d+\+\s*(?:bath|bathroom|baths|浴)/i.test(text) ? true : null;
  const priceText = extractFirst([
    /(?:asking price|asking|price|offers over|enquiries over|buyer enquiry over|BEO|sale price)\s*[:\s]*([$]?\s?[\d,.]+(?:\s?[mk])?)/i,
    /([$]\s?[\d,.]+(?:\s?[mk])?)/i,
  ], text);
  const landText = extractFirst([
    /(?:land area|land size|section|site area)\s*[:\s]*([\d,.]+\s*m(?:2|²)?)/i,
    /([\d,.]+\s*m(?:2|²)?)\s*(?:land|section|site)/i,
  ], text);
  const floorText = extractFirst([
    /(?:floor area|floor size|house size|building area|dwelling area)\s*[:\s]*([\d,.]+\s*m(?:2|²)?)/i,
    /([\d,.]+\s*m(?:2|²)?)\s*(?:floor|home|house|building|dwelling)/i,
  ], text);
  return {
    bedrooms: bedsBaths.bedrooms,
    bathrooms: bedsBaths.bathrooms,
    bedroomsApprox,
    bathroomsApprox,
    price: priceText ? parseNZDollar(priceText) : null,
    landArea: landText ? parseArea(landText) : null,
    floorArea: floorText ? parseArea(floorText) : null,
    ...extractAgentLikeFacts(text),
  };
}

async function fetchListingHtmlWithRetry(url: string): Promise<string | null> {
  const attempts = [
    { wait: 2500, premium_proxy: false },
    { wait: 4500, premium_proxy: false },
    { wait: 6500, premium_proxy: true },
  ];
  for (let i = 0; i < attempts.length; i++) {
    const opts = attempts[i];
    try {
      const html = await fetchWithScrapingBee(url, { render_js: true, wait: opts.wait, premium_proxy: opts.premium_proxy });
      if (html && html.length >= 500) return html;
    } catch (err) {
      logger.debug({ err: String(err), url, attempt: i + 1 }, "Active listing resolver: ScrapingBee attempt failed");
    }
  }
  return null;
}

function contextFromPhotoSource(args: {
  address: string;
  source: string;
  listingUrl: string | null;
  photoUrls: string[];
  facts: ListingPageFacts | null;
}): SelectedListingContext | null {
  if (!args.listingUrl && args.photoUrls.length === 0) return null;
  return {
    address: args.address,
    listingUrl: args.listingUrl,
    photoUrl: args.photoUrls[0] ?? null,
    photoUrls: args.photoUrls,
    price: args.facts?.price ?? null,
    landArea: args.facts?.landArea ?? null,
    floorArea: args.facts?.floorArea ?? null,
    bedrooms: args.facts?.bedrooms ?? null,
    bathrooms: args.facts?.bathrooms ?? null,
    bedroomsApprox: args.facts?.bedroomsApprox ?? null,
    bathroomsApprox: args.facts?.bathroomsApprox ?? null,
    source: args.source,
    agentName: args.facts?.agentName ?? null,
    agentPhone: args.facts?.agentPhone ?? null,
    agencyName: args.facts?.agencyName ?? null,
    matchConfidence: args.listingUrl ? "verified" : "likely",
    isActiveListing: true,
  };
}

async function resolveFromPhotoSource(
  address: string,
  source: "homes" | "oneroof" | "trademe",
): Promise<SelectedListingContext | null> {
  const data = source === "homes"
    ? await scrapeHomesPhotos(address)
    : source === "oneroof"
      ? await scrapeOneRoofPhotos(address)
      : await scrapeTradeMePropertyPhotos(address);
  if (!data.listing_url && data.photo_urls.length === 0) return null;

  let facts: ListingPageFacts | null = null;
  if (data.listing_url) {
    const html = await fetchListingHtmlWithRetry(data.listing_url);
    if (html) {
      const text = stripHtmlToText(html);
      if (!addressMatchesListing(address, data.listing_url, text)) {
        logger.info({ address, listingUrl: data.listing_url, source }, "Active listing resolver: rejected mismatched listing page");
        return null;
      }
      facts = extractListingFactsFromHtml(html);
    }
  }

  // Guard against thin/banner results: dead listing pages still pass the
  // URL-slug address check (the address is in the URL) but yield no real facts
  // and only a single og:image "ad" banner. Accepting those produced the wrong
  // photo + a dead "查看房源" link. Require either real facts or a genuine photo
  // gallery (>= 2 photos); otherwise fall through to the next source / Street View.
  const hasRealFacts =
    facts != null && (facts.bedrooms != null || facts.bathrooms != null || facts.price != null);
  if (!hasRealFacts && data.photo_urls.length < 2) {
    logger.info(
      { address, listingUrl: data.listing_url, source, photoCount: data.photo_urls.length },
      "Active listing resolver: rejected thin/banner result",
    );
    return null;
  }

  return contextFromPhotoSource({
    address,
    source,
    listingUrl: data.listing_url,
    photoUrls: data.photo_urls,
    facts,
  });
}

function hasListingValue(ctx: SelectedListingContext | null): boolean {
  if (!ctx) return false;
  return Boolean(
    ctx.listingUrl ||
    selectedListingPhotoUrls(ctx).length > 0 ||
    ctx.bedrooms != null ||
    ctx.bathrooms != null ||
    ctx.agentName ||
    ctx.agencyName,
  );
}

export async function resolveActiveListingContext(
  address: string,
  options: ResolveOptions = {},
): Promise<ActiveListingResolution> {
  const selected = normaliseSelectedListingContext(options.selectedListingContext);
  if (hasListingValue(selected)) {
    return { context: { ...selected!, isActiveListing: selected!.isActiveListing ?? true }, realestateListing: null };
  }

  let realestateListing: ListingResult | null = null;
  if (options.preferredRealestateListingUrl) {
    realestateListing = await fetchRealestateListingByUrl(options.preferredRealestateListingUrl).catch(() => null);
  }
  const suburb = options.suburb?.trim() || address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim() || "";
  if (!realestateListing && suburb) {
    realestateListing =
      await fetchRealestateListingForAddress(address, suburb).catch(() => null) ??
      (options.formattedAddress ? await fetchRealestateListingForAddress(options.formattedAddress, suburb).catch(() => null) : null);
  }
  if (realestateListing) {
    return { context: contextFromRealestateListing(realestateListing), realestateListing };
  }

  if (options.purpose === "subdivision_screen" || options.suppressSpeculativePhotoSources) {
    return { context: null, realestateListing: null };
  }

  for (const source of ["homes", "oneroof", "trademe"] as const) {
    try {
      const context = await resolveFromPhotoSource(address, source);
      if (hasListingValue(context)) return { context, realestateListing: null };
    } catch (err) {
      logger.debug({ err: String(err), address, source }, "Active listing resolver: source failed");
    }
  }

  return { context: null, realestateListing: null };
}
