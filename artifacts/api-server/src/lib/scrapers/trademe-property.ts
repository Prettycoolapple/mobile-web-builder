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
  // Block non-photo assets: site chrome, brand images, street view
  if (/logo|icon|placeholder|sprite|loading|missing|avatar|agent|profile|streetview/i.test(trimmed)) return null;
  // Block site-level marketing / banner images that appear on error pages
  if (/banner|hero|promo|marketing|\bad[-_]|background|splash|brand|og-default|app-store|iphone|android|phone-mock/i.test(trimmed)) return null;
  // Block TradeMe site-level asset paths
  if (/trademe\.co\.nz\/(?:images|assets|content)\/(?!property|listing|photo)/i.test(trimmed)) return null;
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
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    // Accepted: Trade Me's primary image CDN subdomains
    if (host === "photos.trademe.co.nz" || host.startsWith("photos.trademe") || host.includes("tmcdn")) return true;
    // Accept photos served from the main domain only when path looks like property images
    if (host.endsWith("trademe.co.nz")) {
      return /\/(photos?|listing|property|image|media)\/|\.(jpg|jpeg|png|webp)(\?|$)/i.test(path);
    }
    // CDN pass-through — require path-level signal
    if (host.includes("trademe") || host.includes("tmcdn")) {
      return /\.(jpg|jpeg|png|webp)(\?|$)/i.test(path);
    }
    return false;
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

export async function extractTradeMePhotosFromListingHtml(html: string): Promise<string[]> {
  const { load } = await import("cheerio");
  const $ = load(html);

  const raw: Array<string | null | undefined> = [];

  // NOTE: og:image / twitter:image are intentionally NOT extracted here.
  // On a live property listing page the og:image IS a property photo, but it
  // is also present in the listing's img/srcset elements (no info lost by
  // skipping it). On a wrong/dead/error page (wrong address match, sold
  // listing redirect) the og:image is the TradeMe kiwi-bird site logo —
  // accepting that single URL would block the AI photo fallback and show the
  // logo as the carousel's main image. Property photos on TradeMe come from
  // their photo CDN and are reliably available in srcset and img[src] tags.

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

  const photos = await extractTradeMePhotosFromListingHtml(listingHtml);
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

  logger.debug({ address }, "TradeMe photos: no results");
  return emptyTradeMePropertyData();
}
