import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchRegionalInfrastructure,
  hasRegionalInfrastructureProvider,
  regionalInfrastructureSmokeTargets,
} from "../regional-infrastructure";

describe("regional infrastructure fetchers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns conservative service classifications from regional utility layers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hasWaterLayer = url.includes("/32/query");
      const hasWastewaterLayer = url.includes("/21/query");
      const hasStormwaterLayer = url.includes("/8/query");
      const features = hasWaterLayer || hasWastewaterLayer || hasStormwaterLayer
        ? [
            {
              attributes: { OBJECTID: 1 },
              geometry: { paths: [[[168.662, -45.031], [168.663, -45.031]]] },
            },
          ]
        : [];
      return new Response(JSON.stringify({ features }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const result = await fetchRegionalInfrastructure("qldc", -45.031, 168.662, null);

    expect(result).toHaveLength(3);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.service_source_owner === "Queenstown Lakes District Council")).toBe(true);
    expect(result.every((item) => item.risk === "low")).toBe(true);
  });

  it("returns explicit unknown service items for mapped providers with no nearby assets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ features: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));

    const result = await fetchRegionalInfrastructure("whangarei", -35.725, 174.323, null);

    expect(result).toHaveLength(3);
    expect(result.find((item) => item.name === "Wastewater")).toMatchObject({
      location: "unknown",
      risk: "high",
      service_source_owner: "Whangarei District Council",
    });
  });

  it("maps Nelson Top of the South service layers into three service groups", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const hasNelsonServiceLayer =
        url.includes("/5/query") ||
        url.includes("/6/query") ||
        url.includes("/7/query");
      return new Response(JSON.stringify({
        features: hasNelsonServiceLayer
          ? [
              {
                attributes: { OBJECTID: 1, Owner: "Nelson City Council" },
                geometry: { paths: [[[173.221, -41.306], [173.222, -41.306]]] },
              },
            ]
          : [],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));

    const result = await fetchRegionalInfrastructure("nelson", -41.306, 173.222, null);

    expect(result).toHaveLength(3);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.service_source_owner === "Nelson City Council / Top of the South Maps")).toBe(true);
  });

  it("returns Southland District Council's three mapped services at 77 Kruger Street", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isMappedLayer = ["/12/query", "/14/query", "/38/query", "/40/query", "/66/query"]
        .some((suffix) => url.includes(suffix));
      return new Response(JSON.stringify({
        features: isMappedLayer ? [{
          attributes: { OBJECTID: 1, Status: "IN" },
          geometry: { paths: [[[168.5814, -45.8373], [168.5817, -45.8373]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalInfrastructure("southland", -45.8372796, 168.5815783, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Southland District Council")).toBe(true);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/External_ThreeWaters_Layers_v2/MapServer/14/query"))).toBe(true);
  });

  it("maps all three Thames-Coromandel public utility groups", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const mapped = ["/1/query", "/2/query", "/3/query", "/4/query", "/5/query", "/6/query"]
        .some((path) => url.includes(path));
      return new Response(JSON.stringify({
        features: mapped ? [{
          attributes: { OBJECTID: 1, AssetOwner: "TCDC" },
          geometry: { paths: [[[175.5507, -37.1478], [175.5510, -37.1478]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const result = await fetchRegionalInfrastructure("thames-coromandel", -37.14783098, 175.55078515, null);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.service_source_owner === "Thames-Coromandel District Council")).toBe(true);
  });

  it("maps Buller's three public utility groups and filters out private assets", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return new Response(JSON.stringify({
        features: [{
          attributes: { OBJECTID: 1, ASSET_OWNER: "Local Authority" },
          geometry: { paths: [[[171.6065, -41.7630], [171.6070, -41.7630]]] },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalInfrastructure("buller", -41.76295052, 171.60663355, null);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.service_source_owner === "Buller District Council")).toBe(true);
    expect(fetchMock.mock.calls.every((call) =>
      new URL(String(call[0])).searchParams.get("where") === "ASSET_OWNER = 'Local Authority'"
    )).toBe(true);
  });

  it("returns Taupō District's three public pipe services for Kinloch", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{
        attributes: { Asset_Type: "Water Main", Status: "In Service", Potable: "Yes" },
        geometry: { paths: [[[175.9763, -38.6206], [175.9770, -38.6206]]] },
      }],
    }), { status: 200 })));

    const result = await fetchRegionalInfrastructure("taupo", -38.6206095, 175.9763673, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.service_source_owner === "Taupō District Council")).toBe(true);
    expect(result.every((item) => item.location === "on-parcel")).toBe(true);
  });

  it("merges PNCC and MDC feeds into one best row for each Manawatu service", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isMdc = url.includes("services9.arcgis.com/CzWZ8m5FuciqBibe");
      return new Response(JSON.stringify({
        features: isMdc ? [{
          attributes: { FID: 1 },
          geometry: { paths: [[[175.5647, -40.225], [175.5653, -40.225]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const result = await fetchRegionalInfrastructure("manawatu", -40.225, 175.565, null);

    expect(result).toHaveLength(3);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Manawatu District Council")).toBe(true);
  });

  it("returns all three Western Bay public networks for 30 Athenree Road", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{
        attributes: { OBJECTID: 1, Status: "Operational" },
        geometry: { paths: [[[175.9641, -37.4461], [175.9646, -37.4461]]] },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const result = await fetchRegionalInfrastructure("western-bay", -37.4460583, 175.9643635, null);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Western Bay of Plenty District Council")).toBe(true);
  });

  it("returns all three Napier public networks for 23 Wycliffe Street", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isNapierLayer = ["/4/query", "/5/query", "/6/query"].some((suffix) => url.includes(suffix));
      return new Response(JSON.stringify({
        features: isNapierLayer ? [{
          attributes: { FID: 1, ALLOW_CON: "Yes" },
          geometry: { paths: [[[176.8914, -39.5112], [176.8917, -39.5112]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalInfrastructure("napier", -39.5112541, 176.8915180, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Napier City Council")).toBe(true);
    expect(fetchMock.mock.calls.every((call) => String(call[0]).includes("717214_Napier_City_Council_layers"))).toBe(true);
  });

  it("returns all three Hastings public networks for 226 Havelock Road", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const mapped = ["/2/query", "/3/query", "/4/query", "/11/query", "/12/query", "/13/query", "/20/query", "/32/query", "/22/query"]
        .some((suffix) => url.pathname.endsWith(suffix));
      return new Response(JSON.stringify({
        features: mapped ? [{
          attributes: { OBJECTID: 1, IPS_Ownership: "PUB", IPS_Service_Status: "INS" },
          geometry: { paths: [[[176.8594, -39.6552], [176.8599, -39.6552]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalInfrastructure("hastings", -39.65520308, 176.85964827, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Hastings District Council")).toBe(true);
    expect(fetchMock.mock.calls.every((call) =>
      new URL(String(call[0])).searchParams.get("where") === "IPS_Ownership = 'PUB' AND IPS_Service_Status = 'INS'"
    )).toBe(true);
  });

  it("returns all three Tauranga public networks for 16 Lodge Avenue", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      features: [{
        attributes: { OBJECTID: 1, Status: "In Service" },
        geometry: { paths: [[[176.2109, -37.6647], [176.2113, -37.6647]]] },
      }],
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const result = await fetchRegionalInfrastructure("tauranga", -37.6646905, 176.2110862, null);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Tauranga City Council")).toBe(true);
  });

  it("reports Pukehina water and stormwater while explicitly flagging no public wastewater scheme", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const features = url.includes("/WBP_Wastewater_REST_services/") ? [] : [{
        attributes: { OBJECTID: 1 },
        geometry: { paths: [[[176.4993, -37.7721], [176.4998, -37.7721]]] },
      }];
      return new Response(JSON.stringify({ features }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const result = await fetchRegionalInfrastructure("western-bay", -37.7720624, 176.4995595, null);
    expect(result.find((item) => item.name === "Water Supply")?.location).not.toBe("unknown");
    expect(result.find((item) => item.name === "Stormwater")?.location).not.toBe("unknown");
    expect(result.find((item) => item.name === "Wastewater")).toMatchObject({
      location: "unknown",
      risk: "high",
      note: expect.stringContaining("no current plan for a public wastewater scheme"),
    });
  });

  it("returns Masterton's three mapped Wairarapa services at 78 Opaki Road", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isMastertonLayer =
        url.includes("/Services/WaterPublic/MapServer/5/query")
        || url.includes("/Services/SewerPublic/MapServer/4/query")
        || url.includes("/Services/StormwaterPublic/MapServer/6/query");
      return new Response(JSON.stringify({
        features: isMastertonLayer ? [{
          attributes: { OBJECTID: 1 },
          geometry: { paths: [[[175.6705, -40.9382], [175.671, -40.9382]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalInfrastructure("wairarapa", -40.9382383, 175.6708268, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Masterton / Carterton District Councils (Wairarapa Maps)")).toBe(true);
  });

  it("returns Kāpiti Coast three-waters assets for 37 Tieko Street", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isKapitiService = [2, 10, 11, 19, 20, 21, 22]
        .some((id) => url.includes(`/Public/Services/MapServer/${id}/query`));
      return new Response(JSON.stringify({
        features: isKapitiService ? [{
          attributes: { OBJECTID: 1 },
          geometry: { paths: [[[175.0207, -40.8839], [175.0211, -40.8839]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const result = await fetchRegionalInfrastructure("kapiti", -40.8838658, 175.0208898, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Kāpiti Coast District Council")).toBe(true);
  });

  it("returns Selwyn Water and council three-waters assets for 100 Birchs Road", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isSelwynService = url.includes("/SDC_Public/WATER_Water/MapServer/")
        || url.includes("/SDC_Public/Water_Sewer/MapServer/")
        || url.includes("/SDC_Public/WATER_Stormwater/MapServer/");
      return new Response(JSON.stringify({
        features: isSelwynService ? [{
          attributes: { OBJECTID: 1, STATUS: "IN SERVICE" },
          geometry: { paths: [[[172.5102, -43.5930], [172.5108, -43.5930]]] },
        }] : [],
      }), { status: 200 });
    }));

    const result = await fetchRegionalInfrastructure("selwyn", -43.5929461, 172.5104991, null);
    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.find((item) => item.name === "Water Supply")?.service_source_owner).toBe("Selwyn Water Limited");
    expect(result.find((item) => item.name === "Wastewater")?.service_source_owner).toBe("Selwyn Water Limited");
    expect(result.find((item) => item.name === "Stormwater")?.service_source_owner).toBe("Selwyn District Council");
  });

  it("returns Te Aroha's three mapped Matamata-Piako services at 19 Centennial Avenue", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const isMpdcLayer =
        url.includes("/WaterLine/FeatureServer/488/query")
        || url.includes("/WasteWaterLine/FeatureServer/33/query")
        || url.includes("/StormWaterLine/FeatureServer/30/query");
      return new Response(JSON.stringify({
        features: isMpdcLayer ? [{
          attributes: { OBJECTID: 1 },
          geometry: { paths: [[[175.7070, -37.5352], [175.7078, -37.5352]]] },
        }] : [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchRegionalInfrastructure("matamata-piako", -37.5352280, 175.7074969, null);

    expect(result.map((item) => item.name).sort()).toEqual(["Stormwater", "Wastewater", "Water Supply"]);
    expect(result.every((item) => item.location !== "unknown")).toBe(true);
    expect(result.every((item) => item.service_source_owner === "Matamata-Piako District Council")).toBe(true);
  });

  it("exposes mapped utility smoke targets only for configured providers", () => {
    expect(hasRegionalInfrastructureProvider("hamilton")).toBe(true);
    expect(hasRegionalInfrastructureProvider("qldc")).toBe(true);
    expect(hasRegionalInfrastructureProvider("nelson")).toBe(true);
    expect(hasRegionalInfrastructureProvider("rotorua")).toBe(true);
    expect(hasRegionalInfrastructureProvider("whakatane")).toBe(true);
    expect(hasRegionalInfrastructureProvider("western-bay")).toBe(true);
    expect(hasRegionalInfrastructureProvider("tauranga")).toBe(true);
    expect(hasRegionalInfrastructureProvider("southland")).toBe(true);
    expect(hasRegionalInfrastructureProvider("napier")).toBe(true);
    expect(hasRegionalInfrastructureProvider("wairarapa")).toBe(true);
    expect(hasRegionalInfrastructureProvider("kapiti")).toBe(true);
    expect(hasRegionalInfrastructureProvider("selwyn")).toBe(true);
    expect(hasRegionalInfrastructureProvider("matamata-piako")).toBe(true);
    expect(hasRegionalInfrastructureProvider("thames-coromandel")).toBe(true);
    expect(hasRegionalInfrastructureProvider("buller")).toBe(true);

    const targets = regionalInfrastructureSmokeTargets();
    expect(targets.some((target) => target.providerId === "hamilton" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "nelson" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "qldc" && target.serviceName === "Wastewater")).toBe(true);
    expect(targets.some((target) => target.providerId === "dunedin" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "rotorua" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "taupo" && target.label === "Potable water pipe")).toBe(true);
    expect(targets.some((target) => target.providerId === "whakatane" && target.serviceName === "Wastewater")).toBe(true);
    expect(targets.some((target) => target.providerId === "western-bay" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "tauranga" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "southland" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "napier" && target.serviceName === "Wastewater")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.label === "Masterton stormwater main")).toBe(true);
    expect(targets.some((target) => target.providerId === "kapiti" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "kapiti" && target.label === "Stormwater pipe")).toBe(true);
    expect(targets.some((target) => target.providerId === "selwyn" && target.label === "Water supply pipe")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.label === "Stormwater main")).toBe(true);
    expect(targets.some((target) => target.providerId === "thames-coromandel" && target.label === "Potable water supply line")).toBe(true);
    expect(targets.some((target) => target.providerId === "buller" && target.label === "Public potable-water line")).toBe(true);
  });
});
