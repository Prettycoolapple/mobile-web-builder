import type { Overlay, ZoneResult, ContourResult } from "./auckland-council";
import type { ParcelBbox } from "./linz";
import type { InfrastructureFetchOptions, InfrastructureItem } from "./infrastructure";
import type { PropertyHistory } from "./property-data";

export type CoverageStatus = "full" | "partial" | "unsupported";

export type PlanningProviderId =
  | "auckland-legacy"
  | "hamilton"
  | "christchurch"
  | "canterbury"
  | "nelson"
  | "whangarei"
  | "qldc"
  | "wellington"
  | "dunedin"
  | "rotorua"
  | "whakatane"
  | "unsupported";

export interface ProviderEndpointRef {
  label: string;
  url: string;
  notes?: string;
}

export interface RegionalJurisdiction {
  providerId: PlanningProviderId;
  providerName: string;
  territorialAuthority: string | null;
  region: string | null;
  coverageStatus: CoverageStatus;
  planName: string | null;
  endpointRefs: ProviderEndpointRef[];
  reason: string;
}

export interface PlanningProviderResult<T> {
  provider: RegionalJurisdiction;
  coverageStatus: CoverageStatus;
  value: T;
  warnings?: string[];
}

export interface PlanningProviderContext {
  address?: string | null;
  lat: number;
  lng: number;
  parcelBbox?: ParcelBbox | null;
  targetParcelId?: string | null;
  zoneCode?: string | null;
  landAreaSqm?: number | null;
}

export interface PlanningProvider {
  id: PlanningProviderId;
  name: string;
  territorialAuthority: string | null;
  region: string | null;
  coverageStatus: CoverageStatus;
  planName: string | null;
  endpointRefs: ProviderEndpointRef[];
  supports: (context: PlanningProviderContext) => boolean;
  fetchZone?: (context: PlanningProviderContext) => Promise<PlanningProviderResult<ZoneResult | null>>;
  fetchOverlays?: (context: PlanningProviderContext) => Promise<PlanningProviderResult<Overlay[]>>;
  fetchTerrain?: (context: PlanningProviderContext) => Promise<PlanningProviderResult<ContourResult | null>>;
  fetchInfrastructure?: (
    context: PlanningProviderContext,
    options?: InfrastructureFetchOptions,
  ) => Promise<PlanningProviderResult<InfrastructureItem[]>>;
  fetchPropertyHistory?: (context: PlanningProviderContext) => Promise<PlanningProviderResult<PropertyHistory | null>>;
}

export interface PlanningProviderMetadata {
  providerId: PlanningProviderId;
  providerName: string;
  territorialAuthority: string | null;
  region: string | null;
  coverageStatus: CoverageStatus;
  planName: string | null;
  endpointRefs: ProviderEndpointRef[];
  reason: string;
}

type Bounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

function flagEnabled(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function regionalPlanningProvidersEnabled(): boolean {
  const raw = process.env["ENABLE_REGIONAL_PLANNING_PROVIDERS"];
  const v = raw?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return raw == null || raw.trim() === "" ? true : flagEnabled(raw);
}

function normaliseAddress(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function addressHas(context: PlanningProviderContext, patterns: RegExp[]): boolean {
  const address = normaliseAddress(context.address);
  return patterns.some((pattern) => pattern.test(address));
}

function inBounds(context: PlanningProviderContext, bounds: Bounds): boolean {
  return (
    Number.isFinite(context.lat) &&
    Number.isFinite(context.lng) &&
    context.lat >= bounds.minLat &&
    context.lat <= bounds.maxLat &&
    context.lng >= bounds.minLng &&
    context.lng <= bounds.maxLng
  );
}

function supportsAny(context: PlanningProviderContext, bounds: Bounds, patterns: RegExp[]): boolean {
  return inBounds(context, bounds) || addressHas(context, patterns);
}

function provider(
  id: PlanningProviderId,
  name: string,
  territorialAuthority: string | null,
  region: string | null,
  coverageStatus: CoverageStatus,
  planName: string | null,
  endpointRefs: ProviderEndpointRef[],
  supports: (context: PlanningProviderContext) => boolean,
): PlanningProvider {
  return {
    id,
    name,
    territorialAuthority,
    region,
    coverageStatus,
    planName,
    endpointRefs,
    supports,
  };
}

const AUCKLAND_BOUNDS: Bounds = { minLat: -37.35, maxLat: -36.05, minLng: 174.0, maxLng: 175.55 };
const HAMILTON_BOUNDS: Bounds = { minLat: -37.95, maxLat: -37.62, minLng: 175.08, maxLng: 175.43 };
const CHRISTCHURCH_BOUNDS: Bounds = { minLat: -43.75, maxLat: -43.35, minLng: 172.35, maxLng: 173.05 };
const CANTERBURY_BOUNDS: Bounds = { minLat: -44.95, maxLat: -42.0, minLng: 169.9, maxLng: 174.6 };
const NELSON_BOUNDS: Bounds = { minLat: -41.45, maxLat: -41.15, minLng: 173.05, maxLng: 173.45 };
const WHANGAREI_BOUNDS: Bounds = { minLat: -36.05, maxLat: -35.35, minLng: 173.6, maxLng: 174.75 };
const QLDC_BOUNDS: Bounds = { minLat: -45.4, maxLat: -44.25, minLng: 168.0, maxLng: 170.05 };
// Whole Wellington region urban footprint: Kāpiti (north) down through Porirua,
// Wellington City, and the Hutt Valley. Wairarapa territorial authorities are
// intentionally excluded (no provider coverage yet).
const WELLINGTON_BOUNDS: Bounds = { minLat: -41.45, maxLat: -40.70, minLng: 174.60, maxLng: 175.35 };
const DUNEDIN_BOUNDS: Bounds = { minLat: -46.15, maxLat: -45.55, minLng: 169.95, maxLng: 171.15 };
const ROTORUA_BOUNDS: Bounds = { minLat: -38.45, maxLat: -37.85, minLng: 175.85, maxLng: 176.55 };
const WHAKATANE_BOUNDS: Bounds = { minLat: -38.35, maxLat: -37.70, minLng: 176.55, maxLng: 177.40 };

const providerRegistry: PlanningProvider[] = [
  provider(
    "auckland-legacy",
    "Auckland Council legacy GIS",
    "Auckland Council",
    "Auckland",
    "full",
    "Auckland Unitary Plan",
    [
      { label: "Auckland Unitary Plan Zones", url: "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/UnitaryPlanZones/MapServer" },
      { label: "Auckland Unitary Plan Management Layers", url: "https://mapspublic.aucklandcouncil.govt.nz/arcgis3/rest/services/NonCouncil/UnitaryPlanManagementLayers/MapServer" },
      { label: "Auckland Underground Services", url: "https://mapspublic.aucklandcouncil.govt.nz/arcgis/rest/services/LiveMaps/UndergroundServices/MapServer" },
    ],
    (context) => supportsAny(context, AUCKLAND_BOUNDS, [/\bauckland\b/, /\btamaki makaurau\b/]),
  ),
  provider(
    "hamilton",
    "Hamilton City Council planning provider",
    "Hamilton City Council",
    "Waikato",
    "partial",
    "Hamilton City Operative District Plan",
    [
      { label: "Hamilton District Plan Zoning", url: "https://maps.hamilton.govt.nz/server/rest/services/agol_odp2017/DistrictPlan_Proposed_Decisions_2015_Zoning/MapServer" },
      { label: "Hamilton District Plan Features", url: "https://maps.hamilton.govt.nz/server/rest/services/agol_odp2017/DistrictPlan_Proposed_Decisions_2015_Features/MapServer" },
      { label: "Hamilton Freshwater Dataset", url: "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Freshwater Dataset - Hamilton City Council/FeatureServer" },
      { label: "Hamilton Wastewater Dataset", url: "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Wastewater Dataset - Hamilton City Council/FeatureServer" },
      { label: "Hamilton Stormwater Dataset", url: "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Stormwater Dataset - Hamilton City Council/FeatureServer" },
      { label: "Waikato Open Data Hub", url: "https://data-waikatolass.opendata.arcgis.com/" },
    ],
    (context) => supportsAny(context, HAMILTON_BOUNDS, [/\bhamilton\b/, /\bkirikiriroa\b/]),
  ),
  provider(
    "christchurch",
    "Christchurch City Council planning provider",
    "Christchurch City Council",
    "Canterbury",
    "partial",
    "Christchurch District Plan",
    [
      { label: "Christchurch DistrictPlanB", url: "https://gis.ccc.govt.nz/server/rest/services/OpenData/DistrictPlanB/FeatureServer" },
      { label: "Christchurch Spatial Open Data", url: "https://opendata-christchurchcity.hub.arcgis.com/" },
    ],
    (context) => supportsAny(context, CHRISTCHURCH_BOUNDS, [/\bchristchurch\b/, /\botautahi\b/]),
  ),
  provider(
    "canterbury",
    "Canterbury Maps planning provider",
    null,
    "Canterbury",
    "partial",
    "Canterbury district and regional planning layers",
    [
      { label: "Environment Canterbury Planning Zones", url: "https://gis.ecan.govt.nz/arcgis/rest/services/Public/PlanningZones/MapServer" },
      { label: "Environment Canterbury Land and Property", url: "https://gis.ecan.govt.nz/arcgis/rest/services/Public/Property/MapServer" },
      { label: "Canterbury Three Waters Data", url: "https://services1.arcgis.com/RNxkQaMWQcgbiF98/arcgis/rest/services/Canterbury_Three_Waters_Data_2_view/FeatureServer" },
    ],
    (context) =>
      supportsAny(context, CANTERBURY_BOUNDS, [
        /\bcanterbury\b/,
        /\bselwyn\b/,
        /\bwaimakariri\b/,
        /\brangiora\b/,
        /\bkaiapoi\b/,
        /\bashburton\b/,
        /\btimaru\b/,
      ]),
  ),
  provider(
    "nelson",
    "Nelson City Council planning provider",
    "Nelson City Council",
    "Nelson",
    "partial",
    "Nelson Resource Management Plan",
    [
      { label: "Top of the South Planning and Services", url: "https://www.topofthesouthmaps.co.nz/ArcGIS/rest/services/TopoftheSouthMaps/MapServer" },
    ],
    (context) =>
      supportsAny(context, NELSON_BOUNDS, [
        /\bnelson\b/,
        /\bstoke\b/,
        /\bmonaco\b/,
        /\btahunanui\b/,
        /\btahuna\b/,
        /\bthe wood\b/,
        /\battersea\b/,
        /\bmaitai\b/,
        /\brichmond\b/,
      ]),
  ),
  provider(
    "whangarei",
    "Whangarei District Council planning provider",
    "Whangarei District Council",
    "Northland",
    "partial",
    "Whangarei District Plan",
    [
      { label: "Whangarei District Plan Public", url: "https://geo.wdc.govt.nz/server/rest/services/District_Plan_Public/MapServer" },
      { label: "Whangarei Water Public", url: "https://geo.wdc.govt.nz/server/rest/services/Water_Public/FeatureServer" },
      { label: "Whangarei Wastewater Public", url: "https://geo.wdc.govt.nz/server/rest/services/Wastewater_Public/FeatureServer" },
      { label: "Whangarei Stormwater Public", url: "https://geo.wdc.govt.nz/server/rest/services/Stormwater_Public/FeatureServer" },
    ],
    (context) => supportsAny(context, WHANGAREI_BOUNDS, [/\bwhangarei\b/, /\bwhangarei\b/, /\bwhangarei\b/]),
  ),
  provider(
    "qldc",
    "Queenstown Lakes District Council planning provider",
    "Queenstown Lakes District Council",
    "Otago",
    "partial",
    "Queenstown Lakes District Plan",
    [
      { label: "QLDC Operative District Plan", url: "https://gis.qldc.govt.nz/server/rest/services/DistrictPlan/Operative_District_Plan/FeatureServer" },
      { label: "QLDC PDP Stage 1-3 Decisions", url: "https://gis.qldc.govt.nz/server/rest/services/DistrictPlan/PDP_Stage_1_2_3_Decisions/MapServer" },
      { label: "QLDC Three Waters", url: "https://gis.qldc.govt.nz/server/rest/services/ThreeWaters/Three_Waters/FeatureServer" },
    ],
    (context) =>
      supportsAny(context, QLDC_BOUNDS, [
        /\bqueenstown\b/,
        /\bwanaka\b/,
        /\bwanaka\b/,
        /\barrowtown\b/,
        /\bfrankton\b/,
        /\bqueenstown lakes\b/,
      ]),
  ),
  provider(
    "wellington",
    "Wellington region planning provider",
    null,
    "Wellington",
    "partial",
    "Wellington region district plans (Wellington City, Hutt City, Upper Hutt, Porirua, Kāpiti Coast)",
    [
      { label: "Wellington City District Plan", url: "https://gis.wcc.govt.nz/arcgis/rest/services/DistrictPlan/DistrictPlan/MapServer" },
      { label: "Hutt City District Plan", url: "https://maps.huttcity.govt.nz/server02/rest/services/Essentials/HCC_District_Plan/MapServer" },
      { label: "Upper Hutt District Plan Zones", url: "https://maps.upperhutt.govt.nz/arcgis/rest/services/District_Plan_Zones/MapServer" },
      { label: "Kāpiti Coast District Plan Zones", url: "https://maps.kapiticoast.govt.nz/server/rest/services/Public/District_Plan_Zones/MapServer" },
      { label: "Wellington Water regional three waters", url: "https://gis.wellingtonwater.co.nz/server1/rest/services/Councils/All_Councils_3_Waters_Asset_Data/MapServer" },
    ],
    (context) =>
      supportsAny(context, WELLINGTON_BOUNDS, [
        /\bwellington\b/,
        /\bte whanganui[- ]a[- ]tara\b/,
        /\blower hutt\b/,
        /\bupper hutt\b/,
        /\bhutt city\b/,
        /\bpetone\b/,
        /\bwainuiomata\b/,
        /\bporirua\b/,
        /\bwhitby\b/,
        /\bparemata\b/,
        /\btitahi bay\b/,
        /\bkapiti\b/,
        /\bparaparaumu\b/,
        /\bwaikanae\b/,
        /\botaki\b/,
        /\btawa\b/,
        /\bjohnsonville\b/,
        /\bkarori\b/,
        /\bmiramar\b/,
        /\bnewlands\b/,
      ]),
  ),
  provider(
    "dunedin",
    "Dunedin City Council planning provider",
    "Dunedin City Council",
    "Otago",
    "partial",
    "Second Generation Dunedin City District Plan",
    [
      { label: "Dunedin District Plan", url: "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/District_Plan/MapServer" },
      { label: "Dunedin Water", url: "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Water/FeatureServer" },
      { label: "Dunedin Stormwater", url: "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Stormwater/FeatureServer" },
      { label: "Dunedin CityCare Utilities", url: "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/CityCare/MapServer" },
    ],
    (context) => supportsAny(context, DUNEDIN_BOUNDS, [/\bdunedin\b/, /\botepoti\b/, /\bmosgiel\b/]),
  ),
  provider(
    "whakatane",
    "Whakatane District Council planning provider",
    "Whakatane District Council",
    "Bay of Plenty",
    "partial",
    "Whakatane District Plan",
    [
      { label: "Whakatane District Plan NPS ePlan", url: "https://gis.whakatane.govt.nz/arcgis/rest/services/Planning/OperativeDistrictPlanNPS_ePlan/MapServer" },
      { label: "Whakatane Stormwater Assets", url: "https://gis.whakatane.govt.nz/arcgis/rest/services/ThreeWaters/StormWaterAssets/MapServer" },
      { label: "Whakatane Wastewater Assets", url: "https://gis.whakatane.govt.nz/arcgis/rest/services/ThreeWaters/WasteWaterAssets/MapServer" },
      { label: "Whakatane Water Supply Assets", url: "https://gis.whakatane.govt.nz/arcgis/rest/services/ThreeWaters/WaterSupplyAssets/MapServer" },
    ],
    (context) => supportsAny(context, WHAKATANE_BOUNDS, [
      /\bwhakatane\b/,
      /\brotoma\b/,
      /\bmatata\b/,
      /\bedgecumbe\b/,
      /\bohope\b/,
      /\btaneatua\b/,
    ]),
  ),
  provider(
    "rotorua",
    "Rotorua Lakes Council planning provider",
    "Rotorua Lakes Council",
    "Bay of Plenty",
    "partial",
    "Rotorua District Plan",
    [
      { label: "Rotorua District Plan", url: "https://gis.rdc.govt.nz/server/rest/services/Core/DistrictPlan/MapServer" },
      { label: "Rotorua Planning and Development", url: "https://gis.rdc.govt.nz/server/rest/services/Core/Planning_and_Development/MapServer" },
      { label: "Rotorua Three Waters", url: "https://gis.rdc.govt.nz/server/rest/services/Asset/3_Waters/MapServer" },
    ],
    (context) => supportsAny(context, ROTORUA_BOUNDS, [
      /\brotorua\b/,
      /\bkoutu\b/,
      /\bngongotaha\b/,
      /\bmamaku\b/,
      /\bokareka\b/,
      /\breporoa\b/,
    ]),
  ),
  provider(
    "unsupported",
    "Unsupported regional planning provider",
    null,
    null,
    "unsupported",
    null,
    [],
    () => true,
  ),
];

export function allPlanningProviders(): PlanningProvider[] {
  return [...providerRegistry];
}

export function getPlanningProvider(id: PlanningProviderId): PlanningProvider {
  return providerRegistry.find((provider) => provider.id === id) ?? providerRegistry[providerRegistry.length - 1]!;
}

export function resolvePlanningJurisdiction(context: PlanningProviderContext): RegionalJurisdiction {
  const matched = providerRegistry.find((provider) => provider.id !== "unsupported" && provider.supports(context))
    ?? getPlanningProvider("unsupported");

  return {
    providerId: matched.id,
    providerName: matched.name,
    territorialAuthority: matched.territorialAuthority,
    region: matched.region,
    coverageStatus: matched.coverageStatus,
    planName: matched.planName,
    endpointRefs: matched.endpointRefs,
    reason: matched.id === "unsupported"
      ? "No regional provider matched the address or conservative coordinate bounds."
      : "Matched by conservative coordinate bounds or address hint.",
  };
}

export function planningProviderMetadata(context: PlanningProviderContext): PlanningProviderMetadata | null {
  if (!regionalPlanningProvidersEnabled()) return null;
  const jurisdiction = resolvePlanningJurisdiction(context);
  return {
    providerId: jurisdiction.providerId,
    providerName: jurisdiction.providerName,
    territorialAuthority: jurisdiction.territorialAuthority,
    region: jurisdiction.region,
    coverageStatus: jurisdiction.coverageStatus,
    planName: jurisdiction.planName,
    endpointRefs: jurisdiction.endpointRefs,
    reason: jurisdiction.reason,
  };
}

export function shouldSuppressAucklandPlanningRules(
  providerMetadata: Pick<PlanningProviderMetadata, "providerId"> | null | undefined,
): boolean {
  return Boolean(providerMetadata && providerMetadata.providerId !== "auckland-legacy");
}

export function emptyPropertyHistory(linzAreaSqm?: number | null): PropertyHistory {
  return {
    cv_nzd: null,
    cv_year: null,
    build_year: null,
    floor_area_sqm: null,
    land_area_sqm: linzAreaSqm ?? null,
    property_type: null,
    sources_confirmed: linzAreaSqm ? ["land_area_sqm (from LINZ parcel)"] : [],
    sources_estimated: [
      "cv_nzd",
      "build_year",
      "floor_area_sqm",
      ...(linzAreaSqm ? [] : ["land_area_sqm"]),
    ],
  };
}

export function partialProviderZone(jurisdiction: RegionalJurisdiction): ZoneResult {
  return {
    zone_code: "UNKNOWN",
    zone_description:
      jurisdiction.coverageStatus === "unsupported"
        ? "Unknown - no regional planning provider is enabled for this address."
        : `${jurisdiction.providerName} selected (${jurisdiction.coverageStatus} coverage). Local zone layer mapping is not enabled yet.`,
    min_lot_size_sqm: null,
    raw_zone: null,
  };
}

export function planningProviderSmokeTargets(): Array<{
  providerId: PlanningProviderId;
  providerName: string;
  endpoint: ProviderEndpointRef;
}> {
  return providerRegistry.flatMap((provider) =>
    provider.endpointRefs.map((endpoint) => ({
      providerId: provider.id,
      providerName: provider.name,
      endpoint,
    })),
  );
}
