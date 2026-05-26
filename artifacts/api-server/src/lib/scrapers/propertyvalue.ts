/// <reference lib="dom" />
import { logger } from "../logger";

const BASE_URL = "https://www.propertyvalue.co.nz";

export interface PropertyValueData {
  cv_nzd: number | null;
  lv_nzd: number | null;
  iv_nzd: number | null;
  cv_year: number | null;
  property_type: string | null;
  property_sub_type: string | null;
  legal_descriptions: string[];
  land_use_primary: string | null;
  property_improvements: string | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  build_year_range: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  listing_active: boolean;
  photo_urls: string[];
  address_confirmed: string | null;
  property_id: number | null;
}

type Suggestion = {
  propertyId?: number;
  suggestion?: string;
  suggestionType?: string;
};

type SuggestionsPayload = {
  suggestions?: Suggestion[];
};

type RankedSuggestion = {
  suggestion: Suggestion;
  score: number;
  query: string;
};

type PropertyPayload = {
  propertyId?: number;
  core?: {
    beds?: unknown;
    baths?: unknown;
    carSpaces?: unknown;
    landArea?: unknown;
    propertyType?: unknown;
    propertySubType?: unknown;
    propertySubTypeShort?: unknown;
  };
  additional?: {
    floorArea?: unknown;
    yearBuilt?: unknown;
    decadeBuilt?: unknown;
  };
  images?: {
    propertyPhotoList?: Array<{
      largePhotoUrl?: unknown;
      mediumPhotoUrl?: unknown;
      thumbnailPhotoUrl?: unknown;
    }>;
  };
  ratingValuation?: RatingValuationPayload;
  sales?: {
    lastSale?: {
      landUsePrimary?: unknown;
    };
  };
  features?: {
    featureAttributes?: Array<{
      name?: unknown;
      value?: unknown;
    }>;
  };
  isForSale?: boolean;
  address?: {
    fullAddress?: unknown;
  };
};

type RatingValuationPayload = {
  capitalValue?: unknown;
  landValue?: unknown;
  improvementValue?: unknown;
  valuationDate?: unknown;
  legalDescriptions?: unknown;
};

function toNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toStringOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function parseYear(raw: unknown): number | null {
  if (raw == null) return null;
  const match = String(raw).match(/\b(18|19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  return year >= 1800 && year <= new Date().getFullYear() + 1 ? year : null;
}

function parseDecadeRange(raw: unknown): { year: number | null; range: string | null } {
  if (raw == null) return { year: null, range: null };
  const s = String(raw).trim();
  const range = s.match(/\b((?:18|19|20)\d0)\s*[-\u2013]\s*((?:18|19|20)?\d{2})\b/);
  if (range) {
    const start = Number(range[1]);
    const endRaw = range[2].length === 2 ? Math.floor(start / 100) * 100 + Number(range[2]) : Number(range[2]);
    const end = endRaw >= start ? endRaw : start + 9;
    return { year: parseYear(String(end)), range: `${start}-${end}` };
  }
  const decade = s.match(/\b((?:18|19|20)\d0)s?\b/);
  if (decade) {
    const start = Number(decade[1]);
    return { year: parseYear(String(start + 9)), range: `${start}-${start + 9}` };
  }
  return { year: null, range: null };
}

function cvYearFromDate(raw: unknown): number | null {
  return parseYear(raw);
}

function normaliseAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bsaint\b/g, "st")
    .replace(/\bmount\b/g, "mt")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function streetNumber(raw: string): string | null {
  return raw.trim().match(/^(\d+[a-z]?)/i)?.[1].toLowerCase() ?? null;
}

function scoreSuggestion(input: string, suggestion: Suggestion): number {
  const label = suggestion.suggestion ?? "";
  if (!label || suggestion.suggestionType?.toLowerCase() !== "address") return -1;
  const inputNorm = normaliseAddress(input);
  const labelNorm = normaliseAddress(label);
  const inputNo = streetNumber(inputNorm);
  const labelNo = streetNumber(labelNorm);
  let score = 0;
  if (inputNo && labelNo && inputNo === labelNo) score += 20;
  if (labelNorm.includes(inputNorm) || inputNorm.includes(labelNorm)) score += 20;
  for (const token of inputNorm.split(" ").filter((t) => t.length > 2)) {
    if (labelNorm.includes(token)) score += 2;
  }
  return score;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = normaliseAddress(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function buildAddressQueries(addresses: string[]): string[] {
  const variants: string[] = [];
  for (const address of addresses) {
    variants.push(address);

    const noNz = address
      .replace(/\bnew zealand\b/ig, "")
      .replace(/\baotearoa\b/ig, "")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s+/g, " ")
      .replace(/,\s*$/g, "")
      .trim();
    variants.push(noNz);

    const parts = noNz.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) variants.push(parts.slice(0, 3).join(", "));
    if (parts.length >= 2) variants.push(parts.slice(0, 2).join(", "));

    const withoutPostcode = noNz.replace(/\b\d{4}\b/g, "").replace(/\s*,\s*/g, ", ").replace(/\s+/g, " ").trim();
    variants.push(withoutPostcode);

    const norm = normaliseAddress(noNz);
    const tokens = norm.split(" ").filter(Boolean);
    const streetTypeIndex = tokens.findIndex((t) =>
      /^(road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)$/.test(t),
    );
    if (tokens.length >= 4 && streetTypeIndex > 1) {
      const street = tokens.slice(0, streetTypeIndex + 1).join(" ");
      const locality = tokens.slice(streetTypeIndex + 1).filter((t) => !/^\d{4}$/.test(t));
      if (locality.length > 0) variants.push(`${street} ${locality[0]} Auckland`);
      variants.push(`${street} Auckland`);
    }
  }
  return uniqueStrings(variants);
}

async function getJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ProjectAlphaNZ/1.0 (property data enrichment)",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!resp.ok) throw new Error(`PropertyValue HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

async function getJsonOrNull<T>(url: string): Promise<T | null> {
  const resp = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "ProjectAlphaNZ/1.0 (property data enrichment)",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`PropertyValue HTTP ${resp.status}`);
  return (await resp.json()) as T;
}

function extractPhotos(payload: PropertyPayload): string[] {
  return Array.from(new Set(
    (payload.images?.propertyPhotoList ?? [])
      .flatMap((p) => [p.largePhotoUrl, p.mediumPhotoUrl, p.thumbnailPhotoUrl])
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)),
  )).slice(0, 12);
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(new Set(
    raw
      .map((value) => toStringOrNull(value))
      .filter((value): value is string => !!value),
  ));
}

function featureValue(payload: PropertyPayload, featureName: RegExp): string | null {
  const match = (payload.features?.featureAttributes ?? []).find((attr) =>
    featureName.test(toStringOrNull(attr.name) ?? ""),
  );
  return toStringOrNull(match?.value);
}

function hasUsableData(data: PropertyValueData): boolean {
  return !!(
    data.cv_nzd ||
    data.land_area_sqm ||
    data.floor_area_sqm ||
    data.build_year ||
    data.bedrooms ||
    data.bathrooms
  );
}

export async function scrapePropertyValue(address: string, ...alternateAddresses: string[]): Promise<PropertyValueData | null> {
  const queries = buildAddressQueries([address, ...alternateAddresses]);
  const ranked: RankedSuggestion[] = [];

  for (const query of queries) {
    const suggestionsUrl = new URL(`${BASE_URL}/api/public/clapi/suggestions`);
    suggestionsUrl.searchParams.set("q", query);
    suggestionsUrl.searchParams.set("suggestionTypes", "address");
    suggestionsUrl.searchParams.set("limit", "8");

    const suggestionsPayload = await getJsonOrNull<SuggestionsPayload | Suggestion[]>(suggestionsUrl.toString());
    const suggestions = Array.isArray(suggestionsPayload)
      ? suggestionsPayload
      : suggestionsPayload?.suggestions ?? [];

    ranked.push(
      ...suggestions
        .filter((s) => s.propertyId != null)
        .map((s) => ({
          suggestion: s,
          score: Math.max(
            scoreSuggestion(address, s),
            ...alternateAddresses.map((alt) => scoreSuggestion(alt, s)),
            scoreSuggestion(query, s),
          ),
          query,
        })),
    );

    if (ranked.some((r) => r.score >= 35)) break;
  }

  ranked.sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 10 || best.suggestion.propertyId == null) {
    logger.info({ address, queries, count: ranked.length }, "PropertyValue: no confident address match");
    return null;
  }

  const propertyId = best.suggestion.propertyId;
  const propertyUrl = `${BASE_URL}/api/public/clapi/properties/${propertyId}`;
  const rvUrl = `${BASE_URL}/api/public/clapi/properties/${propertyId}/ratingValuation`;

  const [property, ratingValuation] = await Promise.all([
    getJson<PropertyPayload>(propertyUrl),
    getJson<RatingValuationPayload>(rvUrl).catch(() => null),
  ]);
  const rv = ratingValuation ?? property.ratingValuation ?? null;
  const decade = parseDecadeRange(property.additional?.decadeBuilt);
  const exactBuildYear = parseYear(property.additional?.yearBuilt);
  const buildYear = exactBuildYear ?? decade.year;

  const data: PropertyValueData = {
    cv_nzd: toNumber(rv?.capitalValue),
    lv_nzd: toNumber(rv?.landValue),
    iv_nzd: toNumber(rv?.improvementValue),
    cv_year: cvYearFromDate(rv?.valuationDate),
    property_type: toStringOrNull(property.core?.propertyType),
    property_sub_type: toStringOrNull(property.core?.propertySubType ?? property.core?.propertySubTypeShort),
    legal_descriptions: toStringArray(rv?.legalDescriptions ?? property.ratingValuation?.legalDescriptions),
    land_use_primary: toStringOrNull(property.sales?.lastSale?.landUsePrimary),
    property_improvements: featureValue(property, /property\s+improvements/i),
    land_area_sqm: toNumber(property.core?.landArea),
    floor_area_sqm: toNumber(property.additional?.floorArea),
    build_year: buildYear,
    build_year_range: exactBuildYear == null ? decade.range : null,
    bedrooms: toNumber(property.core?.beds),
    bathrooms: toNumber(property.core?.baths),
    listing_active: property.isForSale === true,
    photo_urls: extractPhotos(property),
    address_confirmed:
      (typeof property.address?.fullAddress === "string" && property.address.fullAddress.trim()) ||
      best.suggestion.suggestion ||
      null,
    property_id: propertyId,
  };

  if (!hasUsableData(data)) return null;
  logger.info(
    {
      property_id: propertyId,
      cv_nzd: data.cv_nzd,
      cv_year: data.cv_year,
      property_type: data.property_type,
      property_sub_type: data.property_sub_type,
      build_year: data.build_year,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      query: best.query,
      match: best.suggestion.suggestion,
      score: best.score,
    },
    "PropertyValue: resolved property data",
  );
  return data;
}
