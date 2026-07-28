import type { PropertyHistory } from "./property-data";
import { emptyPropertyHistory, type PlanningProviderId } from "./regional-planning";
import { canonicaliseTrailingStreetType } from "./street-types";

const WHAKATANE_PROPERTY =
  "https://gis.whakatane.govt.nz/arcgis/rest/services/Geocortex/PropertyRoadSearch/MapServer/2";
const WHAKATANE_REVALUATION_YEAR = 2025;
const CHRISTCHURCH_PROPERTY =
  "https://gis.ccc.govt.nz/server/rest/services/OpenData/Property/FeatureServer";
const SOUTHLAND_PROPERTY =
  "https://gis.southlanddc.govt.nz/server/rest/services/External_Property_Layers/MapServer/3";
const WESTERN_BAY_PROPERTY =
  "https://map.westernbay.govt.nz/arcgisext/rest/services/Property/MapServer";
const PNCC_PROPERTY_VALUATION =
  "https://services.arcgis.com/Fv0Tvc98QEDvQyjL/arcgis/rest/services/PROPERTY_PARCEL_VALUATION_VIEW/FeatureServer/0";
const NAPIER_PROPERTY_WFS = "https://data.napier.govt.nz/geo/ows";
const TAURANGA_ASSESSMENT =
  "https://gis.tauranga.govt.nz/server/rest/services/Assessment/FeatureServer/2";
const TAURANGA_CAPITAL_VALUE =
  "https://gis.tauranga.govt.nz/server/rest/services/Capital_Value_Total_2023/FeatureServer/10";
const KAPITI_PROPERTY =
  "https://maps.kapiticoast.govt.nz/server/rest/services/Public/Property_Public/MapServer/0";
const SELWYN_PROPERTY =
  "https://gis.selwyn.govt.nz/arcgis/rest/services/SDC_Public/Property_Public/MapServer/0";
const SELWYN_REVALUATION_YEAR = 2024;
const TAUPO_RATEABLE_LAND =
  "https://maps.taupodc.govt.nz/server/rest/services/property/Rateable_Land_Parcel/FeatureServer/0";
const BULLER_PROPERTY =
  "https://services6.arcgis.com/Whb8vGWSmNkavSpL/arcgis/rest/services/BDC_Property_Master_Public_View/FeatureServer";

type ArcGisFeature = { attributes?: Record<string, unknown> };

type ChristchurchAddress = {
  streetAddress: string;
  locality: string | null;
};

function positiveNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function leadingStreetNumber(value: string): string | null {
  const match = value.trim().match(/^(\d+[a-z]?)(?:\b|\s)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function sqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function normaliseStreetAddress(value: string): string {
  const cleaned = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9/\s]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const match = cleaned.match(/^(\d+[a-z]?)\s+(.+)$/i);
  if (!match) return cleaned.toLowerCase();
  return `${match[1]!.toLowerCase()} ${canonicaliseTrailingStreetType(match[2]!)}`;
}

function parseChristchurchAddress(address: string): ChristchurchAddress | null {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  const streetAddress = /^\d+[a-z]?$/i.test(parts[0] ?? "") && parts[1]
    ? `${parts[0]} ${parts[1]}`
    : parts[0] ?? "";
  const localityStartIndex = /^\d+[a-z]?$/i.test(parts[0] ?? "") ? 2 : 1;
  if (!/^\d+\s+.+/i.test(streetAddress)) return null;
  if (/^(?:unit|flat|apartment|apt)\b/i.test(streetAddress) || /^\d+\s*\/\s*\d+/i.test(streetAddress)) return null;
  if (/^\d+[a-z]\s+/i.test(streetAddress)) return null;

  const locality = parts.find((part, index) => index >= localityStartIndex && !/\b(christchurch|canterbury|new zealand)\b/i.test(part) && !/^\d{4}$/.test(part)) ?? null;
  return { streetAddress, locality };
}

function normaliseLocality(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function hasNonStandaloneLegalDescription(value: unknown): boolean {
  return /\b(unit|flat|accessory|cross\s*lease|leasehold|stratum)\b/i.test(String(value ?? ""));
}

async function christchurchQuery(
  layerId: number,
  where: string,
  outFields: string,
): Promise<ArcGisFeature[]> {
  const url = new URL(`${CHRISTCHURCH_PROPERTY}/${layerId}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("returnGeometry", "false");

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Christchurch property lookup HTTP ${response.status}`);
  const data = await response.json() as {
    features?: ArcGisFeature[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`Christchurch property lookup error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

async function fetchChristchurchRatingUnit(
  address: string,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  const parsed = parseChristchurchAddress(address);
  if (!parsed) return emptyPropertyHistory(linzAreaSqm);

  try {
    const requestedStreet = normaliseStreetAddress(parsed.streetAddress);
    const ratingFeatures = await christchurchQuery(
      2,
      `UPPER(StreetAddress) = '${sqlString(requestedStreet.toUpperCase())}'`,
      "RatingUnitID,PreferredStreetAddressID,StreetAddress,LocalityName,drvLegalDescription,Shape__Area",
    );
    const rating = ratingFeatures.find((feature) => {
      const attrs = feature.attributes ?? {};
      if (normaliseStreetAddress(String(attrs["StreetAddress"] ?? "")) !== requestedStreet) return false;
      const requestedLocality = normaliseLocality(parsed.locality);
      return !requestedLocality || requestedLocality === normaliseLocality(String(attrs["LocalityName"] ?? ""));
    });
    const attrs = rating?.attributes;
    const preferredAddressId = positiveNumber(attrs?.["PreferredStreetAddressID"]);
    if (!attrs || !preferredAddressId || hasNonStandaloneLegalDescription(attrs["drvLegalDescription"])) {
      return emptyPropertyHistory(linzAreaSqm);
    }

    const preferredFeatures = await christchurchQuery(
      3,
      `StreetAddressID = ${preferredAddressId}`,
      "StreetAddressID,StreetAddress,LocalityName",
    );
    const preferred = preferredFeatures[0]?.attributes;
    const preferredStreetMatches = normaliseStreetAddress(String(preferred?.["StreetAddress"] ?? "")) === requestedStreet;
    const requestedLocality = normaliseLocality(parsed.locality);
    const preferredLocalityMatches = !requestedLocality || requestedLocality === normaliseLocality(String(preferred?.["LocalityName"] ?? ""));
    if (!preferredStreetMatches || !preferredLocalityMatches) return emptyPropertyHistory(linzAreaSqm);

    const ratingAreaSqm = positiveNumber(attrs["Shape__Area"]);
    if (ratingAreaSqm == null || ratingAreaSqm < 10 || ratingAreaSqm > 100_000_000) {
      return emptyPropertyHistory(linzAreaSqm);
    }

    return {
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: ratingAreaSqm,
      land_area_source: "christchurch_council_rating_unit",
      land_area_scope: "rating_unit",
      property_type: null,
      sources_confirmed: ["land_area_sqm (Christchurch City Council rating unit GIS)"],
      sources_estimated: ["cv_nzd", "build_year", "floor_area_sqm", "property_type"],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

function exactAddressFeature(address: string, features: ArcGisFeature[]): ArcGisFeature | null {
  const requestedNumber = leadingStreetNumber(address);
  if (!requestedNumber) return null;
  return features.find((feature) => {
    const location = String(feature.attributes?.["Location"] ?? "");
    return leadingStreetNumber(location) === requestedNumber;
  }) ?? null;
}

function streetAddressPart(value: string): string {
  return value.split(",")[0]?.trim() ?? value.trim();
}

function whakataneStreetAddressPrefix(address: string): string | null {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  let streetLine = /^\d+[a-z]?$/i.test(parts[0] ?? "") && parts[1]
    ? `${parts[0]} ${parts[1]}`
    : parts[0] ?? "";

  if (parts.length === 1) {
    const stateHighway = streetLine.match(/^(\d+[a-z]?\s+(?:STATE\s+HIGHWAY|SH)\s*\d+[a-z]?)(?:\s+|$)/i);
    const typedStreet = streetLine.match(/^(\d+[a-z]?\s+.+?\s+(?:ROAD|RD|STREET|ST|AVENUE|AVE|DRIVE|DR|PLACE|PL|LANE|LN|CRESCENT|CRES|TERRACE|TCE|WAY|CLOSE|PARADE|HIGHWAY|HWY|MOTORWAY))(?:\s+|$)/i);
    streetLine = stateHighway?.[1] ?? typedStreet?.[1] ?? streetLine;
  }

  const normalized = normaliseStreetAddress(streetLine);
  return /^\d+[a-z]?\s+/i.test(normalized) ? normalized.toUpperCase() : null;
}

async function queryWhakataneProperty(url: URL): Promise<ArcGisFeature[]> {
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Whakatane property lookup HTTP ${response.status}`);
  const data = await response.json() as {
    features?: ArcGisFeature[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`Whakatane property lookup error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

function exactSouthlandAddressFeature(address: string, features: ArcGisFeature[]): ArcGisFeature | null {
  const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
  if (!/^\d+[a-z]?\s+/i.test(requestedStreet)) return null;
  return features.find((feature) => {
    const councilStreet = normaliseStreetAddress(streetAddressPart(String(feature.attributes?.["Address"] ?? "")));
    return councilStreet === requestedStreet;
  }) ?? null;
}

async function fetchSouthlandPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  const url = new URL(`${SOUTHLAND_PROPERTY}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "Address,ValuationNumber,LegalDescription,CTDescription,LandValue,CapitalValue,RatesStruck");
  url.searchParams.set("returnGeometry", "false");

  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`Southland property lookup HTTP ${response.status}`);
    const data = await response.json() as {
      features?: ArcGisFeature[];
      error?: { message?: string };
    };
    if (data.error) throw new Error(`Southland property lookup error: ${data.error.message ?? "unknown"}`);

    const attrs = exactSouthlandAddressFeature(address, data.features ?? [])?.attributes;
    const cvNzd = positiveNumber(attrs?.["CapitalValue"]);
    if (!attrs) return emptyPropertyHistory(linzAreaSqm);
    return {
      cv_nzd: cvNzd,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: linzAreaSqm ?? null,
      land_area_source: linzAreaSqm ? "linz" : null,
      land_area_scope: linzAreaSqm ? "parcel" : null,
      property_type: null,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Southland District Council rating GIS)"] : []),
        ...(linzAreaSqm ? ["land_area_sqm (from LINZ parcel)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", "property_type"],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function fetchTaupoPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  const url = new URL(`${TAUPO_RATEABLE_LAND}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set(
    "outFields",
    "property_location,property_legal_desc,cert_of_title,valuation_id,PARCEL_AREA",
  );
  url.searchParams.set("returnGeometry", "false");

  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Taupō property GIS HTTP ${response.status}`);
    const data = await response.json() as {
      features?: ArcGisFeature[];
      error?: { message?: string };
    };
    if (data.error) throw new Error(`Taupō property GIS error: ${data.error.message ?? "unknown"}`);

    const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
    const attrs = (data.features ?? []).find((feature) =>
      normaliseStreetAddress(streetAddressPart(String(feature.attributes?.["property_location"] ?? ""))) === requestedStreet
    )?.attributes;
    if (!attrs) return emptyPropertyHistory(linzAreaSqm);

    const councilAreaSqm = positiveNumber(attrs["PARCEL_AREA"]);
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
    return {
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "taupo_council_rateable_land_gis",
      land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
      property_type: null,
      sources_confirmed: landAreaSqm
        ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Taupō District Council rateable land GIS)"]
        : [],
      sources_estimated: ["cv_nzd", "build_year", "floor_area_sqm", "property_type"],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

function exactPnccAddressFeature(address: string, features: ArcGisFeature[]): ArcGisFeature | null {
  const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
  if (!/^\d+[a-z]?\s+/i.test(requestedStreet)) return null;
  return features.find((feature) => {
    const councilStreet = normaliseStreetAddress(streetAddressPart(String(feature.attributes?.["LOCATION"] ?? "")));
    return councilStreet === requestedStreet;
  }) ?? null;
}

async function fetchManawatuPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  const url = new URL(`${PNCC_PROPERTY_VALUATION}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "LOCATION,VALUATION_NO,RATES_AREA,CURR_CAPITAL_VALUE,RATES_YEAR");
  url.searchParams.set("returnGeometry", "false");

  try {
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error(`PNCC property lookup HTTP ${response.status}`);
    const data = await response.json() as {
      features?: ArcGisFeature[];
      error?: { message?: string };
    };
    if (data.error) throw new Error(`PNCC property lookup error: ${data.error.message ?? "unknown"}`);
    const attrs = exactPnccAddressFeature(address, data.features ?? [])?.attributes;
    if (!attrs) return emptyPropertyHistory(linzAreaSqm);

    const cvNzd = positiveNumber(attrs["CURR_CAPITAL_VALUE"]);
    const councilAreaHa = Number(String(attrs["RATES_AREA"] ?? "").replace(/,/g, ""));
    const councilAreaSqm = Number.isFinite(councilAreaHa) && councilAreaHa > 0
      ? Math.round(councilAreaHa * 10_000)
      : null;
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
    const yearMatch = String(attrs["RATES_YEAR"] ?? "").match(/\b(19|20)\d{2}\b/);
    const cvYear = cvNzd && yearMatch ? Number(yearMatch[0]) : null;

    return {
      cv_nzd: cvNzd,
      cv_year: cvYear,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "pncc_council_rating_gis",
      land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
      property_type: null,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Palmerston North City Council rating GIS)"] : []),
        ...(landAreaSqm ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Palmerston North City Council rating GIS)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", "property_type"],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function queryWesternBayProperty(
  layerId: number,
  lat: number,
  lng: number,
  outFields: string,
): Promise<ArcGisFeature[]> {
  const url = new URL(`${WESTERN_BAY_PROPERTY}/${layerId}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("returnGeometry", "false");

  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(9000) });
  if (!response.ok) throw new Error(`Western Bay property lookup HTTP ${response.status}`);
  const data = await response.json() as {
    features?: ArcGisFeature[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`Western Bay property lookup error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

function exactWesternBayAddressFeature(address: string, features: ArcGisFeature[]): ArcGisFeature | null {
  const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
  if (!/^\d+[a-z]?\s+/i.test(requestedStreet)) return null;
  return features.find((feature) => {
    const attrs = feature.attributes ?? {};
    return [attrs["ParcelAddress"], attrs["ValuationAddress"]]
      .some((value) => normaliseStreetAddress(streetAddressPart(String(value ?? ""))) === requestedStreet);
  }) ?? null;
}

async function fetchWesternBayPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  try {
    const [propertyFeatures, valuationFeatures, improvementFeatures] = await Promise.all([
      queryWesternBayProperty(12, lat, lng, "ParcelID,ValuationID,ParcelAddress,ValuationAddress,LegalDescription,LegalArea"),
      queryWesternBayProperty(4, lat, lng, "ValuationNumber,CapitalValue"),
      queryWesternBayProperty(6, lat, lng, "ValuationNumber,ImprovementValue"),
    ]);
    const attrs = exactWesternBayAddressFeature(address, propertyFeatures)?.attributes;
    if (!attrs) return emptyPropertyHistory(linzAreaSqm);

    const valuationId = String(attrs["ValuationID"] ?? "").replace(/\D/g, "");
    const matchedValuationAttrs = valuationFeatures.find((feature) => {
      const candidate = String(feature.attributes?.["ValuationNumber"] ?? "").replace(/\D/g, "");
      return valuationId.length > 0 && candidate === valuationId;
    })?.attributes;
    const valuationAttrs = matchedValuationAttrs
      ?? (valuationFeatures.length === 1 ? valuationFeatures[0]?.attributes : undefined);
    const cvNzd = positiveNumber(valuationAttrs?.["CapitalValue"]);
    const matchedImprovementAttrs = improvementFeatures.find((feature) => {
      const candidate = String(feature.attributes?.["ValuationNumber"] ?? "").replace(/\D/g, "");
      return valuationId.length > 0 && candidate === valuationId;
    })?.attributes;
    const improvementAttrs = matchedImprovementAttrs
      ?? (improvementFeatures.length === 1 ? improvementFeatures[0]?.attributes : undefined);
    const improvementValueNzd = nonNegativeNumber(improvementAttrs?.["ImprovementValue"]);
    const propertyType = cvNzd != null && improvementValueNzd === 0 ? "Vacant land / section" : null;
    const legalAreaHa = Number(String(attrs["LegalArea"] ?? "").replace(/,/g, ""));
    const councilAreaSqm = Number.isFinite(legalAreaHa) && legalAreaHa > 0
      ? Math.round(legalAreaHa * 10_000)
      : null;
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;

    return {
      cv_nzd: cvNzd,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "western_bay_council_rating_gis",
      land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
      property_type: propertyType,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Western Bay of Plenty District Council rating GIS)"] : []),
        ...(landAreaSqm ? [linzAreaSqm ? "land_area_sqm (from LINZ parcel)" : "land_area_sqm (Western Bay of Plenty District Council property GIS)"] : []),
        ...(propertyType ? ["property_type (Western Bay of Plenty District Council zero improvement value)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", ...(propertyType ? [] : ["property_type"])],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function fetchNapierPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  try {
    const latPad = 60 / 111_320;
    const lngPad = 60 / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    const url = new URL(NAPIER_PROPERTY_WFS);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("version", "2.0.0");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("typeNames", "NCC:NCS_PROPADDRESS");
    url.searchParams.set("outputFormat", "application/json");
    url.searchParams.set("srsName", "EPSG:4326");
    url.searchParams.set("bbox", `${lng - lngPad},${lat - latPad},${lng + lngPad},${lat + latPad},EPSG:4326`);
    url.searchParams.set("count", "50");

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Napier property WFS HTTP ${response.status}`);
    const data = await response.json() as {
      features?: Array<{ properties?: Record<string, unknown> }>;
    };
    const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
    const feature = (data.features ?? []).find((candidate) =>
      normaliseStreetAddress(streetAddressPart(String(candidate.properties?.["property_address"] ?? ""))) === requestedStreet
    );
    if (!feature?.properties) return emptyPropertyHistory(linzAreaSqm);

    const registerAreaHa = Number(feature.properties["regarea"]);
    const councilAreaSqm = Number.isFinite(registerAreaHa) && registerAreaHa > 0
      ? Math.round(registerAreaHa * 10_000)
      : null;
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;

    return {
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "napier_council_property_wfs",
      land_area_scope: "parcel",
      property_type: null,
      sources_confirmed: landAreaSqm
        ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Napier City Council property WFS)"]
        : [],
      sources_estimated: ["cv_nzd", "build_year", "floor_area_sqm", "property_type"],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function queryTaurangaLayer(
  layerUrl: string,
  params: Record<string, string>,
): Promise<ArcGisFeature[]> {
  const url = new URL(`${layerUrl}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("returnGeometry", "false");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Tauranga property GIS HTTP ${response.status}`);
  const data = await response.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
  if (data.error) throw new Error(`Tauranga property GIS error: ${data.error.message ?? "unknown"}`);
  return data.features ?? [];
}

async function fetchTaurangaPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  try {
    const assessmentFeatures = await queryTaurangaLayer(TAURANGA_ASSESSMENT, {
      where: "1=1",
      geometry: `${lng},${lat}`,
      geometryType: "esriGeometryPoint",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      outFields: "LOCATIONADDRESS,SUBURB,VNZ,ValuationNumber,Shape__Area",
    });
    const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
    const assessment = assessmentFeatures.find((feature) =>
      normaliseStreetAddress(streetAddressPart(String(feature.attributes?.["LOCATIONADDRESS"] ?? ""))) === requestedStreet
    )?.attributes;
    const vnz = String(assessment?.["VNZ"] ?? "").trim();
    if (!assessment || !vnz) return emptyPropertyHistory(linzAreaSqm);

    const valuationFeatures = await queryTaurangaLayer(TAURANGA_CAPITAL_VALUE, {
      where: `VNZ='${sqlString(vnz)}'`,
      outFields: "VNZ,LandArea,CV2023,LV2023,VI2023,Shape__Area",
    });
    const valuation = valuationFeatures.find((feature) => String(feature.attributes?.["VNZ"] ?? "").trim() === vnz)?.attributes;
    const cvNzd = positiveNumber(valuation?.["CV2023"]);
    const landAreaHa = Number(valuation?.["LandArea"]);
    const shapeAreaSqm = positiveNumber(valuation?.["Shape__Area"] ?? assessment["Shape__Area"]);
    const councilAreaSqm = Number.isFinite(landAreaHa) && landAreaHa > 0
      ? Math.round(landAreaHa * 10_000)
      : shapeAreaSqm;
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
    const improvementValue = nonNegativeNumber(valuation?.["VI2023"]);
    const propertyType = cvNzd != null && improvementValue === 0 ? "Vacant land / section" : null;

    return {
      cv_nzd: cvNzd,
      cv_year: cvNzd ? 2023 : null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "tauranga_council_rating_gis",
      land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
      property_type: propertyType,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Tauranga City Council 2023 rating valuation GIS)"] : []),
        ...(landAreaSqm ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Tauranga City Council rating GIS)"] : []),
        ...(propertyType ? ["property_type (Tauranga City Council zero improvement value)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", ...(propertyType ? [] : ["property_type"])],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function fetchKapitiPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  try {
    const url = new URL(`${KAPITI_PROPERTY}/query`);
    url.searchParams.set("f", "json");
    url.searchParams.set("where", "1=1");
    url.searchParams.set("geometry", `${lng},${lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "Valuation_ID,Property_Number,Legal,Land_Value,Capital_Value,Improvements_Value,Hectares,Location,Valuation_Date,Shape_Area");
    url.searchParams.set("returnGeometry", "false");

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Kāpiti property GIS HTTP ${response.status}`);
    const data = await response.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
    if (data.error) throw new Error(`Kāpiti property GIS error: ${data.error.message ?? "unknown"}`);

    const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
    const attrs = (data.features ?? []).find((feature) =>
      normaliseStreetAddress(streetAddressPart(String(feature.attributes?.["Location"] ?? ""))) === requestedStreet
    )?.attributes;
    if (!attrs) return emptyPropertyHistory(linzAreaSqm);

    const cvNzd = positiveNumber(attrs["Capital_Value"]);
    const hectares = Number(attrs["Hectares"]);
    const shapeAreaSqm = positiveNumber(attrs["Shape_Area"]);
    const councilAreaSqm = Number.isFinite(hectares) && hectares > 0
      ? Math.round(hectares * 10_000)
      : shapeAreaSqm;
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
    const valuationTimestamp = Number(attrs["Valuation_Date"]);
    const valuationYear = Number.isFinite(valuationTimestamp) && valuationTimestamp > 0
      ? new Date(valuationTimestamp).getUTCFullYear()
      : null;
    const improvementValue = nonNegativeNumber(attrs["Improvements_Value"]);
    const propertyType = cvNzd != null && improvementValue === 0 ? "Vacant land / section" : null;

    return {
      cv_nzd: cvNzd,
      cv_year: cvNzd ? valuationYear : null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "kapiti_council_rating_gis",
      land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
      property_type: propertyType,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Kāpiti Coast District Council rating GIS)"] : []),
        ...(landAreaSqm ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Kāpiti Coast District Council rating GIS)"] : []),
        ...(propertyType ? ["property_type (Kāpiti Coast District Council zero improvement value)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", ...(propertyType ? [] : ["property_type"])],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function fetchSelwynPropertyHistory(
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  try {
    const url = new URL(`${SELWYN_PROPERTY}/query`);
    url.searchParams.set("f", "json");
    url.searchParams.set("where", "1=1");
    url.searchParams.set("geometry", `${lng},${lat}`);
    url.searchParams.set("geometryType", "esriGeometryPoint");
    url.searchParams.set("inSR", "4326");
    url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    url.searchParams.set("outFields", "Assessment_ID,CertificateTitle,Location,FullLegal,LandValue,CapitalValue,Hectares,Shape_Area");
    url.searchParams.set("returnGeometry", "false");

    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`Selwyn property GIS HTTP ${response.status}`);
    const data = await response.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
    if (data.error) throw new Error(`Selwyn property GIS error: ${data.error.message ?? "unknown"}`);

    const requestedStreet = normaliseStreetAddress(streetAddressPart(address));
    const attrs = (data.features ?? []).find((feature) =>
      normaliseStreetAddress(streetAddressPart(String(feature.attributes?.["Location"] ?? ""))) === requestedStreet
    )?.attributes;
    if (!attrs) return emptyPropertyHistory(linzAreaSqm);

    const cvNzd = positiveNumber(attrs["CapitalValue"]);
    const landValue = nonNegativeNumber(attrs["LandValue"]);
    const hectares = Number(attrs["Hectares"]);
    const shapeAreaSqm = positiveNumber(attrs["Shape_Area"]);
    const councilAreaSqm = Number.isFinite(hectares) && hectares > 0
      ? Math.round(hectares * 10_000)
      : shapeAreaSqm;
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
    const propertyType = cvNzd != null && landValue != null && cvNzd === landValue
      ? "Vacant land / section"
      : null;

    return {
      cv_nzd: cvNzd,
      cv_year: cvNzd ? SELWYN_REVALUATION_YEAR : null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "selwyn_council_rating_gis",
      land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
      property_type: propertyType,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Selwyn District Council 2024 rating valuation GIS)"] : []),
        ...(landAreaSqm ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Selwyn District Council rating GIS)"] : []),
        ...(propertyType ? ["property_type (Selwyn District Council zero improvement value)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", ...(propertyType ? [] : ["property_type"])],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

async function fetchBullerPropertyHistory(
  _address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  try {
    const parcelUrl = new URL(`${BULLER_PROPERTY}/1/query`);
    parcelUrl.searchParams.set("f", "json");
    parcelUrl.searchParams.set("where", "1=1");
    parcelUrl.searchParams.set("geometry", `${lng},${lat}`);
    parcelUrl.searchParams.set("geometryType", "esriGeometryPoint");
    parcelUrl.searchParams.set("inSR", "4326");
    parcelUrl.searchParams.set("spatialRel", "esriSpatialRelIntersects");
    parcelUrl.searchParams.set("outFields", "OBJECTID,Appellation,Titles,SurveyArea,ValNum,ParcelID");
    parcelUrl.searchParams.set("returnGeometry", "false");

    const parcelResponse = await fetch(parcelUrl.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!parcelResponse.ok) throw new Error(`Buller property GIS HTTP ${parcelResponse.status}`);
    const parcelData = await parcelResponse.json() as { features?: ArcGisFeature[]; error?: { message?: string } };
    if (parcelData.error) throw new Error(`Buller property GIS error: ${parcelData.error.message ?? "unknown"}`);
    const parcelAttrs = parcelData.features?.[0]?.attributes;
    const objectId = positiveNumber(parcelAttrs?.["OBJECTID"]);
    if (!parcelAttrs || objectId == null) return emptyPropertyHistory(linzAreaSqm);

    const valuationUrl = new URL(`${BULLER_PROPERTY}/1/queryRelatedRecords`);
    valuationUrl.searchParams.set("f", "json");
    valuationUrl.searchParams.set("objectIds", String(objectId));
    valuationUrl.searchParams.set("relationshipId", "1");
    valuationUrl.searchParams.set("outFields", "*");
    valuationUrl.searchParams.set("returnGeometry", "false");
    const valuationResponse = await fetch(valuationUrl.toString(), { signal: AbortSignal.timeout(12_000) });
    if (!valuationResponse.ok) throw new Error(`Buller valuation GIS HTTP ${valuationResponse.status}`);
    const valuationData = await valuationResponse.json() as {
      relatedRecordGroups?: Array<{ relatedRecords?: ArcGisFeature[] }>;
      error?: { message?: string };
    };
    if (valuationData.error) throw new Error(`Buller valuation GIS error: ${valuationData.error.message ?? "unknown"}`);
    const valuationAttrs = valuationData.relatedRecordGroups?.[0]?.relatedRecords?.[0]?.attributes;

    const cvNzd = positiveNumber(valuationAttrs?.["CapitalValue"]);
    const improvementValue = nonNegativeNumber(valuationAttrs?.["ImprovementsValue"]);
    const valuationTimestamp = Number(valuationAttrs?.["ValuationDate"]);
    const valuationYear = Number.isFinite(valuationTimestamp) && valuationTimestamp > 0
      ? new Date(valuationTimestamp).getUTCFullYear()
      : null;
    const councilAreaSqm = positiveNumber(parcelAttrs["SurveyArea"]);
    const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
    const propertyType = cvNzd != null && improvementValue === 0 ? "Vacant land / section" : null;

    return {
      cv_nzd: cvNzd,
      cv_year: cvNzd ? valuationYear : null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: landAreaSqm,
      land_area_source: linzAreaSqm ? "linz" : "buller_council_property_gis",
      land_area_scope: "parcel",
      property_type: propertyType,
      sources_confirmed: [
        ...(cvNzd ? ["cv_nzd (Buller District Council rating valuation GIS)"] : []),
        ...(landAreaSqm ? [linzAreaSqm
          ? "land_area_sqm (from LINZ parcel)"
          : "land_area_sqm (Buller District Council public parcel GIS)"] : []),
        ...(propertyType ? ["property_type (Buller District Council zero improvement value)"] : []),
      ],
      sources_estimated: ["build_year", "floor_area_sqm", ...(propertyType ? [] : ["property_type"])],
    };
  } catch {
    return emptyPropertyHistory(linzAreaSqm);
  }
}

export async function fetchRegionalPropertyHistory(
  providerId: PlanningProviderId,
  address: string,
  lat: number,
  lng: number,
  linzAreaSqm?: number | null,
): Promise<PropertyHistory> {
  if (providerId === "taupo") return fetchTaupoPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "selwyn") return fetchSelwynPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "buller") return fetchBullerPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "christchurch") return fetchChristchurchRatingUnit(address, linzAreaSqm);
  if (providerId === "manawatu") return fetchManawatuPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "southland") return fetchSouthlandPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "western-bay") return fetchWesternBayPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "tauranga") return fetchTaurangaPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "kapiti") return fetchKapitiPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId === "napier") return fetchNapierPropertyHistory(address, lat, lng, linzAreaSqm);
  if (providerId !== "whakatane") return emptyPropertyHistory(linzAreaSqm);

  const url = new URL(`${WHAKATANE_PROPERTY}/query`);
  url.searchParams.set("f", "json");
  url.searchParams.set("where", "1=1");
  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "Location,CapitalValue,LandValue,SurveyArea,CalculatedArea,Dwellings,LegalDescription,ValuationNumber");
  url.searchParams.set("returnGeometry", "false");

  const pointFeatures = await queryWhakataneProperty(url);
  let feature = exactAddressFeature(address, pointFeatures);

  // A valid rural address point can sit just outside a large or irregular
  // rating polygon. Retry by the council's Location attribute so CV and survey
  // area still resolve without ever accepting a neighbouring street number.
  if (!feature) {
    const streetPrefix = whakataneStreetAddressPrefix(address);
    if (streetPrefix) {
      const addressUrl = new URL(`${WHAKATANE_PROPERTY}/query`);
      addressUrl.searchParams.set("f", "json");
      addressUrl.searchParams.set("where", `UPPER(Location) LIKE '${sqlString(streetPrefix)}%'`);
      addressUrl.searchParams.set("outFields", "Location,CapitalValue,LandValue,SurveyArea,CalculatedArea,Dwellings,LegalDescription,ValuationNumber");
      addressUrl.searchParams.set("returnGeometry", "false");
      feature = exactAddressFeature(address, await queryWhakataneProperty(addressUrl));
    }
  }
  const attrs = feature?.attributes;
  if (!attrs) return emptyPropertyHistory(linzAreaSqm);

  const cvNzd = positiveNumber(attrs["CapitalValue"]);
  const councilAreaSqm = positiveNumber(attrs["SurveyArea"]) ?? positiveNumber(attrs["CalculatedArea"]);
  const landAreaSqm = linzAreaSqm ?? councilAreaSqm;
  const sourcesConfirmed = [
    ...(cvNzd ? ["cv_nzd (Whakatane District Council rating GIS)"] : []),
    ...(landAreaSqm ? [linzAreaSqm ? "land_area_sqm (from LINZ parcel)" : "land_area_sqm (Whakatane District Council rating GIS)"] : []),
  ];

  return {
    cv_nzd: cvNzd,
    cv_year: cvNzd ? WHAKATANE_REVALUATION_YEAR : null,
    build_year: null,
    floor_area_sqm: null,
    land_area_sqm: landAreaSqm,
    land_area_source: linzAreaSqm ? "linz" : "whakatane_council_rating_gis",
    land_area_scope: linzAreaSqm ? "parcel" : "rating_unit",
    property_type: null,
    sources_confirmed: sourcesConfirmed,
    sources_estimated: ["build_year", "floor_area_sqm", "property_type"],
  };
}
