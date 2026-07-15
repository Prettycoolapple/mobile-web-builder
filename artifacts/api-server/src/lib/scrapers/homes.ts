/// <reference lib="dom" />
import { logger } from "../logger";
import { hasRemoteBrowserEndpoint, isVercelServerless, launchBrowser, newStealthPage, randomDelay } from "./browser";
import { fetchWithScrapingBee } from "./scrapingbee";
import { extractBedsBaths } from "./bed-bath-extractor";
import { addressLineAppearsInText, addressesLikelyMatch } from "./realestate-api";
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
const HOMES_GATEWAY_BASE = "https://gateway.homes.co.nz";
const HOMES_DIRECT_FETCH_TIMEOUT_MS = 12_000;

export interface HomesData {
  cv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  build_year_range: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  last_sale_price: number | null;
  last_sale_date: string | null;
  address_confirmed: string | null;
}

type HomesGatewayPropertyCard = {
  property_id?: unknown;
  url?: unknown;
  property_details?: {
    address?: unknown;
    display_address?: unknown;
    capital_value?: unknown;
    current_revision_date?: unknown;
    floor_area?: unknown;
    land_area?: unknown;
    decade_built?: unknown;
    num_bedrooms?: unknown;
    num_bathrooms?: unknown;
    latest_bedrooms?: unknown;
    latest_bathrooms?: unknown;
  };
};

type HomesGatewayPropertiesPayload = {
  cards?: HomesGatewayPropertyCard[];
};

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

function parseBuildDecade(raw: string): string | null {
  const s = raw.trim();
  const m = s.match(/\b((?:19|20)\d)0s?\b/i)
    ?? s.match(/\b((?:19|20)\d)0\s*[-–]\s*((?:19|20)\d)9\b/i);
  if (!m) return null;
  const start = parseInt(`${m[1]}0`, 10);
  const max = new Date().getFullYear() + 1;
  if (!Number.isFinite(start) || start < 1900 || start > max) return null;
  return `${start}-${start + 9}`;
}

function parseHomesDecadeBuilt(raw: unknown): { buildYear: number | null; buildYearRange: string | null } {
  const s = String(raw ?? "").trim();
  if (!s) return { buildYear: null, buildYearRange: null };
  return { buildYear: null, buildYearRange: parseBuildDecade(s) };
}

function toNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toPositiveSmallInt(raw: unknown): number | null {
  const n = toNumber(raw);
  return n != null && n > 0 && n < 20 ? n : null;
}

function textOrNull(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function addressMatchesSubject(addressNeedle: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  return addressesLikelyMatch(addressNeedle, candidate) || addressLineAppearsInText(addressNeedle, candidate);
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
  const decadeMatch = allText.match(/[Dd]ecade\s+[Bb]uilt[^0-9\n]*(?:((?:19|20)\d)0s?|((?:19|20)\d)0\s*[-–]\s*((?:19|20)\d)9)/);
  if (decadeMatch) data.build_year_range = parseBuildDecade(decadeMatch[0]) ?? undefined;
  const buildMatch = allText.match(/[Yy]ear\s+[Bb]uilt[^0-9\n]*(\d{4})/)
    ?? allText.match(/[Bb]uilt\s+in\s+(\d{4})/i)
    ?? allText.match(/[Cc]onstruction\s+[Yy]ear[^0-9\n]*(\d{4})/i);
  if (buildMatch) {
    data.build_year = parseYear(buildMatch[0]);
    data.build_year_range = undefined;
  }
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

function findHomesAppState(html: string): unknown | null {
  const match = html.match(/<script[^>]+id=["']homes-app-state["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function collectHomesCards(value: unknown, cards: HomesGatewayPropertyCard[] = []): HomesGatewayPropertyCard[] {
  if (!value || typeof value !== "object") return cards;
  if (Array.isArray(value)) {
    for (const item of value) collectHomesCards(item, cards);
    return cards;
  }

  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj["cards"])) {
    for (const card of obj["cards"]) {
      if (card && typeof card === "object") cards.push(card as HomesGatewayPropertyCard);
    }
  }
  for (const item of Object.values(obj)) collectHomesCards(item, cards);
  return cards;
}

function cardToHomesData(card: HomesGatewayPropertyCard, addressNeedle: string): HomesData | null {
  const details = card.property_details;
  if (!details) return null;

  const confirmedAddress = textOrNull(details.address) ?? textOrNull(details.display_address);
  const url = textOrNull(card.url);
  const urlAddress = url ? `https://homes.co.nz/address${url.startsWith("/") ? url : `/${url}`}` : null;
  if (!addressMatchesSubject(addressNeedle, confirmedAddress) && !addressMatchesSubject(addressNeedle, urlAddress)) {
    return null;
  }

  const bedrooms = toPositiveSmallInt(details.latest_bedrooms) ?? toPositiveSmallInt(details.num_bedrooms);
  const bathrooms = toPositiveSmallInt(details.latest_bathrooms) ?? toPositiveSmallInt(details.num_bathrooms);
  const landArea = toNumber(details.land_area);
  const floorArea = toNumber(details.floor_area);
  const cv = toNumber(details.capital_value);
  const cvYear = parseYear(String(details.current_revision_date ?? ""));
  const { buildYear, buildYearRange } = parseHomesDecadeBuilt(details.decade_built);

  if (!cv && !landArea && !floorArea && !buildYear && !buildYearRange && !bedrooms && !bathrooms) return null;

  return {
    cv_nzd: cv,
    cv_year: cvYear,
    land_area_sqm: landArea,
    floor_area_sqm: floorArea,
    build_year: buildYear,
    build_year_range: buildYearRange,
    bedrooms,
    bathrooms,
    last_sale_price: null,
    last_sale_date: null,
    address_confirmed: confirmedAddress ?? urlAddress ?? addressNeedle,
  };
}

export function extractHomesDataFromGatewayPayload(payload: unknown, addressNeedle: string): HomesData | null {
  for (const card of collectHomesCards(payload)) {
    const data = cardToHomesData(card, addressNeedle);
    if (data) return data;
  }
  return null;
}

function extractHomesDataFromAppState(html: string, addressNeedle: string): HomesData | null {
  const state = findHomesAppState(html);
  return state ? extractHomesDataFromGatewayPayload(state, addressNeedle) : null;
}

async function fetchDirectText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/json",
        "User-Agent": "ProjectAlphaNZ/1.0 (Homes property enrichment)",
      },
      signal: AbortSignal.timeout(HOMES_DIRECT_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.info({ url, status: response.status }, "homes.co.nz: direct fetch HTTP error");
      return null;
    }
    return await response.text();
  } catch (err) {
    logger.info({ url, err: err instanceof Error ? err.message : String(err) }, "homes.co.nz: direct fetch failed");
    return null;
  }
}

async function fetchGatewayJson<T>(url: string): Promise<T | null> {
  const text = await fetchDirectText(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function buildGatewayAddressQueries(address: string, formattedAddress: string): string[] {
  const values = [formattedAddress, address]
    .map((v) => v.replace(/\bnew zealand\b/ig, "").replace(/\b\d{4}\b/g, "").replace(/\s+/g, " ").replace(/,\s*$/g, "").trim())
    .filter(Boolean);
  return [...new Set(values)];
}

async function tryHomesGateway(address: string, formattedAddress: string): Promise<HomesData | null> {
  const addressNeedle = formattedAddress || address;
  for (const query of buildGatewayAddressQueries(address, formattedAddress)) {
    const resolveUrl = new URL(`${HOMES_GATEWAY_BASE}/property/resolve`);
    resolveUrl.searchParams.set("address", query);
    logger.info({ query }, "homes.co.nz: resolving exact property via Homes gateway");
    const resolved = await fetchGatewayJson<{ property_id?: string | null; error?: string }>(resolveUrl.toString());
    const propertyId = typeof resolved?.property_id === "string" && resolved.property_id.trim()
      ? resolved.property_id.trim()
      : null;
    if (!propertyId) continue;

    const propertiesUrl = new URL(`${HOMES_GATEWAY_BASE}/properties`);
    propertiesUrl.searchParams.set("property_ids", propertyId);
    const payload = await fetchGatewayJson<HomesGatewayPropertiesPayload>(propertiesUrl.toString());
    const data = extractHomesDataFromGatewayPayload(payload, addressNeedle);
    if (data) {
      logger.info(
        { query, propertyId, bedrooms: data.bedrooms, bathrooms: data.bathrooms, confirmed: data.address_confirmed },
        "homes.co.nz: exact gateway success",
      );
      return data;
    }
    logger.info({ query, propertyId, address: addressNeedle }, "homes.co.nz: gateway property did not match analysed address");
  }
  return null;
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
  // Match /address/{region}/{suburb}/{address-slug}/{hash}
  // Hash: 3-12 lowercase alphanumeric chars with no hyphens (distinguishes it
  // from the address slug which always contains at least one hyphen).
  const re = /\/address\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9][a-z0-9-]+\/([a-z0-9]{3,12})(?=[^a-z0-9/]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const path = m[0];
    if (addressLineAppearsInText(addressNeedle, path)) {
      found.push(`https://homes.co.nz${path}`);
    }
  }

  // homes-app-state often stores canonical property URLs without the
  // leading /address segment, e.g. "/auckland/orakei/38-te-arawa-street/yPZ5e".
  const shortRe = /\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9][a-z0-9-]+\/([a-z0-9]{3,12})(?=[^a-z0-9/]|$)/gi;
  while ((m = shortRe.exec(html)) !== null) {
    const path = m[0];
    if (addressLineAppearsInText(addressNeedle, path)) {
      found.push(`https://homes.co.nz/address${path}`);
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
  return !!(d.cv_nzd || d.land_area_sqm || d.build_year || d.build_year_range || d.bedrooms || d.bathrooms);
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

  const formattedParts = formattedAddress.split(",").map((part) => part.trim()).filter(Boolean);
  const streetLine = /^\d+[a-z]?$/i.test(formattedParts[0] ?? "") && formattedParts[1]
    ? `${formattedParts[0]} ${formattedParts[1]}`
    : formattedParts[0] || address;
  const parts = streetLine.trim().split(/\s+/);
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
  const addressText = `${address} ${formattedAddress}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const regionMatchers: Array<[RegExp, string]> = [
    [/\bnorthland\b/, "northland"],
    [/\bauckland\b/, "auckland"],
    [/\bwaikato\b/, "waikato"],
    [/\b(?:bay of plenty|bop)\b/, "bay-of-plenty"],
    [/\bgisborne\b/, "gisborne"],
    [/\bhawke'?s bay\b/, "hawkes-bay"],
    [/\btaranaki\b/, "taranaki"],
    [/\bmanawatu[- ]w(?:anganui|hanganui)\b/, "manawatu-whanganui"],
    [/\bwellington\b/, "wellington"],
    [/\btasman\b/, "tasman"],
    [/\bnelson\b/, "nelson"],
    [/\bmarlborough\b/, "marlborough"],
    [/\bwest coast\b/, "west-coast"],
    [/\bcanterbury\b/, "canterbury"],
    [/\botago\b/, "otago"],
    [/\bsouthland\b/, "southland"],
  ];
  const inferredRegion = /\b(rotoma|whakatane|rotorua)\b/.test(addressText) ? "bay-of-plenty" : null;
  const fallbackRegion = formattedAddress
    .split(",")
    .slice(1)
    .map((part) => slugify(part.replace(/\b\d{4}\b/g, "")))
    .filter((part) => part && part !== "new-zealand")
    .at(-1);
  const regionSlug = regionMatchers.find(([pattern]) => pattern.test(addressText))?.[1]
    ?? inferredRegion
    ?? fallbackRegion;
  if (!regionSlug) return [];

  for (const sub of dedup.slice(0, HOMES_SCRAPING_MAX_URL_VARIANTS)) {
    urls.push(`https://homes.co.nz/address/${regionSlug}/${sub}/${addressSlug}`);
  }

  if (numberPart && streetTypeIndex > 1) {
    for (const sub of dedup.slice(0, HOMES_SCRAPING_MAX_URL_VARIANTS)) {
      urls.push(`https://homes.co.nz/map/${regionSlug}/${sub}/${streetNameSlug}/${numberPart}`);
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
    build_year_range: data.build_year_range ?? null,
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
  logger.info({ url }, "homes.co.nz: trying direct Homes HTML/app-state fetch");
  const directHtml = await fetchDirectText(url);
  if (directHtml) {
    const appStateData = extractHomesDataFromAppState(directHtml, addressNeedle);
    if (appStateData) {
      logger.info({ url, cv_nzd: appStateData.cv_nzd, beds: appStateData.bedrooms }, "homes.co.nz: direct app-state success");
      return { data: appStateData, html: directHtml, addressConfirmed: true };
    }

    const directText = directHtml
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");

    if (!isErrorPage(directText) && addressLineAppearsInText(addressNeedle, directText)) {
      const extracted = extractHomesDataFromHtml(directHtml, addressNeedle);
      if (hasUsableData(extracted)) {
        logger.info({ url, cv_nzd: extracted.cv_nzd, beds: extracted.bedrooms }, "homes.co.nz: direct HTML success");
        return { data: toHomesData(extracted, addressNeedle), html: directHtml, addressConfirmed: true };
      }
      return { data: null, html: directHtml, addressConfirmed: true };
    }
  }

  logger.info({ url }, "homes.co.nz: trying ScrapingBee with URL");
  const html = await fetchWithScrapingBee(url, { render_js: true, premium_proxy: true, wait: waitMs });
  if (!html) return { data: null, html: null, addressConfirmed: false };

  const textContent = html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  logger.info({ url, preview: textContent.slice(0, 300) }, "homes.co.nz: ScrapingBee content preview");

  const appStateData = extractHomesDataFromAppState(html, addressNeedle);
  if (appStateData) {
    logger.info({ url, cv_nzd: appStateData.cv_nzd, beds: appStateData.bedrooms }, "homes.co.nz: ScrapingBee app-state success");
    return { data: appStateData, html, addressConfirmed: true };
  }

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
  const gateway = await tryHomesGateway(address, formattedAddress);
  if (gateway) return gateway;

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
      build_year_range: data.build_year_range ?? null,
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
