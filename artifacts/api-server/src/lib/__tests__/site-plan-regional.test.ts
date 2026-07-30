import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLINZParcel, fetchLINZParcelsNear } from "../linz";
import { buildSitePlanForReport } from "../site-plan";
import { sitePlanLayerCacheKey } from "../site-plan-layer-cache";
import type { LinzParcel } from "../linz";
import type { RawPropertyData } from "../pipeline";

vi.mock("../linz", () => ({
  fetchLINZParcel: vi.fn(),
  fetchLINZParcelsNear: vi.fn(),
}));

vi.mock("../geocode", () => ({
  geocodeAddress: vi.fn(),
}));

const FLAG = "ENABLE_REGIONAL_PLANNING_PROVIDERS";
const originalLinzApiKey = process.env["LINZ_API_KEY"];
const originalLinzBasemapsApiKey = process.env["LINZ_BASEMAPS_API_KEY"];

const parcel: LinzParcel = {
  parcel_id: "hamilton-parcel",
  appellation: "Lot 1 DP 12345",
  area_sqm: 620,
  title_no: "SA1/1",
  legal_description: "Lot 1 DP 12345",
  topology_type: "Primary",
  bbox: {
    minLng: 175.278,
    maxLng: 175.28,
    minLat: -37.788,
    maxLat: -37.786,
    polygon: [
      [175.278, -37.788],
      [175.28, -37.788],
      [175.28, -37.786],
      [175.278, -37.786],
      [175.278, -37.788],
    ],
  },
};

describe("regional site-plan wrapper", () => {
  it("versions Manawatu layer-cache keys without changing existing provider keys", () => {
    expect(sitePlanLayerCacheKey("manawatu", "3956493", -40.2161, 175.5783))
      .toBe("manawatu-v1:parcel:3956493");
    expect(sitePlanLayerCacheKey("auckland", "123", -36.85, 174.76))
      .toBe("auckland:parcel:123");
  });

  beforeEach(() => {
    process.env[FLAG] = "true";
    process.env["LINZ_API_KEY"] = "";
    vi.clearAllMocks();
    vi.mocked(fetchLINZParcel).mockResolvedValue(null);
    vi.mocked(fetchLINZParcelsNear).mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
  });

  it("uses national parcel/aerial layers plus verified regional services for non-Auckland providers", async () => {
    const cachedRaw = {
      geocode: {
        lat: -37.787,
        lng: 175.279,
        formatted: "10 Victoria Street, Hamilton",
        suburb: "Hamilton",
      },
      linz_parcel: parcel,
    } as RawPropertyData;

    const sitePlan = await buildSitePlanForReport("10 Victoria Street, Hamilton", cachedRaw);

    expect(sitePlan.layers.filter((layer) => layer.group === "planning")).toEqual([]);
    expect(sitePlan.layers.filter((layer) => layer.group === "services").map((layer) => layer.label).sort()).toEqual([
      "Stormwater",
      "Wastewater",
      "Water Supply",
    ]);
  });

  it("shows New Plymouth public three-waters and the applicable airport control", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /OpenData_Infrastructure_(?:WaterSupply|Wastewater|Stormwater)\/FeatureServer\/(?:4|5|6|8|9)\/query/.test(url);
      const isAirportControl = url.includes("/OpenData_Strategy_DistrictPlan_PartOperative/FeatureServer/7/query");
      const features = isService
        ? [{ attributes: { OBJECTID: 1, AssetStage: "In Service" }, geometry: { paths: [[
            [174.0347, -39.0656], [174.0352, -39.0656],
          ]] } }]
        : isAirportControl
          ? [{ attributes: { OBJECTID: 11, Name: "1" }, geometry: { rings: [[
              [174.0345, -39.0659], [174.0354, -39.0659], [174.0354, -39.0653],
              [174.0345, -39.0653], [174.0345, -39.0659],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const sitePlan = await buildSitePlanForReport("70 Pioneer Road, Moturoa, New Plymouth", {
      geocode: {
        lat: -39.06562567,
        lng: 174.03497135,
        formatted: "70 Pioneer Road, Moturoa, New Plymouth",
        suburb: "Moturoa",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toContain("Airport Flight Path Surface");
  });

  it("shows current MPDC three-waters assets and the applicable wind control at 19 Centennial Avenue", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService =
        url.includes("/WaterLine/FeatureServer/488/query")
        || url.includes("/WasteWaterLine/FeatureServer/33/query")
        || url.includes("/StormWaterLine/FeatureServer/30/query");
      const isWind = url.includes("/Wind_Zones/FeatureServer/0/query");
      return new Response(JSON.stringify({
        features: isService ? [{
          attributes: { OBJECTID: 1 },
          geometry: { paths: [[[175.7070, -37.5352], [175.7078, -37.5352]]] },
        }] : isWind ? [{
          attributes: { OBJECTID: 2 },
          geometry: { rings: [[
            [175.7070, -37.5355], [175.7080, -37.5355], [175.7080, -37.5350],
            [175.7070, -37.5350], [175.7070, -37.5355],
          ]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("19 Centennial Ave, Te Aroha", {
      geocode: {
        lat: -37.5352280,
        lng: 175.7074969,
        formatted: "19 Centennial Avenue, Te Aroha 3320, New Zealand",
        suburb: "Te Aroha",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(["Wind Zone"]);
  });

  it("shows Taupō three-waters and applicable planning controls for Kinloch", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /assetfinda\/(?:Water|Wastewater|Stormwater)_Pipe\/FeatureServer\/0\/query/.test(url);
      const isRoadControl = url.includes("/districtplan/ePlan_Server/MapServer/1/query");
      return new Response(JSON.stringify({
        features: isService || isRoadControl ? [{
          attributes: { OBJECTID: 1, Asset_Type: "Main", Potable: "Yes", Status: "In Service" },
          geometry: { paths: [[[175.9760, -38.6206], [175.9770, -38.6206]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("302 Whangamata Road, Kinloch", {
      geocode: {
        lat: -38.6206095,
        lng: 175.9763673,
        formatted: "302 Whangamata Road, Kinloch, Taupō District, Waikato",
        suburb: "Kinloch",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toContain("Road Hierarchy");
  });

  it("returns one row per Manawatu service while combining PNCC and MDC public feeds", async () => {
    process.env["LINZ_BASEMAPS_API_KEY"] = "test-basemaps-key";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isMdcService = url.includes("services9.arcgis.com/CzWZ8m5FuciqBibe")
        && /GIS_(?:WATER|WASTEWATER|STORMWATER)_LINE_LN/.test(url);
      const isMdcControl = url.includes("/Deferred_Residential_Overlay/FeatureServer/1/query");
      const features = isMdcService
        ? [{ attributes: { FID: 1 }, geometry: { paths: [[[175.5647, -40.225], [175.5653, -40.225]]] } }]
        : isMdcControl
          ? [{ attributes: { OBJECTID: 1 }, geometry: { rings: [[
              [175.5645, -40.2253], [175.5655, -40.2253], [175.5655, -40.2247],
              [175.5645, -40.2247], [175.5645, -40.2253],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("Manchester Street, Feilding", {
      geocode: { lat: -40.225, lng: 175.565, formatted: "Manchester Street, Feilding", suburb: "Feilding" },
      linz_parcel: {
        parcel_id: "manawatu-acceptance-parcel",
        appellation: "Lot 1 DP 12345",
        area_sqm: 751,
        title_no: "WN1/1",
        legal_description: "Lot 1 DP 12345",
        topology_type: "Primary",
        bbox: {
          minLng: 175.5647,
          maxLng: 175.5653,
          minLat: -40.2253,
          maxLat: -40.2247,
          polygon: [
            [175.5647, -40.2253], [175.5653, -40.2253], [175.5653, -40.2247],
            [175.5647, -40.2247], [175.5647, -40.2253],
          ],
        },
      },
    } as RawPropertyData);

    expect(sitePlan.image).toMatchObject({ available: true, source: "linz-basemaps" });
    expect(sitePlan.image.tiles?.length).toBeGreaterThan(0);
    expect(sitePlan.layers.find((layer) => layer.label === "Parcel Boundary")).toMatchObject({ available: true });
    expect(sitePlan.layers.filter((layer) => layer.group === "services").map((layer) => layer.label).sort())
      .toEqual(["Potable Water", "Stormwater", "Wastewater"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "services").every((layer) => layer.available)).toBe(true);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toContain("Deferred Residential Overlay");
  });

  it("adds verified regional planning overlays when ArcGIS returns features", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [
        {
          attributes: { OBJECTID: 1, NAME: "Regional planning feature" },
          geometry: {
            rings: [[
              [175.278, -37.788],
              [175.28, -37.788],
              [175.28, -37.786],
              [175.278, -37.786],
              [175.278, -37.788],
            ]],
          },
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const cachedRaw = {
      geocode: {
        lat: -37.787,
        lng: 175.279,
        formatted: "10 Victoria Street, Hamilton",
        suburb: "Hamilton",
      },
      linz_parcel: parcel,
    } as RawPropertyData;

    const sitePlan = await buildSitePlanForReport("10 Victoria Street, Hamilton", cachedRaw);

    expect(sitePlan.layers.some((layer) => layer.group === "planning")).toBe(true);
    expect(sitePlan.layers.some((layer) => layer.group === "services")).toBe(true);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning").some((layer) => layer.available)).toBe(true);
  });

  it("builds Athenree Site Plan layers from Western Bay three-waters and hazard controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /\/WBP\/WBP_(?:Water|Wastewater|Stormwater)_REST_[Ss]ervices\/MapServer\/(?:16|18|19)\/query/.test(url);
      const isWave = /\/Other_Natural_Hazards\/MapServer\/(?:10|11)\/query/.test(url);
      const isLiquefaction = url.includes("/Other_Natural_Hazards/MapServer/12/query");
      const features = isService
        ? [{ attributes: { OBJECTID: 1 }, geometry: { paths: [[[175.9641, -37.4461], [175.9646, -37.4461]]] } }]
        : isWave || isLiquefaction
          ? [{ attributes: { Zone: "Yellow", LiquefactionVulnerabilityCatego: "Possible" }, geometry: { rings: [[
              [175.9638, -37.4464], [175.9648, -37.4464], [175.9648, -37.4457], [175.9638, -37.4457], [175.9638, -37.4464],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("30 Athenree Road, Athenree", {
      geocode: {
        lat: -37.4460583,
        lng: 175.9643635,
        formatted: "30 Athenree Road, Athenree, Bay of Plenty",
        suburb: "Athenree",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Liquefaction Vulnerability", "Tsunami / 1 in 2500 Year Wave", "Tsunami / 5m Wave Height"]);
  });

  it("builds Pukehina Site Plan with water, stormwater, hazard controls, and no invented sewer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isWaterOrStormwater = /\/WBP\/WBP_(?:Water|Stormwater)_REST_[Ss]ervices\/MapServer\/(?:18|19)\/query/.test(url);
      const isHazard = /\/Other_Natural_Hazards\/MapServer\/(?:10|11|12)\/query/.test(url);
      const features = isWaterOrStormwater
        ? [{ attributes: { OBJECTID: 1 }, geometry: { paths: [[[176.4993, -37.7721], [176.4998, -37.7721]]] } }]
        : isHazard
          ? [{ attributes: { Zone: "Yellow", LiquefactionVulnerabilityCatego: "Possible" }, geometry: { rings: [[
              [176.4991, -37.7724], [176.4999, -37.7724], [176.4999, -37.7718], [176.4991, -37.7718], [176.4991, -37.7724],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("481 Pukehina Parade, Pukehina", {
      geocode: { lat: -37.7720624, lng: 176.4995595, formatted: "481 Pukehina Parade, Pukehina Beach, Western Bay of Plenty District", suburb: "Pukehina" },
      linz_parcel: null,
    } as RawPropertyData);
    const services = sitePlan.layers.filter((layer) => layer.group === "services");
    expect(services.find((layer) => layer.label === "Water Supply")?.available).toBe(true);
    expect(services.find((layer) => layer.label === "Stormwater")?.available).toBe(true);
    expect(services.find((layer) => layer.label === "Wastewater")?.available).toBe(false);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Liquefaction Vulnerability", "Tsunami / 1 in 2500 Year Wave", "Tsunami / 5m Wave Height"]);
  });

  it("builds Wycliffe Site Plan with Napier services and applicable planning hazards", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /717214_Napier_City_Council_layers\/FeatureServer\/(?:4|5|6)\/query/.test(url);
      const isFlowPath = url.includes("/OperativeDistrictPlan_2025/MapServer/24/query");
      const isHazard = /HBRC_Property_Hazards\/MapServer\/(?:16|21|24)\/query/.test(url);
      const features = isService
        ? [{ attributes: { FID: 1, ALLOW_CON: "Yes" }, geometry: { paths: [[[176.8913, -39.5114], [176.8919, -39.5110]]] } }]
        : isFlowPath
          ? [{ attributes: { NAME: "C801" }, geometry: { paths: [[[176.8913, -39.5114], [176.8919, -39.5110]]] } }]
        : isHazard
          ? [{ attributes: {
              NAME: "C801",
              F3604_haza: "High",
              Hazard_Description: "High liquefaction vulnerability",
              Relative_Earthquake_Amplificati: "Unconsolidated and reclaimed land",
              Class: "Low risk areas",
            }, geometry: { rings: [[
              [176.8910, -39.5116], [176.8920, -39.5116], [176.8920, -39.5109],
              [176.8910, -39.5109], [176.8910, -39.5116],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("23 Wycliffe Street, Onekawa, Napier", {
      geocode: {
        lat: -39.5112541,
        lng: 176.8915180,
        formatted: "23 Wycliffe Street, Onekawa, Napier City, Hawke's Bay",
        suburb: "Onekawa",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(expect.arrayContaining([
        "Overland Flow Path",
        "Liquefaction Vulnerability",
        "Earthquake Ground Amplification",
        "Flood Risk Area",
      ]));
  });

  it("builds 226 Havelock Road Site Plan with Hastings public services and applicable hazards", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /3WatersAssets\/MapServer\/(?:2|3|4|11|12|13|20|22|32)\/query/.test(url);
      const isHazard = /HBRC_Property_Hazards\/MapServer\/(?:16|17|18|19|21|24)\/query/.test(url);
      const features = isService
        ? [{
            attributes: { OBJECTID: 1, IPS_Ownership: "PUB", IPS_Service_Status: "INS" },
            geometry: { paths: [[[176.8593, -39.6554], [176.8600, -39.6550]]] },
          }]
        : isHazard
          ? [{
              attributes: {
                F3604_haza: "Medium",
                LSN_25y: "Insignificant",
                LSN_100y: "Moderate",
                LSN_500y: "Moderate",
                Relative_Earthquake_Amplificati: "Alluvial sand, silt and gravel",
                Location: "Heretaunga Plains",
                Class: "Low flood risk",
              },
              geometry: { rings: [[
                [176.8589, -39.6558], [176.8603, -39.6558], [176.8603, -39.6547],
                [176.8589, -39.6547], [176.8589, -39.6558],
              ]] },
            }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("226 Havelock Road, Akina, Hastings", {
      geocode: {
        lat: -39.65520308,
        lng: 176.85964827,
        formatted: "226 Havelock Road, Akina, Hastings, Hawke's Bay",
        suburb: "Akina",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(expect.arrayContaining([
        "Liquefaction Vulnerability",
        "Liquefaction Severity - 25 Year",
        "Liquefaction Severity - 100 Year",
        "Liquefaction Severity - 500 Year",
        "Earthquake Ground Amplification",
        "Flood Risk Area",
      ]));
    expect(sitePlan.layers.some((layer) => layer.label === "Heritage Feature")).toBe(false);
  });

  it("returns Waipa three-waters and only marks applicable planning overlays available", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /WaterSupplyPipesWaikato|WastewaterPipesWaikato|StormwaterPipesWaikato/.test(url);
      const where = new URL(url).searchParams.get("where") ?? "";
      const isApplicableQualifyingMatter = url.includes("WaipaDistrictPlan_QualifyingMatters")
        && /Infrastructure Constraint|Stormwater Constraint/.test(where);
      const features = isService
        ? [{ attributes: { OBJECTID: 1, Council: "Waipa District Council" }, geometry: { paths: [[[175.4777, -37.8849], [175.4781, -37.8846]]] } }]
        : isApplicableQualifyingMatter
          ? [{ attributes: { FID: 1, Category: "Qualifying Matter", Source: "Plan Change 26" }, geometry: { rings: [[
              [175.4775, -37.8850], [175.4783, -37.8850], [175.4783, -37.8845], [175.4775, -37.8845], [175.4775, -37.8850],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePlan = await buildSitePlanForReport("91 Thornton Road, Cambridge", {
      geocode: {
        lat: -37.88476037,
        lng: 175.47794877,
        formatted: "91 Thornton Road, Cambridge",
        suburb: "Cambridge",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Infrastructure Constraint Qualifying Matter", "Stormwater Constraint Qualifying Matter"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && !layer.available)).toEqual([]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("where=Category"))).toBe(true);
  });

  it("returns Tauranga three-waters and applicable controls for 16 Lodge Avenue", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = /Water_Supply_Common_Mapservices|Wastewater_Common_Mapservices|Stormwater_Common_Mapservices/.test(url);
      const isAirport = url.includes("/ePlan_Section5/MapServer/4/query");
      const isViewshaft = url.includes("/ePlan_Section7/MapServer/0/query");
      const isLiquefaction = url.includes("/Liquefaction/MapServer/0/query");
      const features = isService
        ? [{ attributes: { OBJECTID: 1 }, geometry: { paths: [[[176.2108, -37.6647], [176.2114, -37.6647]]] } }]
        : isAirport || isViewshaft || isLiquefaction
          ? [{ attributes: { Height: 49, MaxHeight: 11, LiquefactionVulnerability: "Possible" }, geometry: { rings: [[
              [176.2106, -37.6650], [176.2116, -37.6650], [176.2116, -37.6643],
              [176.2106, -37.6643], [176.2106, -37.6650],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("16 Lodge Avenue, Mount Maunganui, Tauranga", {
      geocode: {
        lat: -37.6646905,
        lng: 176.2110862,
        formatted: "16 Lodge Avenue, Omanu, Mount Maunganui, Tauranga City, Bay of Plenty",
        suburb: "Mount Maunganui",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(expect.arrayContaining([
        "Airport Height Slope and Surface",
        "Viewshaft Building Elevation",
        "Liquefaction Vulnerability",
      ]));
  });

  it("returns Kāpiti three-waters and applicable controls for 37 Tieko Street", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = url.includes("/Public/Services/MapServer/");
      const isFlood = url.includes("/Latest_Flood_Hazards/MapServer/6/query");
      const isCoastal = url.includes("/District_Plan_Overlays/MapServer/30/query");
      const isAirport = url.includes("/District_Plan_Miscellaneous/MapServer/3/query");
      const features = isService
        ? [{ attributes: { OBJECTID: 1 }, geometry: { paths: [[[175.0205, -40.8839], [175.0212, -40.8839]]] } }]
        : isFlood || isCoastal || isAirport
          ? [{ attributes: { ZONE: "Ponding", Type: "Horizontal Surface 50m A.M.S.L" }, geometry: { rings: [[
              [175.0186, -40.8842], [175.0216, -40.8842], [175.0216, -40.8811],
              [175.0186, -40.8811], [175.0186, -40.8842],
            ]] } }]
          : [];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const sitePlan = await buildSitePlanForReport("37 Tieko Street, Otaihanga, Kāpiti Coast", {
      geocode: {
        lat: -40.8838658,
        lng: 175.0208898,
        formatted: "37 Tieko Street, Otaihanga, Paraparaumu, Kāpiti Coast District, Wellington",
        suburb: "Otaihanga",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(expect.arrayContaining(["Ponding Area", "Coastal Environment", "Airport Plan and Surface"]));
  });

  it("omits non-applicable planning controls while keeping all three service rows for Rotorua and Whakatane", async () => {
    const samples = [
      { providerId: "rotorua" as const, address: "85 Whittaker Road, Koutu, Rotorua", lat: -38.1251, lng: 176.2438 },
      { providerId: "whakatane" as const, address: "1134 Braemar Road, Rotoma", lat: -38.0166, lng: 176.7157 },
      { providerId: "whakatane" as const, address: "1140 Braemar Rd, Rotorua", lat: -38.0156, lng: 176.7193 },
    ];

    for (const sample of samples) {
      const cachedRaw = {
        geocode: { lat: sample.lat, lng: sample.lng, formatted: sample.address, suburb: null },
        linz_parcel: null,
      } as RawPropertyData;
      const sitePlan = await buildSitePlanForReport(sample.address, cachedRaw);
      const planning = sitePlan.layers.filter((layer) => layer.group === "planning");
      const services = sitePlan.layers.filter((layer) => layer.group === "services");

      expect(planning).toEqual([]);
      expect(services.map((layer) => layer.label).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    }
  });

  it("queries Whakatane controls and three-waters layers for 1140 while leaving empty layers unavailable", async () => {
    const cachedRaw = {
      geocode: {
        lat: -38.0155546,
        lng: 176.7193241,
        formatted: "1140 BRAEMAR ROAD, Rotoma, New Zealand",
        suburb: "rotoma",
      },
      linz_parcel: null,
    } as RawPropertyData;

    const sitePlan = await buildSitePlanForReport("1140 Braemar Rd, Rotorua", cachedRaw);
    const requestUrls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));

    expect(requestUrls.some((url) => url.includes("/OperativeDistrictPlanNPS_ePlan/MapServer/8/query"))).toBe(true);
    expect(requestUrls.some((url) => url.includes("/ThreeWaters/WaterSupplyAssets/MapServer/"))).toBe(true);
    expect(requestUrls.some((url) => url.includes("/ThreeWaters/WasteWaterAssets/MapServer/"))).toBe(true);
    expect(requestUrls.some((url) => url.includes("/ThreeWaters/StormWaterAssets/MapServer/"))).toBe(true);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" || layer.group === "services")
      .every((layer) => !layer.available && layer.geojson.features.length === 0)).toBe(true);
  });

  it("marks only the applicable Whakatane overlay available at 2926A State Highway 30", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isHighwayBuffer = url.includes("/OperativeDistrictPlanNPS_ePlan/MapServer/71/query");
      return new Response(JSON.stringify({
        features: isHighwayBuffer ? [{
          attributes: { OBJECTID: 1, NAME: "State Highway Buffer" },
          geometry: { rings: [[
            [176.7088, -38.0270],
            [176.7107, -38.0270],
            [176.7107, -38.0257],
            [176.7088, -38.0257],
            [176.7088, -38.0270],
          ]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePlan = await buildSitePlanForReport(
      "2926A STATE HIGHWAY 30, Rotomā, New Zealand",
      {
        geocode: {
          lat: -38.0263534,
          lng: 176.7097369,
          formatted: "2926A STATE HIGHWAY 30, Rotomā, New Zealand",
          suburb: "rotoma",
        },
        linz_parcel: {
          parcel_id: "onepu-large-rural-parcel",
          appellation: "Lot 1 DPS 12345",
          area_sqm: 42_320,
          title_no: null,
          legal_description: "Lot 1 DPS 12345",
          topology_type: "Primary",
          bbox: {
            minLng: 176.706,
            maxLng: 176.713,
            minLat: -38.029,
            maxLat: -38.023,
            polygon: [
              [176.706, -38.029], [176.713, -38.029], [176.713, -38.023],
              [176.706, -38.023], [176.706, -38.029],
            ],
          },
        },
      } as RawPropertyData,
    );

    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(["State Highway Buffer"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "services").every((layer) => !layer.available)).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("WaterSupplyAssets"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("WasteWaterAssets"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("StormWaterAssets"))).toBe(true);
    const highwayRequest = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/MapServer/71/query"));
    expect(highwayRequest).toBeDefined();
    expect(new URL(highwayRequest!).searchParams.get("geometryType")).toBe("esriGeometryPoint");
  });

  it("shows Selwyn public services and applicable district-plan controls at 100 Birchs Road", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = url.includes("/SDC_Public/WATER_Water/MapServer/")
        || url.includes("/SDC_Public/Water_Sewer/MapServer/")
        || url.includes("/SDC_Public/WATER_Stormwater/MapServer/");
      const isBirdstrike = url.includes("/SelwynDistrictPlan2020/MapServer/39/query");
      const isFlood = url.includes("/SelwynDistrictPlan2020/MapServer/8/query");
      const features = isService ? [{
        attributes: { OBJECTID: 1, STATUS: "IN SERVICE" },
        geometry: { paths: [[[172.5097, -43.5930], [172.5108, -43.5930]]] },
      }] : isBirdstrike || isFlood ? [{
        attributes: isBirdstrike ? { Label: "13km Bird Strike Risk Overlay" } : { Name: "Plains Flood Management" },
        geometry: { rings: [[
          [172.5095, -43.5934], [172.5109, -43.5934], [172.5109, -43.5923],
          [172.5095, -43.5923], [172.5095, -43.5934],
        ]] },
      }] : [];
      return new Response(JSON.stringify({ features, fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePlan = await buildSitePlanForReport("100 Birchs Road, Prebbleton", {
      geocode: {
        lat: -43.5929461,
        lng: 172.5104991,
        formatted: "100 Birchs Road, Prebbleton, Selwyn District, Canterbury",
        suburb: "Prebbleton",
      },
      linz_parcel: {
        parcel_id: "7702456",
        appellation: "Lot 7 DP 494658",
        area_sqm: 4_621,
        title_no: "724483",
        legal_description: "Lot 7 DP 494658",
        topology_type: "Primary",
        bbox: {
          minLng: 172.50972, maxLng: 172.51064, minLat: -43.59321, maxLat: -43.59247,
          polygon: [
            [172.50972, -43.59321], [172.51064, -43.59321], [172.51064, -43.59247],
            [172.50972, -43.59247], [172.50972, -43.59321],
          ],
        },
      },
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(expect.arrayContaining(["13km Birdstrike Overlay", "Plains Flood Management Overlay"]));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/SDC_Public/Water_Sewer/MapServer/4/query"))).toBe(true);
    const wastewaterRequest = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/SDC_Public/Water_Sewer/MapServer/4/query"));
    const envelope = JSON.parse(String(new URL(wastewaterRequest!).searchParams.get("geometry"))) as {
      xmin: number; ymin: number; xmax: number; ymax: number;
    };
    expect((envelope.ymax - envelope.ymin) * 111_320).toBeGreaterThanOrEqual(1_000);
    expect((envelope.xmax - envelope.xmin) * 111_320 * Math.cos((-43.5929461 * Math.PI) / 180))
      .toBeGreaterThanOrEqual(1_000);
  });

  it("shows TCDC public services and applicable controls at 111 Rolleston Street", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = url.includes("/TCDC_3Waters/FeatureServer/");
      const isCoastal = url.includes("/TCDC_Decisions_District_Plan/FeatureServer/14/query");
      const isFlood = url.includes("/TCDC_Decisions_District_Plan/FeatureServer/27/query");
      const features = isService ? [{
        attributes: { OBJECTID: 1, Status: "IN SERVICE", AssetOwner: "TCDC" },
        geometry: { paths: [[[175.5504, -37.1480], [175.5511, -37.1480]]] },
      }] : isCoastal || isFlood ? [{
        attributes: isCoastal
          ? { label: "Coastal Environment", name: "Coastal Environment Line 2020" }
          : { hazard_code: "FHAD", hazard_type: "Defended", classification: "Defended Area" },
        geometry: { rings: [[
          [175.5502, -37.1482], [175.5512, -37.1482], [175.5512, -37.1474],
          [175.5502, -37.1474], [175.5502, -37.1482],
        ]] },
      }] : [];
      return new Response(JSON.stringify({ features, fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePlan = await buildSitePlanForReport("111 Rolleston Street, Thames", {
      geocode: {
        lat: -37.14783098,
        lng: 175.55078515,
        formatted: "111 Rolleston Street, Thames, Waikato",
        suburb: "Thames",
      },
      linz_parcel: {
        parcel_id: "thames-111",
        appellation: "Lot 1",
        area_sqm: 1_012,
        title_no: "test",
        legal_description: "Lot 1",
        topology_type: "Primary",
        bbox: {
          minLng: 175.55045, maxLng: 175.55105, minLat: -37.14810, maxLat: -37.14755,
          polygon: [
            [175.55045, -37.14810], [175.55105, -37.14810], [175.55105, -37.14755],
            [175.55045, -37.14755], [175.55045, -37.14810],
          ],
        },
      },
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning" && layer.available).map((layer) => layer.label))
      .toEqual(expect.arrayContaining(["Coastal Environment", "Flood Hazard"]));
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/TCDC_3Waters/FeatureServer/4/query"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/TCDC_3Waters/FeatureServer/5/query"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/TCDC_3Waters/FeatureServer/6/query"))).toBe(true);
  });

  it("shows Buller public services, floor-level control, and council parcel at 175 Romilly Street", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/BDC_Property_Master_Public_View/FeatureServer/1/query")) {
        return new Response(JSON.stringify({
          features: [{
            attributes: {
              OBJECTID: 16765,
              Appellation: "Lot 2 DP 4334",
              Titles: "NL43/96",
              SurveyArea: 1_012,
              ParcelID: 3_596_659,
            },
            geometry: { rings: [[
              [171.60635, -41.76320], [171.60695, -41.76320], [171.60695, -41.76265],
              [171.60635, -41.76265], [171.60635, -41.76320],
            ]] },
          }],
        }), { status: 200 });
      }
      const isService = url.includes("/Water_Supply_Services_Public_View/FeatureServer/")
        || url.includes("/Sewer_Services_Public_View/FeatureServer/")
        || url.includes("/Stormwater_Services_Public_View/FeatureServer/");
      const isFloorLevel = url.includes("/Westport_Minimum_Floor_Level_Information_Values/FeatureServer/0/query");
      const features = isService ? [{
        attributes: { OBJECTID: 1, ASSET_OWNER: "Local Authority" },
        geometry: { paths: [[[171.6064, -41.7630], [171.6070, -41.7630]]] },
      }] : isFloorLevel ? [{
        attributes: { OBJECTID: 2370821, grid_code: 5.4981 },
        geometry: { x: 171.60661, y: -41.76296 },
      }] : [];
      return new Response(JSON.stringify({ features, fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePlan = await buildSitePlanForReport("175 Romilly Street, Westport", {
      geocode: {
        lat: -41.76295052,
        lng: 171.60663355,
        formatted: "175 Romilly Street, Westport, Buller District, West Coast",
        suburb: "Westport",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.find((layer) => layer.id === "boundary")).toMatchObject({
      available: true,
      defaultVisible: true,
    });
    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.find((layer) => layer.label === "Westport Minimum Floor Level (NZVD2016)"))
      .toMatchObject({ group: "planning", available: true });
    const serviceRequests = fetchMock.mock.calls
      .map((call) => new URL(String(call[0])))
      .filter((url) => /(?:Water_Supply|Sewer|Stormwater)_Services_Public_View/.test(url.pathname));
    expect(serviceRequests.length).toBeGreaterThan(0);
    expect(serviceRequests.every((url) => url.searchParams.get("where") === "ASSET_OWNER = 'Local Authority'")).toBe(true);
  });

  it("returns thin, subtle contours for a phone-sized aerial", async () => {
    process.env["LINZ_API_KEY"] = "test-linz-key";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/wfs")) {
        return new Response(JSON.stringify({
          type: "FeatureCollection",
          features: [{
            type: "Feature",
            properties: { elevation: 120 },
            geometry: {
              type: "LineString",
              coordinates: [[176.708, -38.027], [176.711, -38.025]],
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ features: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const sitePlan = await buildSitePlanForReport("2926A State Highway 30, Onepu", {
      geocode: {
        lat: -38.0263534,
        lng: 176.7097369,
        formatted: "2926A STATE HIGHWAY 30, Rotomā, New Zealand",
        suburb: "rotoma",
      },
      linz_parcel: null,
    } as RawPropertyData);
    const contours = sitePlan.layers.find((layer) => layer.id === "contours");

    expect(contours).toMatchObject({
      available: true,
      style: { stroke: "#FACC15", strokeWidth: 0.8, strokeOpacity: 0.58 },
    });
    expect(contours?.geojson.features).toHaveLength(1);
  });

  it("shows Southland's three applicable services and omits non-applicable controls at 77 Kruger Street", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isService = url.includes("/External_ThreeWaters_Layers_v2/MapServer/");
      return new Response(JSON.stringify({
        features: isService ? [{
          attributes: { OBJECTID: 1, Status: "IN" },
          geometry: { paths: [[[168.5811, -45.8375], [168.5819, -45.8371]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const sitePlan = await buildSitePlanForReport("77 Kruger Street, Balfour, Southland 9746", {
      geocode: {
        lat: -45.8372796,
        lng: 168.5815783,
        formatted: "77 Kruger Street, Balfour, Southland 9746",
        suburb: "Balfour",
      },
      linz_parcel: null,
    } as RawPropertyData);

    expect(sitePlan.layers.filter((layer) => layer.group === "services" && layer.available).map((layer) => layer.label).sort())
      .toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(sitePlan.layers.filter((layer) => layer.group === "planning")).toEqual([]);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/EPLAN_DISTRICT_PLAN_AGOL/FeatureServer/15/query"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/External_ThreeWaters_Layers_v2/MapServer/14/query"))).toBe(true);
  });

  afterEach(() => {
    delete process.env[FLAG];
    vi.unstubAllGlobals();
    if (originalLinzApiKey == null) {
      delete process.env["LINZ_API_KEY"];
    } else {
      process.env["LINZ_API_KEY"] = originalLinzApiKey;
    }
    if (originalLinzBasemapsApiKey == null) {
      delete process.env["LINZ_BASEMAPS_API_KEY"];
    } else {
      process.env["LINZ_BASEMAPS_API_KEY"] = originalLinzBasemapsApiKey;
    }
  });
});
