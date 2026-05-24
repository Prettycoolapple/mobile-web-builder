/// <reference lib="dom" />
/**
 * Trade Me Property photo scraper.
 *
 * Trade Me's search returns both active AND sold/archived residential listings
 * by default, which makes it a useful photo source for properties that have
 * been off-market for months/years (OneRoof and realestate.co.nz tend to favour
 * active listings only). Vercel-safe: uses ScrapingBee, no Playwright.
 *
 * Best-effort: returns empty `photo_urls` on any failure — never throws.
 */
import { logger } from "../logger";
import { fetchWithScrapingBee } from "./scrapingbee";

export interface TradeMePropertyData {
  photo_urls: string[];
  listing_url: string | null;
  data_source: "trademe";
  scraped_at: string;
}

export function emptyTradeMePropertyData(): TradeMePropertyData {
  return {
    photo_urls: [],
    listing_url: null,
    data_source: "trademe",
    scraped_at: new Date().toISOString(),
  };
}

function addressStreetSlug(address: string): string {
  return (address.split(",")[0] ?? address)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normaliseImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.includes(".svg")) return null;
  if (/logo|icon|placeholder|sprite|loading|missing/i.test(trimmed)) return null;
  try {
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return new URL(trimmed, "https://www.trademe.co.nz").toString();
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function isTradeMeImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith("trademe.co.nz") || host.includes("trademe") || host.includes("tmcdn");
  } catch {
    return false;
  }
}

function srcsetToImageUrls(srcset: string | null | undefined): string[] {
  if (!srcset) return [];
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function imageVariantScore(url: string): number {
  // Trade Me variants follow patterns like ".../12345_678_full.jpg" or "?w=900"
  const widthMatch = url.match(/(?:[?&]w=|_)(\d{3,4})(?:[._-]|$)/);
  const width = widthMatch ? Number(widthMatch[1]) : 0;
  const isFull = /\b(full|original|large|lrg)\b/i.test(url) ? 200 : 0;
  return width + isFull;
}

function dedupeImageVariants(urls: string[]): string[] {
  const bestByPath = new Map<string, string>();
  for (const url of urls) {
    let key = url;
    try {
      const parsed = new URL(url);
      // Strip image-size segments to dedupe variants of the same photo
      key = `${parsed.origin}${parsed.pathname.replace(/_\d{3,4}(?:[._-])/, "_")}`;
    } catch {
      // Keep as-is
    }
    const existing = bestByPath.get(key);
    if (!existing || imageVariantScore(url) > imageVariantScore(existing)) {
      bestByPath.set(key, url);
    }
  }
  return [...bestByPath.values()];
}

async function extractPhotosFromListingHtml(html: string): Promise<string[]> {
  const { load } = await import("cheerio");
  const $ = load(html);

  const raw: Array<string | null | undefined> = [];

  // og:image / twitter:image
  $('meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"], meta[property="twitter:image"]')
    .each((_, el) => {
      const v = $(el).attr("content");
      if (v) raw.push(v);
    });

  // <picture><source srcset="..."> and <img srcset="...">
  $("picture source[srcset], img[srcset]").each((_, el) => {
    const srcset = $(el).attr("srcset");
    for (const u of srcsetToImageUrls(srcset)) {
      raw.push(u);
    }
  });

  // <img src=...> filtered by Trade Me CDN hosts
  $("img[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && /trademe|tmcdn/i.test(src)) {
      raw.push(src);
    }
  });

  // Regex fallback — Trade Me's React bundle embeds image URLs in JSON
  // Look for trademe-property-images-prod or photoserver patterns
  const scriptMatches = html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*?trademe[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi);
  for (const m of scriptMatches) {
    raw.push(m[0].replace(/\\\//g, "/"));
  }

  const normalized = raw
    .map(normaliseImageUrl)
    .filter((u): u is string => !!u)
    .filter(isTradeMeImageHost);

  return dedupeImageVariants(normalized).slice(0, 12);
}

async function findFirstListingUrl(searchHtml: string): Promise<string | null> {
  const { load } = await import("cheerio");
  const $ = load(searchHtml);
  const link = $('a[href*="/a/property/residential/"], a[href*="/property/residential/"], a[href*="/a/property/lifestyle/"]')
    .first()
    .attr("href");
  if (!link) return null;
  if (link.startsWith("http")) return link;
  return new URL(link, "https://www.trademe.co.nz").toString();
}

async function viaDirectSearch(address: string): Promise<TradeMePropertyData | null> {
  const street = addressStreetSlug(address);
  if (!street) return null;
  const searchUrl = `https://www.trademe.co.nz/a/property/search?search_string=${encodeURIComponent(street)}`;
  const searchHtml = await fetchWithScrapingBee(searchUrl, { render_js: true, wait: 2500 });
  if (!searchHtml || searchHtml.length < 500) return null;

  const listingUrl = await findFirstListingUrl(searchHtml);
  if (!listingUrl) return null;

  const listingHtml = await fetchWithScrapingBee(listingUrl, { render_js: true, wait: 2000 });
  if (!listingHtml || listingHtml.length < 500) return null;

  const photos = await extractPhotosFromListingHtml(listingHtml);
  if (photos.length === 0) return null;
  return {
    photo_urls: photos,
    listing_url: listingUrl,
    data_source: "trademe",
    scraped_at: new Date().toISOString(),
  };
}

async function viaDuckDuckGo(address: string): Promise<TradeMePropertyData | null> {
  const street = (address.split(",")[0] ?? address).trim();
  const suburb = address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim();
  const query = suburb
    ? `site:trademe.co.nz/a/property "${street}" "${suburb}"`
    : `site:trademe.co.nz/a/property "${street}"`;
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    "accept-language": "en-NZ,en;q=0.9",
  };

  const searchHtml = await fetch(searchUrl, { headers }).then((r) => r.ok ? r.text() : "").catch(() => "");
  if (!searchHtml || searchHtml.length < 500) return null;

  // Extract first trademe.co.nz property link
  const { load } = await import("cheerio");
  const $ = load(searchHtml);
  let listingUrl: string | null = null;
  $('a[href*="trademe.co.nz/a/property"], a[href*="trademe.co.nz/property"]').each((_, el) => {
    if (listingUrl) return;
    let href = $(el).attr("href") ?? "";
    href = href.replace(/&amp;/g, "&");
    try {
      const parsed = new URL(href.startsWith("//") ? `https:${href}` : href);
      const encoded = parsed.searchParams.get("uddg");
      if (encoded) href = decodeURIComponent(encoded);
      const cleaned = new URL(href);
      if (cleaned.hostname.endsWith("trademe.co.nz") && cleaned.pathname.includes("/property/")) {
        listingUrl = cleaned.toString();
      }
    } catch {
      // ignore
    }
  });
  if (!listingUrl) return null;

  const listingHtml = await fetchWithScrapingBee(listingUrl, { render_js: true, wait: 2000 });
  if (!listingHtml || listingHtml.length < 500) return null;

  const photos = await extractPhotosFromListingHtml(listingHtml);
  if (photos.length === 0) return null;
  return {
    photo_urls: photos,
    listing_url: listingUrl,
    data_source: "trademe",
    scraped_at: new Date().toISOString(),
  };
}

export async function scrapeTradeMePropertyPhotos(address: string): Promise<TradeMePropertyData> {
  try {
    const direct = await viaDirectSearch(address);
    if (direct) {
      logger.info({ address, photoCount: direct.photo_urls.length, listing: direct.listing_url }, "TradeMe photos: direct search");
      return direct;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "TradeMe photos: direct search failed");
  }

  try {
    const ddg = await viaDuckDuckGo(address);
    if (ddg) {
      logger.info({ address, photoCount: ddg.photo_urls.length, listing: ddg.listing_url }, "TradeMe photos: DuckDuckGo fallback");
      return ddg;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "TradeMe photos: DuckDuckGo failed");
  }

  logger.debug({ address }, "TradeMe photos: no results");
  return emptyTradeMePropertyData();
}
