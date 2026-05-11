/// <reference lib="dom" />
import { logger } from "../logger";
import { hasRemoteBrowserEndpoint, isVercelServerless, launchBrowser, logScrapeAttempt, newStealthPage, randomDelay } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import type { Browser } from "playwright";

export interface QVData {
  cv_nzd: number | null;
  lv_nzd: number | null;
  iv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  build_year_range: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  address_confirmed: string | null;
  contour_text: string | null;
  contour_classification: "flat" | "gentle" | "moderate" | "steep" | null;
}

export function mapNZContour(raw: string): "flat" | "gentle" | "moderate" | "steep" | null {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("level") || lower.includes("flat")) return "flat";
  if (lower.includes("easy") || lower.includes("gentle")) return "gentle";
  if (lower.includes("moderate")) return "moderate";
  if (lower.includes("steep") || lower.includes("very steep") || lower.includes("extreme")) return "steep";
  return null;
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

function htmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractQvDataFromText(allText: string, addressConfirmed: string): QVData | null {
  const data: Partial<QVData> = {};

  const cvMatch = allText.match(/capital\s*value\s*\$?([\d,]+)/i);
  if (cvMatch) data.cv_nzd = parseNZD(cvMatch[1]);

  const lvMatch = allText.match(/land\s*value\s*\$?([\d,]+)/i);
  if (lvMatch) data.lv_nzd = parseNZD(lvMatch[1]);

  const ivMatch = allText.match(/improvement\s*value\s*\$?([\d,]+)/i);
  if (ivMatch) data.iv_nzd = parseNZD(ivMatch[1]);

  const cvValuationMatch = allText.match(/(?:rating values|capital value).*?(\d{4})/is);
  if (cvValuationMatch) data.cv_year = parseYear(cvValuationMatch[0]);

  const landMatch = allText.match(/\bland\s*area\s*([\d,]+(?:\.\d+)?)\s*m/i)
    ?? allText.match(/\bland\s*\n?\s*([\d,]+(?:\.\d+)?)\s*m/i)
    ?? allText.match(/site\s*area\s*([\d,]+(?:\.\d+)?)\s*m/i);
  if (landMatch) data.land_area_sqm = parseSqm(landMatch[1]);

  const floorMatch = allText.match(/floor\s*area\s*\n?\s*([\d,]+(?:\.\d+)?)\s*m/i)
    ?? allText.match(/house\s*area\s*([\d,]+(?:\.\d+)?)\s*m/i);
  if (floorMatch) data.floor_area_sqm = parseSqm(floorMatch[1]);

  const buildMatch = allText.match(/\bbuilt\s*\n?\s*(\d{4})/i)
    ?? allText.match(/(?:year\s*built|construction\s*year)\s*\n?\s*(\d{4})/i);
  const buildRangeMatch = allText.match(/\bbuilt\s*\n?\s*((?:19|20)\d0)[–-](\d{2})\b/i);
  if (buildRangeMatch) {
    const start = parseInt(buildRangeMatch[1], 10);
    const suffix = parseInt(buildRangeMatch[2], 10);
    const end = Math.floor(start / 100) * 100 + suffix;
    data.build_year_range = `${start}-${end}`;
    const endYear = parseYear(String(end));
    if (endYear) data.build_year = endYear;
  }
  if (!data.build_year && buildMatch) data.build_year = parseYear(buildMatch[1]);

  const bedroomsMatch = allText.match(/\bbedrooms\s*\n?\s*(\d{1,2})\b/i)
    ?? allText.match(/\b(\d{1,2})\s+bed(?:room)?s?\b/i);
  if (bedroomsMatch) {
    const n = parseInt(bedroomsMatch[1], 10);
    if (!isNaN(n) && n > 0 && n < 20) data.bedrooms = n;
  }

  const bathroomsMatch = allText.match(/\bbathrooms\s*\n?\s*(\d+(?:\.\d+)?)\*?\b/i)
    ?? allText.match(
      /\b(\d+(?:\.\d+)?)\s+(?!living\s+(?:area|areas|space|spaces)\b)bath(?:room)?s?\b/i,
    );
  if (bathroomsMatch) {
    const n = parseFloat(bathroomsMatch[1]);
    if (!isNaN(n) && n > 0 && n < 20) data.bathrooms = n;
  }

  const contourMatch = allText.match(/\bcontour[:\s\n]+([A-Za-z][A-Za-z /]{1,30}?)(?:\n|\r|$)/im)
    ?? allText.match(/\bproperty\s*contour\s+([A-Za-z][A-Za-z /]{1,30}?)(?=\s+(?:Position|View|Deck|Buy|Image|$))/i);
  let contourText: string | null = null;
  let contourClass: "flat" | "gentle" | "moderate" | "steep" | null = null;
  if (contourMatch) {
    contourText = contourMatch[1].trim().replace(/\s+/g, " ");
    contourClass = mapNZContour(contourText);
  }

  if (!data.cv_nzd && !data.land_area_sqm && !data.lv_nzd) return null;

  return {
    cv_nzd: data.cv_nzd ?? null,
    lv_nzd: data.lv_nzd ?? null,
    iv_nzd: data.iv_nzd ?? null,
    cv_year: data.cv_year ?? null,
    land_area_sqm: data.land_area_sqm ?? null,
    floor_area_sqm: data.floor_area_sqm ?? null,
    build_year: data.build_year ?? null,
    build_year_range: data.build_year_range ?? null,
    bedrooms: data.bedrooms ?? null,
    bathrooms: data.bathrooms ?? null,
    address_confirmed: addressConfirmed,
    contour_text: contourText,
    contour_classification: contourClass,
  };
}

async function scrapeQvViaBee(address: string): Promise<QVData | null> {
  const searchTerm = address.trim();
  const shortAddr = address.split(" ").slice(0, 2).join(" ");
  const scenario = {
    strict: false,
    instructions: [
      { wait: 2500 },
      {
        evaluate: `
          (() => {
            const query = ${JSON.stringify(searchTerm)};
            const input = Array.from(document.querySelectorAll('input')).find((el) => {
              const s = [el.placeholder, el.ariaLabel, el.id, el.name, el.className].join(' ').toLowerCase();
              return /address|property|search/.test(s);
            }) || document.querySelector('input[type="text"], input');
            if (!input) return 'no-input';
            input.focus();
            input.value = query;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            return 'filled';
          })();
        `,
      },
      { wait: 4500 },
      {
        evaluate: `
          (() => {
            const prefix = ${JSON.stringify(shortAddr.toLowerCase())};
            const candidates = Array.from(document.querySelectorAll('a, button, li, div, span'))
              .filter((el) => (el.innerText || '').trim().toLowerCase().startsWith(prefix));
            const el = candidates[0];
            if (!el) return 'no-suggestion';
            el.click();
            return (el.innerText || '').trim();
          })();
        `,
      },
      { wait: 6000 },
    ],
  };

  const html = await fetchWithScrapingBee("https://www.qv.co.nz/property-search/", {
    render_js: true,
    premium_proxy: true,
    wait: 1000,
    js_scenario: scenario,
  });
  if (!html || html.length < 500) return null;

  const propertyLink = html.match(/href=["']([^"']*\/property-search\/property-details\/\d+\/?)["']/i)?.[1];
  if (propertyLink) {
    const propertyUrl = propertyLink.startsWith("http") ? propertyLink : `https://www.qv.co.nz${propertyLink}`;
    const detailHtml = await fetchWithScrapingBee(propertyUrl, { render_js: false, premium_proxy: false, wait: 500 });
    if (detailHtml) {
      const parsedDetail = extractQvDataFromText(htmlToText(detailHtml), propertyUrl);
      if (parsedDetail) return parsedDetail;
    }
  }

  return extractQvDataFromText(htmlToText(html), "https://www.qv.co.nz/property-search/");
}

export async function scrapeQV(address: string): Promise<QVData | null> {
  logger.info({ address }, "QV.co.nz: starting search-based scrape");

  if (isVercelServerless() && !hasRemoteBrowserEndpoint()) {
    const bee = await scrapeQvViaBee(address);
    logScrapeAttempt(
      "QV",
      "scrapingbee",
      !!bee,
      bee ? `cv=${bee.cv_nzd}, land=${bee.land_area_sqm} (Vercel: Playwright unavailable)` : "no usable data on Vercel",
    );
    return bee;
  }

  let browser: Browser | null = null;
  try {
    browser = await launchBrowser();
    const { page } = await newStealthPage(browser);

    await page.goto("https://www.qv.co.nz/property-search/", {
      waitUntil: "domcontentloaded",
      timeout: 18000,
    });
    await randomDelay(2000, 2500);

    let inputFound = false;
    const searchTerm = address.trim().split(" ").slice(0, 3).join(" ");
    for (const loc of [
      page.locator("input[placeholder*='address' i]"),
      page.locator("input[placeholder*='search' i]"),
      page.locator("input[type='text']:visible").first(),
      page.locator("input:visible").first(),
    ]) {
      try {
        if (await loc.count() > 0) {
          await loc.first().click({ force: true, timeout: 3000 });
          await randomDelay(200, 300);
          await page.keyboard.type(searchTerm, { delay: 40 });
          inputFound = true;
          logger.info({ searchTerm }, "QV.co.nz: typed into input via keyboard");
          break;
        }
      } catch {
      }
    }

    if (!inputFound) {
      logger.warn("QV.co.nz: no search input found");
      await browser.close().catch(() => {});
      return null;
    }

    const shortAddr = address.split(" ").slice(0, 2).join(" ");

    await page.waitForFunction(
      (prefix) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n: Node | null;
        while ((n = walker.nextNode()) !== null) {
          if ((n.textContent ?? "").trim().startsWith(prefix)) return true;
        }
        return false;
      },
      shortAddr,
      { timeout: 15000 },
    ).catch(() => logger.warn("QV.co.nz: suggestion wait timed out"));

    const clickedEl = await page.evaluate((prefix) => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode()) !== null) {
        const text = (node.textContent ?? "").trim();
        if (text.startsWith(prefix)) {
          const parent = (node as Text).parentElement;
          if (parent) {
            parent.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            parent.click?.();
            return text;
          }
        }
      }
      return null;
    }, shortAddr);

    if (clickedEl) {
      logger.info({ clickedEl }, "QV.co.nz: clicked suggestion via TreeWalker");
    } else {
      logger.warn("QV.co.nz: no text node found via TreeWalker — pressing ArrowDown+Enter");
      await page.keyboard.press("ArrowDown");
      await randomDelay(300, 400);
      await page.keyboard.press("Enter");
    }

    try {
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 });
    } catch {
      await randomDelay(2000, 3000);
    }

    const urlAfterNav = page.url();
    if (urlAfterNav.includes("property-search")) {
      const firstLink = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a[href*='/property/']"));
        if (links.length > 0) {
          (links[0] as HTMLElement).click();
          return (links[0] as HTMLAnchorElement).href;
        }
        return null;
      });
      if (firstLink) {
        logger.debug({ firstLink }, "QV.co.nz: clicked property link from results");
        try {
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 });
        } catch {
          await randomDelay(2000, 3000);
        }
      }
    }

    try {
      await page.waitForFunction(
        () => document.body.innerText.toLowerCase().includes("capital value")
          || document.body.innerText.toLowerCase().includes("land value"),
        { timeout: 8000 },
      );
    } catch {
      logger.debug("QV.co.nz: data selectors not found");
    }

    const allText = await page.evaluate(() => document.body.innerText ?? "").catch(() => "");
    const currentUrl = page.url();

    logger.info(
      { textLen: allText.length, url: currentUrl, preview: allText.slice(0, 500) },
      "QV.co.nz: page text extracted",
    );

    if (allText.length < 200) {
      logger.warn("QV.co.nz: page too short");
      return null;
    }

    const data: Partial<QVData> = {};

    const cvMatch = allText.match(/capital\s*value\s*\$?([\d,]+)/i);
    if (cvMatch) data.cv_nzd = parseNZD(cvMatch[1]);

    const lvMatch = allText.match(/land\s*value\s*\$?([\d,]+)/i);
    if (lvMatch) data.lv_nzd = parseNZD(lvMatch[1]);

    const ivMatch = allText.match(/improvement\s*value\s*\$?([\d,]+)/i);
    if (ivMatch) data.iv_nzd = parseNZD(ivMatch[1]);

    const cvValuationMatch = allText.match(/(?:rating values|capital value).*?(\d{4})/is);
    if (cvValuationMatch) data.cv_year = parseYear(cvValuationMatch[0]);

    const landMatch = allText.match(/\bland\s*area\s*([\d,]+(?:\.\d+)?)\s*m/i)
      ?? allText.match(/\bland\s*\n?\s*([\d,]+(?:\.\d+)?)\s*m/i)
      ?? allText.match(/site\s*area\s*([\d,]+(?:\.\d+)?)\s*m/i);
    if (landMatch) data.land_area_sqm = parseSqm(landMatch[1]);

    const floorMatch = allText.match(/floor\s*area\s*\n?\s*([\d,]+(?:\.\d+)?)\s*m/i)
      ?? allText.match(/house\s*area\s*([\d,]+(?:\.\d+)?)\s*m/i);
    if (floorMatch) data.floor_area_sqm = parseSqm(floorMatch[1]);

    const buildMatch = allText.match(/\bbuilt\s*\n?\s*(\d{4})/i)
      ?? allText.match(/(?:year\s*built|construction\s*year)\s*\n?\s*(\d{4})/i);
    const buildRangeMatch = allText.match(/\bbuilt\s*\n?\s*((?:19|20)\d0)[–\-](\d{2})\b/i);
    if (buildRangeMatch) {
      const start = parseInt(buildRangeMatch[1], 10);
      const suffix = parseInt(buildRangeMatch[2], 10);
      const end = Math.floor(start / 100) * 100 + suffix;
      data.build_year_range = `${start}-${end}`;
      // The end year of the council decade range IS the actual build year in NZ records
      // (e.g. "Built 2010-19" on QV → council-registered 2019, confirmed by CoreLogic/PropertyValue data).
      const endYear = parseYear(String(end));
      if (endYear) data.build_year = endYear;
    }
    if (!data.build_year && buildMatch) {
      data.build_year = parseYear(buildMatch[1]);
    }

    const bedroomsMatch = allText.match(/\bbedrooms\s*\n?\s*(\d{1,2})\b/i)
      ?? allText.match(/\b(\d{1,2})\s+bed(?:room)?s?\b/i);
    if (bedroomsMatch) {
      const n = parseInt(bedroomsMatch[1], 10);
      if (!isNaN(n) && n > 0 && n < 20) data.bedrooms = n;
    }

    const bathroomsMatch = allText.match(/\bbathrooms\s*\n?\s*(\d+(?:\.\d+)?)\*?\b/i)
      ?? allText.match(
        /\b(\d+(?:\.\d+)?)\s+(?!living\s+(?:area|areas|space|spaces)\b)bath(?:room)?s?\b/i,
      );
    if (bathroomsMatch) {
      const n = parseFloat(bathroomsMatch[1]);
      if (!isNaN(n) && n > 0 && n < 20) data.bathrooms = n;
    }

    const contourMatch = allText.match(/\bcontour[:\s\n]+([A-Za-z][A-Za-z /]{1,30}?)(?:\n|\r|$)/im);
    let contourText: string | null = null;
    let contourClass: "flat" | "gentle" | "moderate" | "steep" | null = null;
    if (contourMatch) {
      const trimmed = contourMatch[1].trim().replace(/\s+/g, " ");
      contourText = trimmed;
      contourClass = mapNZContour(trimmed);
    }

    logger.info({ cv_nzd: data.cv_nzd, lv: data.lv_nzd, land: data.land_area_sqm, build_year: data.build_year, build_year_range: data.build_year_range, bedrooms: data.bedrooms, bathrooms: data.bathrooms, contour: contourText }, "QV.co.nz extraction result");

    if (!data.cv_nzd && !data.land_area_sqm && !data.lv_nzd) {
      logger.warn({ url: currentUrl }, "QV.co.nz: no usable data extracted");
      return null;
    }

    return {
      cv_nzd: data.cv_nzd ?? null,
      lv_nzd: data.lv_nzd ?? null,
      iv_nzd: data.iv_nzd ?? null,
      cv_year: data.cv_year ?? null,
      land_area_sqm: data.land_area_sqm ?? null,
      floor_area_sqm: data.floor_area_sqm ?? null,
      build_year: data.build_year ?? null,
      build_year_range: data.build_year_range ?? null,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      address_confirmed: currentUrl,
      contour_text: contourText,
      contour_classification: contourClass,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "QV.co.nz scrape failed");
    const bee = await scrapeQvViaBee(address);
    logScrapeAttempt(
      "QV",
      "scrapingbee",
      !!bee,
      bee ? `cv=${bee.cv_nzd}, land=${bee.land_area_sqm}` : "no usable data after Playwright failure",
    );
    return bee;
  } finally {
    browser?.close().catch(() => {});
  }
}
