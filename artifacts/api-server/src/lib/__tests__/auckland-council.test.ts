import { describe, expect, it } from "vitest";
import { classifySlope, summarizeTerrainSlopeDistribution, zoneResultFromRawCode } from "../auckland-council";

describe("terrain slope classification", () => {
  it("classifies terrain using perception-based slope bands", () => {
    expect(classifySlope(1.9, "test").classification).toBe("flat");
    expect(classifySlope(2, "test").classification).toBe("subtle");
    expect(classifySlope(5.9, "test").classification).toBe("subtle");
    expect(classifySlope(6, "test").classification).toBe("moderate");
    expect(classifySlope(11.9, "test").classification).toBe("moderate");
    expect(classifySlope(12, "test").classification).toBe("steep");
    expect(classifySlope(17.9, "test").classification).toBe("steep");
    expect(classifySlope(18, "test").classification).toBe("very_steep");
  });

  it("rounds displayed slope degrees without changing the source label", () => {
    const result = classifySlope(4.24, "parcel-dem");
    expect(result.slope_degrees).toBe(4.2);
    expect(result.source).toBe("parcel-dem");
  });

  it("summarises local slope distribution for large-site terrain screening", () => {
    const profile = summarizeTerrainSlopeDistribution(
      [4, 7, 9, 11, 12, 13, 15, 18, 21, 24, 27, 30],
      16,
    );

    expect(profile?.moderate_area_ratio).toBeCloseTo(0.25, 3);
    expect(profile?.steep_area_ratio).toBeCloseTo(0.667, 3);
    expect(profile?.local_slope_p90_degrees).toBe(27);
    expect(profile?.sample_count).toBe(16);
  });
});

describe("unitary plan zone mapping", () => {
  it("maps Auckland Council zone code 3 to Countryside Living Zone", () => {
    expect(zoneResultFromRawCode(3)).toEqual({
      zone_code: "CLZ",
      zone_description: "Rural - Countryside Living Zone",
      min_lot_size_sqm: 10000,
      raw_zone: "3",
    });
  });

  it("maps Local Centre to the E38 business-zone vacant-site standard", () => {
    expect(zoneResultFromRawCode(7)).toEqual({
      zone_code: "LCZ",
      zone_description: "Business - Local Centre Zone",
      min_lot_size_sqm: 200,
      raw_zone: "7",
    });
  });
});
