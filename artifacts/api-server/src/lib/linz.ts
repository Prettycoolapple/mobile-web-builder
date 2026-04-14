import { logger } from "./logger";

const LINZ_BASE = "https://data.linz.govt.nz/services/api/v1";

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
  area_sqm: number | null;
  title_no: string | null;
  legal_description: string | null;
  topology_type: string | null;
  bbox: ParcelBbox | null;
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

export interface LinzMemorial {
  title_no: string;
  memorial_text: string;
  current_type: string | null;
  instrument_no: string | null;
}

function getKey(): string | null {
  return process.env["LINZ_API_KEY"] ?? null;
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

async function queryLinzLayerWFS(
  layerId: number,
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
  url.searchParams.set("typeNames", `layer-${layerId}`);
  url.searchParams.set("CQL_FILTER", cqlFilter);
  url.searchParams.set("outputFormat", "application/json");
  url.searchParams.set("count", String(count));

  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.warn(
      { status: resp.status, body: body.slice(0, 300), cqlFilter, layerId },
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
      logger.warn({ layerId }, "LINZ WFS response missing features array");
      return null;
    }
    return data.features.map((f) => ({ ...f.properties, _id: f.id, _geometry: f.geometry ?? null }));
  } catch (e) {
    logger.warn({ err: (e as Error).message, preview: text.slice(0, 200) }, "LINZ WFS: JSON parse failed");
    return null;
  }
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

      const props = features[0];
      const geometry = props["_geometry"] as { type: string; coordinates: unknown } | null | undefined;
      const bbox = extractBbox(geometry);
      logger.info({ parcel_id: props["_id"], bbox }, "LINZ primary parcel found");

      const calcArea = props["calc_area"] ?? props["survey_area"] ?? null;
      const areaSqm = calcArea != null ? Math.round(Number(calcArea)) : null;

      const titlesRaw = props["titles"] ?? props["title_no"];
      const titleNo = titlesRaw ? String(titlesRaw).split(",")[0].trim() : null;

      return {
        parcel_id: String(props["_id"] ?? props["id"] ?? ""),
        appellation: (props["appellation"] as string) ?? null,
        area_sqm: areaSqm && areaSqm > 0 ? areaSqm : null,
        title_no: titleNo,
        legal_description: (props["appellation"] as string) ?? null,
        topology_type: (props["topology_type"] as string) ?? null,
        bbox,
      };
    } catch (err) {
      logger.warn({ err: (err as Error).message, cql }, "LINZ parcel fetch attempt failed");
    }
  }

  logger.warn({ lat, lng }, "LINZ parcel: all CQL formats exhausted with no result");
  return null;
}

// LINZ layer 51553: NZ Title Memorials (most recent outstanding)
const LAYER_TITLE_MEMORIALS = 51553;

// Returns the parsed memorials array, or null when the API call itself failed.
// Returning null lets callers distinguish "API error" from "API returned 0 memorials".
export async function fetchLINZMemorials(title_no: string): Promise<LinzMemorial[] | null> {
  const key = getKey();
  if (!key || !title_no) return null;

  const cql = `title_no='${title_no}'`;

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

  // Try REST endpoint first
  try {
    const features = await queryLinzLayer(LAYER_TITLE_MEMORIALS, cql, key, 10000, 30);
    if (features !== null) {
      // REST succeeded (even if 0 results — that means genuinely no memorials)
      logger.info({ title_no, count: features.length }, "LINZ memorials: REST returned");
      return parseFeatures(features);
    }
    logger.info({ title_no }, "LINZ memorials: REST returned null — trying WFS fallback");
  } catch (err) {
    logger.warn({ err: (err as Error).message, title_no }, "LINZ memorials REST threw — trying WFS fallback");
  }

  // WFS fallback
  try {
    const features = await queryLinzLayerWFS(LAYER_TITLE_MEMORIALS, cql, key, 12000, 30);
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
      `title_no='${title_no}'`,
      key,
      10000,
    );
    if (!features || features.length === 0) return null;

    const props = features[0];

    let owners: string[] = [];
    try {
      const ownersResult = await queryLinzLayer(
        LAYER_TITLE_OWNERS,
        `title_no='${title_no}'`,
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
