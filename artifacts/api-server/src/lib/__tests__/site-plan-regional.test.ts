import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchLINZParcel, fetchLINZParcelsNear } from "../linz";
import { buildSitePlanForReport } from "../site-plan";
import { regionalSitePlanOverlayLayers } from "../regional-arcgis";
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

    const planningLayers = sitePlan.layers.filter((layer) => layer.group === "planning");
    expect(planningLayers).toHaveLength(regionalSitePlanOverlayLayers("hamilton").length);
    expect(planningLayers.every((layer) => layer.available === false)).toBe(true);
    expect(planningLayers.some((layer) => /designation|control|corridor/i.test(layer.label))).toBe(true);
    expect(sitePlan.layers.filter((layer) => layer.group === "services").map((layer) => layer.label).sort()).toEqual([
      "Stormwater",
      "Wastewater",
      "Water Supply",
    ]);
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

  it("shows planning controls and all three service rows for Rotorua and Whakatane", async () => {
    const samples = [
      { providerId: "rotorua" as const, address: "85 Whittaker Road, Koutu, Rotorua", lat: -38.1251, lng: 176.2438 },
      { providerId: "whakatane" as const, address: "1134 Braemar Road, Rotoma", lat: -38.0166, lng: 176.7157 },
    ];

    for (const sample of samples) {
      const cachedRaw = {
        geocode: { lat: sample.lat, lng: sample.lng, formatted: sample.address, suburb: null },
        linz_parcel: null,
      } as RawPropertyData;
      const sitePlan = await buildSitePlanForReport(sample.address, cachedRaw);
      const planning = sitePlan.layers.filter((layer) => layer.group === "planning");
      const services = sitePlan.layers.filter((layer) => layer.group === "services");

      expect(planning).toHaveLength(regionalSitePlanOverlayLayers(sample.providerId).length);
      expect(planning.some((layer) => /designation|precinct|development|control/i.test(layer.label))).toBe(true);
      expect(services.map((layer) => layer.label).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    }
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
