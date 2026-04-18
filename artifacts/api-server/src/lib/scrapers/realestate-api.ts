/**
 * realestate.co.nz JSON API client.
 *
 * realestate.co.nz's own Ember SPA fetches data from a public JSON-API at
 * https://platform.realestate.co.nz/search/v1. We talk to that same API
 * directly so we get authoritative, structured, fast data rather than scraping
 * the JS-rendered HTML page.
 *
 * Two endpoints we use:
 *   - GET /search/v1/locations?include=districts.suburbs   (suburb directory; ~1900 suburbs nationwide)
 *   - GET /search/v1/listings?filter[category][]=res_sale&filter[suburb][]=<id>   (active listings)
 *
 * The directory is cached for 1 hour. Suburb name → ID lookup is O(1) via a
 * normalised in-memory map that handles common spelling variants (e.g.
 * "st heliers" → "saint heliers", "buckland beach" → "bucklands beach").
 */

import { logger } from "../logger";
import type { ListingResult } from "./oneroof";
import { extractBedsBaths } from "./bed-bath-extractor";

const PLATFORM_BASE = "https://platform.realestate.co.nz/search/v1";
const MEDIA_BASE = "https://mediaserver.realestate.co.nz";
const FETCH_TIMEOUT_MS = 12_000;

interface SuburbRecord {
  id: string;
  title: string;          // "Bucklands Beach"
  slug: string;           // "bucklands-beach"
  fqSlug: string;         // "auckland_manukau-city_bucklands-beach"
  districtId: number;     // 223
}

interface DistrictRecord {
  id: string;
  title: string;          // "Manukau City"
  slug: string;           // "manukau-city"
}

interface SuburbIndex {
  byNormalisedName: Map<string, SuburbRecord>;  // "bucklands beach" → record
  byId: Map<string, SuburbRecord>;
  districts: Map<string, DistrictRecord>;
  loadedAt: number;
}

let suburbIndexCache: SuburbIndex | null = null;
let inflightLoad: Promise<SuburbIndex> | null = null;
const SUBURB_INDEX_TTL_MS = 60 * 60 * 1000; // 1 hour

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/['']/g, "")
    .replace(/\bsaint\b/g, "st")        // "saint heliers" → "st heliers" (we'll alias both ways)
    .replace(/\bmount\b/g, "mt")
    .replace(/\bpoint\b/g, "pt")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "accept": "application/vnd.api+json,application/json",
        "user-agent": "DevFeasible/1.0 (+https://devfeasible.co.nz)",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

interface LocationsResponse {
  data: Array<{ type: string; id: string; attributes: { title: string; slug: string } }>;
  included: Array<{
    type: "districts" | "suburbs";
    id: string;
    attributes: { title: string; slug: string; "fq-slug"?: string; "parent-id"?: number };
  }>;
}

async function loadSuburbIndex(): Promise<SuburbIndex> {
  if (suburbIndexCache && Date.now() - suburbIndexCache.loadedAt < SUBURB_INDEX_TTL_MS) {
    return suburbIndexCache;
  }
  if (inflightLoad) return inflightLoad;

  inflightLoad = (async () => {
    const url = `${PLATFORM_BASE}/locations?include=districts.suburbs`;
    logger.info({ url }, "realestate-api: fetching suburb index");
    const json = await fetchJsonWithTimeout<LocationsResponse>(url);

    const districts = new Map<string, DistrictRecord>();
    const byNorm = new Map<string, SuburbRecord>();
    const byId = new Map<string, SuburbRecord>();

    for (const item of json.included ?? []) {
      if (item.type === "districts") {
        districts.set(item.id, { id: item.id, title: item.attributes.title, slug: item.attributes.slug });
      }
    }

    for (const item of json.included ?? []) {
      if (item.type !== "suburbs") continue;
      const fqSlug = item.attributes["fq-slug"] ?? "";
      // Skip "container" suburbs that don't have an fq-slug (these are parent groupings)
      if (!fqSlug) continue;
      const districtId = item.attributes["parent-id"] ?? 0;
      const rec: SuburbRecord = {
        id: item.id,
        title: item.attributes.title,
        slug: item.attributes.slug,
        fqSlug,
        districtId,
      };
      byId.set(rec.id, rec);

      const aliases = new Set<string>();
      const baseNorm = normaliseName(rec.title);
      aliases.add(baseNorm);
      // Alias the spelled-out form: normaliseName converts "saint" → "st", but the
      // raw realestate.co.nz title is "Saint Heliers". Add the spelled-out form too.
      aliases.add(normaliseName(rec.title.replace(/\bSaint\b/gi, "Saint").replace(/\bMount\b/gi, "Mount")));
      aliases.add(rec.title.toLowerCase().trim());
      // Common typo: "bucklands beach" / "buckland beach"
      if (baseNorm.endsWith("s beach")) aliases.add(baseNorm.replace(/s beach$/, " beach"));
      if (baseNorm.endsWith(" beach")) aliases.add(baseNorm.replace(/ beach$/, "s beach"));

      for (const alias of aliases) {
        // First write wins — primary suburb takes priority over identically-named villages
        if (!byNorm.has(alias)) byNorm.set(alias, rec);
      }
    }

    suburbIndexCache = { byNormalisedName: byNorm, byId, districts, loadedAt: Date.now() };
    logger.info(
      { suburbs: byId.size, districts: districts.size, aliasKeys: byNorm.size },
      "realestate-api: suburb index loaded",
    );
    return suburbIndexCache;
  })().catch((err) => {
    inflightLoad = null;
    throw err;
  });

  try {
    return await inflightLoad;
  } finally {
    inflightLoad = null;
  }
}

/**
 * Look up a suburb by free-text name. Returns null if no match.
 * Tries exact normalised match, then a small set of obvious variants,
 * then a constrained fuzzy match (edit distance ≤ 2 against any indexed alias).
 */
export async function findSuburbId(name: string): Promise<SuburbRecord | null> {
  if (!name || !name.trim()) return null;
  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: failed to load suburb index");
    return null;
  }

  const target = normaliseName(name);
  if (!target) return null;

  // Exact alias hit
  const direct = index.byNormalisedName.get(target);
  if (direct) return direct;

  // Try with/without trailing "s" on the last word ("buckland" ↔ "bucklands")
  const variants = [
    target.replace(/s$/, ""),
    target + "s",
    target.replace(/(\w)s\b/, "$1"),    // remove possessive-s anywhere
  ];
  for (const v of variants) {
    const hit = index.byNormalisedName.get(v);
    if (hit) return hit;
  }

  // Constrained fuzzy match: only accept ≤ 2 edits AND length within 3 chars
  let best: SuburbRecord | null = null;
  let bestDist = 3;
  for (const [alias, rec] of index.byNormalisedName) {
    if (Math.abs(alias.length - target.length) > 3) continue;
    const d = levenshtein(alias, target);
    if (d < bestDist) {
      bestDist = d;
      best = rec;
      if (d === 0) break;
    }
  }
  return best;
}

/**
 * Scan free-form text and return the longest suburb name from the live
 * directory that appears as a substring. Replaces the static NZ_SUBURBS
 * regex match so coverage automatically tracks the live data source
 * (1899 suburbs vs the previous ~110 hand-curated entries).
 */
export async function findSuburbInTextViaIndex(text: string): Promise<SuburbRecord | null> {
  if (!text || !text.trim()) return null;
  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch {
    return null;
  }
  const normalised = text.toLowerCase().trim().replace(/\s+/g, " ");
  // Try aliases longest-first so "bucklands beach" wins over "beach".
  const aliases = [...index.byNormalisedName.keys()].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    if (alias.length < 3) continue;
    // Word-boundary match to avoid e.g. "epsom" inside "epsomdowns"
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(normalised)) return index.byNormalisedName.get(alias) ?? null;
  }
  return null;
}

/**
 * Return suburbs in the same realestate.co.nz district as the given suburb,
 * excluding the suburb itself. Districts roughly correspond to council/board
 * areas (e.g. "auckland-city", "manukau-city") so sister suburbs are usually
 * geographically adjacent — a reasonable hand-mapping-free starting point
 * for a "nearby suburbs" fallback.
 */
export async function getDistrictSiblings(suburbId: string, max = 8): Promise<SuburbRecord[]> {
  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch {
    return [];
  }
  const target = index.byId.get(suburbId);
  if (!target) return [];
  const siblings: SuburbRecord[] = [];
  const seen = new Set<string>();
  for (const rec of index.byId.values()) {
    if (rec.id === target.id) continue;
    if (rec.districtId !== target.districtId) continue;
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);
    siblings.push(rec);
    if (siblings.length >= max) break;
  }
  return siblings;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

interface RawListing {
  id: string;
  attributes: {
    address?: {
      "full-address"?: string;
      "display-address"?: string;
      suburb?: string;
      latitude?: string;
      longitude?: string;
    };
    "price-display"?: string;
    "bedroom-count"?: number;
    "bathrooms-total-count"?: number;
    "land-area"?: number;
    "land-area-unit"?: string;
    "website-full-url"?: string;
    "listing-status"?: string;
    "is-featured"?: boolean;
    photos?: Array<{ "base-url"?: string; large?: string; medium?: string }>;
  };
}

interface ListingsResponse {
  data?: RawListing[];
  meta?: { totalResults?: number };
  message?: string;
}

/**
 * Parse realestate.co.nz `price-display` strings into a numeric price.
 * Returns null for "Auction", "Negotiation", "Price by negotiation", "POA", "Tender", etc.
 *
 * Examples handled:
 *   "$2,500,000"               → 2500000
 *   "Offers over $1,800,000"   → 1800000
 *   "From $895,000"            → 895000
 *   "$1,200,000 - $1,400,000"  → 1300000   (midpoint)
 *   "Auction"                  → null
 */
function parsePriceDisplay(s: string | undefined): number | null {
  if (!s) return null;
  const matches = [...s.matchAll(/\$?\s*([\d,]{4,})/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= 50_000 && n <= 100_000_000);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // Range → midpoint
  return Math.round((matches[0] + matches[matches.length - 1]) / 2);
}

function buildPhotoUrl(photos: RawListing["attributes"]["photos"]): string | null {
  if (!photos || photos.length === 0) return null;
  const first = photos[0];
  const baseUrl = first["base-url"];
  if (!baseUrl) return null;
  // The API exposes only tiny templates in `small`/`medium`/`large` (≤140×178).
  // The realestate.co.nz site itself uses an undocumented high-res variant on
  // mediaserver.realestate.co.nz at 1280×720 — sharp on retina phones for our
  // ~400×140-pt card. Verified 200 OK across all listings tested.
  return `${MEDIA_BASE}${baseUrl}.crop.1280x720.jpg`;
}

function mapListing(raw: RawListing): ListingResult | null {
  const a = raw.attributes;
  const url = a["website-full-url"];
  const address = a.address?.["full-address"] ?? a.address?.["display-address"];
  if (!url || !address) return null;

  const priceText = a["price-display"] ?? "";
  const price = parsePriceDisplay(priceText);
  const landArea = typeof a["land-area"] === "number" ? a["land-area"] : null;

  return {
    address,
    price,
    priceText,
    landArea,
    photoUrl: buildPhotoUrl(a.photos),
    listingUrl: url,
    zone: null,
    bedrooms: typeof a["bedroom-count"] === "number" ? a["bedroom-count"] : null,
    bathrooms: typeof a["bathrooms-total-count"] === "number" ? a["bathrooms-total-count"] : null,
  };
}

/**
 * Fetch all active for-sale listings for a given suburb ID.
 * Returns up to `limit` listings (default 100, the API max per page).
 */
async function fetchListingsForSuburbId(suburbId: string, limit = 100): Promise<ListingResult[]> {
  const params = new URLSearchParams();
  params.append("filter[category][]", "res_sale");
  params.append("filter[suburb][]", suburbId);
  params.append("page[limit]", String(Math.min(limit, 100)));
  // Note: the public listings API does not accept `sort`; results come back in
  // the API's default order (effectively most-recent-first for active listings).

  const url = `${PLATFORM_BASE}/listings?${params.toString()}`;
  const json = await fetchJsonWithTimeout<ListingsResponse>(url);

  if (json.message || !json.data) {
    logger.warn({ err: json.message, url }, "realestate-api: listings request failed");
    return [];
  }

  const mapped = json.data
    .filter((it) => it.attributes["listing-status"] !== "withdrawn")
    .map(mapListing)
    .filter((x): x is ListingResult => x !== null);

  logger.info({ suburbId, total: json.meta?.totalResults, mapped: mapped.length }, "realestate-api: listings fetched");
  return mapped;
}

/**
 * Cross-check the structured API's bedroom/bathroom counts against the
 * og:description on the listing's social-share card. Both numbers come from
 * the same upstream listing record but they're populated by different
 * pipelines on realestate.co.nz, and they occasionally disagree (e.g. the
 * API reports 4 baths but the og:description text says "3 bath"). When that
 * happens we mark the value as approximate so the UI can flag it rather than
 * silently picking whichever source happened to win.
 */
async function fetchOgBedsBaths(url: string): Promise<{ bedrooms: number | null; bathrooms: number | null } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    let html = "";
    try {
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "accept": "text/html",
          "accept-language": "en-NZ,en;q=0.9",
        },
      });
      if (!resp.ok) return null;
      html = await resp.text();
    } finally {
      clearTimeout(t);
    }
    const ogTitle = html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "";
    const ogDesc = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? "";
    if (!ogTitle && !ogDesc) return null;
    return extractBedsBaths(`${ogTitle} ${ogDesc}`);
  } catch {
    return null;
  }
}

async function annotateApproxBedsBaths(listings: ListingResult[]): Promise<ListingResult[]> {
  if (listings.length === 0) return listings;
  const checks = await Promise.all(
    listings.map(async (l) => {
      // Only worth cross-checking when the API actually gave us a number to
      // verify against — otherwise there's nothing to disagree with.
      if (l.bedrooms == null && l.bathrooms == null) return l;
      const og = await fetchOgBedsBaths(l.listingUrl);
      if (!og) return l;
      const bedroomsApprox =
        l.bedrooms != null && og.bedrooms != null && og.bedrooms !== l.bedrooms;
      const bathroomsApprox =
        l.bathrooms != null && og.bathrooms != null && og.bathrooms !== l.bathrooms;
      if (bedroomsApprox || bathroomsApprox) {
        logger.info(
          { url: l.listingUrl, api: { bedrooms: l.bedrooms, bathrooms: l.bathrooms }, og },
          "realestate-api: bed/bath disagreement between API and og:description — flagging approximate",
        );
      }
      return { ...l, bedroomsApprox, bathroomsApprox };
    }),
  );
  return checks;
}

export interface ApiSearchResult {
  firstBatch: ListingResult[];
  remainingListings: ListingResult[];
  totalFound: number;
  source: string;
  suburbResolved: { id: string; title: string; fqSlug: string } | null;
}

/**
 * Top-level search by suburb name + price range. The price filter is applied
 * client-side (the public listings API doesn't expose a price filter).
 *
 * Returns an empty result with `suburbResolved: null` if the suburb name can't
 * be resolved against realestate.co.nz's official directory.
 */
export async function searchListingsByName(opts: {
  suburbName: string;
  minPrice: number;
  maxPrice: number;
  /** How many listings to return in `firstBatch`; the rest go into `remainingListings` for pagination. */
  firstBatchSize?: number;
  /** When true, listings without a numeric price ("Auction", "Negotiation", ...) are kept. */
  includeNegotiation?: boolean;
  /** Listing URLs to exclude (already-shown). */
  skipUrls?: string[];
}): Promise<ApiSearchResult> {
  const {
    suburbName,
    minPrice,
    maxPrice,
    firstBatchSize = 6,
    includeNegotiation = true,
    skipUrls = [],
  } = opts;

  const suburb = await findSuburbId(suburbName);
  if (!suburb) {
    logger.info({ suburbName }, "realestate-api: suburb not found in directory");
    return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz/api", suburbResolved: null };
  }

  logger.info(
    { suburbName, resolvedTo: suburb.title, suburbId: suburb.id, fqSlug: suburb.fqSlug, minPrice, maxPrice },
    "realestate-api: resolved suburb, fetching listings",
  );

  let listings: ListingResult[];
  try {
    listings = await fetchListingsForSuburbId(suburb.id);
  } catch (err) {
    logger.warn({ err: (err as Error).message, suburbId: suburb.id }, "realestate-api: fetch failed");
    return {
      firstBatch: [], remainingListings: [], totalFound: 0,
      source: "realestate.co.nz/api",
      suburbResolved: { id: suburb.id, title: suburb.title, fqSlug: suburb.fqSlug },
    };
  }

  const skipSet = new Set(skipUrls);
  // Allow a 10% over-budget tolerance to avoid hiding listings that just edge over.
  const upperWithTolerance = maxPrice * 1.1;
  const filtered = listings.filter((l) => {
    if (skipSet.has(l.listingUrl)) return false;
    if (l.price == null) return includeNegotiation;
    return l.price >= minPrice && l.price <= upperWithTolerance;
  });

  // The downstream pre-screener requires a numeric price to compute development
  // scores. Surface listings that have one first; keep negotiation/auction
  // listings as a tail so they can still be shown as raw cards if needed.
  const priced = filtered.filter((l) => l.price != null);
  const negotiation = filtered.filter((l) => l.price == null);
  const ordered = [...priced, ...negotiation];

  // Cross-check the user-facing first batch against the listing's
  // og:description so we can flag any bed/bath disagreement as approximate.
  // We only annotate the first batch — those are the listings that get
  // surfaced as cards immediately; the remainder is paginated lazily and
  // not worth the extra request burst per search.
  const firstBatchRaw = ordered.slice(0, firstBatchSize);
  const firstBatch = await annotateApproxBedsBaths(firstBatchRaw).catch(() => firstBatchRaw);

  return {
    firstBatch,
    remainingListings: ordered.slice(firstBatchSize),
    totalFound: ordered.length,
    source: "realestate.co.nz/api",
    suburbResolved: { id: suburb.id, title: suburb.title, fqSlug: suburb.fqSlug },
  };
}
