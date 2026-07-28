import {
  classifyInfrastructureFeatures,
  infrastructureSearchDistanceMetres,
  type InfrastructureFeature,
  type InfrastructureFetchOptions,
  type InfrastructureItem,
} from "./infrastructure";
import type { ParcelBbox } from "./linz";
import type { PlanningProviderId } from "./regional-planning";

type RegionalServiceName = "Wastewater" | "Stormwater" | "Water Supply";

export interface RegionalInfrastructureLayer {
  id: number;
  label: string;
  where?: string;
}

export interface RegionalInfrastructureGroup {
  name: RegionalServiceName;
  serviceUrl: string;
  owner: string;
  maintainer: string;
  ruralSearchDistanceM: number;
  layers: RegionalInfrastructureLayer[];
  /** Polygon/status layers describe eligibility or a service area, not a pipe.
   * They may establish mapped availability but must never be presented as a
   * confirmed physical lateral or low-risk boundary connection. */
  availabilityOnly?: boolean;
}

const WHANGAREI_WATER =
  "https://geo.wdc.govt.nz/server/rest/services/Water_Public/FeatureServer";
const WHANGAREI_WASTEWATER =
  "https://geo.wdc.govt.nz/server/rest/services/Wastewater_Public/FeatureServer";
const WHANGAREI_STORMWATER =
  "https://geo.wdc.govt.nz/server/rest/services/Stormwater_Public/FeatureServer";
const QLDC_THREE_WATERS =
  "https://gis.qldc.govt.nz/server/rest/services/ThreeWaters/Three_Waters/FeatureServer";
const DUNEDIN_WATER =
  "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Water/FeatureServer";
const DUNEDIN_STORMWATER =
  "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/Stormwater/FeatureServer";
const DUNEDIN_CITYCARE =
  "https://apps.dunedin.govt.nz/arcgis/rest/services/Public/CityCare/MapServer";
const CANTERBURY_THREE_WATERS =
  "https://services1.arcgis.com/RNxkQaMWQcgbiF98/arcgis/rest/services/Canterbury_Three_Waters_Data_2_view/FeatureServer";
const SELWYN_WATER =
  "https://gis.selwyn.govt.nz/arcgis/rest/services/SDC_Public/WATER_Water/MapServer";
const SELWYN_WASTEWATER =
  "https://gis.selwyn.govt.nz/arcgis/rest/services/SDC_Public/Water_Sewer/MapServer";
const SELWYN_STORMWATER =
  "https://gis.selwyn.govt.nz/arcgis/rest/services/SDC_Public/WATER_Stormwater/MapServer";
const SELWYN_WATER_CONNECTION_SUPPLY =
  "https://gis.selwyn.govt.nz/arcgis/rest/services/SDC_Public/Water_Connection_Supply/MapServer";
const HAMILTON_WATER =
  "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Freshwater Dataset - Hamilton City Council/FeatureServer";
const HAMILTON_WASTEWATER =
  "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Wastewater Dataset - Hamilton City Council/FeatureServer";
const HAMILTON_STORMWATER =
  "https://services1.arcgis.com/R6s0QqCMQdwKY6yp/arcgis/rest/services/Stormwater Dataset - Hamilton City Council/FeatureServer";
const WAIPA_WATER =
  "https://services3.arcgis.com/Oou6z70yKcGvIDxP/arcgis/rest/services/WaterSupplyPipesWaikato/FeatureServer";
const WAIPA_WASTEWATER =
  "https://services3.arcgis.com/Oou6z70yKcGvIDxP/arcgis/rest/services/WastewaterPipesWaikato/FeatureServer";
const WAIPA_STORMWATER =
  "https://services3.arcgis.com/Oou6z70yKcGvIDxP/arcgis/rest/services/StormwaterPipesWaikato/FeatureServer";
const TOP_OF_THE_SOUTH_MAPS =
  "https://www.topofthesouthmaps.co.nz/ArcGIS/rest/services/TopoftheSouthMaps/MapServer";
// Single regional three-waters service maintained by Wellington Water on behalf
// of Wellington City, Hutt City, Upper Hutt, Porirua (and South Wairarapa/GWRC).
const WELLINGTON_WATER_THREE_WATERS =
  "https://gis.wellingtonwater.co.nz/server1/rest/services/Councils/All_Councils_3_Waters_Asset_Data/MapServer";
const KAPITI_THREE_WATERS =
  "https://maps.kapiticoast.govt.nz/server/rest/services/Public/Services/MapServer";
const TAUPO_WATER =
  "https://maps.taupodc.govt.nz/server/rest/services/assetfinda/Water_Pipe/FeatureServer";
const TAUPO_WASTEWATER =
  "https://maps.taupodc.govt.nz/server/rest/services/assetfinda/Wastewater_Pipe/FeatureServer";
const TAUPO_STORMWATER =
  "https://maps.taupodc.govt.nz/server/rest/services/assetfinda/Stormwater_Pipe/FeatureServer";
const ROTORUA_THREE_WATERS =
  "https://gis.rdc.govt.nz/server/rest/services/Asset/3_Waters/MapServer";
const WHAKATANE_WATER =
  "https://gis.whakatane.govt.nz/arcgis/rest/services/ThreeWaters/WaterSupplyAssets/MapServer";
const WHAKATANE_WASTEWATER =
  "https://gis.whakatane.govt.nz/arcgis/rest/services/ThreeWaters/WasteWaterAssets/MapServer";
const WHAKATANE_STORMWATER =
  "https://gis.whakatane.govt.nz/arcgis/rest/services/ThreeWaters/StormWaterAssets/MapServer";
const WESTERN_BAY_WATER =
  "https://wslgis.water.co.nz/server/rest/services/WBP/WBP_Water_REST_Services/MapServer";
const WESTERN_BAY_WASTEWATER =
  "https://wslgis.water.co.nz/server/rest/services/WBP/WBP_Wastewater_REST_services/MapServer";
const WESTERN_BAY_STORMWATER =
  "https://wslgis.water.co.nz/server/rest/services/WBP/WBP_Stormwater_REST_Services/MapServer";
const TAURANGA_WATER =
  "https://gis.tauranga.govt.nz/server/rest/services/Water_Supply_Common_Mapservices/MapServer";
const TAURANGA_WASTEWATER =
  "https://gis.tauranga.govt.nz/server/rest/services/Wastewater_Common_Mapservices/MapServer";
const TAURANGA_STORMWATER =
  "https://gis.tauranga.govt.nz/server/rest/services/Stormwater_Common_Mapservices/MapServer";
const NAPIER_THREE_WATERS =
  "https://services3.arcgis.com/N69BvCUwqSCkbIQF/ArcGIS/rest/services/717214_Napier_City_Council_layers/FeatureServer";
const SOUTHLAND_THREE_WATERS =
  "https://gis.southlanddc.govt.nz/server/rest/services/External_ThreeWaters_Layers_v2/MapServer";
const WAIRARAPA_WATER =
  "https://gis.mstn.govt.nz/arcgis/rest/services/Services/WaterPublic/MapServer";
const WAIRARAPA_WASTEWATER =
  "https://gis.mstn.govt.nz/arcgis/rest/services/Services/SewerPublic/MapServer";
const WAIRARAPA_STORMWATER =
  "https://gis.mstn.govt.nz/arcgis/rest/services/Services/StormwaterPublic/MapServer";
const MPDC_WATER =
  "https://services6.arcgis.com/EU3vB12T67eDdisL/arcgis/rest/services/WaterLine/FeatureServer";
const MPDC_WASTEWATER =
  "https://services6.arcgis.com/EU3vB12T67eDdisL/arcgis/rest/services/WasteWaterLine/FeatureServer";
const MPDC_STORMWATER =
  "https://services6.arcgis.com/EU3vB12T67eDdisL/arcgis/rest/services/StormWaterLine/FeatureServer";
const PNCC_GIS = "https://services.arcgis.com/Fv0Tvc98QEDvQyjL/arcgis/rest/services";
const MDC_GIS = "https://services9.arcgis.com/CzWZ8m5FuciqBibe/arcgis/rest/services";
const TCDC_THREE_WATERS =
  "https://services5.arcgis.com/MYtLmLEStmKgdmln/arcgis/rest/services/TCDC_3Waters/FeatureServer";
const BULLER_WATER =
  "https://services6.arcgis.com/Whb8vGWSmNkavSpL/arcgis/rest/services/Water_Supply_Services_Public_View/FeatureServer";
const BULLER_WASTEWATER =
  "https://services6.arcgis.com/Whb8vGWSmNkavSpL/arcgis/rest/services/Sewer_Services_Public_View/FeatureServer";
const BULLER_STORMWATER =
  "https://services6.arcgis.com/Whb8vGWSmNkavSpL/arcgis/rest/services/Stormwater_Services_Public_View/FeatureServer";

const REGIONAL_INFRASTRUCTURE: Partial<Record<PlanningProviderId, RegionalInfrastructureGroup[]>> = {
  "thames-coromandel": [
    group("Water Supply", TCDC_THREE_WATERS, "Thames-Coromandel District Council", [
      [1, "Potable water point or connection"],
      [4, "Potable water supply line"],
    ]),
    group("Wastewater", TCDC_THREE_WATERS, "Thames-Coromandel District Council", [
      [2, "Wastewater point or connection"],
      [5, "Wastewater line"],
    ]),
    group("Stormwater", TCDC_THREE_WATERS, "Thames-Coromandel District Council", [
      [3, "Stormwater point or connection"],
      [6, "Stormwater line"],
    ], 1000),
  ],
  buller: [
    group("Water Supply", BULLER_WATER, "Buller District Council", [
      [0, "Public potable-water point or connection", "ASSET_OWNER = 'Local Authority'"],
      [2, "Public potable-water line", "ASSET_OWNER = 'Local Authority'"],
    ]),
    group("Wastewater", BULLER_WASTEWATER, "Buller District Council", [
      [0, "Public wastewater point or connection", "ASSET_OWNER = 'Local Authority'"],
      [2, "Public wastewater line", "ASSET_OWNER = 'Local Authority'"],
    ]),
    group("Stormwater", BULLER_STORMWATER, "Buller District Council", [
      [0, "Public stormwater point or connection", "ASSET_OWNER = 'Local Authority'"],
      [2, "Public stormwater line", "ASSET_OWNER = 'Local Authority'"],
    ], 1000),
  ],
  selwyn: [
    group("Water Supply", SELWYN_WATER, "Selwyn Water Limited", [
      [3, "Water point or connection"],
      [4, "Water supply pipe"],
    ]),
    {
      ...group("Water Supply", SELWYN_WATER_CONNECTION_SUPPLY, "Selwyn Water Limited", [
        [0, "Water scheme boundary"],
        [1, "Water connection application status"],
        [2, "Water supply classification"],
      ]),
      availabilityOnly: true,
    },
    group("Wastewater", SELWYN_WASTEWATER, "Selwyn Water Limited", [
      [3, "Wastewater manhole or connection"],
      [4, "Wastewater pipe"],
    ]),
    group("Stormwater", SELWYN_STORMWATER, "Selwyn District Council", [
      [1, "Stormwater area"],
      [2, "Stormwater node or connection"],
      [3, "Stormwater pipe or drain"],
    ], 1000),
  ],
  kapiti: [
    group("Water Supply", KAPITI_THREE_WATERS, "Kāpiti Coast District Council", [
      [2, "Water pipe"],
    ]),
    group("Wastewater", KAPITI_THREE_WATERS, "Kāpiti Coast District Council", [
      [10, "Wastewater service"],
      [11, "Wastewater pipe"],
    ]),
    group("Stormwater", KAPITI_THREE_WATERS, "Kāpiti Coast District Council", [
      [19, "Stormwater node"],
      [20, "Stormwater service"],
      [21, "Stormwater pipe"],
      [22, "Stormwater channel"],
    ], 1000),
  ],
  manawatu: [
    group("Water Supply", `${PNCC_GIS}/NZVD2016_WATER_MAINS/FeatureServer`, "Palmerston North City Council", [[0, "Water main"]]),
    group("Wastewater", `${PNCC_GIS}/NZVD2016_SEWER_MAINS/FeatureServer`, "Palmerston North City Council", [[0, "Wastewater main"]]),
    group("Stormwater", `${PNCC_GIS}/NZVD2016_STORM_MAINS/FeatureServer`, "Palmerston North City Council", [[0, "Stormwater main"]], 1000),
    group("Water Supply", `${MDC_GIS}/GIS_WATER_LINE_LN/FeatureServer`, "Manawatu District Council", [[0, "Water main"]]),
    group("Wastewater", `${MDC_GIS}/GIS_WASTEWATER_LINE_LN/FeatureServer`, "Manawatu District Council", [[0, "Wastewater main"]]),
    group("Stormwater", `${MDC_GIS}/GIS_STORMWATER_LINE_LN/FeatureServer`, "Manawatu District Council", [[0, "Stormwater main"]], 1000),
  ],
  "matamata-piako": [
    group("Water Supply", MPDC_WATER, "Matamata-Piako District Council", [
      [488, "Water main"],
    ]),
    group("Wastewater", MPDC_WASTEWATER, "Matamata-Piako District Council", [
      [33, "Wastewater main"],
    ]),
    group("Stormwater", MPDC_STORMWATER, "Matamata-Piako District Council", [
      [30, "Stormwater main"],
    ], 1000),
  ],
  waipa: [
    group("Water Supply", WAIPA_WATER, "Waipā District Council / Waikato OneView", [
      [0, "Water supply pipe"],
    ]),
    group("Wastewater", WAIPA_WASTEWATER, "Waipā District Council / Waikato OneView", [
      [0, "Wastewater pipe"],
    ]),
    group("Stormwater", WAIPA_STORMWATER, "Waipā District Council / Waikato OneView", [
      [0, "Stormwater pipe"],
    ], 1000),
  ],
  taupo: [
    group("Water Supply", TAUPO_WATER, "Taupō District Council", [
      [0, "Potable water pipe"],
    ], 1500),
    group("Wastewater", TAUPO_WASTEWATER, "Taupō District Council", [
      [0, "Wastewater pipe"],
    ], 1500),
    group("Stormwater", TAUPO_STORMWATER, "Taupō District Council", [
      [0, "Stormwater pipe"],
    ], 1500),
  ],
  rotorua: [
    group("Water Supply", ROTORUA_THREE_WATERS, "Rotorua Lakes Council", [
      [95, "Water service line"],
      [105, "Water main"],
    ]),
    group("Wastewater", ROTORUA_THREE_WATERS, "Rotorua Lakes Council", [
      [335, "Wastewater service line"],
      [345, "Wastewater main"],
    ]),
    group("Stormwater", ROTORUA_THREE_WATERS, "Rotorua Lakes Council", [
      [195, "Stormwater lead"],
      [205, "Stormwater channel"],
      [215, "Stormwater service line"],
      [225, "Stormwater main"],
    ], 1000),
  ],
  "western-bay": [
    group("Water Supply", WESTERN_BAY_WATER, "Western Bay of Plenty District Council", [
      [18, "Water pipe"],
    ]),
    group("Wastewater", WESTERN_BAY_WASTEWATER, "Western Bay of Plenty District Council", [
      [16, "Wastewater pipe"],
    ]),
    group("Stormwater", WESTERN_BAY_STORMWATER, "Western Bay of Plenty District Council", [
      [18, "Stormwater drain"],
      [19, "Stormwater pipe"],
    ], 1000),
  ],
  tauranga: [
    group("Water Supply", TAURANGA_WATER, "Tauranga City Council", [
      [99, "Water pipe"],
    ]),
    group("Wastewater", TAURANGA_WASTEWATER, "Tauranga City Council", [
      [58, "Wastewater pipe"],
    ]),
    group("Stormwater", TAURANGA_STORMWATER, "Tauranga City Council", [
      [144, "Stormwater pipe"],
    ], 1000),
  ],
  napier: [
    group("Water Supply", NAPIER_THREE_WATERS, "Napier City Council", [
      [4, "Water pipe or service lateral"],
    ]),
    group("Wastewater", NAPIER_THREE_WATERS, "Napier City Council", [
      [5, "Wastewater pipe or service lateral"],
    ]),
    group("Stormwater", NAPIER_THREE_WATERS, "Napier City Council", [
      [6, "Stormwater pipe or inlet lead"],
    ], 1000),
  ],
  whakatane: [
    group("Water Supply", WHAKATANE_WATER, "Whakatane District Council", [
      [47, "Water connection"],
      [48, "Water main"],
      [49, "Water rider main"],
    ]),
    group("Wastewater", WHAKATANE_WASTEWATER, "Whakatane District Council", [
      [47, "Wastewater connection"],
      [48, "Wastewater main"],
      [49, "Wastewater rising main"],
    ]),
    group("Stormwater", WHAKATANE_STORMWATER, "Whakatane District Council", [
      [44, "Stormwater connection"],
      [45, "Stormwater main"],
      [46, "Stormwater rising main"],
      [47, "Stormwater open drain"],
    ], 1000),
  ],
  southland: [
    group("Water Supply", SOUTHLAND_THREE_WATERS, "Southland District Council", [
      [12, "Water supply main"],
      [14, "Water supply service line"],
    ]),
    group("Wastewater", SOUTHLAND_THREE_WATERS, "Southland District Council", [
      [38, "Wastewater main"],
      [40, "Wastewater service line"],
    ]),
    group("Stormwater", SOUTHLAND_THREE_WATERS, "Southland District Council", [
      [66, "Stormwater main"],
      [68, "Stormwater service line"],
      [72, "Stormwater channel"],
      [73, "Stormwater miscellaneous line"],
    ], 1000),
  ],
  wairarapa: [
    group("Water Supply", WAIRARAPA_WATER, "Masterton / Carterton District Councils (Wairarapa Maps)", [
      [5, "Masterton water main"],
      [12, "Carterton water main"],
      [11, "Carterton water lateral"],
      [62, "Carterton rider main"],
    ]),
    group("Wastewater", WAIRARAPA_WASTEWATER, "Masterton / Carterton District Councils (Wairarapa Maps)", [
      [4, "Masterton sewer main"],
      [10, "Carterton sewer main"],
      [9, "Carterton sewer lateral"],
    ]),
    group("Stormwater", WAIRARAPA_STORMWATER, "Masterton / Carterton District Councils (Wairarapa Maps)", [
      [6, "Masterton stormwater main"],
      [5, "Masterton watercourse"],
      [13, "Carterton stormwater main"],
      [12, "Carterton stormwater lateral"],
    ], 1000),
  ],
  hamilton: [
    group("Water Supply", HAMILTON_WATER, "Hamilton City Council", [
      [0, "Water service line/connection"],
      [11, "Water main"],
    ]),
    group("Wastewater", HAMILTON_WASTEWATER, "Hamilton City Council", [
      [0, "Wastewater main"],
      [7, "Wastewater service line"],
    ]),
    group("Stormwater", HAMILTON_STORMWATER, "Hamilton City Council", [
      [2, "Stormwater channel"],
      [3, "Stormwater subsoil drain"],
      [4, "Stormwater main"],
      [7, "Stormwater service line"],
      [14, "Stormwater catchpit lead"],
      [15, "Stormwater swale"],
    ], 1000),
  ],
  whangarei: [
    group("Water Supply", WHANGAREI_WATER, "Whangarei District Council", [
      [1, "Water reticulation"],
      [2, "Water service line"],
      [35, "Water main"],
      [40, "Water trunk main"],
    ]),
    group("Wastewater", WHANGAREI_WASTEWATER, "Whangarei District Council", [
      [38, "Wastewater service line"],
      [60, "Wastewater main"],
    ]),
    group("Stormwater", WHANGAREI_STORMWATER, "Whangarei District Council", [
      [2, "Stormwater main"],
      [3, "Stormwater surface drain"],
      [4, "Stormwater culvert"],
      [5, "Stormwater culvert"],
      [6, "Stormwater drainage"],
      [7, "Stormwater service line"],
    ], 1000),
  ],
  nelson: [
    group("Water Supply", TOP_OF_THE_SOUTH_MAPS, "Nelson City Council / Top of the South Maps", [
      [5, "Services - Water Pipes"],
    ]),
    group("Wastewater", TOP_OF_THE_SOUTH_MAPS, "Nelson City Council / Top of the South Maps", [
      [6, "Services - Wastewater Pipes"],
    ]),
    group("Stormwater", TOP_OF_THE_SOUTH_MAPS, "Nelson City Council / Top of the South Maps", [
      [7, "Services - Stormwater Pipes"],
      [8, "Services - Stormwater Drains"],
    ], 1000),
  ],
  qldc: [
    group("Stormwater", QLDC_THREE_WATERS, "Queenstown Lakes District Council", [
      [8, "Stormwater main"],
      [10, "Stormwater lateral"],
      [11, "Stormwater channel"],
    ], 1000),
    group("Wastewater", QLDC_THREE_WATERS, "Queenstown Lakes District Council", [
      [21, "Wastewater main"],
      [23, "Wastewater lateral"],
    ]),
    group("Water Supply", QLDC_THREE_WATERS, "Queenstown Lakes District Council", [
      [32, "Water supply main"],
      [34, "Water supply lateral"],
    ]),
  ],
  dunedin: [
    group("Water Supply", DUNEDIN_WATER, "Dunedin City Council", [
      [14, "Water supply/trunk main"],
      [15, "Water pipe"],
      [16, "Water service pipe"],
    ]),
    group("Wastewater", DUNEDIN_CITYCARE, "Dunedin City Council", [
      [5, "Foul sewer pipe"],
      [6, "Foul drain pipe"],
      [7, "Foul sewer miscellaneous pipe"],
    ]),
    group("Stormwater", DUNEDIN_STORMWATER, "Dunedin City Council", [
      [10, "Stormwater pipe"],
      [11, "Stormwater drain pipe"],
      [12, "Stormwater mudtank pipe"],
      [13, "Stormwater miscellaneous pipe"],
    ], 1000),
  ],
  wellington: [
    group("Water Supply", WELLINGTON_WATER_THREE_WATERS, "Wellington Water", [
      [13, "Water pipe"],
    ]),
    group("Wastewater", WELLINGTON_WATER_THREE_WATERS, "Wellington Water", [
      [18, "Wastewater pipe"],
      [19, "Wastewater connection pipe"],
    ]),
    group("Stormwater", WELLINGTON_WATER_THREE_WATERS, "Wellington Water", [
      [23, "Stormwater pipe"],
      [24, "Stormwater connection pipe"],
    ], 1000),
  ],
  christchurch: [
    group("Water Supply", CANTERBURY_THREE_WATERS, "Canterbury three waters open data", [
      [5, "Canterbury water supply pipeline"],
    ]),
    group("Wastewater", CANTERBURY_THREE_WATERS, "Canterbury three waters open data", [
      [4, "Canterbury wastewater pipeline"],
    ]),
    group("Stormwater", CANTERBURY_THREE_WATERS, "Canterbury three waters open data", [
      [3, "Canterbury stormwater pipeline"],
    ], 1000),
  ],
  canterbury: [
    group("Water Supply", CANTERBURY_THREE_WATERS, "Canterbury three waters open data", [
      [5, "Canterbury water supply pipeline"],
    ]),
    group("Wastewater", CANTERBURY_THREE_WATERS, "Canterbury three waters open data", [
      [4, "Canterbury wastewater pipeline"],
    ]),
    group("Stormwater", CANTERBURY_THREE_WATERS, "Canterbury three waters open data", [
      [3, "Canterbury stormwater pipeline"],
    ], 1000),
  ],
};

function group(
  name: RegionalServiceName,
  serviceUrl: string,
  owner: string,
  layers: Array<[number, string, string?]>,
  ruralSearchDistanceM = 500,
): RegionalInfrastructureGroup {
  return {
    name,
    serviceUrl,
    owner,
    maintainer: owner,
    ruralSearchDistanceM,
    layers: layers.map(([id, label, where]) => ({ id, label, where })),
  };
}

function searchEnvelope(lat: number, lng: number, parcelBbox: ParcelBbox | null | undefined, searchDistanceM: number): {
  geometry: string;
  geometryType: string;
  distanceM?: number;
} {
  if (parcelBbox) {
    const latPad = searchDistanceM / 111_320;
    const lngPad = searchDistanceM / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
    return {
      geometry: `${parcelBbox.minLng - lngPad},${parcelBbox.minLat - latPad},${parcelBbox.maxLng + lngPad},${parcelBbox.maxLat + latPad}`,
      geometryType: "esriGeometryEnvelope",
    };
  }
  return {
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    distanceM: searchDistanceM,
  };
}

async function queryRegionalInfrastructureLayer(
  group: RegionalInfrastructureGroup,
  layer: RegionalInfrastructureLayer,
  lat: number,
  lng: number,
  parcelBbox: ParcelBbox | null | undefined,
  searchDistanceM: number,
): Promise<InfrastructureFeature[]> {
  const geometry = searchEnvelope(lat, lng, parcelBbox, searchDistanceM);
  const url = new URL(`${group.serviceUrl}/${layer.id}/query`);
  url.searchParams.set("geometry", geometry.geometry);
  url.searchParams.set("geometryType", geometry.geometryType);
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("where", layer.where ?? "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("returnDistinctValues", "false");
  url.searchParams.set("f", "json");
  if (geometry.distanceM != null) {
    url.searchParams.set("distance", String(geometry.distanceM));
    url.searchParams.set("units", "esriSRUnit_Meter");
  }

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) });
  if (!resp.ok) throw new Error(`Regional infrastructure HTTP ${resp.status}`);
  const data = await resp.json() as {
    features?: InfrastructureFeature[];
    error?: { message?: string };
  };
  if (data.error) throw new Error(`Regional infrastructure error: ${data.error.message ?? "unknown"}`);
  return (data.features ?? []).map((feature) => ({
    ...feature,
    attributes: {
      ...feature.attributes,
      REGIONAL_SOURCE_LAYER: layer.label,
      REGIONAL_SOURCE_OWNER: group.owner,
    },
  }));
}

function chooseBetter(
  current: ReturnType<typeof classifyInfrastructureFeatures>,
  next: NonNullable<ReturnType<typeof classifyInfrastructureFeatures>>,
): NonNullable<ReturnType<typeof classifyInfrastructureFeatures>> {
  if (!current) return next;
  const rank: Record<InfrastructureItem["location"], number> = {
    "on-parcel": 0,
    boundary: 1,
    "public-land": 2,
    neighbour: 3,
    unknown: 4,
  };
  const currentRank = rank[current.location];
  const nextRank = rank[next.location];
  if (nextRank !== currentRank) return nextRank < currentRank ? next : current;
  return (next.distance_metres ?? Infinity) < (current.distance_metres ?? Infinity) ? next : current;
}

function missingService(group: RegionalInfrastructureGroup, searchDistanceM: number): InfrastructureItem {
  const critical = group.name === "Wastewater" || group.name === "Water Supply";
  return {
    name: group.name,
    location: "unknown",
    distance_metres: null,
    estimated_cost_low: critical ? 30000 : 15000,
    estimated_cost_high: critical ? 120000 : 60000,
    risk: critical ? "high" : "moderate",
    note: `No mapped public ${group.name.toLowerCase()} service found within ${searchDistanceM}m in ${group.owner} GIS - verify utility availability with the council before relying on yield or servicing assumptions`,
    search_radius_metres: searchDistanceM,
    service_source_owner: group.owner,
    service_source_maintainer: group.maintainer,
  };
}

function chooseBetterItem(current: InfrastructureItem | undefined, next: InfrastructureItem): InfrastructureItem {
  if (!current) return next;
  const rank: Record<InfrastructureItem["location"], number> = {
    "on-parcel": 0,
    boundary: 1,
    "public-land": 2,
    neighbour: 3,
    unknown: 4,
  };
  if (rank[next.location] !== rank[current.location]) {
    return rank[next.location] < rank[current.location] ? next : current;
  }
  return (next.distance_metres ?? Infinity) < (current.distance_metres ?? Infinity) ? next : current;
}

export function hasRegionalInfrastructureProvider(providerId: PlanningProviderId): boolean {
  return Boolean(REGIONAL_INFRASTRUCTURE[providerId]?.length);
}

export function regionalInfrastructureServiceLayers(providerId: PlanningProviderId): RegionalInfrastructureGroup[] {
  return REGIONAL_INFRASTRUCTURE[providerId] ?? [];
}

export async function fetchRegionalInfrastructure(
  providerId: PlanningProviderId,
  lat: number,
  lng: number,
  parcelBbox?: ParcelBbox | null,
  options?: InfrastructureFetchOptions,
): Promise<InfrastructureItem[]> {
  const groups = REGIONAL_INFRASTRUCTURE[providerId] ?? [];
  if (groups.length === 0) return [];

  const settled = await Promise.allSettled(groups.map(async (serviceGroup): Promise<InfrastructureItem> => {
    const searchDistanceM = infrastructureSearchDistanceMetres(
      serviceGroup.name,
      options,
      serviceGroup.ruralSearchDistanceM,
    );
    let best: ReturnType<typeof classifyInfrastructureFeatures> = null;
    const availabilityFeatures: InfrastructureFeature[] = [];

    for (const layer of serviceGroup.layers) {
      const features = await queryRegionalInfrastructureLayer(
        serviceGroup,
        layer,
        lat,
        lng,
        parcelBbox,
        searchDistanceM,
      ).catch(() => []);
      if (features.length === 0) continue;
      if (serviceGroup.availabilityOnly) {
        availabilityFeatures.push(...features);
        continue;
      }
      const classification = classifyInfrastructureFeatures(serviceGroup.name, lat, lng, features, parcelBbox);
      if (classification) best = chooseBetter(best, classification);
    }

    if (serviceGroup.availabilityOnly && availabilityFeatures.length > 0) {
      const values = [...new Set(availabilityFeatures.flatMap((feature) => {
        const attrs = feature.attributes ?? {};
        return [attrs["SCHEME"], attrs["TYPE"], attrs["COMMENTS"]]
          .map((value) => String(value ?? "").trim())
          .filter(Boolean);
      }))];
      return {
        name: serviceGroup.name,
        // A mapped supply/status area is not a physical on-parcel asset. Keep
        // it moderate-risk and explicitly avoid a fabricated pipe distance.
        location: "public-land",
        distance_metres: null,
        estimated_cost_low: 30_000,
        estimated_cost_high: 120_000,
        risk: "moderate",
        note: `Property is inside a mapped Selwyn Water supply/status area${values.length ? ` (${values.join("; ")})` : ""}. This confirms an application pathway, not an existing lateral, approval or network capacity; Selwyn Water must confirm connection conditions and charges.`,
        search_radius_metres: searchDistanceM,
        service_source_owner: serviceGroup.owner,
        service_source_maintainer: serviceGroup.maintainer,
      };
    }

    if (!best) return missingService(serviceGroup, searchDistanceM);
    return {
      name: serviceGroup.name,
      location: best.location,
      distance_metres: best.distance_metres,
      estimated_cost_low: best.estimated_cost_low,
      estimated_cost_high: best.estimated_cost_high,
      risk: best.risk,
      note: `${best.note} (${serviceGroup.owner} public GIS)`,
      search_radius_metres: searchDistanceM,
      service_source_owner: serviceGroup.owner,
      service_source_maintainer: serviceGroup.maintainer,
    };
  }));

  const itemsByName = new Map<RegionalServiceName, InfrastructureItem>();
  for (const item of settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : [])) {
    const serviceName = item.name as RegionalServiceName;
    itemsByName.set(serviceName, chooseBetterItem(itemsByName.get(serviceName), item));
  }
  const items = [...itemsByName.values()];
  const isPukehina = providerId === "western-bay"
    && lat >= -37.86 && lat <= -37.70
    && lng >= 176.40 && lng <= 176.56;
  return items.map((item) => isPukehina && item.name === "Wastewater" && item.location === "unknown"
    ? {
        ...item,
        note: "Pukehina has no mapped public wastewater connection and Western Bay of Plenty District Council has no current plan for a public wastewater scheme. Treat the property as on-site wastewater/septic until Council confirms otherwise.",
      }
    : item);
}

export function regionalInfrastructureSmokeTargets(): Array<{
  providerId: PlanningProviderId;
  serviceName: RegionalServiceName;
  serviceUrl: string;
  layerId: number;
  label: string;
}> {
  return Object.entries(REGIONAL_INFRASTRUCTURE).flatMap(([providerId, groups]) =>
    (groups ?? []).flatMap((serviceGroup) =>
      serviceGroup.layers.map((layer) => ({
        providerId: providerId as PlanningProviderId,
        serviceName: serviceGroup.name,
        serviceUrl: serviceGroup.serviceUrl,
        layerId: layer.id,
        label: layer.label,
      })),
    ),
  );
}
