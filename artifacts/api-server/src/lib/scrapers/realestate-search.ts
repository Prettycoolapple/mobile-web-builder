import { logger } from "../logger";
import { fetchWithScrapingBee } from "./scrapingbee";
import type { ListingResult } from "./oneroof";

const SUBURB_SLUG_MAP: Record<string, { slug: string; district: string }> = {
  "remuera": { slug: "remuera", district: "auckland-city" },
  "epsom": { slug: "epsom", district: "auckland-city" },
  "mt eden": { slug: "mount-eden", district: "auckland-city" },
  "grey lynn": { slug: "grey-lynn", district: "auckland-city" },
  "ponsonby": { slug: "ponsonby", district: "auckland-city" },
  "parnell": { slug: "parnell", district: "auckland-city" },
  "herne bay": { slug: "herne-bay", district: "auckland-city" },
  "westmere": { slug: "westmere", district: "auckland-city" },
  "kingsland": { slug: "kingsland", district: "auckland-city" },
  "sandringham": { slug: "sandringham", district: "auckland-city" },
  "mt albert": { slug: "mount-albert", district: "albert-eden" },
  "mt roskill": { slug: "mount-roskill", district: "albert-eden" },
  "onehunga": { slug: "onehunga", district: "maungakiekie-tamaki" },
  "new lynn": { slug: "new-lynn", district: "henderson-massey" },
  "titirangi": { slug: "titirangi", district: "henderson-massey" },
  "avondale": { slug: "avondale", district: "albert-eden" },
  "st heliers": { slug: "st-heliers", district: "orakei" },
  "kohimarama": { slug: "kohimarama", district: "orakei" },
  "mission bay": { slug: "mission-bay", district: "orakei" },
  "glendowie": { slug: "glendowie", district: "orakei" },
  "meadowbank": { slug: "meadowbank", district: "orakei" },
  "howick": { slug: "howick", district: "howick" },
  "pakuranga": { slug: "pakuranga", district: "howick" },
  "botany": { slug: "botany-downs", district: "howick" },
  "east tamaki": { slug: "east-tamaki", district: "howick" },
  "henderson": { slug: "henderson", district: "henderson-massey" },
  "albany": { slug: "albany", district: "upper-harbour" },
  "takapuna": { slug: "takapuna", district: "devonport-takapuna" },
  "devonport": { slug: "devonport", district: "devonport-takapuna" },
  "northcote": { slug: "northcote", district: "kaipatiki" },
  "glenfield": { slug: "glenfield", district: "kaipatiki" },
  "milford": { slug: "milford", district: "devonport-takapuna" },
  "browns bay": { slug: "browns-bay", district: "hibiscus-and-bays" },
  "glen innes": { slug: "glen-innes", district: "orakei" },
  "penrose": { slug: "penrose", district: "maungakiekie-tamaki" },
  "ellerslie": { slug: "ellerslie", district: "orakei" },
  "mangere": { slug: "mangere", district: "manurewa-papakura" },
  "birkenhead": { slug: "birkenhead", district: "kaipatiki" },
  "massey": { slug: "massey", district: "henderson-massey" },
  "royal oak": { slug: "royal-oak", district: "maungakiekie-tamaki" },
  "mt wellington": { slug: "mount-wellington", district: "maungakiekie-tamaki" },
  "manurewa": { slug: "manurewa", district: "manurewa-papakura" },
  "papatoetoe": { slug: "papatoetoe", district: "manurewa-papakura" },
  "papakura": { slug: "papakura", district: "manurewa-papakura" },
  "glen eden": { slug: "glen-eden", district: "henderson-massey" },
  "st johns": { slug: "saint-johns", district: "orakei" },
  "otahuhu": { slug: "otahuhu", district: "maungakiekie-tamaki" },
  "panmure": { slug: "panmure", district: "maungakiekie-tamaki" },
};

function suburbToUrl(suburb: string, minPrice?: number, maxPrice?: number): string | null {
  const key = suburb.toLowerCase().trim();
  const mapped = SUBURB_SLUG_MAP[key];
  if (!mapped) return null;

  const paramObj: Record<string, string> = { sort: "recent" };
  if (minPrice != null && minPrice > 0) paramObj["priceMin"] = String(minPrice);
  if (maxPrice != null && maxPrice > 0) paramObj["priceMax"] = String(maxPrice);

  const params = new URLSearchParams(paramObj);
  return `https://www.realestate.co.nz/residential/sale/auckland/${mapped.district}/${mapped.slug}?${params}`;
}

function parseAddressFromOgTitle(title: string): string | null {
  const m = title.match(/^([^-]+)/);
  if (!m) return null;
  const raw = m[1].trim().replace(/,\s*Auckland City$/, "").replace(/,\s*Auckland$/, "").trim();
  if (raw.length < 5) return null;
  return raw;
}

function parseLandAreaFromOgDesc(desc: string): number | null {
  const m = desc.match(/(\d{3,5})m²/i) || desc.match(/(\d{3,5})\s*sqm/i) || desc.match(/land area[^\d]*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return isNaN(n) || n < 50 || n > 50000 ? null : n;
}

function parsePriceFromOgDesc(desc: string): number | null {
  const m = desc.match(/\$([0-9,]+(?:\.[0-9]+)?)\s*(?:m|million|k)?/i);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ""));
  const suffix = m[0].toLowerCase();
  if (suffix.includes("million") || suffix.endsWith("m")) v *= 1_000_000;
  else if (suffix.endsWith("k")) v *= 1_000;
  else if (v < 100) v *= 1_000_000;
  return v > 50000 ? Math.round(v) : null;
}

function parseAddressFromSlug(slug: string): string {
  const parts = slug.replace(/^\/?\d+\/residential\/sale\//, "").split("/")[0];
  const words = parts.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ").replace(/\b(\d+)\s+([A-Z])/g, "$1 $2");
}

async function fetchListingMeta(url: string, fallbackAddress: string, priceMidpoint: number): Promise<ListingResult | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-NZ,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      logger.debug({ url, status: resp.status }, "realestate-search: listing page non-200");
      return null;
    }

    const html = await resp.text();

    const decodeHtml = (s: string) =>
      s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const ogTitle = decodeHtml(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "");
    const ogDesc = decodeHtml(html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? "");
    const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;

    const address = parseAddressFromOgTitle(ogTitle) ?? fallbackAddress;
    const landArea = parseLandAreaFromOgDesc(ogDesc);
    const explicitPrice = parsePriceFromOgDesc(ogDesc);
    const price = explicitPrice ?? priceMidpoint;

    if (!address || address.length < 5) return null;

    return {
      address,
      price,
      priceText: explicitPrice ? `$${explicitPrice.toLocaleString()}` : "Price on application",
      landArea,
      photoUrl: ogImage,
      listingUrl: url,
      zone: null,
    };
  } catch (err) {
    logger.debug({ url, err: (err as Error).message }, "realestate-search: failed to fetch listing meta");
    return null;
  }
}

export async function fetchListingBatch(
  urls: string[],
  priceMidpoint: number,
): Promise<ListingResult[]> {
  const results = await Promise.all(
    urls.map((url) => fetchListingMeta(url, parseAddressFromSlug(url), priceMidpoint)),
  );
  return results.filter((r): r is ListingResult => r !== null);
}

// Common suburb name aliases (short form ↔ full form)
const SUBURB_SLUG_ALIASES: Record<string, string[]> = {
  "st-heliers": ["saint-heliers", "st-heliers"],
  "saint-heliers": ["saint-heliers", "st-heliers"],
  "st-johns": ["saint-johns", "st-johns"],
  "saint-johns": ["saint-johns", "st-johns"],
  "mt-eden": ["mount-eden", "mt-eden"],
  "mount-eden": ["mount-eden", "mt-eden"],
  "mt-albert": ["mount-albert", "mt-albert"],
  "mount-albert": ["mount-albert", "mt-albert"],
  "mt-roskill": ["mount-roskill", "mt-roskill"],
  "mount-roskill": ["mount-roskill", "mt-roskill"],
  "mt-wellington": ["mount-wellington", "mt-wellington"],
  "mount-wellington": ["mount-wellington", "mt-wellington"],
};

function urlMatchesSuburb(urlPath: string, suburbSlug: string): boolean {
  const slugPart = urlPath.replace(/^\/\d+\/residential\/sale\//, "").toLowerCase();
  const aliases = SUBURB_SLUG_ALIASES[suburbSlug] ?? [suburbSlug];
  return aliases.some((alias) => slugPart.includes(alias));
}

export interface RealestateSearchResult {
  firstBatch: ListingResult[];
  remainingListings: ListingResult[];
  totalFound: number;
  source: "realestate.co.nz";
}

function extractListingUrlsFromHtml(
  html: string,
  suburbMeta: { slug: string; district: string } | undefined,
  skipUrls: string[],
  seen: Set<string>,
): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/href="(\/\d+\/residential\/sale\/[^"?#]+)"/g)) {
    const fullUrl = `https://www.realestate.co.nz${m[1]}`;
    if (!seen.has(fullUrl) && !skipUrls.includes(fullUrl) && (!suburbMeta || urlMatchesSuburb(m[1], suburbMeta.slug))) {
      seen.add(fullUrl);
      urls.push(fullUrl);
    }
  }
  return urls;
}

async function fetchListingUrlsFromPage(
  searchUrl: string,
  suburbMeta: { slug: string; district: string } | undefined,
  skipUrls: string[],
  seen: Set<string>,
): Promise<string[]> {
  // realestate.co.nz is a JavaScript-rendered Ember.js SPA.
  // Plain HTML fetch returns only generic Auckland listings (no suburb filtering).
  // Use ScrapingBee with JS rendering so the app executes and returns suburb-specific results.
  const beeHtml = await fetchWithScrapingBee(searchUrl, { render_js: true, premium_proxy: false, wait: 4000 }).catch(() => null);

  if (beeHtml) {
    const urls = extractListingUrlsFromHtml(beeHtml, suburbMeta, skipUrls, seen);
    logger.info({ searchUrl, count: urls.length }, "realestate-search: ScrapingBee extracted listing URLs");
    if (urls.length > 0) return urls;
    // If ScrapingBee returned HTML but 0 suburb-matched URLs, also try without the suburb filter
    // (in case the rendered page uses different URL structure) — pick any listings from the page
    const allUrls: string[] = [];
    for (const m of beeHtml.matchAll(/href="(\/\d+\/residential\/sale\/[^"?#]+)"/g)) {
      const fullUrl = `https://www.realestate.co.nz${m[1]}`;
      if (!seen.has(fullUrl) && !skipUrls.includes(fullUrl)) {
        seen.add(fullUrl);
        allUrls.push(fullUrl);
      }
    }
    if (allUrls.length > 0) {
      logger.info({ searchUrl, count: allUrls.length }, "realestate-search: ScrapingBee extracted unfiltered listing URLs");
      return allUrls;
    }
  }

  // Fallback: plain fetch (may return generic listings, but still useful)
  logger.info({ searchUrl }, "realestate-search: ScrapingBee unavailable, falling back to plain fetch");
  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-NZ,en;q=0.9",
        "Referer": "https://www.realestate.co.nz/",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, searchUrl }, "realestate-search: search page returned non-200");
      return [];
    }

    const html = await resp.text();
    return extractListingUrlsFromHtml(html, suburbMeta, skipUrls, seen);
  } catch (err) {
    logger.warn({ err: (err as Error).message, searchUrl }, "realestate-search: plain fetch also failed");
    return [];
  }
}

export async function searchRealEstateListings(params: {
  suburb: string;
  minPrice: number;
  maxPrice: number;
  skipUrls?: string[];
  firstBatchSize?: number;
  includeNegotiation?: boolean;
}): Promise<RealestateSearchResult> {
  const { suburb, minPrice, maxPrice, skipUrls = [], firstBatchSize = 6, includeNegotiation = false } = params;
  const priceMidpoint = Math.round((minPrice + maxPrice) / 2);
  const suburbKey = suburb.toLowerCase().trim();
  const suburbMeta = SUBURB_SLUG_MAP[suburbKey];

  const searchUrl = suburbToUrl(suburb, minPrice, maxPrice);
  if (!searchUrl) {
    logger.debug({ suburb }, "realestate-search: suburb not in slug map");
    return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz" };
  }

  logger.info({ suburb, searchUrl, includeNegotiation }, "realestate-search: fetching search results page");

  const seen = new Set<string>();
  let allListingUrls: string[] = [];

  try {
    // Primary search: with price filters
    const primaryUrls = await fetchListingUrlsFromPage(searchUrl, suburbMeta, skipUrls, seen);
    allListingUrls.push(...primaryUrls);
    logger.info({ suburb, count: primaryUrls.length }, "realestate-search: extracted listing URLs (price-filtered)");

    // Secondary search: no price filters, to catch negotiation/POA listings
    if (includeNegotiation) {
      const noPriceUrl = suburbToUrl(suburb);
      if (noPriceUrl) {
        const noPriceUrls = await fetchListingUrlsFromPage(noPriceUrl, suburbMeta, skipUrls, seen).catch(() => []);
        allListingUrls.push(...noPriceUrls);
        logger.info({ suburb, count: noPriceUrls.length }, "realestate-search: extracted listing URLs (no-price/negotiation)");
      }
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-search: failed to fetch search page");
    if (allListingUrls.length === 0) {
      return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz" };
    }
  }

  if (allListingUrls.length === 0) {
    return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz" };
  }

  logger.info({ total: allListingUrls.length }, "realestate-search: fetching all listing meta pages");

  const allResults = await Promise.all(
    allListingUrls.map((url) => fetchListingMeta(url, parseAddressFromSlug(url), priceMidpoint)),
  );

  const allListings = allResults.filter((r): r is ListingResult => r !== null);
  logger.info({ suburb, fetched: allListings.length, total: allListingUrls.length }, "realestate-search: done");

  return {
    firstBatch: allListings.slice(0, firstBatchSize),
    remainingListings: allListings.slice(firstBatchSize),
    totalFound: allListingUrls.length,
    source: "realestate.co.nz",
  };
}
