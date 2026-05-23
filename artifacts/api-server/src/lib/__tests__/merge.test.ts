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

  it("passes optional terrain distribution metrics through the merged payload", () => {
    const merged = mergePropertyData(
      { area_sqm: 32_113 } as any,
      null,
      null,
      { zone_code: "CLZ", zone_description: "Rural - Countryside Living Zone", min_lot_size_sqm: 10_000 } as any,
      [],
      {
        contour: "steep",
        contour_slope_degrees: 23,
        contour_source: "test-dem",
        contour_steep_area_ratio: 0.12,
        contour_moderate_area_ratio: 0.28,
        contour_local_slope_p90_degrees: 23,
        contour_local_slope_p95_degrees: 31,
        contour_sample_count: 420,
        large_site_terrain_adjusted: true,
        asbestos_risk: "unknown",
        infrastructure: [],
      },
    );

    expect(merged.contour).toBe("steep");
    expect(merged.contour_steep_area_ratio).toBe(0.12);
    expect(merged.contour_moderate_area_ratio).toBe(0.28);
    expect(merged.contour_local_slope_p90_degrees).toBe(23);
    expect(merged.contour_sample_count).toBe(420);
    expect(merged.large_site_terrain_adjusted).toBe(true);
  });
});
