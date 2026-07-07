import { logger } from "./logger";
import { formatNZD } from "./utils";
import { fetchWithScrapingBee } from "./scrapers/scrapingbee";
import { load } from "cheerio";

export type RecentSalesSource = "realestate_sold" | "reinz_backup";

export interface RecentSalesLocation {
  title: string;
  path: string;
  kind: "suburb" | "district" | "region";
}

export interface RecentSalesFilters {
  months: number;
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  bathroomsMin: number | null;
  bathroomsMax: number | null;
  landAreaMin: number | null;
  landAreaMax: number | null;
  floorAreaMin: number | null;
  floorAreaMax: number | null;
  limit: number;
}

export interface RecentSalesQuery extends RecentSalesFilters {
  location: RecentSalesLocation;
  rawText: string;
  fromDate: string;
  toDate: string;
}

export interface RecentSaleRecord {
  address: string;
  salePriceNzd: number | null;
  salePriceText: string | null;
  saleDate: string | null;
  dateText: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  floorAreaSqm: number | null;
  titleType: string | null;
  cvNzd: number | null;
  source: RecentSalesSource;
  sourceUrl: string | null;
  priceConfirmed: boolean;
}

export interface RecentSalesResult {
  query: RecentSalesQuery;
  records: RecentSaleRecord[];
  source: RecentSalesSource;
  sourceUrl: string;
  fallbackUsed: boolean;
  warning: string | null;
}

const DEFAULT_MONTHS = 3;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const DIRECT_FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = Math.max(5 * 60_000, Number(process.env["RECENT_SALES_CACHE_TTL_MS"] ?? 6 * 60 * 60_000) || 6 * 60 * 60_000);
const soldPageCache = new Map<string, { html: string; expiresAt: number }>();

export function detectRecentSalesIntent(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  const soldSignal =
    /\b(?:recently\s+sold|recent\s+sales?|sold\s+(?:price|prices|records?|properties|homes?|houses?)|sale\s+records?|sales?\s+history|sales?\s+evidence|settled\s+sales?|settlement\s+price|prices?\s+achieved|what\s+sold|has\s+sold)\b/i.test(lower) ||
    /(?:\u6210\u4ea4|\u6210\u4ea4\u4ef7|\u6210\u4ea4\u50f9|\u6210\u4ea4\u8bb0\u5f55|\u6210\u4ea4\u8a18\u9304|\u5df2\u552e|\u552e\u51fa|\u5356\u51fa|\u8ce3\u51fa|\u8fd1\u671f\u552e\u4ef7|\u8fd1\u671f\u552e\u50f9|\u8fc7\u53bb.{0,8}\u6210\u4ea4|\u904e\u53bb.{0,8}\u6210\u4ea4)/u.test(raw);
  if (!soldSignal) return false;

  const activeOnlySignal =
    /\b(?:for\s+sale|currently\s+listed|active\s+listings?|on\s+the\s+market|available\s+properties)\b/i.test(lower) ||
    /(?:\u5728\u552e|\u623f\u6e90|\u6302\u724c|\u51fa\u552e\u623f\u6e90)/u.test(raw);

  return soldSignal || !activeOnlySignal;
}

export function isRecentSalesContinuationText(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (detectRecentSalesIntent(raw)) return true;
  const lower = raw.toLowerCase();
  if (/^(?:thanks?|thank\s+you|no|nope|not\s+now|all\s+good)$/i.test(lower) || /^(?:\u8c22\u8c22|\u8b1d\u8b1d|\u4e0d\u7528|\u4e0d\u8981|\u6682\u65f6\u4e0d|\u66ab\u6642\u4e0d)$/.test(raw)) {
    return false;
  }
  const unrelated =
    /\b(?:school|schools|zone|zoning|cost|costs|rental|rent|market\s+value|value|analyse|analyze|analysis|feasibility|subdiv|rules|why|how)\b/i.test(lower) ||
    /(?:\u5b66\u533a|\u5b78\u5340|\u5206\u533a|\u5206\u5340|\u6210\u672c|\u79df\u91d1|\u4f30\u503c|\u5e02\u503c|\u5206\u6790|\u53ef\u884c\u6027|\u5206\u5272|\u89c4\u5219|\u898f\u5247)/u.test(raw);
  if (unrelated) return false;
  if (/\b(?:last|past|previous|recent)\s+\d{1,2}\s+(?:months?|years?)\b/i.test(lower)) return true;
  if (/^\s*(?:yes|yep|yeah|ok|okay|sure|please|go\s+ahead|do\s+it|find\s+them|show\s+them|directly|you\s+choose|whatever)\b/i.test(lower)) return true;
  if (/(?:\u662f|\u5bf9|\u5c0d|\u53ef\u4ee5|\u597d\u7684|\u76f4\u63a5|\u627e\u51fa\u6765|\u627e\u51fa\u4f86|\u8fc7\u53bb|\u904e\u53bb|\u6700\u8fd1|\u4e09\u4e2a\u6708|\u4e09\u500b\u6708|\u516d\u4e2a\u6708|\u516d\u500b\u6708|\u53bb\u5e74)/u.test(raw)) return true;
  if (raw.length <= 80 && !/[?？]/.test(raw)) return true;
  if (/^what\s+about\s+[a-z][a-z\s'-]{2,}$/i.test(lower)) return true;
  return false;
}

export function parseRecentSalesFilters(text: string, now = new Date()): RecentSalesFilters & { fromDate: string; toDate: string } {
  const months = parseMonths(text) ?? DEFAULT_MONTHS;
  const filters: RecentSalesFilters = {
    months,
    bedroomsMin: null,
    bedroomsMax: null,
    bathroomsMin: null,
    bathroomsMax: null,
    landAreaMin: null,
    landAreaMax: null,
    floorAreaMin: null,
    floorAreaMax: null,
    limit: DEFAULT_LIMIT,
  };

  const bedrooms = parseRoomRange(text, [
    /(\d{1,2})\s*(?:[-~\u2013\u2014\uff5e]|to)\s*(\d{1,2})\s*(?:bed(?:room)?s?|\u623f|\u5367|\u5367\u5ba4)/i,
    /(\d{1,2})\s*\+\s*(?:bed(?:room)?s?|\u623f|\u5367|\u5367\u5ba4)/i,
    /(?:at\s+least|minimum|min|over|more\s+than)\s*(\d{1,2})\s*(?:bed(?:room)?s?)/i,
    /(?:\u81f3\u5c11|\u6700\u5c11|\u4ee5\u4e0a|>=?)\s*(\d{1,2})\s*(?:\u623f|\u5367|\u5367\u5ba4)/u,
    /(\d{1,2})\s*(?:\u623f|\u5367|\u5367\u5ba4)\s*(?:\u4ee5\u4e0a|\u4ee5\u4e0a)/u,
  ]);
  if (bedrooms) {
    filters.bedroomsMin = bedrooms.min;
    filters.bedroomsMax = bedrooms.max;
  }

  const bathrooms = parseRoomRange(text, [
    /(\d{1,2})\s*(?:[-~\u2013\u2014\uff5e]|to)\s*(\d{1,2})\s*(?:bath(?:room)?s?|\u6d74|\u536b|\u885b|\u6d74\u5ba4)/i,
    /(\d{1,2})\s*\+\s*(?:bath(?:room)?s?|\u6d74|\u536b|\u885b|\u6d74\u5ba4)/i,
    /(?:at\s+least|minimum|min|over|more\s+than)\s*(\d{1,2})\s*(?:bath(?:room)?s?)/i,
    /(?:\u81f3\u5c11|\u6700\u5c11|\u4ee5\u4e0a|>=?)\s*(\d{1,2})\s*(?:\u6d74|\u536b|\u885b|\u6d74\u5ba4)/u,
    /(\d{1,2})\s*(?:\u6d74|\u536b|\u885b|\u6d74\u5ba4)\s*(?:\u4ee5\u4e0a|\u4ee5\u4e0a)/u,
  ]);
  if (bathrooms) {
    filters.bathroomsMin = bathrooms.min;
    filters.bathroomsMax = bathrooms.max;
  }

  applyAreaFilter(filters, "land", text);
  applyAreaFilter(filters, "floor", text);

  const limitMatch = text.match(/\b(?:top|first|show|list)\s+(\d{1,2})\b/i);
  if (limitMatch) filters.limit = Math.min(MAX_LIMIT, Math.max(1, Number(limitMatch[1])));

  const toDate = isoDate(now);
  const from = new Date(now);
  from.setMonth(from.getMonth() - months);
  const fromDate = isoDate(from);
  return { ...filters, fromDate, toDate };
}

export async function fetchRecentSales(query: RecentSalesQuery): Promise<RecentSalesResult> {
  const primary = await fetchRealestateRecentSales(query);
  if (primary.records.length > 0) return primary;

  const backup = await fetchReinzBackupRecentSales(query);
  if (backup.records.length > 0) return backup;
  return {
    ...primary,
    warning: primary.warning ?? backup.warning ?? "No matching recent sold records were returned.",
  };
}

export function parseRealestateSoldHtml(html: string, query: RecentSalesQuery, sourceUrl: string): RecentSaleRecord[] {
  const records: RecentSaleRecord[] = [];
  return recordsFromHtml(html, sourceUrl)
    .filter((record) => passesFilters(record, query))
    .slice(0, query.limit);
}

export function renderRecentSalesTable(result: RecentSalesResult): string {
  const { query, records } = result;
  const filterSummary = buildFilterSummary(query);
  if (records.length === 0) {
    return [
      `I could not find matching sold records for ${query.location.title} for ${filterSummary}.`,
      "Try widening the time window or relaxing one of the filters.",
    ].join("\n\n");
  }

  const lines: string[] = [];
  lines.push(`Here are matching recent sold records for ${query.location.title} (${filterSummary}):`);
  lines.push("");
  lines.push("| Address | Sale price | Date | Beds/Baths | Land | Floor | Title | CV |");
  lines.push("|---|---:|---|---:|---:|---:|---|---:|");
  for (const record of records) {
    lines.push(
      [
        tableCell(record.address),
        tableCell(formatPrice(record)),
        tableCell(record.saleDate ?? record.dateText ?? "Unknown"),
        tableCell(formatBedsBaths(record)),
        tableCell(formatArea(record.landAreaSqm)),
        tableCell(formatArea(record.floorAreaSqm)),
        tableCell(record.titleType ?? "Unknown"),
        tableCell(record.cvNzd != null ? `$${formatNZD(record.cvNzd)}` : "Unknown"),
      ].join(" | ").replace(/^/, "| ").replace(/$/, " |"),
    );
  }
  if (result.warning) {
    lines.push("");
    lines.push(result.warning);
  }
  lines.push("");
  lines.push("Where the exact sale price/date is not published yet, I have shown the available status instead of guessing.");
  return lines.join("\n");
}

export function buildRecentSalesQuery(location: RecentSalesLocation, rawText: string, now = new Date()): RecentSalesQuery {
  const parsed = parseRecentSalesFilters(rawText, now);
  return {
    ...parsed,
    location,
    rawText,
  };
}

async function fetchRealestateRecentSales(query: RecentSalesQuery): Promise<RecentSalesResult> {
  const maxPages = Math.max(1, Math.min(10, Number(process.env["RECENT_SALES_REALESTATE_MAX_PAGES"] ?? 4) || 4));
  const collected: RecentSaleRecord[] = [];
  let firstUrl = "";
  let warning: string | null = null;

  for (let page = 1; page <= maxPages && collected.length < query.limit; page++) {
    const url = realestateSoldUrl(query.location, page);
    if (!firstUrl) firstUrl = url;
    const html = await fetchSoldPageHtml(url);
    if (!html) {
      warning = "The public sold-record page did not respond this time.";
      break;
    }
    const pageRecords = parseRealestateSoldHtml(html, query, url);
    for (const record of pageRecords) {
      if (collected.some((existing) => normaliseAddress(existing.address) === normaliseAddress(record.address))) continue;
      collected.push(record);
      if (collected.length >= query.limit) break;
    }
    if (!html.includes('data-test="tile"') && !html.includes("Recently sold")) break;
  }

  return {
    query,
    records: collected.slice(0, query.limit),
    source: "realestate_sold",
    sourceUrl: firstUrl,
    fallbackUsed: false,
    warning,
  };
}

async function fetchReinzBackupRecentSales(query: RecentSalesQuery): Promise<RecentSalesResult> {
  const endpoint = (process.env["REINZ_RECENT_SALES_API_URL"] ?? process.env["RECENT_SALES_BACKUP_API_URL"] ?? "").trim();
  const apiKey = (process.env["REINZ_RECENT_SALES_API_KEY"] ?? process.env["RECENT_SALES_BACKUP_API_KEY"] ?? "").trim();
  if (!endpoint || !apiKey) {
    return {
      query,
      records: [],
      source: "reinz_backup",
      sourceUrl: endpoint,
      fallbackUsed: true,
      warning: "The paid recent-sales backup is not configured yet.",
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        provider: "reinz",
        location: query.location,
        fromDate: query.fromDate,
        toDate: query.toDate,
        bedroomsMin: query.bedroomsMin,
        bedroomsMax: query.bedroomsMax,
        bathroomsMin: query.bathroomsMin,
        bathroomsMax: query.bathroomsMax,
        landAreaMin: query.landAreaMin,
        landAreaMax: query.landAreaMax,
        floorAreaMin: query.floorAreaMin,
        floorAreaMax: query.floorAreaMax,
        limit: query.limit,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "Recent sales REINZ backup failed");
      return emptyBackupResult(query, endpoint, "The paid recent-sales backup did not return data.");
    }
    const payload = await response.json() as unknown;
    const records = normaliseBackupRecords(payload)
      .filter((record) => passesFilters(record, query))
      .slice(0, query.limit);
    return {
      query,
      records,
      source: "reinz_backup",
      sourceUrl: endpoint,
      fallbackUsed: true,
      warning: records.length > 0 ? null : "The paid recent-sales backup returned no matching records.",
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Recent sales REINZ backup failed");
    return emptyBackupResult(query, endpoint, "The paid recent-sales backup did not return data.");
  }
}

function emptyBackupResult(query: RecentSalesQuery, endpoint: string, warning: string): RecentSalesResult {
  return {
    query,
    records: [],
    source: "reinz_backup",
    sourceUrl: endpoint,
    fallbackUsed: true,
    warning,
  };
}

async function fetchSoldPageHtml(url: string): Promise<string | null> {
  const cached = soldPageCache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.html;

  let html = await fetchWithScrapingBee(url, { render_js: false, premium_proxy: false, wait: 1000 });
  if (!html && process.env["REALESTATE_SOLD_DIRECT_FALLBACK"] !== "0") {
    try {
      const response = await fetch(url, {
        headers: {
          "accept": "text/html,application/xhtml+xml",
          "user-agent": "Mozilla/5.0 ProjectAlpha/1.0",
        },
        signal: AbortSignal.timeout(DIRECT_FETCH_TIMEOUT_MS),
      });
      if (response.ok) html = await response.text();
    } catch (err) {
      logger.debug({ err: (err as Error).message, url }, "Recent sales direct fetch failed");
    }
  }
  if (html) soldPageCache.set(url, { html, expiresAt: Date.now() + CACHE_TTL_MS });
  return html;
}

function recordsFromHtml(html: string, sourceUrl: string): RecentSaleRecord[] {
  const records: RecentSaleRecord[] = [];
  const $ = load(html);
  const tiles = $('[data-test="tile"]').toArray();
  if (tiles.length === 0) {
    return recordsFromJsonLd(html, sourceUrl);
  }
  for (const tile of tiles) {
    const root = $(tile);
    const address = cleanText(root.find('[data-test="standard-tile__search-result__address"]').first().text());
    if (!address) continue;
    const priceText = cleanText(root.find('[data-test="price-display__price-method"]').first().text());
    const dateText = cleanText(root.find('[data-test="tile__search-result__content__date-property"]').first().text());
    const linkHref =
      root.find('a[data-test="link-to"]').first().attr("href") ??
      root.find('a[href*="/property/"]').first().attr("href") ??
      null;
    const price = parseMoney(priceText);
    const record: RecentSaleRecord = {
      address,
      salePriceNzd: price,
      salePriceText: priceText || null,
      saleDate: parseDateText(dateText),
      dateText: dateText || null,
      bedrooms: parseMetric(root.find('[data-test="bedroom"]').first().text()),
      bathrooms: parseMetric(root.find('[data-test="bathroom"]').first().text()),
      landAreaSqm: parseArea(root.find('[data-test="land-area"]').first().text()),
      floorAreaSqm: parseArea(root.find('[data-test="floor-area"]').first().text()),
      titleType: null,
      cvNzd: null,
      source: "realestate_sold",
      sourceUrl: linkHref ? absolutiseRealestateUrl(linkHref) : sourceUrl,
      priceConfirmed: price != null,
    };
    records.push(record);
  }
  return records;
}

function recordsFromJsonLd(html: string, sourceUrl: string): RecentSaleRecord[] {
  const records: RecentSaleRecord[] = [];
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const script of scripts) {
    const json = stripTags(script).trim();
    if (!json) continue;
    try {
      const parsed = JSON.parse(json) as unknown;
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const obj = item as Record<string, unknown>;
        const addressRaw = obj["address"];
        const address = typeof addressRaw === "string"
          ? addressRaw
          : addressRaw && typeof addressRaw === "object"
            ? Object.values(addressRaw as Record<string, unknown>).filter((v) => typeof v === "string").join(", ")
            : "";
        if (!address) continue;
        records.push({
          address,
          salePriceNzd: parseMoney(String(obj["price"] ?? "")),
          salePriceText: obj["price"] == null ? null : String(obj["price"]),
          saleDate: typeof obj["dateSold"] === "string" ? obj["dateSold"] : null,
          dateText: typeof obj["dateSold"] === "string" ? obj["dateSold"] : null,
          bedrooms: null,
          bathrooms: null,
          landAreaSqm: null,
          floorAreaSqm: null,
          titleType: null,
          cvNzd: null,
          source: "realestate_sold",
          sourceUrl,
          priceConfirmed: obj["price"] != null,
        });
      }
    } catch {
      // Ignore malformed embedded data.
    }
  }
  return records;
}

function normaliseBackupRecords(payload: unknown): RecentSaleRecord[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>)?.["sales"])
      ? (payload as Record<string, unknown>)["sales"]
      : Array.isArray((payload as Record<string, unknown>)?.["results"])
        ? (payload as Record<string, unknown>)["results"]
        : Array.isArray((payload as Record<string, unknown>)?.["data"])
          ? (payload as Record<string, unknown>)["data"]
          : [];
  return (rows as unknown[])
    .map((row): RecentSaleRecord | null => {
      const obj = row as Record<string, unknown>;
      const address = firstString(obj, ["address", "fullAddress", "full_address", "propertyAddress"]);
      if (!address) return null;
      const salePriceNzd = firstNumber(obj, ["salePriceNzd", "sale_price_nzd", "salePrice", "sale_price", "price", "price_nzd"]);
      return {
        address,
        salePriceNzd,
        salePriceText: salePriceNzd != null ? `$${formatNZD(salePriceNzd)}` : firstString(obj, ["salePriceText", "priceText"]),
        saleDate: firstString(obj, ["saleDate", "sale_date", "dateSold", "date_sold", "date"]),
        dateText: firstString(obj, ["saleDate", "sale_date", "dateSold", "date_sold", "date"]),
        bedrooms: firstNumber(obj, ["bedrooms", "beds", "bedroom_count"]),
        bathrooms: firstNumber(obj, ["bathrooms", "baths", "bathroom_count"]),
        landAreaSqm: firstNumber(obj, ["landAreaSqm", "land_area_sqm", "landArea", "land_area"]),
        floorAreaSqm: firstNumber(obj, ["floorAreaSqm", "floor_area_sqm", "floorArea", "floor_area"]),
        titleType: firstString(obj, ["titleType", "title_type", "tenure", "estateType", "estate_type"]),
        cvNzd: firstNumber(obj, ["cvNzd", "cv_nzd", "cv", "capitalValue", "capital_value"]),
        source: "reinz_backup" as const,
        sourceUrl: firstString(obj, ["sourceUrl", "source_url", "url"]),
        priceConfirmed: salePriceNzd != null,
      };
    })
    .filter((record): record is RecentSaleRecord => Boolean(record));
}

function passesFilters(record: RecentSaleRecord, query: RecentSalesQuery): boolean {
  if (!between(record.bedrooms, query.bedroomsMin, query.bedroomsMax)) return false;
  if (!between(record.bathrooms, query.bathroomsMin, query.bathroomsMax)) return false;
  if (!between(record.landAreaSqm, query.landAreaMin, query.landAreaMax)) return false;
  if (!between(record.floorAreaSqm, query.floorAreaMin, query.floorAreaMax)) return false;
  if (record.saleDate && record.saleDate < query.fromDate) return false;
  return true;
}

function between(value: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function realestateSoldUrl(location: RecentSalesLocation, page: number): string {
  const url = new URL(`https://www.realestate.co.nz/residential/sold/${location.path}`);
  url.searchParams.set("by", "latest");
  if (page > 1) url.searchParams.set("page", String(page));
  return url.toString();
}

function parseMonths(text: string): number | null {
  const lower = text.toLowerCase();
  const enMonth = lower.match(/\b(?:last|past|previous|recent)\s+(\d{1,2})\s+months?\b/);
  if (enMonth) return clampMonths(Number(enMonth[1]));
  const enYear = lower.match(/\b(?:last|past|previous|recent)\s+(\d{1,2})\s+years?\b/);
  if (enYear) return clampMonths(Number(enYear[1]) * 12);
  if (/\blast\s+year\b|\bprevious\s+year\b/.test(lower)) return 12;

  const zhMonth = text.match(/(?:\u6700\u8fd1|\u8fd1|\u8fc7\u53bb|\u904e\u53bb)?\s*([0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\u5169]{1,3})\s*(?:\u4e2a|\u500b)?\u6708/u);
  if (zhMonth) return clampMonths(parseChineseNumber(zhMonth[1]) ?? Number(zhMonth[1]));
  const zhYear = text.match(/(?:\u6700\u8fd1|\u8fc7\u53bb|\u904e\u53bb)?\s*([0-9\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\u5169]{1,3})\s*\u5e74/u);
  if (zhYear) return clampMonths((parseChineseNumber(zhYear[1]) ?? Number(zhYear[1])) * 12);
  if (/\u53bb\u5e74/u.test(text)) return 12;
  return null;
}

function parseRoomRange(text: string, patterns: RegExp[]): { min: number; max: number | null } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const first = Number(match[1]);
    if (!Number.isFinite(first)) continue;
    const second = match[2] != null ? Number(match[2]) : null;
    return { min: first, max: second != null && Number.isFinite(second) ? second : null };
  }
  return null;
}

function applyAreaFilter(filters: RecentSalesFilters, kind: "land" | "floor", text: string): void {
  const compactZh = kind === "land"
    ? text.match(/(?:\u5730\u5757\u9762\u79ef|\u571f\u5730\u9762\u79ef|\u5360\u5730|\u5730\u584a\u9762\u7a4d|\u571f\u5730\u9762\u7a4d)\s*(\d{2,5})\s*(?:m2|sqm|m\u00b2|\u5e73\u7c73|\u5e73\u65b9\u7c73)?\s*(?:\u4ee5\u4e0a|\+|over|above)?/iu)
    : text.match(/(?:\u5ba4\u5185\u9762\u79ef|\u5ba4\u5167\u9762\u7a4d|\u5efa\u7b51\u9762\u79ef|\u5efa\u7bc9\u9762\u7a4d)\s*(\d{2,5})\s*(?:m2|sqm|m\u00b2|\u5e73\u7c73|\u5e73\u65b9\u7c73)?\s*(?:\u4ee5\u4e0a|\+|over|above)?/iu);
  if (compactZh) {
    const n = Number(compactZh[1]);
    if (Number.isFinite(n) && n > 0) {
      if (kind === "land") filters.landAreaMin = n;
      else filters.floorAreaMin = n;
      return;
    }
  }

  const label =
    kind === "land"
      ? String.raw`(?:land(?:\s+area)?|section|site|lot|地块面积|土地面积|占地|地|地塊面積|土地面積)`
      : String.raw`(?:floor(?:\s+area)?|building(?:\s+area)?|internal\s+area|室内面积|室內面積|建筑面积|建築面積|室内|室內)`;
  const lower = text.toLowerCase();
  const regexes = [
    new RegExp(`${label}.{0,16}(\\d{2,5})\\s*(?:m2|sqm|m\\u00b2|square\\s*met(?:er|re)s?|平米|平方米)?\\s*(?:\\+|or\\s+more|plus|over|above|more\\s+than|minimum|min|以上)`, "iu"),
    new RegExp(`(?:over|above|more\\s+than|minimum|min|at\\s+least)\\s*(\\d{2,5})\\s*(?:m2|sqm|m\\u00b2|square\\s*met(?:er|re)s?)\\s*${label}`, "iu"),
    new RegExp(`(\\d{2,5})\\s*(?:m2|sqm|m\\u00b2|square\\s*met(?:er|re)s?|平米|平方米)\\s*(?:\\+|or\\s+more|plus|over|above|more\\s+than|以上).{0,16}${label}`, "iu"),
  ];
  for (const re of regexes) {
    const match = lower.match(re) ?? text.match(re);
    if (!match) continue;
    const n = Number(match[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (kind === "land") filters.landAreaMin = n;
    else filters.floorAreaMin = n;
    return;
  }
}

function parseChineseNumber(input: string): number | null {
  if (/^\d+$/.test(input)) return Number(input);
  const map: Record<string, number> = {
    "\u4e00": 1,
    "\u4e8c": 2,
    "\u4e24": 2,
    "\u5169": 2,
    "\u4e09": 3,
    "\u56db": 4,
    "\u4e94": 5,
    "\u516d": 6,
    "\u4e03": 7,
    "\u516b": 8,
    "\u4e5d": 9,
    "\u5341": 10,
  };
  if (input === "\u5341") return 10;
  if (input.includes("\u5341")) {
    const [left, right] = input.split("\u5341");
    const tens = left ? map[left] ?? null : 1;
    const ones = right ? map[right] ?? null : 0;
    if (tens == null || ones == null) return null;
    return tens * 10 + ones;
  }
  return map[input] ?? null;
}

function clampMonths(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MONTHS;
  return Math.max(1, Math.min(120, Math.round(n)));
}

function extractByDataTest(block: string, dataTest: string): string | null {
  const escaped = dataTest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<[^>]+data-test=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i");
  const match = block.match(re);
  if (!match) return null;
  return cleanText(stripTags(match[1]));
}

function extractLinkHref(block: string): string | null {
  const match = block.match(/<a[^>]+data-test=["']link-to["'][^>]+href=["']([^"']+)["']/i) ?? block.match(/<a[^>]+href=["']([^"']*\/property\/[^"']+)["']/i);
  return match?.[1] ?? null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;|&#47;/g, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = String(text).match(/\$?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{6,8})/);
  if (!match) return null;
  const n = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseMetric(text: string | null | undefined): number | null {
  if (!text) return null;
  const n = Number(String(text).match(/\d+(?:\.\d+)?/)?.[0] ?? NaN);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseArea(text: string | null | undefined): number | null {
  const n = parseMetric(text);
  return n != null && n > 0 ? Math.round(n) : null;
}

function parseDateText(text: string | null | undefined): string | null {
  if (!text) return null;
  const raw = cleanText(text);
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const nz = raw.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (nz) return `${nz[3]}-${nz[2].padStart(2, "0")}-${nz[1].padStart(2, "0")}`;
  return null;
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function firstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
    if (typeof value === "string") {
      const money = parseMoney(value);
      if (money != null) return money;
      const n = Number(value.replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

function formatPrice(record: RecentSaleRecord): string {
  if (record.salePriceNzd != null) return `$${formatNZD(record.salePriceNzd)}`;
  return record.salePriceText || "Unknown";
}

function formatBedsBaths(record: RecentSaleRecord): string {
  const beds = record.bedrooms != null ? String(record.bedrooms) : "?";
  const baths = record.bathrooms != null ? String(record.bathrooms) : "?";
  return `${beds}/${baths}`;
}

function formatArea(area: number | null): string {
  return area != null ? `${formatNZD(area)} m2` : "Unknown";
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "/").replace(/\n+/g, " ").trim();
}

function buildFilterSummary(query: RecentSalesQuery): string {
  const parts = [`last ${query.months} months`];
  if (query.bedroomsMin != null && query.bedroomsMax != null) parts.push(`${query.bedroomsMin}-${query.bedroomsMax} bedrooms`);
  else if (query.bedroomsMin != null) parts.push(`${query.bedroomsMin}+ bedrooms`);
  if (query.bathroomsMin != null && query.bathroomsMax != null) parts.push(`${query.bathroomsMin}-${query.bathroomsMax} bathrooms`);
  else if (query.bathroomsMin != null) parts.push(`${query.bathroomsMin}+ bathrooms`);
  if (query.landAreaMin != null) parts.push(`land ${query.landAreaMin}+ m2`);
  if (query.floorAreaMin != null) parts.push(`floor ${query.floorAreaMin}+ m2`);
  return parts.join(", ");
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function absolutiseRealestateUrl(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.realestate.co.nz${href.startsWith("/") ? href : `/${href}`}`;
}

function normaliseAddress(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
