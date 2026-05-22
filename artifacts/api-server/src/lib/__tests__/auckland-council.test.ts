import { describe, expect, it } from "vitest";
import { classifySlope, zoneResultFromRawCode } from "../auckland-council";

describe("terrain slope classification", () => {
  it("keeps borderline parcel DEM readings gentle until 12 degrees", () => {
    expect(classifySlope(11.9, "test").classification).toBe("gentle");
    expect(classifySlope(12, "test").classification).toBe("moderate");
  });

  it("rounds displayed slope degrees without changing the source label", () => {
    const result = classifySlope(4.24, "parcel-dem");
    expect(result.slope_degrees).toBe(4.2);
    expect(result.source).toBe("parcel-dem");
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
});
