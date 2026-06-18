import { logger } from "./logger";

// Official school-zone source: the Ministry of Education "NZ School Enrolment
// Zones" boundaries, published as an ArcGIS Feature Service (hosted by Eagle
// Technology, the Esri NZ distributor). We point-in-polygon query it with the
// property's geocoded lat/lng to get the schools whose enrolment zone actually
// contains the property — the authoritative "which schools is this property
// zoned for" answer. This replaces scraping/LLM-guessing of school names.
//
// SR of the data is NZTM (2193); we pass our WGS84 lat/lng with inSR=4326 and
// the server reprojects. Fields: School_ID, School_name, Institution_type,
// Effective_date.

const DEFAULT_FEATURESERVER =
  "https://services.arcgis.com/XTtANUDT8Va4DLwI/arcgis/rest/services/NZ_School_Zone_boundaries/FeatureServer/0";

const QUERY_TIMEOUT_MS = 8_000;

export type SchoolZoneLevel = "primary" | "intermediate" | "secondary" | "composite" | "other";

export interface SchoolZoneGisHit {
  /** MoE school number (joins to the directory's School_Id). */
  schoolId: number | null;
  schoolName: string;
  institutionType: string | null;
  /** Zone effective date (ISO) when provided by the service. */
  effectiveDate: string | null;
  level: SchoolZoneLevel;
  /** Human label for the year range, e.g. "Years 1–6". */
  yearLevels: string | null;
}

function featureServerUrl(): string {
  return process.env["MOE_SCHOOL_ZONES_FEATURESERVER"]?.trim() || DEFAULT_FEATURESERVER;
}

/** Map MoE Institution_type to a coarse level + a human year-range label. */
export function classifyInstitutionType(raw: string | null | undefined): {
  level: SchoolZoneLevel;
  yearLevels: string | null;
} {
  const t = (raw ?? "").trim().toLowerCase();
  if (!t) return { level: "other", yearLevels: null };
  if (t.includes("intermediate")) return { level: "intermediate", yearLevels: "Years 7–8" };
  if (t.includes("composite") || t.includes("area school")) {
    return { level: "composite", yearLevels: "Years 1–13" };
  }
  if (t.includes("secondary")) {
    // "Secondary (Year 7-15)" spans intermediate + secondary; "(Year 9-15)" is senior only.
    if (t.includes("7-15") || t.includes("7–15")) return { level: "secondary", yearLevels: "Years 7–13" };
    return { level: "secondary", yearLevels: "Years 9–13" };
  }
  if (t.includes("full primary")) return { level: "primary", yearLevels: "Years 1–8" };
  if (t.includes("contributing")) return { level: "primary", yearLevels: "Years 1–6" };
  if (t.includes("primary")) return { level: "primary", yearLevels: "Years 1–6" };
  return { level: "other", yearLevels: null };
}

const LEVEL_ORDER: Record<SchoolZoneLevel, number> = {
  primary: 0,
  intermediate: 1,
  secondary: 2,
  composite: 3,
  other: 4,
};

interface ArcgisFeature {
  attributes?: Record<string, unknown>;
}

/**
 * Returns the schools whose enrolment zone contains the given point. Fails soft:
 * any network/HTTP/parse error (or an unreachable service) yields an empty array
 * so the feasibility report is never blocked. An empty result is legitimate —
 * many schools have no enrolment scheme, so a property may have no home zone at
 * a given level (open enrolment).
 */
export async function fetchSchoolZonesByPoint(lat: number, lng: number): Promise<SchoolZoneGisHit[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "School_ID,School_name,Institution_type,Effective_date",
    returnGeometry: "false",
    f: "json",
  });
  const url = `${featureServerUrl()}/query?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ProjectAlphaNZ/1.0 (school zone lookup)",
      },
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "school-zones-gis: HTTP error");
      return [];
    }

    const json = (await resp.json()) as { error?: unknown; features?: ArcgisFeature[] };
    if (json.error || !Array.isArray(json.features)) {
      if (json.error) logger.warn({ err: json.error }, "school-zones-gis: ArcGIS error response");
      return [];
    }

    const hits: SchoolZoneGisHit[] = [];
    const seen = new Set<string>();
    for (const feature of json.features) {
      const attrs = feature.attributes ?? {};
      const schoolName = String(attrs["School_name"] ?? "").trim();
      if (!schoolName) continue;

      const idRaw = attrs["School_ID"];
      const schoolId =
        idRaw != null && idRaw !== "" && !Number.isNaN(Number(idRaw)) ? Number(idRaw) : null;

      const dedupeKey = schoolId != null ? `id:${schoolId}` : `name:${schoolName.toLowerCase()}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const institutionType = String(attrs["Institution_type"] ?? "").trim() || null;
      const { level, yearLevels } = classifyInstitutionType(institutionType);

      const effRaw = attrs["Effective_date"];
      const effectiveDate =
        typeof effRaw === "number"
          ? new Date(effRaw).toISOString()
          : effRaw
            ? String(effRaw)
            : null;

      hits.push({ schoolId, schoolName, institutionType, effectiveDate, level, yearLevels });
    }

    hits.sort(
      (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || a.schoolName.localeCompare(b.schoolName),
    );
    return hits;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "school-zones-gis: fetch failed");
    return [];
  }
}
