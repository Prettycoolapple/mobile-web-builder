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

export function makeCacheKey(suburb: string, minPrice: number, maxPrice: number): string {
  return `${suburb.toLowerCase().trim()}-${minPrice}-${maxPrice}`;
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
