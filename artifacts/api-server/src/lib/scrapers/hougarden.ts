import { chromium } from "playwright";
import { logger } from "../logger";
import { getChromiumPath, BROWSER_ARGS } from "./browser";
import type { Overlay } from "../auckland-council";

export interface HougardenData {
  cv_nzd: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  zone_code: string | null;
  zone_description: string | null;
  overlays: Overlay[];
  school_zones: { primary: string | null; intermediate: string | null; secondary: string | null };
  overlay_map_image_base64: string | null;
  data_source: "hougarden";
  scraped_at: string;
}

const OVERLAY_MAP: Record<string, { name: string; status: Overlay["status"]; detail: string }> = {
  "flood": { name: "Flood Plain", status: "restricted", detail: "Flood sensitivity overlay — Engineering report and NES-F compliance required. Finished floor levels will be specified by Council." },
  "heritage": { name: "Heritage", status: "restricted", detail: "Historic Heritage Overlay — demolition or alteration requires Resource Consent from Auckland Council heritage team." },
  "notable tree": { name: "Notable Trees", status: "moderate", detail: "Notable tree overlay on or near site — tree removal requires Resource Consent from Auckland Council." },
  "volcanic": { name: "Volcanic Viewshaft", status: "restricted", detail: "Volcanic Viewshaft overlay — height restrictions apply, possibly below zone standard. Urban designer input required." },
  "viewshaft": { name: "Volcanic Viewshaft", status: "restricted", detail: "Viewshaft overlay — additional height assessment required at Resource Consent stage." },
  "coastal": { name: "Coastal Inundation", status: "restricted", detail: "Coastal Inundation Area — floor level controls apply. Check NES-F compliance requirements." },
  "overland": { name: "Overland Flow Path", status: "moderate", detail: "Overland Flow Path — stormwater management plan required. Building over OFP generally not permitted." },
  "waitakere": { name: "Waitakere Ranges Heritage", status: "restricted", detail: "Waitakere Ranges Heritage Area — strict development controls apply. Most earthworks and vegetation clearance require consent." },
  "ridgeline": { name: "Ridgeline Protection", status: "moderate", detail: "Ridgeline Protection Overlay — skyline development controls apply. Building bulk may be restricted." },
};

function parseNZDollar(text: string): number | null {
  const clean = text.replace(/[,$\s]/g, "");
  const m = clean.match(/[\d.]+/);
  if (!m) return null;
  const v = parseFloat(m[0]);
  if (isNaN(v) || v <= 0) return null;
  if (clean.match(/m$/i)) return Math.round(v * 1_000_000);
  if (clean.match(/k$/i)) return Math.round(v * 1_000);
  return Math.round(v);
}

function parseArea(text: string): number | null {
  const m = text.match(/([\d,]+\.?\d*)\s*m/i);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/,/g, ""));
  return isNaN(v) || v <= 0 ? null : Math.round(v);
}

function parseYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = parseInt(m[0]);
  return y >= 1800 && y <= new Date().getFullYear() ? y : null;
}

function mapZoneCode(text: string): { code: string; description: string } {
  const lower = text.toLowerCase();
  const ZONE_MAP: Record<string, { code: string; description: string }> = {
    "mixed housing suburban": { code: "MHS", description: "Mixed Housing Suburban" },
    "mixed housing urban": { code: "MHU", description: "Mixed Housing Urban" },
    "terrace housing": { code: "THAB", description: "Terrace Housing and Apartment Buildings" },
    "single house": { code: "SHZ", description: "Single House Zone" },
    "large lot": { code: "LLRZ", description: "Large Lot Residential Zone" },
    "rural and coastal": { code: "RCSZ", description: "Rural and Coastal Settlement Zone" },
    "low density": { code: "LDRZ", description: "Low Density Residential Zone" },
    "future urban": { code: "FUZ", description: "Future Urban Zone" },
    "business park": { code: "BPZ", description: "Business - Business Park Zone" },
    "city centre": { code: "CCZ", description: "Business - City Centre Zone" },
    "general business": { code: "GBZ", description: "Business - General Business Zone" },
    "light industry": { code: "BPIZ", description: "Business - Light Industry Zone" },
    "local centre": { code: "LCZ", description: "Business - Local Centre Zone" },
    "metropolitan": { code: "MCZ", description: "Business - Metropolitan Centre Zone" },
    "mixed use": { code: "MUZ", description: "Business - Mixed Use Zone" },
    "neighbourhood centre": { code: "NCZ", description: "Business - Neighbourhood Centre Zone" },
    "town centre": { code: "TCZ", description: "Business - Town Centre Zone" },
  };
  for (const [key, val] of Object.entries(ZONE_MAP)) {
    if (lower.includes(key)) return val;
  }
  const codeMatch = text.match(/\b(MHS|MHU|THAB|SHZ|LLRZ|RCSZ|LDRZ|FUZ|BPZ|CCZ|GBZ|BPIZ|LCZ|MCZ|MUZ|NCZ|TCZ)\b/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    return { code, description: text.trim() };
  }
  return { code: text.trim().toUpperCase().slice(0, 6), description: text.trim() };
}

const SCRAPER_TIMEOUT_MS = 18000;

export async function scrapeHougarden(
  lat: number,
  lng: number,
  address: string,
): Promise<HougardenData> {
  return Promise.race([
    _scrapeHougarden(lat, lng, address),
    new Promise<HougardenData>((_, reject) =>
      setTimeout(() => reject(new Error("Hougarden scraper timeout")), SCRAPER_TIMEOUT_MS)
    ),
  ]).catch((err) => {
    logger.warn({ err }, "Hougarden: timed out or failed — returning empty data");
    return {
      cv_nzd: null, land_area_sqm: null, floor_area_sqm: null, build_year: null,
      zone_code: null, zone_description: null, overlays: [], school_zones: { primary: null, intermediate: null, secondary: null },
      overlay_map_image_base64: null, data_source: "hougarden" as const, scraped_at: new Date().toISOString(),
    };
  });
}

async function _scrapeHougarden(
  lat: number,
  lng: number,
  address: string,
): Promise<HougardenData> {
  const result: HougardenData = {
    cv_nzd: null,
    land_area_sqm: null,
    floor_area_sqm: null,
    build_year: null,
    zone_code: null,
    zone_description: null,
    overlays: [],
    school_zones: { primary: null, intermediate: null, secondary: null },
    overlay_map_image_base64: null,
    data_source: "hougarden",
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

    const searchUrl = `https://www.hougarden.com/search/#ac=1&address=${encodeURIComponent(address)}`;
    logger.debug({ url: searchUrl }, "Hougarden: navigating to search");

    await page.goto(searchUrl, { timeout: 12000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    const pageContent = await page.content();
    logger.debug({ length: pageContent.length }, "Hougarden: page loaded");

    const cvSelectors = [
      '[class*="cv"]',
      '[class*="rateable"]',
      '[class*="capital"]',
      'text=/CV|Capital Value|Rateable Value/i',
    ];
    for (const sel of cvSelectors) {
      try {
        const el = page.locator(sel).first();
        const text = await el.textContent({ timeout: 2000 });
        if (text) {
          const cv = parseNZDollar(text);
          if (cv && cv > 100000) {
            result.cv_nzd = cv;
            break;
          }
        }
      } catch {
        /* try next */
      }
    }

    const pageText = await page.evaluate(() => document.body.innerText);

    const cvPatterns = [
      /CV[:\s]+\$?([\d,]+(?:\.\d+)?(?:[mk])?)/gi,
      /Capital Value[:\s]+\$?([\d,]+(?:\.\d+)?(?:[mk])?)/gi,
      /Rateable Value[:\s]+\$?([\d,]+(?:\.\d+)?(?:[mk])?)/gi,
    ];
    if (!result.cv_nzd) {
      for (const pattern of cvPatterns) {
        const m = pattern.exec(pageText);
        if (m) {
          const cv = parseNZDollar(m[1]);
          if (cv && cv > 100000) {
            result.cv_nzd = cv;
            break;
          }
        }
      }
    }

    const landPatterns = [
      /[Ll]and[:\s]+(\d[\d,\.]+)\s*m[²2]/,
      /[Ll]ot [Ss]ize[:\s]+(\d[\d,\.]+)\s*m/,
      /(\d[\d,\.]+)\s*m[²2]\s+[Ll]and/,
    ];
    for (const p of landPatterns) {
      const m = p.exec(pageText);
      if (m) {
        const area = parseArea(m[1]);
        if (area && area > 10) { result.land_area_sqm = area; break; }
      }
    }

    const floorPatterns = [
      /[Ff]loor[:\s]+(\d[\d,\.]+)\s*m[²2]/,
      /[Ff]loor [Aa]rea[:\s]+(\d[\d,\.]+)\s*m/,
    ];
    for (const p of floorPatterns) {
      const m = p.exec(pageText);
      if (m) {
        const area = parseArea(m[1]);
        if (area && area > 10) { result.floor_area_sqm = area; break; }
      }
    }

    const yearPatterns = [
      /[Bb]uild[:\s]+(\d{4})/,
      /[Bb]uilt[:\s]+(\d{4})/,
      /[Dd]ecade[:\s]+(\d{4})/,
    ];
    for (const p of yearPatterns) {
      const m = p.exec(pageText);
      if (m) {
        const y = parseYear(m[1]);
        if (y) { result.build_year = y; break; }
      }
    }

    const zonePatterns = [
      /[Zz]one[:\s]+([A-Za-z\s\-]+?)(?:\n|,|\|)/,
      /[Zz]oning[:\s]+([A-Za-z\s\-]+?)(?:\n|,|\|)/,
      /(Single House Zone|Mixed Housing Suburban|Mixed Housing Urban|Terrace Housing and Apartment Buildings?|Large Lot Residential|Future Urban Zone|Business[^\n,]+Zone)/i,
    ];
    for (const p of zonePatterns) {
      const m = p.exec(pageText);
      if (m) {
        const zoneText = m[1].trim();
        if (zoneText.length > 2 && zoneText.length < 80) {
          const { code, description } = mapZoneCode(zoneText);
          result.zone_code = code;
          result.zone_description = description;
          break;
        }
      }
    }

    const lowerText = pageText.toLowerCase();
    const foundOverlays = new Set<string>();
    for (const [keyword, overlay] of Object.entries(OVERLAY_MAP)) {
      if (lowerText.includes(keyword) && !foundOverlays.has(overlay.name)) {
        foundOverlays.add(overlay.name);
        result.overlays.push({ name: overlay.name, status: overlay.status, detail: overlay.detail });
      }
    }

    const schoolPatterns = [
      { key: "primary" as const, pattern: /[Pp]rimary[:\s]+([^\n,]+)/  },
      { key: "intermediate" as const, pattern: /[Ii]ntermediate[:\s]+([^\n,]+)/ },
      { key: "secondary" as const, pattern: /[Ss]econdary[:\s]+([^\n,]+)/ },
    ];
    for (const { key, pattern } of schoolPatterns) {
      const m = pattern.exec(pageText);
      if (m) result.school_zones[key] = m[1].trim().slice(0, 80);
    }

    try {
      const mapEl = page.locator('[class*="map"], [class*="overlay"], [id*="map"]').first();
      const box = await mapEl.boundingBox();
      if (box) {
        const screenshot = await page.screenshot({
          clip: { x: box.x, y: box.y, width: Math.min(box.width, 600), height: Math.min(box.height, 400) },
        });
        result.overlay_map_image_base64 = screenshot.toString("base64");
      }
    } catch {
      logger.debug("Hougarden: map screenshot failed (non-critical)");
    }

    logger.debug(
      { cv: result.cv_nzd, zone: result.zone_code, overlays: result.overlays.length },
      "Hougarden: extraction complete",
    );
  } catch (err) {
    logger.warn({ err }, "Hougarden: scrape failed — returning partial data");
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
  }

  return result;
}
