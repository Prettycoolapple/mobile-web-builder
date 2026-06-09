import { getApiBase } from "@/lib/api";

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
  cursor?: string | null;
  limit?: number;
};

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

export function selectedListingContextFromBrowse(listing: BrowseListing) {
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
    source: listing.source === "internal" ? "project-alpha" : "curated",
    isCombinedListing: null,
    packageAddress: null,
    childAddresses: null,
    aggregateFactsExcluded: null,
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
  if (filters.cursor) params.set("cursor", filters.cursor);
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
): Promise<ListingAgentContact | null> {
  const resp = await fetch(`${getApiBase()}/agent-contact/for-listing`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => null) as ListingAgentContact | null;
  if (!resp.ok || !data) return null;
  return data;
}
