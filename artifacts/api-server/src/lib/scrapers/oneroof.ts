/// <reference lib="dom" />
import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay, logScrapeAttempt } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";

export interface ListingResult {
  address: string;
  price: number | null;
  priceText: string;
  landArea: number | null;
  /** Floor (dwelling) area in m². Sourced opportunistically from og:description; null when not advertised. */
  floorArea?: number | null;
  photoUrl: string | null;
  /** All available high-res photo URLs for this listing (up to 4). */
  photoUrls?: string[];
  listingUrl: string;
  zone: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  /**
   * True when two listing-source readings of bedroom count for the same
   * listing disagreed (e.g. realestate.co.nz structured API says 4 but the
   * og:description says 3). Surfaced to the UI so we can flag the value as
   * approximate ("~3 bd") instead of silently picking one.
   */
  bedroomsApprox?: boolean;
  bathroomsApprox?: boolean;
  /**
   * True when listing sources disagree on land area (>5% AND >10 m² apart)
   * or numeric price (>5% apart). Same intent as bedroomsApprox: lets the
   * UI render "~503 m²" / "~$1.25M" instead of silently picking one source.
   */
  landAreaApprox?: boolean;
  priceApprox?: boolean;
  floorAreaApprox?: boolean;
}

// Implementation lives in the dependency-free `bed-bath-extractor` module so
// the standalone verification suite can import it without pulling in
// Playwright/cheerio. Imported locally and re-exported for callers
// (realestate-search.ts, this file's own scraping helpers below).
import { extractBedsBaths } from "./bed-bath-extractor";
export { extractBedsBaths };

// parseNZDollar / parseArea / parseYear live in the dependency-free
// `scraper-parsers` module so they can be unit-tested without pulling in
// Playwright/cheerio. See `__tests__/scraper-parsers.test.ts` for fixtures.
import { parseNZDollar, parseArea, parseYear, extractBuildYearFromListingText } from "./scraper-parsers";

async function searchOneRoofPlaywright(params: {
  suburb: string;
  price_min: number;
  price_max: number;
}): Promise<ListingResult[]> {
  const suburbSlug = params.suburb.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const url = `https://www.oneroof.co.nz/find/buy?suburb=${encodeURIComponent(suburbSlug)}&priceMin=${params.price_min}&priceMax=${params.price_max}&propertyType=residential`;

  let browser;
  const results: ListingResult[] = [];

  try {
    browser = await launchBrowser();
    const { context, page } = await newStealthPage(browser);

    await page.goto(url, { timeout: 18000, waitUntil: "domcontentloaded" });
    await randomDelay(2000, 3500);
    await page.evaluate(() => window.scrollBy(0, 600));
    await randomDelay(800, 1400);

    const cards = await page
      .locator('[class*="listing-card"], [class*="property-card"], [class*="result-card"], article[class*="card"], [data-testid*="listing"]')
      .all();

    if (cards.length === 0) {
      logger.debug("OneRoof search: no listing cards found in DOM");
      await context.close().catch(() => {});
      return [];
    }

    for (const card of cards.slice(0, 10)) {
      try {
        const text = await card.innerText().catch(() => "");
        const href = await card.locator("a").first().getAttribute("href").catch(() => null);
        const imgSrc = await card.locator("img").first().getAttribute("src").catch(() => null);

        const listingUrl = href
          ? href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`
          : url;

        const priceM = text.match(/\$([0-9,.]+(?:[mk])?)/i);
        const priceText = priceM ? priceM[0] : "Price on application";
        const price = priceM ? parseNZDollar(priceM[1]) : null;

        const landM = text.match(/([0-9,]+)\s*m[²2]/i);
        const landArea = landM ? Math.round(parseFloat(landM[1].replace(/,/g, ""))) : null;

        const addressM = text.match(/\d+\s+[A-Z][a-zA-Z\s]+(?:Road|Street|Ave|Avenue|Crescent|Place|Drive|Way|Lane|Terrace|Close|Grove)[,\s]+[A-Za-z\s]+/i);
        const address = addressM ? addressM[0].trim() : text.split("\n")[0]?.trim().slice(0, 80) || "Unknown address";
        const { bedrooms, bathrooms } = extractBedsBaths(text);

        if (address && href) {
          results.push({ address, price, priceText, landArea, photoUrl: imgSrc, listingUrl, zone: null, bedrooms, bathrooms });
        }
      } catch { /* skip card */ }
    }

    await context.close().catch(() => {});
    logScrapeAttempt("OneRoofSearch", "stealth-playwright", results.length > 0, `${results.length} listings for ${params.suburb}`);
  } finally {
    await browser?.close().catch(() => {});
  }

  return results;
}

async function searchOneRoofViaBee(params: {
  suburb: string;
  price_min: number;
  price_max: number;
}): Promise<ListingResult[]> {
  const suburbSlug = params.suburb.toLowerCase().replace(/\s+/g, "-");
  const url = `https://www.oneroof.co.nz/find/buy?suburb=${encodeURIComponent(suburbSlug)}&priceMin=${params.price_min}&priceMax=${params.price_max}&propertyType=residential`;

  const html = await fetchWithScrapingBee(url, { render_js: true, premium_proxy: false, wait: 4000 });
  if (!html || html.length < 500) return [];

  const { load } = await import("cheerio");
  const $ = load(html);

  const results: ListingResult[] = [];
  $('[class*="listing-card"], [class*="property-card"], article, [class*="result"]').slice(0, 10).each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).find("a").first().attr("href");
    const imgSrc = $(el).find("img").first().attr("src") ?? null;

    if (!href) return;

    const listingUrl = href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`;
    const priceM = text.match(/\$([0-9,.]+(?:[mk])?)/i);
    const priceText = priceM ? priceM[0] : "Price on application";
    const price = priceM ? parseNZDollar(priceM[1]) : null;
    const landM = text.match(/([0-9,]+)\s*m[²2]/i);
    const landArea = landM ? Math.round(parseFloat(landM[1].replace(/,/g, ""))) : null;
    const addressM = text.match(/\d+\s+[A-Z][a-zA-Z\s]+(?:Road|Street|Ave|Avenue|Crescent|Place|Drive|Way|Lane|Terrace|Close|Grove)[,\s]+[A-Za-z\s]+/i);
    const address = addressM ? addressM[0].trim() : text.split("\n")[0]?.trim().slice(0, 80) || "";
    const { bedrooms, bathrooms } = extractBedsBaths(text);

    if (address) {
      results.push({ address, price, priceText, landArea, photoUrl: imgSrc, listingUrl, zone: null, bedrooms, bathrooms });
    }
  });

  logScrapeAttempt("OneRoofSearch", "scrapingbee", results.length > 0, `${results.length} listings`);
  return results;
}

export async function searchOneRoofListings(params: {
  suburb: string;
  price_min: number;
  price_max: number;
}): Promise<ListingResult[]> {
  try {
    const results = await Promise.race([
      searchOneRoofPlaywright(params),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Playwright search timeout")), 22000)),
    ]);
    if (results.length > 0) return results;
    logScrapeAttempt("OneRoofSearch", "stealth-playwright", false, "empty result — trying ScrapingBee");
  } catch (err) {
    logScrapeAttempt("OneRoofSearch", "stealth-playwright", false, String(err));
  }

  try {
    const results = await searchOneRoofViaBee(params);
    if (results.length > 0) return results;
  } catch (err) {
    logScrapeAttempt("OneRoofSearch", "scrapingbee", false, String(err));
  }

  logger.warn({ params }, "OneRoofSearch: all attempts failed");
  return [];
}

export interface ComparableSale {
  address: string;
  sale_date: string | null;
  price_nzd: number | null;
  bedrooms: number | null;
  land_area_sqm: number | null;
  /** When sourced from a listing with known floor size (e.g. realestate API). */
  floor_sqm?: number | null;
}

export interface OneRoofData {
  found: boolean;
  cv_nzd: number | null;
  cv_year: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;
  listing_price: number | null;
  listing_active: boolean;
  floor_area_sqm: number | null;
  land_area_sqm: number | null;
  build_year: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  main_photo_url: string | null;
  photo_urls: string[];
  comparables: ComparableSale[];
  data_source: "oneroof";
  scraped_at: string;
}

export function emptyOneRoofData(): OneRoofData {
  return {
    found: false, cv_nzd: null, cv_year: null, last_sale_price: null, last_sale_date: null,
    listing_price: null, listing_active: false, floor_area_sqm: null, land_area_sqm: null,
    build_year: null, bedrooms: null, bathrooms: null, main_photo_url: null, photo_urls: [], comparables: [],
    data_source: "oneroof", scraped_at: new Date().toISOString(),
  };
}

function normaliseImageUrl(raw: string | null | undefined, base = "https://www.oneroof.co.nz"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("data:") || trimmed.includes(".svg")) return null;
  if (/logo|icon|placeholder|sprite/i.test(trimmed)) return null;
  try {
    if (trimmed.startsWith("//")) return `https:${trimmed}`;
    if (trimmed.startsWith("/")) return new URL(trimmed, base).toString();
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function extractDataFromText(pageText: string): Partial<OneRoofData> {
  const result: Partial<OneRoofData> = { found: true, comparables: [] };

  const cvPatterns = [
    /CV[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)\s*(?:\((\d{4})\))?/i,
    /Capital Value[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i,
    /Rateable Value[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i,
  ];
  for (const p of cvPatterns) {
    const m = p.exec(pageText);
    if (m) {
      const cv = parseNZDollar(m[1]);
      if (cv && cv > 100_000) {
        result.cv_nzd = cv;
        if (m[2]) result.cv_year = parseInt(m[2]);
        break;
      }
    }
  }

  if (!result.cv_year) {
    const yearM = /(?:CV year|valuation year|as at)[:\s]+(\d{4})/.exec(pageText);
    if (yearM) result.cv_year = parseInt(yearM[1]);
  }

  const salePriceM = /[Ss]old\s+(?:for\s+)?\$([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i.exec(pageText);
  if (salePriceM) {
    const p = parseNZDollar(salePriceM[1]);
    if (p && p > 100_000) result.last_sale_price = p;
  }

  const saleDateM = /[Ss]old\s+(?:for\s+\$[0-9,]+(?:[mk])?\s+)?(?:on\s+)?(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{4})/i.exec(pageText);
  if (saleDateM) result.last_sale_date = saleDateM[1];

  for (const p of [/[Aa]sking[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i, /[Pp]rice[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i]) {
    const m = p.exec(pageText);
    if (m) { const lp = parseNZDollar(m[1]); if (lp && lp > 100_000) { result.listing_price = lp; result.listing_active = true; break; } }
  }

  const floorM = /[Ff]loor\s+(?:[Aa]rea\s+)?([0-9,]+\.?[0-9]*)\s*m/.exec(pageText);
  if (floorM) { const a = parseArea(floorM[1]); if (a && a > 10) result.floor_area_sqm = a; }

  const landM = /[Ll]and\s+(?:[Aa]rea\s+)?([0-9,]+\.?[0-9]*)\s*m/.exec(pageText);
  if (landM) { const a = parseArea(landM[1]); if (a && a > 10) result.land_area_sqm = a; }

  const buildFromPatterns = extractBuildYearFromListingText(pageText);
  if (buildFromPatterns) {
    result.build_year = buildFromPatterns;
  } else {
    const buildM = /[Bb]uilt?[:\s]+(\d{4})/.exec(pageText);
    if (buildM) {
      const y = parseYear(buildM[1]);
      if (y) result.build_year = y;
    }
  }

  const bedM = /(\d+)\s+[Bb]ed/.exec(pageText);
  if (bedM) result.bedrooms = parseInt(bedM[1]);

  const bathM = /(\d+(?:\.\d)?)\s+[Bb]ath/.exec(pageText);
  if (bathM) {
    const v = parseFloat(bathM[1]);
    if (!isNaN(v) && v > 0 && v < 20) result.bathrooms = v;
  }

  const comparablesSection = pageText.split(/[Nn]earby [Ss]ales|[Rr]ecently [Ss]old|[Cc]omparable/i)[1];
  if (comparablesSection) {
    const sales: ComparableSale[] = [];
    const lines = comparablesSection.split("\n").slice(0, 40);
    for (const line of lines) {
      if (sales.length >= 6) break;
      const pm = /\$([0-9,]+(?:[mk])?)/i.exec(line);
      if (!pm) continue;
      const price = parseNZDollar(pm[1]);
      if (!price || price <= 100_000) continue;
      const beforePrice = line.split("$")[0].trim();
      const streetOnly =
        beforePrice.match(
          /\d+[\w-]?\s+[\w'.\s]+?(?:\s+(?:Road|Street|St|Avenue|Ave|Crescent|Cres|Place|Pl|Drive|Dr|Way|Parade|Lane|Terrace|Tce|Close|Boulevard|Hwy|Highway))?\b[^,$]*/i,
        )?.[0]
          ?.trim() ?? null;
      const address =
        (streetOnly && streetOnly.length >= 8 ? streetOnly : beforePrice) || line.trim();
      sales.push({
        address: address.slice(0, 120),
        sale_date: null,
        price_nzd: price,
        bedrooms: null,
        land_area_sqm: null,
      });
    }
    result.comparables = sales;
  }

  return result;
}

function hasUsefulData(data: OneRoofData | Partial<OneRoofData>): boolean {
  return !!(data.cv_nzd || data.last_sale_price || data.floor_area_sqm);
}

const PLAYWRIGHT_TIMEOUT_MS = 16000;

async function scrapeOneRoofPlaywright(address: string): Promise<OneRoofData> {
  const result = emptyOneRoofData();
  let browser;
  try {
    browser = await launchBrowser();
    const { context, page } = await newStealthPage(browser);

    const searchUrl = `https://www.oneroof.co.nz/find?q=${encodeURIComponent(address)}`;
    await page.goto(searchUrl, { timeout: 12000, waitUntil: "domcontentloaded" });
    await randomDelay(1500, 2500);

    await page.evaluate(() => window.scrollBy(0, 300));
    await randomDelay(500, 1000);

    const firstResult = page.locator('[data-testid*="result"], [class*="result-card"], [class*="property-card"], a[href*="/property/"]').first();
    const hasResults = await firstResult.count();
    if (hasResults === 0) {
      logger.debug("OneRoof: no search results found");
      await context.close().catch(() => {});
      return result;
    }

    const href = await firstResult.getAttribute("href").catch(() => null);
    if (href) {
      const targetUrl = href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`;
      await randomDelay(800, 1500);
      await page.goto(targetUrl, { timeout: 12000, waitUntil: "domcontentloaded" });
      await randomDelay(1500, 2000);
      await page.evaluate(() => window.scrollBy(0, 400));
      await randomDelay(500, 800);
    } else {
      await firstResult.click().catch(() => {});
      await randomDelay(2000, 3000);
    }

    result.found = true;
    const pageText = await page.evaluate(() => document.body.innerText || "");
    const extracted = extractDataFromText(pageText);
    Object.assign(result, extracted);

    try {
      const rawImages = await page.evaluate(() => {
        const selector = [
          'img[src*="oneroof"]',
          'img[src*="property"]',
          '[class*="hero"] img',
          '[class*="gallery"] img',
          "picture img",
        ].join(",");
        return Array.from(document.querySelectorAll<HTMLImageElement>(selector))
          .map((img) => img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("src") || "")
          .filter(Boolean);
      }).catch(() => [] as string[]);
      const imageUrls = Array.from(new Set(rawImages
        .map((u) => normaliseImageUrl(u, page.url()))
        .filter((u): u is string => Boolean(u))))
        .slice(0, 8);
      result.photo_urls = imageUrls;
      result.main_photo_url = imageUrls[0] ?? null;
    } catch { /* non-critical */ }

    await context.close().catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
  }
  return result;
}

async function scrapeOneRoofViaBee(address: string): Promise<OneRoofData | null> {
  const searchUrl = `https://www.oneroof.co.nz/find?q=${encodeURIComponent(address)}`;
  const html = await fetchWithScrapingBee(searchUrl, { render_js: true, premium_proxy: false, wait: 3000 });
  if (!html || html.length < 500) return null;

  const { load } = await import("cheerio");
  const $ = load(html);

  const firstLink = $('a[href*="/property/"], a[href*="/residential/"]').first().attr("href");
  if (!firstLink) {
    logger.debug("OneRoof ScrapingBee: no property link found in search results");
    return null;
  }

  const propertyUrl = firstLink.startsWith("http") ? firstLink : `https://www.oneroof.co.nz${firstLink}`;
  const propHtml = await fetchWithScrapingBee(propertyUrl, { render_js: true, premium_proxy: false, wait: 3000 });
  if (!propHtml || propHtml.length < 500) return null;

  const $prop = load(propHtml);
  const pageText = $prop("body").text();

  const extracted = extractDataFromText(pageText);
  if (!hasUsefulData(extracted)) return null;

  const rawImages = [
    $prop('meta[property="og:image"]').attr("content"),
    ...$prop('img[src*="oneroof"], img[src*="property"], [class*="hero"] img, [class*="gallery"] img, picture img')
      .toArray()
      .map((el) => $prop(el).attr("src") ?? $prop(el).attr("data-src")),
  ];
  const photo_urls = Array.from(new Set(rawImages
    .map((u) => normaliseImageUrl(u, propertyUrl))
    .filter((u): u is string => Boolean(u))))
    .slice(0, 8);

  return {
    ...emptyOneRoofData(),
    ...extracted,
    found: true,
    main_photo_url: photo_urls[0] ?? null,
    photo_urls,
    scraped_at: new Date().toISOString(),
  };
}

export async function scrapeOneRoof(address: string): Promise<OneRoofData> {
  try {
    const result = await Promise.race([
      scrapeOneRoofPlaywright(address),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Playwright timeout")), PLAYWRIGHT_TIMEOUT_MS)),
    ]);
    if (hasUsefulData(result)) {
      logScrapeAttempt("OneRoof", "stealth-playwright", true, `cv=${result.cv_nzd}, comparables=${result.comparables.length}`);
      return result;
    }
    logScrapeAttempt("OneRoof", "stealth-playwright", false, "no useful data — trying ScrapingBee");
  } catch (err) {
    logScrapeAttempt("OneRoof", "stealth-playwright", false, String(err));
  }

  try {
    const result = await scrapeOneRoofViaBee(address);
    if (result) {
      logScrapeAttempt("OneRoof", "scrapingbee", true, `cv=${result.cv_nzd}, comparables=${result.comparables.length}`);
      return result;
    }
  } catch (err) {
    logScrapeAttempt("OneRoof", "scrapingbee", false, String(err));
  }

  logger.warn("OneRoof: all attempts failed — returning empty data");
  return emptyOneRoofData();
}
