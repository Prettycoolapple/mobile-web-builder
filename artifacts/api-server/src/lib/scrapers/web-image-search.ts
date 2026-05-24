/// <reference lib="dom" />
/**
 * Fallback photo finder using DuckDuckGo image search.
 *
 * When all site-specific scrapers (OneRoof, realestate.co.nz, Trade Me,
 * Hougarden, Homes) return zero photos, this fallback queries DuckDuckGo's
 * image search for the address restricted to known NZ real-estate CDN hosts.
 * Search engines have already crawled and indexed listing photos from these
 * sites — this lets us recover photos for archived/sold listings that don't
 * surface via direct site scraping.
 *
 * Vercel-safe: plain fetch, no browser.
 *
 * Returns up to 10 deduped image URLs. Returns empty array on any failure —
 * never throws. The pipeline can fall back to Google Street View if this
 * also returns nothing.
 */
import { logger } from "../logger";

const IMAGE_HOST_WHITELIST = [
  "oneroof.co.nz",
  "realestate.co.nz",
  "trademe.co.nz",
  "tmcdn.co.nz",
  "homes.co.nz",
  "hougarden.com",
  "qv.co.nz",
  "amazonaws.com",
  "cloudfront.net",
  "akamaized.net",
  "akamaihd.net",
  "fastly.net",
  "googleusercontent.com",
];

function isWhitelistedImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return IMAGE_HOST_WHITELIST.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

function isImageExtension(url: string): boolean {
  return /\.(?:jpg|jpeg|png|webp)(?:\?|$|#)/i.test(url);
}

async function ddgImageSearchVqd(query: string): Promise<string | null> {
  // DuckDuckGo image-search requires a one-shot "vqd" token from an initial
  // request before image results can be fetched. Plain HTML scrape.
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`;
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    "accept-language": "en-NZ,en;q=0.9",
  };
  const html = await fetch(url, { headers }).then((r) => r.ok ? r.text() : "").catch(() => "");
  if (!html) return null;
  const m = html.match(/vqd=['"]?(\d-[\d-]+)['"]?/) ?? html.match(/vqd=([\d-]+)/);
  return m ? m[1] : null;
}

async function ddgImageSearchResults(query: string, vqd: string): Promise<string[]> {
  const url = `https://duckduckgo.com/i.js?l=nz-en&o=json&q=${encodeURIComponent(query)}&vqd=${encodeURIComponent(vqd)}&f=,,,&p=1`;
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    "accept": "application/json",
    "referer": "https://duckduckgo.com/",
  };
  const resp = await fetch(url, { headers }).catch(() => null);
  if (!resp || !resp.ok) return [];
  const data = await resp.json().catch(() => null) as { results?: Array<{ image?: string; thumbnail?: string }> } | null;
  if (!data?.results) return [];
  const urls: string[] = [];
  for (const r of data.results) {
    if (r.image) urls.push(r.image);
    if (r.thumbnail) urls.push(r.thumbnail);
  }
  return urls;
}

function dedupeByPathStem(urls: string[]): string[] {
  const seen = new Map<string, string>();
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      const key = `${parsed.hostname}${parsed.pathname.replace(/[-_](?:s|m|l|xl|thumb|small|medium|large|\d{2,4}x\d{2,4})(?=\.[a-z]+$)/i, "")}`;
      if (!seen.has(key)) seen.set(key, u);
    } catch {
      seen.set(u, u);
    }
  }
  return [...seen.values()];
}

/**
 * Search 2-3 query variations against DuckDuckGo image search and collect
 * URLs hosted on real-estate CDNs.
 */
export async function findPropertyPhotosViaWebSearch(address: string): Promise<string[]> {
  const street = (address.split(",")[0] ?? address).trim();
  const suburb = address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim();

  if (!street) return [];

  const queries: string[] = [];
  if (suburb) {
    queries.push(`"${street}" ${suburb} site:oneroof.co.nz`);
    queries.push(`"${street}" ${suburb} site:trademe.co.nz`);
    queries.push(`"${street}" ${suburb} (oneroof OR trademe OR realestate OR homes OR hougarden)`);
  } else {
    queries.push(`"${street}" New Zealand property listing`);
  }

  const allUrls: string[] = [];
  for (const query of queries.slice(0, 3)) {
    try {
      const vqd = await ddgImageSearchVqd(query);
      if (!vqd) continue;
      const results = await ddgImageSearchResults(query, vqd);
      allUrls.push(...results);
      // Small delay between queries to avoid hammering DDG
      await new Promise((r) => setTimeout(r, 800));
      if (allUrls.length >= 30) break;
    } catch (err) {
      logger.debug({ err: String(err), query }, "WebImageSearch: query failed");
    }
  }

  const filtered = allUrls
    .filter(isImageExtension)
    .filter(isWhitelistedImageHost);

  const deduped = dedupeByPathStem(filtered).slice(0, 10);
  logger.info({ address, found: deduped.length, raw: allUrls.length }, "WebImageSearch: complete");
  return deduped;
}

/**
 * Top-level fallback entrypoint. Returns up to 10 photo URLs hosted on
 * real-estate CDNs that match the address via DuckDuckGo image indexing.
 * Honours the DISABLE_AI_PHOTO_FALLBACK env-var kill switch.
 */
export async function findPropertyPhotosWithFallback(address: string): Promise<string[]> {
  if (process.env["DISABLE_AI_PHOTO_FALLBACK"] === "1") {
    logger.info({ address }, "WebImageSearch: skipped (DISABLE_AI_PHOTO_FALLBACK=1)");
    return [];
  }

  const TIMEOUT_MS = 25_000;
  try {
    return await Promise.race([
      findPropertyPhotosViaWebSearch(address),
      new Promise<string[]>((_, reject) => setTimeout(() => reject(new Error("WebImageSearch timeout")), TIMEOUT_MS)),
    ]);
  } catch (err) {
    logger.warn({ err: String(err), address }, "WebImageSearch: fallback failed");
    return [];
  }
}
