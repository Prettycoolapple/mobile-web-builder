/// <reference lib="dom" />
import { logger } from "../logger";

const BASE_URL = "https://www.propertyvalue.co.nz";

export interface PropertyValueData {
  cv_nzd: number | null;
  lv_nzd: number | null;
  iv_nzd: number | null;
  cv_year: number | null;
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

type PropertyPayload = {
  propertyId?: number;
  core?: {
    beds?: unknown;
    baths?: unknown;
    carSpaces?: unknown;
    landArea?: unknown;
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
};

function toNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
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

function extractPhotos(payload: PropertyPayload): string[] {
  return Array.from(new Set(
    (payload.images?.propertyPhotoList ?? [])
      .flatMap((p) => [p.largePhotoUrl, p.mediumPhotoUrl, p.thumbnailPhotoUrl])
      .filter((u): u is string => typeof u === "string" && /^https?:\/\//i.test(u)),
  )).slice(0, 12);
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

export async function scrapePropertyValue(address: string): Promise<PropertyValueData | null> {
  const suggestionsUrl = new URL(`${BASE_URL}/api/public/clapi/suggestions`);
  suggestionsUrl.searchParams.set("q", address);
  suggestionsUrl.searchParams.set("suggestionTypes", "address");
  suggestionsUrl.searchParams.set("limit", "5");

  const suggestionsPayload = await getJson<SuggestionsPayload | Suggestion[]>(suggestionsUrl.toString());
  const suggestions = Array.isArray(suggestionsPayload)
    ? suggestionsPayload
    : suggestionsPayload.suggestions ?? [];
  const ranked = suggestions
    .filter((s) => s.propertyId != null)
    .map((s) => ({ suggestion: s, score: scoreSuggestion(address, s) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 10 || best.suggestion.propertyId == null) {
    logger.info({ address, count: suggestions.length }, "PropertyValue: no confident address match");
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
  const buildYear = parseYear(property.additional?.yearBuilt) ?? decade.year;

  const data: PropertyValueData = {
    cv_nzd: toNumber(rv?.capitalValue),
    lv_nzd: toNumber(rv?.landValue),
    iv_nzd: toNumber(rv?.improvementValue),
    cv_year: cvYearFromDate(rv?.valuationDate),
    land_area_sqm: toNumber(property.core?.landArea),
    floor_area_sqm: toNumber(property.additional?.floorArea),
    build_year: buildYear,
    build_year_range: buildYear == null ? decade.range : null,
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
      build_year: data.build_year,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
    },
    "PropertyValue: resolved property data",
  );
  return data;
}
