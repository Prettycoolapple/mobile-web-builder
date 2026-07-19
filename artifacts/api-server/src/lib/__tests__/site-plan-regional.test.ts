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
