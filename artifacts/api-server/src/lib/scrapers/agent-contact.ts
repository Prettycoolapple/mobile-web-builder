/// <reference lib="dom" />
import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay, logScrapeAttempt, isVercelServerless } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import { fetchRealestateAgentContactForAddress } from "./realestate-api";
import { type SelectedListingContext } from "../selected-listing-context";
import { resolveActiveListingContext } from "../active-listing-context";

export interface AgentContactResult {
  found: boolean;
  isListed: boolean;
  matchType: "subject" | "suburb" | null;
  listingAddress: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agencyName: string | null;
  agentAvatarUrl: string | null;
  listingUrl: string | null;
  source: string | null;
}

function emptyResult(): AgentContactResult {
  return { found: false, isListed: false, matchType: null, listingAddress: null, agentName: null, agentPhone: null, agencyName: null, agentAvatarUrl: null, listingUrl: null, source: null };
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
  const blockedNameCandidate = /make an enquiry|contact details|request viewing|open home|asking price/i;

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
    if (candidate.split(" ").length >= 2 && !blockedNameCandidate.test(candidate)) {
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
      "Professionals", "EVES", "Mike Pero", "The Kings Of Real Estate", "The Kings of Real Estate",
    ];
    for (const agency of knownAgencies) {
      if (text.toLowerCase().includes(agency.toLowerCase())) {
        agencyName = agency;
        break;
      }
    }
  }

  if (!agentName) {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .filter(Boolean);
    const blocked = /property|listing|details|contact|agency|licensed|real estate|watchlist|gallery|description|schools|advertisement|home loan|asking price|open home|enquire|enquiry|make|premium/i;
    const nameLine = lines.find((line, idx) => {
      if (blocked.test(line)) return false;
      if (!/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(line)) return false;
      const nearby = lines.slice(Math.max(0, idx - 3), idx + 4).join(" ");
      return /agent|agency|contact|enquire|premium|licensed|real estate|ray white|harcourts|barfoot|bayleys|the kings/i.test(nearby);
    });
    if (nameLine) agentName = nameLine;
  }

  return { agentName, agentPhone, agencyName };
}

function listingUrlLikelyActive(url: string): boolean {
  return /\/sale\/|for-sale|\/find\/buy|\/property\/|homes\.co\.nz\/address/i.test(url);
}

export function extractAgentContactFromListingHtml(
  html: string,
  listingUrl: string,
): AgentContactResult {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&");
  const isListed =
    listingUrlLikelyActive(listingUrl) ||
    /for[\s-]?sale|asking price|enquire|make an enquiry|request a viewing|open home|contact details|listed:/i.test(text);
  const parsed = parseAgent(text);
  return {
    found: true,
    isListed,
    matchType: isListed ? "subject" : null,
    listingAddress: null,
    agentName: parsed.agentName,
    agentPhone: parsed.agentPhone,
    agencyName: parsed.agencyName,
    agentAvatarUrl: null,
    listingUrl,
    source: inferAgentSourceFromUrl(listingUrl),
  };
}

function inferAgentSourceFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes("trademe.co.nz")) return "trademe";
    if (host.includes("homes.co.nz")) return "homes";
    if (host.includes("oneroof.co.nz")) return "oneroof";
    if (host.includes("realestate.co.nz")) return "realestate.co.nz";
    return host.replace(/^www\./, "");
  } catch {
    return "listing-page";
  }
}

async function scrapeAgentViaSelectedListingUrl(
  listingUrl: string,
  selectedListingContext?: SelectedListingContext | null,
): Promise<AgentContactResult | null> {
  if (!/^https?:\/\//i.test(listingUrl)) return null;
  if (/realestate\.co\.nz/i.test(listingUrl)) return null;
  const html = await fetchWithScrapingBee(listingUrl, { render_js: true, premium_proxy: false, wait: 3000 });
  if (!html || html.length < 500) {
    if (selectedListingContext?.listingUrl) {
      return {
        ...emptyResult(),
        found: true,
        isListed: true,
        matchType: "subject",
        listingAddress: selectedListingContext.address ?? null,
        agentName: selectedListingContext.agentName ?? null,
        agentPhone: selectedListingContext.agentPhone ?? null,
        agencyName: selectedListingContext.agencyName ?? null,
        listingUrl,
        source: inferAgentSourceFromUrl(listingUrl),
      };
    }
    return null;
  }
  const result = extractAgentContactFromListingHtml(html, listingUrl);
  result.listingAddress = selectedListingContext?.address ?? result.listingAddress;
  if (!result.agentName && selectedListingContext?.source) result.source = selectedListingContext.source;
  logScrapeAttempt("AgentContact", result.source ?? "listing-page", result.isListed, `agent=${result.agentName ?? "not found"}`);
  return result;
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
    result.matchType = "subject";
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
    return { found: true, isListed: false, matchType: null, listingAddress: null, agentName: null, agentPhone: null, agencyName: null, agentAvatarUrl: null, listingUrl: propertyUrl, source: null };
  }

  const parsed = parseAgent(pageText);
  logScrapeAttempt("AgentContact", "scrapingbee", !!parsed.agentName, `agent=${parsed.agentName ?? "not found"}`);

  return {
    found: true,
    isListed: true,
    matchType: "subject",
    listingAddress: null,
    agentName: parsed.agentName,
    agentPhone: parsed.agentPhone,
    agencyName: parsed.agencyName,
    agentAvatarUrl: null,
    listingUrl: propertyUrl,
    source: "oneroof",
  };
}

export async function scrapeListingAgent(
  address: string,
  options: { allowSuburbFallback?: boolean; listingUrl?: string | null; selectedListingContext?: SelectedListingContext | null } = {},
): Promise<AgentContactResult> {
  const lookupAddress = options.selectedListingContext?.isCombinedListing && options.selectedListingContext.packageAddress
    ? options.selectedListingContext.packageAddress
    : address;
  const selectedUrl = options.selectedListingContext?.listingUrl ?? options.listingUrl ?? null;
  if (selectedUrl && !/realestate\.co\.nz/i.test(selectedUrl)) {
    try {
      const selected = await scrapeAgentViaSelectedListingUrl(selectedUrl, options.selectedListingContext);
      if (selected?.isListed) return selected;
    } catch (err) {
      logScrapeAttempt("AgentContact", "selected-listing-url", false, String(err));
    }
  }

  try {
    const realestateAgent = await fetchRealestateAgentContactForAddress(lookupAddress);
    if (realestateAgent) {
      logScrapeAttempt("AgentContact", "realestate-api", !!realestateAgent.agentPhone, `agent=${realestateAgent.agentName ?? "found"}`);
      return {
        found: true,
        isListed: true,
        matchType: "subject",
        listingAddress: realestateAgent.listingAddress,
        agentName: realestateAgent.agentName,
        agentPhone: realestateAgent.agentPhone,
        agencyName: realestateAgent.agencyName,
        agentAvatarUrl: realestateAgent.agentAvatarUrl,
        listingUrl: realestateAgent.listingUrl,
        source: "realestate-api",
      };
    }
  } catch (err) {
    logScrapeAttempt("AgentContact", "realestate-api", false, String(err));
  }

  if (selectedUrl) {
    return {
      ...emptyResult(),
      found: true,
      isListed: true,
      matchType: "subject",
      listingAddress: options.selectedListingContext?.address ?? address,
      listingUrl: selectedUrl,
      source: options.selectedListingContext?.source ?? inferAgentSourceFromUrl(selectedUrl),
    };
  }

  try {
    const resolved = await resolveActiveListingContext(lookupAddress, {
      purpose: "agent_contact",
      selectedListingContext: options.selectedListingContext ?? null,
    });
    const ctx = resolved.context;
    if (ctx?.listingUrl || ctx?.agentName || ctx?.agencyName) {
      if (ctx.listingUrl && !/realestate\.co\.nz/i.test(ctx.listingUrl)) {
        const selected = await scrapeAgentViaSelectedListingUrl(ctx.listingUrl, ctx).catch(() => null);
        if (selected?.isListed) return selected;
      }
      return {
        ...emptyResult(),
        found: true,
        isListed: true,
        matchType: "subject",
        listingAddress: ctx.address ?? lookupAddress,
        agentName: ctx.agentName ?? null,
        agentPhone: ctx.agentPhone ?? null,
        agencyName: ctx.agencyName ?? null,
        listingUrl: ctx.listingUrl ?? null,
        source: ctx.source ?? (ctx.listingUrl ? inferAgentSourceFromUrl(ctx.listingUrl) : "active-listing"),
      };
    }
  } catch (err) {
    logScrapeAttempt("AgentContact", "active-listing-resolver", false, String(err));
  }

  logger.info({ address }, "AgentContact: no exact active realestate.co.nz listing match");
  return { ...emptyResult(), found: true, isListed: false };
}
