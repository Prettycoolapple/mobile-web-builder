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
  // Some council layers split zoning into one polygon layer per zone class
  // with no attribute that names the zone (e.g. Matamata-Piako's
  // District_Plan_Zones service). staticZoneCode/staticZoneName let the layer
  // itself carry the zone identity as a fallback when no attribute-derived
  // code/name is available.
  staticZoneCode?: string;
  staticZoneName?: string;
  /** False when the configured code field already contains its display name. */
  decodeCodedValues?: boolean;
}

interface RegionalOverlayLayer {
  serviceUrl: string;
  layerId: number;
  name: string;
  geometryType: ArcGisGeometryType;
  status: Overlay["status"];
  distanceM?: number;
  detailFields?: string[];
  where?: string;
}

export interface RegionalSitePlanOverlayLayer {
  serviceUrl: string;
  layerId: number;
  name: string;
  geometryType: ArcGisGeometryType;
  status: Overlay["status"];
  distanceM?: number;
  where?: string;
}

interface RegionalArcGisConfig {
  zoneLayers: RegionalZoneLayer[];
  overlayLayers: RegionalOverlayLayer[];
  /** Council-specific allowance for slow server-to-server ArcGIS responses. */
  queryTimeoutMs?: number;
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
const TOP_OF_THE_SOUTH_MAPS =
  "https://www.topofthesouthmaps.co.nz/ArcGIS/rest/services/TopoftheSouthMaps/MapServer";
const QLDC_PDP =
  "https://gis.qldc.govt.nz/server/rest/services/DistrictPlan/PDP_Stage_1_2_3_Decisions/MapServer";
const WAIRARAPA_ZONES =
  "https://gis.mstn.govt.nz/arcgis/rest/services/ResourceManagementAndPlanning/Zones/MapServer";
const WAIRARAPA_MANAGEMENT_AREAS =
  "https://gis.mstn.govt.nz/arcgis/rest/services/ResourceManagementAndPlanning/ManagementAreas/MapServer";
const WAIRARAPA_SPECIAL_FEATURES =
  "https://gis.mstn.govt.nz/arcgis/rest/services/ResourceManagementAndPlanning/SpecialFeatures/MapServer";
const WAIRARAPA_FLOOD_ZONES =
  "https://gis.mstn.govt.nz/arcgis/rest/services/EmergencyManagementAndHazards/FloodZones/MapServer";
const WAIRARAPA_EARTHQUAKE_HAZARDS =
  "https://gis.mstn.govt.nz/arcgis/rest/services/EmergencyManagementAndHazards/EarthquakeHazards/MapServer";
const WAIRARAPA_LIQUEFACTION =
  "https://gis.mstn.govt.nz/arcgis/rest/services/EmergencyManagementAndHazards/Liquefaction/MapServer";
const WAIRARAPA_TSUNAMI =
  "https://gis.mstn.govt.nz/arcgis/rest/services/EmergencyManagementAndHazards/TsunamiEvacuationZones/MapServer";
const DUNEDIN_DISTRICT_PLAN =
  "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/District_Plan/MapServer";
const WCC_DISTRICT_PLAN =
  "https://gis.wcc.govt.nz/arcgis/rest/services/DistrictPlan/DistrictPlan/MapServer";
const HCC_DISTRICT_PLAN =
  "https://maps.huttcity.govt.nz/server02/rest/services/Essentials/HCC_District_Plan/MapServer";
const HCC_DISTRICT_PLAN_QUERY =
  "https://maps.huttcity.govt.nz/server02/rest/services/Hutt_City_District_Plan/MapServer";
const UHCC_DISTRICT_PLAN_ZONES =
  "https://maps.upperhutt.govt.nz/arcgis/rest/services/District_Plan_Zones/MapServer";
const KCDC_DISTRICT_PLAN_ZONES =
  "https://maps.kapiticoast.govt.nz/server/rest/services/Public/District_Plan_Zones/MapServer";
const ROTORUA_DISTRICT_PLAN =
  "https://gis.rdc.govt.nz/server/rest/services/Core/DistrictPlan/MapServer";
const ROTORUA_PLANNING =
  "https://gis.rdc.govt.nz/server/rest/services/Core/Planning_and_Development/MapServer";
const WHAKATANE_DISTRICT_PLAN =
  "https://gis.whakatane.govt.nz/arcgis/rest/services/Planning/OperativeDistrictPlanNPS_ePlan/MapServer";
const WESTERN_BAY_DISTRICT_PLAN =
  "https://map.westernbay.govt.nz/arcgisext/rest/services/District_Plan/MapServer";
const WESTERN_BAY_NATURAL_HAZARDS =
  "https://map.westernbay.govt.nz/arcgisext/rest/services/District_Plan_Natural_Hazards/MapServer";
const WESTERN_BAY_OTHER_HAZARDS =
  "https://map.westernbay.govt.nz/arcgisext/rest/services/Other_Natural_Hazards/MapServer";
const SOUTHLAND_ZONING =
  "https://gis.southlanddc.govt.nz/server/rest/services/Website_SpatialPlan_layers/MapServer";
const SOUTHLAND_DISTRICT_PLAN =
  "https://gis.southlanddc.govt.nz/server/rest/services/EPLAN_DISTRICT_PLAN_AGOL/FeatureServer";
const WAIPA_DISTRICT_PLAN =
  "https://services9.arcgis.com/OsxSXqmTWVTZQ9ie/arcgis/rest/services/WaipaDistrictPlan_Zones/FeatureServer";
const WAIPA_QUALIFYING_MATTERS =
  "https://services9.arcgis.com/OsxSXqmTWVTZQ9ie/arcgis/rest/services/WaipaDistrictPlan_QualifyingMatters/FeatureServer";
const WAIPA_POLICY_OVERLAYS =
  "https://services9.arcgis.com/OsxSXqmTWVTZQ9ie/arcgis/rest/services/WaipaDistrictPlan_Policy_Overlay_Areas/FeatureServer";
const WAIPA_HERITAGE_AREAS =
  "https://services9.arcgis.com/OsxSXqmTWVTZQ9ie/arcgis/rest/services/WaipaDistrictPlan_Policy_Heritage_Areas/FeatureServer";
const WAIPA_PROTECTED_TREES =
  "https://services9.arcgis.com/OsxSXqmTWVTZQ9ie/arcgis/rest/services/WaipaDistrictPlan_Protected_Trees_Bushstands/FeatureServer";
const WAIPA_FLOOD_HAZARD =
  "https://services9.arcgis.com/OsxSXqmTWVTZQ9ie/arcgis/rest/services/WaipaDistrictPlan_SpecialFeature_Area_Flood/FeatureServer";
// Matamata-Piako District Council publishes its current public-map zoning and
// overlay layers through EU3vB12T67eDdisL. Wind zones remain on the legacy org.
const MPDC_CURRENT = "https://services6.arcgis.com/EU3vB12T67eDdisL/arcgis/rest/services";
const mpdcService = (name: string): string => `${MPDC_CURRENT}/${name}/FeatureServer`;
const MPDC_WIND_ZONES =
  "https://services9.arcgis.com/piFyx8f2y0yspZiu/arcgis/rest/services/Wind_Zones/FeatureServer";
const PNCC_GIS = "https://services.arcgis.com/Fv0Tvc98QEDvQyjL/arcgis/rest/services";
const pnccService = (name: string): string => `${PNCC_GIS}/${name}/FeatureServer`;
const MDC_GIS = "https://services9.arcgis.com/CzWZ8m5FuciqBibe/arcgis/rest/services";
const mdcService = (name: string): string => `${MDC_GIS}/${name}/FeatureServer`;

const CONFIGS: Partial<Record<PlanningProviderId, RegionalArcGisConfig>> = {
  manawatu: {
    // Query both councils. Point-in-polygon returns the authoritative layer
    // that actually covers the property, including sites near the PNCC/MDC
    // boundary where rectangular jurisdiction routing cannot be exact.
    zoneLayers: [
      {
        serviceUrl: pnccService("DISTRICTPLAN_PlanningZones"),
        layerId: 0,
        label: "Palmerston North City District Plan Zone",
        codeField: "ZONE",
        nameFields: ["ZONE"],
        decodeCodedValues: false,
      },
      {
        serviceUrl: mdcService("District_Plan_Zones"),
        layerId: 0,
        label: "Manawatu District Plan Zone",
        codeField: "zone",
        nameFields: ["zone"],
        detailFields: ["id"],
        decodeCodedValues: false,
      },
    ],
    overlayLayers: [
      overlay(pnccService("DISTRICTPLAN_Overlays"), 0, "District Plan Overlay", "polygon", "control", undefined, ["DESCRIPTION"]),
      overlay(pnccService("DISTRICTPLAN_FLOODPRONEAREAS"), 0, "Flood Prone Area", "polygon", "restricted"),
      overlay(pnccService("PNCC_District_Plan_DISTRICTPLAN_Ponding_Areas"), 0, "Ponding Area", "polygon", "restricted", undefined, ["NAME", "AREA_DESCR", "RESTRICTION", "FLOORLEVEL"]),
      overlay(pnccService("DISTRICTPLAN_Designations"), 0, "Designation", "polygon", "control", undefined, ["TYPE", "DESIGNUM", "DESIGNATION"]),
      overlay(pnccService("DISTRICTPLAN_AIRPORTNOISECONTOURS"), 0, "Airport Noise Contour", "polyline", "restricted", 30, ["LEVELDAYNIGHT"]),
      overlay(pnccService("DISTRICTPLAN_HeritageSites"), 0, "Heritage Site", "point", "restricted", 25, ["TYPE", "BLDG_OBJECT"]),
      overlay(pnccService("PNCC_District_Plan_Development_Areas"), 0, "Development Area", "polygon", "control", undefined, ["NAME", "DESCRIPTION"]),
      overlay(pnccService("PNCC_District_Plan_MultiUnitHousingAreas"), 0, "Multi-unit Housing Area", "polygon", "control", undefined, ["NAME", "DESCRIPTION"]),
      overlay(mdcService("Plan_Change_60_Designations"), 0, "MDC Designation", "polygon", "control", undefined, ["RefNo", "RequiringA", "Designatio", "Designated"]),
      overlay(mdcService("Plan_Change_65_ONFLs"), 0, "Outstanding Natural Feature or Landscape", "polygon", "restricted", undefined, ["Full_Name", "ONFL"]),
      overlay(mdcService("Lateral_Spread"), 1, "Lateral Spread Susceptibility", "polygon", "restricted"),
      overlay(mdcService("Palmerston_North_Airport_Air_Noise_Contours"), 0, "MDC Airport Noise Control", "polygon", "restricted"),
      overlay(mdcService("Transmission_Lines"), 5, "National Grid Transmission Line", "polyline", "restricted", 30),
      overlay(mdcService("Heritage_Plan_Change"), 0, "MDC Heritage Site", "point", "restricted", 25, ["Name", "CATCLASS"]),
      overlay(mdcService("Wetlands_Lakes_Rivers"), 3, "Wetland, Lake or River", "polygon", "restricted"),
      overlay(mdcService("Deferred_Residential_Overlay"), 1, "Deferred Residential Overlay", "polygon", "control"),
      overlay(mdcService("Plan_Change_45_Precinct_1"), 15, "MDC Growth Precinct 1", "polygon", "control", undefined, ["Descriptio", "MapLabel"]),
      overlay(mdcService("Plan_Change_45_Precinct_2"), 13, "MDC Growth Precinct 2", "polygon", "control", undefined, ["Descriptio", "MapLabel"]),
      overlay(mdcService("Plan_Change_45_Precinct_3"), 11, "MDC Growth Precinct 3", "polygon", "control", undefined, ["Descriptio", "MapLabel"]),
      overlay(mdcService("Plan_Change_51_Precinct_4"), 7, "MDC Growth Precinct 4 (Maewa)", "polygon", "control", undefined, ["Descriptio", "MapLabel"]),
    ],
  },
  "matamata-piako": {
    // The District Plan Zones service publishes one polygon layer per zone
    // class with no zone-name attribute (only FID/MSLINK/Shape__*) — the zone
    // identity is the layer itself. A point query returns at most one feature,
    // so layer order only affects lookup latency; residential/rural-residential
    // are tried first as the most common queries.
    zoneLayers: [
      zoneStatic(mpdcService("Residential_Zone"), 783, "Residential Zone", "MPDC_RESIDENTIAL", "Residential Zone"),
      zoneStatic(mpdcService("Medium_Density_Residential_Zone"), 467, "Medium Density Residential Zone", "MPDC_MEDIUM_DENSITY_RESIDENTIAL", "Medium Density Residential Zone"),
      zoneStatic(mpdcService("Rural_Residential_Zone"), 1031, "Rural Residential Zone", "MPDC_RURAL_RESIDENTIAL", "Rural Residential Zone"),
      zoneStatic(mpdcService("Rural_Residential_2_Zone"), 1032, "Rural Residential 2 Zone", "MPDC_RURAL_RESIDENTIAL_2", "Rural Residential 2 Zone"),
      zoneStatic(mpdcService("Rural_Zone"), 785, "Rural Zone", "MPDC_RURAL", "Rural Zone"),
      zoneStatic(mpdcService("Business_Zone"), 780, "Business Zone", "MPDC_BUSINESS", "Business Zone"),
      zoneStatic(mpdcService("General_Industrial_Zone"), 1045, "General Industrial Zone", "MPDC_INDUSTRIAL", "General Industrial Zone"),
      zoneStatic(mpdcService("Industrial_Zone"), 1039, "Industrial Zone", "MPDC_INDUSTRIAL", "Industrial Zone"),
      zoneStatic(mpdcService("Kaitiaki_Zone"), 789, "Kaitiaki Zone", "MPDC_KAITIAKI", "Kaitiaki Zone"),
      zoneStatic(mpdcService("Settlement_Zone"), 1059, "Settlement Zone", "MPDC_SETTLEMENT", "Settlement Zone"),
    ],
    overlayLayers: [
      overlay(mpdcService("Designation"), 420, "Designation", "polygon", "control"),
      overlay(mpdcService("Residential_Precinct"), 468, "Residential Precinct", "polygon", "control"),
      overlay(mpdcService("Structure_Plan_Area"), 502, "Structure Plan Area", "polygon", "control"),
      overlay(mpdcService("Flood_Hazard"), 435, "Flood Hazard Zone", "polygon", "restricted"),
      overlay(mpdcService("Instability_Area"), 437, "Land Instability Area", "polygon", "restricted"),
      overlay(mpdcService("Peat_Area"), 436, "Peat Land Area", "polygon", "moderate"),
      overlay(mpdcService("Character_Area"), 423, "Character Area", "polygon", "control"),
      overlay(mpdcService("Infill_Housing"), 422, "Infill Housing Area", "polygon", "control"),
      overlay(mpdcService("Future_Residential_Policy_Area"), 503, "Future Residential Policy Area", "polygon", "control"),
      overlay(mpdcService("Gas_Pipeline_Corridor"), 445, "Gas Pipeline Corridor", "polygon", "restricted"),
      overlay(mpdcService("Transmission_Line"), 440, "Transmission Line", "polyline", "restricted", 30, ["LINE_VOLTA", "SITE"]),
      overlay(MPDC_WIND_ZONES, 0, "Wind Zone", "polygon", "control"),
      overlay(mpdcService("Heritage_Site"), 457, "Heritage Site", "point", "restricted", 20, ["site_ref", "name", "location"]),
      overlay(mpdcService("Waahi_Tapu_Site"), 497, "Wāhi Tapu Site", "point", "restricted", 25, ["site_ref", "name", "location"]),
      overlay(mpdcService("Outstanding_or_Significant_Natural_Feature"), 456, "Significant Natural Feature", "point", "moderate", 30, ["site_label", "CommonName", "Location"]),
      overlay(mpdcService("Protected_Tree"), 496, "Protected Tree", "point", "moderate", 30, ["TreeNumber", "CommonName", "Location"]),
    ],
  },
  waipa: {
    zoneLayers: [
      {
        serviceUrl: WAIPA_DISTRICT_PLAN,
        layerId: 0,
        label: "Waipa District Plan Zone",
        codeField: "Zone",
        nameFields: ["Zone"],
        detailFields: ["Type", "Reference"],
      },
    ],
    overlayLayers: [
      overlay(WAIPA_QUALIFYING_MATTERS, 0, "Infrastructure Constraint Qualifying Matter", "polygon", "restricted", undefined, ["Category", "Source", "Date"], "Category = 'Infrastructure Constraint Qualifying Matter Overlay'"),
      overlay(WAIPA_QUALIFYING_MATTERS, 0, "Stormwater Constraint Qualifying Matter", "polygon", "restricted", undefined, ["Category", "Source", "Date"], "Category = 'Stormwater Constraint Qualifying Matter Overlay'"),
      overlay(WAIPA_POLICY_OVERLAYS, 0, "Policy Overlay Area", "polygon", "control"),
      overlay(WAIPA_HERITAGE_AREAS, 0, "Heritage Area", "polygon", "restricted"),
      overlay(WAIPA_PROTECTED_TREES, 0, "Protected Tree or Bushstand", "polygon", "moderate"),
      overlay(WAIPA_FLOOD_HAZARD, 0, "Flood Hazard Area", "polygon", "restricted"),
    ],
  },
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
  nelson: {
    zoneLayers: [
      {
        serviceUrl: TOP_OF_THE_SOUTH_MAPS,
        layerId: 27,
        label: "Nelson Planning Zone",
        codeField: "ZONES",
        nameFields: ["ZONES", "LABEL"],
        detailFields: ["STATUS", "Council"],
      },
    ],
    overlayLayers: [
      overlay(TOP_OF_THE_SOUTH_MAPS, 28, "Planning Zone Notation", "polygon", "moderate", undefined, ["LABEL", "ZONES", "STATUS", "Council"]),
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
  wairarapa: {
    // The combined plan publishes one polygon layer per zone type. Try each
    // queryable leaf layer until the property point intersects a zone.
    zoneLayers: [
      zone(WAIRARAPA_ZONES, 0, "Wairarapa Conservation Management Zone", "ZONE_TYPE", ["SUB_TYPE", "ZONE_TYPE", "NAME"], ["SUB_TYPE", "TLA", "LOCATION"]),
      zone(WAIRARAPA_ZONES, 1, "Wairarapa Special Rural Zone", "ZONE_TYPE", ["SUB_TYPE", "ZONE_TYPE", "NAME"], ["SUB_TYPE", "TLA", "LOCATION"]),
      zone(WAIRARAPA_ZONES, 2, "Wairarapa Commercial Zone", "ZONE_TYPE", ["SUB_TYPE", "ZONE_TYPE", "NAME"], ["SUB_TYPE", "TLA", "LOCATION"]),
      zone(WAIRARAPA_ZONES, 3, "Wairarapa Industrial Zone", "ZONE_TYPE", ["SUB_TYPE", "ZONE_TYPE", "NAME"], ["SUB_TYPE", "TLA", "LOCATION"]),
      zone(WAIRARAPA_ZONES, 4, "Wairarapa Residential Zone", "ZONE_TYPE", ["SUB_TYPE", "ZONE_TYPE", "NAME"], ["SUB_TYPE", "TLA", "LOCATION"]),
      zone(WAIRARAPA_ZONES, 5, "Wairarapa Primary Production Zone", "ZONE_TYPE", ["SUB_TYPE", "ZONE_TYPE", "NAME"], ["SUB_TYPE", "TLA", "LOCATION"]),
    ],
    overlayLayers: [
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 0, "Flood Hazard Area", "polygon", "restricted"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 1, "Flood Alert Area", "polygon", "restricted"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 5, "Erosion Hazard Area", "polygon", "restricted"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 6, "Foreshore Protection Area", "polygon", "restricted"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 7, "Character Area or Historic Heritage Precinct", "polygon", "control"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 8, "Pedestrian Precinct", "polygon", "control"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 9, "Coastal Environment Management Area", "polygon", "control"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 10, "Opaki Special Management Area", "polygon", "control"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 11, "Urban Water Supply Protection Area", "polygon", "restricted"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 12, "Future Development Area", "polygon", "control"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 13, "Airport Obstacle Limitation Surface", "polygon", "control"),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 14, "Air Noise Contour", "polyline", "moderate", 25),
      overlay(WAIRARAPA_MANAGEMENT_AREAS, 15, "Character Area", "polygon", "control"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 0, "Significant Natural Area", "polygon", "restricted"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 1, "Outstanding Landscape", "polygon", "restricted"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 2, "Outstanding Natural Feature", "polygon", "restricted"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 3, "Heritage Site", "point", "restricted", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 4, "Notable Tree", "point", "moderate", 30),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 5, "Tangata Whenua or Waahi Tapu Site", "point", "restricted", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 6, "Geological Site", "point", "moderate", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 7, "Archaeological Site", "point", "restricted", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 8, "Designation", "polygon", "control"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 9, "Park", "polygon", "control"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 10, "Urban Rural Boundary", "polygon", "control"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 11, "Significant Water Body", "polyline", "restricted", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 12, "Rail Zone", "polygon", "control"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 13, "Railway Line", "polyline", "moderate", 30),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 14, "High Voltage Transmission Line", "polyline", "restricted", 30),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 15, "40m Coastal Contour", "polyline", "moderate", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 16, "River", "polyline", "restricted", 25),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 17, "River Parcel", "polygon", "restricted"),
      overlay(WAIRARAPA_SPECIAL_FEATURES, 18, "Contaminated Site", "polygon", "restricted"),
      overlay(WAIRARAPA_FLOOD_ZONES, 0, "50-year Flood Zone", "polygon", "restricted"),
      overlay(WAIRARAPA_FLOOD_ZONES, 3, "Greytown 100-year Base Flood Extent", "polygon", "restricted"),
      overlay(WAIRARAPA_FLOOD_ZONES, 4, "Greytown Flood Sensitive Area", "polygon", "restricted"),
      overlay(WAIRARAPA_EARTHQUAKE_HAZARDS, 0, "Faultline Hazard Area", "polygon", "restricted"),
      overlay(WAIRARAPA_LIQUEFACTION, 0, "Liquefaction Susceptibility", "polygon", "moderate"),
      overlay(WAIRARAPA_TSUNAMI, 0, "Tsunami Evacuation Zone", "polygon", "moderate"),
    ],
  },
  wellington: {
    // Whole-region provider: each council runs its own district-plan service, so
    // the zone layers are tried in order and the first that returns a polygon at
    // the point wins. Field names were confirmed per council against each
    // service's layer metadata. Porirua City's operative-plan zone service is not
    // wired here yet (its GIS host was not verifiable at build time) — Porirua
    // properties still resolve infrastructure via Wellington Water below.
    zoneLayers: [
      {
        serviceUrl: WCC_DISTRICT_PLAN,
        layerId: 59,
        label: "Wellington City District Plan Activity Areas",
        codeField: "dp_zone",
        nameFields: ["dp_zone", "SubZone"],
        detailFields: ["SubZone", "Centre_Type"],
      },
      {
        serviceUrl: HCC_DISTRICT_PLAN_QUERY,
        layerId: 39,
        label: "Hutt City District Plan Activity Areas",
        codeField: "Activity_Area",
        nameFields: ["Activity_Area", "Description"],
        detailFields: ["Description", "Suburb", "Type", "Notes"],
      },
      {
        serviceUrl: UHCC_DISTRICT_PLAN_ZONES,
        layerId: 0,
        label: "Upper Hutt District Plan Zones",
        codeField: "Zone",
        nameFields: ["Zone"],
        detailFields: ["Notes"],
      },
      {
        serviceUrl: KCDC_DISTRICT_PLAN_ZONES,
        layerId: 0,
        label: "Kāpiti Coast District Plan Zones",
        codeField: "Zone",
        nameFields: ["Zone", "ZONE", "ZONE_NAME", "LABEL", "Description"],
        detailFields: ["Description", "LABEL"],
      },
    ],
    overlayLayers: [
      // Wellington City hazard + heritage + control layers.
      overlay(WCC_DISTRICT_PLAN, 48, "Flood Hazard Area", "polygon", "restricted"),
      overlay(WCC_DISTRICT_PLAN, 49, "Fault Line Hazard Area", "polygon", "restricted"),
      overlay(WCC_DISTRICT_PLAN, 47, "Ground Shaking Hazard Area", "polygon", "moderate"),
      overlay(WCC_DISTRICT_PLAN, 45, "Ridgelines and Hilltops Overlay", "polygon", "moderate"),
      overlay(WCC_DISTRICT_PLAN, 31, "Heritage Area", "polygon", "restricted"),
      overlay(WCC_DISTRICT_PLAN, 38, "Designation", "polygon", "control"),
      overlay(WCC_DISTRICT_PLAN, 41, "Transmission Line Buffer", "polygon", "restricted"),
      // Hutt City hazard + heritage + control layers.
      overlay(HCC_DISTRICT_PLAN, 130, "1-in-100-year Flood Extent", "polygon", "restricted"),
      overlay(HCC_DISTRICT_PLAN, 6, "Wellington Fault Overlay", "polygon", "restricted"),
      overlay(HCC_DISTRICT_PLAN, 32, "Heritage Area", "polygon", "restricted"),
      overlay(HCC_DISTRICT_PLAN, 126, "Designation", "polygon", "control"),
      overlay(HCC_DISTRICT_PLAN, 129, "Significant Natural Resource Site", "polygon", "restricted"),
      overlay(HCC_DISTRICT_PLAN, 117, "National Grid Yard", "polygon", "restricted"),
      overlay(HCC_DISTRICT_PLAN, 115, "Notable Tree", "point", "moderate", 30),
    ],
  },
  rotorua: {
    zoneLayers: [
      {
        serviceUrl: ROTORUA_DISTRICT_PLAN,
        layerId: 55,
        label: "Rotorua District Plan Zoning",
        codeField: "Code",
        nameFields: ["Description", "Type", "Code"],
        detailFields: ["Type", "Description", "OrderDesc"],
      },
    ],
    overlayLayers: [
      overlay(ROTORUA_PLANNING, 195, "Designation", "polygon", "control", undefined, ["Name", "Description", "Type"]),
      overlay(ROTORUA_PLANNING, 225, "Precinct", "polygon", "control"),
      overlay(ROTORUA_PLANNING, 230, "Development Area", "polygon", "control"),
      overlay(ROTORUA_PLANNING, 25, "Notable Tree Area", "polygon", "moderate"),
      overlay(ROTORUA_PLANNING, 90, "Outstanding Natural Feature or Landscape", "polygon", "restricted"),
      overlay(ROTORUA_PLANNING, 95, "Significant Natural Area", "polygon", "restricted"),
      overlay(ROTORUA_PLANNING, 115, "Airport Noise Contours", "polygon", "moderate"),
      overlay(ROTORUA_PLANNING, 180, "Three Waters Exclusion Zone", "polygon", "restricted"),
      overlay(ROTORUA_PLANNING, 240, "Geothermal Systems", "polygon", "restricted"),
      overlay(ROTORUA_PLANNING, 250, "Fault Avoidance Zone", "polygon", "restricted"),
      overlay(ROTORUA_PLANNING, 330, "Liquefaction Vulnerability", "polygon", "moderate"),
      overlay(ROTORUA_PLANNING, 340, "Landslide Susceptibility", "polygon", "restricted"),
      overlay(ROTORUA_PLANNING, 362, "Stormwater Flood Depth", "polygon", "restricted"),
    ],
  },
  "western-bay": {
    zoneLayers: [
      {
        serviceUrl: WESTERN_BAY_DISTRICT_PLAN,
        layerId: 66,
        label: "Western Bay District Plan Zone",
        codeField: "CS_PAR_ZONE",
        nameFields: ["CS_PAR_ZONE"],
        decodeCodedValues: false,
      },
    ],
    overlayLayers: [
      overlay(WESTERN_BAY_DISTRICT_PLAN, 16, "Coastal Erosion Access Yard", "polygon", "restricted", undefined, ["TAG"]),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 17, "Rural Erosion Risk", "polygon", "restricted"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 18, "Coastal Inundation Area", "polygon", "restricted"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 19, "Floodable Area", "polygon", "restricted"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 21, "Landscape Management Area", "polygon", "control"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 22, "Recommended Protection Area", "polygon", "moderate"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 23, "Significant Ecological Feature", "polygon", "restricted"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 24, "Land Stability Area", "polygon", "restricted"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 25, "Viewshaft", "polygon", "control"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 38, "Structure Plan Area", "polygon", "control"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 51, "Designation", "polygon", "control"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 52, "Firing Range", "polygon", "restricted"),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 55, "Limited Access Road", "polyline", "control", 20),
      overlay(WESTERN_BAY_DISTRICT_PLAN, 65, "Electricity Transmission Buffer", "polygon", "restricted"),
      overlay(WESTERN_BAY_NATURAL_HAZARDS, 0, "Flood Hazard", "polygon", "restricted"),
      overlay(WESTERN_BAY_NATURAL_HAZARDS, 1, "Coastal Inundation Hazard", "polygon", "restricted"),
      overlay(WESTERN_BAY_NATURAL_HAZARDS, 2, "Coastal Erosion Hazard", "polygon", "restricted"),
      overlay(WESTERN_BAY_NATURAL_HAZARDS, 3, "Land Stability Hazard", "polygon", "restricted"),
      overlay(WESTERN_BAY_OTHER_HAZARDS, 10, "Tsunami / 5m Wave Height", "polygon", "moderate", undefined, ["Zone"]),
      overlay(WESTERN_BAY_OTHER_HAZARDS, 11, "Tsunami / 1 in 2500 Year Wave", "polygon", "moderate", undefined, ["Zone"]),
      overlay(WESTERN_BAY_OTHER_HAZARDS, 12, "Liquefaction Vulnerability", "polygon", "moderate", undefined, ["LiquefactionVulnerabilityCatego", "Detail", "Notes"]),
    ],
    queryTimeoutMs: 10_000,
  },
  whakatane: {
    // This council host commonly needs more than the default nine seconds
    // when called from Vercel, even though the same point query is fast from
    // New Zealand. Keep the wider allowance scoped to this provider.
    queryTimeoutMs: 20_000,
    zoneLayers: [
      {
        serviceUrl: WHAKATANE_DISTRICT_PLAN,
        layerId: 36,
        label: "Whakatane District Plan Zone",
        codeField: "Zone_Name",
        nameFields: ["Zone_Name"],
        detailFields: ["Source"],
        decodeCodedValues: false,
      },
    ],
    overlayLayers: [
      overlay(WHAKATANE_DISTRICT_PLAN, 8, "Designation", "polygon", "control", undefined, ["WDC_ID", "AUTHORITY", "PURPOSE", "ZONE"]),
      overlay(WHAKATANE_DISTRICT_PLAN, 65, "Whakatane Town Centre Precinct", "polygon", "control"),
      overlay(WHAKATANE_DISTRICT_PLAN, 68, "Development Area", "polygon", "control"),
      overlay(WHAKATANE_DISTRICT_PLAN, 4, "Historic Heritage", "point", "restricted", 30),
      overlay(WHAKATANE_DISTRICT_PLAN, 25, "Significant Indigenous Biodiversity Site", "polygon", "restricted"),
      overlay(WHAKATANE_DISTRICT_PLAN, 27, "Outstanding Natural Feature or Landscape", "polygon", "restricted"),
      overlay(WHAKATANE_DISTRICT_PLAN, 29, "Erosion Risk Zone", "polygon", "restricted"),
      overlay(WHAKATANE_DISTRICT_PLAN, 31, "Debris Flow Policy Area", "polygon", "restricted"),
      overlay(WHAKATANE_DISTRICT_PLAN, 35, "Inundation Risk Zone", "polygon", "restricted"),
      overlay(WHAKATANE_DISTRICT_PLAN, 49, "Gas Transmission Pipeline Corridor", "polygon", "restricted"),
      overlay(WHAKATANE_DISTRICT_PLAN, 50, "National Grid Transmission Line", "polyline", "restricted", 30),
      overlay(WHAKATANE_DISTRICT_PLAN, 57, "Building Height Restriction", "polygon", "control"),
      overlay(WHAKATANE_DISTRICT_PLAN, 71, "State Highway Buffer", "polygon", "moderate"),
      overlay(WHAKATANE_DISTRICT_PLAN, 73, "Marae and Urupa Amenity Yard", "polygon", "restricted"),
    ],
  },
  southland: {
    zoneLayers: [
      zone(SOUTHLAND_ZONING, 7, "Southland General Residential Zone", "TYPE", ["TYPE", "LOCALITY"]),
      zone(SOUTHLAND_ZONING, 8, "Southland Industrial Zone", "TYPE", ["TYPE", "LOCALITY"]),
      zone(SOUTHLAND_ZONING, 9, "Southland General Rural Zone", "TYPE", ["TYPE", "LOCALITY"]),
      zone(SOUTHLAND_ZONING, 10, "Southland Natural Open Space Zone", "TYPE", ["TYPE", "LOCALITY"]),
      zone(SOUTHLAND_ZONING, 11, "Southland Large Lot Residential Zone", "TYPE", ["TYPE", "LOCALITY"]),
      zone(SOUTHLAND_ZONING, 12, "Southland Special Purpose Zone", "TYPE", ["TYPE", "LOCALITY"]),
    ],
    overlayLayers: [
      overlay(SOUTHLAND_DISTRICT_PLAN, 15, "Designation", "polygon", "control", undefined, ["DP_ID", "REQUIRING_AUTHORITY", "DESIG_PURP", "DESIG_SITE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 39, "Rural Settlement Area", "polygon", "control", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 40, "Commercial Precinct", "polygon", "control", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 80, "Development Area", "polygon", "control", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 73, "Flooding Inundation Overlay", "polygon", "restricted"),
      overlay(SOUTHLAND_DISTRICT_PLAN, 4, "Coastal Hazard Overlay", "polygon", "restricted", undefined, ["Feature_Type"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 9, "Historic Heritage Area", "polygon", "restricted", undefined, ["SITE_NO", "NAME", "LOCALITY"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 10, "Archaeological Site", "point", "restricted", 30, ["STATUS", "NZAA_ID", "site_type"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 31, "Outstanding Natural Feature or Landscape", "polygon", "restricted", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 30, "Visual Amenity Landscape", "polygon", "moderate", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 24, "Noise Sensitive Activity Exclusion Zone", "polygon", "moderate", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 6, "National Grid", "polyline", "restricted", 30, ["SITE", "Full_Name", "LINE_VOLTA"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 32, "Mandeville Airfield", "polygon", "moderate", undefined, ["Label"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 69, "Lead Contamination Area", "polygon", "restricted", undefined, ["LOCALITY", "TYPE"]),
      overlay(SOUTHLAND_DISTRICT_PLAN, 72, "Build Restriction", "polygon", "restricted", undefined, ["LOCALITY", "TYPE"]),
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
  where?: string,
): RegionalOverlayLayer {
  return { serviceUrl, layerId, name, geometryType, status, distanceM, detailFields, where };
}

// For council layers with no zone-name attribute where the layer itself is a
// single zone class (e.g. Matamata-Piako's District_Plan_Zones service, which
// publishes one polygon layer per zone with only FID/MSLINK/Shape__* fields).
function zoneStatic(
  serviceUrl: string,
  layerId: number,
  label: string,
  staticZoneCode: string,
  staticZoneName: string,
): RegionalZoneLayer {
  return { serviceUrl, layerId, label, nameFields: [], staticZoneCode, staticZoneName };
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
    where?: string;
    outFields?: string[];
  } = {},
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${layerUrl(layer)}/query`);
  url.searchParams.set("where", options.where ?? "1=1");
  geometryParams(url, lat, lng, options.parcelBbox ?? null);
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", options.outFields?.join(",") || "*");
  url.searchParams.set("returnGeometry", "false");
  url.searchParams.set("resultRecordCount", "1");
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

async function queryArcGisAttributesWithRetry(
  layer: { serviceUrl: string; layerId: number },
  lat: number,
  lng: number,
  options: Parameters<typeof queryArcGisAttributes>[3] = {},
): Promise<Record<string, unknown>[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await queryArcGisAttributes(layer, lat, lng, options);
    } catch (err) {
      lastError = err;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastError;
}

function configFor(providerId: PlanningProviderId): RegionalArcGisConfig | null {
  return CONFIGS[providerId] ?? null;
}

function westernBayResidentialLocality(lat: number, lng: number): string | null {
  if (lat >= -37.86 && lat <= -37.70 && lng >= 176.40 && lng <= 176.56) return "Pukehina";
  if (lat >= -37.67 && lat <= -37.35 && lng >= 175.75 && lng <= 176.00) return "Waihi Beach / Athenree / Katikati";
  return null;
}

function pnccResidentialLocality(lat: number, lng: number): string | null {
  const isAshhurst = lat >= -40.33 && lat <= -40.25 && lng >= 175.72 && lng <= 175.82;
  const isBunnythorpe = lat >= -40.32 && lat <= -40.26 && lng >= 175.61 && lng <= 175.68;
  const isLongburn = lat >= -40.41 && lat <= -40.35 && lng >= 175.51 && lng <= 175.58;
  return isAshhurst || isBunnythorpe || isLongburn ? "PNCC 500sqm residential locality" : null;
}

export function configuredRegionalProviderIds(): PlanningProviderId[] {
  return Object.keys(CONFIGS) as PlanningProviderId[];
}

export function hasRegionalPlanningZoneLayer(providerId: PlanningProviderId | null | undefined): boolean {
  return providerId != null && (configFor(providerId)?.zoneLayers.length ?? 0) > 0;
}

export async function fetchRegionalPlanningZone(
  jurisdiction: RegionalJurisdiction,
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
): Promise<ZoneResult> {
  const config = configFor(jurisdiction.providerId);
  if (!config) return partialProviderZone(jurisdiction);

  for (const layer of config.zoneLayers) {
    try {
      // A point-in-polygon lookup is the authoritative and cheapest way to
      // identify the zone at the analysed address.  The previous parcel-first
      // order made large rural parcels expensive: Whakatane's ArcGIS service
      // could spend two full timeout windows on the parcel envelope and then
      // never reach the fast point query.  Only use the parcel as a fallback
      // when the address point genuinely returns no zone.
      const queryOptions = {
        timeoutMs: config.queryTimeoutMs,
        outFields: uniqueTexts([
          layer.codeField ?? null,
          ...layer.nameFields,
          ...(layer.detailFields ?? []),
        ]),
      };
      let features = await queryArcGisAttributesWithRetry(layer, lat, lng, queryOptions);
      if (features.length === 0 && parcelBbox) {
        features = await queryArcGisAttributesWithRetry(layer, lat, lng, { ...queryOptions, parcelBbox });
      }
      const attrs = features[0];
      if (!attrs) continue;

      // No metadata request is needed when the configured name field is the
      // code field itself (for example Whakatane's Zone_Name).  Avoiding that
      // extra council round trip materially improves serverless reliability.
      const metadata = layer.decodeCodedValues === false
        ? {}
        : await fetchLayerMetadata(layer).catch(() => ({}));
      const rawCode = stringifyValue(layer.codeField ? attrs[layer.codeField] : null);
      const decoded = decodeCodedValue(metadata, layer.codeField, layer.codeField ? attrs[layer.codeField] : null);
      const name = decoded ?? firstText(attrs, layer.nameFields) ?? layer.staticZoneName ?? null;
      const details = uniqueTexts([
        detailFromAttributes(attrs, layer.detailFields, []),
        jurisdiction.providerId === "western-bay" ? westernBayResidentialLocality(lat, lng) : null,
        jurisdiction.providerId === "manawatu" && layer.label.startsWith("Palmerston") ? pnccResidentialLocality(lat, lng) : null,
        layer.label,
        rawCode && decoded && rawCode !== decoded ? `code ${rawCode}` : null,
      ]);

      return {
        zone_code: rawCode ?? layer.staticZoneCode ?? name ?? "REGIONAL",
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
      const timeoutMs = config.queryTimeoutMs ?? 8000;
      // Resolve a polygon at the address point first.  On large rural parcels
      // this avoids slow envelope scans while still returning the exact
      // applicable control (such as the Onepu State Highway Buffer).  Fall
      // back to the whole parcel only when the point itself is not covered so
      // controls touching another part of the parcel are still discoverable.
      let features = await queryArcGisAttributes(layer, lat, lng, {
        parcelBbox: null,
        distanceM,
        timeoutMs,
        where: layer.where,
      });
      if (features.length === 0 && layer.geometryType === "polygon" && parcelBbox) {
        features = await queryArcGisAttributes(layer, lat, lng, {
          parcelBbox,
          timeoutMs,
          where: layer.where,
        });
      }
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
    where: layer.where,
  }));
}
