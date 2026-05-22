import { logger } from "./logger";

export interface GeoResult {
  lat: number;
  lng: number;
  formatted: string;
  suburb: string | null;
}

export function normaliseNzAddressForGeocode(address: string): string {
  return address
    .replace(/\b(?:New Zealand|Aotearoa)\b/gi, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*Auckland City\s*,/gi, ", ")
    .replace(/\bAuckland City\b/gi, "Auckland")
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
}

type ParsedStreetNumber = {
  base: string;
  suffix: string;
  full: string;
};

function parseLeadingStreetNumber(input: string): ParsedStreetNumber | null {
  const match = input.trim().match(/^(\d+)([a-z])?\b/i);
  if (!match) return null;
  const base = match[1]!;
  const suffix = (match[2] ?? "").toUpperCase();
  return { base, suffix, full: `${base}${suffix}`.toLowerCase() };
}

function streetNumberFromFormatted(formatted: string): string | null {
  const match = formatted.trim().match(/^(\d+[a-z]?)(?:\b|,)/i);
  return match ? match[1]!.toLowerCase() : null;
}

function scoreStreetNumberMatch(input: string, candidateNumber: string | null): number {
  const requested = parseLeadingStreetNumber(input);
  if (!requested || !candidateNumber) return 0;

  const candidate = parseLeadingStreetNumber(candidateNumber);
  if (!candidate) return 0;

  if (candidate.full === requested.full) return 100;
  if (candidate.base !== requested.base) return -50;

  // If the user typed the parent lot, prefer the exact parent over 8A/8B.
  if (!requested.suffix && candidate.suffix) return -25;

  // If the user typed a child lot, don't let the parent win by accident.
  if (requested.suffix && !candidate.suffix) return -20;

  return 0;
}

async function nominatimGeocode(address: string): Promise<GeoResult | null> {
  const query = encodeURIComponent(`${address}, New Zealand`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=5&countrycodes=nz&addressdetails=1`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "ProjectAlphaNZ/1.0 (property development analysis app)",
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`);

  const results = (await resp.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
    type: string;
    importance: number;
    address?: {
      suburb?: string;
      town?: string;
      city_district?: string;
      county?: string;
    };
  }>;

  if (!results || results.length === 0) return null;

  const best = chooseBestNominatimRow(address, results);
  return nominatimRowToGeo(best);
}

type NominatimRow = {
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    house_number?: string;
    suburb?: string;
    town?: string;
    city_district?: string;
    county?: string;
  };
};

function chooseBestNominatimRow(address: string, rows: NominatimRow[]): NominatimRow {
  let best = rows[0]!;
  let bestScore = -Infinity;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const candidateNumber = row.address?.house_number ?? streetNumberFromFormatted(row.display_name);
    const score = scoreStreetNumberMatch(address, candidateNumber) - i * 0.01;
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }

  return best;
}

function nominatimRowToGeo(row: NominatimRow): GeoResult {
  const suburb =
    row.address?.suburb ??
    row.address?.town ??
    row.address?.city_district ??
    null;

  return {
    lat: parseFloat(row.lat),
    lng: parseFloat(row.lon),
    formatted: row.display_name.split(", New Zealand")[0],
    suburb: suburb ? suburb.toLowerCase().trim() : null,
  };
}

/** All Nominatim hits for disambiguation (typo corrections, suburb variants). */
export async function nominatimSearchNz(address: string, limit = 6): Promise<GeoResult[]> {
  const q = encodeURIComponent(`${address}, New Zealand`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=${limit}&countrycodes=nz&addressdetails=1`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "ProjectAlphaNZ/1.0 (property development analysis app)",
      "Accept-Language": "en",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`);

  const results = (await resp.json()) as NominatimRow[];

  if (!results || results.length === 0) return [];
  return results.map(nominatimRowToGeo);
}

async function googleGeocode(address: string, apiKey: string): Promise<GeoResult | null> {
  const query = encodeURIComponent(`${address}, New Zealand`);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&components=country:NZ&key=${apiKey}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`Google Geocoding HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    status: string;
    results: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
      address_components?: Array<{
        long_name: string;
        short_name: string;
        types: string[];
      }>;
    }>;
  };

  if (data.status !== "OK" || !data.results.length) return null;

  const r = chooseBestGoogleResult(address, data.results);
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    formatted: r.formatted_address,
    suburb: null,
  };
}

function googleStreetNumber(result: {
  formatted_address: string;
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
}): string | null {
  const component = result.address_components?.find((c) => c.types.includes("street_number"));
  return component?.short_name?.trim() || component?.long_name?.trim() || streetNumberFromFormatted(result.formatted_address);
}

function chooseBestGoogleResult<T extends {
  formatted_address: string;
  address_components?: Array<{ long_name: string; short_name: string; types: string[] }>;
}>(address: string, results: T[]): T {
  let best = results[0]!;
  let bestScore = -Infinity;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const score = scoreStreetNumberMatch(address, googleStreetNumber(result)) - i * 0.01;
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Same resolution order as {@link geocodeAddress} but never throws —
 * useful for probing typos without blocking the analyse flow.
 */
export async function tryGeocodeAddress(address: string): Promise<GeoResult | null> {
  const googleKey = process.env["GOOGLE_MAPS_API_KEY"];
  const candidates = Array.from(new Set([address.trim(), normaliseNzAddressForGeocode(address)]))
    .filter(Boolean);

  if (googleKey) {
    for (const candidate of candidates) {
      try {
        const result = await googleGeocode(candidate, googleKey);
        if (result) {
          logger.debug({ address, candidate, result }, "Geocoded via Google Maps");
          return result;
        }
      } catch (err) {
        logger.warn({ err, candidate }, "Google geocoding candidate failed");
      }
    }
  }

  try {
    const result = await nominatimGeocode(address);
    if (result) return result;
  } catch (err) {
    logger.warn({ err }, "Geocode probe failed — no result");
    for (const candidate of candidates.slice(1)) {
      try {
        const result = await nominatimGeocode(candidate);
        if (result) return result;
      } catch (fallbackErr) {
        logger.warn({ err: fallbackErr, candidate }, "Geocode normalized fallback failed");
      }
    }
    return null;
  }

  for (const candidate of candidates.slice(1)) {
    try {
      const result = await nominatimGeocode(candidate);
      if (result) return result;
    } catch (fallbackErr) {
      logger.warn({ err: fallbackErr, candidate }, "Geocode normalized fallback failed");
    }
  }

  return null;
}

export async function geocodeAddress(address: string): Promise<GeoResult> {
  const result = await tryGeocodeAddress(address);
  if (!result) {
    throw new Error(`Could not geocode address: "${address}" in New Zealand`);
  }

  logger.debug({ address, result }, "Geocoded (resolved)");
  return result;
}
