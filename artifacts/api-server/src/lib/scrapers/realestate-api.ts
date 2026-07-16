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
import { looksLikeUnitOrApartmentAddress } from "../address-patterns";
import type { ComparableSale, ListingResult } from "./oneroof";
import { extractBedsBaths } from "./bed-bath-extractor";

const PLATFORM_BASE = "https://platform.realestate.co.nz/search/v1";
const MEDIA_BASE = "https://mediaserver.realestate.co.nz";
const FETCH_TIMEOUT_MS = 12_000;
const ADDRESS_MATCH_TIMEOUT_MS = 15_000;

export interface SuburbRecord {
  id: string;
  title: string;          // "Bucklands Beach"
  slug: string;           // "bucklands-beach"
  fqSlug: string;         // "auckland_manukau-city_bucklands-beach"
  districtId: number;     // 223
}

export interface DistrictRecord {
  id: string;
  title: string;
  slug: string;
  fqSlug: string;
  region: string;
}

export interface RegionRecord {
  id: string;
  title: string;
  slug: string;
}

export type RealestateLocationResolution =
  | { status: "suburb"; suburb: SuburbRecord; original: string | null }
  | { status: "district"; district: DistrictRecord; suburbs: SuburbRecord[]; original: string | null }
  | { status: "region"; region: RegionRecord; districts: DistrictRecord[]; original: string | null }
  | { status: "invalid"; closest?: string | null };

export interface FuzzySuburbMatch {
  suburb: SuburbRecord;
  alias: string;
  distance: number;
  similarity: number;
  margin: number;
}

interface SuburbIndex {
  byNormalisedName: Map<string, SuburbRecord>;  // "bucklands beach" → record
  byId: Map<string, SuburbRecord>;
  regions: Map<string, RegionRecord>;
  regionsByNormalisedName: Map<string, RegionRecord>;
  districts: Map<string, DistrictRecord>;
  districtsByNormalisedName: Map<string, DistrictRecord>;
  regionDistricts: Map<string, DistrictRecord[]>;
  districtChildren: Map<string, SuburbRecord[]>;
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

function regionFromFqSlug(fqSlug: string | null | undefined): string | null {
  const region = String(fqSlug ?? "").split("_")[0]?.trim();
  return region || null;
}

function addDistrictAlias(target: Map<string, DistrictRecord>, alias: string, rec: DistrictRecord): void {
  const key = normaliseName(alias.replace(/-/g, " "));
  if (key && !target.has(key)) target.set(key, rec);
}

function addRegionAlias(target: Map<string, RegionRecord>, alias: string, rec: RegionRecord): void {
  const key = normaliseName(alias.replace(/-/g, " "));
  if (key && !target.has(key)) target.set(key, rec);
}

const REGION_ALIASES: Record<string, string[]> = {
  auckland: ["auckland", "auckland region", "akl"],
  canterbury: ["canterbury", "canterbury region"],
  waikato: ["waikato", "waikato region"],
  wellington: ["wellington"],
  otago: ["otago", "otago region"],
  "central-otago-lakes-district": ["central otago lakes district", "lakes district"],
  "bay-of-plenty": ["bay of plenty", "bop"],
  northland: ["northland"],
  "hawkes-bay": ["hawkes bay", "hawke's bay"],
  "manawatu-whanganui": ["manawatu whanganui", "manawatu / whanganui"],
  taranaki: ["taranaki"],
  nelson: ["nelson", "nelson bays", "nelson & bays"],
  marlborough: ["marlborough"],
  southland: ["southland"],
  gisborne: ["gisborne"],
};

function mentionedRegions(text: string | null | undefined): Set<string> {
  const normalised = normaliseName(text ?? "");
  const regions = new Set<string>();
  if (!normalised) return regions;
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    for (const alias of aliases) {
      const key = normaliseName(alias);
      if (!key) continue;
      if (new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(normalised)) {
        regions.add(region);
        break;
      }
    }
  }
  return regions;
}

function recordRegion(rec: SuburbRecord | DistrictRecord): string | null {
  return "region" in rec ? rec.region : regionFromFqSlug(rec.fqSlug);
}

function matchesRegionHint(rec: SuburbRecord | DistrictRecord, regions: Set<string>): boolean {
  if (regions.size === 0) return true;
  const region = recordRegion(rec);
  return !!region && regions.has(region);
}

function stripRegionHints(raw: string): string {
  let out = ` ${normaliseName(raw)} `;
  for (const aliases of Object.values(REGION_ALIASES)) {
    for (const alias of aliases) {
      const key = normaliseName(alias);
      if (!key) continue;
      out = out.replace(new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " ");
    }
  }
  return out
    .replace(/\b(?:region|area|district)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Exponential-backoff delays for transient failures (5xx, network errors, timeouts).
 * Used by both the JSON API fetch and the per-listing pre-screen retry loop.
 * Tuned so that 4 attempts fit inside the chat request budget while still riding
 * out a brief upstream outage.
 */
const FETCH_RETRY_DELAYS_MS = [250, 750, 1800, 4000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFetchError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  if (/HTTP 5\d\d/.test(msg)) return true;
  if (/HTTP 429/.test(msg)) return true;
  if (/abort|timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(msg)) return true;
  return false;
}

async function fetchJsonWithTimeoutOnce<T>(url: string): Promise<T> {
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

/**
 * Fetch with retries on transient failures. The discovery flow asks "what's
 * subdividable in <suburb>?" — a single failed listings page used to silently
 * drop ~100 candidates from consideration, so we now retry up to four times
 * with backoff before giving up.
 */
async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchJsonWithTimeoutOnce<T>(url);
    } catch (err) {
      lastErr = err;
      if (!isRetryableFetchError(err) || attempt === FETCH_RETRY_DELAYS_MS.length) {
        throw err;
      }
      const waitMs = FETCH_RETRY_DELAYS_MS[attempt];
      logger.info({ url, attempt: attempt + 1, waitMs, err: (err as Error).message }, "realestate-api: transient fetch failure, retrying with backoff");
      await sleep(waitMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function fetchJsonWithFixedTimeout<T>(url: string, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
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
  data: Array<{ type: "regions" | string; id: string; attributes: { title: string; slug: string } }>;
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

    const regions = new Map<string, RegionRecord>();
    const regionsByNorm = new Map<string, RegionRecord>();
    const districts = new Map<string, DistrictRecord>();
    const districtsByNorm = new Map<string, DistrictRecord>();
    const regionDistricts = new Map<string, DistrictRecord[]>();
    const districtChildren = new Map<string, SuburbRecord[]>();
    const byNorm = new Map<string, SuburbRecord>();
    const byId = new Map<string, SuburbRecord>();

    for (const item of json.data ?? []) {
      if (item.type !== "regions") continue;
      const rec: RegionRecord = {
        id: item.id,
        title: item.attributes.title,
        slug: item.attributes.slug,
      };
      regions.set(rec.slug, rec);
      addRegionAlias(regionsByNorm, rec.title, rec);
      addRegionAlias(regionsByNorm, rec.slug, rec);
      for (const alias of REGION_ALIASES[rec.slug] ?? []) addRegionAlias(regionsByNorm, alias, rec);
    }

    for (const item of json.included ?? []) {
      if (item.type === "districts") {
        const fqSlug = item.attributes["fq-slug"] ?? "";
        const region = regionFromFqSlug(fqSlug) ?? "";
        const rec: DistrictRecord = {
          id: item.id,
          title: item.attributes.title,
          slug: item.attributes.slug,
          fqSlug,
          region,
        };
        districts.set(item.id, rec);
        const regionItems = regionDistricts.get(region) ?? [];
        regionItems.push(rec);
        regionDistricts.set(region, regionItems);
        addDistrictAlias(districtsByNorm, rec.title, rec);
        addDistrictAlias(districtsByNorm, rec.slug, rec);
        const titleWithoutSuffix = rec.title.replace(/\s+(?:city|district)$/i, "").trim();
        if (titleWithoutSuffix && titleWithoutSuffix !== rec.title) addDistrictAlias(districtsByNorm, titleWithoutSuffix, rec);
        const slugWithoutSuffix = rec.slug.replace(/-(?:city|district)$/i, "").trim();
        if (slugWithoutSuffix && slugWithoutSuffix !== rec.slug) addDistrictAlias(districtsByNorm, slugWithoutSuffix, rec);
        if (/queenstown-lakes/i.test(rec.title)) {
          addDistrictAlias(districtsByNorm, "queenstown lakes", rec);
          addDistrictAlias(districtsByNorm, "qldc", rec);
        }
        if (rec.fqSlug) addDistrictAlias(districtsByNorm, rec.fqSlug.replace(/_/g, " "), rec);
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
      const children = districtChildren.get(String(districtId)) ?? [];
      children.push(rec);
      districtChildren.set(String(districtId), children);

      const aliases = new Set<string>();
      const baseNorm = normaliseName(rec.title);
      aliases.add(baseNorm);
      // Users often type well-known multi-word suburbs as one token
      // ("flatbush", "northcote point"). Keep the official spaced title as
      // canonical, but let location extraction match the joined variant.
      if (baseNorm.includes(" ")) aliases.add(baseNorm.replace(/\s+/g, ""));
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

    suburbIndexCache = {
      byNormalisedName: byNorm,
      byId,
      regions,
      regionsByNormalisedName: regionsByNorm,
      districts,
      districtsByNormalisedName: districtsByNorm,
      regionDistricts,
      districtChildren,
      loadedAt: Date.now(),
    };
    logger.info(
      { suburbs: byId.size, districts: districts.size, regions: regions.size, aliasKeys: byNorm.size },
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
 * Tries exact normalised match, then a small set of obvious variants.
 * Fuzzy matching lives in the region-aware resolver below.
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

  // Avoid implicit fuzzy suburb matches here; callers that need approximate
  // matches should use the region-aware resolver below.
  return null;
}

export async function findClosestSuburbByName(name: string): Promise<FuzzySuburbMatch | null> {
  if (!name || !name.trim()) return null;
  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: failed to load suburb index for fuzzy match");
    return null;
  }

  const target = normaliseName(name);
  if (!target || target.length < 4) return null;

  let best: FuzzySuburbMatch | null = null;
  let secondSimilarity = -Infinity;

  for (const [alias, rec] of index.byNormalisedName) {
    if (alias.length < 4 || Math.abs(alias.length - target.length) > 4) continue;
    const distance = levenshtein(alias, target);
    const similarity = 1 - distance / Math.max(alias.length, target.length);
    if (!best || similarity > best.similarity || (similarity === best.similarity && distance < best.distance)) {
      if (best) secondSimilarity = Math.max(secondSimilarity, best.similarity);
      best = { suburb: rec, alias, distance, similarity, margin: 0 };
    } else {
      secondSimilarity = Math.max(secondSimilarity, similarity);
    }
  }

  if (!best) return null;
  return { ...best, margin: best.similarity - (secondSimilarity === -Infinity ? 0 : secondSimilarity) };
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

export async function getDistrictSuburbs(districtId: string, max = 80): Promise<SuburbRecord[]> {
  if (max <= 0) return [];
  try {
    const index = await loadSuburbIndex();
    return (index.districtChildren.get(String(districtId)) ?? []).slice(0, max);
  } catch {
    return [];
  }
}

export interface LocationSuburbExpansion {
  scope: "suburb" | "district" | "region";
  /** Display label for the matched location (e.g. "Waikato", "Hamilton City"). */
  label: string;
  /** Lowercased leaf-suburb names under the location, capped. */
  suburbNames: string[];
}

/**
 * Expand a location NAME (leaf suburb, district/city, or whole region) into the
 * lowercased leaf-suburb names it contains, using the realestate.co.nz
 * directory. Powers criteria search over the analysed-property index, whose
 * `suburb` column only ever holds leaf-suburb names — so a region-level ask
 * ("Waikato") must match via its member suburbs (Hamilton's suburbs etc.), for
 * ANY NZ region, not just Auckland. Returns null when the name isn't in the
 * directory (caller decides the fallback).
 */
export async function resolveLocationToSuburbNames(
  name: string,
  maxSuburbs = 500,
): Promise<LocationSuburbExpansion | null> {
  const key = normaliseName(name);
  if (!key) return null;
  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: failed to load location index for suburb expansion");
    return null;
  }

  // Leaf suburb wins first — mirrors resolveDistrictToSuburbs' precedence so a
  // name that is both (e.g. "howick") keeps its narrow meaning.
  const leaf = index.byNormalisedName.get(key);
  if (leaf) {
    return { scope: "suburb", label: leaf.title, suburbNames: [leaf.title.toLowerCase()] };
  }

  const district = index.districtsByNormalisedName.get(key);
  if (district) {
    const children = index.districtChildren.get(district.id) ?? [];
    return {
      scope: "district",
      label: district.title,
      suburbNames: children.slice(0, maxSuburbs).map((s) => s.title.toLowerCase()),
    };
  }

  const region = index.regionsByNormalisedName.get(key);
  if (region) {
    const names: string[] = [];
    for (const d of index.regionDistricts.get(region.slug) ?? []) {
      for (const s of index.districtChildren.get(d.id) ?? []) {
        names.push(s.title.toLowerCase());
        if (names.length >= maxSuburbs) break;
      }
      if (names.length >= maxSuburbs) break;
    }
    return { scope: "region", label: region.title, suburbNames: names };
  }

  return null;
}

function locationCandidates(input: string): string[] {
  const rawParts = input
    .split(/[,/|]+|\bin\b|\bnear\b|\baround\b/gi)
    .map((part) => normaliseName(part))
    .filter(Boolean);
  const strippedParts = input
    .split(/[,/|]+|\bin\b|\bnear\b|\baround\b/gi)
    .map((part) => stripRegionHints(part))
    .filter(Boolean);
  const fullRaw = normaliseName(input);
  const fullStripped = stripRegionHints(input);
  return Array.from(new Set([fullRaw, fullStripped, ...rawParts, ...strippedParts].filter((value) => value.length >= 3)));
}

export async function resolveRealestateLocation(
  input: string | null | undefined,
  contextText?: string | null,
): Promise<RealestateLocationResolution | null> {
  const raw = input?.trim();
  if (!raw) return null;

  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-api: failed to load location index");
    return { status: "invalid" };
  }

  const regions = mentionedRegions(`${contextText ?? ""} ${raw}`);
  const candidates = locationCandidates(raw);

  for (const candidate of candidates) {
    const candidateKey = normaliseName(candidate);
    const directRegion = index.regionsByNormalisedName.get(candidateKey);
    const directDistrict = index.districtsByNormalisedName.get(candidateKey);
    const standaloneRegionPart = !!directRegion && /[,/|]/.test(raw) && candidateKey !== normaliseName(raw);
    if (standaloneRegionPart) continue;
    if (directRegion && (!directDistrict || /\bregion\b/i.test(candidate) || normaliseName(directRegion.title) === candidateKey || normaliseName(directRegion.slug) === candidateKey)) {
      return {
        status: "region",
        region: directRegion,
        districts: index.regionDistricts.get(directRegion.slug) ?? [],
        original: candidateKey === normaliseName(raw) ? null : raw,
      };
    }
    if (directDistrict && matchesRegionHint(directDistrict, regions)) {
      const suburbs = index.districtChildren.get(directDistrict.id) ?? [];
      return {
        status: "district",
        district: directDistrict,
        suburbs,
        original: normaliseName(directDistrict.title) === normaliseName(raw) ? null : raw,
      };
    }
    if (directRegion) {
      return {
        status: "region",
        region: directRegion,
        districts: index.regionDistricts.get(directRegion.slug) ?? [],
        original: candidateKey === normaliseName(raw) ? null : raw,
      };
    }
  }

  for (const candidate of candidates) {
    const directSuburb = index.byNormalisedName.get(normaliseName(candidate));
    if (directSuburb && matchesRegionHint(directSuburb, regions)) {
      return {
        status: "suburb",
        suburb: directSuburb,
        original: normaliseName(directSuburb.title) === normaliseName(raw) ? null : raw,
      };
    }
  }

  const fuzzy = await findClosestSuburbByName(raw);
  if (fuzzy && matchesRegionHint(fuzzy.suburb, regions)) {
    const confident =
      (fuzzy.distance <= 2 && fuzzy.similarity >= 0.82 && fuzzy.margin >= 0.05) ||
      (regions.size > 0 && fuzzy.distance <= 2 && fuzzy.similarity >= 0.78 && fuzzy.margin >= 0.04);
    if (confident) {
      return { status: "suburb", suburb: fuzzy.suburb, original: raw };
    }
  }

  const usefulClosest = fuzzy && fuzzy.distance <= 3 && fuzzy.similarity >= 0.72 ? fuzzy.suburb.title : null;
  return { status: "invalid", closest: usefulClosest };
}

export async function findLocationInTextViaIndex(text: string): Promise<RealestateLocationResolution | null> {
  if (!text || !text.trim()) return null;
  let index: SuburbIndex;
  try {
    index = await loadSuburbIndex();
  } catch {
    return null;
  }
  const regions = mentionedRegions(text);
  const normalised = normaliseName(text);
  const matches: Array<{ label: string; value: RealestateLocationResolution; length: number }> = [];

  for (const [alias, suburb] of index.byNormalisedName) {
    if (alias.length < 3 || !matchesRegionHint(suburb, regions)) continue;
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(normalised)) {
      matches.push({
        label: alias,
        length: alias.length,
        value: { status: "suburb", suburb, original: null },
      });
    }
  }

  for (const [alias, district] of index.districtsByNormalisedName) {
    if (alias.length < 3 || !matchesRegionHint(district, regions)) continue;
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(normalised)) {
      matches.push({
        label: alias,
        length: alias.length,
        value: {
          status: "district",
          district,
          suburbs: index.districtChildren.get(district.id) ?? [],
          original: null,
        },
      });
    }
  }

  for (const [alias, region] of index.regionsByNormalisedName) {
    if (alias.length < 3) continue;
    if (
      region.slug === "auckland" &&
      normalised !== "auckland" &&
      !/\bauckland region\b/i.test(normalised)
    ) {
      continue;
    }
    const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(normalised)) {
      matches.push({
        label: alias,
        length: alias.length,
        value: {
          status: "region",
          region,
          districts: index.regionDistricts.get(region.slug) ?? [],
          original: null,
        },
      });
    }
  }

  matches.sort((a, b) => {
    const regionRankA = a.value.status === "region" ? 1 : 0;
    const regionRankB = b.value.status === "region" ? 1 : 0;
    return regionRankA - regionRankB
      || b.length - a.length
      || (a.value.status === "district" ? -1 : 1);
  });
  return matches[0]?.value ?? null;
}

export function _resetSuburbIndexCacheForTests(): void {
  suburbIndexCache = null;
  inflightLoad = null;
}

/**
 * Return suburbs in the same realestate.co.nz district as the given suburb,
 * excluding the suburb itself. Districts roughly correspond to council/board
 * areas (e.g. "auckland-city", "manukau-city") so sister suburbs are usually
 * geographically adjacent — a reasonable hand-mapping-free starting point
 * for a "nearby suburbs" fallback.
 */
export async function getDistrictSiblings(suburbId: string, max = 8): Promise<SuburbRecord[]> {
  if (max <= 0) return [];
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
    "property-type"?: string;
    "propertyType"?: string;
    "listing-category"?: string;
    "property-category"?: string;
    "title-type"?: string;
    tenure?: string;
    "legal-description"?: string;
    description?: string;
    "listing-description"?: string;
    "marketing-description"?: string;
    "description-html"?: string;
    photos?: Array<{ "base-url"?: string; large?: string; medium?: string }>;
  };
}

interface ListingsResponse {
  data?: RawListing[];
  meta?: { totalResults?: number; offset?: number; limit?: number; resultsPerPage?: number };
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
  listingAddress: string | null;
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

export function normaliseListingLandAreaSqm(rawArea: number | null | undefined, rawUnit: string | null | undefined): number | null {
  if (typeof rawArea !== "number" || !Number.isFinite(rawArea) || rawArea <= 0) return null;
  const unit = (rawUnit ?? "").trim().toUpperCase();
  if (unit === "HA" || unit === "HECTARE" || unit === "HECTARES") {
    return Math.round(rawArea * 10_000);
  }
  return Math.round(rawArea);
}

function buildPhotoUrl(photos: RawListing["attributes"]["photos"]): string | null {
  if (!photos || photos.length === 0) return null;
  const first = photos[0];
  const baseUrl = first["base-url"];
  if (!baseUrl) return null;
  return `${MEDIA_BASE}${baseUrl}.crop.1280x720.jpg`;
}

function stringAttr(attrs: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function cleanListingDescription(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const text = decodeHtmlEntities(value.replace(/<[^>]+>/g, " "));
  if (text.length < 24) return null;
  return text.slice(0, 2500);
}

function finiteNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Return up to `limit` high-res photo URLs from a listing's photo array.
 * Each photo uses the same 1280×720 crop path as the hero image.
 */
export function buildPhotoUrls(
  photos: RawListing["attributes"]["photos"],
  limit = Number.POSITIVE_INFINITY,
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
  const rawAttrs = a as Record<string, unknown>;
  const url = a["website-full-url"];
  const address = a.address?.["full-address"] ?? a.address?.["display-address"];
  if (!url || !address) return null;

  const priceText = a["price-display"] ?? "";
  const price = parsePriceDisplay(priceText);
  const landArea = normaliseListingLandAreaSqm(a["land-area"], a["land-area-unit"] ?? null);
  const isCombinedListing = looksLikeCombinedListingAddress(address);
  const sourceDescription = cleanListingDescription(
    stringAttr(rawAttrs, ["listing-description", "marketing-description", "description-html", "description"]),
  );

  const photoUrls = buildPhotoUrls(a.photos);
  return {
    address,
    price,
    priceText,
    landArea,
    landAreaSource: landArea != null ? "realestate_api" : "unknown",
    landAreaConfidence: "unverified",
    isCombinedListing,
    combinedListingReason: isCombinedListing ? "multi_address_listing" : null,
    listingStatus: a["listing-status"] ?? null,
    listingTitle: address.split(",")[0]?.trim() || address,
    description: sourceDescription,
    features: [],
    photoUrl: photoUrls[0] ?? null,
    photoUrls,
    listingUrl: url,
    zone: null,
    bedrooms: typeof a["bedroom-count"] === "number" ? a["bedroom-count"] : null,
    bathrooms: typeof a["bathrooms-total-count"] === "number" ? a["bathrooms-total-count"] : null,
    lat: finiteNumber(a.address?.latitude),
    lng: finiteNumber(a.address?.longitude),
    propertyType: stringAttr(rawAttrs, ["property-type", "propertyType", "property_type"]),
    listingCategory: stringAttr(rawAttrs, ["listing-category", "property-category"]),
    tenureText: stringAttr(rawAttrs, ["title-type", "tenure", "estate-type"]),
    legalDescription: stringAttr(rawAttrs, ["legal-description", "legalDescription"]),
  };
}

async function fetchRawListingById(id: string): Promise<RawListing | null> {
  const json = await fetchJsonWithTimeout<{ data?: RawListing }>(`${PLATFORM_BASE}/listings/${encodeURIComponent(id)}`);
  return json.data ?? null;
}

function listingIdFromUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const match = url.match(/realestate\.co\.nz\/(\d+)\//i) ?? url.match(/\/listings\/(\d+)(?:\b|\/|\?)/i);
  return match?.[1] ?? null;
}

export async function fetchRealestateListingByUrl(url: string): Promise<ListingResult | null> {
  const id = listingIdFromUrl(url);
  if (!id) return null;
  const raw = await fetchRawListingById(id);
  if (!raw) return null;
  const mapped = mapListing(raw);
  if (!mapped) return null;
  const [annotated] = await annotateApproxFields([mapped]).catch(() => [mapped]);
  return annotated ?? mapped;
}

export async function fetchRealestateListingDetailsByUrl(url: string): Promise<{
  listingTitle: string | null;
  description: string | null;
  features: string[];
  imageUrls: string[];
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  floorAreaSqm: number | null;
  priceNzd: number | null;
  priceDisplay: string | null;
  agentName: string | null;
  agentPhone: string | null;
  agencyName: string | null;
  agentAvatarUrl: string | null;
} | null> {
  const id = listingIdFromUrl(url);
  if (!id) return null;
  const raw = await fetchRawListingById(id);
  if (!raw) return null;
  const mapped = mapListing(raw);
  const attrs = raw.attributes as Record<string, unknown>;
  const og = await fetchOgMeta(url).catch(() => null);
  const agent = await fetchCallableAgentForListing(raw).catch(() => null);
  const description =
    cleanListingDescription(stringAttr(attrs, ["description", "listing-description", "marketing-description", "description-html"]))
    ?? og?.description
    ?? mapped?.description
    ?? null;
  const imageUrls = mapped?.photoUrls?.length ? mapped.photoUrls : mapped?.photoUrl ? [mapped.photoUrl] : [];
  return {
    listingTitle: og?.title ?? mapped?.listingTitle ?? null,
    description,
    features: mapped?.features ?? [],
    imageUrls,
    propertyType: og?.propertyType ?? mapped?.propertyType ?? mapped?.listingCategory ?? null,
    bedrooms: og?.bedrooms ?? mapped?.bedrooms ?? null,
    bathrooms: og?.bathrooms ?? mapped?.bathrooms ?? null,
    landAreaSqm: og?.landAreaSqm ?? mapped?.landArea ?? null,
    floorAreaSqm: og?.floorAreaSqm ?? mapped?.floorArea ?? null,
    priceNzd: og?.price ?? mapped?.price ?? null,
    priceDisplay: mapped?.priceText ?? null,
    agentName: agent?.agentName ?? mapped?.agentName ?? null,
    agentPhone: agent?.agentPhone ?? null,
    agencyName: agent?.agencyName ?? mapped?.agencyName ?? null,
    agentAvatarUrl: agent?.agentAvatarUrl ?? mapped?.agentAvatarUrl ?? null,
  };
}

export async function fetchRealestateAgentForListingUrl(url: string): Promise<RealestateAgentContact | null> {
  const id = listingIdFromUrl(url);
  if (!id) return null;
  const raw = await fetchRawListingById(id);
  if (!raw) return null;
  return fetchCallableAgentForListing(raw);
}

function suburbFromAddress(address: string): string | null {
  const parts = address.split(",").map((p) => p.replace(/\b\d{4}\b/g, "").trim()).filter(Boolean);
  return parts[1] ?? null;
}

export interface ListingWindowResult {
  listings: ListingResult[];
  /** Raw source total for the suburb, when the API reported it (null if unknown). */
  totalResults: number | null;
  /** Raw API offset to resume from on the next window. */
  nextOffset: number;
  /** True once the suburb's source is genuinely drained (no further offsets). */
  done: boolean;
}

/**
 * Fetch a window of active for-sale listings for a given suburb ID, following
 * `page[offset]` from `startOffset`.
 *
 * Modes:
 *  - default (no flags): one API page (100 listings).
 *  - `fetchAllPages`: every page until the source is drained (bounded by `maxListings`).
 *  - `maxPages` (+ `startOffset`): a bounded window of N pages starting at the
 *    given offset — used for lazy/incremental pagination so a high-inventory
 *    suburb isn't fetched in full up front. The returned `nextOffset`/`done`
 *    let the caller resume the next window on demand.
 */
type ListingLocationFilter = "suburb" | "district" | "region";

async function fetchListingWindowForFilter(
  filterName: ListingLocationFilter,
  locationId: string,
  limit = 100,
  options: { fetchAllPages?: boolean; maxListings?: number; startOffset?: number; maxPages?: number } = {},
): Promise<ListingWindowResult> {
  const pageLimit = Math.min(limit, 100);
  const all: ListingResult[] = [];
  const seenIds = new Set<string>();
  let offset = Math.max(0, options.startOffset ?? 0);
  let totalResults: number | null = null;
  let pagesFetched = 0;
  let exhausted = false;

  do {
    const params = new URLSearchParams();
    params.append("filter[category][]", "res_sale");
    params.append(`filter[${filterName}][]`, locationId);
    params.append("page[limit]", String(pageLimit));
    if (offset > 0) params.append("page[offset]", String(offset));
    // Note: the public listings API does not accept `sort`; results come back in
    // the API's default order (effectively most-recent-first for active listings).

    const url = `${PLATFORM_BASE}/listings?${params.toString()}`;
    const json = await fetchJsonWithTimeout<ListingsResponse>(url);

    if (json.message || !json.data) {
      // Network/parse failure — NOT a clean exhaustion. Leave `done` false so the
      // caller can retry this same offset on the next window.
      logger.warn({ err: json.message, url }, "realestate-api: listings request failed");
      break;
    }

    const mapped = json.data
      .filter((it) => it.attributes["listing-status"] !== "withdrawn")
      .map(mapListing)
      .filter((x): x is ListingResult => x !== null);

    for (const listing of mapped) {
      if (seenIds.has(listing.listingUrl)) continue;
      seenIds.add(listing.listingUrl);
      all.push(listing);
      if (options.maxListings && all.length >= options.maxListings) break;
    }

    totalResults = typeof json.meta?.totalResults === "number" ? json.meta.totalResults : totalResults;
    offset += pageLimit;
    pagesFetched++;
    logger.info(
      { filterName, locationId, total: totalResults, offset, pageMapped: mapped.length, accumulated: all.length },
      "realestate-api: listings page fetched",
    );

    // An empty page, or passing the reported total, means the suburb is drained.
    // (We don't treat a short page as exhaustion: withdrawn-status filtering can
    // shrink a page below `pageLimit` without it being the last one.)
    if (json.data.length === 0 || (totalResults != null && offset >= totalResults)) {
      exhausted = true;
      break;
    }
    if (options.maxListings && all.length >= options.maxListings) break;
    if (options.maxPages && pagesFetched >= options.maxPages) break;
    // Single-page mode: no fetchAllPages and no window size → stop after page 1.
    if (!options.fetchAllPages && !options.maxPages) break;
  } while (totalResults == null || offset < totalResults);

  logger.info(
    { filterName, locationId, total: totalResults, mapped: all.length, nextOffset: offset, done: exhausted, fetchAllPages: !!options.fetchAllPages },
    "realestate-api: listings fetched",
  );
  return { listings: all, totalResults, nextOffset: offset, done: exhausted };
}

async function fetchListingWindow(
  suburbId: string,
  limit = 100,
  options: { fetchAllPages?: boolean; maxListings?: number; startOffset?: number; maxPages?: number } = {},
): Promise<ListingWindowResult> {
  return fetchListingWindowForFilter("suburb", suburbId, limit, options);
}

/**
 * Backwards-compatible thin wrapper returning just the listing array. Callers
 * that need offset/total/done for incremental pagination should call
 * `fetchListingWindow` directly.
 */
async function fetchListingsForSuburbId(
  suburbId: string,
  limit = 100,
  options: { fetchAllPages?: boolean; maxListings?: number } = {},
): Promise<ListingResult[]> {
  const { listings } = await fetchListingWindow(suburbId, limit, options);
  return listings;
}

async function fetchRawListingsForSuburbId(
  suburbId: string,
  limit = 100,
  options: { fastAddressMatch?: boolean } = {},
): Promise<RawListing[]> {
  return fetchRawListingsForLocation("suburb", suburbId, limit, options);
}

async function fetchRawListingsForLocation(
  filterName: "suburb" | "district",
  locationId: string,
  limit = 100,
  options: { fastAddressMatch?: boolean } = {},
): Promise<RawListing[]> {
  const params = new URLSearchParams();
  params.append("filter[category][]", "res_sale");
  params.append(`filter[${filterName}][]`, locationId);
  params.append("page[limit]", String(Math.min(limit, 100)));

  const url = `${PLATFORM_BASE}/listings?${params.toString()}`;
  const json = options.fastAddressMatch
    ? await fetchJsonWithFixedTimeout<ListingsResponse>(url, ADDRESS_MATCH_TIMEOUT_MS)
    : await fetchJsonWithTimeout<ListingsResponse>(url);
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
    listingAddress: null,
  };
}

function firstAddressLine(s: string): string {
  const parts = s.split(",").map((part) => part.trim()).filter(Boolean);
  const first = parts[0] ?? s;
  const line = /^\d+[a-z]?$/i.test(first) && parts[1]
    ? `${first} ${parts[1]}`
    : first;
  return line
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetNumberToken(line: string): string {
  const t = line.split(" ")[0] ?? "";
  return t.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function looksLikeCombinedListingAddress(address: string | null | undefined): boolean {
  return extractCombinedListingAddressParts(address) != null;
}

export type CombinedListingAddressParts = {
  packageAddress: string;
  childAddresses: string[];
};

const STREET_TYPE_RE = /\b(road|street|avenue|crescent|cresent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i;
const STREET_TYPE_GLOBAL_RE = /\b(road|street|avenue|crescent|cresent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/gi;
const LEADING_CONNECTOR_RE = /^(?:,|\s|\b(?:and|&|\+|\/)\b)+/i;

function normaliseAddressForDedupe(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normaliseStreetTypeTypos(value: string): string {
  return value.replace(/\bCresent\b/gi, "Crescent");
}

function splitPackageStreetAndSuffix(rawAddress: string): { streetPart: string; suffix: string } | null {
  const cleaned = normaliseStreetTypeTypos(rawAddress)
    .replace(/^.*?(?=\d+[a-z]?\b)/i, "")
    .trim();
  if (!cleaned) return null;

  const matches = [...cleaned.matchAll(STREET_TYPE_GLOBAL_RE)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const streetEnd = (last.index ?? 0) + last[0].length;
  return {
    streetPart: cleaned.slice(0, streetEnd).trim(),
    suffix: cleaned.slice(streetEnd).trim(),
  };
}

function streetSegments(streetPart: string): string[] {
  const matches = [...streetPart.matchAll(STREET_TYPE_GLOBAL_RE)];
  const segments: string[] = [];
  let start = 0;
  for (const match of matches) {
    const end = (match.index ?? 0) + match[0].length;
    const segment = streetPart.slice(start, end).replace(LEADING_CONNECTOR_RE, "").trim();
    if (segment) segments.push(segment);
    start = end;
  }
  return segments;
}

// Between two street numbers sharing one street name, only whitespace/commas
// and connector words ("and", "&", "+", "/") may separate them — e.g.
// "15 & 17 Fisherton Street" or "3, 5 and 7 Rukutai Street". Anything else
// between the numbers (e.g. "3 lot subdivision at 13 Campbell place") means
// the second number is not a sibling street address, just incidental prose.
const NUMBER_GAP_CONNECTOR_RE = /^(?:\s|,|&|\+|\/)+$|^\s*and\s*$/i;

function expandStreetSegment(segment: string, suffix: string): string[] {
  const lastNumber = [...segment.matchAll(/\b\d+[a-z]?\b/gi)].pop();
  if (!lastNumber || lastNumber.index == null) return [];

  const streetTail = segment.slice(lastNumber.index + lastNumber[0].length).trim();
  if (!STREET_TYPE_RE.test(streetTail)) return [];

  const numberPart = segment.slice(0, lastNumber.index + lastNumber[0].length);
  const numberMatches = [...numberPart.matchAll(/\b\d+[a-z]?\b/gi)];
  if (numberMatches.length === 0) return [];

  for (let i = 1; i < numberMatches.length; i++) {
    const prev = numberMatches[i - 1];
    const curr = numberMatches[i];
    const gap = numberPart.slice((prev.index ?? 0) + prev[0].length, curr.index ?? 0);
    if (!NUMBER_GAP_CONNECTOR_RE.test(gap)) return [];
  }

  return numberMatches.map((m) => `${m[0]} ${streetTail}${suffix}`.replace(/\s+,/g, ",").trim());
}

/**
 * Splits package-style listing titles such as
 * "15 Fisherton Street & 7 Stanmore Road, Grey Lynn" into individual subject
 * addresses. Returns null when the text is just a normal single address.
 */
export function extractCombinedListingAddressParts(rawAddress: string | null | undefined): CombinedListingAddressParts | null {
  const address = rawAddress?.trim();
  if (!address) return null;
  if (looksLikeUnitOrApartmentAddress(address)) return null;

  const split = splitPackageStreetAndSuffix(address);
  if (!split) return null;

  const childAddresses = streetSegments(split.streetPart).flatMap((segment) =>
    expandStreetSegment(segment, split.suffix),
  );

  const unique = Array.from(
    new Map(childAddresses.map((child) => [normaliseAddressForDedupe(child), child])).values(),
  );
  const packageAddress = `${split.streetPart}${split.suffix}`.trim();
  return unique.length >= 2 ? { packageAddress, childAddresses: unique } : null;
}

/** Canonicalises common NZ street-type abbreviations so "Rd"/"Road", "Ave"/"Avenue" compare equal. */
const STREET_TYPE_ALIAS: Record<string, string> = {
  rd: "road", st: "street", ave: "avenue", av: "avenue", cres: "crescent",
  cresent: "crescent", pl: "place", dr: "drive", ln: "lane", tce: "terrace",
  pde: "parade", blvd: "boulevard", hwy: "highway", cl: "close", gr: "grove",
};

/** Street-name words (everything after the number), abbreviation-normalised, len>2. */
function streetNameWords(line: string, numberToken: string): string[] {
  return line
    .split(" ")
    .map((w) => STREET_TYPE_ALIAS[w] ?? w)
    .filter((w) => w.length > 2 && w !== numberToken);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function streetWordPattern(word: string): string {
  const canonical = STREET_TYPE_ALIAS[word] ?? word;
  const aliases = new Set<string>([canonical]);
  for (const [alias, expanded] of Object.entries(STREET_TYPE_ALIAS)) {
    if (expanded === canonical) aliases.add(alias);
  }
  return `(?:${[...aliases].map(escapeRegex).join("|")})`;
}

/**
 * Strict free-text/URL containment check for a street line. This is deliberately
 * stronger than `includes`: `8 Hampton Drive` must not match `8A Hampton Drive`,
 * while URL slug separators (`8-hampton-drive`) and street-type aliases still
 * work.
 */
export function addressLineAppearsInText(target: string, haystack: string | null | undefined): boolean {
  const line = firstAddressLine(target);
  const number = streetNumberToken(line);
  if (!number || !haystack) return false;
  const words = streetNameWords(line, number);
  if (words.length === 0) return false;
  const pattern = [
    `(?:^|[^a-z0-9])${escapeRegex(number)}(?=[^a-z0-9])`,
    ...words.map(streetWordPattern),
  ].join("[^a-z0-9]+");
  return new RegExp(`${pattern}(?=$|[^a-z0-9])`, "i").test(haystack);
}

/**
 * True when `candidate` looks like the same street address as `target` (first
 * line). Requires the street NUMBER to match, then — when neither line contains
 * the other — requires the shorter address's street-NAME words (abbreviation-
 * normalised) to be a subset of the longer's. This accepts formatting and
 * suburb-suffix variants ("8 Hampton Drive" vs "8 Hampton Drive, St Heliers";
 * "8 Hampton Rd" vs "8 Hampton Road") while rejecting a different street with
 * the same number ("8 Hampton Drive" vs "8 Hampton Street") and different
 * numbers ("8 Hampton Drive" vs "12 Hampton Drive"). Replaces the old, far too
 * permissive `overlap >= 2` / shared-prefix heuristics.
 */
export function addressesLikelyMatch(target: string, candidate: string): boolean {
  const fa = firstAddressLine(target);
  const fb = firstAddressLine(candidate);
  if (fa.length < 4 || fb.length < 4) return false;
  if (fa === fb) return true;
  const na = streetNumberToken(fa);
  const nb = streetNumberToken(fb);
  if (!na || !nb || na !== nb) return false;
  if (fa.includes(fb) || fb.includes(fa)) return true;
  const wa = streetNameWords(fa, na);
  const wb = streetNameWords(fb, nb);
  if (wa.length === 0 || wb.length === 0) return false;
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const longerSet = new Set(longer);
  return shorter.every((w) => longerSet.has(w));
}

type RawListingMatch = {
  listing: RawListing;
  suburb: SuburbRecord;
};

async function matchingRawListingInSuburb(
  address: string,
  suburb: SuburbRecord,
  // Single-page fetch (fastAddressMatch), so a wider window is essentially
  // free and matches the coverage the discovery route already gets. A small
  // cap (e.g. 20) silently misses subject listings in busy suburbs — that was
  // why direct analysis of e.g. "66A Marine Parade, Mellons Bay" fell through
  // to a homes.co.nz banner instead of the real realestate.co.nz listing.
  limit = 100,
): Promise<RawListing | null> {
  let listings: RawListing[] = [];
  try {
    listings = await fetchRawListingsForSuburbId(suburb.id, limit, { fastAddressMatch: true });
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, suburb: suburb.title },
      "realestate-api: address match - listings fetch failed",
    );
    return null;
  }

  return listings.find((l) => {
    const listingAddress = l.attributes.address?.["full-address"] ?? l.attributes.address?.["display-address"] ?? "";
    return addressesLikelyMatch(address, listingAddress);
  }) ?? null;
}

async function matchingListingInDistrict(
  address: string,
  primarySuburb: SuburbRecord,
): Promise<ListingResult | null> {
  try {
    const window = await fetchListingWindowForFilter(
      "district",
      String(primarySuburb.districtId),
      100,
      { fetchAllPages: true, maxListings: 800 },
    );
    const match = window.listings.find((listing) => addressesLikelyMatch(address, listing.address)) ?? null;
    if (!match) return null;
    const [annotated] = await annotateApproxFields([match]).catch(() => [match]);
    return annotated ?? match;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, districtId: primarySuburb.districtId },
      "realestate-api: district address match failed",
    );
    return null;
  }
}

async function findRawListingAcrossNearbySuburbs(
  address: string,
  primarySuburb: SuburbRecord,
  options: { skipPrimary?: boolean } = {},
): Promise<RawListingMatch | null> {
  if (!options.skipPrimary) {
    const primaryMatch = await matchingRawListingInSuburb(address, primarySuburb);
    if (primaryMatch) return { listing: primaryMatch, suburb: primarySuburb };
  }

  // The geocoded suburb and portal suburb can disagree on boundary streets
  // (e.g. Glen Innes vs Glendowie). Search sister suburbs in the same
  // realestate.co.nz district before declaring the property off-market.
  const siblings = await getDistrictSiblings(primarySuburb.id, 0);
  for (const suburb of siblings) {
    const match = await matchingRawListingInSuburb(address, suburb);
    if (!match) continue;
    logger.info(
      {
        requestedSuburb: primarySuburb.title,
        matchedSuburb: suburb.title,
        address: address.slice(0, 80),
      },
      "realestate-api: matched active listing in nearby suburb",
    );
    return { listing: match, suburb };
  }

  return null;
}

async function mapAndAnnotateListing(raw: RawListing, address: string, suburb: string): Promise<ListingResult | null> {
  const mapped = mapListing(raw);
  if (!mapped) return null;
  const [annotated] = await annotateApproxFields([mapped]).catch(() => [mapped]);
  const match = annotated ?? mapped;
  logger.info(
    {
      suburb,
      address: address.slice(0, 80),
      listing: match.address,
      status: match.listingStatus,
      bedrooms: match.bedrooms,
      bathrooms: match.bathrooms,
      floorArea: match.floorArea,
      landArea: match.landArea,
    },
    "realestate-api: matched subject listing",
  );
  return match;
}

function rawListingAddress(listing: RawListing): string | null {
  return listing.attributes.address?.["full-address"] ?? listing.attributes.address?.["display-address"] ?? null;
}

async function fetchCallableAgentForListing(
  listing: RawListing,
): Promise<RealestateAgentContact | null> {
  let matched = listing;
  const listingUrl = matched.attributes["website-full-url"] ?? null;
  const listingAddress = rawListingAddress(matched);
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

  let firstAgentPartial: RealestateAgentContact | null = null;

  for (const agentId of agentIds) {
    try {
      const agent = await fetchAgentById(agentId);
      if (!agent) continue;
      if (agent.agentPhone) {
        return { ...agent, listingUrl, listingAddress };
      }
      if (!firstAgentPartial && (agent.agentName || agent.agentAvatarUrl)) {
        firstAgentPartial = { ...agent, listingUrl, listingAddress };
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, agentId }, "realestate-api: agent contact - agent fetch failed");
    }
  }

  return firstAgentPartial ?? {
    agentName: null,
    agentPhone: null,
    agencyName: null,
    agentAvatarUrl: null,
    listingUrl,
    listingAddress,
  };
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

  const primaryMatch = await matchingRawListingInSuburb(trimmed, suburb);
  if (primaryMatch) return mapAndAnnotateListing(primaryMatch, trimmed, suburb.title);

  // Portal locality labels can be broader than the geocoder's locality,
  // especially for rural addresses. A single district query is both faster
  // and more complete than issuing one request per sibling suburb.
  const districtMatch = await matchingListingInDistrict(trimmed, suburb);
  if (districtMatch) {
    logger.info(
      { districtId: suburb.districtId, address: trimmed.slice(0, 80), listing: districtMatch.address },
      "realestate-api: matched subject listing through district fallback",
    );
    return districtMatch;
  }

  const rawNearbyMatch = await findRawListingAcrossNearbySuburbs(trimmed, suburb, { skipPrimary: true });
  if (rawNearbyMatch) return mapAndAnnotateListing(rawNearbyMatch.listing, trimmed, rawNearbyMatch.suburb.title);

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

  const match = await findRawListingAcrossNearbySuburbs(trimmed, suburb);
  if (!match) {
    logger.info({ suburb: suburb.title, address: trimmed.slice(0, 80) }, "realestate-api: agent contact - no active listing match");
    return null;
  }

  const agent = await fetchCallableAgentForListing(match.listing);
  if (agent?.agentPhone) return agent;

  logger.info({ listingId: match.listing.id, address: trimmed.slice(0, 80) }, "realestate-api: agent contact - no callable agent");
  return agent;
}

/**
 * Look up the callable agent for a realestate.co.nz listing directly by URL,
 * bypassing the suburb-then-address-match path used by
 * fetchRealestateAgentContactForAddress. Useful when the caller already has
 * a verified listing URL (e.g. from `selectedListingContext` after the user
 * tapped a discovery card) — avoids the fragile address matching that can
 * fail or land on the wrong listing when the address casing differs.
 */
export async function fetchRealestateAgentContactByListingUrl(
  url: string,
): Promise<RealestateAgentContact | null> {
  const id = listingIdFromUrl(url);
  if (!id) return null;
  const raw = await fetchRawListingById(id);
  if (!raw) return null;
  return fetchCallableAgentForListing(raw);
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
    // Add all photos from the matched listing.
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

function extractLabelledText(text: string, labels: string[], maxLen = 140): string | null {
  if (!text) return null;
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}\\s*:?\\s*([^|\\n]{2,${maxLen}})`, "i"));
    const raw = match?.[1]?.trim();
    if (raw) return raw.replace(/\s{2,}/g, " ").trim();
  }
  return null;
}

function extractPropertyTypeSignal(text: string): string | null {
  const labelled = extractLabelledText(text, ["Property Type", "Type"], 80);
  const contextual =
    text.match(/\bproperty\s+type\b.{0,50}\b(unit|apartment|townhouse|terrace|house|dwelling)\b/i)?.[1] ??
    text.match(/\btype\b.{0,30}\b(unit|apartment|townhouse|terrace|house|dwelling)\b/i)?.[1] ??
    null;
  const source = labelled ?? contextual;
  if (!source) return null;
  if (/\bunit\b/i.test(source)) return "Unit";
  if (/\bapartment\b/i.test(source)) return "Apartment";
  if (/\btownhouse\b|\bterrace\b/i.test(source)) return "Townhouse";
  if (/\bhouse\b|\bdwelling\b|\bstandalone\b/i.test(source)) return "House";
  // Don't return labelled — it may contain raw UI/page text when no type word matched
  return null;
}

function extractTenureSignal(text: string): string | null {
  const labelled = extractLabelledText(text, ["Title", "Title Type", "Tenure", "Estate"], 100);
  const source = labelled ?? text;
  if (/\bunit\s+title\b/i.test(source)) return "Unit Title";
  if (/\bcross\s*lease\b|\bcrosslease\b/i.test(source)) return "Cross Lease";
  if (/\bstratum\b/i.test(source)) return "Stratum";
  if (/\bfee\s+simple\b/i.test(source)) return "Fee Simple";
  if (/\bfreehold\b/i.test(source)) return "Freehold";
  return labelled;
}

function extractLegalDescriptionSignal(text: string): string | null {
  const labelled = extractLabelledText(text, ["Legal Description", "Legal"], 180);
  if (labelled && /\b(unit|accessory|lot|dp|deposited\s+plan|cross\s*lease|stratum)\b/i.test(labelled)) {
    return labelled;
  }
  const unitMatch = text.match(/\b(unit\s+[a-z]\b.{0,120}?(?:deposited\s+plan|dp)\s*\d+)/i);
  if (unitMatch?.[1]) return unitMatch[1].trim();
  const lotMatch = text.match(/\b(lot\s+\d+[a-z]?.{0,120}?(?:deposited\s+plan|dp)\s*\d+)/i);
  return lotMatch?.[1]?.trim() ?? null;
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
  title: string | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  floorAreaSqm: number | null;
  /** Second-source floor area from page JSON-LD; used to cross-check against the og:description value. */
  floorAreaSqmJsonLd: number | null;
  price: number | null;
  propertyType: string | null;
  listingCategory: string | null;
  tenureText: string | null;
  legalDescription: string | null;
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

/**
 * Reconcile the structured API's bed/bath counts against the listing PAGE's own
 * counts (parsed from og:description). The page value is what users see on the
 * portal, so it wins whenever the two disagree — the API's
 * `bathrooms-total-count` can be an aggregate that tallies every WC/ensuite/
 * fixture (e.g. 66A Marine Parade returns 9 vs the page's displayed 5).
 *
 * When the page gives us no bathroom value to compare, an implausibility guard
 * drops a count that exceeds bedrooms + 1 (a near-certain aggregate-count smell)
 * rather than surfacing an obviously wrong number.
 */
export function reconcileListingBedBath(
  apiBedrooms: number | null | undefined,
  apiBathrooms: number | null | undefined,
  pageBedrooms: number | null | undefined,
  pageBathrooms: number | null | undefined,
): { bedrooms: number | null; bathrooms: number | null } {
  let bedrooms = apiBedrooms ?? null;
  if (pageBedrooms != null && pageBedrooms !== apiBedrooms) bedrooms = pageBedrooms;

  let bathrooms = apiBathrooms ?? null;
  if (pageBathrooms != null && pageBathrooms !== apiBathrooms) bathrooms = pageBathrooms;

  // Implausibility guard: bathrooms-total-count is an aggregate field that
  // can include every WC/ensuite/fixture across multiple units. Drop the
  // suspicious count when:
  //   (a) the listing page gave us no bathroom count at all (og fetch failed), OR
  //   (b) the listing page confirms the SAME suspicious count (the og:description
  //       pulls from the same aggregate field, so both sources are wrong together).
  // Only skip the guard when the page independently disagrees — in that case the
  // first override above already set bathrooms = pageBathrooms.
  if (
    bathrooms != null &&
    bedrooms != null &&
    bathrooms > bedrooms + 1 &&
    (pageBathrooms == null || pageBathrooms === apiBathrooms)
  ) {
    bathrooms = null;
  }

  return { bedrooms, bathrooms };
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
    const ogTitle = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ?? "";
    const ogDesc = html.match(/<meta\s+(?:property|name)=["']og:description["']\s+content=["']([^"']+)["']/i)?.[1]
      ?? html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]
      ?? "";
    if (!ogTitle && !ogDesc) return null;
    const bodyText = htmlToSearchableText(html);
    const combined = `${ogTitle} ${ogDesc}`;
    const beds = extractBedsBaths(combined);
    return {
      title: cleanListingDescription(ogTitle),
      description: cleanListingDescription(ogDesc),
      bedrooms: beds.bedrooms,
      bathrooms: beds.bathrooms,
      landAreaSqm: extractListingFactAreaSqm(bodyText, "land") ?? extractLandAreaSqm(combined),
      floorAreaSqm: extractListingFactAreaSqm(bodyText, "floor") ?? extractFloorAreaSqm(combined),
      floorAreaSqmJsonLd: extractFloorSizeFromJsonLd(html),
      price: parsePriceDisplay(combined),
      propertyType: extractPropertyTypeSignal(bodyText),
      listingCategory: null,
      tenureText: extractTenureSignal(bodyText),
      legalDescription: extractLegalDescriptionSignal(bodyText),
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

      // Prefer the listing PAGE's own bed/bath (parsed from og:description) over
      // the platform API's counts, with an implausibility guard. See
      // reconcileListingBedBath for the rationale (66A Marine Parade: API 9 vs
      // page 5 bathrooms).
      const { bedrooms: resolvedBedrooms, bathrooms: resolvedBathrooms } =
        reconcileListingBedBath(l.bedrooms, l.bathrooms, og.bedrooms, og.bathrooms);

      // The public search API can occasionally attach an aggregate or
      // neighbouring parcel area to a listing card. The listing page's own
      // metadata is closer to what users see on property portals, so prefer it
      // for the card while still marking it approximate.
      const { landArea, landAreaApprox } = reconcileListingLandArea(l.landArea, og.landAreaSqm);
      const pageHasLandArea = og.landAreaSqm != null;
      const landAreaSource = pageHasLandArea ? "realestate_page" : (l.landAreaSource ?? (landArea != null ? "realestate_api" : "unknown"));
      const landAreaConfidence = pageHasLandArea ? "verified" : (l.landAreaConfidence ?? "unverified");
      const isParentParcelSuspect =
        l.isParentParcelSuspect ||
        (pageHasLandArea && l.landArea != null && landAreaApprox) ||
        l.isCombinedListing;

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
        bedrooms: resolvedBedrooms,
        bathrooms: resolvedBathrooms,
        landArea,
        landAreaSource,
        landAreaConfidence,
        isParentParcelSuspect,
        isCombinedListing: l.isCombinedListing,
        combinedListingReason: l.combinedListingReason ?? (l.isCombinedListing ? "multi_address_listing" : null),
        floorArea,
        propertyType: og.propertyType ?? l.propertyType ?? null,
        listingCategory: og.listingCategory ?? l.listingCategory ?? null,
        tenureText: og.tenureText ?? l.tenureText ?? null,
        legalDescription: og.legalDescription ?? l.legalDescription ?? null,
        // Marketing copy feeds the listing-claims extractor (new-build /
        // townhouse / multi-unit signals) during discovery screening.
        listingTitle: og.title ?? l.listingTitle ?? null,
        description: l.description ?? og.description ?? null,
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
  /** Raw API offset to resume the next window from (for incremental pagination). */
  nextOffset: number;
  /** Raw source total for the suburb, when known (null otherwise). */
  totalAvailable: number | null;
  /** True once the suburb's source is genuinely drained (no further windows). */
  done: boolean;
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
  /** For strict scans, fetch every listing page before declaring the suburb exhausted. */
  fetchAllPages?: boolean;
  /** Safety cap for all-page scans. */
  maxListings?: number;
  /** Raw API offset to start the window at (for incremental pagination). */
  startOffset?: number;
  /** Window size in API pages (100 listings each) for incremental pagination. */
  maxPages?: number;
}): Promise<ApiSearchResult> {
  const {
    suburbName,
    minPrice,
    maxPrice,
    firstBatchSize = 6,
    includeNegotiation = true,
    skipUrls = [],
    fetchAllPages = false,
    maxListings,
    startOffset,
    maxPages,
  } = opts;

  const resolvedLocation = await resolveRealestateLocation(suburbName);
  if (!resolvedLocation || resolvedLocation.status === "invalid") {
    logger.info({ suburbName }, "realestate-api: location not found in directory");
    return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz/api", suburbResolved: null, nextOffset: 0, totalAvailable: null, done: true };
  }
  const location = resolvedLocation.status === "suburb"
    ? {
        filterName: "suburb" as const,
        id: resolvedLocation.suburb.id,
        title: resolvedLocation.suburb.title,
        fqSlug: resolvedLocation.suburb.fqSlug,
      }
    : resolvedLocation.status === "district"
      ? {
          filterName: "district" as const,
          id: resolvedLocation.district.id,
          title: resolvedLocation.district.title,
          fqSlug: resolvedLocation.district.fqSlug,
        }
      : {
          filterName: "region" as const,
          id: resolvedLocation.region.id,
          title: resolvedLocation.region.title,
          fqSlug: resolvedLocation.region.slug,
        };

  logger.info(
    { suburbName, resolvedTo: location.title, locationId: location.id, locationKind: location.filterName, fqSlug: location.fqSlug, minPrice, maxPrice },
    "realestate-api: resolved location, fetching listings",
  );

  let listings: ListingResult[];
  let nextOffset = startOffset ?? 0;
  let totalAvailable: number | null = null;
  let done = true;
  try {
    const window = await fetchListingWindowForFilter(location.filterName, location.id, 100, { fetchAllPages, maxListings, startOffset, maxPages });
    listings = window.listings;
    nextOffset = window.nextOffset;
    totalAvailable = window.totalResults;
    done = window.done;
  } catch (err) {
    logger.warn({ err: (err as Error).message, locationId: location.id, locationKind: location.filterName }, "realestate-api: fetch failed");
    return {
      firstBatch: [], remainingListings: [], totalFound: 0,
      source: "realestate.co.nz/api",
      suburbResolved: { id: location.id, title: location.title, fqSlug: location.fqSlug },
      nextOffset: startOffset ?? 0, totalAvailable: null, done: false,
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
    suburbResolved: { id: location.id, title: location.title, fqSlug: location.fqSlug },
    nextOffset,
    totalAvailable,
    done,
  };
}
