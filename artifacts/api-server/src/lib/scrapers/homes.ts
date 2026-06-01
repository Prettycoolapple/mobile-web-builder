/// <reference lib="dom" />
import { logger } from "../logger";
import { hasRemoteBrowserEndpoint, isVercelServerless, launchBrowser, newStealthPage, randomDelay } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import { extractBedsBaths } from "./bed-bath-extractor";
import { addressLineAppearsInText } from "./realestate-api";
import type { Browser } from "playwright";

/** Paths we must never mint as suburb slugs (`/address/auckland/{slug}/`). */
const HOMES_SUBURB_DENYLIST = new Set([
  "new-zealand",
  "aotearoa",
  "north-island",
  "south-island",
  "nz",
]);

/** ScrapingBee is slow (~10s/page); cap blind URL guesses per address. */
const HOMES_SCRAPING_MAX_URL_VARIANTS = 6;

export interface HomesData {
  cv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;
  address_confirmed: string | null;
}

function parseNZD(raw: string): number | null {
  const n = parseInt(raw.replace(/[$,\s]/g, ""), 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function parseSqm(raw: string): number | null {
  const n = parseFloat(raw.replace(/,/g, ""));
  return isNaN(n) || n <= 0 ? null : Math.round(n);
}

function parseYear(raw: string): number | null {
  const m = raw.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = parseInt(m[0], 10);
  return y >= 1900 && y <= new Date().getFullYear() + 1 ? y : null;
}

function extractFromText(allText: string): Partial<HomesData> {
  const data: Partial<HomesData> = {};
  const cvMatch = allText.match(/capital\s*value[^$\d\n]*\$?([\d,]+)/i)
    ?? allText.match(/rateable\s*value[^$\d\n]*\$?([\d,]+)/i)
    ?? allText.match(/\bCV\b[^$\d\n]*\$?([\d,]+)/i);
  if (cvMatch) data.cv_nzd = parseNZD(cvMatch[1]);
  const cvYearMatch = allText.match(/(?:capital value|rateable value).*?(\d{4})/i);
  if (cvYearMatch) data.cv_year = parseYear(cvYearMatch[0]);
  const landMatch = allText.match(/land\s*area[^0-9\n]*([\d,]+(?:\.\d+)?)\s*m/i)
    ?? allText.match(/section\s*(?:size|area)[^0-9\n]*([\d,]+(?:\.\d+)?)\s*m/i)
    ?? allText.match(/(?:site|lot)\s*area[^0-9\n]*([\d,]+(?:\.\d+)?)\s*m/i);
  if (landMatch) data.land_area_sqm = parseSqm(landMatch[1]);
  const floorMatch = allText.match(/floor\s*(?:area|size)[^0-9\n]*([\d,]+(?:\.\d+)?)\s*m/i)
    ?? allText.match(/house\s*(?:size|area)[^0-9\n]*([\d,]+(?:\.\d+)?)\s*m/i);
  if (floorMatch) data.floor_area_sqm = parseSqm(floorMatch[1]);
  const buildMatch = allText.match(/[Yy]ear\s+[Bb]uilt[^0-9\n]*(\d{4})/)
    ?? allText.match(/[Bb]uilt\s+in\s+(\d{4})/i)
    ?? allText.match(/[Cc]onstruction\s+[Yy]ear[^0-9\n]*(\d{4})/i)
    ?? allText.match(/(?:built|year\s*built|decade\s*built)[^0-9\n]*(\d{4})/i);
  if (buildMatch) data.build_year = parseYear(buildMatch[0]);
  const bb = extractBedsBaths(allText);
  if (bb.bedrooms != null) data.bedrooms = bb.bedrooms;
  if (bb.bathrooms != null) data.bathrooms = bb.bathrooms;
  const saleMatch = allText.match(/(?:last\s+sale|sold)\s*(?:for)?\s*\$?([\d,]+)/i);
  if (saleMatch) data.last_sale_price = parseNZD(saleMatch[1]);
  return data;
}

function extractFromEmbeddedHomesJson(html: string, address: string): Partial<HomesData> {
  const data: Partial<HomesData> = {};
  const propertyMarker = /"property_details"\s*:\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = propertyMarker.exec(html)) !== null) {
    const block = html.slice(match.index, match.index + 120_000).replace(/\\"/g, '"');
    if (!addressLineAppearsInText(address, block)) continue;

    const bedrooms =
      block.match(/"latest_bedrooms"\s*:\s*"?(?<value>\d{1,2})"?/i)?.groups?.["value"] ??
      block.match(/"num_bedrooms"\s*:\s*(?<value>\d{1,2})/i)?.groups?.["value"] ??
      block.match(/"bedrooms"\s*:\s*(?<value>\d{1,2})/i)?.groups?.["value"] ??
      null;
    const bathrooms =
      block.match(/"latest_bathrooms"\s*:\s*"?(?<value>\d{1,2})"?/i)?.groups?.["value"] ??
      block.match(/"num_bathrooms"\s*:\s*(?<value>\d{1,2})/i)?.groups?.["value"] ??
      block.match(/"bathrooms"\s*:\s*(?<value>\d{1,2})/i)?.groups?.["value"] ??
      null;
    const floorArea =
      block.match(/"floor_area"\s*:\s*"?(?<value>[\d,.]+)"?/i)?.groups?.["value"] ??
      block.match(/"floorArea"\s*:\s*"?(?<value>[\d,.]+)"?/i)?.groups?.["value"] ??
      null;
    const landArea =
      block.match(/"land_area"\s*:\s*"?(?<value>[\d,.]+)"?/i)?.groups?.["value"] ??
      block.match(/"landArea"\s*:\s*"?(?<value>[\d,.]+)"?/i)?.groups?.["value"] ??
      null;

    const bedN = bedrooms ? parseInt(bedrooms, 10) : NaN;
    const bathN = bathrooms ? parseInt(bathrooms, 10) : NaN;
    if (Number.isFinite(bedN) && bedN > 0 && bedN < 20) data.bedrooms = bedN;
    if (Number.isFinite(bathN) && bathN > 0 && bathN < 20) data.bathrooms = bathN;
    if (floorArea) data.floor_area_sqm = parseSqm(floorArea);
    if (landArea) data.land_area_sqm = parseSqm(landArea);
    return data;
  }
  return data;
}

/**
 * Scan the raw HTML of a homes.co.nz map/neighbourhood page for direct
 * property-page links that include the opaque hash suffix homes.co.nz uses
 * (e.g. /address/auckland/saint-heliers/8-hampton-drive/r9aag).
 *
 * The guessable /address/ URL pattern omits the hash and returns 404; the map
 * page rendered by ScrapingBee embeds the canonical URL in anchor hrefs and
 * inline JSON so we can discover it without guessing.
 *
 * Only returns URLs whose address slug matches `addressNeedle` so we never
 * confuse neighbouring-property links (e.g. 8A Hampton Drive) with the subject.
 */
export function extractHashUrlsFromMapPage(html: string, addressNeedle: string): string[] {
  const found: string[] = [];
  // Match /address/auckland/{suburb}/{address-slug}/{hash}
  // Hash: 3-12 lowercase alphanumeric chars with no hyphens (distinguishes it
  // from the address slug which always contains at least one hyphen).
  const re = /\/address\/auckland\/[a-z0-9-]+\/[a-z0-9][a-z0-9-]+\/([a-z0-9]{3,12})(?=[^a-z0-9/]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[0];
    if (addressLineAppearsInText(addressNeedle, path)) {
      found.push(`https://homes.co.nz${path}`);
    }
  }
  return [...new Set(found)];
}

export function extractHomesDataFromHtml(html: string, address: string): Partial<HomesData> {
  const textContent = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  return {
    ...extractFromText(textContent),
    ...extractFromEmbeddedHomesJson(html, address),
  };
}

function hasUsableData(d: Partial<HomesData>): boolean {
  return !!(d.cv_nzd || d.land_area_sqm || d.build_year || d.bedrooms || d.bathrooms);
}

export function buildHomesPropertyUrls(address: string, suburb: string, formattedAddress: string): string[] {
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-");

  /** Slugs homes.co.nz will never expose as the locale segment (`/address/auckland/{here}/`). */
  const unusableLocaleSlug = (slug: string) => {
    if (!slug || slug.length < 3) return true;
    if (HOMES_SUBURB_DENYLIST.has(slug)) return true;
    // Mashups like "auckland-1071", unit numbers, postcode fragments — not valid localities here.
    if (/\d/.test(slug)) return true;
    return false;
  };

  /** Saint Heliers ⇄ st-heliers-style alternates LINZ/maps sometimes omit. */
  const localityVariants = (raw: string): string[] => {
    const s = slugify(raw ?? "");
    if (!s || unusableLocaleSlug(s)) return [];
    const v = [
      s,
      s.replace(/^saint-/, "st-"),
      s.replace(/^st-/, "saint-"),
      s.replace(/^mount-/, "mt-"),
      s.replace(/^mt-/, "mount-"),
    ];
    return [...new Set(v)].filter((x) => !unusableLocaleSlug(x));
  };

  const parts = address.trim().split(/\s+/);
  const numberPart = parts[0].replace(/[^\w]/g, "").toLowerCase();
  const segSuburbSlug = localityVariants(formattedAddress.split(",")[1]?.trim() ?? "");

  const altSuburbs = [
    ...localityVariants(suburb ?? ""),
    ...segSuburbSlug,
  ];

  const dedup = [...new Set(altSuburbs)].filter(Boolean);
  const urls: string[] = [];
  const streetTypeIndex = parts.findIndex((p) =>
    /^(road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)$/i.test(p.replace(/[^\w]/g, "")),
  );
  const streetNameSlug =
    streetTypeIndex > 1
      ? slugify(parts.slice(1, streetTypeIndex + 1).join(" "))
      : slugify(parts.slice(1, 3).join(" "));
  const addressSlug = `${numberPart}-${streetNameSlug}`;

  for (const sub of dedup.slice(0, HOMES_SCRAPING_MAX_URL_VARIANTS)) {
    urls.push(`https://homes.co.nz/address/auckland/${sub}/${addressSlug}`);
  }

  if (numberPart && streetTypeIndex > 1) {
    for (const sub of dedup.slice(0, HOMES_SCRAPING_MAX_URL_VARIANTS)) {
      urls.push(`https://homes.co.nz/map/auckland/${sub}/${streetNameSlug}/${numberPart}`);
    }
  }
  return urls;
}

function toHomesData(data: Partial<HomesData>, addressNeedle: string): HomesData {
  return {
    cv_nzd: data.cv_nzd ?? null,
    cv_year: data.cv_year ?? null,
    land_area_sqm: data.land_area_sqm ?? null,
    floor_area_sqm: data.floor_area_sqm ?? null,
    build_year: data.build_year ?? null,
    bedrooms: data.bedrooms ?? null,
    bathrooms: data.bathrooms ?? null,
    last_sale_price: data.last_sale_price ?? null,
    last_sale_date: null,
    address_confirmed: addressNeedle,
  };
}

function isErrorPage(textContent: string): boolean {
  const t = textContent.toLowerCase();
  return (t.includes("sorry") && t.includes("doesn't exist"))
    || t.includes("sorry something went wrong")
    || t.includes("page not found")
    || t.includes("404");
}

async function fetchAndExtract(
  url: string,
  addressNeedle: string,
  waitMs: number,
): Promise<{ data: HomesData | null; html: string | null; addressConfirmed: boolean }> {
  logger.info({ url }, "homes.co.nz: trying ScrapingBee with URL");
  const html = await fetchWithScrapingBee(url, { render_js: true, premium_proxy: true, wait: waitMs });
  if (!html) return { data: null, html: null, addressConfirmed: false };

  const textContent = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  logger.info({ url, preview: textContent.slice(0, 300) }, "homes.co.nz: ScrapingBee content preview");

  if (isErrorPage(textContent)) {
    logger.info({ url }, "homes.co.nz: ScrapingBee got error page");
    return { data: null, html: null, addressConfirmed: false };
  }

  const addressConfirmed = addressLineAppearsInText(addressNeedle, textContent);
  if (!addressConfirmed) {
    logger.info({ url, address: addressNeedle }, "homes.co.nz: page did not confirm exact address");
    return { data: null, html, addressConfirmed: false };
  }

  const extracted = extractHomesDataFromHtml(html, addressNeedle);
  if (hasUsableData(extracted)) {
    logger.info({ url, cv_nzd: extracted.cv_nzd, beds: extracted.bedrooms }, "homes.co.nz: ScrapingBee success");
    return { data: toHomesData(extracted, addressNeedle), html, addressConfirmed: true };
  }

  logger.info({ url }, "homes.co.nz: page loaded but no usable data");
  return { data: null, html, addressConfirmed: true };
}

/**
 * Three-phase ScrapingBee scrape for homes.co.nz:
 *
 * Phase 1 — direct /address/ URLs (fast path, works when homes uses a
 *   guessable slug without a hash suffix).
 *
 * Phase 2 — /map/ neighbourhood URLs. These pages always load (no 404) and
 *   contain the property data in embedded __STATE__ JSON. They also embed the
 *   canonical property URL with its opaque hash suffix in anchor hrefs and
 *   inline JSON — both are captured here.
 *
 * Phase 3 — hash URLs discovered in Phase 2. These are the definitive property
 *   detail pages; they carry complete bed/bath/CV data when the map page JSON
 *   did not expose it directly.
 *
 * All phases are sequential to avoid parallel ScrapingBee quota exhaustion.
 */
async function tryScrapingBee(address: string, suburb: string, formattedAddress: string): Promise<HomesData | null> {
  const allUrls = buildHomesPropertyUrls(address, suburb, formattedAddress);
  const addressNeedle = formattedAddress || address;

  const addressUrls = allUrls.filter((u) => u.includes("/address/"));
  const mapUrls = allUrls.filter((u) => u.includes("/map/"));

  // Phase 1: direct /address/ URLs (these work for many properties that use
  // the guessable slug pattern without a hash).
  for (const url of addressUrls) {
    const { data } = await fetchAndExtract(url, addressNeedle, 6500);
    if (data) return data;
  }

  // Phase 2: map/neighbourhood pages. Each one:
  //   a) may contain the property data directly in embedded __STATE__ JSON, and
  //   b) always embeds the canonical hash URL in the rendered HTML.
  const discoveredHashUrls: string[] = [];
  for (const url of mapUrls) {
    const { data, html, addressConfirmed } = await fetchAndExtract(url, addressNeedle, 7500);
    if (data) return data;

    // Even when no usable data was extracted, scan the rendered HTML for the
    // canonical property URL — the map page reliably includes it in both anchor
    // hrefs and inline JSON regardless of whether full property stats loaded.
    if (html && addressConfirmed) {
      const hashUrls = extractHashUrlsFromMapPage(html, addressNeedle);
      for (const u of hashUrls) {
        if (!discoveredHashUrls.includes(u)) discoveredHashUrls.push(u);
      }
      logger.info({ url, discovered: discoveredHashUrls.length }, "homes.co.nz: map page scanned for hash URLs");
    }
  }

  // Phase 3: definitive property pages discovered via their opaque hash URL.
  // Cap at 3 to bound ScrapingBee spend; in practice there is usually only one.
  for (const url of discoveredHashUrls.slice(0, 3)) {
    const { data } = await fetchAndExtract(url, addressNeedle, 6500);
    if (data) return data;
  }

  return null;
}

async function tryPlaywrightSearch(address: string, formattedAddress: string): Promise<HomesData | null> {
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const { page } = await newStealthPage(browser);

    await page.goto("https://homes.co.nz/", { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(2500, 3500);

    const searchTerm = formattedAddress.split(",").slice(0, 2).join(",").trim();

    let inputFound = false;
    for (const loc of [
      page.locator("input[placeholder*='search' i]"),
      page.locator("input[placeholder*='address' i]"),
      page.locator("input[class*='search' i]"),
      page.locator("input:visible").first(),
    ]) {
      try {
        if (await loc.count() > 0) {
          await loc.first().click({ force: true, timeout: 3000 });
          await randomDelay(300, 500);
          await loc.first().fill(searchTerm);
          inputFound = true;
          logger.debug("homes.co.nz: Playwright - typed into input");
          break;
        }
      } catch {
      }
    }

    if (!inputFound) {
      logger.warn("homes.co.nz: Playwright - no input found");
      return null;
    }

    await randomDelay(3000, 4000);

    let clicked = false;
    for (const sel of ["a[href*='/address/']", "[class*='suggestion'] a", "[class*='autocomplete'] a", "[class*='result'] a"]) {
      try {
        const items = page.locator(sel);
        if (await items.count() > 0) {
          await items.first().click({ timeout: 3000 });
          clicked = true;
          break;
        }
      } catch {
      }
    }
    if (!clicked) {
      await page.keyboard.press("ArrowDown");
      await randomDelay(200, 400);
      await page.keyboard.press("Enter");
    }

    try {
      await page.waitForURL(/\/address\//, { timeout: 10000 });
    } catch {
      await randomDelay(3000, 4000);
    }

    const finalUrl = page.url();
    if (!finalUrl.includes("/address/")) {
      logger.warn({ finalUrl }, "homes.co.nz: Playwright - no property URL reached");
      return null;
    }

    try {
      await page.waitForFunction(
        () => document.body.innerText.toLowerCase().includes("capital value")
          || document.body.innerText.toLowerCase().includes("land area"),
        { timeout: 8000 },
      );
    } catch {
    }

    const allText = await page.evaluate(() => document.body.innerText ?? "").catch(() => "");
    logger.info({ textLen: allText.length, url: finalUrl, preview: allText.slice(0, 400) }, "homes.co.nz: Playwright page text");
    if (!addressLineAppearsInText(formattedAddress || address, allText)) {
      logger.warn({ finalUrl, address: formattedAddress || address }, "homes.co.nz: Playwright page did not confirm exact address");
      return null;
    }

    const data = extractFromText(allText);
    if (!hasUsableData(data)) {
      logger.warn({ finalUrl }, "homes.co.nz: Playwright - no usable data");
      return null;
    }

    return {
      cv_nzd: data.cv_nzd ?? null,
      cv_year: data.cv_year ?? null,
      land_area_sqm: data.land_area_sqm ?? null,
      floor_area_sqm: data.floor_area_sqm ?? null,
      build_year: data.build_year ?? null,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      last_sale_price: data.last_sale_price ?? null,
      last_sale_date: null,
      address_confirmed: formattedAddress || address,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "homes.co.nz: Playwright search failed");
    return null;
  } finally {
    browser?.close().catch(() => {});
  }
}

export async function scrapeHomes(
  address: string,
  suburb: string,
  formattedAddress: string,
  options: { allowBrowserFallback?: boolean } = {},
): Promise<HomesData | null> {
  logger.info({ address }, "homes.co.nz: starting scrape");

  const bee = await tryScrapingBee(address, suburb, formattedAddress);
  if (bee) return bee;

  const allowBrowserFallback = options.allowBrowserFallback ?? true;
  if (allowBrowserFallback && (!isVercelServerless() || hasRemoteBrowserEndpoint())) {
    logger.info("homes.co.nz: ScrapingBee failed - trying Playwright browser fallback");
    const pw = await tryPlaywrightSearch(address, formattedAddress);
    if (pw) return pw;
  }

  logger.info("homes.co.nz: all attempts failed");
  return null;
}
