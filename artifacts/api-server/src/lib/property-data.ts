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

const AC_MAPSERVER = "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/Website/ACWebsite2007/MapServer";
const AC_PROPERTY_VALUE_MAPSERVER = "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/PropertyValueInfo/MapServer";

function numberFromAttr(attrs: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = attrs[key];
    if (raw == null || raw === "") continue;
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function yearFromAttr(attrs: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const raw = attrs[key];
    if (raw == null || raw === "") continue;
    const text = String(raw);
    const yearMatch = text.match(/\b(18|19|20)\d{2}\b/);
    if (yearMatch) {
      const year = Number(yearMatch[0]);
      if (year >= 1800 && year <= new Date().getFullYear() + 1) return year;
    }
    const decadeMatch = text.match(/\b((?:18|19|20)\d0)s?\b/);
    if (decadeMatch) {
      const year = Number(decadeMatch[1]);
      if (year >= 1800 && year <= new Date().getFullYear()) return year;
    }
  }
  return null;
}

async function arcgisPointQuery(
  mapServer: string,
  layerId: number,
  lat: number,
  lng: number,
  outFields: string,
  timeoutMs = 18000,
): Promise<Record<string, unknown> | null> {
  const url = new URL(`${mapServer}/${layerId}/query`);
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) {
    logger.warn({ status: resp.status, layer: layerId }, "AC MapServer layer query failed");
    return null;
  }

  const data = (await resp.json()) as {
    features?: Array<{ attributes: Record<string, unknown> }>;
    error?: { message: string };
  };

  if (data.error) {
    logger.warn({ error: data.error.message, layer: layerId }, "AC MapServer layer error");
    return null;
  }

  return data.features?.[0]?.attributes ?? null;
}

async function fetchFromACRateAssessment(lat: number, lng: number, timeoutMs = 8000): Promise<Partial<PropertyHistory>> {
  try {
    const attrs = await arcgisPointQuery(
      AC_MAPSERVER,
      3,
      lat,
      lng,
      "*",
      timeoutMs,
    );
    if (!attrs) return {};

    const lcv = numberFromAttr(attrs, ["LCV"]);
    const cv = numberFromAttr(attrs, ["CV", "CAPITALVALUE", "CAPITAL_VALUE"]);
    const cvFinal = lcv ?? cv;

    const latestDateMs = attrs["LATESTVALUATIONDATE"] ?? attrs["VALUATIONDATE"];
    const cvYearFromDate = latestDateMs ? new Date(Number(latestDateMs)).getFullYear() : null;
    const cvYear = cvYearFromDate && cvYearFromDate > 2000
      ? cvYearFromDate
      : yearFromAttr(attrs, ["VALUATIONYEAR", "VALUATION_YEAR", "CVYEAR", "CV_YEAR"]);

    const buildYear = yearFromAttr(attrs, [
      "YEARBUILT",
      "YEAR_BUILT",
      "BUILT_YEAR",
      "BUILDYEAR",
      "DECADEBUILT",
      "DECADE_BUILT",
    ]);
    const floorArea = numberFromAttr(attrs, [
      "FLOORAREA",
      "FLOOR_AREA",
      "BUILDINGFLOORAREA",
      "BUILDING_FLOOR_AREA",
      "HOUSEAREA",
      "HOUSE_AREA",
    ]);

    logger.info({ cvFinal, cvYear, buildYear, floorArea, addr: attrs["FORMATTEDADDRESS"] }, "AC Rate Assessment result");

    return {
      cv_nzd: cvFinal,
      cv_year: cvYear && cvYear > 2000 ? cvYear : null,
      build_year: buildYear,
      floor_area_sqm: floorArea,
      property_type: (attrs["LANDUSEDESCRIPTION"] as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AC Rate Assessment fetch failed");
    return {};
  }
}

async function fetchFromACPropertyValueInfo(lat: number, lng: number, timeoutMs = 8000): Promise<Partial<PropertyHistory>> {
  try {
    const attrs = await arcgisPointQuery(
      AC_PROPERTY_VALUE_MAPSERVER,
      3,
      lat,
      lng,
      "*",
      timeoutMs,
    );
    if (!attrs) return {};

    const cvFinal = numberFromAttr(attrs, ["LCV", "CV", "CAPITALVALUE", "CAPITAL_VALUE"]);
    const cvYear = yearFromAttr(attrs, ["VALUATIONDATE", "LATESTVALUATIONDATE", "VALUATIONYEAR", "CVYEAR"]);
    const buildYear = yearFromAttr(attrs, ["YEARBUILT", "YEAR_BUILT", "BUILT_YEAR", "BUILDYEAR", "DECADEBUILT", "DECADE_BUILT"]);
    const floorArea = numberFromAttr(attrs, ["FLOORAREA", "FLOOR_AREA", "BUILDINGFLOORAREA", "BUILDING_FLOOR_AREA"]);
    const landArea = numberFromAttr(attrs, ["LANDAREA", "LAND_AREA", "SITEAREA", "SITE_AREA"]);

    logger.info({ cvFinal, cvYear, buildYear, floorArea, landArea }, "AC PropertyValueInfo result");

    return {
      cv_nzd: cvFinal,
      cv_year: cvYear && cvYear > 2000 ? cvYear : null,
      build_year: buildYear,
      floor_area_sqm: floorArea,
      land_area_sqm: landArea,
      property_type: (attrs["LANDUSEDESCRIPTION"] as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AC PropertyValueInfo fetch failed");
    return {};
  }
}

async function fetchFromACPropertyLayer(lat: number, lng: number, timeoutMs = 8000): Promise<Partial<PropertyHistory>> {
  try {
    const attrs = await arcgisPointQuery(
      AC_MAPSERVER,
      2,
      lat,
      lng,
      "PROPERTYAREA,AREAUNIT,PROPERTYTYPE,ADDRESSINONELINE",
      timeoutMs,
    );
    if (!attrs) return {};

    const areaRaw = attrs["PROPERTYAREA"];
    const areaUnit = String(attrs["AREAUNIT"] ?? "").toLowerCase();
    let land_area_sqm: number | null = null;

    if (areaRaw != null) {
      const num = parseFloat(String(areaRaw).replace(/[^0-9.]/g, ""));
      if (!isNaN(num) && num > 0) {
        if (areaUnit.includes("ha") || areaUnit.includes("hectare")) {
          land_area_sqm = Math.round(num * 10000);
        } else {
          land_area_sqm = Math.round(num);
        }
      }
    }

    logger.info({ areaRaw, areaUnit, land_area_sqm, addr: attrs["ADDRESSINONELINE"] }, "AC Property layer result");

    return {
      land_area_sqm: land_area_sqm && land_area_sqm > 0 ? land_area_sqm : null,
      property_type: (attrs["PROPERTYTYPE"] as string) ?? null,
    };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "AC Property layer fetch failed");
    return {};
  }
}

export async function fetchPropertyHistory(
  address: string,
  lat?: number | null,
  lng?: number | null,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  const results: Partial<PropertyHistory>[] = [];

  if (lat != null && lng != null) {
    const [rateResult, propertyValueResult, propertyLayerResult] = await Promise.allSettled([
      fetchFromACRateAssessment(lat, lng, 8000),
      fetchFromACPropertyValueInfo(lat, lng, 8000),
      fetchFromACPropertyLayer(lat, lng, 8000),
    ]);
    if (rateResult.status === "fulfilled") results.push(rateResult.value);
    if (propertyValueResult.status === "fulfilled") results.push(propertyValueResult.value);
    if (propertyLayerResult.status === "fulfilled") results.push(propertyLayerResult.value);
  } else {
    logger.warn({ address }, "fetchPropertyHistory: no lat/lng — skipping AC GIS queries");
  }

  const confirmed: string[] = [];
  const estimated: string[] = [];

  const cv_nzd = results.reduce((acc: number | null, r) => acc ?? r.cv_nzd ?? null, null);
  const cv_year = results.reduce((acc: number | null, r) => acc ?? r.cv_year ?? null, null);
  const build_year = results.reduce((acc: number | null, r) => acc ?? r.build_year ?? null, null);
  const floor_area_sqm = results.reduce((acc: number | null, r) => acc ?? r.floor_area_sqm ?? null, null);

  const land_area_sqm = results.reduce((acc: number | null, r) => acc ?? r.land_area_sqm ?? null, null)
    ?? linzAreaSqm ?? null;

  const property_type = results.reduce((acc: string | null, r) => acc ?? r.property_type ?? null, null);

  if (cv_nzd) confirmed.push("cv_nzd");
  else estimated.push("cv_nzd");

  if (build_year) confirmed.push("build_year");
  else estimated.push("build_year");

  if (floor_area_sqm) confirmed.push("floor_area_sqm");
  else estimated.push("floor_area_sqm");

  if (land_area_sqm) {
    if (results.some((r) => r.land_area_sqm != null)) confirmed.push("land_area_sqm");
    else if (linzAreaSqm) estimated.push("land_area_sqm (from LINZ parcel)");
  } else estimated.push("land_area_sqm");

  logger.info(
    { cv_nzd, land_area_sqm, build_year, floor_area_sqm, confirmed, estimated },
    "fetchPropertyHistory result",
  );

  return { cv_nzd, cv_year, build_year, floor_area_sqm, land_area_sqm, property_type, sources_confirmed: confirmed, sources_estimated: estimated };
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
