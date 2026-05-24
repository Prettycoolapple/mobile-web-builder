/// <reference lib="dom" />
/**
 * Homes.co.nz photo scraper (separate from homes.ts to keep blast radius small
 * — the existing scrapeHomes focuses on CV/zone/build-year and we don't want
 * to introduce regressions in that path).
 *
 * Vercel-safe: uses ScrapingBee for listing pages.
 */
import { logger } from "../logger";
import { fetchWithScrapingBee } from "./scrapingbee";

export interface HomesPhotoData {
  photo_urls: string[];
  listing_url: string | null;
  data_source: "homes_photos";
  scraped_at: string;
}

export function emptyHomesPhotoData(): HomesPhotoData {
  return {
    photo_urls: [],
    listing_url: null,
    data_source: "homes_photos",
    scraped_at: new Date().toISOString(),
  };
}

function normaliseImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.includes(".svg")) return null;
  if (/logo|icon|placeholder|sprite|loading|missing|avatar|streetview/i.test(trimmed)) return null;
  try {
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return new URL(trimmed, "https://homes.co.nz").toString();
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function isHomesImageHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.endsWith("homes.co.nz") ||
      host.includes("homes-images") ||
      host.includes("homescdn") ||
      host.endsWith("cloudfront.net") || // homes uses CloudFront
      host.endsWith("amazonaws.com")
    );
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

  $('[data-test="photo-strip-image"], [data-testid*="photo"]').each((_, el) => {
    const a = $(el).attr("src");
    const b = $(el).attr("data-src");
    if (a) raw.push(a);
    if (b) raw.push(b);
  });

  $("img[src], img[data-src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src && /homes|cloudfront|amazonaws/i.test(src)) {
      raw.push(src);
    }
    const dataSrc = $(el).attr("data-src");
    if (dataSrc && /homes|cloudfront|amazonaws/i.test(dataSrc)) {
      raw.push(dataSrc);
    }
  });

  // Script-tag regex fallback
  const matches = html.matchAll(/https?:\\?\/\\?\/[^"'\s<>]*?(?:homes|homes-images|homescdn|cloudfront|amazonaws)[^"'\s<>]*?\.(?:jpg|jpeg|png|webp)[^"'\s<>]*/gi);
  for (const m of matches) raw.push(m[0].replace(/\\\//g, "/"));

  const normalized = raw
    .map(normaliseImageUrl)
    .filter((u): u is string => !!u)
    .filter(isHomesImageHost);

  // Dedupe by pathname stem
  const seen = new Map<string, string>();
  for (const u of normalized) {
    try {
      const parsed = new URL(u);
      const key = parsed.pathname.replace(/[-_](?:thumb|small|medium|large|xl|\d{2,4}x\d{2,4})(?=\.[a-z]+$)/i, "");
      if (!seen.has(key)) seen.set(key, u);
    } catch {
      seen.set(u, u);
    }
  }
  return [...seen.values()].slice(0, 12);
}

function buildAddressSlugVariants(address: string): string[] {
  const parts = address.split(",").map((p) => p.replace(/\b\d{4}\b/g, "").trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const variants: string[] = [];
  if (parts.length >= 2) {
    // homes uses /address/auckland/{suburb}/{street-with-number}
    const street = slugify(parts[0]);
    const suburb = slugify(parts[1]);
    variants.push(`https://homes.co.nz/address/auckland/${suburb}/${street}`);
    variants.push(`https://homes.co.nz/address/${slugify(parts[parts.length - 1] || "auckland")}/${suburb}/${street}`);
  }
  return variants;
}

async function viaDirectUrls(address: string): Promise<HomesPhotoData | null> {
  for (const url of buildAddressSlugVariants(address).slice(0, 2)) {
    const html = await fetchWithScrapingBee(url, { render_js: true, wait: 2500 });
    if (!html || html.length < 500) continue;
    const photos = await extractPhotosFromHtml(html);
    if (photos.length > 0) {
      return {
        photo_urls: photos,
        listing_url: url,
        data_source: "homes_photos",
        scraped_at: new Date().toISOString(),
      };
    }
  }
  return null;
}

async function viaDuckDuckGo(address: string): Promise<HomesPhotoData | null> {
  const street = (address.split(",")[0] ?? address).trim();
  const suburb = address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim();
  const query = suburb
    ? `site:homes.co.nz "${street}" "${suburb}"`
    : `site:homes.co.nz "${street}"`;
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const headers = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
    "accept-language": "en-NZ,en;q=0.9",
  };
  const searchHtml = await fetch(searchUrl, { headers }).then((r) => r.ok ? r.text() : "").catch(() => "");
  if (!searchHtml || searchHtml.length < 500) return null;

  const { load } = await import("cheerio");
  const $ = load(searchHtml);
  let listingUrl: string | null = null;
  $('a[href*="homes.co.nz"]').each((_, el) => {
    if (listingUrl) return;
    let href = $(el).attr("href") ?? "";
    href = href.replace(/&amp;/g, "&");
    try {
      const parsed = new URL(href.startsWith("//") ? `https:${href}` : href);
      const encoded = parsed.searchParams.get("uddg");
      if (encoded) href = decodeURIComponent(encoded);
      const cleaned = new URL(href);
      if (cleaned.hostname.endsWith("homes.co.nz") && cleaned.pathname.includes("/address/")) {
        listingUrl = cleaned.toString();
      }
    } catch {
      // ignore
    }
  });
  if (!listingUrl) return null;

  const html = await fetchWithScrapingBee(listingUrl, { render_js: true, wait: 2500 });
  if (!html || html.length < 500) return null;

  const photos = await extractPhotosFromHtml(html);
  if (photos.length === 0) return null;
  return {
    photo_urls: photos,
    listing_url: listingUrl,
    data_source: "homes_photos",
    scraped_at: new Date().toISOString(),
  };
}

export async function scrapeHomesPhotos(address: string): Promise<HomesPhotoData> {
  try {
    const direct = await viaDirectUrls(address);
    if (direct) {
      logger.info({ address, photoCount: direct.photo_urls.length, listing: direct.listing_url }, "Homes photos: direct URL");
      return direct;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "Homes photos: direct URL failed");
  }

  try {
    const ddg = await viaDuckDuckGo(address);
    if (ddg) {
      logger.info({ address, photoCount: ddg.photo_urls.length, listing: ddg.listing_url }, "Homes photos: DuckDuckGo fallback");
      return ddg;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "Homes photos: DuckDuckGo failed");
  }

  logger.debug({ address }, "Homes photos: no results");
  return emptyHomesPhotoData();
}
