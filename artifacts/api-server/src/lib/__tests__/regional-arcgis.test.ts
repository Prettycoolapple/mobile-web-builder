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

  it("maps Taupō District's published Environment zone field", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/query")) {
        return new Response(JSON.stringify({
          features: [{ attributes: {
            OBJECTID: 1008,
            Zone: "Rural Lifestyle Environment",
            ChangeReason: "Plan Change 42",
          } }],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200 });
    }));

    await expect(fetchRegionalPlanningZone(
      jurisdiction("taupo"), -38.6206095, 175.9763673,
    )).resolves.toMatchObject({
      zone_code: "Rural Lifestyle Environment",
      zone_description: expect.stringContaining("Rural Lifestyle Environment"),
    });
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

  it("tries point geometry before falling back to parcel geometry for regional zones", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/query")) {
        const isParcelQuery = url.includes("esriGeometryPolygon");
        return new Response(JSON.stringify({
          features: isParcelQuery
            ? [
                {
                  attributes: {
                    OBJECTID: 11788,
                    ZONE: "Rural Production Zone",
                    ePlanDisplayField: "Rural production zone",
                  },
                },
              ]
            : [],
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
    expect(queryUrls[0]).toContain("esriGeometryPoint");
    expect(queryUrls.some((url) => url.includes("esriGeometryPolygon"))).toBe(true);
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

  it("maps Rotorua Lakes Council zoning fields", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Core/DistrictPlan/MapServer/55/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          Code: "RESZ1",
          Type: "Residential 1 Zone",
          Description: "Medium Density Residential Zone",
          OrderDesc: "PC9",
        } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(jurisdiction("rotorua"), -38.1251, 176.2438);

    expect(zone.zone_code).toBe("RESZ1");
    expect(zone.zone_description).toContain("Medium Density Residential Zone");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/Core/DistrictPlan/MapServer/55/query"))).toBe(true);
  });

  it("maps Whakatane District Plan zoning fields", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/OperativeDistrictPlanNPS_ePlan/MapServer/36/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          Zone_Name: "Rural Production Zone",
        } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(jurisdiction("whakatane"), -38.0166, 176.7157);

    expect(zone.zone_code).toBe("Rural Production Zone");
    expect(zone.zone_description).toContain("Rural Production Zone");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/OperativeDistrictPlanNPS_ePlan/MapServer/36/query"))).toBe(true);
  });

  it("returns General Rural Zone for the Onepu State Highway 30 parcel", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/OperativeDistrictPlanNPS_ePlan/MapServer/36/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          Zone_Name: "General Rural Zone",
        } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(
      jurisdiction("whakatane"),
      -38.0263534,
      176.7097369,
      {
        minLng: 176.706,
        maxLng: 176.713,
        minLat: -38.029,
        maxLat: -38.023,
        polygon: [
          [176.706, -38.029],
          [176.713, -38.029],
          [176.713, -38.023],
          [176.706, -38.023],
          [176.706, -38.029],
        ],
      },
    );

    expect(zone.zone_code).toBe("General Rural Zone");
    expect(zone.zone_description).toContain("General Rural Zone");
    const zoneRequest = fetchMock.mock.calls
      .map((call) => String(call[0]))
      .find((url) => url.includes("/MapServer/36/query"));
    expect(zoneRequest).toBeDefined();
    expect(new URL(zoneRequest!).searchParams.get("geometryType")).toBe("esriGeometryPoint");
  });

  it("queries PNCC and MDC zone polygons and returns the council layer that covers the property", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isMdc = url.includes("/District_Plan_Zones/FeatureServer/0/query");
      return new Response(JSON.stringify({
        features: isMdc ? [{ attributes: { OBJECTID: 19, id: 4, zone: "Residential" } }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(jurisdiction("manawatu"), -40.225, 175.565);

    expect(zone.zone_code).toBe("Residential");
    expect(zone.zone_description).toContain("Manawatu District Plan Zone");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/DISTRICTPLAN_PlanningZones/FeatureServer/0/query"))).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/District_Plan_Zones/FeatureServer/0/query"))).toBe(true);
  });

  it("maps Western Bay zoning and natural-hazard controls for Athenree", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/query")) {
        return new Response(JSON.stringify({ fields: [] }), { status: 200 });
      }
      if (url.includes("/District_Plan/MapServer/66/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: { CS_PAR_ZONE: "Residential" } }] }), { status: 200 });
      }
      if (url.includes("/Other_Natural_Hazards/MapServer/10/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: { Zone: "Orange" } }] }), { status: 200 });
      }
      if (url.includes("/Other_Natural_Hazards/MapServer/11/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: { Zone: "Yellow" } }] }), { status: 200 });
      }
      if (url.includes("/Other_Natural_Hazards/MapServer/12/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          LiquefactionVulnerabilityCatego: "Possible",
          Detail: "Level A (Basic Desktop Assessment)",
        } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ features: [] }), { status: 200 });
    }));

    await expect(fetchRegionalPlanningZone(
      jurisdiction("western-bay"), -37.4460583, 175.9643635,
    )).resolves.toMatchObject({ zone_code: "Residential", zone_description: expect.stringContaining("Residential") });
    await expect(fetchRegionalPlanningZone(
      jurisdiction("western-bay"), -37.7720624, 176.4995595,
    )).resolves.toMatchObject({ zone_code: "Residential", zone_description: expect.stringContaining("Pukehina") });

    const overlays = await fetchRegionalPlanningOverlays(
      jurisdiction("western-bay"), -37.4460583, 175.9643635, null,
    );
    expect(overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Tsunami / 5m Wave Height", status: "moderate" }),
      expect.objectContaining({ name: "Tsunami / 1 in 2500 Year Wave", status: "moderate" }),
      expect.objectContaining({ name: "Liquefaction Vulnerability", status: "moderate" }),
    ]));
  });

  it("returns Southland's General Residential Zone for 77 Kruger Street", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Website_SpatialPlan_layers/MapServer/7/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          OBJECTID: 11,
          LOCALITY: "Balfour",
          TYPE: "General Residential Zone (GRZ)",
        } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ features: [], fields: [] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const zone = await fetchRegionalPlanningZone(jurisdiction("southland"), -45.8372796, 168.5815783);

    expect(zone).toMatchObject({
      zone_code: "General Residential Zone (GRZ)",
      zone_description: expect.stringContaining("General Residential Zone (GRZ)"),
    });
    expect(zone.zone_description).toContain("Southland General Residential Zone");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/Website_SpatialPlan_layers/MapServer/7/query"))).toBe(true);
  });

  it("maps Napier's operative zone and HBRC hazards for 23 Wycliffe Street", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/OperativeDistrictPlan_2025/MapServer/10/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          Zone: "Medium Density Residential Zone",
          Category: "Residential Environment",
          ImperviousArea: "70",
        } }] }), { status: 200 });
      }
      if (url.includes("/OperativeDistrictPlan_2025/MapServer/24/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: { NAME: "C801", TAG: "WDT" } }] }), { status: 200 });
      }
      if (url.includes("/HBRC_Property_Hazards/MapServer/16/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          F3604_haza: "High",
          Hazard_Description: "Liquefaction damage is possible - High liquefaction vulnerability",
        } }] }), { status: 200 });
      }
      if (url.includes("/HBRC_Property_Hazards/MapServer/21/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          Relative_Earthquake_Amplificati: "Unconsolidated swamp, estuarine and lagoonal deposits and reclaimed land",
        } }] }), { status: 200 });
      }
      if (url.includes("/HBRC_Property_Hazards/MapServer/24/query")) {
        return new Response(JSON.stringify({ features: [{ attributes: {
          Location: "Napier/Meeanee",
          Class: "Low risk areas",
        } }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ features: [], fields: [] }), { status: 200 });
    }));

    await expect(fetchRegionalPlanningZone(
      jurisdiction("napier"), -39.5112541, 176.8915180,
    )).resolves.toMatchObject({
      zone_code: "Medium Density Residential Zone",
      zone_description: expect.stringContaining("Residential Environment"),
    });

    const overlays = await fetchRegionalPlanningOverlays(
      jurisdiction("napier"), -39.5112541, 176.8915180, null,
    );
    expect(overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Overland Flow Path", status: "restricted" }),
      expect.objectContaining({ name: "Liquefaction Vulnerability", status: "restricted", detail: expect.stringContaining("High") }),
      expect.objectContaining({ name: "Earthquake Ground Amplification", status: "moderate" }),
      expect.objectContaining({ name: "Flood Risk Area", detail: expect.stringContaining("Low risk areas") }),
    ]));
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

  it("maps Tauranga's operative MDRZ and applicable Mount Maunganui controls", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const features = url.includes("/ePlan_DistrictPlanBase/MapServer/0/query")
        ? [{ attributes: { Zone: "MDRZ", Description: "Medium Density Residential Zone", RuleID: 41 } }]
        : url.includes("/ePlan_Section5/MapServer/4/query")
          ? [{ attributes: { Height: "49" } }]
          : url.includes("/ePlan_Section7/MapServer/0/query")
            ? [{ attributes: { MaxHeight: 11 } }]
            : url.includes("/Liquefaction/MapServer/0/query")
              ? [{ attributes: { TerrainName: "Fixed Foredunes", LiquefactionVulnerability: "Possible", Details: "Level B" } }]
              : [];
      return new Response(JSON.stringify({ features, fields: [] }), { status: 200 });
    }));

    await expect(fetchRegionalPlanningZone(
      jurisdiction("tauranga"), -37.6646905, 176.2110862,
    )).resolves.toMatchObject({
      zone_code: "MDRZ",
      zone_description: expect.stringContaining("Medium Density Residential Zone"),
    });
    const overlays = await fetchRegionalPlanningOverlays(
      jurisdiction("tauranga"), -37.6646905, 176.2110862, null,
    );
    expect(overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Airport Height Slope and Surface", status: "control" }),
      expect.objectContaining({ name: "Viewshaft Building Elevation", status: "control" }),
      expect.objectContaining({ name: "Liquefaction Vulnerability", status: "moderate" }),
    ]));
  });

  it("returns the Wairarapa Combined District Plan zone for 78 Opaki Road", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/ResourceManagementAndPlanning/Zones/MapServer/4/query")) {
        return new Response(JSON.stringify({
          features: [{
            attributes: {
              OBJECTID: 5415,
              ZONE_TYPE: "Residential",
              SUB_TYPE: " ",
              NAME: " ",
              TLA: "MDC",
              LOCATION: "Masterton",
            },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/query")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalPlanningZone(jurisdiction("wairarapa"), -40.9382383, 175.6708268);

    expect(result).toMatchObject({
      zone_code: "Residential",
      zone_description: expect.stringContaining("Wairarapa Residential Zone"),
      min_lot_size_sqm: null,
    });
    expect(result.zone_description).toContain("Masterton");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/Zones/MapServer/4/query"))).toBe(true);
  });

  it("uses Kāpiti's current zone fields and returns RLZ for 37 Tieko Street", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isZone = url.includes("/District_Plan_Zones/MapServer/0/query");
      const isFlood = url.includes("/Latest_Flood_Hazards/MapServer/6/query");
      return new Response(JSON.stringify({
        features: isZone ? [{ attributes: {
          Abbreviation: "RLZ",
          ePlan_Zone: "Rural Lifestyle Zone",
          NPS_Zone: "Rural Lifestyle Zone",
          PDP_ZONE: "Rural - Residential",
        } }] : isFlood ? [{ attributes: { ZONE: "Ponding" } }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    await expect(fetchRegionalPlanningZone(
      jurisdiction("kapiti"), -40.8838658, 175.0208898,
    )).resolves.toMatchObject({
      zone_code: "RLZ",
      zone_description: expect.stringContaining("Rural Lifestyle Zone"),
    });
    await expect(fetchRegionalPlanningOverlays(
      jurisdiction("kapiti"), -40.8838658, 175.0208898, null,
    )).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Ponding Area", status: "restricted" }),
    ]));
  });

  it("returns Selwyn LLRZ and applicable Prebbleton controls for 100 Birchs Road", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const features = url.includes("/SelwynDistrictPlan2020/MapServer/80/query")
        ? [{ attributes: {
            Zone_Name: "Large lot residential zone",
            Zone_ShortCode: "LLRZ",
            Township: "Prebbleton",
            Zone_Type: "Large lot residential zone",
          } }]
        : url.includes("/SelwynDistrictPlan2020/MapServer/39/query")
          ? [{ attributes: { Description: "13km Buffer", Label: "13km Bird Strike Risk Overlay" } }]
          : url.includes("/SelwynDistrictPlan2020/MapServer/8/query")
            ? [{ attributes: { Name: "Plains Flood Management" } }]
            : [];
      return new Response(JSON.stringify({ features, fields: [] }), { status: 200 });
    }));

    await expect(fetchRegionalPlanningZone(
      jurisdiction("selwyn"), -43.5929461, 172.5104991,
    )).resolves.toMatchObject({
      zone_code: "LLRZ",
      zone_description: expect.stringContaining("Large lot residential zone"),
    });
    await expect(fetchRegionalPlanningOverlays(
      jurisdiction("selwyn"), -43.5929461, 172.5104991, null,
    )).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "13km Birdstrike Overlay", status: "moderate" }),
      expect.objectContaining({ name: "Plains Flood Management Overlay", status: "restricted" }),
    ]));
  });

  it("returns the Matamata-Piako Residential Zone for 19 Centennial Avenue, Te Aroha (layer name as zone identity)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/Residential_Zone/FeatureServer/783/query")) {
        return new Response(JSON.stringify({
          features: [{
            attributes: { FID: 1, MSLINK: -214748364, Shape__Area: 54230.4296875, Shape__Length: 1116.7554341422256 },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/query")) {
        return new Response(JSON.stringify({ features: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ fields: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalPlanningZone(jurisdiction("matamata-piako"), -37.5352280, 175.7074969);

    expect(result).toMatchObject({
      zone_code: "MPDC_RESIDENTIAL",
      zone_description: expect.stringContaining("Residential Zone"),
      min_lot_size_sqm: null,
    });
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/Residential_Zone/FeatureServer/783/query"))).toBe(true);
  });

  it("exposes smoke targets for configured regional layers", () => {
    const targets = regionalPlanningSmokeTargets();

    expect(targets.some((target) => target.providerId === "hamilton" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "christchurch" && target.label.includes("Heritage"))).toBe(true);
    expect(targets.some((target) => target.providerId === "nelson" && target.label === "Nelson Planning Zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "qldc" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.label === "Wairarapa Residential Zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.label === "Faultline Hazard Area")).toBe(true);
    expect(targets.some((target) => target.providerId === "kapiti" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "kapiti" && target.label === "Ponding Area")).toBe(true);
    expect(targets.some((target) => target.providerId === "selwyn" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "selwyn" && target.label === "Plains Flood Management Overlay")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.label === "Residential Zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.label === "Flood Hazard Zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "manawatu" && target.label === "MDC Growth Precinct 1")).toBe(true);
    expect(targets.some((target) => target.providerId === "manawatu" && target.label === "MDC Growth Precinct 4 (Maewa)")).toBe(true);
    expect(targets.some((target) => target.providerId === "rotorua" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "whakatane" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "western-bay" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "napier" && target.kind === "zone")).toBe(true);
    expect(targets.some((target) => target.providerId === "napier" && target.label === "Liquefaction Vulnerability")).toBe(true);
    expect(targets.some((target) => target.providerId === "southland" && target.kind === "zone")).toBe(true);
  });
});
