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
