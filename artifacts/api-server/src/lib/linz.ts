import { logger } from "./logger";

const LINZ_BASE = "https://data.linz.govt.nz/services/api/v1";
const PARCEL_LAYER = 50804;

export interface LinzParcel {
  parcel_id: string;
  appellation: string | null;
  area_sqm: number | null;
  title_no: string | null;
  legal_description: string | null;
  topology_type: string | null;
}

export interface LinzTitle {
  title_no: string;
  owners: string[];
  estate_type: string | null;
  issue_date: string | null;
}

function getKey(): string | null {
  return process.env["LINZ_API_KEY"] ?? null;
}

export async function fetchLINZParcel(lat: number, lng: number): Promise<LinzParcel | null> {
  const key = getKey();
  if (!key) {
    logger.warn("LINZ_API_KEY not set — skipping parcel lookup");
    return null;
  }

  const wkt = `POINT(${lng} ${lat})`;
  const url = new URL(`${LINZ_BASE}/layers/${PARCEL_LAYER}/features/`);
  url.searchParams.set("q", `geometry INTERSECTS ${wkt}`);
  url.searchParams.set("count", "1");

  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `key ${key}` },
      signal: AbortSignal.timeout(12000),
    });

    if (resp.status === 429) {
      logger.warn("LINZ API rate limited");
      return null;
    }
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "LINZ parcel query failed");
      return null;
    }

    const data = (await resp.json()) as {
      features?: Array<{
        id: string | number;
        properties: Record<string, unknown>;
        geometry?: unknown;
      }>;
    };

    if (!data.features || data.features.length === 0) return null;

    const props = data.features[0].properties;
    return {
      parcel_id: String(data.features[0].id ?? props["id"] ?? ""),
      appellation: (props["appellation"] as string) ?? null,
      area_sqm: props["area_sqm"] != null ? Number(props["area_sqm"]) : null,
      title_no: (props["title_no"] as string) ?? null,
      legal_description: (props["legal_description"] as string) ?? null,
      topology_type: (props["topology_type"] as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err }, "LINZ parcel fetch failed");
    return null;
  }
}

export async function fetchLINZTitle(title_no: string): Promise<LinzTitle | null> {
  const key = getKey();
  if (!key || !title_no) return null;

  const TITLE_LAYER = 50805;
  const url = new URL(`${LINZ_BASE}/layers/${TITLE_LAYER}/features/`);
  url.searchParams.set("q", `title_no='${title_no}'`);
  url.searchParams.set("count", "1");

  try {
    const resp = await fetch(url.toString(), {
      headers: { Authorization: `key ${key}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      features?: Array<{ properties: Record<string, unknown> }>;
    };

    if (!data.features || data.features.length === 0) return null;
    const props = data.features[0].properties;

    const ownersRaw = props["owners"] ?? props["proprietors"] ?? "";
    const owners = typeof ownersRaw === "string"
      ? ownersRaw.split(";").map((s: string) => s.trim()).filter(Boolean)
      : [];

    return {
      title_no,
      owners,
      estate_type: (props["estate_type"] as string) ?? null,
      issue_date: (props["issue_date"] as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err }, "LINZ title fetch failed");
    return null;
  }
}
