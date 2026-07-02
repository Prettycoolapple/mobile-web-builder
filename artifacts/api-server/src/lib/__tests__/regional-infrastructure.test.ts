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

  it("exposes mapped utility smoke targets only for configured providers", () => {
    expect(hasRegionalInfrastructureProvider("hamilton")).toBe(true);
    expect(hasRegionalInfrastructureProvider("qldc")).toBe(true);

    const targets = regionalInfrastructureSmokeTargets();
    expect(targets.some((target) => target.providerId === "hamilton" && target.serviceName === "Water Supply")).toBe(true);
    expect(targets.some((target) => target.providerId === "qldc" && target.serviceName === "Wastewater")).toBe(true);
    expect(targets.some((target) => target.providerId === "dunedin" && target.serviceName === "Water Supply")).toBe(true);
  });
});
