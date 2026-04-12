import { chromium } from "playwright";
import { logger } from "../logger";
import { getChromiumPath, BROWSER_ARGS } from "./browser";

export interface ComparableSale {
  address: string;
  sale_date: string | null;
  price_nzd: number | null;
  bedrooms: number | null;
  land_area_sqm: number | null;
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
  main_photo_url: string | null;
  comparables: ComparableSale[];
  data_source: "oneroof";
  scraped_at: string;
}

function parseNZDollar(text: string): number | null {
  const clean = text.replace(/[,$\s]/g, "");
  const m = clean.match(/([\d.]+)([mk]?)/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (isNaN(v) || v <= 0) return null;
  if (m[2].toLowerCase() === "m") v *= 1_000_000;
  if (m[2].toLowerCase() === "k") v *= 1_000;
  return Math.round(v);
}

function parseArea(text: string): number | null {
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*m/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) || v <= 0 ? null : Math.round(v);
}

function parseYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = parseInt(m[0]);
  return y >= 1800 && y <= new Date().getFullYear() + 1 ? y : null;
}

const SCRAPER_TIMEOUT_MS = 18000;

export async function scrapeOneRoof(address: string): Promise<OneRoofData> {
  return Promise.race([
    _scrapeOneRoof(address),
    new Promise<OneRoofData>((_, reject) =>
      setTimeout(() => reject(new Error("OneRoof scraper timeout")), SCRAPER_TIMEOUT_MS)
    ),
  ]).catch((err) => {
    logger.warn({ err }, "OneRoof: timed out or failed — returning empty data");
    return {
      found: false, cv_nzd: null, cv_year: null, last_sale_price: null, last_sale_date: null,
      listing_price: null, listing_active: false, floor_area_sqm: null, land_area_sqm: null,
      build_year: null, bedrooms: null, main_photo_url: null, comparables: [],
      data_source: "oneroof" as const, scraped_at: new Date().toISOString(),
    };
  });
}

async function _scrapeOneRoof(address: string): Promise<OneRoofData> {
  const result: OneRoofData = {
    found: false,
    cv_nzd: null,
    cv_year: null,
    last_sale_price: null,
    last_sale_date: null,
    listing_price: null,
    listing_active: false,
    floor_area_sqm: null,
    land_area_sqm: null,
    build_year: null,
    bedrooms: null,
    main_photo_url: null,
    comparables: [],
    data_source: "oneroof",
    scraped_at: new Date().toISOString(),
  };

  let browser;
  try {
    const chromiumPath = getChromiumPath();
    browser = await chromium.launch({
      executablePath: chromiumPath,
      args: BROWSER_ARGS,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
    });

    const page = await context.newPage();

    const searchUrl = `https://www.oneroof.co.nz/find?q=${encodeURIComponent(address)}`;
    logger.debug({ url: searchUrl }, "OneRoof: navigating to search");

    await page.goto(searchUrl, { timeout: 12000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const firstResult = page.locator('[data-testid*="result"], [class*="result-card"], [class*="property-card"], [href*="/property/"]').first();
    const resultExists = await firstResult.count();
    if (resultExists === 0) {
      logger.debug("OneRoof: no search results found");
      return result;
    }

    try {
      const href = await firstResult.getAttribute("href");
      if (href) {
        const targetUrl = href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`;
        logger.debug({ targetUrl }, "OneRoof: navigating to property page");
        await page.goto(targetUrl, { timeout: 20000, waitUntil: "domcontentloaded" });
        await page.waitForTimeout(3000);
      } else {
        await firstResult.click();
        await page.waitForTimeout(3000);
      }
    } catch {
      logger.debug("OneRoof: failed to navigate to property page");
      return result;
    }

    result.found = true;

    const pageText = await page.evaluate(() => document.body.innerText);

    const cvPatterns = [
      /[Cc][Vv]\s+\$?([\d,]+(?:\.\d+)?(?:[mk])?)\s*(?:\((\d{4})\))?/,
      /[Cc]apital [Vv]alue\s*\$?([\d,]+(?:\.\d+)?(?:[mk])?)/,
      /[Rr]ateable [Vv]alue\s*\$?([\d,]+(?:\.\d+)?(?:[mk])?)/,
    ];
    for (const p of cvPatterns) {
      const m = p.exec(pageText);
      if (m) {
        const cv = parseNZDollar(m[1]);
        if (cv && cv > 100000) {
          result.cv_nzd = cv;
          if (m[2]) result.cv_year = parseInt(m[2]);
          break;
        }
      }
    }

    const cvYearPattern = /CV year[:\s]+(\d{4})|(\d{4})\s+[Vv]aluation/;
    if (!result.cv_year) {
      const m = cvYearPattern.exec(pageText);
      if (m) result.cv_year = parseInt(m[1] || m[2]);
    }

    const salePricePattern = /[Ss]old\s+(?:for\s+)?\$?([\d,]+(?:\.\d+)?(?:[mk])?)/;
    const saleDatePattern = /[Ss]old\s+(?:for\s+\$[\d,]+(?:[mk])?\s+)?(?:on\s+)?(\d{1,2}\s+\w+\s+\d{4}|\w+\s+\d{4})/;
    const salePriceM = salePricePattern.exec(pageText);
    if (salePriceM) {
      const price = parseNZDollar(salePriceM[1]);
      if (price && price > 100000) result.last_sale_price = price;
    }
    const saleDateM = saleDatePattern.exec(pageText);
    if (saleDateM) result.last_sale_date = saleDateM[1];

    const listingPatterns = [
      /[Aa]sking[:\s]+\$?([\d,]+(?:\.\d+)?(?:[mk])?)/,
      /[Pp]rice[:\s]+\$?([\d,]+(?:\.\d+)?(?:[mk])?)/,
      /[Ff]or [Ss]ale[:\s]+\$?([\d,]+(?:\.\d+)?(?:[mk])?)/,
    ];
    for (const p of listingPatterns) {
      const m = p.exec(pageText);
      if (m) {
        const price = parseNZDollar(m[1]);
        if (price && price > 100000) {
          result.listing_price = price;
          result.listing_active = true;
          break;
        }
      }
    }

    const floorM = /[Ff]loor\s+(?:[Aa]rea\s+)?(\d+)\s*m/.exec(pageText);
    if (floorM) result.floor_area_sqm = parseArea(floorM[1]);

    const landM = /[Ll]and\s+(?:[Aa]rea\s+)?(\d[\d,]*)\s*m/.exec(pageText);
    if (landM) result.land_area_sqm = parseArea(landM[1]);

    const yearM = /[Bb]uilt?[\s:]+(\d{4})/.exec(pageText);
    if (yearM) result.build_year = parseYear(yearM[1]);

    const bedroomM = /(\d+)\s+[Bb]ed/.exec(pageText);
    if (bedroomM) result.bedrooms = parseInt(bedroomM[1]);

    try {
      const imgEl = page.locator('img[src*="property"], img[src*="listing"], [class*="hero"] img, [class*="gallery"] img').first();
      const src = await imgEl.getAttribute("src", { timeout: 2000 });
      if (src) result.main_photo_url = src;
    } catch { /* non-critical */ }

    try {
      const comparablesText = pageText.split(/[Nn]earby [Ss]ales|[Rr]ecently [Ss]old|[Cc]omparables/i)[1];
      if (comparablesText) {
        const lines = comparablesText.split("\n").filter((l) => l.trim().length > 5).slice(0, 30);
        const sales: ComparableSale[] = [];
        for (let i = 0; i < lines.length && sales.length < 6; i++) {
          const line = lines[i];
          const priceM = /\$([\d,]+(?:\.\d+)?(?:[mk])?)/i.exec(line);
          if (priceM) {
            const price = parseNZDollar(priceM[1]);
            if (price && price > 100000) {
              sales.push({
                address: line.slice(0, 80).trim(),
                sale_date: null,
                price_nzd: price,
                bedrooms: null,
                land_area_sqm: null,
              });
            }
          }
        }
        result.comparables = sales;
      }
    } catch { /* non-critical */ }

    logger.debug(
      { found: result.found, cv: result.cv_nzd, comparables: result.comparables.length },
      "OneRoof: extraction complete",
    );
  } catch (err) {
    logger.warn({ err }, "OneRoof: scrape failed — returning partial data");
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }

  return result;
}
