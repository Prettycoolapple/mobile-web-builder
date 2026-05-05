import { describe, expect, it } from "vitest";
import { dedupeEquivalentAddressOptions } from "../address-clarification";

describe("address clarification candidate dedupe", () => {
  it("collapses equivalent formatted variants for the same mapped address", () => {
    const options = dedupeEquivalentAddressOptions([
      {
        formatted: "825 Riddell Road, St Heliers, Auckland 1071, New Zealand",
        lat: -36.851,
        lng: 174.857,
      },
      {
        formatted: "825, Riddell Road, Saint Heliers, Orakei, Auckland, 1074",
        lat: -36.8511,
        lng: 174.8571,
      },
    ]);

    expect(options).toEqual([
      {
        formatted: "825 Riddell Road, St Heliers, Auckland 1071, New Zealand",
        lat: -36.851,
        lng: 174.857,
      },
    ]);
  });

  it("keeps same-number street addresses when they map to different places", () => {
    const options = dedupeEquivalentAddressOptions([
      {
        formatted: "1 Queen Street, Auckland Central, Auckland 1010, New Zealand",
        lat: -36.844,
        lng: 174.768,
      },
      {
        formatted: "1 Queen Street, Wainuiomata, Lower Hutt 5014, New Zealand",
        lat: -41.261,
        lng: 174.949,
      },
    ]);

    expect(options).toHaveLength(2);
  });
});
