/// <reference lib="dom" />
/**
 * Hougarden photo scraper (separate from hougarden.ts to keep blast radius
 * small — the existing scrapeHougarden focuses on CV/zone/build-year and we
 * don't want to introduce regressions in that path).
 *
 * Hougarden is a Chinese-targeted NZ real-estate portal — useful for our
 * bilingual user base and often retains sold listings longer than competitors.
 *
 * Vercel-safe: ScrapingBee for listing pages.
 */
import { logger } from "../logger";
import { addressLineAppearsInText } from "./realestate-api";
import { fetchWithScrapingBee } from "./scrapingbee";

export interface HougardenPhotoData {
  photo_urls: string[];
  listing_url: string | null;
  data_source: "hougarden_photos";
  scraped_at: string;
}

export function emptyHougardenPhotoData(): HougardenPhotoData {
  return {
    photo_urls: [],
    listing_url: null,
    data_source: "hougarden_photos",
    scraped_at: new Date().toISOString(),
  };
}

function normaliseImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.includes(".svg")) return null;
  if (/logo|icon|placeholder|sprite|loading|missing|avatar/i.test(trimmed)) return null;
  try {
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return new URL(trimmed, "https://www.hougarden.com").toString();
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function isHougardenImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.endsWith("hougarden.com") || host.includes("hougarden") || host.includes("aliyuncs") || host.includes("hgimg");
  } catch {
    return false;
  }
}

async function extractPhotosFromHtml(html: string): Promise<string[]> {
  const { load } = await import("cheerio");
  const $ = load(html);

  const raw: Array<string | null | undefined> = [];

  $('meta[property="og:image"], meta[property="twitter:image"], meta[name="twitter:image"]')
    .each((_, el) => {
      const v = $(el).attr("content");
      if (v) raw.push(v);
    });

  $("img[src], img[data-src], img[data-original]").each((_, el) => {
    const a = $(el).attr("src");
    const b = $(el).attr("data-src");
    const c = $(el).attr("data-original");
    if (a) raw.push(a);
    if (b) raw.push(b);
    if (c) raw.push(c);
  });

  // Hougarden embeds photo URLs in script JSON blobs — regex fallback
  const matches = html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*?(?:hougarden|hgimg|aliyuncs)[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi);
  for (const m of matches) raw.push(m[0].replace(/\\\//g, "/"));

  const normalized = raw
    .map(normaliseImageUrl)
    .filter((u): u is string => !!u)
    .filter(isHougardenImageHost);

  // Dedupe by pathname (Hougarden serves multiple sizes of the same image)
  const seen = new Map<string, string>();
  for (const u of normalized) {
    try {
      const parsed = new URL(u);
      const key = parsed.pathname.replace(/_(s|m|l|xl|[0-9]{2,4}x[0-9]{2,4})(?=\.[a-z]+$)/i, "");
      if (!seen.has(key)) seen.set(key, u);
    } catch {
      seen.set(u, u);
    }
  }
  return [...seen.values()].slice(0, 12);
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function viaDirectSearch(address: string): Promise<HougardenPhotoData | null> {
  const street = (address.split(",")[0] ?? address).trim();
  const searchUrl = `https://www.hougarden.com/search/sold?keywords=${encodeURIComponent(street)}`;
  const searchHtml = await fetchWithScrapingBee(searchUrl, { render_js: true, wait: 2500 });
  if (!searchHtml || searchHtml.length < 500) return null;

  const { load } = await import("cheerio");
  const $ = load(searchHtml);
  const link = $('a[href*="/property/"], a[href*="/sold/"], a[href*="/listing/"]').first().attr("href");
  if (!link) return null;
  const listingUrl = link.startsWith("http") ? link : new URL(link, "https://www.hougarden.com").toString();

  const listingHtml = await fetchWithScrapingBee(listingUrl, { render_js: true, wait: 2000 });
  if (!listingHtml || listingHtml.length < 500) return null;
  if (!addressLineAppearsInText(address, stripHtmlToText(listingHtml))) {
    logger.info({ address, listingUrl }, "Hougarden photos: rejected page without exact address text");
    return null;
  }

  const photos = await extractPhotosFromHtml(listingHtml);
  if (photos.length === 0) return null;
  return {
    photo_urls: photos,
    listing_url: listingUrl,
    data_source: "hougarden_photos",
    scraped_at: new Date().toISOString(),
  };
}

export async function scrapeHougardenPhotos(address: string): Promise<HougardenPhotoData> {
  try {
    const direct = await viaDirectSearch(address);
    if (direct) {
      logger.info({ address, photoCount: direct.photo_urls.length, listing: direct.listing_url }, "Hougarden photos: direct search");
      return direct;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "Hougarden photos: direct search failed");
  }

  logger.debug({ address }, "Hougarden photos: no results");
  return emptyHougardenPhotoData();
}
