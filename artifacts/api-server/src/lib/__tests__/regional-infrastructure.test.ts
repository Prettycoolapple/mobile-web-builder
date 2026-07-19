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
    expect(hasRegionalInfrastructureProvider("southland")).toBe(true);
    expect(hasRegionalInfrastructureProvider("wairarapa")).toBe(true);
    expect(hasRegionalInfrastructureProvider("matamata-piako")).toBe(true);

    const targets = regionalInfrastructureSmokeTargets();
    expect(targets.some((target) => target.providerId === "hamilton" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "nelson" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "qldc" && target.serviceName === "Wastewater")).toBe(true);
    expect(targets.some((target) => target.providerId === "dunedin" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "rotorua" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "whakatane" && target.serviceName === "Wastewater")).toBe(true);
    expect(targets.some((target) => target.providerId === "western-bay" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "southland" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.label === "Masterton stormwater main")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.label === "Stormwater main")).toBe(true);
  });
});
