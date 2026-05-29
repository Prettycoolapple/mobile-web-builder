/// <reference lib="dom" />
import { logger } from "../logger";
import { launchBrowser, newStealthPage, randomDelay, logScrapeAttempt, isVercelServerless } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import {
  fetchRealestateAgentContactForAddress,
  fetchRealestateAgentContactByListingUrl,
} from "./realestate-api";
import { oneRoofPathnameMatchesAddress } from "./oneroof";
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

    // Iterate through OneRoof search results and pick the FIRST link whose
    // pathname matches the queried address slug. Prevents "8 Hampton Drive"
    // queries from landing on "18 Hampton Drive" by mistake.
    const candidates = page.locator('a[href*="/property/"], a[href*="/residential/"]');
    const count = await candidates.count();
    let propertyUrl: string | null = null;
    for (let i = 0; i < Math.min(count, 12); i++) {
      const href = await candidates.nth(i).getAttribute("href").catch(() => null);
      if (!href) continue;
      const full = href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`;
      try {
        if (oneRoofPathnameMatchesAddress(new URL(full).pathname, address)) {
          propertyUrl = full;
          break;
        }
      } catch { /* skip malformed */ }
    }
    if (!propertyUrl) {
      logger.debug({ address, candidatesChecked: Math.min(count, 12) }, "AgentContact: no OneRoof result matched address slug");
      await context.close().catch(() => {});
      return result;
    }

    await randomDelay(600, 1000);
    await page.goto(propertyUrl, { timeout: 14000, waitUntil: "domcontentloaded" });
    await randomDelay(1500, 2000);
    await page.evaluate(() => window.scrollBy(0, 600));
    await randomDelay(500, 800);

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

  // Iterate through candidate property/residential links and pick the FIRST
  // one whose pathname matches the queried address slug. Prevents the
  // "first-result-wins" bug where OneRoof lists a neighbour first.
  const links = $('a[href*="/residential/for-sale"], a[href*="/residential/"][href*="-for-sale"], a[href*="/property/"]').toArray();
  let propertyUrl: string | null = null;
  for (const el of links.slice(0, 12)) {
    const href = $(el).attr("href");
    if (!href) continue;
    const full = href.startsWith("http") ? href : `https://www.oneroof.co.nz${href}`;
    try {
      if (oneRoofPathnameMatchesAddress(new URL(full).pathname, address)) {
        propertyUrl = full;
        break;
      }
    } catch { /* skip malformed */ }
  }
  if (!propertyUrl) {
    logger.debug({ address, candidatesChecked: Math.min(links.length, 12) }, "AgentContact ScrapingBee: no OneRoof result matched address slug");
    return null;
  }

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

type AgentPartial = Pick<AgentContactResult, "agentName" | "agentPhone" | "agencyName" | "agentAvatarUrl">;

async function scrapeRealestateListingPageViaPlaywright(listingUrl: string): Promise<AgentPartial | null> {
  let browser;
  try {
    browser = await launchBrowser();
    const { context, page } = await newStealthPage(browser);
    await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await randomDelay(2000, 3000);
    await page.evaluate(() => window.scrollBy(0, 600));
    await randomDelay(1000, 1500);

    // Try to click the phone reveal button
    const phoneButtonSelectors = [
      'button:has-text("Call")',
      'button:has-text("Reveal")',
      'a[href^="tel:"]',
      '[data-testid*="phone"]',
    ];
    for (const sel of phoneButtonSelectors) {
      try {
        const btn = page.locator(sel).first();
        if ((await btn.count()) > 0) {
          await btn.click({ timeout: 3000 });
          await randomDelay(1500, 2000);
          break;
        }
      } catch { /* selector not found, try next */ }
    }

    const pageText = await page.evaluate(() => (document as any).body?.innerText ?? "");
    const parsed = parseAgent(pageText);

    // Extract agent avatar from img element near agent card
    const agentAvatarUrl = await page.evaluate(() => {
      const img = document.querySelector(
        'img[class*="agent" i], img[class*="Agent"], [class*="agent-card" i] img, [class*="AgentCard"] img, [class*="agent-photo" i] img',
      ) as HTMLImageElement | null;
      return img?.src ?? null;
    });

    await context.close().catch(() => {});
    logScrapeAttempt("AgentContact", "realestate-listing-playwright", !!parsed.agentPhone, `phone=${parsed.agentPhone ?? "not found"}`);
    return { agentName: parsed.agentName, agentPhone: parsed.agentPhone, agencyName: parsed.agencyName, agentAvatarUrl };
  } catch (err) {
    logger.warn({ err: (err as Error).message, listingUrl }, "AgentContact: realestate listing playwright failed");
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

async function scrapeRealestateListingPageViaBee(listingUrl: string): Promise<AgentPartial | null> {
  // Target the phone-reveal button precisely. Earlier this used `click: "button"`
  // which clicked the FIRST button on the page — typically a cookie banner or
  // nav menu, not the reveal-phone control. The `evaluate` step searches all
  // buttons/links for text matching /^(call|reveal|show phone|show number)/i
  // and clicks the first match, which is the phone reveal on realestate.co.nz.
  const html = await fetchWithScrapingBee(listingUrl, {
    render_js: true,
    premium_proxy: false,
    wait: 4000,
    js_scenario: {
      instructions: [
        { scroll_y: 600 },
        { wait: 1500 },
        {
          evaluate: `const btn = Array.from(document.querySelectorAll('button, a')).find((el) => /^(call|reveal|show phone|show number)/i.test((el.textContent || '').trim())); if (btn) btn.click();`,
        },
        { wait: 2500 },
        { scroll_y: 800 },
        { wait: 1000 },
      ],
    },
  });
  if (!html || html.length < 500) return null;

  const { load } = await import("cheerio");
  const $ = load(html);
  const pageText = $("body").text();
  const parsed = parseAgent(pageText);

  let agentAvatarUrl: string | null = null;
  for (const sel of ['img[class*="agent" i]', '[class*="agent-card" i] img', '[class*="AgentCard"] img']) {
    const src = $(sel).first().attr("src");
    if (src?.startsWith("http")) { agentAvatarUrl = src; break; }
  }

  logScrapeAttempt("AgentContact", "realestate-listing-bee", !!parsed.agentPhone, `phone=${parsed.agentPhone ?? "not found"}`);
  return { agentName: parsed.agentName, agentPhone: parsed.agentPhone, agencyName: parsed.agencyName, agentAvatarUrl };
}

async function scrapeRealestateListingPageForAgent(listingUrl: string): Promise<AgentPartial | null> {
  if (isVercelServerless()) return scrapeRealestateListingPageViaBee(listingUrl);
  return scrapeRealestateListingPageViaPlaywright(listingUrl);
}

export async function scrapeListingAgent(
  address: string,
  options: { allowSuburbFallback?: boolean; listingUrl?: string | null; selectedListingContext?: SelectedListingContext | null } = {},
): Promise<AgentContactResult> {
  const lookupAddress = options.selectedListingContext?.isCombinedListing && options.selectedListingContext.packageAddress
    ? options.selectedListingContext.packageAddress
    : address;
  const selectedUrl = options.selectedListingContext?.listingUrl ?? options.listingUrl ?? null;

  // Capture agent fields the discovery card already gave us (from
  // SelectedListingContext). Used as defaults whenever a downstream lookup
  // returns null for the same field, so the user always sees the strongest
  // available info instead of "房源中介" / "房地产公司" placeholders.
  const ctxAgentName = options.selectedListingContext?.agentName ?? null;
  const ctxAgentPhone = options.selectedListingContext?.agentPhone ?? null;
  const ctxAgencyName = options.selectedListingContext?.agencyName ?? null;

  // 1. Non-realestate.co.nz selectedUrl (e.g. OneRoof/TradeMe from a discovery card)
  if (selectedUrl && !/realestate\.co\.nz/i.test(selectedUrl)) {
    try {
      const selected = await scrapeAgentViaSelectedListingUrl(selectedUrl, options.selectedListingContext);
      if (selected?.isListed) {
        // Backfill null fields from the discovery card if present
        selected.agentName = selected.agentName ?? ctxAgentName;
        selected.agentPhone = selected.agentPhone ?? ctxAgentPhone;
        selected.agencyName = selected.agencyName ?? ctxAgencyName;
        return selected;
      }
    } catch (err) {
      logScrapeAttempt("AgentContact", "selected-listing-url", false, String(err));
    }
  }

  // 2. Direct realestate.co.nz listing lookup by URL (discovery route, exact match)
  //    — bypasses fragile address matching when we already have the listing URL.
  let realestateAgent: Awaited<ReturnType<typeof fetchRealestateAgentContactForAddress>> | null = null;
  if (selectedUrl && /realestate\.co\.nz/i.test(selectedUrl)) {
    try {
      realestateAgent = await fetchRealestateAgentContactByListingUrl(selectedUrl);
      logScrapeAttempt("AgentContact", "realestate-listing-by-url", !!realestateAgent?.agentPhone, `agent=${realestateAgent?.agentName ?? "not found"}`);
    } catch (err) {
      logScrapeAttempt("AgentContact", "realestate-listing-by-url", false, String(err));
    }
  }

  // 3. Address-matched realestate.co.nz Platform API (fallback for direct address search)
  if (!realestateAgent) {
    try {
      realestateAgent = await fetchRealestateAgentContactForAddress(lookupAddress);
      logScrapeAttempt("AgentContact", "realestate-api", !!realestateAgent?.agentPhone, `agent=${realestateAgent?.agentName ?? "not found"}`);
    } catch (err) {
      logScrapeAttempt("AgentContact", "realestate-api", false, String(err));
    }
  }

  if (realestateAgent) {
    if (realestateAgent.agentPhone) {
      return {
        found: true,
        isListed: true,
        matchType: "subject",
        listingAddress: realestateAgent.listingAddress,
        agentName: realestateAgent.agentName ?? ctxAgentName,
        agentPhone: realestateAgent.agentPhone,
        agencyName: realestateAgent.agencyName ?? ctxAgencyName,
        agentAvatarUrl: realestateAgent.agentAvatarUrl,
        listingUrl: realestateAgent.listingUrl ?? selectedUrl,
        source: "realestate-api",
      };
    }
    // 4. Phone gated behind reveal button — scrape the listing page directly
    const pageUrl = realestateAgent.listingUrl ?? (selectedUrl && /realestate\.co\.nz/i.test(selectedUrl) ? selectedUrl : null);
    if (pageUrl) {
      try {
        const scraped = await scrapeRealestateListingPageForAgent(pageUrl);
        if (scraped?.agentPhone) {
          return {
            found: true,
            isListed: true,
            matchType: "subject",
            listingAddress: realestateAgent.listingAddress,
            agentName: scraped.agentName ?? realestateAgent.agentName ?? ctxAgentName,
            agentPhone: scraped.agentPhone,
            agencyName: scraped.agencyName ?? realestateAgent.agencyName ?? ctxAgencyName,
            agentAvatarUrl: scraped.agentAvatarUrl ?? realestateAgent.agentAvatarUrl,
            listingUrl: pageUrl,
            source: "realestate-listing-page",
          };
        }
      } catch (err) {
        logScrapeAttempt("AgentContact", "realestate-listing-page", false, String(err));
      }
    }

    // 5. OneRoof fallback (the proven path from a week ago). Public listing
    //    pages embed agent name/phone/agency in rendered text that parseAgent
    //    can extract — works even when realestate's Reveal button is gated.
    try {
      const oneRoofAgent = await scrapeAgentViaBee(lookupAddress);
      if (oneRoofAgent?.found && (oneRoofAgent.agentPhone || oneRoofAgent.agentName)) {
        return {
          found: true,
          isListed: true,
          matchType: "subject",
          listingAddress: realestateAgent.listingAddress ?? oneRoofAgent.listingAddress,
          agentName: oneRoofAgent.agentName ?? realestateAgent.agentName ?? ctxAgentName,
          agentPhone: oneRoofAgent.agentPhone ?? ctxAgentPhone,
          agencyName: oneRoofAgent.agencyName ?? realestateAgent.agencyName ?? ctxAgencyName,
          agentAvatarUrl: realestateAgent.agentAvatarUrl,
          listingUrl: realestateAgent.listingUrl ?? oneRoofAgent.listingUrl ?? selectedUrl,
          source: "oneroof",
        };
      }
    } catch (err) {
      logScrapeAttempt("AgentContact", "oneroof-bee-fallback", false, String(err));
    }

    // 6. Local-dev Playwright fallback (no-op on Vercel where Playwright fails fast)
    if (!isVercelServerless()) {
      try {
        const playwrightAgent = await Promise.race([
          scrapeAgentViaPlaywright(lookupAddress),
          new Promise<AgentContactResult>((_, reject) => setTimeout(() => reject(new Error("Playwright timeout")), 20000)),
        ]);
        if (playwrightAgent?.found && (playwrightAgent.agentPhone || playwrightAgent.agentName)) {
          return {
            found: true,
            isListed: true,
            matchType: "subject",
            listingAddress: realestateAgent.listingAddress ?? playwrightAgent.listingUrl,
            agentName: playwrightAgent.agentName ?? realestateAgent.agentName ?? ctxAgentName,
            agentPhone: playwrightAgent.agentPhone ?? ctxAgentPhone,
            agencyName: playwrightAgent.agencyName ?? realestateAgent.agencyName ?? ctxAgencyName,
            agentAvatarUrl: realestateAgent.agentAvatarUrl,
            listingUrl: realestateAgent.listingUrl ?? playwrightAgent.listingUrl ?? selectedUrl,
            source: "oneroof",
          };
        }
      } catch (err) {
        logScrapeAttempt("AgentContact", "oneroof-playwright-fallback", false, String(err));
      }
    }

    // 7. Return partial — realestate found the listing but no agent details.
    //    Backfill with discovery card defaults so the bubble still shows
    //    something useful instead of placeholders.
    return {
      found: true,
      isListed: true,
      matchType: "subject",
      listingAddress: realestateAgent.listingAddress,
      agentName: realestateAgent.agentName ?? ctxAgentName,
      agentPhone: ctxAgentPhone,
      agencyName: realestateAgent.agencyName ?? ctxAgencyName,
      agentAvatarUrl: realestateAgent.agentAvatarUrl,
      listingUrl: realestateAgent.listingUrl ?? selectedUrl,
      source: "realestate-api",
    };
  }

  // 8. No realestate.co.nz match — try OneRoof directly. Some listings only
  //    surface there (e.g. boutique agencies, rural).
  try {
    const oneRoofAgent = await scrapeAgentViaBee(lookupAddress);
    if (oneRoofAgent?.isListed) {
      oneRoofAgent.agentName = oneRoofAgent.agentName ?? ctxAgentName;
      oneRoofAgent.agentPhone = oneRoofAgent.agentPhone ?? ctxAgentPhone;
      oneRoofAgent.agencyName = oneRoofAgent.agencyName ?? ctxAgencyName;
      return oneRoofAgent;
    }
  } catch (err) {
    logScrapeAttempt("AgentContact", "oneroof-bee-standalone", false, String(err));
  }

  if (selectedUrl) {
    return {
      ...emptyResult(),
      found: true,
      isListed: true,
      matchType: "subject",
      listingAddress: options.selectedListingContext?.address ?? address,
      agentName: ctxAgentName,
      agentPhone: ctxAgentPhone,
      agencyName: ctxAgencyName,
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
        agentName: ctx.agentName ?? ctxAgentName,
        agentPhone: ctx.agentPhone ?? ctxAgentPhone,
        agencyName: ctx.agencyName ?? ctxAgencyName,
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
