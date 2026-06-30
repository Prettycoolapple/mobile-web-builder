import { Router } from "express";
import { and, asc, desc, eq, gt, gte, ilike, isNotNull, isNull, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { browseListingCache, db, listings, listingViews, profiles, salesAgentProfiles, withDbRetry } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { agentCanList } from "../lib/agent-entitlements";
import { searchRealEstateListings } from "../lib/scrapers/realestate-search";
import { fetchRealestateListingDetailsByUrl } from "../lib/scrapers/realestate-api";
import type { ListingResult } from "../lib/scrapers/oneroof";
import { ai } from "@workspace/integrations-gemini-ai";
import { logger } from "../lib/logger";
import { buildListingTeaser } from "../lib/listing-teaser";
import { browseSearchVariants, compactBrowseSearchText } from "../lib/browse-search";

const router = Router();
const BROWSE_MODE_ENABLED = true;

// ── Total-views display helpers ──────────────────────────────────────────────
// Fake growth is computed on read (no cron): a per-listing seed plus a
// deterministic 1–5 increment for each elapsed 3-hour bucket, capped at 8
// buckets (24h). Real, de-duplicated views are added on top.
//
// Views are only shown AFTER the listing is approved AND after a deterministic
// 7–30 min warm-up window, so newly-approved listings don't show view counts
// immediately (they were pending and had no real exposure before approval).
function deterministicInc(listingId: string, bucket: number): number {
  let h = 2166136261 >>> 0; // FNV-1a
  const s = `${listingId}:${bucket}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h % 5) + 1; // 1..5
}

function computeDisplayViews(listing: {
  id: string;
  fakeViewSeed: number | null;
  realViews: number;
  approvedAt: Date | string | null;
}): number {
  // Listing is still pending approval — no one can see it yet, so no views.
  if (!listing.approvedAt) return 0;

  // Deterministic 7–30 min delay after approval before the first fake view
  // appears. Uses the listing ID as entropy so the delay is stable across reads.
  let h = 2166136261 >>> 0; // FNV-1a
  const seed = `warmup:${listing.id}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const delayMs = (7 + (h % 24)) * 60_000; // 7..30 minutes in ms
  const approvedMs = new Date(listing.approvedAt).getTime();
  const viewsStartMs = approvedMs + delayMs;

  // Still inside the warm-up window — show nothing yet.
  if (Date.now() < viewsStartMs) return 0;

  const fakeSeed = listing.fakeViewSeed ?? 0;
  const hours = (Date.now() - viewsStartMs) / 3_600_000;
  const buckets = Math.max(0, Math.min(8, Math.floor(hours / 3)));
  let fake = fakeSeed;
  for (let b = 1; b <= buckets; b++) fake += deterministicInc(listing.id, b);
  return fake + (listing.realViews ?? 0);
}


type BrowseListing = {
  id: string;
  source: "internal" | "curated";
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
  createdAt?: Date | string | null;
  agent: {
    id?: string | null;
    fullName?: string | null;
    avatarUrl?: string | null;
    agencyName?: string | null;
    phone?: string | null;
    isVerified?: boolean | null;
  } | null;
};

const BROWSE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
// Cap on real listings we top up per page via live scraping. Kept at/above the client's
// prefetch window (BROWSE_PREFETCH_LIMIT = 10) so a filtered page isn't artificially short.
const MAX_CURATED_TOP_UP = 12;
// Incremental curated-scrape budget. When a filter is active we walk multiple suburbs/pages to
// find real matches before giving up; bounded by request count + wall-clock so the request stays
// responsive and we don't hammer realestate.co.nz.
const CURATED_SCRAPE_DELAY_MS = 350;
const CURATED_MAX_REQUESTS_FILTERED = 8;
const CURATED_MAX_REQUESTS_UNFILTERED = 2;
const CURATED_DEADLINE_MS = 13_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const DEFAULT_BROWSE_SUBURBS = [
  "remuera",
  "st heliers",
  "mt eden",
  "epsom",
  "papakura",
  "henderson",
  "albany",
  "howick",
  "hamilton",
  "tauranga",
  "wellington",
  "christchurch",
  "dunedin",
  "queenstown",
  "nelson",
];
const VALID_SORTS = new Set(["recommended", "newest", "price_asc", "price_desc", "land_desc"]);
const AGENT_PLACEHOLDER_VALUES = new Set(["listing agent", "external marketplace", "curated listing", "project alpha sample"]);

function cleanQuery(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function browseSearchCondition(columns: AnyColumn[], query: string): SQL | undefined {
  const variants = browseSearchVariants(query);
  const compact = compactBrowseSearchText(query);
  const clauses: SQL[] = [];
  for (const variant of variants) {
    for (const column of columns) {
      clauses.push(ilike(column, `%${variant}%`));
    }
  }
  if (compact) {
    for (const column of columns) {
      clauses.push(sql`regexp_replace(lower(coalesce(${column}, '')), '[^[:alnum:]]', '', 'g') like ${`%${compact}%`}`);
    }
  }
  return clauses.length ? or(...clauses) : undefined;
}

function cleanAgentDisplayValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return AGENT_PLACEHOLDER_VALUES.has(cleaned.toLowerCase()) ? null : cleaned;
}

function normaliseCachedAgent(agent: (typeof browseListingCache.$inferSelect)["agent"]): BrowseListing["agent"] {
  if (!agent) return null;
  const fullName = cleanAgentDisplayValue(agent.fullName);
  const agencyName = cleanAgentDisplayValue(agent.agencyName);
  const avatarUrl = cleanAgentDisplayValue(agent.avatarUrl);
  const phone = cleanAgentDisplayValue(agent.phone);
  if (!fullName && !agencyName && !avatarUrl && !phone) return null;
  return {
    fullName,
    avatarUrl,
    agencyName,
    phone,
    isVerified: false,
  };
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function canonicalBrowseListingKey(listing: Pick<BrowseListing, "id" | "address" | "externalUrl">): string {
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

function parseExcludedListingKeys(value: unknown): Set<string> {
  if (typeof value !== "string" || !value.trim()) return new Set();
  return new Set(value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 100));
}

function dedupeBrowseListings(items: BrowseListing[], excluded = new Set<string>()): BrowseListing[] {
  const seen = new Set(excluded);
  const result: BrowseListing[] = [];
  for (const item of items) {
    const key = canonicalBrowseListingKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function defaultBrowseSuburb(offset: number, limit: number): { suburb: string; startOffset: number } {
  const page = Math.max(0, Math.floor(offset / Math.max(1, limit)));
  const suburb = DEFAULT_BROWSE_SUBURBS[page % DEFAULT_BROWSE_SUBURBS.length] ?? DEFAULT_BROWSE_SUBURBS[0];
  const cycle = Math.floor(page / DEFAULT_BROWSE_SUBURBS.length);
  return { suburb, startOffset: cycle * limit };
}

function applyBrowseFilters(items: BrowseListing[], filters: {
  propertyType: string;
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  minLandArea: number | null;
  minFloorArea: number | null;
}): BrowseListing[] {
  return items.filter((item) => {
    if (filters.propertyType && item.propertyType && !item.propertyType.toLowerCase().includes(filters.propertyType.toLowerCase())) return false;
    if (filters.bedroomsMin && (item.bedrooms ?? 0) < filters.bedroomsMin) return false;
    if (filters.bathroomsMin && (item.bathrooms ?? 0) < filters.bathroomsMin) return false;
    if (filters.minLandArea && (item.landAreaSqm ?? 0) < filters.minLandArea) return false;
    if (filters.minFloorArea && (item.floorAreaSqm ?? 0) < filters.minFloorArea) return false;
    return true;
  });
}

function sortBrowseListings(items: BrowseListing[], sort: string): BrowseListing[] {
  const sorted = [...items];
  if (sort === "price_asc") {
    sorted.sort((a, b) => (a.priceNzd ?? Number.MAX_SAFE_INTEGER) - (b.priceNzd ?? Number.MAX_SAFE_INTEGER));
  } else if (sort === "price_desc") {
    sorted.sort((a, b) => (b.priceNzd ?? 0) - (a.priceNzd ?? 0));
  } else if (sort === "land_desc") {
    sorted.sort((a, b) => (b.landAreaSqm ?? 0) - (a.landAreaSqm ?? 0));
  } else if (sort === "newest") {
    sorted.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  }
  return sorted;
}

function publicListingFromInternal(row: {
  id: string;
  userId: string;
  address: string;
  addressSuburb: string | null;
  addressCity: string | null;
  listingType: "for_sale" | "for_rent";
  propertyType: string;
  bedrooms: number | null;
  bathrooms: number | null;
  toilets: number | null;
  garages: number | null;
  landAreaSqm: number | null;
  floorAreaSqm: number | null;
  priceNzd: number | null;
  priceDisplay: string | null;
  listingTitle: string | null;
  description: string | null;
  imageUrls: string[];
  features: string[];
  createdAt: Date;
  agentName: string | null;
  agentAvatarUrl: string | null;
  agentVerified: boolean | null;
  agentPhone: string | null;
  agencyName: string | null;
}): BrowseListing {
  return {
    id: row.id,
    source: "internal",
    externalUrl: null,
    listingTitle: row.listingTitle,
    address: row.address,
    addressSuburb: row.addressSuburb,
    addressCity: row.addressCity,
    listingType: row.listingType,
    propertyType: row.propertyType,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    toilets: row.toilets,
    garages: row.garages,
    landAreaSqm: row.landAreaSqm,
    floorAreaSqm: row.floorAreaSqm,
    priceNzd: row.priceNzd,
    priceDisplay: row.priceDisplay,
    description: row.description,
    teaser: buildListingTeaser(row.description, {
      address: row.address,
      listingTitle: row.listingTitle,
      propertyType: row.propertyType,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      toilets: row.toilets,
      garages: row.garages,
      landAreaSqm: row.landAreaSqm,
      floorAreaSqm: row.floorAreaSqm,
      priceDisplay: row.priceDisplay,
    }),
    imageUrls: row.imageUrls,
    features: row.features,
    createdAt: row.createdAt,
    agent: {
      id: row.userId,
      fullName: row.agentName,
      avatarUrl: row.agentAvatarUrl,
      agencyName: row.agencyName,
      phone: row.agentPhone,
      isVerified: row.agentVerified,
    },
  };
}

function publicListingFromCurated(listing: ListingResult): BrowseListing {
  const listingTitle = listing.listingTitle ?? listing.address.split(",")[0]?.trim() ?? listing.address;
  const propertyType = sanitisePropertyType(listing.propertyType ?? listing.listingCategory) ?? "house";
  return {
    id: `curated_${Buffer.from(listing.listingUrl).toString("base64url").slice(0, 140)}`,
    source: "curated",
    externalUrl: listing.listingUrl,
    listingTitle,
    address: listing.address,
    listingType: "for_sale",
    propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    garages: null,
    landAreaSqm: listing.landArea,
    floorAreaSqm: listing.floorArea ?? null,
    priceNzd: listing.price,
    priceDisplay: listing.priceText,
    description: listing.description ?? buildFactualDescription(listing),
    teaser: buildListingTeaser(listing.description, {
      address: listing.address,
      listingTitle,
      propertyType,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      landAreaSqm: listing.landArea,
      floorAreaSqm: listing.floorArea,
      priceDisplay: listing.priceText,
    }),
    imageUrls: listing.photoUrls?.length ? listing.photoUrls : listing.photoUrl ? [listing.photoUrl] : [],
    features: [],
    // No agent data available for real-time curated results — pass null so
    // the mobile card hides the agent row rather than showing placeholder text.
    agent: null,
  };
}

function publicListingFromCache(row: typeof browseListingCache.$inferSelect): BrowseListing {
  const agent = normaliseCachedAgent(row.agent);
  return {
    id: row.id,
    source: "curated",
    externalUrl: row.externalUrl,
    listingTitle: row.listingTitle,
    address: row.address,
    addressSuburb: row.addressSuburb,
    addressCity: row.addressCity,
    listingType: row.listingType === "for_rent" ? "for_rent" : "for_sale",
    propertyType: row.propertyType,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    garages: row.garages,
    landAreaSqm: row.landAreaSqm,
    floorAreaSqm: row.floorAreaSqm,
    priceNzd: row.priceNzd,
    priceDisplay: row.priceDisplay,
    description: row.description,
    teaser: buildListingTeaser(row.description, {
      address: row.address,
      listingTitle: row.listingTitle,
      propertyType: row.propertyType,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      garages: row.garages,
      landAreaSqm: row.landAreaSqm,
      floorAreaSqm: row.floorAreaSqm,
      priceDisplay: row.priceDisplay,
    }),
    imageUrls: row.imageUrls,
    features: row.features,
    createdAt: row.firstSeenAt,
    // Only set agent when we have real scraped data; null hides the row entirely.
    agent,
  };
}

async function hydrateCachedBrowseListing(row: typeof browseListingCache.$inferSelect): Promise<BrowseListing> {
  const listing = publicListingFromCache(row);
  const cachedAgent = normaliseCachedAgent(row.agent);
  const hasCallableAgent = !!cachedAgent?.phone && (!!cachedAgent.fullName || !!cachedAgent.avatarUrl || !!cachedAgent.agencyName);
  if (hasCallableAgent || !row.externalUrl || !/realestate\.co\.nz/i.test(row.externalUrl)) return listing;

  try {
    const details = await Promise.race([
      fetchRealestateListingDetailsByUrl(row.externalUrl),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6500)),
    ]);
    if (!details) return listing;

    const agent = normaliseCachedAgent({
      fullName: details.agentName ?? null,
      agencyName: details.agencyName ?? null,
      avatarUrl: details.agentAvatarUrl ?? null,
      phone: details.agentPhone ?? null,
    });
    const nextListing: BrowseListing = {
      ...listing,
      listingTitle: details.listingTitle ?? listing.listingTitle,
      description: details.description ?? listing.description,
      imageUrls: details.imageUrls?.length ? details.imageUrls : listing.imageUrls,
      propertyType: sanitisePropertyType(details.propertyType ?? null) ?? listing.propertyType,
      bedrooms: details.bedrooms ?? listing.bedrooms,
      bathrooms: details.bathrooms ?? listing.bathrooms,
      landAreaSqm: details.landAreaSqm ?? listing.landAreaSqm,
      floorAreaSqm: details.floorAreaSqm ?? listing.floorAreaSqm,
      priceNzd: details.priceNzd ?? listing.priceNzd,
      priceDisplay: details.priceDisplay ?? listing.priceDisplay,
      agent: normaliseCachedAgent({
        ...(cachedAgent ?? {}),
        ...(agent ?? {}),
        fullName: agent?.fullName ?? cachedAgent?.fullName ?? null,
        agencyName: agent?.agencyName ?? cachedAgent?.agencyName ?? null,
        avatarUrl: agent?.avatarUrl ?? cachedAgent?.avatarUrl ?? null,
        phone: agent?.phone ?? cachedAgent?.phone ?? null,
      }) ?? listing.agent,
    };

    void db
      .update(browseListingCache)
      .set({
        ...(nextListing.agent && { agent: nextListing.agent }),
        listingTitle: nextListing.listingTitle,
        description: nextListing.description,
        imageUrls: nextListing.imageUrls,
        propertyType: nextListing.propertyType,
        bedrooms: nextListing.bedrooms ?? null,
        bathrooms: nextListing.bathrooms ?? null,
        landAreaSqm: nextListing.landAreaSqm ?? null,
        floorAreaSqm: nextListing.floorAreaSqm ?? null,
        priceNzd: nextListing.priceNzd ?? null,
        priceDisplay: nextListing.priceDisplay ?? null,
        lastRefreshedAt: new Date(),
      })
      .where(eq(browseListingCache.id, row.id))
      .catch((err) => logger.warn({ err, listingId: row.id }, "Failed to hydrate cached listing details"));

    return nextListing;
  } catch (err) {
    logger.warn({ err, listingId: row.id, url: row.externalUrl }, "Failed to hydrate cached listing from public detail");
    return listing;
  }
}

function suburbFromAddress(address: string): string | null {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] ?? null : null;
}

const VALID_PROPERTY_TYPES = new Set(["house", "apartment", "townhouse", "unit", "section", "commercial", "industrial", "rural", "other"]);

function sanitisePropertyType(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (VALID_PROPERTY_TYPES.has(lower)) return lower;
  if (/\bunit\b/.test(lower)) return "unit";
  if (/\bapartment\b/.test(lower)) return "apartment";
  if (/\btownhouse\b|\bterrace\b/.test(lower)) return "townhouse";
  if (/\bhouse\b|\bdwelling\b/.test(lower)) return "house";
  if (/\bsection\b|\bland\b/.test(lower)) return "section";
  return null;
}

function buildFactualDescription(listing: ListingResult): string {
  const suburb = suburbFromAddress(listing.address);
  const type = sanitisePropertyType(listing.propertyType ?? listing.listingCategory) ?? "property";
  const parts: string[] = [];
  if (listing.bedrooms) parts.push(`${listing.bedrooms}-bed`);
  if (listing.bathrooms) parts.push(`${listing.bathrooms}-bath`);
  parts.push(type.charAt(0).toUpperCase() + type.slice(1));
  if (suburb) parts.push(`in ${suburb}`);
  const stats: string[] = [];
  if (listing.landArea) stats.push(`${listing.landArea.toLocaleString()} sqm land`);
  if (listing.floorArea) stats.push(`${listing.floorArea.toLocaleString()} sqm floor`);
  const base = parts.join(" ");
  return stats.length ? `${base} — ${stats.join(", ")}.` : `${base}.`;
}

async function generateListingMarketingSummary(
  address: string,
  propertyType: string | null,
  bedrooms: number | null,
  bathrooms: number | null,
  landAreaSqm: number | null,
  rawDescription: string | null,
): Promise<string | null> {
  if (!rawDescription || rawDescription.length < 40) return null;
  try {
    const prompt = `Write one concise marketing sentence (max 25 words) for this NZ property listing. Focus on key selling points. Return ONLY the sentence, no quotes or punctuation changes.

Address: ${address}
Type: ${propertyType ?? "property"}
Bedrooms: ${bedrooms ?? "unknown"}, Bathrooms: ${bathrooms ?? "unknown"}
Land area: ${landAreaSqm ? `${landAreaSqm} sqm` : "unknown"}
Agent's description: ${rawDescription.slice(0, 400)}`;
    const response = await Promise.race([
      ai.models.generateContent({
        model: "deepseek-chat",
        config: { maxOutputTokens: 60, temperature: 0.5, thinkingConfig: { thinkingBudget: 0 } },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    const text = (response.text ?? "").trim().replace(/^["']|["']$/g, "");
    return text.length >= 10 ? text : null;
  } catch {
    return null;
  }
}

async function upsertCuratedBrowseListings(listingsToCache: ListingResult[]): Promise<BrowseListing[]> {
  if (listingsToCache.length === 0) return [];
  const now = new Date();
  const values = listingsToCache.map((listing) => ({
    source: "realestate.co.nz",
    externalUrl: listing.listingUrl,
    externalId: listing.listingUrl.match(/realestate\.co\.nz\/(\d+)/)?.[1] ?? null,
    address: listing.address,
    addressSuburb: suburbFromAddress(listing.address),
    addressCity: null,
    listingType: "for_sale",
    propertyType: sanitisePropertyType(listing.propertyType ?? listing.listingCategory) ?? "house",
    listingStatus: listing.listingStatus ?? "active",
    isActive: true,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    garages: null,
    landAreaSqm: listing.landArea,
    floorAreaSqm: listing.floorArea ?? null,
    priceNzd: listing.price,
    priceDisplay: listing.priceText,
    listingTitle: listing.address.split(",")[0]?.trim() || listing.address,
    description: listing.description ?? buildFactualDescription(listing),
    imageUrls: listing.photoUrls?.length ? listing.photoUrls : listing.photoUrl ? [listing.photoUrl] : [],
    features: [],
    agent: {},
    lastSeenAt: now,
    lastRefreshedAt: now,
  }));

  const rows = await withDbRetry(() =>
    db
      .insert(browseListingCache)
      .values(values)
      .onConflictDoUpdate({
        target: [browseListingCache.source, browseListingCache.externalUrl],
        set: {
          externalId: sql`coalesce(excluded.external_id, ${browseListingCache.externalId})`,
          address: sql`excluded.address`,
          addressSuburb: sql`coalesce(excluded.address_suburb, ${browseListingCache.addressSuburb})`,
          propertyType: sql`coalesce(excluded.property_type, ${browseListingCache.propertyType})`,
          listingStatus: sql`excluded.listing_status`,
          isActive: true,
          bedrooms: sql`coalesce(excluded.bedrooms, ${browseListingCache.bedrooms})`,
          bathrooms: sql`coalesce(excluded.bathrooms, ${browseListingCache.bathrooms})`,
          landAreaSqm: sql`coalesce(excluded.land_area_sqm, ${browseListingCache.landAreaSqm})`,
          floorAreaSqm: sql`coalesce(excluded.floor_area_sqm, ${browseListingCache.floorAreaSqm})`,
          priceNzd: sql`coalesce(excluded.price_nzd, ${browseListingCache.priceNzd})`,
          priceDisplay: sql`coalesce(excluded.price_display, ${browseListingCache.priceDisplay})`,
          listingTitle: sql`coalesce(excluded.listing_title, ${browseListingCache.listingTitle})`,
          description: sql`coalesce(excluded.description, ${browseListingCache.description})`,
          imageUrls: sql`case when cardinality(excluded.image_urls) > 0 then excluded.image_urls else ${browseListingCache.imageUrls} end`,
          agent: sql`case when ${browseListingCache.agent} is null or ${browseListingCache.agent} = '{}'::jsonb then excluded.agent else ${browseListingCache.agent} end`,
          lastSeenAt: now,
          lastRefreshedAt: now,
          refreshCount: sql`${browseListingCache.refreshCount} + 1`,
        },
      })
      .returning(),
  );
  return rows.map(publicListingFromCache);
}

async function fetchCuratedBrowseListings(args: {
  query: string;
  needed: number;
  minPrice: number | null;
  maxPrice: number | null;
  offset: number;
  limit: number;
  propertyType: string;
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  minLandArea: number | null;
  minFloorArea: number | null;
  sort: string;
}): Promise<BrowseListing[]> {
  // The upstream JSON API pages in windows of 100 and advances its offset by the full window, so
  // we consume a whole page per request (filtering over all of it) rather than a small slice that
  // would skip listings between pages.
  const CURATED_PAGE_SIZE = 100;
  const filtersActive = Boolean(
    args.propertyType || args.bedroomsMin || args.bathroomsMin || args.minLandArea || args.minFloorArea,
  );

  // Build the ordered list of suburbs to walk. With a user query we stay on that one suburb and
  // page through it; with no query we rotate through the default suburbs starting at this page's
  // suburb. When a filter is active we allow walking several suburbs so we can actually find
  // matching real listings rather than declaring "no listings" after a single suburb.
  const defaultTarget = defaultBrowseSuburb(args.offset, args.limit);
  let targets: Array<{ suburb: string; startOffset: number }>;
  if (args.query) {
    targets = browseSearchVariants(args.query).map((suburb) => ({ suburb, startOffset: args.offset }));
  } else if (filtersActive) {
    const startIdx = DEFAULT_BROWSE_SUBURBS.indexOf(defaultTarget.suburb);
    targets = DEFAULT_BROWSE_SUBURBS
      .slice(Math.max(0, startIdx))
      .concat(DEFAULT_BROWSE_SUBURBS.slice(0, Math.max(0, startIdx)))
      .map((suburb) => ({ suburb, startOffset: 0 }));
  } else {
    targets = [{ suburb: defaultTarget.suburb, startOffset: defaultTarget.startOffset }];
  }

  const maxRequests = filtersActive ? CURATED_MAX_REQUESTS_FILTERED : CURATED_MAX_REQUESTS_UNFILTERED;
  const deadline = Date.now() + CURATED_DEADLINE_MS;
  const collected: BrowseListing[] = [];
  const seen = new Set<string>();
  let requests = 0;

  // Sequential walk (await in series) — never fire scrapes in parallel, so there are no races and
  // we stay polite to the upstream site. A short sleep between requests further avoids rate limits.
  for (const target of targets) {
    if (collected.length >= args.needed || requests >= maxRequests || Date.now() >= deadline) break;
    let offset = target.startOffset;
    let done = false;
    while (!done && collected.length < args.needed && requests < maxRequests && Date.now() < deadline) {
      requests += 1;
      try {
        const result = await searchRealEstateListings({
          suburb: target.suburb,
          minPrice: args.minPrice ?? 1,
          maxPrice: args.maxPrice ?? 20_000_000,
          firstBatchSize: CURATED_PAGE_SIZE,
          includeNegotiation: true,
          fetchAllPages: false,
          maxListings: CURATED_PAGE_SIZE,
          startOffset: offset,
        });
        const scraped = [...result.firstBatch, ...result.remainingListings].slice(0, CURATED_PAGE_SIZE);
        const cached = await upsertCuratedBrowseListings(scraped);
        const items = cached.length ? cached : scraped.map(publicListingFromCurated);
        for (const item of applyBrowseFilters(items, args)) {
          const key = canonicalBrowseListingKey(item);
          if (seen.has(key)) continue;
          seen.add(key);
          collected.push(item);
        }
        offset = result.nextOffset;
        done = result.done || !offset;
      } catch {
        // One failed page shouldn't abort the whole accumulation — move to the next suburb.
        done = true;
      }
      if (!done && (collected.length < args.needed) && requests < maxRequests && Date.now() < deadline) {
        await sleep(CURATED_SCRAPE_DELAY_MS);
      }
    }
  }

  return sortBrowseListings(collected, args.sort).slice(0, args.needed);
}

/**
 * Whether the agent's plan currently allows publishing listings. Lifetime
 * (invite-code / grandfathered) agents always can; subscription agents only
 * while their Stripe subscription is active. Returns true when the user has no
 * sales-agent profile (the role check elsewhere handles non-agents).
 */
async function agentListingAllowed(userId: string): Promise<boolean> {
  const [profile] = await db
    .select({
      subscriptionStatus: profiles.subscriptionStatus,
      subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  const [agent] = await db
    .select({ listingPlan: salesAgentProfiles.listingPlan })
    .from(salesAgentProfiles)
    .where(eq(salesAgentProfiles.userId, userId))
    .limit(1);
  if (!agent) return true;
  return agentCanList(profile ?? {}, agent);
}

const propertyTypes = ["house", "apartment", "townhouse", "unit", "section", "commercial", "industrial", "rural", "other"] as const;
const listingStatuses = ["draft", "active", "paused", "sold", "withdrawn"] as const;
const methodsOfSale = ["auction", "tender", "asking_price", "deadline_sale", "price_by_negotiation"] as const;
const titleStatuses = ["freehold", "crosslease", "unit_title", "leasehold", "other"] as const;
const documentCategories = ["title", "lim", "other"] as const;

const listingDocumentSchema = z.object({
  category: z.enum(documentCategories),
  fileName: z.string().min(1).max(240),
  fileUrl: z.string().min(1),
  objectPath: z.string().nullable().optional(),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  uploadedAt: z.string().min(1),
});

const listingPayloadSchema = z.object({
  listingTitle: z.string().trim().min(3).max(180),
  address: z.string().trim().min(3),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostcode: z.string().optional(),
  lat: z.string().optional(),
  lng: z.string().optional(),
  googlePlaceId: z.string().optional(),
  status: z.enum(listingStatuses).default("active"),
  listingType: z.enum(["for_sale", "for_rent"]).default("for_sale"),
  propertyType: z.enum(propertyTypes),
  propertySubtype: z.string().trim().min(1).max(120),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  toilets: z.number().int().min(0),
  garages: z.number().int().min(0),
  landAreaSqm: z.number().int().positive(),
  floorAreaSqm: z.number().int().positive(),
  titleStatus: z.enum(titleStatuses),
  methodOfSale: z.enum(methodsOfSale),
  backendSearchPriceMin: z.number().int().positive(),
  backendSearchPriceMax: z.number().int().positive(),
  buyerPriceRangeMin: z.number().int().positive().optional(),
  buyerPriceRangeMax: z.number().int().positive().optional(),
  buyerPriceRangeConfirmed: z.boolean().default(false),
  priceNzd: z.number().int().min(0).optional(),
  priceDisplay: z.string().optional(),
  description: z.string().trim().min(20),
  imageUrls: z.array(z.string().min(1)).min(1).max(20),
  documentUrls: z.array(listingDocumentSchema).default([]),
  features: z.array(z.string()).default([]),
});

function validateListingRules(
  data: Partial<z.infer<typeof listingPayloadSchema>>,
  ctx: z.RefinementCtx,
) {
  if (
    data.backendSearchPriceMin !== undefined &&
    data.backendSearchPriceMax !== undefined &&
    data.backendSearchPriceMax < data.backendSearchPriceMin
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["backendSearchPriceMax"],
      message: "Backend search price maximum must be greater than or equal to the minimum.",
    });
  }

  const hasBuyerMin = data.buyerPriceRangeMin !== undefined;
  const hasBuyerMax = data.buyerPriceRangeMax !== undefined;
  if (hasBuyerMin !== hasBuyerMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["buyerPriceRangeMin"],
      message: "Enter both ends of the buyer-facing price range, or leave both blank.",
    });
  }
  if (hasBuyerMin && hasBuyerMax) {
    if ((data.buyerPriceRangeMax ?? 0) < (data.buyerPriceRangeMin ?? 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyerPriceRangeMax"],
        message: "Buyer-facing price range maximum must be greater than or equal to the minimum.",
      });
    }
    if (!data.buyerPriceRangeConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyerPriceRangeConfirmed"],
        message: "Confirm the lowest quoted figure is an amount the vendor would seriously consider.",
      });
    }
  }

  for (const [index, document] of (data.documentUrls ?? []).entries()) {
    const mime = document.mimeType.toLowerCase();
    if ((document.category === "title" || document.category === "lim") && mime !== "application/pdf") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentUrls", index, "mimeType"],
        message: "Property Title and LIM files must be PDFs.",
      });
    }
  }
}

const createListingSchema = listingPayloadSchema.superRefine(validateListingRules);

type NominatimAddress = Record<string, string | undefined>;

type NormalisedAddressParts = {
  street: string;
  suburb: string;
  city: string;
  postcode: string;
  label: string;
  mainText: string;
  secondaryText: string;
};

function cleanAddressText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function firstAddressValue(address: NominatimAddress, keys: string[]): string {
  for (const key of keys) {
    const value = cleanAddressText(address[key]);
    if (value) return value;
  }
  return "";
}

function compactUnique(parts: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts.map((value) => cleanAddressText(value)).filter(Boolean)) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(part);
  }
  return result;
}

function normaliseNominatimAddress(item: Record<string, unknown>): NormalisedAddressParts {
  const address = (item.address && typeof item.address === "object" ? item.address : {}) as NominatimAddress;
  const displayParts = cleanAddressText(item.display_name)
    .replace(/,\s*New Zealand$/i, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const houseNumber = firstAddressValue(address, ["house_number"]);
  const road = firstAddressValue(address, ["road", "pedestrian", "footway", "path", "residential", "service"]);
  const displayStreet = displayParts.find((part) => /^\d+[a-z]?(?:\s*[/.-]\s*\d+[a-z]?)?\s+\S+/i.test(part)) ?? "";
  const street = houseNumber && road ? `${houseNumber} ${road}` : road || displayStreet || displayParts[0] || "";
  const suburb = firstAddressValue(address, ["suburb", "neighbourhood", "quarter", "city_district", "hamlet"]);
  const city = firstAddressValue(address, ["city", "town", "village", "municipality", "county", "state_district", "state"]);
  const postcode = firstAddressValue(address, ["postcode"]);

  const label = compactUnique([street, suburb, city, postcode]).join(", ") || displayParts.join(", ");
  const mainText = street || displayParts[0] || label;
  const secondaryText = compactUnique([suburb, city, postcode]).join(", ");

  return { street, suburb, city, postcode, label, mainText, secondaryText };
}

/** Normalise an OSM Nominatim result into the same shape as a Google Places prediction. */
function nominatimToPrediction(item: Record<string, unknown>) {
  const parts = normaliseNominatimAddress(item);
  const placeId = `osm:${item.osm_type ?? ""}:${item.osm_id ?? ""}`;
  return {
    place_id: placeId,
    description: parts.label,
    structured_formatting: {
      main_text: parts.mainText,
      secondary_text: parts.secondaryText,
    },
    source: "osm",
    lat: cleanAddressText(item.lat),
    lng: cleanAddressText(item.lon),
    address: {
      street: parts.street,
      suburb: parts.suburb,
      city: parts.city,
      postcode: parts.postcode,
      label: parts.label,
    },
    // Backwards-compatible fields for the existing sales portal bundle.
    _source: "osm",
    _lat: item.lat,
    _lon: item.lon,
    _address: item.address,
  };
}

async function fetchNominatim(endpoint: "search" | "lookup", params: URLSearchParams): Promise<Record<string, unknown>[]> {
  const nominatimUrl = `https://nominatim.openstreetmap.org/${endpoint}?${params.toString()}`;
  const response = await fetch(nominatimUrl, {
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent": "ProjectAlpha/1.0 (https://www.projectalpha.app; contact@projectalpha.app)",
      "Accept": "application/json",
    },
  });
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

function osmLookupCode(placeId: string): string | null {
  const [, type, id] = placeId.split(":");
  const prefix = type === "node" ? "N" : type === "way" ? "W" : type === "relation" ? "R" : "";
  return prefix && id ? `${prefix}${id}` : null;
}

router.get("/listings/address-autocomplete", requireAuth, async (req, res) => {
  const q = (req.query.q as string) ?? "";
  if (!q.trim() || q.trim().length < 2) {
    res.json({ predictions: [] });
    return;
  }

  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;

  // --- Primary: Google Places API (richer data, used when key is configured) ---
  if (googleApiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:nz&types=address&key=${googleApiKey}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
      const data = (await r.json()) as { predictions?: unknown[]; status?: string };
      if (data.status === "OK" && Array.isArray(data.predictions) && data.predictions.length > 0) {
        res.json({ predictions: data.predictions, source: "google" });
        return;
      }
    } catch {
      // Fall through to Nominatim if Google fails
    }
  }

  // --- Fallback: OpenStreetMap Nominatim (free NZ address fallback, no key required) ---
  try {
    const trimmed = q.trim();
    const baseParams = {
      format: "json",
      countrycodes: "nz",
      addressdetails: "1",
      limit: "7",
      "accept-language": "en",
    };
    const queries = [
      new URLSearchParams({ ...baseParams, q: trimmed }),
      new URLSearchParams({ ...baseParams, street: trimmed, country: "New Zealand" }),
    ];
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const params of queries) {
      const items = await fetchNominatim("search", params);
      for (const item of items) {
        const key = `${item.osm_type ?? ""}:${item.osm_id ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(item);
      }
      if (rows.length >= 7) break;
    }
    const predictions = rows.slice(0, 7).map(nominatimToPrediction);
    res.json({ predictions, source: "osm" });
  } catch {
    res.json({ predictions: [], source: "none" });
  }
});

router.get("/listings/place-details/:placeId", requireAuth, async (req, res) => {
  const { placeId } = req.params;

  // OSM-sourced result: the frontend usually embeds lat/lon/address in the prediction.
  // If an older client only sends the place id, fall back to Nominatim lookup.
  if (placeId.startsWith("osm:")) {
    let lat = req.query.lat as string | undefined;
    let lon = req.query.lon as string | undefined;
    let street = req.query.street as string | undefined;
    let suburb = req.query.suburb as string | undefined;
    let city = req.query.city as string | undefined;
    let postcode = req.query.postcode as string | undefined;
    let label = req.query.label as string | undefined;

    if (!street && !suburb && !city && !postcode) {
      const lookupCode = osmLookupCode(placeId);
      if (lookupCode) {
        try {
          const params = new URLSearchParams({
            osm_ids: lookupCode,
            format: "json",
            addressdetails: "1",
            "accept-language": "en",
          });
          const rows = await fetchNominatim("lookup", params);
          const parts = rows[0] ? normaliseNominatimAddress(rows[0]) : null;
          if (parts) {
            lat = cleanAddressText(rows[0]?.lat);
            lon = cleanAddressText(rows[0]?.lon);
            street = parts.street;
            suburb = parts.suburb;
            city = parts.city;
            postcode = parts.postcode;
            label = parts.label;
          }
        } catch {
          // Return the partial details below.
        }
      }
    }

    const addressComponents: { long_name: string; types: string[] }[] = [];
    if (street) addressComponents.push({ long_name: street, types: ["route"] });
    if (suburb) addressComponents.push({ long_name: suburb, types: ["sublocality", "neighborhood"] });
    if (city) addressComponents.push({ long_name: city, types: ["locality"] });
    if (postcode) addressComponents.push({ long_name: postcode, types: ["postal_code"] });

    res.json({
      result: {
        formatted_address: label ?? "",
        address_components: addressComponents,
        geometry: lat && lon ? { location: { lat: parseFloat(lat), lng: parseFloat(lon) } } : undefined,
      },
      source: "osm",
    });
    return;
  }

  // Google Places API
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.json({ result: null });
    return;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,address_components,geometry&key=${apiKey}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
    const data = (await r.json()) as { result?: unknown };
    res.json({ result: data.result ?? null, source: "google" });
  } catch {
    res.json({ result: null });
  }
});

router.get("/listings/enrich", async (req, res) => {
  const url = cleanQuery(req.query.url);
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: "A valid listing URL is required.", code: "INVALID_LISTING_URL" });
    return;
  }

  try {
    if (/realestate\.co\.nz/i.test(url)) {
      const details = await fetchRealestateListingDetailsByUrl(url);
      const agent = normaliseCachedAgent({
        fullName: details?.agentName ?? null,
        agencyName: details?.agencyName ?? null,
        avatarUrl: details?.agentAvatarUrl ?? null,
        phone: details?.agentPhone ?? null,
      });
      if (agent) {
        void db
          .update(browseListingCache)
          .set({ agent })
          .where(eq(browseListingCache.externalUrl, url))
          .catch((err) => logger.warn({ err, url }, "Failed to write agent details to listing cache"));
      }
      // Generate an AI marketing summary from the scraped description and
      // write it back to the cache so subsequent card views show real copy.
      if (details?.description && details.description.length >= 40) {
        void generateListingMarketingSummary(
          url,
          sanitisePropertyType(details.propertyType ?? null),
          details.bedrooms ?? null,
          details.bathrooms ?? null,
          details.landAreaSqm ?? null,
          details.description,
        ).then(async (summary) => {
          if (!summary) return;
          try {
            await db
              .update(browseListingCache)
              .set({ description: summary })
              .where(eq(browseListingCache.externalUrl, url));
          } catch (err) {
            logger.warn({ err, url }, "Failed to write AI summary to listing cache");
          }
        }).catch(() => {});
      }
      res.json({ details });
      return;
    }
    res.json({ details: null });
  } catch (error) {
    req.log?.warn({ error, url }, "Failed to enrich public listing");
    res.json({ details: null });
  }
});

router.get("/listings", async (req, res) => {
  if (!BROWSE_MODE_ENABLED) {
    res.status(404).json({ error: "Browse listings are temporarily disabled.", code: "BROWSE_DISABLED" });
    return;
  }

  const query = cleanQuery(req.query.q);
  const limit = Math.min(parsePositiveInt(req.query.limit) ?? 12, 30);
  const offset = Math.max(parsePositiveInt(req.query.cursor) ?? 0, 0);
  const excludedKeys = parseExcludedListingKeys(req.query.exclude);
  const fetchWindow = Math.min(60, Math.max(limit * 3, limit + excludedKeys.size));
  const minPrice = parsePositiveInt(req.query.minPrice);
  const maxPrice = parsePositiveInt(req.query.maxPrice);
  const bedroomsMin = parsePositiveInt(req.query.bedrooms);
  const bathroomsMin = parsePositiveInt(req.query.bathrooms);
  const minLandArea = parsePositiveInt(req.query.minLandArea);
  const minFloorArea = parsePositiveInt(req.query.minFloorArea);
  const listingType = "for_sale";
  const propertyType = cleanQuery(req.query.propertyType);
  const sort = VALID_SORTS.has(cleanQuery(req.query.sort)) ? cleanQuery(req.query.sort) : "recommended";
  const internalOrder =
    sort === "price_asc" ? asc(listings.priceNzd)
      : sort === "price_desc" ? desc(listings.priceNzd)
        : sort === "land_desc" ? desc(listings.landAreaSqm)
          : desc(listings.createdAt);
  const cacheOrder =
    sort === "price_asc" ? asc(browseListingCache.priceNzd)
      : sort === "price_desc" ? desc(browseListingCache.priceNzd)
        : sort === "land_desc" ? desc(browseListingCache.landAreaSqm)
          : desc(browseListingCache.lastSeenAt);

  try {
    const filters = [
      eq(listings.status, "active" as const),
      isNull(listings.removedAt),
      isNotNull(listings.approvedAt),
      eq(listings.listingType, "for_sale" as const),
    ];
    const internalSearch = browseSearchCondition([
      listings.address,
      listings.addressSuburb,
      listings.addressCity,
      listings.listingTitle,
    ], query);
    if (internalSearch) {
      filters.push(internalSearch);
    }
    if (propertyTypes.includes(propertyType as (typeof propertyTypes)[number])) {
      filters.push(eq(listings.propertyType, propertyType as (typeof propertyTypes)[number]));
    }
    if (minPrice) filters.push(gte(listings.priceNzd, minPrice));
    if (maxPrice) filters.push(lte(listings.priceNzd, maxPrice));
    if (bedroomsMin) filters.push(gte(listings.bedrooms, bedroomsMin));
    if (bathroomsMin) filters.push(gte(listings.bathrooms, bathroomsMin));
    if (minLandArea) filters.push(gte(listings.landAreaSqm, minLandArea));
    if (minFloorArea) filters.push(gte(listings.floorAreaSqm, minFloorArea));
    const internalRows = await db
      .select({
        id: listings.id,
        userId: listings.userId,
        address: listings.address,
        addressSuburb: listings.addressSuburb,
        addressCity: listings.addressCity,
        listingType: listings.listingType,
        propertyType: listings.propertyType,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        toilets: listings.toilets,
        garages: listings.garages,
        landAreaSqm: listings.landAreaSqm,
        floorAreaSqm: listings.floorAreaSqm,
        priceNzd: listings.priceNzd,
        priceDisplay: listings.priceDisplay,
        listingTitle: listings.listingTitle,
        description: listings.description,
        imageUrls: listings.imageUrls,
        features: listings.features,
        createdAt: listings.createdAt,
        agentName: profiles.fullName,
        agentAvatarUrl: profiles.avatarUrl,
        agentVerified: profiles.isVerified,
        agentPhone: profiles.phoneNumber,
        agencyName: salesAgentProfiles.agencyName,
      })
      .from(listings)
      .innerJoin(profiles, eq(profiles.id, listings.userId))
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, listings.userId))
      .where(and(...filters))
      .orderBy(internalOrder)
      .limit(fetchWindow)
      .offset(offset);

    const internal = dedupeBrowseListings(internalRows.map(publicListingFromInternal), excludedKeys);
    const cacheNeeded = Math.max(0, fetchWindow - internal.length);
    const freshCutoff = new Date(Date.now() - BROWSE_CACHE_TTL_MS);
    const cachedRows = cacheNeeded > 0
      ? await db
          .select()
          .from(browseListingCache)
          .where(and(
            eq(browseListingCache.isActive, true),
            gt(browseListingCache.lastRefreshedAt, freshCutoff),
            browseSearchCondition([
              browseListingCache.address,
              browseListingCache.addressSuburb,
              browseListingCache.addressCity,
              browseListingCache.listingTitle,
            ], query),
            eq(browseListingCache.listingType, "for_sale"),
            propertyType ? ilike(browseListingCache.propertyType, `%${propertyType}%`) : undefined,
            minPrice ? gte(browseListingCache.priceNzd, minPrice) : undefined,
            maxPrice ? lte(browseListingCache.priceNzd, maxPrice) : undefined,
            bedroomsMin ? gte(browseListingCache.bedrooms, bedroomsMin) : undefined,
            bathroomsMin ? gte(browseListingCache.bathrooms, bathroomsMin) : undefined,
            minLandArea ? gte(browseListingCache.landAreaSqm, minLandArea) : undefined,
            minFloorArea ? gte(browseListingCache.floorAreaSqm, minFloorArea) : undefined,
          ))
          .orderBy(cacheOrder)
          .limit(cacheNeeded)
          .offset(offset)
      : [];
    const cached = dedupeBrowseListings(sortBrowseListings(applyBrowseFilters(cachedRows.map(publicListingFromCache), {
      propertyType,
      bedroomsMin,
      bathroomsMin,
      minLandArea,
      minFloorArea,
    }), sort), new Set([...excludedKeys, ...internal.map(canonicalBrowseListingKey)]));

    const scrapeNeeded = Math.min(MAX_CURATED_TOP_UP, Math.max(0, limit - internal.length - cached.length));
    const curated = scrapeNeeded > 0
      ? await fetchCuratedBrowseListings({
          query,
          needed: scrapeNeeded,
          minPrice,
          maxPrice,
          offset,
          limit,
          propertyType,
          bedroomsMin,
          bathroomsMin,
          minLandArea,
          minFloorArea,
          sort,
        })
      : [];
    const curatedUnique = dedupeBrowseListings(curated, new Set([
      ...excludedKeys,
      ...internal.map(canonicalBrowseListingKey),
      ...cached.map(canonicalBrowseListingKey),
    ]));
    // Only ever surface real listings (internal + cached + live curated). When nothing matches,
    // return an empty page so the client shows its "No listings found" empty state — never fill
    // with mock/sample placeholders.
    const items = sortBrowseListings(dedupeBrowseListings([...internal, ...cached, ...curatedUnique], excludedKeys), sort).slice(0, limit);
    res.json({
      listings: items,
      nextCursor: items.length === limit ? String(offset + limit) : null,
      sourceCounts: {
        internal: internal.length,
        cached: cached.length,
        curated: curatedUnique.length,
      },
    });
  } catch (error) {
    req.log?.error({ error }, "Failed to browse listings");
    res.status(500).json({ error: "We couldn't load listings. Please try again.", code: "BROWSE_FAILED" });
  }
});

router.post("/listings", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const role = (req as any).role as string;

  try {
    const [agentProfile] = role === "sales_agent"
      ? [{ userId }]
      : await db
          .select({ userId: salesAgentProfiles.userId })
          .from(salesAgentProfiles)
          .where(eq(salesAgentProfiles.userId, userId))
          .limit(1);

    if (role !== "sales_agent" && !agentProfile) {
      res.status(403).json({ error: "Only sales agents can create listings.", code: "FORBIDDEN" });
      return;
    }

    if (!(await agentListingAllowed(userId))) {
      res.status(403).json({
        error: "Your subscription is inactive. Resubscribe to list properties.",
        code: "SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    const parsed = createListingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Some listing details are missing or invalid. Please check each step and try again.", details: parsed.error.issues });
      return;
    }

    const data = parsed.data;
    const [listing] = await db
      .insert(listings)
      .values({
        userId,
        address: data.address,
        addressStreet: data.addressStreet,
        addressSuburb: data.addressSuburb,
        addressCity: data.addressCity,
        addressPostcode: data.addressPostcode,
        lat: data.lat,
        lng: data.lng,
        googlePlaceId: data.googlePlaceId,
        status: data.status,
        listingType: data.listingType,
        propertyType: data.propertyType,
        propertySubtype: data.propertySubtype,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        toilets: data.toilets,
        garages: data.garages,
        landAreaSqm: data.landAreaSqm,
        floorAreaSqm: data.floorAreaSqm,
        titleStatus: data.titleStatus,
        methodOfSale: data.methodOfSale,
        backendSearchPriceMin: data.backendSearchPriceMin,
        backendSearchPriceMax: data.backendSearchPriceMax,
        buyerPriceRangeMin: data.buyerPriceRangeMin,
        buyerPriceRangeMax: data.buyerPriceRangeMax,
        buyerPriceRangeConfirmed: data.buyerPriceRangeConfirmed,
        priceNzd: data.priceNzd,
        priceDisplay: data.priceDisplay,
        listingTitle: data.listingTitle,
        description: data.description,
        imageUrls: data.imageUrls,
        documentUrls: data.documentUrls,
        features: data.features,
        // Seed natural-looking early traffic (4–29) for the views counter.
        fakeViewSeed: Math.floor(Math.random() * 26) + 4,
      })
      .returning();

    res.status(201).json({ listing });
  } catch (error) {
    req.log?.error({ error }, "Failed to create listing");
    res.status(500).json({ error: "We couldn't save your listing. Please try again.", code: "CREATE_FAILED" });
  }
});

router.get("/listings/my", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const myListings = await db
      .select()
      .from(listings)
      .where(and(eq(listings.userId, userId), isNull(listings.removedAt)))
      .orderBy(desc(listings.createdAt));
    const withViews = myListings.map((listing) => ({
      ...listing,
      totalViews: computeDisplayViews(listing),
    }));
    res.json({ listings: withViews });
  } catch (error) {
    req.log?.error({ error }, "Failed to fetch listings");
    res.status(500).json({ error: "We couldn't load your listings. Please refresh the page.", code: "FETCH_FAILED" });
  }
});

router.get("/listings/public/:id", async (req, res) => {
  if (!BROWSE_MODE_ENABLED) {
    res.status(404).json({ error: "Browse listings are temporarily disabled.", code: "BROWSE_DISABLED" });
    return;
  }

  const { id } = req.params;
  try {
    const [cachedExternal] = await db
      .select()
      .from(browseListingCache)
      .where(and(eq(browseListingCache.id, id), eq(browseListingCache.isActive, true)))
      .limit(1);
    if (cachedExternal) {
      await db
        .update(browseListingCache)
        .set({ hitCount: sql`${browseListingCache.hitCount} + 1` })
        .where(eq(browseListingCache.id, id));
      res.json({ listing: await hydrateCachedBrowseListing(cachedExternal) });
      return;
    }

    const [row] = await db
      .select({
        id: listings.id,
        userId: listings.userId,
        address: listings.address,
        addressSuburb: listings.addressSuburb,
        addressCity: listings.addressCity,
        listingType: listings.listingType,
        propertyType: listings.propertyType,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        toilets: listings.toilets,
        garages: listings.garages,
        landAreaSqm: listings.landAreaSqm,
        floorAreaSqm: listings.floorAreaSqm,
        priceNzd: listings.priceNzd,
        priceDisplay: listings.priceDisplay,
        listingTitle: listings.listingTitle,
        description: listings.description,
        imageUrls: listings.imageUrls,
        features: listings.features,
        createdAt: listings.createdAt,
        agentName: profiles.fullName,
        agentAvatarUrl: profiles.avatarUrl,
        agentVerified: profiles.isVerified,
        agentPhone: profiles.phoneNumber,
        agencyName: salesAgentProfiles.agencyName,
      })
      .from(listings)
      .innerJoin(profiles, eq(profiles.id, listings.userId))
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, listings.userId))
      .where(and(eq(listings.id, id), eq(listings.status, "active" as const), isNull(listings.removedAt), isNotNull(listings.approvedAt)))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Listing not found.", code: "NOT_FOUND" });
      return;
    }

    // Record a real, de-duplicated view: count once per viewer, and never count
    // the listing's own owner. The unique (listing_id, viewer_user_id) index makes
    // the insert idempotent; we only bump real_views when a new row is created.
    const viewerId = (req as any).userId as string | undefined;
    if (viewerId && viewerId !== row.userId) {
      try {
        const inserted = await db
          .insert(listingViews)
          .values({ listingId: row.id, viewerUserId: viewerId })
          .onConflictDoNothing({ target: [listingViews.listingId, listingViews.viewerUserId] })
          .returning({ id: listingViews.id });
        if (inserted.length > 0) {
          await db
            .update(listings)
            .set({ realViews: sql`${listings.realViews} + 1` })
            .where(eq(listings.id, row.id));
        }
      } catch (viewErr) {
        req.log?.warn({ viewErr, listingId: row.id }, "Failed to record listing view (non-fatal)");
      }
    }

    res.json({ listing: publicListingFromInternal(row) });
  } catch (error) {
    req.log?.error({ error }, "Failed to fetch public listing");
    res.status(500).json({ error: "We couldn't load this listing. Please try again.", code: "FETCH_FAILED" });
  }
});

router.get("/listings/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  try {
    const [listing] = await db.select().from(listings).where(eq(listings.id, id));
    if (!listing) {
      res.status(404).json({ error: "Listing not found.", code: "NOT_FOUND" });
      return;
    }
    if (listing.userId !== userId) {
      res.status(403).json({ error: "You can only view your own listings.", code: "FORBIDDEN" });
      return;
    }
    res.json({ listing });
  } catch (error) {
    req.log?.error({ error }, "Failed to fetch listing");
    res.status(500).json({ error: "We couldn't load this listing. Please try again.", code: "FETCH_FAILED" });
  }
});

const updateListingSchema = listingPayloadSchema.partial().extend({
  status: z.enum(listingStatuses).optional(),
}).superRefine(validateListingRules);

router.patch("/listings/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const [existing] = await db.select().from(listings).where(eq(listings.id, id));
    if (!existing) {
      res.status(404).json({ error: "Listing not found.", code: "NOT_FOUND" });
      return;
    }
    if (existing.userId !== userId) {
      res.status(403).json({ error: "You can only edit your own listings.", code: "FORBIDDEN" });
      return;
    }

    const parsed = updateListingSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid listing data.", details: parsed.error.issues });
      return;
    }

    const data = parsed.data;

    // Publishing/resuming a listing requires an active plan; editing a
    // non-status field or pausing/withdrawing is always allowed.
    if (data.status === "active" && existing.status !== "active") {
      if (!(await agentListingAllowed(userId))) {
        res.status(403).json({
          error: "Your subscription is inactive. Resubscribe to publish listings.",
          code: "SUBSCRIPTION_REQUIRED",
        });
        return;
      }
    }
    const [updated] = await db
      .update(listings)
      .set({
        ...(data.address !== undefined && { address: data.address }),
        ...(data.addressStreet !== undefined && { addressStreet: data.addressStreet }),
        ...(data.addressSuburb !== undefined && { addressSuburb: data.addressSuburb }),
        ...(data.addressCity !== undefined && { addressCity: data.addressCity }),
        ...(data.addressPostcode !== undefined && { addressPostcode: data.addressPostcode }),
        ...(data.lat !== undefined && { lat: data.lat }),
        ...(data.lng !== undefined && { lng: data.lng }),
        ...(data.googlePlaceId !== undefined && { googlePlaceId: data.googlePlaceId }),
        ...(data.listingType !== undefined && { listingType: data.listingType }),
        ...(data.propertyType !== undefined && { propertyType: data.propertyType }),
        ...(data.propertySubtype !== undefined && { propertySubtype: data.propertySubtype }),
        ...(data.bedrooms !== undefined && { bedrooms: data.bedrooms }),
        ...(data.bathrooms !== undefined && { bathrooms: data.bathrooms }),
        ...(data.toilets !== undefined && { toilets: data.toilets }),
        ...(data.garages !== undefined && { garages: data.garages }),
        ...(data.landAreaSqm !== undefined && { landAreaSqm: data.landAreaSqm }),
        ...(data.floorAreaSqm !== undefined && { floorAreaSqm: data.floorAreaSqm }),
        ...(data.titleStatus !== undefined && { titleStatus: data.titleStatus }),
        ...(data.methodOfSale !== undefined && { methodOfSale: data.methodOfSale }),
        ...(data.backendSearchPriceMin !== undefined && { backendSearchPriceMin: data.backendSearchPriceMin }),
        ...(data.backendSearchPriceMax !== undefined && { backendSearchPriceMax: data.backendSearchPriceMax }),
        ...(data.buyerPriceRangeMin !== undefined && { buyerPriceRangeMin: data.buyerPriceRangeMin }),
        ...(data.buyerPriceRangeMax !== undefined && { buyerPriceRangeMax: data.buyerPriceRangeMax }),
        ...(data.buyerPriceRangeConfirmed !== undefined && { buyerPriceRangeConfirmed: data.buyerPriceRangeConfirmed }),
        ...(data.priceNzd !== undefined && { priceNzd: data.priceNzd }),
        ...(data.priceDisplay !== undefined && { priceDisplay: data.priceDisplay }),
        ...(data.listingTitle !== undefined && { listingTitle: data.listingTitle }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.imageUrls !== undefined && { imageUrls: data.imageUrls }),
        ...(data.documentUrls !== undefined && { documentUrls: data.documentUrls }),
        ...(data.features !== undefined && { features: data.features }),
        ...(data.status !== undefined && { status: data.status }),
        updatedAt: new Date(),
      })
      .where(eq(listings.id, id))
      .returning();

    res.json({ listing: updated });
  } catch (error) {
    req.log?.error({ error }, "Failed to update listing");
    res.status(500).json({ error: "We couldn't update your listing. Please try again.", code: "UPDATE_FAILED" });
  }
});

router.delete("/listings/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  try {
    const [existing] = await db.select().from(listings).where(eq(listings.id, id));
    if (!existing) {
      res.status(404).json({ error: "Listing not found.", code: "NOT_FOUND" });
      return;
    }
    if (existing.userId !== userId) {
      res.status(403).json({ error: "You can only remove your own listings.", code: "FORBIDDEN" });
      return;
    }

    await db
      .update(listings)
      .set({ status: "paused", removedAt: new Date(), updatedAt: new Date() })
      .where(eq(listings.id, id));
    res.json({ success: true });
  } catch (error) {
    req.log?.error({ error }, "Failed to delete listing");
    res.status(500).json({ error: "We couldn't remove your listing. Please try again.", code: "DELETE_FAILED" });
  }
});

export default router;
