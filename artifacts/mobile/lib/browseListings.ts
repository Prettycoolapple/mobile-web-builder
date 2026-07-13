import { getApiBase } from "@/lib/api";
import type { WatchlistCandidate } from "@/context/WatchlistContext";
import type { SelectedListingContext } from "@/context/ChatContext";

export type BrowseListingSource = "internal" | "curated";

export type BrowseListing = {
  id: string;
  source: BrowseListingSource;
  externalUrl?: string | null;
  listingTitle: string | null;
  address: string;
  addressSuburb?: string | null;
  addressCity?: string | null;
  listingType: "for_sale" | "for_rent";
  propertyType: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  toilets?: number | null;
  garages?: number | null;
  landAreaSqm?: number | null;
  floorAreaSqm?: number | null;
  priceNzd?: number | null;
  priceDisplay?: string | null;
  description?: string | null;
  teaser?: string | null;
  imageUrls: string[];
  features: string[];
  createdAt?: string | null;
  agent: {
    id?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
    agencyName?: string | null;
    phone?: string | null;
    isVerified?: boolean | null;
  } | null;
};

export type BrowseListingFilters = {
  q?: string;
  listingType?: "for_sale" | "for_rent";
  propertyType?: string;
  minPrice?: string;
  maxPrice?: string;
  bedrooms?: string;
  bathrooms?: string;
  minLandArea?: string;
  minFloorArea?: string;
  sort?: "recommended" | "newest" | "price_asc" | "price_desc" | "land_desc";
  cursor?: string | null;
  limit?: number;
  excludeKeys?: string[];
};

const AGENT_PLACEHOLDER_VALUES = new Set([
  "listing agent",
  "external marketplace",
  "curated listing",
  "project alpha sample",
  "房源中介",
  "外部市场房源",
  "精选房源",
]);

function cleanAgentDisplayValue(value: string | null | undefined): string | null {
  const cleaned = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!cleaned) return null;
  return AGENT_PLACEHOLDER_VALUES.has(cleaned.toLowerCase()) ? null : cleaned;
}

export function normaliseBrowseListingAgent(agent: BrowseListing["agent"]): BrowseListing["agent"] {
  if (!agent) return null;
  const fullName = cleanAgentDisplayValue(agent.fullName);
  const agencyName = cleanAgentDisplayValue(agent.agencyName);
  const avatarUrl = cleanAgentDisplayValue(agent.avatarUrl);
  const phone = cleanAgentDisplayValue(agent.phone);
  if (!fullName && !agencyName && !avatarUrl && !phone) return null;
  return {
    ...agent,
    fullName,
    agencyName,
    avatarUrl,
    phone,
  };
}

export function canonicalBrowseListingKey(listing: Pick<BrowseListing, "id" | "address" | "externalUrl">): string {
  const url = listing.externalUrl?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      parsed.search = "";
      return `url:${parsed.toString().replace(/\/$/, "").toLowerCase()}`;
    } catch {
      return `url:${url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase()}`;
    }
  }
  const address = listing.address
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return address ? `address:${address}` : `id:${listing.id}`;
}

export function dedupeBrowseListings<T extends BrowseListing>(items: T[], existingKeys: Iterable<string> = []): T[] {
  const seen = new Set(existingKeys);
  const result: T[] = [];
  for (const item of items) {
    const key = canonicalBrowseListingKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function hasRealBrowseListingAgent(agent: BrowseListing["agent"]): boolean {
  return !!normaliseBrowseListingAgent(agent);
}

export function resolveListingImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/api/")) return `${getApiBase().replace(/\/api$/, "")}${url}`;
  return url;
}

// Fraction of curated (scraped) listings that are cosmetically badged as
// "Sponsored". Real internal Project Alpha agent listings are always sponsored;
// while real agent supply is still ramping up, a small deterministic slice of
// curated listings also carries the badge so the marketplace feels active. Keep
// this modest — it should read as "some agents are here", not "everything is ad".
const FAKE_SPONSORED_RATE = 0.18;

function stableHashFraction(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return (Math.abs(hash) % 10000) / 10000;
}

/**
 * Whether a listing should show the "Sponsored" badge. Internal listings always
 * do; curated listings do for a stable ~{FAKE_SPONSORED_RATE} fraction keyed off
 * a stable identifier, so the same property always resolves the same way and the
 * card and detail page never disagree.
 */
export function isListingSponsored(listing: BrowseListing): boolean {
  if (listing.source === "internal") return true;
  const seed = listing.externalUrl || listing.id || listing.address;
  if (!seed) return false;
  return stableHashFraction(`sponsored:${seed}`) < FAKE_SPONSORED_RATE;
}

export function selectedListingContextFromBrowse(listing: BrowseListing): SelectedListingContext {
  return {
    address: listing.address,
    listingUrl: listing.externalUrl ?? null,
    photoUrl: listing.imageUrls[0] ?? null,
    photoUrls: listing.imageUrls ?? [],
    price: listing.priceNzd ?? null,
    landArea: listing.landAreaSqm ?? null,
    floorArea: listing.floorAreaSqm ?? null,
    bedrooms: listing.bedrooms ?? null,
    bathrooms: listing.bathrooms ?? null,
    bedroomsApprox: null,
    bathroomsApprox: null,
    landAreaApprox: null,
    floorAreaApprox: null,
    priceApprox: null,
    propertyType: listing.propertyType ?? null,
    listingTitle: listing.listingTitle ?? null,
    source: listing.source === "internal" ? "project-alpha" : "curated",
    agentName: listing.agent?.fullName ?? null,
    agentPhone: listing.agent?.phone ?? null,
    agencyName: listing.agent?.agencyName ?? null,
    matchConfidence: listing.source === "internal" ? "verified" : listing.agent?.phone ? "likely" : null,
    isActiveListing: listing.listingType === "for_sale",
    isCombinedListing: null,
    packageAddress: null,
    childAddresses: null,
    aggregateFactsExcluded: null,
  };
}

export function watchlistCandidateFromBrowse(listing: BrowseListing): WatchlistCandidate {
  const agent = normaliseBrowseListingAgent(listing.agent);
  return {
    address: listing.address,
    price: listing.priceNzd ?? 0,
    landArea: listing.landAreaSqm ?? undefined,
    scores: { ease: 0, cost: 0, roi: 0, composite: 0 },
    photoUrl: listing.imageUrls?.[0] ?? undefined,
    photoUrls: listing.imageUrls ?? [],
    listingUrl: listing.externalUrl ?? undefined,
    priceDisplay: listing.priceDisplay ?? undefined,
    propertyType: listing.propertyType ?? undefined,
    listingTitle: listing.listingTitle ?? undefined,
    description: listing.description ?? undefined,
    features: listing.features ?? [],
    agentName: agent?.fullName ?? undefined,
    agencyName: agent?.agencyName ?? undefined,
    agentAvatarUrl: agent?.avatarUrl ?? undefined,
    agentPhone: agent?.phone ?? undefined,
    source: listing.source,
    internalListingId: listing.source === "internal" ? listing.id : undefined,
    isSponsored: isListingSponsored(listing),
    bedrooms: listing.bedrooms ?? undefined,
    bathrooms: listing.bathrooms ?? undefined,
    toilets: listing.toilets ?? undefined,
    garages: listing.garages ?? undefined,
    floorArea: listing.floorAreaSqm ?? undefined,
  };
}

export async function fetchBrowseListings(headers: Record<string, string>, filters: BrowseListingFilters) {
  const params = new URLSearchParams();
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  if (filters.listingType) params.set("listingType", filters.listingType);
  if (filters.propertyType) params.set("propertyType", filters.propertyType);
  if (filters.minPrice?.trim()) params.set("minPrice", filters.minPrice.trim());
  if (filters.maxPrice?.trim()) params.set("maxPrice", filters.maxPrice.trim());
  if (filters.bedrooms?.trim()) params.set("bedrooms", filters.bedrooms.trim());
  if (filters.bathrooms?.trim()) params.set("bathrooms", filters.bathrooms.trim());
  if (filters.minLandArea?.trim()) params.set("minLandArea", filters.minLandArea.trim());
  if (filters.minFloorArea?.trim()) params.set("minFloorArea", filters.minFloorArea.trim());
  if (filters.sort?.trim()) params.set("sort", filters.sort.trim());
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.excludeKeys?.length) params.set("exclude", filters.excludeKeys.slice(0, 80).join(","));
  params.set("limit", String(filters.limit ?? 12));

  const resp = await fetch(`${getApiBase()}/listings?${params.toString()}`, { headers });
  const data = await resp.json().catch(() => null) as { listings?: BrowseListing[]; nextCursor?: string | null } | null;
  if (!resp.ok || !data) throw new Error("Could not load listings.");
  return { listings: data.listings ?? [], nextCursor: data.nextCursor ?? null };
}

export async function fetchPublicListing(headers: Record<string, string>, id: string) {
  const resp = await fetch(`${getApiBase()}/listings/public/${encodeURIComponent(id)}`, { headers });
  const data = await resp.json().catch(() => null) as { listing?: BrowseListing } | null;
  if (!resp.ok || !data?.listing) throw new Error("Could not load this listing.");
  return data.listing;
}

export async function fetchListingEnrichment(headers: Record<string, string>, url: string) {
  const resp = await fetch(`${getApiBase()}/listings/enrich?url=${encodeURIComponent(url)}`, { headers });
  const data = await resp.json().catch(() => null) as {
    details?: Partial<BrowseListing> & {
      imageUrls?: string[];
      priceNzd?: number | null;
      priceDisplay?: string | null;
      landAreaSqm?: number | null;
      floorAreaSqm?: number | null;
      agentName?: string | null;
      agentPhone?: string | null;
      agencyName?: string | null;
      agentAvatarUrl?: string | null;
    } | null;
  } | null;
  if (!resp.ok || !data) throw new Error("Could not load listing details.");
  return data.details ?? null;
}

export type ListingAgentContact = {
  found: boolean;
  isListed: boolean;
  agentName: string | null;
  agentPhone: string | null;
  agencyName: string | null;
  agentAvatarUrl: string | null;
  listingUrl: string | null;
  source: string | null;
};

/**
 * Resolve a callable agent (name, phone, agency, avatar) for a listing via the
 * backend's multi-source scrape chain (realestate.co.nz API → reveal-button page
 * scrape → OneRoof portal). Used by the listing detail screen to power the Call /
 * Send-message buttons when the listing payload didn't already carry a number.
 */
export async function fetchListingAgentContact(
  headers: Record<string, string>,
  body: { address: string; listingUrl?: string | null; selectedListingContext?: unknown },
  signal?: AbortSignal,
): Promise<ListingAgentContact | null> {
  const resp = await fetch(`${getApiBase()}/agent-contact/for-listing`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await resp.json().catch(() => null) as ListingAgentContact | null;
  if (!resp.ok || !data) return null;
  return data;
}
