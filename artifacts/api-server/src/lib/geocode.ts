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
  const match = input.trim().match(/^((?:[a-z]?\d+[a-z]?\s*\/\s*)?)(\d+)([a-z])?\b/i);
  if (!match) return null;
  const unitPrefix = (match[1] ?? "").replace(/\s+/g, "").toLowerCase();
  const base = match[2]!;
  const suffix = (match[3] ?? "").toUpperCase();
  return { base, suffix, full: `${unitPrefix}${base}${suffix}`.toLowerCase() };
}

function streetNumberFromFormatted(formatted: string): string | null {
  const match = formatted.trim().match(/^((?:[a-z]?\d+[a-z]?\s*\/\s*)?\d+[a-z]?)(?:\b|,)/i);
  return match ? match[1]!.replace(/\s+/g, "").toLowerCase() : null;
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

function streetNumberMatchesExactly(input: string, candidateNumber: string | null): boolean {
  const requested = streetNumberFromFormatted(input);
  if (!requested) return true;
  const candidate = candidateNumber ? streetNumberFromFormatted(candidateNumber) : null;
  return Boolean(candidate && candidate === requested);
}

type CouncilAddressSource = {
  serviceUrl: string;
  matches: RegExp;
  where: (parsed: { number: number; suffix: string; road: string }) => string;
  formatted: (attributes: Record<string, unknown>) => string | null;
};

const COUNCIL_ADDRESS_SOURCES: CouncilAddressSource[] = [
  {
    serviceUrl: "https://gis.whakatane.govt.nz/arcgis/rest/services/Geocortex/Cadastre/MapServer/1",
    matches: /\b(whakatane|rotoma|matata|edgecumbe|ohope|taneatua)\b/i,
    where: ({ number, suffix, road }) =>
      `HouseNumber = ${number} AND UPPER(Address_ascii) = '${number}${suffix} ${road.replaceAll("'", "''")}'`,
    formatted: (attrs) => {
      const address = String(attrs["Address"] ?? "").trim();
      const town = String(attrs["Town"] ?? "").trim();
      return address ? [address, town, "New Zealand"].filter(Boolean).join(", ") : null;
    },
  },
  {
    serviceUrl: "https://gis.rdc.govt.nz/server/rest/services/Asset/3_Waters/MapServer/385",
    matches: /\b(rotorua|koutu|ngongotaha|mamaku|okareka|reporoa)\b/i,
    where: ({ number, suffix, road }) => {
      const roadWithoutType = road.replace(/\s+(ROAD|STREET|AVENUE|DRIVE|PLACE|LANE|TERRACE|CRESCENT|WAY)$/i, "");
      return `HouseNo = ${number} AND UPPER(HouseSuffix) = '${suffix}' AND UPPER(RoadName) = '${roadWithoutType.replaceAll("'", "''")}'`;
    },
    formatted: (attrs) => {
      const number = `${String(attrs["HouseNo"] ?? "").trim()}${String(attrs["HouseSuffix"] ?? "").trim()}`;
      const road = String(attrs["Road"] ?? "").trim();
      const suburb = String(attrs["Suburb"] ?? "").trim();
      return number && road ? [`${number} ${road}`, suburb, "Rotorua", "New Zealand"].filter(Boolean).join(", ") : null;
    },
  },
];

function parseCouncilStreetAddress(address: string): { number: number; suffix: string; road: string } | null {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const firstLine = /^\d+[a-z]?$/i.test(parts[0] ?? "") && parts[1]
    ? `${parts[0]} ${parts[1]}`
    : parts[0] ?? "";
  const match = firstLine.match(/^(\d+)([a-z]?)\s+(.+)$/i);
  if (!match) return null;
  return { number: Number(match[1]), suffix: (match[2] ?? "").toUpperCase(), road: match[3]!.toUpperCase() };
}

async function councilAddressGeocode(address: string): Promise<GeoResult | null> {
  const parsed = parseCouncilStreetAddress(address);
  const source = COUNCIL_ADDRESS_SOURCES.find((candidate) => candidate.matches.test(address));
  if (!parsed || !source) return null;

  const url = new URL(`${source.serviceUrl}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", source.where(parsed));
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Council address lookup HTTP ${response.status}`);
  const data = await response.json() as {
    features?: Array<{ attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } }>;
    error?: { message?: string };
  };
  if (data.error) throw new Error(`Council address lookup error: ${data.error.message ?? "unknown"}`);
  const exact = (data.features ?? []).find((feature) => {
    const formatted = source.formatted(feature.attributes ?? {});
    return formatted && streetNumberMatchesExactly(address, streetNumberFromFormatted(formatted));
  });
  const formatted = exact ? source.formatted(exact.attributes ?? {}) : null;
  const lat = exact?.geometry?.y;
  const lng = exact?.geometry?.x;
  if (!formatted || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: lat!, lng: lng!, formatted, suburb: null };
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
  const bestNumber = best.address?.house_number ?? streetNumberFromFormatted(best.display_name);
  if (!streetNumberMatchesExactly(address, bestNumber)) return null;
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

  const exactNumberResults = data.results.filter((result) =>
    streetNumberMatchesExactly(address, googleStreetNumber(result)),
  );
  if (parseLeadingStreetNumber(address) && exactNumberResults.length === 0) return null;
  const r = chooseBestGoogleResult(address, exactNumberResults.length > 0 ? exactNumberResults : data.results);
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

  try {
    const exactCouncilAddress = await councilAddressGeocode(address);
    if (exactCouncilAddress) return exactCouncilAddress;
  } catch (err) {
    logger.warn({ err, address }, "Council exact-address geocoding failed");
  }

  if (googleKey) {
    for (const candidate of candidates) {
      try {
        const result = await googleGeocode(candidate, googleKey);
        if (result && streetNumberMatchesExactly(address, streetNumberFromFormatted(result.formatted))) {
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
    if (result && streetNumberMatchesExactly(address, streetNumberFromFormatted(result.formatted))) return result;
  } catch (err) {
    logger.warn({ err }, "Geocode probe failed — no result");
    for (const candidate of candidates.slice(1)) {
      try {
        const result = await nominatimGeocode(candidate);
        if (result && streetNumberMatchesExactly(address, streetNumberFromFormatted(result.formatted))) return result;
      } catch (fallbackErr) {
        logger.warn({ err: fallbackErr, candidate }, "Geocode normalized fallback failed");
      }
    }
    return null;
  }

  for (const candidate of candidates.slice(1)) {
    try {
      const result = await nominatimGeocode(candidate);
      if (result && streetNumberMatchesExactly(address, streetNumberFromFormatted(result.formatted))) return result;
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
