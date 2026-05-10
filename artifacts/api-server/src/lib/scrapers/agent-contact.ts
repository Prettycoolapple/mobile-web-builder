/// <reference lib="dom" />
import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay, logScrapeAttempt, isVercelServerless } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";

export interface AgentContactResult {
  found: boolean;
  isListed: boolean;
  agentName: string | null;
  agentPhone: string | null;
  agencyName: string | null;
  listingUrl: string | null;
  source: string | null;
}

function emptyResult(): AgentContactResult {
  return { found: false, isListed: false, agentName: null, agentPhone: null, agencyName: null, listingUrl: null, source: null };
}

function normalisePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, "");
  if (stripped.startsWith("+64")) return stripped;
  if (stripped.startsWith("0")) return "+64" + stripped.slice(1);
  return stripped;
}

function parseAgent(text: string): Pick<AgentContactResult, "agentName" | "agentPhone" | "agencyName"> {
  let agentName: string | null = null;
  let agentPhone: string | null = null;
  let agencyName: string | null = null;

  // ── Phone extraction ────────────────────────────────────────────────────────
  // NZ formats: 021 xxx xxxx, 022 xxx xxxx, 027 xxx xxxx, +64 21 xxx xxxx,
  // 09 xxx xxxx, 03 xxx xxxx, 0800 xxx xxx
  const phoneRe = /(?:\+64\s?|0)(?:800[\s\-]?\d{6}|[27]\d[\s\-]?\d{3}[\s\-]?\d{4}|[39]\s?\d{3}[\s\-]?\d{4})/g;
  const phones: string[] = [];
  let pm: RegExpExecArray | null;
  while ((pm = phoneRe.exec(text)) !== null) {
    const n = normalisePhone(pm[0]);
    if (n.length >= 11 && !phones.includes(n)) phones.push(n);
  }
  // Prefer mobile numbers (021/022/027/025 → +64 2X...)
  const mobilePhone = phones.find((p) => p.match(/^\+642[0-9]/));
  agentPhone = mobilePhone ?? phones[0] ?? null;

  // ── Agent name extraction ───────────────────────────────────────────────────
  const nameRe = /(?:listed by|agent[:\s]+|contact[:\s]+|presented by|call[:\s]+|enquire[:\s]+)\s*([A-Z][a-z]+ (?:[A-Z][a-z]+ )?[A-Z][a-z]+)/gi;
  let nm: RegExpExecArray | null;
  while ((nm = nameRe.exec(text)) !== null) {
    const candidate = nm[1].trim();
    if (candidate.split(" ").length >= 2) {
      agentName = candidate;
      break;
    }
  }

  // Fallback: look for "Name at Agency" or "Name | Agency" patterns
  if (!agentName) {
    const atRe = /([A-Z][a-z]+ [A-Z][a-z]+)\s+(?:at|from|of|with|@|\|)\s+([A-Z][A-Za-z\s&]+)/;
    const atM = atRe.exec(text);
    if (atM) {
      agentName = atM[1].trim();
      agencyName = atM[2].trim().slice(0, 50);
    }
  }

  // ── Agency name extraction ──────────────────────────────────────────────────
  if (!agencyName) {
    const knownAgencies = [
      "Ray White", "Harcourts", "Barfoot & Thompson", "Barfoot and Thompson",
      "LJ Hooker", "Century 21", "RE/MAX", "Bayleys", "Colliers",
      "Tommy's", "Lodge", "Property Brokers", "Tall Poppy", "First National",
      "Professionals", "EVES", "Mike Pero",
    ];
    for (const agency of knownAgencies) {
      if (text.toLowerCase().includes(agency.toLowerCase())) {
        agencyName = agency;
        break;
      }
    }
  }

  return { agentName, agentPhone, agencyName };
}

async function scrapeAgentViaPlaywright(address: string): Promise<AgentContactResult> {
  const result = emptyResult();
  let browser;
  try {
    browser = await launchBrowser();
    const { context, page } = await newStealthPage(browser);

    // Search by address on OneRoof
    const searchUrl = `https://www.oneroof.co.nz/find?q=${encodeURIComponent(address)}`;
    await page.goto(searchUrl, { timeout: 14000, waitUntil: "domcontentloaded" });
    await randomDelay(1500, 2500);
    await page.evaluate(() => window.scrollBy(0, 300));
    await randomDelay(500, 1000);

    // Find the first listing link
    const firstResult = page
      .locator('a[href*="/residential/"], a[href*="/property/"], [class*="result-card"] a, [class*="listing-card"] a')
      .first();
    const hasResult = await firstResult.count();
    if (!hasResult) {
      logger.debug({ address }, "AgentContact: no listing found on OneRoof search");
      await context.close().catch(() => {});
      return result;
    }

    const href = await firstResult.getAttribute("href").catch(() => null);
    let propertyUrl: string | null = null;
    if (href) {
      propertyUrl = href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`;
      await randomDelay(600, 1000);
      await page.goto(propertyUrl, { timeout: 14000, waitUntil: "domcontentloaded" });
      await randomDelay(1500, 2000);
      await page.evaluate(() => window.scrollBy(0, 600));
      await randomDelay(500, 800);
    }

    const pageText = await page.evaluate(() => document.body.innerText ?? "");

    // Determine if this is an active listing (for-sale page)
    const isForSale =
      /for[\s\-]?sale|asking price|enquire now|price on application|POA|make an offer/i.test(pageText);

    if (!isForSale) {
      logger.debug({ address }, "AgentContact: property not actively listed");
      result.found = true;
      result.isListed = false;
      await context.close().catch(() => {});
      return result;
    }

    result.found = true;
    result.isListed = true;
    result.listingUrl = propertyUrl;

    const parsed = parseAgent(pageText);
    result.agentName = parsed.agentName;
    result.agentPhone = parsed.agentPhone;
    result.agencyName = parsed.agencyName;
    result.source = "oneroof";

    await context.close().catch(() => {});
    logScrapeAttempt("AgentContact", "playwright", !!result.agentName, `agent=${result.agentName ?? "not found"}`);
  } finally {
    await browser?.close().catch(() => {});
  }
  return result;
}

async function scrapeAgentViaBee(address: string): Promise<AgentContactResult | null> {
  const searchUrl = `https://www.oneroof.co.nz/find?q=${encodeURIComponent(address)}`;
  const html = await fetchWithScrapingBee(searchUrl, { render_js: true, premium_proxy: false, wait: 3500 });
  if (!html || html.length < 500) return null;

  const { load } = await import("cheerio");
  const $ = load(html);

  const firstLink = $('a[href*="/residential/for-sale"], a[href*="/residential/"][href*="-for-sale"], a[href*="/property/"]').first().attr("href");
  if (!firstLink) return null;

  const propertyUrl = firstLink.startsWith("http") ? firstLink : `https://www.oneroof.co.nz${firstLink}`;
  const propHtml = await fetchWithScrapingBee(propertyUrl, { render_js: true, premium_proxy: false, wait: 3500 });
  if (!propHtml || propHtml.length < 500) return null;

  const $prop = load(propHtml);
  const pageText = $prop("body").text();

  const isForSale = /for[\s\-]?sale|asking price|enquire now|price on application|POA/i.test(pageText);
  if (!isForSale) {
    return { found: true, isListed: false, agentName: null, agentPhone: null, agencyName: null, listingUrl: propertyUrl, source: null };
  }

  const parsed = parseAgent(pageText);
  logScrapeAttempt("AgentContact", "scrapingbee", !!parsed.agentName, `agent=${parsed.agentName ?? "not found"}`);

  return {
    found: true,
    isListed: true,
    agentName: parsed.agentName,
    agentPhone: parsed.agentPhone,
    agencyName: parsed.agencyName,
    listingUrl: propertyUrl,
    source: "oneroof",
  };
}

export async function scrapeListingAgent(address: string): Promise<AgentContactResult> {
  if (isVercelServerless()) {
    try {
      const beeFirst = await scrapeAgentViaBee(address);
      if (beeFirst && beeFirst.found) {
        logScrapeAttempt("AgentContact", "scrapingbee", !!beeFirst.agentName, "Vercel: Playwright unavailable");
        return beeFirst;
      }
    } catch (err) {
      logScrapeAttempt("AgentContact", "scrapingbee", false, String(err));
    }
  }

  try {
    const result = await Promise.race([
      scrapeAgentViaPlaywright(address),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Playwright timeout")), 20000)),
    ]);
    if (result.found) return result;
    logScrapeAttempt("AgentContact", "playwright", false, "not found — trying ScrapingBee");
  } catch (err) {
    logScrapeAttempt("AgentContact", "playwright", false, String(err));
  }

  try {
    const result = await scrapeAgentViaBee(address);
    if (result) return result;
  } catch (err) {
    logScrapeAttempt("AgentContact", "scrapingbee", false, String(err));
  }

  logger.warn({ address }, "AgentContact: all scrape attempts failed");
  return emptyResult();
}
