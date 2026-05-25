/// <reference lib="dom" />
/**
 * OneRoof photo scraper (separate from oneroof.ts to keep blast radius small —
 * the existing scrapeOneRoof() focuses on CV/last-sale/comparables and uses
 * Playwright/ScrapingBee paths that short-circuit as soon as ANY useful data
 * is found. For rural sold properties (e.g. 70 Screen Road, Coatesville) the
 * early paths often land on a snippet/estimate page that has CV but zero
 * photos, so the public-search fallback inside oneroof.ts never runs.
 *
 * This dedicated photo-only scraper always runs the public-search path in the
 * pipeline's photo-enrichment phase, in parallel with hougardenPhotos and
 * homesPhotos. It reuses the already-exported helpers from oneroof.ts.
 *
 * Vercel-safe: ScrapingBee for listing pages, plain fetch for DuckDuckGo.
 */
import { logger } from "../logger";
import { fetchWithScrapingBee } from "./scrapingbee";
import {
  extractOneRoofDataFromHtml,
  extractOneRoofPropertyUrlsFromSearchHtml,
} from "./oneroof";

export interface OneRoofPhotoData {
  photo_urls: string[];
  listing_url: string | null;
  data_source: "oneroof_photos";
  scraped_at: string;
}

export function emptyOneRoofPhotoData(): OneRoofPhotoData {
  return {
    photo_urls: [],
    listing_url: null,
    data_source: "oneroof_photos",
    scraped_at: new Date().toISOString(),
  };
}

const DDG_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
  "accept-language": "en-NZ,en;q=0.9",
};

async function fetchListingHtml(propertyUrl: string): Promise<string | null> {
  // ScrapingBee first — OneRoof's photo gallery is rendered client-side from
  // an embedded JSON blob, so render_js gives us the highest chance of
  // capturing all variants. Falls back to plain fetch if ScrapingBee is
  // unavailable (no API key, quota, etc.).
  const bee = await fetchWithScrapingBee(propertyUrl, { render_js: true, wait: 2500 }).catch(() => null);
  if (bee && bee.length >= 500) return bee;

  const plain = await fetch(propertyUrl, { headers: DDG_HEADERS })
    .then((r) => (r.ok ? r.text() : ""))
    .catch(() => "");
  return plain && plain.length >= 500 ? plain : null;
}

async function viaDuckDuckGo(address: string): Promise<OneRoofPhotoData | null> {
  const street = (address.split(",")[0] ?? address).trim();
  const suburb = address.split(",")[1]?.replace(/\b\d{4}\b/g, "").trim();

  // Two query variants — same shape as scrapeOneRoofViaPublicSearch in
  // oneroof.ts. The site-restricted query forces archived/sold pages to
  // surface even when DDG's default ranking favours active listings.
  const queries: string[] = [];
  queries.push(suburb ? `"${street}" "${suburb}" "OneRoof"` : `"${street}" "OneRoof"`);
  queries.push(suburb ? `site:oneroof.co.nz/property "${street}" "${suburb}"` : `site:oneroof.co.nz/property "${street}"`);

  for (const query of queries) {
    const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const searchHtml = await fetch(searchUrl, { headers: DDG_HEADERS })
      .then((r) => (r.ok ? r.text() : ""))
      .catch(() => "");
    if (!searchHtml || searchHtml.length < 500) continue;

    const candidates = extractOneRoofPropertyUrlsFromSearchHtml(searchHtml, address);
    for (const propertyUrl of candidates.slice(0, 3)) {
      const html = await fetchListingHtml(propertyUrl);
      if (!html) continue;

      const extracted = await extractOneRoofDataFromHtml(html, propertyUrl);
      if (extracted.photo_urls.length > 0) {
        return {
          photo_urls: extracted.photo_urls,
          listing_url: propertyUrl,
          data_source: "oneroof_photos",
          scraped_at: new Date().toISOString(),
        };
      }
    }
  }

  return null;
}

export async function scrapeOneRoofPhotos(address: string): Promise<OneRoofPhotoData> {
  try {
    const ddg = await viaDuckDuckGo(address);
    if (ddg) {
      logger.info(
        { address, photoCount: ddg.photo_urls.length, listing: ddg.listing_url },
        "OneRoof photos: DuckDuckGo",
      );
      return ddg;
    }
  } catch (err) {
    logger.debug({ err: String(err) }, "OneRoof photos: DDG failed");
  }

  logger.debug({ address }, "OneRoof photos: no results");
  return emptyOneRoofPhotoData();
}
