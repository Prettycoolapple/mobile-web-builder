import { describe, expect, it } from "vitest";
import { classifyInfrastructureFeatures, type InfrastructureFeature } from "../infrastructure";
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
});
