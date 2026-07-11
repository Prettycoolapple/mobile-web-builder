import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRegionalPlanningOverlays,
  fetchRegionalPlanningZone,
  regionalPlanningSmokeTargets,
} from "../regional-arcgis";
import type { RegionalJurisdiction } from "../regional-planning";

function jurisdiction(providerId: RegionalJurisdiction["providerId"]): RegionalJurisdiction {
  return {
    providerId,
    providerName: "Test regional provider",
    territorialAuthority: "Test Council",
    region: "Test Region",
    coverageStatus: "partial",
    planName: "Test Plan",
    endpointRefs: [],
    reason: "test",
  };
}

describe("regional ArcGIS planning fetchers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("decodes coded-value zone fields into readable regional zone descriptions", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/query")) {
        return new Response(JSON.stringify({
          features: [
            {
              attributes: {
                OBJECTID: 3041,
                Zone: "21",
                Stage: "Stage 1 and 2",
                Label: null,
              },
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        fields: [
          {
            name: "Zone",
            domain: {
              type: "codedValue",
              codedValues: [{ code: "21", name: "Queenstown Town Centre" }],
            },
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const zone = await fetchRegionalPlanningZone(jurisdiction("qldc"), -45.031, 168.662);

    expect(zone).toMatchObject({
      zone_code: "21",
      zone_description: expect.stringContaining("Queenstown Town Centre"),
      min_lot_size_sqm: null,
    });
    expect(zone.raw_zone).toContain("\"Zone\":\"21\"");
  });

  it("maps Nelson Top of the South planning zone fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/query")) {
        return new Response(JSON.stringify({
          features: [
            {
              attributes: {
                OBJECTID: 4488,
                ZONES: "Residential - Lower Density",
                LABEL: null,
                STATUS: null,
                Council: "Nelson City Council",
              },
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const zone = await fetchRegionalPlanningZone(jurisdiction("nelson"), -41.306, 173.222);

    expect(zone).toMatchObject({
      zone_code: "Residential - Lower Density",
      zone_description: expect.stringContaining("Residential - Lower Density"),
      min_lot_size_sqm: null,
    });
    expect(zone.zone_description).toContain("Nelson Planning Zone");
  });

  it("tries parcel geometry before falling back to point geometry for regional zones", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/query")) {
        const isParcelQuery = url.includes("esriGeometryPolygon");
        return new Response(JSON.stringify({
          features: isParcelQuery
            ? []
            : [
                {
                  attributes: {
                    OBJECTID: 11788,
                    ZONE: "Rural Production Zone",
                    ePlanDisplayField: "Rural production zone",
                  },
                },
              ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(jurisdiction("whangarei"), -35.754, 174.176, {
      minLng: 174.17,
      maxLng: 174.18,
      minLat: -35.76,
      maxLat: -35.75,
      polygon: [
        [174.17, -35.76],
        [174.18, -35.76],
        [174.18, -35.75],
        [174.17, -35.75],
      ],
    });

    expect(zone.zone_code).toBe("Rural Production Zone");
    const queryUrls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/query"));
    expect(queryUrls[0]).toContain("esriGeometryPolygon");
    expect(queryUrls.some((url) => url.includes("esriGeometryPoint"))).toBe(true);
  });

  it("uses the query-capable Hutt City District Plan service for Wellington-region zoning", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/DistrictPlan/DistrictPlan/MapServer/59/query")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/Hutt_City_District_Plan/MapServer/39/query")) {
        return new Response(JSON.stringify({
          features: [
            {
              attributes: {
                OBJECTID: 492,
                Activity_Area: "Medium Density Residential",
                Description: "",
                Suburb: null,
                Type: null,
                Notes: "PC56",
              },
            },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(jurisdiction("wellington"), -41.285791, 174.950586);

    expect(zone.zone_code).toBe("Medium Density Residential");
    expect(zone.zone_description).toContain("Medium Density Residential");
    expect(zone.zone_description).toContain("Hutt City District Plan Activity Areas");
    const queryUrls = fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.includes("/query"));
    expect(queryUrls.some((url) => url.includes("/Hutt_City_District_Plan/MapServer/39/query"))).toBe(true);
  });

  it("maps configured regional overlay hits into conservative report overlays", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [
        {
          attributes: {
            NAME: "Example heritage area",
            Type: "Heritage",
          },
        },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const overlays = await fetchRegionalPlanningOverlays(jurisdiction("christchurch"), -43.532, 172.636);

    expect(overlays.length).toBeGreaterThan(0);
    expect(overlays[0]).toMatchObject({
      name: "Heritage Area",
      status: "restricted",
    });
    expect(overlays[0]?.detail).toContain("Confirm implications in the local district plan");
  });

  it("exposes smoke targets for configured regional layers", () => {
    const targets = regionalPlanningSmokeTargets();

    expect(targets.some((target) => target.providerId === "hamilton" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "christchurch" && target.label.includes("Heritage"))).toBe(true);
    expect(targets.some((target) => target.providerId === "nelson" && target.label === "Nelson Planning Zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "qldc" && target.kind === "zone")).toBe(true);
  });
});
