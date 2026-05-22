import { describe, expect, it } from "vitest";
import { mapLinzParcelFeature } from "../linz";

describe("LINZ parcel area mapping", () => {
  it("uses survey area for report facts while preserving calculated polygon area", () => {
    const parcel = mapLinzParcelFeature({
      _id: "parcel-1",
      survey_area: 32113,
      calc_area: 32092,
      titles: "NA123/45",
      appellation: "Lot 1 DP 12345",
    });

    expect(parcel.area_sqm).toBe(32113);
    expect(parcel.survey_area_sqm).toBe(32113);
    expect(parcel.calc_area_sqm).toBe(32092);
  });
});
