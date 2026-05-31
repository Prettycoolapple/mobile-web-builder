/// <reference lib="dom" />
/**
 * Homes.co.nz photo scraper (separate from homes.ts to keep blast radius small
 * — the existing scrapeHomes focuses on CV/zone/build-year and we don't want
 * to introduce regressions in that path).
 *
 * Vercel-safe: uses ScrapingBee for listing pages.
 */
import { logger } from "../logger";
import { addressLineAppearsInText } from "./realestate-api";
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
  // Block non-photo assets: site chrome, marketing images, street view
  if (/logo|icon|placeholder|sprite|loading|missing|avatar|agent|profile|streetview/i.test(trimmed)) return null;
  // Block banner/hero/marketing images that show up on homes.co.nz og:image / site-wide assets
  if (/banner|hero|promo|marketing|\bad[-_]|\/home[-_/]|\/general[-_/]|background|splash|brand|site-image|og-default|app-store|iphone|android|phone-mock|consumer/i.test(trimmed)) return null;
  // Block homes.co.nz site-level asset paths (not property CDN paths)
  if (/homes\.co\.nz\/images\/(?!property|listing|photo)/i.test(trimmed)) return null;
  if (/homes\.co\.nz\/assets\//i.test(trimmed)) return null;
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
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    // Direct homes.co.nz subdomains
    if (host.endsWith("homes.co.nz")) return true;
    if (host.includes("homes-images") || host.includes("homescdn")) return true;
    // CloudFront/S3 — only accept if the URL path looks like a property image
    // (not a site-wide asset or marketing banner). homes.co.nz CDN property
    // images have paths under /photos/, /listing/, /property/, /images/property/,
    // or are bare UUID/hash image filenames with a known extension.
    if (host.endsWith("cloudfront.net") || host.endsWith("amazonaws.com")) {
      return /\/(photos?|listing|property|image)\//i.test(path);
    }
    return false;
  } catch {
    return false;
  }
}

export async function extractHomesPhotosFromHtml(html: string): Promise<string[]> {
  const { load } = await import("cheerio");
  const $ = load(html);

  const raw: Array<string | null | undefined> = [];

  // NOTE: og:image / twitter:image are intentionally NOT extracted here —
  // on homes.co.nz those meta tags always contain the site-level branding
  // banner ("Free property information…"), not the individual property's
  // listing photos. Property images come from the photo-strip and script blobs.

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
    if (!addressLineAppearsInText(address, stripHtmlToText(html))) {
      logger.info({ address, url }, "Homes photos: rejected page without exact address text");
      continue;
    }
    const photos = await extractHomesPhotosFromHtml(html);
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

  logger.debug({ address }, "Homes photos: no results");
  return emptyHomesPhotoData();
}
