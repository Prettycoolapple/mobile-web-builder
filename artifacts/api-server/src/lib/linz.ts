import { logger } from "./logger";

const LINZ_BASE = "https://data.linz.govt.nz/services/api/v1";
const LINZ_LRS_PUBLIC_BASE = "https://public.api.landonline.govt.nz/v1";

const LAYER_PRIMARY_PARCELS = 50772;
const LAYER_NZ_TITLES = 50804;
const LAYER_TITLE_OWNERS = 50805;

const LINZ_HEADERS = {
  Accept: "application/json",
};

export interface ParcelBbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  /** Outer ring of the parcel polygon as [lng, lat] pairs (GeoJSON coordinate order). */
  polygon?: [number, number][];
}

export interface LinzParcel {
  parcel_id: string;
  appellation: string | null;
  /** Preferred legal/survey parcel area for display and report facts. */
  area_sqm: number | null;
  /** Survey/legal area from LINZ when available. */
  survey_area_sqm?: number | null;
  /** Calculated GIS polygon area from LINZ, useful for geometry diagnostics. */
  calc_area_sqm?: number | null;
  title_no: string | null;
  legal_description: string | null;
  topology_type: string | null;
  bbox: ParcelBbox | null;
}

export interface LinzParcelNearby extends LinzParcel {
  distance_m: number | null;
}

function extractBbox(geometry: { type: string; coordinates: unknown } | null | undefined): ParcelBbox | null {
  if (!geometry) return null;
  let coords: [number, number][] = [];
  if (geometry.type === "Polygon") {
    coords = (geometry.coordinates as [number, number][][])[0] ?? [];
  } else if (geometry.type === "MultiPolygon") {
    // Use the largest ring for MultiPolygon (first ring of first polygon by convention)
    coords = (geometry.coordinates as [number, number][][][])[0]?.[0] ?? [];
  }
  if (coords.length === 0) return null;
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    polygon: coords, // outer ring [lng, lat] pairs for point-in-polygon testing
  };
}

export interface LinzTitle {
  title_no: string;
  owners: string[];
  estate_type: string | null;
  issue_date: string | null;
}

export interface LinzLrsTitlePreview {
  title_no: string;
  title_type: string | null;
  title_status: string | null;
  legal_descriptions: string[];
  land_district: string | null;
  issue_date: string | null;
  indicative_area_sqm: number | null;
}

export interface LinzLrsAddressTitlePreview {
  address_id: string;
  address: string;
  titles: LinzLrsTitlePreview[];
}

export interface LinzMemorial {
  title_no: string;
  memorial_text: string;
  current_type: string | null;
  instrument_no: string | null;
}

function getKey(): string | null {
  return process.env["LINZ_API_KEY"] ?? null;
}

function normaliseLrsAddress(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    .replace(/\b\d{4}\b/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function lrsAddressLooksExact(requested: string, candidate: string): boolean {
  const req = normaliseLrsAddress(requested);
  const cand = normaliseLrsAddress(candidate);
  if (!req || !cand) return false;
  if (req === cand || req.startsWith(cand) || cand.startsWith(req)) return true;

  const reqParts = req.split(" ");
  const candParts = cand.split(" ");
  const reqNumber = reqParts[0] ?? "";
  const candNumber = candParts[0] ?? "";
  if (reqNumber !== candNumber) return false;

  const reqTokens = new Set(reqParts.slice(1));
  const candTokens = candParts.slice(1).filter((token) => !["street", "road", "drive", "avenue", "place", "lane", "crescent", "parade"].includes(token));
  return candTokens.length > 0 && candTokens.every((token) => reqTokens.has(token));
}

function lrsAddressQueryVariants(address: string): string[] {
  const raw = address.trim();
  const noCountry = raw
    .replace(/\b(new zealand|nz)\b/gi, "")
    .replace(/\s*,\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const noPostcode = noCountry
    .replace(/\b\d{4}\b/g, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*$/g, "")
    .trim();
  const parts = noPostcode.split(",").map((part) => part.trim()).filter(Boolean);
  const streetSuburbCity = parts.slice(0, 3).join(", ");
  const streetSuburb = parts.slice(0, 2).join(", ");
  const streetOnly = parts[0] ?? noPostcode;

  return [...new Set([raw, noCountry, noPostcode, streetSuburbCity, streetSuburb, streetOnly].filter(Boolean))];
}

function normaliseLrsTitleType(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (/cross[-\s]*lease|crosslease/i.test(raw)) return "Cross Lease";
  if (/unit\s*title/i.test(raw)) return "Unit Title";
  if (/stratum/i.test(raw)) return "Stratum";
  if (/leasehold/i.test(raw)) return "Leasehold";
  if (/fee\s*simple|freehold/i.test(raw)) return "Fee Simple";
  return raw;
}

export function estateTypeFromLrsTitles(titles: LinzLrsTitlePreview[]): string | null {
  const liveTitles = titles.filter((title) => !title.title_status || /^live$/i.test(title.title_status));
  const candidates = (liveTitles.length > 0 ? liveTitles : titles)
    .map((title) => normaliseLrsTitleType(title.title_type))
    .filter((title): title is string => !!title);

  const crossLease = candidates.find((title) => /cross[-\s]*lease|crosslease/i.test(title));
  if (crossLease) return "Cross Lease";
  const unitTitle = candidates.find((title) => /unit\s*title/i.test(title));
  if (unitTitle) return "Unit Title";
  const stratum = candidates.find((title) => /stratum/i.test(title));
  if (stratum) return "Stratum";
  const leasehold = candidates.find((title) => /leasehold/i.test(title));
  if (leasehold) return "Leasehold";
  return candidates[0] ?? null;
}

export async function fetchLINZTitlesByAddress(address: string): Promise<LinzLrsAddressTitlePreview | null> {
  const initialQuery = address.trim();
  if (!initialQuery) return null;

  try {
    let selected: { id?: string | number; address?: string; source?: string; rank?: number } | null = null;
    let selectedQuery = initialQuery;

    for (const query of lrsAddressQueryVariants(initialQuery)) {
      const addressUrl = new URL(`${LINZ_LRS_PUBLIC_BASE}/public-search-caches/addresses`);
      addressUrl.searchParams.set("q", query);
      const addressResp = await fetch(addressUrl.toString(), {
        headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(10000),
      });
      if (!addressResp.ok) {
        logger.warn({ status: addressResp.status, query }, "LINZ LRS address search failed");
        continue;
      }

      const addressJson = await addressResp.json() as {
        data?: Array<{ id?: string | number; address?: string; source?: string; rank?: number }>;
      };
      const addressCandidates = (addressJson.data ?? [])
        .filter((item) => String(item.source ?? "").toLowerCase() === "address" && item.id != null && item.address)
        .sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));
      const exact = addressCandidates.find((item) => lrsAddressLooksExact(query, item.address ?? ""));
      if (exact?.id && exact.address) {
        selected = exact;
        selectedQuery = query;
        break;
      }
    }
    if (!selected?.id || !selected.address) return null;
    if (!lrsAddressLooksExact(selectedQuery, selected.address)) {
      logger.warn({ requested: initialQuery, selected: selected.address }, "LINZ LRS address search did not produce an exact-looking address");
      return null;
    }

    const titlesUrl = new URL(`${LINZ_LRS_PUBLIC_BASE}/public-searches/lws/titles`);
    titlesUrl.searchParams.set("addressId", String(selected.id).replaceAll("/", "$"));
    const titlesResp = await fetch(titlesUrl.toString(), {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!titlesResp.ok) {
      logger.warn({ status: titlesResp.status, addressId: selected.id }, "LINZ LRS title preview failed");
      return null;
    }

    const titlesJson = await titlesResp.json() as {
      titles?: {
        items?: Array<{
          titleNo?: string;
          issueDate?: string | null;
          type?: { desc?: string | null; code?: string | null } | null;
          status?: { desc?: string | null; code?: string | null } | null;
          landDistrict?: string | null;
          legalDescriptions?: string[];
          indicativeArea?: number | null;
        }>;
      };
      address?: { id?: string | number; string?: string };
    };
    const titles = (titlesJson.titles?.items ?? [])
      .map((item): LinzLrsTitlePreview | null => {
        const titleNo = String(item.titleNo ?? "").trim();
        if (!titleNo) return null;
        return {
          title_no: titleNo,
          title_type: normaliseLrsTitleType(item.type?.desc ?? item.type?.code ?? null),
          title_status: item.status?.desc ?? item.status?.code ?? null,
          legal_descriptions: Array.isArray(item.legalDescriptions) ? item.legalDescriptions.filter(Boolean) : [],
          land_district: item.landDistrict ?? null,
          issue_date: item.issueDate ?? null,
          indicative_area_sqm: typeof item.indicativeArea === "number" ? Math.round(item.indicativeArea) : null,
        };
      })
      .filter((item): item is LinzLrsTitlePreview => !!item);

    if (titles.length === 0) return null;
    return {
      address_id: String(titlesJson.address?.id ?? selected.id),
      address: titlesJson.address?.string ?? selected.address,
      titles,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, address: initialQuery }, "LINZ LRS title preview lookup failed");
    return null;
  }
}

async function queryLinzLayer(
  layerId: number,
  cqlFilter: string,
  key: string,
  timeoutMs = 12000,
  count = 1,
): Promise<Record<string, unknown>[] | null> {
  const url = new URL(`${LINZ_BASE}/layers/${layerId}/features/`);
  url.searchParams.set("q", cqlFilter);
  url.searchParams.set("count", String(count));
  url.searchParams.set("api_key", key);

  const resp = await fetch(url.toString(), {
    headers: {
      ...LINZ_HEADERS,
      Authorization: `key ${key}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (resp.status === 429) {
    logger.warn("LINZ API rate limited");
    return null;
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.warn(
      { status: resp.status, body: body.slice(0, 200), cqlFilter, layerId },
      "LINZ layer query failed",
    );
    return null;
  }

  const data = (await resp.json()) as {
    features?: Array<{ id: string | number; properties: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } }>;
    type?: string;
  };

  if (!data.features) {
    logger.warn({ layerId, cqlFilter }, "LINZ response missing features array");
    return null;
  }

  return data.features.map((f) => ({ ...f.properties, _id: f.id, _geometry: f.geometry ?? null }));
}

/**
 * LINZ GeoServer expects `layer-{id}` for spatial layers or `table-{id}` for
 * attribute-only tables — see LINZ “WFS filtering by attribute” guide.
 */
async function queryLinzWFS(
  typeNames: string,
  cqlFilter: string,
  key: string,
  timeoutMs = 12000,
  count = 1,
): Promise<Record<string, unknown>[] | null> {
  // Correct LINZ WFS URL format: /services;key={key}/wfs  (NOT /services/wfs/{key}/wfs)
  const url = new URL(`https://data.linz.govt.nz/services;key=${key}/wfs`);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("version", "2.0.0");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("typeNames", typeNames);
  // LINZ examples use lowercase `cql_filter`; GeoServer accepts both aliases.
  url.searchParams.set("cql_filter", cqlFilter);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("count", String(count));

  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.warn(
      { status: resp.status, body: body.slice(0, 300), cqlFilter, typeNames },
      "LINZ WFS query failed",
    );
    return null;
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (!contentType.includes("json") && !contentType.includes("text")) {
    logger.warn({ contentType }, "LINZ WFS: unexpected content-type");
    return null;
  }

  const text = await resp.text();
  if (text.includes("ExceptionReport") || text.includes("<!DOCTYPE")) {
    logger.warn({ preview: text.slice(0, 300) }, "LINZ WFS: got error/HTML response");
    return null;
  }

  try {
    const data = JSON.parse(text) as {
      features?: Array<{ id: string; properties: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } }>;
      type?: string;
    };
    if (!data.features) {
      logger.warn({ typeNames }, "LINZ WFS response missing features array");
      return null;
    }
    return data.features.map((f) => ({ ...f.properties, _id: f.id, _geometry: f.geometry ?? null }));
  } catch (e) {
    logger.warn({ err: (e as Error).message, preview: text.slice(0, 200) }, "LINZ WFS: JSON parse failed");
    return null;
  }
}

async function queryLinzLayerWFS(
  layerId: number,
  cqlFilter: string,
  key: string,
  timeoutMs = 12000,
  count = 1,
): Promise<Record<string, unknown>[] | null> {
  return queryLinzWFS(`layer-${layerId}`, cqlFilter, key, timeoutMs, count);
}

/** REST `/tables/{id}` for attribute-only catalogue entries (distinct from `/layers`). */
async function queryLinzTableRest(
  tableId: number,
  cqlFilter: string,
  key: string,
  timeoutMs = 12000,
  count = 1,
): Promise<Record<string, unknown>[] | null> {
  const url = new URL(`${LINZ_BASE}/tables/${tableId}/features/`);
  url.searchParams.set("q", cqlFilter);
  url.searchParams.set("count", String(count));
  url.searchParams.set("api_key", key);

  const resp = await fetch(url.toString(), {
    headers: {
      ...LINZ_HEADERS,
      Authorization: `key ${key}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (resp.status === 429) {
    logger.warn("LINZ API rate limited");
    return null;
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.warn(
      { status: resp.status, body: body.slice(0, 200), cqlFilter, tableId },
      "LINZ table (REST) query failed",
    );
    return null;
  }

  const data = (await resp.json()) as {
    features?: Array<{ id: string | number; properties: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } }>;
    type?: string;
  };

  if (!data.features) {
    logger.warn({ tableId, cqlFilter }, "LINZ table REST response missing features array");
    return null;
  }

  return data.features.map((f) => ({ ...f.properties, _id: f.id, _geometry: f.geometry ?? null }));
}

function ecqlTitleNoEquals(title_no: string): string {
  // ECQL strings: escape single quotes by doubling
  const t = title_no.replace(/'/g, "''").trim();
  return `title_no='${t}'`;
}

function parseLinzArea(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function mapLinzParcelFeature(props: Record<string, unknown>): LinzParcel {
  const geometry = props["_geometry"] as { type: string; coordinates: unknown } | null | undefined;
  const bbox = extractBbox(geometry);
  const calcAreaSqm = parseLinzArea(props["calc_area"]);
  const surveyAreaSqm = parseLinzArea(props["survey_area"]);
  const areaSqm = surveyAreaSqm ?? calcAreaSqm;
  const titlesRaw = props["titles"] ?? props["title_no"];
  const titleNo = titlesRaw ? String(titlesRaw).split(",")[0].trim() : null;

  return {
    parcel_id: String(props["_id"] ?? props["id"] ?? ""),
    appellation: (props["appellation"] as string) ?? null,
    area_sqm: areaSqm,
    survey_area_sqm: surveyAreaSqm,
    calc_area_sqm: calcAreaSqm,
    title_no: titleNo,
    legal_description: (props["appellation"] as string) ?? null,
    topology_type: (props["topology_type"] as string) ?? null,
    bbox,
  };
}

export async function fetchLINZParcel(lat: number, lng: number): Promise<LinzParcel | null> {
  const key = getKey();
  if (!key) {
    logger.warn("LINZ_API_KEY not set — skipping parcel lookup");
    return null;
  }

  const cqlFormats = [
    `INTERSECTS(shape,SRID=4326;POINT(${lng} ${lat}))`,
    `INTERSECTS(shape,SRID=4167;POINT(${lng} ${lat}))`,
    `INTERSECTS(shape,POINT(${lng} ${lat}))`,
  ];

  for (const cql of cqlFormats) {
    try {
      let features = await queryLinzLayer(LAYER_PRIMARY_PARCELS, cql, key);
      if (features === null) {
        logger.debug({ cql }, "LINZ REST failed — trying WFS");
        features = await queryLinzLayerWFS(LAYER_PRIMARY_PARCELS, cql, key);
      }
      if (features === null) continue;
      if (features.length === 0) {
        logger.debug({ cql }, "LINZ parcel: no features for this CQL format");
        continue;
      }

      const parcel = mapLinzParcelFeature(features[0]);
      logger.info(
        { parcel_id: parcel.parcel_id, bbox: parcel.bbox, survey_area_sqm: parcel.survey_area_sqm, calc_area_sqm: parcel.calc_area_sqm },
        "LINZ primary parcel found",
      );
      return parcel;
    } catch (err) {
      logger.warn({ err: (err as Error).message, cql }, "LINZ parcel fetch attempt failed");
    }
  }

  logger.warn({ lat, lng }, "LINZ parcel: all CQL formats exhausted with no result");
  return null;
}

function latLngBBox(lat: number, lng: number, radiusM: number): { minLat: number; minLng: number; maxLat: number; maxLng: number } {
  const latDelta = radiusM / 111_320;
  const lngDelta = radiusM / (111_320 * Math.max(0.25, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

function parcelCentroid(parcel: LinzParcel): { lat: number; lng: number } | null {
  const coords = parcel.bbox?.polygon;
  if (coords && coords.length > 0) {
    const usable = coords.length > 1 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]
      ? coords.slice(0, -1)
      : coords;
    const sum = usable.reduce((acc, c) => ({ lng: acc.lng + c[0], lat: acc.lat + c[1] }), { lat: 0, lng: 0 });
    return { lat: sum.lat / usable.length, lng: sum.lng / usable.length };
  }
  const bbox = parcel.bbox;
  if (!bbox) return null;
  return {
    lat: (bbox.minLat + bbox.maxLat) / 2,
    lng: (bbox.minLng + bbox.maxLng) / 2,
  };
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6_371_000;
  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const dPhi = ((bLat - aLat) * Math.PI) / 180;
  const dLambda = ((bLng - aLng) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return Math.round(2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function parseLinzParcel(props: Record<string, unknown>, lat: number, lng: number): LinzParcelNearby {
  const geometry = props["_geometry"] as { type: string; coordinates: unknown } | null | undefined;
  const bbox = extractBbox(geometry);
  const calcArea = props["calc_area"] ?? props["survey_area"] ?? null;
  const areaSqm = calcArea != null ? Math.round(Number(calcArea)) : null;
  const titlesRaw = props["titles"] ?? props["title_no"];
  const titleNo = titlesRaw ? String(titlesRaw).split(",")[0].trim() : null;
  const parcel: LinzParcel = {
    parcel_id: String(props["_id"] ?? props["id"] ?? ""),
    appellation: (props["appellation"] as string) ?? null,
    area_sqm: areaSqm && areaSqm > 0 ? areaSqm : null,
    title_no: titleNo,
    legal_description: (props["appellation"] as string) ?? null,
    topology_type: (props["topology_type"] as string) ?? null,
    bbox,
  };
  const centroid = parcelCentroid(parcel);
  return {
    ...parcel,
    distance_m: centroid ? distanceMeters(lat, lng, centroid.lat, centroid.lng) : null,
  };
}

export async function fetchLINZParcelsNear(lat: number, lng: number, radiusM = 120, count = 30): Promise<LinzParcelNearby[] | null> {
  const key = getKey();
  if (!key) {
    logger.warn("LINZ_API_KEY not set — skipping nearby parcel lookup");
    return null;
  }

  const box = latLngBBox(lat, lng, radiusM);
  const cqlFormats = [
    `BBOX(shape,${box.minLng},${box.minLat},${box.maxLng},${box.maxLat},'EPSG:4326')`,
    `BBOX(shape,${box.minLng},${box.minLat},${box.maxLng},${box.maxLat})`,
  ];

  for (const cql of cqlFormats) {
    try {
      let features = await queryLinzLayer(LAYER_PRIMARY_PARCELS, cql, key, 12000, count);
      if (features === null) {
        logger.debug({ cql }, "LINZ nearby parcels REST failed — trying WFS");
        features = await queryLinzLayerWFS(LAYER_PRIMARY_PARCELS, cql, key, 12000, count);
      }
      if (features === null) continue;
      return features
        .map((props) => parseLinzParcel(props, lat, lng))
        .filter((parcel) => parcel.distance_m == null || parcel.distance_m <= radiusM * 1.35)
        .sort((a, b) => (a.distance_m ?? Number.MAX_SAFE_INTEGER) - (b.distance_m ?? Number.MAX_SAFE_INTEGER));
    } catch (err) {
      logger.warn({ err: (err as Error).message, cql }, "LINZ nearby parcels fetch attempt failed");
    }
  }

  logger.warn({ lat, lng, radiusM }, "LINZ nearby parcels: all CQL formats exhausted");
  return null;
}

// NZ Title Memorials List — tabular catalogue (WFS uses typeNames=table-51695, not layer-*).
const TABLE_NZ_TITLE_MEMORIALS_LIST = 51695;

// Returns the parsed memorials array, or null when the API call itself failed.
// Returning null lets callers distinguish "API error" from "API returned 0 memorials".
export async function fetchLINZMemorials(title_no: string): Promise<LinzMemorial[] | null> {
  const key = getKey();
  if (!key || !title_no) return null;

  const cql = ecqlTitleNoEquals(title_no);

  function parseFeatures(features: Record<string, unknown>[]): LinzMemorial[] {
    return features.map((props) => {
      const text = String(
        props["memorial_text"] ?? props["memorialtext"] ?? props["text"] ?? props["memorial"] ?? "",
      ).trim();
      return {
        title_no,
        memorial_text: text,
        current_type: String(props["current_type"] ?? props["type"] ?? props["currenttype"] ?? "").trim() || null,
        instrument_no: String(props["instrument_no"] ?? props["instrumentno"] ?? props["instrument_number"] ?? "").trim() || null,
      };
    }).filter((m) => m.memorial_text.length > 0);
  }

  // LINZ publishes memorials as a table; prefer `/tables/` REST then WFS `table-{id}`.
  try {
    const features = await queryLinzTableRest(TABLE_NZ_TITLE_MEMORIALS_LIST, cql, key, 12000, 30);
    if (features !== null) {
      logger.info({ title_no, count: features.length }, "LINZ memorials: table REST returned");
      return parseFeatures(features);
    }
    logger.info({ title_no }, "LINZ memorials: table REST null — trying WFS");
  } catch (err) {
    logger.warn({ err: (err as Error).message, title_no }, "LINZ memorials REST threw — trying WFS");
  }

  try {
    const features = await queryLinzWFS(`table-${TABLE_NZ_TITLE_MEMORIALS_LIST}`, cql, key, 12000, 30);
    if (features !== null) {
      logger.info({ title_no, count: features.length }, "LINZ memorials: WFS fallback returned");
      return parseFeatures(features);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, title_no }, "LINZ memorials WFS fallback threw");
  }

  // Both endpoints failed — signal caller that data is unavailable
  logger.warn({ title_no }, "LINZ memorials: both REST and WFS failed — returning null (api_error)");
  return null;
}

export async function fetchLINZTitle(title_no: string): Promise<LinzTitle | null> {
  const key = getKey();
  if (!key || !title_no) return null;

  try {
    const features = await queryLinzLayer(
      LAYER_NZ_TITLES,
      ecqlTitleNoEquals(title_no),
      key,
      10000,
    );
    if (!features || features.length === 0) return null;

    const props = features[0];

    let owners: string[] = [];
    try {
      const ownersResult = await queryLinzLayer(
        LAYER_TITLE_OWNERS,
        ecqlTitleNoEquals(title_no),
        key,
        8000,
      );
      if (ownersResult && ownersResult.length > 0) {
        owners = ownersResult
          .map((o) => String(o["name"] ?? o["owner_name"] ?? ""))
          .filter(Boolean);
      }
    } catch {
    }

    return {
      title_no,
      owners,
      estate_type: (props["estate_description"] as string) ?? null,
      issue_date: (props["issue_date"] as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message, title_no }, "LINZ title fetch failed");
    return null;
  }
}
