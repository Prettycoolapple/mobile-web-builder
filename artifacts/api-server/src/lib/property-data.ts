import { logger } from "./logger";

export interface PropertyHistory {
  cv_nzd: number | null;
  cv_year: number | null;
  build_year: number | null;
  floor_area_sqm: number | null;
  land_area_sqm: number | null;
  property_type: string | null;
  sources_confirmed: string[];
  sources_estimated: string[];
}

export interface AsbestosRisk {
  risk: "low" | "moderate" | "high" | "unknown";
  notes: string;
  demo_cost_low: number;
  demo_cost_high: number;
}

async function fetchFromAucklandCouncilRating(address: string): Promise<Partial<PropertyHistory>> {
  try {
    const encoded = encodeURIComponent(address);
    const url = `https://gis.aucklandcouncil.govt.nz/arcgis/rest/services/Auckland_Council/Rating_Valuations/MapServer/0/query?where=FULL_ADDRESS+LIKE+%27%25${encoded}%25%27&outFields=CV,CAPITAL_VALUE,IMPROVEMENT_VALUE,LAND_VALUE,LAND_AREA,FLOOR_AREA,BUILD_YEAR,PROPERTY_TYPE,CV_YEAR&returnGeometry=false&f=json`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return {};

    const data = (await resp.json()) as {
      features?: Array<{ attributes: Record<string, unknown> }>;
      error?: unknown;
    };

    if (data.error || !data.features || data.features.length === 0) return {};

    const attrs = data.features[0].attributes;

    const cv = Number(attrs["CV"] ?? attrs["CAPITAL_VALUE"] ?? NaN);
    const cvYear = Number(attrs["CV_YEAR"] ?? NaN);
    const buildYear = Number(attrs["BUILD_YEAR"] ?? NaN);
    const floorArea = Number(attrs["FLOOR_AREA"] ?? NaN);
    const landArea = Number(attrs["LAND_AREA"] ?? NaN);
    const propType = (attrs["PROPERTY_TYPE"] as string) ?? null;

    return {
      cv_nzd: !isNaN(cv) && cv > 0 ? cv : null,
      cv_year: !isNaN(cvYear) && cvYear > 2000 ? cvYear : null,
      build_year: !isNaN(buildYear) && buildYear > 1800 ? buildYear : null,
      floor_area_sqm: !isNaN(floorArea) && floorArea > 0 ? floorArea : null,
      land_area_sqm: !isNaN(landArea) && landArea > 0 ? landArea : null,
      property_type: propType,
    };
  } catch (err) {
    logger.debug({ err }, "Auckland Council rating query failed");
    return {};
  }
}

async function fetchFromQVSearch(address: string): Promise<Partial<PropertyHistory>> {
  try {
    const query = encodeURIComponent(address);
    const url = `https://api.qv.co.nz/api/v1/properties/search?query=${query}&limit=1`;

    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DevFeasible/1.0)",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!resp.ok) return {};

    const data = (await resp.json()) as {
      results?: Array<{
        capitalValue?: number;
        landValue?: number;
        landArea?: number;
        floorArea?: number;
        yearBuilt?: number;
        propertyType?: string;
      }>;
    };

    if (!data.results || data.results.length === 0) return {};
    const r = data.results[0];

    return {
      cv_nzd: r.capitalValue ?? null,
      build_year: r.yearBuilt ?? null,
      floor_area_sqm: r.floorArea ?? null,
      land_area_sqm: r.landArea ?? null,
      property_type: r.propertyType ?? null,
    };
  } catch {
    return {};
  }
}

export async function fetchPropertyHistory(address: string, linzAreaSqm?: number | null): Promise<PropertyHistory> {
  const [ratingData, qvData] = await Promise.allSettled([
    fetchFromAucklandCouncilRating(address),
    fetchFromQVSearch(address),
  ]);

  const rating = ratingData.status === "fulfilled" ? ratingData.value : {};
  const qv = qvData.status === "fulfilled" ? qvData.value : {};

  const confirmed: string[] = [];
  const estimated: string[] = [];

  const cv_nzd = rating.cv_nzd ?? qv.cv_nzd ?? null;
  if (cv_nzd) confirmed.push("cv_nzd");

  const build_year = rating.build_year ?? qv.build_year ?? null;
  if (build_year) confirmed.push("build_year");

  const floor_area_sqm = rating.floor_area_sqm ?? qv.floor_area_sqm ?? null;
  if (floor_area_sqm) confirmed.push("floor_area_sqm");

  const land_area_sqm = rating.land_area_sqm ?? qv.land_area_sqm ?? linzAreaSqm ?? null;
  if (land_area_sqm) {
    if (rating.land_area_sqm ?? qv.land_area_sqm) confirmed.push("land_area_sqm");
    else if (linzAreaSqm) estimated.push("land_area_sqm (from LINZ parcel)");
  }

  if (!cv_nzd) estimated.push("cv_nzd");
  if (!build_year) estimated.push("build_year");
  if (!floor_area_sqm) estimated.push("floor_area_sqm");

  return {
    cv_nzd,
    cv_year: rating.cv_year ?? null,
    build_year,
    floor_area_sqm,
    land_area_sqm,
    property_type: rating.property_type ?? qv.property_type ?? null,
    sources_confirmed: confirmed,
    sources_estimated: estimated,
  };
}

export function checkAsbestosRisk(build_year: number | null): AsbestosRisk {
  if (build_year === null) {
    return {
      risk: "unknown",
      notes: "Build year unknown — asbestos risk cannot be assessed. Commission a licensed asbestos assessor before any demolition work.",
      demo_cost_low: 25000,
      demo_cost_high: 55000,
    };
  }

  if (build_year <= 1940) {
    return {
      risk: "low",
      notes: `Built ${build_year}, pre-asbestos manufacturing era. Low risk of asbestos-containing materials.`,
      demo_cost_low: 15000,
      demo_cost_high: 30000,
    };
  }

  if (build_year <= 1990) {
    return {
      risk: "high",
      notes: `Built ${build_year}, peak asbestos era (1940–1990). Buildings from this era frequently contain asbestos cement products, textured ceiling coatings (Artex), vinyl floor tiles, and pipe lagging. WorkSafe NZ requires a licensed asbestos assessor before demolition. Budget for licensed removal.`,
      demo_cost_low: 35000,
      demo_cost_high: 80000,
    };
  }

  return {
    risk: "low",
    notes: `Built ${build_year}. Post-1990 construction — very low asbestos risk. Standard demolition approach applicable.`,
    demo_cost_low: 15000,
    demo_cost_high: 30000,
  };
}
