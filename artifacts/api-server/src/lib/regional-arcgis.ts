import { logger } from "./logger";
import type { Overlay, ZoneResult } from "./auckland-council";
import type { ParcelBbox } from "./linz";
import {
  partialProviderZone,
  type PlanningProviderId,
  type RegionalJurisdiction,
} from "./regional-planning";

type ArcGisGeometryType = "point" | "polyline" | "polygon";

interface RegionalZoneLayer {
  serviceUrl: string;
  layerId: number;
  label: string;
  codeField?: string;
  nameFields: string[];
  detailFields?: string[];
}

interface RegionalOverlayLayer {
  serviceUrl: string;
  layerId: number;
  name: string;
  geometryType: ArcGisGeometryType;
  status: Overlay["status"];
  distanceM?: number;
  detailFields?: string[];
}

export interface RegionalSitePlanOverlayLayer {
  serviceUrl: string;
  layerId: number;
  name: string;
  geometryType: ArcGisGeometryType;
  status: Overlay["status"];
  distanceM?: number;
}

interface RegionalArcGisConfig {
  zoneLayers: RegionalZoneLayer[];
  overlayLayers: RegionalOverlayLayer[];
}

interface ArcGisLayerMetadata {
  fields?: Array<{
    name: string;
    alias?: string;
    domain?: {
      type?: string;
      codedValues?: Array<{ name: string; code: string | number }>;
    } | null;
  }>;
}

const HAMILTON_ZONING =
  "https://maps.hamilton.govt.nz/server/rest/services/agol_odp2017/DistrictPlan_Proposed_Decisions_2015_Zoning/MapServer";
const HAMILTON_FEATURES =
  "https://maps.hamilton.govt.nz/server/rest/services/agol_odp2017/DistrictPlan_Proposed_Decisions_2015_Features/MapServer";
const CHRISTCHURCH_DISTRICT_PLAN =
  "https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlan/FeatureServer";
const CHRISTCHURCH_DISTRICT_PLAN_B =
  "https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlanB/FeatureServer";
const WHANGAREI_DISTRICT_PLAN =
  "https://geo.wdc.govt.nz/server/rest/services/District_Plan_Public/MapServer";
const QLDC_PDP =
  "https://gis.qldc.govt.nz/server/rest/services/DistrictPlan/PDP_Stage_1_2_3_Decisions/MapServer";
const DUNEDIN_DISTRICT_PLAN =
  "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/District_Plan/MapServer";

const CONFIGS: Partial<Record<PlanningProviderId, RegionalArcGisConfig>> = {
  hamilton: {
    zoneLayers: [
      {
        serviceUrl: HAMILTON_ZONING,
        layerId: 32,
        label: "Hamilton District Plan Zoning",
        codeField: "Zoning_Text",
        nameFields: ["Zone_Description", "Zoning_Text"],
        detailFields: ["SubZone_Text", "Activities_Text"],
      },
    ],
    overlayLayers: [
      overlay(HAMILTON_FEATURES, 0, "Built Heritage", "point", "restricted", 15, ["NAME", "ID"]),
      overlay(HAMILTON_FEATURES, 2, "Designation", "polygon", "control", undefined, ["Name", "ReferenceNo", "Facility", "Purpose"]),
      overlay(HAMILTON_FEATURES, 196, "Significant Archaeological Sites", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 3, "Significant Natural Areas", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 155, "Peacocke Significant Bat Habitat Area", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 156, "Significant Trees", "point", "moderate", 30),
      overlay(HAMILTON_FEATURES, 180, "Vector Gas Pipeline Corridor", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 16, "Electricity Transmission Corridors", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 185, "Culvert Block Flood Hazard Area", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 186, "Temple View Flood Hazard Area", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 188, "Waikato River Flood Hazard Area", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 189, "Waikato River Flood Hazard Area", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 190, "Waikato River Flood Hazard Area", "polygon", "restricted"),
      overlay(HAMILTON_FEATURES, 192, "Overland Flowpath/Ponding Flood Hazard Area", "polygon", "moderate"),
      overlay(HAMILTON_FEATURES, 193, "Overland Flowpath/Ponding Flood Hazard Area", "polygon", "moderate"),
      overlay(HAMILTON_FEATURES, 194, "Overland Flowpath/Ponding Flood Hazard Area", "polygon", "moderate"),
      overlay(HAMILTON_FEATURES, 195, "Waikato Riverbank and Gully Hazard Area", "polygon", "restricted"),
    ],
  },
  christchurch: {
    zoneLayers: [
      {
        serviceUrl: CHRISTCHURCH_DISTRICT_PLAN,
        layerId: 78,
        label: "Christchurch District Plan Zone",
        codeField: "Code",
        nameFields: ["Type", "TypeGroup", "Code"],
        detailFields: ["LegalStatus", "ScheduleReference"],
      },
    ],
    overlayLayers: [
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 0, "Heritage Area", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 5, "Airport Noise", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 16, "Cultural Significance", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 19, "Ecological Significance", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 25, "High Flood Hazard", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 27, "Flood Ponding", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 29, "High Flood Hazard Overlay", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 30, "Flood Management Area", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 31, "Heritage Item", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 32, "Heritage Setting", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 34, "CBD Building Height Restriction", "polygon", "control"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 38, "Amenity Tree Restriction Area", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 54, "Tree Protection", "point", "moderate", 30),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 62, "Protected Vegetation", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 69, "Slope Hazard", "polygon", "restricted"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 79, "Tsunami Inundation", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 80, "Noise Insulation", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN_B, 85, "Water Body Setback", "polygon", "moderate"),
      overlay(CHRISTCHURCH_DISTRICT_PLAN, 42, "Residential Density / Qualifying Matter", "polygon", "moderate", undefined, ["Category", "Location", "ScheduleReference"]),
    ],
  },
  whangarei: {
    zoneLayers: [
      zone(WHANGAREI_DISTRICT_PLAN, 65, "Whangarei Residential Zone", "ZONE", ["ZONE", "ePlanDisplayField"]),
      zone(WHANGAREI_DISTRICT_PLAN, 66, "Whangarei Rural Zone", "ZONE", ["ZONE", "ePlanDisplayField"]),
      zone(WHANGAREI_DISTRICT_PLAN, 67, "Whangarei Commercial/Mixed Use Zone", "ZONE", ["ZONE", "ePlanDisplayField"]),
      zone(WHANGAREI_DISTRICT_PLAN, 68, "Whangarei Industrial Zone", "ZONE", ["ZONE", "ePlanDisplayField"]),
      zone(WHANGAREI_DISTRICT_PLAN, 61, "Whangarei Open Space/Recreation Zone", "ZONE", ["ZONE", "ePlanDisplayField"]),
      zone(WHANGAREI_DISTRICT_PLAN, 70, "Whangarei Special Purpose Zone", "ZONE", ["ZONE", "ePlanDisplayField"]),
    ],
    overlayLayers: [
      overlay(WHANGAREI_DISTRICT_PLAN, 10, "Designation", "polygon", "control"),
      overlay(WHANGAREI_DISTRICT_PLAN, 77, "Flood Susceptible Area", "polygon", "restricted"),
      overlay(WHANGAREI_DISTRICT_PLAN, 30, "Notable Tree Overlay", "point", "moderate", 30),
      overlay(WHANGAREI_DISTRICT_PLAN, 31, "Heritage Item Overlay", "point", "restricted", 20),
      overlay(WHANGAREI_DISTRICT_PLAN, 32, "Heritage Area Overlay", "polygon", "restricted"),
      overlay(WHANGAREI_DISTRICT_PLAN, 34, "Area of Significance to Maori", "polygon", "restricted"),
      overlay(WHANGAREI_DISTRICT_PLAN, 44, "Outstanding Natural Feature", "polygon", "restricted"),
      overlay(WHANGAREI_DISTRICT_PLAN, 45, "Outstanding Natural Landscape", "polygon", "restricted"),
      overlay(WHANGAREI_DISTRICT_PLAN, 50, "Air Noise Boundary", "polygon", "moderate"),
      overlay(WHANGAREI_DISTRICT_PLAN, 51, "Outer Control Boundary", "polygon", "moderate"),
      overlay(WHANGAREI_DISTRICT_PLAN, 59, "Coastal Environment Overlay", "polygon", "moderate"),
      overlay(WHANGAREI_DISTRICT_PLAN, 60, "Natural Character Area", "polygon", "restricted"),
    ],
  },
  qldc: {
    zoneLayers: [
      {
        serviceUrl: QLDC_PDP,
        layerId: 18,
        label: "QLDC Proposed District Plan Zone",
        codeField: "Zone",
        nameFields: ["Zone", "Label"],
        detailFields: ["Stage"],
      },
    ],
    overlayLayers: [
      overlay(QLDC_PDP, 13, "Overlay Points", "point", "moderate", 30),
      overlay(QLDC_PDP, 15, "Heritage Protection Order", "polygon", "restricted"),
      overlay(QLDC_PDP, 16, "Archaeological Site", "polygon", "restricted"),
      overlay(QLDC_PDP, 20, "Overlay Polygon", "polygon", "moderate", undefined, ["Label", "Decription", "Value", "Location"]),
      overlay(QLDC_PDP, 21, "Specific Control", "polygon", "control", undefined, ["ControlType", "Label", "Description"]),
      overlay(QLDC_PDP, 22, "Designation", "polygon", "control"),
      overlay(QLDC_PDP, 23, "Development Area", "polygon", "control", undefined, ["DevelopmentArea", "Label", "Description"]),
    ],
  },
  dunedin: {
    zoneLayers: [
      {
        serviceUrl: DUNEDIN_DISTRICT_PLAN,
        layerId: 110,
        label: "Dunedin District Plan Zone",
        codeField: "LABEL",
        nameFields: ["SUBZONE", "DP_ZONE", "LABEL"],
        detailFields: ["URBAN", "NAME"],
      },
    ],
    overlayLayers: [
      overlay(DUNEDIN_DISTRICT_PLAN, 83, "Significant Tree", "point", "moderate", 30),
      overlay(DUNEDIN_DISTRICT_PLAN, 84, "Heritage Structure", "point", "restricted", 20),
      overlay(DUNEDIN_DISTRICT_PLAN, 90, "Groundwater Protection Zone", "polygon", "moderate"),
      overlay(DUNEDIN_DISTRICT_PLAN, 91, "Urban Landscape Conservation Area", "polygon", "restricted"),
      overlay(DUNEDIN_DISTRICT_PLAN, 95, "Townscape and Heritage Precinct Area", "polygon", "restricted"),
      overlay(DUNEDIN_DISTRICT_PLAN, 100, "Area of Significant Conservation Value", "point", "restricted", 30),
      overlay(DUNEDIN_DISTRICT_PLAN, 101, "Area of Significant Conservation Value", "polyline", "restricted", 30),
      overlay(DUNEDIN_DISTRICT_PLAN, 102, "Archaeological Site", "point", "restricted", 30),
      overlay(DUNEDIN_DISTRICT_PLAN, 103, "Designation", "polygon", "control"),
      overlay(DUNEDIN_DISTRICT_PLAN, 104, "Port Height Restriction", "polygon", "control"),
    ],
  },
};

const metadataCache = new Map<string, Promise<ArcGisLayerMetadata>>();

function zone(
  serviceUrl: string,
  layerId: number,
  label: string,
  codeField: string,
  nameFields: string[],
  detailFields: string[] = [],
): RegionalZoneLayer {
  return { serviceUrl, layerId, label, codeField, nameFields, detailFields };
}

function overlay(
  serviceUrl: string,
  layerId: number,
  name: string,
  geometryType: ArcGisGeometryType,
  status: Overlay["status"],
  distanceM?: number,
  detailFields?: string[],
): RegionalOverlayLayer {
  return { serviceUrl, layerId, name, geometryType, status, distanceM, detailFields };
}

function layerUrl(layer: { serviceUrl: string; layerId: number }): string {
  return `${layer.serviceUrl}/${layer.layerId}`;
}

async function fetchLayerMetadata(layer: { serviceUrl: string; layerId: number }): Promise<ArcGisLayerMetadata> {
  const url = `${layerUrl(layer)}?f=pjson`;
  let task = metadataCache.get(url);
  if (!task) {
    task = fetch(url, { signal: AbortSignal.timeout(8000) })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`ArcGIS metadata HTTP ${resp.status}`);
        return await resp.json() as ArcGisLayerMetadata;
      });
    metadataCache.set(url, task);
  }
  return task;
}

function decodeCodedValue(metadata: ArcGisLayerMetadata, fieldName: string | undefined, value: unknown): string | null {
  if (!fieldName || value == null) return null;
  const field = metadata.fields?.find((candidate) => candidate.name === fieldName);
  const coded = field?.domain?.codedValues?.find((candidate) => String(candidate.code) === String(value));
  return coded?.name ? String(coded.name) : null;
}

function stringifyValue(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null") return null;
  return text;
}

function firstText(attrs: Record<string, unknown>, fields: string[]): string | null {
  for (const field of fields) {
    const text = stringifyValue(attrs[field]);
    if (text) return text;
  }
  return null;
}

function uniqueTexts(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function detailFromAttributes(
  attrs: Record<string, unknown>,
  fields: string[] | undefined,
  fallbackFields = ["NAME", "Name", "LABEL", "Label", "TYPE", "Type", "ZONE", "Zone", "Code", "Description"],
): string | null {
  const candidates = uniqueTexts([...(fields ?? []), ...fallbackFields].map((field) => stringifyValue(attrs[field])));
  return candidates.slice(0, 4).join(" - ") || null;
}

function geometryParams(url: URL, lat: number, lng: number, parcelBbox?: ParcelBbox | null): void {
  if (parcelBbox?.polygon && parcelBbox.polygon.length >= 3) {
    const ring = [...parcelBbox.polygon];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
      ring.push(first);
    }
    url.searchParams.set("geometry", JSON.stringify({
      rings: [ring],
      spatialReference: { wkid: 4326 },
    }));
    url.searchParams.set("geometryType", "esriGeometryPolygon");
    return;
  }

  url.searchParams.set("geometry", `${lng},${lat}`);
  url.searchParams.set("geometryType", "esriGeometryPoint");
}

async function queryArcGisAttributes(
  layer: { serviceUrl: string; layerId: number },
  lat: number,
  lng: number,
  options: {
    parcelBbox?: ParcelBbox | null;
    distanceM?: number;
    timeoutMs?: number;
  } = {},
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${layerUrl(layer)}/query`);
  geometryParams(url, lat, lng, options.parcelBbox ?? null);
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("f", "json");
  if (options.distanceM != null && !options.parcelBbox) {
    url.searchParams.set("distance", String(options.distanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(options.timeoutMs ?? 9000) });
  if (!resp.ok) throw new Error(`ArcGIS query HTTP ${resp.status}`);

  const data = await resp.json() as {
    features?: Array<{ attributes?: Record<string, unknown> }>;
    error?: { message?: string };
  };
  if (data.error) throw new Error(`ArcGIS query error: ${data.error.message ?? "unknown"}`);

  return (data.features ?? [])
    .map((feature) => feature.attributes)
    .filter((attrs): attrs is Record<string, unknown> => Boolean(attrs));
}

function configFor(providerId: PlanningProviderId): RegionalArcGisConfig | null {
  return CONFIGS[providerId] ?? null;
}

export function configuredRegionalProviderIds(): PlanningProviderId[] {
  return Object.keys(CONFIGS) as PlanningProviderId[];
}

export async function fetchRegionalPlanningZone(
  jurisdiction: RegionalJurisdiction,
  lat: number,
  lng: number,
): Promise<ZoneResult> {
  const config = configFor(jurisdiction.providerId);
  if (!config) return partialProviderZone(jurisdiction);

  for (const layer of config.zoneLayers) {
    try {
      const features = await queryArcGisAttributes(layer, lat, lng);
      const attrs = features[0];
      if (!attrs) continue;

      const metadata = await fetchLayerMetadata(layer).catch(() => ({}));
      const rawCode = stringifyValue(layer.codeField ? attrs[layer.codeField] : null);
      const decoded = decodeCodedValue(metadata, layer.codeField, layer.codeField ? attrs[layer.codeField] : null);
      const name = decoded ?? firstText(attrs, layer.nameFields);
      const details = uniqueTexts([
        detailFromAttributes(attrs, layer.detailFields, []),
        layer.label,
        rawCode && decoded && rawCode !== decoded ? `code ${rawCode}` : null,
      ]);

      return {
        zone_code: rawCode ?? name ?? "REGIONAL",
        zone_description: uniqueTexts([name, ...details]).join(" - ") || `${jurisdiction.providerName} zone`,
        min_lot_size_sqm: null,
        raw_zone: JSON.stringify(attrs),
      };
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, providerId: jurisdiction.providerId, layerId: layer.layerId },
        "Regional planning zone query failed",
      );
    }
  }

  return partialProviderZone(jurisdiction);
}

export async function fetchRegionalPlanningOverlays(
  jurisdiction: RegionalJurisdiction,
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
): Promise<Overlay[]> {
  const config = configFor(jurisdiction.providerId);
  if (!config) return [];

  const settled = await Promise.allSettled(
    config.overlayLayers.map(async (layer): Promise<Overlay | null> => {
      const distanceM = layer.distanceM ?? (layer.geometryType === "polygon" ? undefined : 25);
      const features = await queryArcGisAttributes(layer, lat, lng, {
        parcelBbox: layer.geometryType === "polygon" ? parcelBbox : null,
        distanceM,
        timeoutMs: 8000,
      });
      const attrs = features[0];
      if (!attrs) return null;
      const detail = detailFromAttributes(attrs, layer.detailFields);
      return {
        name: layer.name,
        status: layer.status,
        detail: detail
          ? `${layer.name} applies - ${detail}. Confirm implications in the local district plan.`
          : `${layer.name} applies. Confirm implications in the local district plan.`,
      };
    }),
  );

  const overlays: Overlay[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status === "rejected") {
      logger.debug({ err: (result.reason as Error)?.message }, "Regional planning overlay query failed");
      continue;
    }
    if (!result.value || seen.has(result.value.name)) continue;
    seen.add(result.value.name);
    overlays.push(result.value);
  }
  return overlays;
}

export function regionalPlanningSmokeTargets(): Array<{
  providerId: PlanningProviderId;
  kind: "zone" | "overlay";
  serviceUrl: string;
  layerId: number;
  label: string;
}> {
  return Object.entries(CONFIGS).flatMap(([providerId, config]) => [
    ...config.zoneLayers.map((layer) => ({
      providerId: providerId as PlanningProviderId,
      kind: "zone" as const,
      serviceUrl: layer.serviceUrl,
      layerId: layer.layerId,
      label: layer.label,
    })),
    ...config.overlayLayers.map((layer) => ({
      providerId: providerId as PlanningProviderId,
      kind: "overlay" as const,
      serviceUrl: layer.serviceUrl,
      layerId: layer.layerId,
      label: layer.name,
    })),
  ]);
}

export function regionalSitePlanOverlayLayers(providerId: PlanningProviderId): RegionalSitePlanOverlayLayer[] {
  const config = configFor(providerId);
  return (config?.overlayLayers ?? []).map((layer) => ({
    serviceUrl: layer.serviceUrl,
    layerId: layer.layerId,
    name: layer.name,
    geometryType: layer.geometryType,
    status: layer.status,
    distanceM: layer.distanceM,
  }));
}
