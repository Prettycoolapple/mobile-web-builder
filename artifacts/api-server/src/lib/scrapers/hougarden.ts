/// <reference lib="dom" />
import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay, logScrapeAttempt } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import type { Overlay } from "../auckland-council";
import { mapNZContour } from "./qv";

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
  contour_text: string | null;
  contour_classification: "flat" | "gentle" | "moderate" | "steep" | null;
}

export function emptyHougardenData(): HougardenData {
  return {
    cv_nzd: null, land_area_sqm: null, floor_area_sqm: null, build_year: null,
    zone_code: null, zone_description: null, overlays: [],
    school_zones: { primary: null, intermediate: null, secondary: null },
    overlay_map_image_base64: null, data_source: "hougarden", scraped_at: new Date().toISOString(),
    contour_text: null, contour_classification: null,
  };
}

const OVERLAY_MAP: Record<string, { name: string; status: Overlay["status"]; detail: string }> = {
  "flood": { name: "Flood Plain", status: "restricted", detail: "Flood sensitivity overlay — Engineering report and NES-F compliance required." },
  "heritage": { name: "Heritage", status: "restricted", detail: "Historic Heritage Overlay — demolition or alteration requires Resource Consent." },
  "notable tree": { name: "Notable Trees", status: "moderate", detail: "Notable tree on or near site — removal requires Resource Consent." },
  "volcanic": { name: "Volcanic Viewshaft", status: "restricted", detail: "Volcanic Viewshaft — height restrictions apply, may be below zone standard." },
  "viewshaft": { name: "Viewshaft", status: "restricted", detail: "Viewshaft overlay — additional height assessment required at Resource Consent." },
  "coastal": { name: "Coastal Inundation", status: "restricted", detail: "Coastal Inundation Area — floor level controls and NES-F compliance required." },
  "overland": { name: "Overland Flow Path", status: "moderate", detail: "Overland Flow Path — stormwater management plan required." },
  "waitakere": { name: "Waitakere Ranges Heritage", status: "restricted", detail: "Waitakere Ranges Heritage Area — strict development controls." },
  "ridgeline": { name: "Ridgeline Protection", status: "moderate", detail: "Ridgeline Protection Overlay — skyline development controls apply." },
};

function parseNZDollar(text: string): number | null {
  const clean = text.replace(/[,$\s]/g, "");
  const m = clean.match(/([\d.]+)([mk]?)/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (isNaN(v) || v <= 0) return null;
  const suffix = m[2].toLowerCase();
  if (suffix === "m") v *= 1_000_000;
  if (suffix === "k") v *= 1_000;
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
  return y >= 1800 && y <= new Date().getFullYear() ? y : null;
}

function mapZoneCode(text: string): { code: string; description: string } {
  const lower = text.toLowerCase();
  const ZONE_MAP: [string, string, string][] = [
    ["mixed housing suburban", "MHS", "Mixed Housing Suburban"],
    ["mixed housing urban", "MHU", "Mixed Housing Urban"],
    ["terrace housing", "THAB", "Terrace Housing and Apartment Buildings"],
    ["single house", "SHZ", "Single House Zone"],
    ["large lot", "LLRZ", "Large Lot Residential Zone"],
    ["rural and coastal", "RCSZ", "Rural and Coastal Settlement Zone"],
    ["low density", "LDRZ", "Low Density Residential Zone"],
    ["future urban", "FUZ", "Future Urban Zone"],
    ["city centre", "CCZ", "Business - City Centre Zone"],
    ["general business", "GBZ", "Business - General Business Zone"],
    ["light industry", "BPIZ", "Business - Light Industry Zone"],
    ["local centre", "LCZ", "Business - Local Centre Zone"],
    ["metropolitan", "MCZ", "Business - Metropolitan Centre Zone"],
    ["mixed use", "MUZ", "Business - Mixed Use Zone"],
    ["town centre", "TCZ", "Business - Town Centre Zone"],
  ];
  for (const [key, code, description] of ZONE_MAP) {
    if (lower.includes(key)) return { code, description };
  }
  const codeMatch = text.match(/\b(MHS|MHU|THAB|SHZ|LLRZ|RCSZ|LDRZ|FUZ|BPZ|CCZ|GBZ|BPIZ|LCZ|MCZ|MUZ|NCZ|TCZ)\b/i);
  if (codeMatch) return { code: codeMatch[1].toUpperCase(), description: text.trim() };
  return { code: text.trim().toUpperCase().slice(0, 6), description: text.trim() };
}

function extractDataFromText(pageText: string): Partial<HougardenData> {
  const result: Partial<HougardenData> = { overlays: [], school_zones: { primary: null, intermediate: null, secondary: null } };

  const cvPatterns = [
    /CV[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i,
    /Capital Value[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i,
    /Rateable Value[:\s$]+([0-9,]+(?:\.[0-9]+)?(?:[mk])?)/i,
  ];
  for (const p of cvPatterns) {
    const m = p.exec(pageText);
    if (m) { const cv = parseNZDollar(m[1]); if (cv && cv > 100_000) { result.cv_nzd = cv; break; } }
  }

  const landM = /[Ll]and\s*(?:[Aa]rea)?[:\s]+([0-9,]+\.?[0-9]*)\s*m/.exec(pageText);
  if (landM) { const a = parseArea(landM[1]); if (a && a > 10) result.land_area_sqm = a; }

  const floorM = /[Ff]loor\s*(?:[Aa]rea)?[:\s]+([0-9,]+\.?[0-9]*)\s*m/.exec(pageText);
  if (floorM) { const a = parseArea(floorM[1]); if (a && a > 10) result.floor_area_sqm = a; }

  const yearM = /(?:[Bb]uilt?|[Bb]uild|[Dd]ecade)[:\s]+(\d{4})/.exec(pageText);
  if (yearM) { const y = parseYear(yearM[1]); if (y) result.build_year = y; }

  const zonePatterns = [
    /(Single House Zone|Mixed Housing Suburban|Mixed Housing Urban|Terrace Housing and Apartment|Large Lot Residential|Future Urban Zone|General Business Zone|Local Centre Zone|Town Centre Zone|Mixed Use Zone)/i,
    /[Zz]one[:\s]+([A-Za-z\s\-]{3,50}?)(?:\n|,|\|)/,
    /[Zz]oning[:\s]+([A-Za-z\s\-]{3,50}?)(?:\n|,|\|)/,
  ];
  for (const p of zonePatterns) {
    const m = p.exec(pageText);
    if (m) {
      const { code, description } = mapZoneCode(m[1].trim());
      if (code.length >= 2) { result.zone_code = code; result.zone_description = description; break; }
    }
  }

  const lowerText = pageText.toLowerCase();
  const foundOverlays = new Set<string>();
  result.overlays = [];
  for (const [kw, ov] of Object.entries(OVERLAY_MAP)) {
    if (lowerText.includes(kw) && !foundOverlays.has(ov.name)) {
      foundOverlays.add(ov.name);
      result.overlays.push({ name: ov.name, status: ov.status, detail: ov.detail });
    }
  }

  for (const { key, pattern } of [
    { key: "primary" as const, pattern: /[Pp]rimary\s*[Ss]chool[:\s]+([^\n,]{3,60})/ },
    { key: "intermediate" as const, pattern: /[Ii]ntermediate\s*[Ss]chool[:\s]+([^\n,]{3,60})/ },
    { key: "secondary" as const, pattern: /[Ss]econdary\s*[Ss]chool[:\s]+([^\n,]{3,60})/ },
  ]) {
    const m = pattern.exec(pageText);
    if (m && result.school_zones) result.school_zones[key] = m[1].trim().slice(0, 80);
  }

  const contourM = pageText.match(/\bcontour[:\s\n]+([A-Za-z][A-Za-z /]{1,30}?)(?:\n|\r|$)/im);
  if (contourM) {
    const raw = contourM[1].trim().replace(/\s+/g, " ");
    result.contour_text = raw;
    result.contour_classification = mapNZContour(raw);
  }

  return result;
}

function hasUsefulData(data: HougardenData | Partial<HougardenData>): boolean {
  return !!(data.zone_code || (data.overlays && data.overlays.length > 0) || data.cv_nzd || data.land_area_sqm);
}

const PLAYWRIGHT_TIMEOUT_MS = 16000;

async function scrapeHougardenPlaywright(lat: number, lng: number, address: string): Promise<HougardenData> {
  const result = emptyHougardenData();
  let browser;
  try {
    browser = await launchBrowser();
    const { context, page } = await newStealthPage(browser);

    const searchUrl = `https://www.hougarden.com/search/#ac=1&address=${encodeURIComponent(address)}`;
    await page.goto(searchUrl, { timeout: 12000, waitUntil: "domcontentloaded" });
    await randomDelay(1500, 2500);

    await page.evaluate(() => window.scrollBy(0, 300));
    await randomDelay(500, 1000);

    const pageText = await page.evaluate(() => document.body.innerText || "");
    const extracted = extractDataFromText(pageText);
    Object.assign(result, extracted);

    if (hasUsefulData(result)) {
      try {
        const mapEl = page.locator('[class*="map"], [class*="overlay-map"], [id*="map"]').first();
        const box = await mapEl.boundingBox().catch(() => null);
        if (box) {
          const shot = await page.screenshot({
            clip: { x: box.x, y: box.y, width: Math.min(box.width, 600), height: Math.min(box.height, 400) },
          });
          result.overlay_map_image_base64 = shot.toString("base64");
        }
      } catch { /* screenshot is non-critical */ }
    }

    await context.close().catch(() => {});
  } finally {
    await browser?.close().catch(() => {});
  }
  return result;
}

async function scrapeHougardenViaBee(address: string): Promise<HougardenData | null> {
  const searchUrl = `https://www.hougarden.com/search/#ac=1&address=${encodeURIComponent(address)}`;
  const html = await fetchWithScrapingBee(searchUrl, { render_js: true, premium_proxy: false, wait: 3000 });
  if (!html || html.length < 500) return null;

  const { load } = await import("cheerio");
  const $ = load(html);
  const pageText = $("body").text();

  const extracted = extractDataFromText(pageText);
  if (!hasUsefulData(extracted)) return null;

  return { ...emptyHougardenData(), ...extracted, scraped_at: new Date().toISOString() };
}

export async function scrapeHougarden(lat: number, lng: number, address: string): Promise<HougardenData> {
  try {
    const result = await Promise.race([
      scrapeHougardenPlaywright(lat, lng, address),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Playwright timeout")), PLAYWRIGHT_TIMEOUT_MS)),
    ]);
    if (hasUsefulData(result)) {
      logScrapeAttempt("Hougarden", "stealth-playwright", true, `zone=${result.zone_code}, overlays=${result.overlays.length}`);
      return result;
    }
    logScrapeAttempt("Hougarden", "stealth-playwright", false, "no useful data extracted — trying ScrapingBee");
  } catch (err) {
    logScrapeAttempt("Hougarden", "stealth-playwright", false, String(err));
  }

  try {
    const result = await scrapeHougardenViaBee(address);
    if (result) {
      logScrapeAttempt("Hougarden", "scrapingbee", true, `zone=${result.zone_code}, overlays=${result.overlays.length}`);
      return result;
    }
  } catch (err) {
    logScrapeAttempt("Hougarden", "scrapingbee", false, String(err));
  }

  logger.warn("Hougarden: all attempts failed — returning empty data");
  return emptyHougardenData();
}
