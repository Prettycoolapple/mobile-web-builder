import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyInfrastructureFeatures,
  fetchInfrastructure,
  infrastructureSearchDistanceMetres,
  type InfrastructureFeature,
} from "../infrastructure";
import type { ParcelBbox } from "../linz";

const parcel: ParcelBbox = {
  minLng: 174.856,
  maxLng: 174.858,
  minLat: -36.852,
  maxLat: -36.85,
  polygon: [
    [174.856, -36.852],
    [174.858, -36.852],
    [174.858, -36.85],
    [174.856, -36.85],
    [174.856, -36.852],
  ],
};

function feature(path: number[][], attrs: Record<string, unknown> = {}): InfrastructureFeature {
  return {
    attributes: attrs,
    geometry: { paths: [path] },
  };
}

describe("infrastructure parcel classification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies a service line running through the parcel as on-parcel", () => {
    const result = classifyInfrastructureFeatures(
      "Wastewater",
      -36.851,
      174.857,
      [
        feature([
          [174.8555, -36.8515],
          [174.8585, -36.8505],
        ]),
      ],
      parcel,
    );

    expect(result?.location).toBe("on-parcel");
    expect(result?.risk).toBe("low");
  });

  it("classifies a public frontage service just outside the parcel as boundary, not neighbour", () => {
    const result = classifyInfrastructureFeatures(
      "Stormwater",
      -36.851,
      174.857,
      [
        feature([
          [174.85803, -36.8522],
          [174.85803, -36.8498],
        ]),
      ],
      parcel,
    );

    expect(result?.location).toBe("boundary");
    expect(result?.note).toContain("not a neighbour-land service");
  });

  it("does not infer neighbour land from a point-only distance", () => {
    const result = classifyInfrastructureFeatures(
      "Water Supply",
      -36.851,
      174.857,
      [
        feature([
          [174.85725, -36.851],
          [174.85735, -36.851],
        ]),
      ],
      null,
    );

    expect(result?.location).toBe("boundary");
  });

  it("classifies an off-site service in a neighbouring parcel as neighbour when parcel context confirms it", () => {
    const result = classifyInfrastructureFeatures(
      "Wastewater",
      -36.851,
      174.857,
      [
        feature([
          [174.8562, -36.85218],
          [174.8578, -36.85218],
        ]),
      ],
      parcel,
      "neighbour",
    );

    expect(result?.location).toBe("neighbour");
    expect(result?.note).toContain("private land");
  });

  it("keeps a confirmed road-reserve service as public-land", () => {
    const result = classifyInfrastructureFeatures(
      "Stormwater",
      -36.851,
      174.857,
      [
        feature([
          [174.8562, -36.8522],
          [174.8578, -36.8522],
        ]),
      ],
      parcel,
      "public-land",
    );

    expect(result?.location).toBe("public-land");
  });

  it("uses larger rural infrastructure search distances without changing urban defaults", () => {
    expect(infrastructureSearchDistanceMetres("Water Supply", { zoneCode: "MHU", landAreaSqm: 650 })).toBe(200);
    expect(infrastructureSearchDistanceMetres("Wastewater", { zoneCode: "CLZ", landAreaSqm: 32000 })).toBe(500);
    expect(infrastructureSearchDistanceMetres("Water Supply", { landAreaSqm: 12000 })).toBe(500);
    expect(infrastructureSearchDistanceMetres("Stormwater", { zoneCode: "CLZ", landAreaSqm: 32000 })).toBe(1000);
  });

  it("returns shortened rural no-service notes with the expanded search radius", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ features: [] }),
    } as Response);

    const result = await fetchInfrastructure(-36.851, 174.857, parcel, "target-parcel", {
      zoneCode: "CLZ",
      landAreaSqm: 32000,
    });

    const water = result.find((item) => item.name === "Water Supply");
    const wastewater = result.find((item) => item.name === "Wastewater");
    const stormwater = result.find((item) => item.name === "Stormwater");

    expect(water?.search_radius_metres).toBe(500);
    expect(water?.note).toBe("No mapped public water supply service found within 500m of the parcel");
    expect(water?.note).not.toMatch(/confirm private|civil design/i);
    expect(wastewater?.search_radius_metres).toBe(500);
    expect(stormwater?.search_radius_metres).toBe(1000);
    expect(stormwater?.note).toBe("No mapped public stormwater service found within 1000m of the parcel");
    expect(result.every((item) => item.rural_infrastructure_adjusted)).toBe(true);
  });

  it("classifies nearest public transport-owned stormwater as public-land, not neighbour", () => {
    const result = classifyInfrastructureFeatures(
      "Stormwater",
      -36.851,
      174.857,
      [
        feature(
          [
            [174.8562, -36.85225],
            [174.8578, -36.85225],
          ],
          { SW_ASSET_OWNER: "TRANSPORT", SW_ASSET_MAINTAINER: "TRANSPORT" },
        ),
        feature(
          [
            [174.8562, -36.853],
            [174.8578, -36.853],
          ],
          { SW_ASSET_OWNER: "PRIVATE" },
        ),
      ],
      parcel,
    );

    expect(result?.location).toBe("public-land");
    expect(result?.service_source_owner).toBe("TRANSPORT");
  });

  it("still classifies explicit private off-site service as neighbour", () => {
    const result = classifyInfrastructureFeatures(
      "Stormwater",
      -36.851,
      174.857,
      [
        feature(
          [
            [174.8562, -36.85225],
            [174.8578, -36.85225],
          ],
          { SW_ASSET_OWNER: "PRIVATE" },
        ),
      ],
      parcel,
    );

    expect(result?.location).toBe("neighbour");
  });
});
