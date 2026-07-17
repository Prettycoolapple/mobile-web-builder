import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLINZParcel, fetchLINZParcelsNear } from "../linz";
import { buildSitePlanForReport } from "../site-plan";
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

  it("returns high-contrast contours that remain visible on a phone-sized aerial", async () => {
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
      style: { stroke: "#FACC15", strokeWidth: 1.6, strokeOpacity: 0.95 },
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
  });
});
