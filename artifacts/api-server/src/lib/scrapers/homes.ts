/// <reference lib="dom" />
import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import { extractBedsBaths } from "./bed-bath-extractor";
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

function hasUsableData(d: Partial<HomesData>): boolean {
  return !!(d.cv_nzd || d.land_area_sqm || d.build_year);
}

function buildPropertyUrls(address: string, suburb: string, formattedAddress: string): string[] {
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
  const streetSlug = slugify(parts.slice(1, 3).join(" "));
  const addressSlug = `${numberPart}-${streetSlug}`;
  const segSuburbSlug = localityVariants(formattedAddress.split(",")[1]?.trim() ?? "");

  const altSuburbs = [
    ...localityVariants(suburb ?? ""),
    ...segSuburbSlug,
  ];

  const dedup = [...new Set(altSuburbs)].filter(Boolean);
  const urls: string[] = [];
  for (const sub of dedup.slice(0, HOMES_SCRAPING_MAX_URL_VARIANTS)) {
    urls.push(`https://homes.co.nz/address/auckland/${sub}/${addressSlug}`);
  }
  return urls;
}

async function tryScrapingBee(address: string, suburb: string, formattedAddress: string): Promise<HomesData | null> {
  const urls = buildPropertyUrls(address, suburb, formattedAddress);

  for (const url of urls) {
    logger.info({ url }, "homes.co.nz: trying ScrapingBee with URL");
    const html = await fetchWithScrapingBee(url, {
      render_js: true,
      premium_proxy: true,
      wait: 6500,
    });
    if (!html) continue;

    const textContent = html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    const textLower = textContent.toLowerCase();
    logger.info({ url, preview: textContent.slice(0, 300) }, "homes.co.nz: ScrapingBee content preview");

    if (textLower.includes("sorry") && textLower.includes("doesn't exist")
      || textLower.includes("sorry something went wrong")
      || textLower.includes("page not found")
      || textLower.includes("404")) {
      logger.info({ url }, "homes.co.nz: ScrapingBee got error page (Angular error)");
      continue;
    }

    const data = extractFromText(textContent);
    if (hasUsableData(data)) {
      logger.info({ url, cv_nzd: data.cv_nzd, land: data.land_area_sqm }, "homes.co.nz: ScrapingBee success");
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
        address_confirmed: url,
      };
    }
    logger.info({ url }, "homes.co.nz: ScrapingBee page loaded but no usable data");
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
      address_confirmed: finalUrl,
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
): Promise<HomesData | null> {
  logger.info({ address }, "homes.co.nz: starting scrape");

  const bee = await tryScrapingBee(address, suburb, formattedAddress);
  if (bee) return bee;

  logger.info("homes.co.nz: ScrapingBee failed — Playwright fallback disabled (blocked by site)");
  return null;
}
