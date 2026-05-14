import { describe, expect, it } from "vitest";
import { mergePropertyData } from "../scrapers/merge";

describe("mergePropertyData", () => {
  it("does not let an uncorroborated active listing override cadastral land or stable floor area", () => {
    const merged = mergePropertyData(
      { area_sqm: 1198 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        property_history: {
          cv_nzd: 2_300_000,
          cv_year: 2024,
          build_year: 1940,
          floor_area_sqm: 79,
          land_area_sqm: 1198,
          property_type: null,
          sources_confirmed: [],
          sources_estimated: [],
        },
        realestate_listing: {
          address: "9 Rukutai Street, Orakei, Auckland",
          price: 1_520_000,
          priceText: "$1,520,000",
          landArea: 6337,
          floorArea: 483,
          listingUrl: "https://www.realestate.co.nz/example",
          photoUrl: null,
          photoUrls: [],
          zone: null,
          bedrooms: 2,
          bathrooms: 1,
        },
      },
    );

    expect(merged.land_area_sqm).toBe(1198);
    expect(merged.floor_area_sqm).toBe(79);
    expect(merged.data_sources.land_area_sqm).toBe("linz");
    expect(merged.data_sources.floor_area_sqm).toContain("auckland_council_gis");
  });
});
