import type { ListingResult } from "./scrapers/oneroof";

interface CacheEntry {
  remainingListings: ListingResult[];
  shownUrls: string[];
  suburb: string;
  minPrice: number;
  maxPrice: number;
  expiresAt: number;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

// ── Per-listing screen-verdict cache ─────────────────────────────────────
// Strict-subdivision discovery does a lot of redundant per-listing work:
// the outer indeterminate-retry pass re-screens the same listings after a
// wait, and "show more" follow-ups iterate over the same pool again. Caching
// each verdict for the typical 60-minute browse session means the work runs
// at most once.

import type { PropertyCandidate, ScreenVerdict } from "./pre-screen";

interface VerdictEntry {
  verdict: ScreenVerdict;
  expiresAt: number;
}

const VERDICT_TTL_CANDIDATE_MS = 60 * 60 * 1000;
const VERDICT_TTL_REJECTED_MS = 60 * 60 * 1000;
/** Indeterminate gets a short TTL so the outer retry pass can still succeed. */
const VERDICT_TTL_INDETERMINATE_MS = 5 * 60 * 1000;
const verdictCache = new Map<string, VerdictEntry>();

function normaliseVerdictKey(listingUrl: string | null | undefined, address: string, variant?: string): string {
  const fromUrl = listingUrl?.trim();
  const base = fromUrl
    ? fromUrl.toLowerCase()
    : address.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return base;
  // A freehold-screened verdict (which may reject a non-freehold property) must
  // not be served to a non-freehold search and vice-versa, so the screening
  // variant is part of the cache key.
  return variant ? `${base}::${variant}` : base;
}

export function getScreenVerdict(
  listing: { listingUrl?: string | null; address: string },
  variant?: string,
): ScreenVerdict | null {
  const key = normaliseVerdictKey(listing.listingUrl, listing.address, variant);
  if (!key) return null;
  const entry = verdictCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    verdictCache.delete(key);
    return null;
  }
  return entry.verdict;
}

export function setScreenVerdict(
  listing: { listingUrl?: string | null; address: string },
  verdict: ScreenVerdict,
  variant?: string,
): void {
  const key = normaliseVerdictKey(listing.listingUrl, listing.address, variant);
  if (!key) return;
  const ttl = verdict.kind === "candidate"
    ? VERDICT_TTL_CANDIDATE_MS
    : verdict.kind === "rejected"
      ? VERDICT_TTL_REJECTED_MS
      : VERDICT_TTL_INDETERMINATE_MS;
  verdictCache.set(key, { verdict, expiresAt: Date.now() + ttl });
}

/** Test-only: wipe the verdict cache. */
export function clearScreenVerdictCache(): void {
  verdictCache.clear();
}

export type { PropertyCandidate, ScreenVerdict };

export function makeCacheKey(suburb: string, minPrice: number, maxPrice: number, streetHint?: string | null): string {
  const streetPart = streetHint?.trim()
    ? `-${streetHint.toLowerCase().replace(/[^a-z0-9]+/g, "")}`
    : "";
  return `${suburb.toLowerCase().trim()}-${minPrice}-${maxPrice}${streetPart}`;
}

export function getListingCache(key: string): CacheEntry | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry;
}

export function setListingCache(
  key: string,
  entry: Omit<CacheEntry, "expiresAt">,
): void {
  cache.set(key, { ...entry, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function popNextListings(key: string, count: number): { listings: ListingResult[]; remaining: number } {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return { listings: [], remaining: 0 };
  const listings = entry.remainingListings.splice(0, count);
  return { listings, remaining: entry.remainingListings.length };
}

export function markShown(key: string, urls: string[]): void {
  const entry = cache.get(key);
  if (!entry) return;
  for (const url of urls) {
    if (!entry.shownUrls.includes(url)) entry.shownUrls.push(url);
  }
}

export function getShownUrls(key: string): string[] {
  return cache.get(key)?.shownUrls ?? [];
}

export function getRemainingCount(key: string): number {
  const entry = getListingCache(key);
  return entry ? entry.remainingListings.length : 0;
}

export function restoreListingsAfterPop(
  key: string,
  putAtFront: ListingResult[],
  putAtBack: ListingResult[],
): void {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return;
  entry.remainingListings = [...putAtFront, ...entry.remainingListings, ...putAtBack];
}
