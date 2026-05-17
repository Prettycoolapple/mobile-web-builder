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
import type { ComparableSale, ListingResult } from "./oneroof";
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
        "user-agent": "ProjectAlpha/1.0",
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
  relationships?: {
    agents?: { data?: Array<{ id: string; type: string }> };
    offices?: { data?: Array<{ id: string; type: string }> };
  };
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

interface RawAgentImage {
  "base-url"?: string;
  square?: string;
  large?: string;
  medium?: string;
  small?: string;
}

interface RawAgentResponse {
  data?: {
    id: string;
    type: "agent";
    attributes?: {
      name?: string;
      "first-name"?: string;
      "last-name"?: string;
      "phone-mobile"?: string;
      phone?: string;
      "office-name"?: string;
      image?: RawAgentImage;
    };
  };
}

export interface RealestateAgentContact {
  agentName: string | null;
  agentPhone: string | null;
  agencyName: string | null;
  agentAvatarUrl: string | null;
  listingUrl: string | null;
}

export interface RealestateSuburbAgentContact extends RealestateAgentContact {
  listingAddress: string | null;
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
  return `${MEDIA_BASE}${baseUrl}.crop.1280x720.jpg`;
}

/**
 * Return up to `limit` high-res photo URLs from a listing's photo array.
 * Each photo uses the same 1280×720 crop path as the hero image.
 */
export function buildPhotoUrls(
  photos: RawListing["attributes"]["photos"],
  limit = 4,
): string[] {
  if (!photos || photos.length === 0) return [];
  return photos
    .slice(0, limit)
    .map((p) => {
      const baseUrl = p["base-url"];
      return baseUrl ? `${MEDIA_BASE}${baseUrl}.crop.1280x720.jpg` : null;
    })
    .filter((u): u is string => u !== null);
}

function mapListing(raw: RawListing): ListingResult | null {
  const a = raw.attributes;
  const url = a["website-full-url"];
  const address = a.address?.["full-address"] ?? a.address?.["display-address"];
  if (!url || !address) return null;

  const priceText = a["price-display"] ?? "";
  const price = parsePriceDisplay(priceText);
  const landArea = typeof a["land-area"] === "number" ? a["land-area"] : null;

  const photoUrls = buildPhotoUrls(a.photos, 4);
  return {
    address,
    price,
    priceText,
    landArea,
    photoUrl: photoUrls[0] ?? null,
    photoUrls,
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

async function fetchRawListingsForSuburbId(suburbId: string, limit = 100): Promise<RawListing[]> {
  const params = new URLSearchParams();
  params.append("filter[category][]", "res_sale");
  params.append("filter[suburb][]", suburbId);
  params.append("page[limit]", String(Math.min(limit, 100)));

  const url = `${PLATFORM_BASE}/listings?${params.toString()}`;
  const json = await fetchJsonWithTimeout<ListingsResponse>(url);
  if (json.message || !json.data) {
    logger.warn({ err: json.message, url }, "realestate-api: raw listings request failed");
    return [];
  }
  return json.data.filter((it) => it.attributes["listing-status"] !== "withdrawn");
}

function buildMediaUrl(baseUrl: string | null | undefined, suffix?: string | null): string | null {
  if (!baseUrl) return null;
  return `${MEDIA_BASE}${baseUrl}${suffix || ".crop.110x110.jpg"}`;
}

function normaliseNzPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/[\s\-().]/g, "");
  if (/^\+64\d{7,11}$/.test(stripped)) return stripped;
  if (/^0\d{7,10}$/.test(stripped)) return `+64${stripped.slice(1)}`;
  return raw.trim();
}

function cleanAgencyName(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const withoutLicence = raw.replace(/\s*\(Licensed:\s*REAA\s*2008\)\s*/gi, " ").replace(/\s+/g, " ").trim();
  const afterDash = withoutLicence.split(/\s+-\s+/).pop()?.trim();
  const candidate = afterDash && afterDash.length >= 3 ? afterDash : withoutLicence;
  return candidate.replace(/\s*,\s*/g, ", ").trim() || null;
}

function agentImageUrl(image: RawAgentImage | undefined): string | null {
  if (!image?.["base-url"]) return null;
  return buildMediaUrl(image["base-url"], image.square ?? image.large ?? image.medium ?? image.small);
}

async function fetchAgentById(agentId: string): Promise<RealestateAgentContact | null> {
  const url = `${PLATFORM_BASE}/agents/${encodeURIComponent(agentId)}`;
  const json = await fetchJsonWithTimeout<RawAgentResponse>(url);
  const attrs = json.data?.attributes;
  if (!attrs) return null;

  const name =
    attrs.name ??
    [attrs["first-name"], attrs["last-name"]].filter(Boolean).join(" ").trim() ??
    null;
  const phone = normaliseNzPhone(attrs["phone-mobile"] ?? attrs.phone);
  return {
    agentName: name?.trim() || null,
    agentPhone: phone,
    agencyName: cleanAgencyName(attrs["office-name"]),
    agentAvatarUrl: agentImageUrl(attrs.image),
    listingUrl: null,
  };
}

function firstAddressLine(s: string): string {
  return s
    .split(",")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetNumberToken(line: string): string {
  const t = line.split(" ")[0] ?? "";
  return t.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** True when `candidate` looks like the same street address as `target` (first line). */
function addressesLikelyMatch(target: string, candidate: string): boolean {
  const fa = firstAddressLine(target);
  const fb = firstAddressLine(candidate);
  if (fa.length < 4 || fb.length < 4) return false;
  if (fa === fb) return true;
  const na = streetNumberToken(fa);
  const nb = streetNumberToken(fb);
  if (!na || !nb || na !== nb) return false;
  if (fa.includes(fb) || fb.includes(fa)) return true;
  const n = Math.min(24, fa.length, fb.length);
  if (n >= 10 && fa.slice(0, n) === fb.slice(0, n)) return true;
  const wordsA = fa.split(" ").filter((w) => w.length > 2);
  const wordsB = new Set(fb.split(" ").filter((w) => w.length > 2));
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap >= 2;
}

/**
 * Match a subject property against active realestate.co.nz listings in the
 * same suburb. This gives the analysis pipeline current sale-listing data
 * without needing a browser-backed scraper.
 */
export async function fetchRealestateListingForAddress(
  freeformAddress: string,
  suburbName: string,
): Promise<ListingResult | null> {
  const trimmed = freeformAddress.trim();
  if (!trimmed || !suburbName.trim()) return null;

  const suburb = await findSuburbId(suburbName);
  if (!suburb) {
    logger.info({ suburbName }, "realestate-api: subject listing match - suburb not in directory");
    return null;
  }

  let listings: ListingResult[];
  try {
    listings = await fetchListingsForSuburbId(suburb.id, 100);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: subject listing match - listings fetch failed");
    return null;
  }

  for (const l of listings) {
    if (!addressesLikelyMatch(trimmed, l.address)) continue;
    const [annotated] = await annotateApproxFields([l]).catch(() => [l]);
    const match = annotated ?? l;
    logger.info(
      {
        suburb: suburb.title,
        address: trimmed.slice(0, 80),
        listing: match.address,
        bedrooms: match.bedrooms,
        bathrooms: match.bathrooms,
        floorArea: match.floorArea,
        landArea: match.landArea,
      },
      "realestate-api: matched active subject listing",
    );
    return match;
  }

  logger.info({ suburb: suburb.title, address: trimmed.slice(0, 80) }, "realestate-api: no active subject listing match");
  return null;
}

/**
 * Match a subject property against the active listing feed and return the
 * selling agent details attached to that listing. This is intentionally
 * separate from the feasibility data scraper because the chat UI uses it only
 * when the user asks to call/contact the listing agent.
 */
export async function fetchRealestateAgentContactForAddress(
  freeformAddress: string,
): Promise<RealestateAgentContact | null> {
  const trimmed = freeformAddress.trim();
  if (!trimmed) return null;

  const suburb = await findSuburbInTextViaIndex(trimmed);
  if (!suburb) {
    logger.info({ address: trimmed.slice(0, 80) }, "realestate-api: agent contact - suburb not found");
    return null;
  }

  let listings: RawListing[] = [];
  try {
    listings = await fetchRawListingsForSuburbId(suburb.id, 100);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: agent contact - listings fetch failed");
    return null;
  }

  let matched = listings.find((l) => {
    const address = l.attributes.address?.["full-address"] ?? l.attributes.address?.["display-address"] ?? "";
    return addressesLikelyMatch(trimmed, address);
  });

  if (!matched) {
    logger.info({ suburb: suburb.title, address: trimmed.slice(0, 80) }, "realestate-api: agent contact - no active listing match");
    return null;
  }

  const listingUrl = matched.attributes["website-full-url"] ?? null;
  let agentIds = matched.relationships?.agents?.data?.map((a) => a.id).filter(Boolean) ?? [];

  if (agentIds.length === 0) {
    try {
      const detail = await fetchJsonWithTimeout<{ data?: RawListing }>(
        `${PLATFORM_BASE}/listings/${encodeURIComponent(matched.id)}`,
      );
      if (detail.data) matched = detail.data;
      agentIds = matched.relationships?.agents?.data?.map((a) => a.id).filter(Boolean) ?? [];
    } catch (err) {
      logger.warn({ err: (err as Error).message, listingId: matched.id }, "realestate-api: agent contact - listing detail failed");
    }
  }

  for (const agentId of agentIds) {
    try {
      const agent = await fetchAgentById(agentId);
      if (!agent?.agentPhone) continue;
      return {
        ...agent,
        listingUrl,
      };
    } catch (err) {
      logger.warn({ err: (err as Error).message, agentId }, "realestate-api: agent contact - agent fetch failed");
    }
  }

  logger.info({ listingId: matched.id, address: trimmed.slice(0, 80) }, "realestate-api: agent contact - no callable agent");
  return {
    agentName: null,
    agentPhone: null,
    agencyName: null,
    agentAvatarUrl: null,
    listingUrl,
  };
}

/**
 * Fallback for users who explicitly still want an agent after the subject
 * property is not actively listed. Returns a callable agent attached to a
 * different active listing in the same suburb, not a Project Alpha sales-agent
 * directory entry.
 */
export async function fetchRealestateAgentContactForSuburbListing(
  freeformAddress: string,
): Promise<RealestateSuburbAgentContact | null> {
  const trimmed = freeformAddress.trim();
  if (!trimmed) return null;

  const suburb = await findSuburbInTextViaIndex(trimmed);
  if (!suburb) {
    logger.info({ address: trimmed.slice(0, 80) }, "realestate-api: suburb agent fallback - suburb not found");
    return null;
  }

  let listings: RawListing[] = [];
  try {
    listings = await fetchRawListingsForSuburbId(suburb.id, 60);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: suburb agent fallback - listings fetch failed");
    return null;
  }

  for (let listing of listings) {
    const listingAddress =
      listing.attributes.address?.["full-address"] ??
      listing.attributes.address?.["display-address"] ??
      null;
    if (!listingAddress || addressesLikelyMatch(trimmed, listingAddress)) continue;

    const listingUrl = listing.attributes["website-full-url"] ?? null;
    let agentIds = listing.relationships?.agents?.data?.map((a) => a.id).filter(Boolean) ?? [];
    if (agentIds.length === 0) {
      try {
        const detail = await fetchJsonWithTimeout<{ data?: RawListing }>(
          `${PLATFORM_BASE}/listings/${encodeURIComponent(listing.id)}`,
        );
        if (detail.data) listing = detail.data;
        agentIds = listing.relationships?.agents?.data?.map((a) => a.id).filter(Boolean) ?? [];
      } catch (err) {
        logger.warn({ err: (err as Error).message, listingId: listing.id }, "realestate-api: suburb agent fallback - listing detail failed");
      }
    }

    for (const agentId of agentIds) {
      try {
        const agent = await fetchAgentById(agentId);
        if (!agent?.agentPhone) continue;
        return {
          ...agent,
          listingUrl,
          listingAddress,
        };
      } catch (err) {
        logger.warn({ err: (err as Error).message, agentId }, "realestate-api: suburb agent fallback - agent fetch failed");
      }
    }
  }

  logger.info({ suburb: suburb.title, address: trimmed.slice(0, 80) }, "realestate-api: suburb agent fallback - no callable agent");
  return null;
}

/**
 * When OneRoof has no listing photos, match the property against active
 * realestate.co.nz listings in the same suburb and return image URL(s) from
 * the platform JSON API.
 */
export async function fetchRealestatePhotosForAddress(
  freeformAddress: string,
  suburbName: string,
): Promise<string[]> {
  const trimmed = freeformAddress.trim();
  if (!trimmed || !suburbName.trim()) return [];

  const suburb = await findSuburbId(suburbName);
  if (!suburb) {
    logger.info({ suburbName }, "realestate-api: photo fallback — suburb not in directory");
    return [];
  }

  let listings: ListingResult[];
  try {
    listings = await fetchListingsForSuburbId(suburb.id, 100);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: photo fallback — listings fetch failed");
    return [];
  }

  const out: string[] = [];
  for (const l of listings) {
    if (!addressesLikelyMatch(trimmed, l.address)) continue;
    // Add all photos from the matched listing (up to 4 high-res images)
    const urls = l.photoUrls?.length ? l.photoUrls : (l.photoUrl ? [l.photoUrl] : []);
    for (const url of urls) {
      if (!out.includes(url)) out.push(url);
    }
    // We found our address match — no need to keep scanning other listings
    break;
  }

  if (out.length > 0) {
    logger.info(
      { suburb: suburb.title, count: out.length, address: trimmed.slice(0, 64) },
      "realestate-api: photo fallback matched active listing(s)",
    );
  }
  return out;
}

function addressKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48);
}

/**
 * Fetches 3–5 **active** realestate.co.nz residential listings in the same
 * suburb to use as price comparables when OneRoof does not return enough
 * nearby *sold* records. Asking prices are real sourced data. Intended to run
 * **once, sequentially** in the property pipeline (no parallel duplicate calls).
 */
export async function fetchSupplementListingComparables(opts: {
  suburbName: string;
  excludeAddress?: string;
  priceHintNzd?: number | null;
  landHintSqm?: number | null;
  minTarget: number;
  maxResults: number;
}): Promise<ComparableSale[]> {
  const { suburbName, excludeAddress, priceHintNzd, landHintSqm, minTarget, maxResults } = opts;
  if (!suburbName.trim()) return [];

  const suburb = await findSuburbId(suburbName);
  if (!suburb) {
    logger.info({ suburbName }, "realestate-api: comparables supplement — suburb not in directory");
    return [];
  }

  let listings: ListingResult[];
  try {
    listings = await fetchListingsForSuburbId(suburb.id, 100);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: comparables supplement — fetch failed");
    return [];
  }

  const exKey = excludeAddress ? addressKey(excludeAddress) : "";
  let pool = listings.filter(
    (l) => l.price != null && l.price > 100_000 && l.address && l.address.length > 8,
  );
  if (exKey) {
    pool = pool.filter((l) => {
      const k = addressKey(l.address);
      return k !== exKey && !k.startsWith(exKey.slice(0, 10));
    });
  }
  if (priceHintNzd && priceHintNzd > 200_000) {
    const lo = priceHintNzd * 0.2;
    const hi = priceHintNzd * 5;
    const banded = pool.filter((l) => l.price! >= lo && l.price! <= hi);
    if (banded.length >= minTarget) pool = banded;
  }
  if (landHintSqm && landHintSqm > 50) {
    pool = [...pool].sort((a, b) => {
      const da = Math.abs((a.landArea ?? 0) - landHintSqm);
      const db = Math.abs((b.landArea ?? 0) - landHintSqm);
      return da - db;
    });
  }
  const out: ComparableSale[] = [];
  for (const l of pool) {
    if (out.length >= maxResults) break;
    out.push({
      address: l.address.trim(),
      sale_date: null,
      price_nzd: l.price!,
      bedrooms: l.bedrooms,
      land_area_sqm: l.landArea,
      floor_sqm: l.floorArea ?? null,
    });
  }

  if (out.length > 0) {
    logger.info(
      { suburb: suburb.title, count: out.length, source: "realestate.co.nz (active listings)" },
      "realestate-api: comparables supplement",
    );
  }
  return out;
}

/**
 * Pull a land-area sqm number out of free-form listing text.
 * realestate.co.nz og:description tends to say things like
 * "503 m² section" or "503sqm", occasionally "0.05 ha". Floor area phrasing
 * ("180 m² floor") is intentionally excluded so we don't confuse the two.
 */
function extractLandAreaSqm(text: string): number | null {
  if (!text) return null;
  // Hectares first ("0.12 ha" → 1200 m²).
  const haMatch = text.match(/(\d+(?:\.\d+)?)\s*ha\b/i);
  if (haMatch) {
    const ha = parseFloat(haMatch[1]);
    if (Number.isFinite(ha) && ha > 0 && ha < 1000) return Math.round(ha * 10_000);
  }
  // Prefer numbers explicitly described as land/section/site to avoid floor area.
  const labelled = text.match(/(\d[\d,]*)\s*(?:m[²2]|sqm|sq\s*m)\s*(?:section|site|land|of land)/i)
    ?? text.match(/(?:section|site|land)[^\d]{0,12}(\d[\d,]*)\s*(?:m[²2]|sqm|sq\s*m)/i);
  // Generic fallback: a bare "503 m²" with no label. Reject when the surrounding
  // ±20 chars contain a floor-area label, otherwise we'd misread "180 m² floor"
  // as land area and falsely flag it as disagreeing with the API.
  const genericRe = /(\d[\d,]*)\s*(?:m[²2]|sqm|sq\s*m)\b/i;
  const genericMatch = text.match(genericRe);
  let generic: RegExpMatchArray | null = null;
  if (genericMatch && genericMatch.index != null) {
    const start = Math.max(0, genericMatch.index - 20);
    const end = Math.min(text.length, genericMatch.index + genericMatch[0].length + 20);
    const window = text.slice(start, end);
    if (!/\b(?:floor|house|home|dwelling)\b/i.test(window)) generic = genericMatch;
  }
  const raw = labelled?.[1] ?? generic?.[1];
  if (!raw) return null;
  const n = parseInt(raw.replace(/,/g, ""), 10);
  // Plausible residential range — guards against e.g. "180 m² floor" leaking through
  // when there's no explicit land label and the number is implausibly small.
  if (!Number.isFinite(n) || n < 50 || n > 1_000_000) return null;
  return n;
}

/**
 * Pull a floor (dwelling) area in m² out of free-form listing text.
 * Looks for explicit floor/house/home/dwelling labels so we don't confuse
 * floor area with land area (which uses section/site/land phrasing).
 */
function extractFloorAreaSqm(text: string): number | null {
  if (!text) return null;
  const labelled = text.match(/(\d[\d,]*)\s*(?:m[²2]|sqm|sq\s*m)\s*(?:floor|house|home|dwelling)/i)
    ?? text.match(/(?:floor(?:\s*area)?|house|home|dwelling)[^\d]{0,12}(\d[\d,]*)\s*(?:m[²2]|sqm|sq\s*m)/i);
  if (!labelled) return null;
  const n = parseInt(labelled[1].replace(/,/g, ""), 10);
  // Plausible residential range — typical NZ houses 40-1000 m².
  if (!Number.isFinite(n) || n < 20 || n > 5_000) return null;
  return n;
}

function htmlToSearchableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractListingFactAreaSqm(text: string, kind: "land" | "floor"): number | null {
  if (!text) return null;
  const label = kind === "land" ? "Land" : "Floor";
  const re = new RegExp(`${label}\\s*Area\\s*:\\s*(\\d[\\d,]*)\\s*(?:m[Â²2]|sqm|sq\\s*m)`, "i");
  const match = text.match(re);
  if (!match) return null;
  const n = parseInt(match[1].replace(/,/g, ""), 10);
  const min = kind === "land" ? 50 : 20;
  const max = kind === "land" ? 1_000_000 : 5_000;
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * Look for a JSON-LD "floorSize" field anywhere in the fetched HTML.
 * Realestate.co.nz embeds a Residence/SingleFamilyResidence record in many
 * listing pages; when present, floorSize is a server-side authoritative
 * second source we can cross-check the og:description value against.
 */
function extractFloorSizeFromJsonLd(html: string): number | null {
  if (!html) return null;
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const m of blocks) {
    const body = m[1];
    const fsMatch = body.match(/"floorSize"\s*:\s*(?:"(\d[\d,.]*)"|\{[^}]*?"value"\s*:\s*"?(\d[\d,.]*)"?[^}]*\})/i);
    const raw = fsMatch?.[1] ?? fsMatch?.[2];
    if (raw) {
      const n = parseInt(raw.replace(/[,.]/g, ""), 10);
      if (Number.isFinite(n) && n >= 20 && n <= 5_000) return n;
    }
  }
  return null;
}

interface OgMeta {
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  floorAreaSqm: number | null;
  /** Second-source floor area from page JSON-LD; used to cross-check against the og:description value. */
  floorAreaSqmJsonLd: number | null;
  price: number | null;
}

export function reconcileListingLandArea(
  apiLandArea: number | null | undefined,
  pageLandArea: number | null | undefined,
): { landArea: number | null; landAreaApprox: boolean } {
  if (apiLandArea != null && pageLandArea != null) {
    const diff = Math.abs(apiLandArea - pageLandArea);
    const pct = diff / Math.max(apiLandArea, pageLandArea);
    if (diff > 10 && pct > 0.05) {
      return { landArea: pageLandArea, landAreaApprox: true };
    }
  }
  return { landArea: apiLandArea ?? null, landAreaApprox: false };
}

async function fetchOgMeta(url: string): Promise<OgMeta | null> {
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
    const bodyText = htmlToSearchableText(html);
    const combined = `${ogTitle} ${ogDesc}`;
    const beds = extractBedsBaths(combined);
    return {
      bedrooms: beds.bedrooms,
      bathrooms: beds.bathrooms,
      landAreaSqm: extractListingFactAreaSqm(bodyText, "land") ?? extractLandAreaSqm(combined),
      floorAreaSqm: extractListingFactAreaSqm(bodyText, "floor") ?? extractFloorAreaSqm(combined),
      floorAreaSqmJsonLd: extractFloorSizeFromJsonLd(html),
      price: parsePriceDisplay(combined),
    };
  } catch {
    return null;
  }
}

/**
 * Cross-check the structured API's bedroom/bathroom/land-area/price against the
 * og:description on the listing's social-share card. Both numbers come from
 * the same upstream listing record but they're populated by different
 * pipelines on realestate.co.nz, and they occasionally disagree. When they do,
 * we mark the value as approximate so the UI can flag it rather than silently
 * picking whichever source happened to win.
 *
 * Thresholds are chosen to avoid false positives from rounding/tile-display
 * differences:
 *   - bed/bath: any numeric disagreement (counts are integers)
 *   - land area: differ by both >5% AND >10 m² (small surveys round freely)
 *   - price: differ by >5% (tolerates "$1.20M" vs "$1,250,000" rounding)
 */
async function annotateApproxFields(listings: ListingResult[]): Promise<ListingResult[]> {
  if (listings.length === 0) return listings;
  const checks: ListingResult[] = [];
  const batchSize = 12;

  for (let i = 0; i < listings.length; i += batchSize) {
    const batch = listings.slice(i, i + batchSize);
    const annotated = await Promise.all(
      batch.map(async (l) => {
      // Always fetch — even when the API gave us no numbers to verify, the og
      // payload is our only source of floor area, which is worth surfacing on
      // the card. (The first-batch annotation budget already accounted for
      // one fetch per listing.)
      const og = await fetchOgMeta(l.listingUrl);
      if (!og) return l;

      const bedroomsApprox =
        l.bedrooms != null && og.bedrooms != null && og.bedrooms !== l.bedrooms;
      const bathroomsApprox =
        l.bathrooms != null && og.bathrooms != null && og.bathrooms !== l.bathrooms;

      // The public search API can occasionally attach an aggregate or
      // neighbouring parcel area to a listing card. The listing page's own
      // metadata is closer to what users see on property portals, so prefer it
      // for the card while still marking it approximate.
      const { landArea, landAreaApprox } = reconcileListingLandArea(l.landArea, og.landAreaSqm);

      let priceApprox = false;
      if (l.price != null && og.price != null) {
        const pct = Math.abs(l.price - og.price) / Math.max(l.price, og.price);
        priceApprox = pct > 0.05;
      }

      // Floor area: the structured listings API doesn't expose it, so the two
      // sources we cross-check are the og:description text and any JSON-LD
      // `floorSize` block embedded in the page. We surface whichever value we
      // see first; if both are present and differ by more than 5 m² AND >5%,
      // we flag it as approximate.
      const floorArea = og.floorAreaSqm ?? og.floorAreaSqmJsonLd ?? null;
      let floorAreaApprox = false;
      if (og.floorAreaSqm != null && og.floorAreaSqmJsonLd != null) {
        const diff = Math.abs(og.floorAreaSqm - og.floorAreaSqmJsonLd);
        const pct = diff / Math.max(og.floorAreaSqm, og.floorAreaSqmJsonLd);
        floorAreaApprox = diff > 5 && pct > 0.05;
      }

      if (bedroomsApprox || bathroomsApprox || landAreaApprox || priceApprox || floorAreaApprox) {
        logger.info(
          {
            url: l.listingUrl,
            api: { bedrooms: l.bedrooms, bathrooms: l.bathrooms, landArea: l.landArea, price: l.price },
            og,
            flags: { bedroomsApprox, bathroomsApprox, landAreaApprox, priceApprox, floorAreaApprox },
          },
          "realestate-api: API/og:description disagreement — flagging approximate",
        );
      }
      return {
        ...l,
        landArea,
        floorArea,
        bedroomsApprox,
        bathroomsApprox,
        landAreaApprox,
        priceApprox,
        floorAreaApprox,
      };
      }),
    );
    checks.push(...annotated);
  }

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

  // Cross-check listing detail pages before cards are shown. realestate.co.nz's
  // search API occasionally carries aggregate/header values from package listings.
  // The report pipeline later reconciles these values against LINZ/council data.
  const annotatedOrdered = await annotateApproxFields(ordered).catch(() => ordered);

  return {
    firstBatch: annotatedOrdered.slice(0, firstBatchSize),
    remainingListings: annotatedOrdered.slice(firstBatchSize),
    totalFound: annotatedOrdered.length,
    source: "realestate.co.nz/api",
    suburbResolved: { id: suburb.id, title: suburb.title, fqSlug: suburb.fqSlug },
  };
}
