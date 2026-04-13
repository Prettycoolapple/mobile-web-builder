import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay } from "./browser";
import type { Browser } from "playwright";

export interface QVData {
  cv_nzd: number | null;
  lv_nzd: number | null;
  iv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
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

export async function scrapeQV(address: string): Promise<QVData | null> {
  logger.info({ address }, "QV.co.nz: starting search-based scrape");

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
        const links = [...document.querySelectorAll("a[href*='/property/']")];
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
    if (buildMatch) data.build_year = parseYear(buildMatch[1]);

    logger.info({ cv_nzd: data.cv_nzd, lv: data.lv_nzd, land: data.land_area_sqm }, "QV.co.nz extraction result");

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
      address_confirmed: currentUrl,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "QV.co.nz scrape failed");
    return null;
  } finally {
    browser?.close().catch(() => {});
  }
}
