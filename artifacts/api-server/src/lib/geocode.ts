import { logger } from "./logger";

export interface GeoResult {
  lat: number;
  lng: number;
  formatted: string;
  suburb: string | null;
}

async function nominatimGeocode(address: string): Promise<GeoResult | null> {
  const query = encodeURIComponent(`${address}, New Zealand`);
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=5&countrycodes=nz&addressdetails=1`;

  const resp = await fetch(url, {
    headers: {
      "User-Agent": "LecorbNZ/1.0 (property development analysis app)",
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

  const best = results[0];
  const suburb =
    best.address?.suburb ??
    best.address?.town ??
    best.address?.city_district ??
    null;

  return {
    lat: parseFloat(best.lat),
    lng: parseFloat(best.lon),
    formatted: best.display_name.split(", New Zealand")[0],
    suburb: suburb ? suburb.toLowerCase().trim() : null,
  };
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
    }>;
  };

  if (data.status !== "OK" || !data.results.length) return null;

  const r = data.results[0];
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    formatted: r.formatted_address,
    suburb: null,
  };
}

export async function geocodeAddress(address: string): Promise<GeoResult> {
  const googleKey = process.env["GOOGLE_MAPS_API_KEY"];

  if (googleKey) {
    try {
      const result = await googleGeocode(address, googleKey);
      if (result) {
        logger.debug({ address, result }, "Geocoded via Google Maps");
        return result;
      }
    } catch (err) {
      logger.warn({ err }, "Google geocoding failed, falling back to Nominatim");
    }
  }

  const result = await nominatimGeocode(address);
  if (!result) {
    throw new Error(`Could not geocode address: "${address}" in New Zealand`);
  }

  logger.debug({ address, result }, "Geocoded via Nominatim");
  return result;
}
