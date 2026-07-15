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
        url.includes("/Water_Line/FeatureServer/0/query")
        || url.includes("/Wastewater_Line/FeatureServer/0/query")
        || url.includes("/Stormwater_Line/FeatureServer/0/query");
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
    expect(targets.some((target) => target.providerId === "southland" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "wairarapa" && target.label === "Masterton stormwater main")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.serviceName === "Stormwater")).toBe(true);
    expect(targets.some((target) => target.providerId === "matamata-piako" && target.label === "Stormwater main/service line")).toBe(true);
  });
});
