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

  it("uses the selected active listing subject land when a tapped discovery card disagrees with parcel/GIS area", () => {
    const selectedUrl = "https://www.realestate.co.nz/43000000/residential/sale/18-peacock-street-glendowie";
    const merged = mergePropertyData(
      { area_sqm: 283 } as any,
      null,
      null,
      { zone_code: "SHZ", zone_description: "Single House Zone", min_lot_size_sqm: 600 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        property_history: {
          cv_nzd: 5_950_000,
          cv_year: 2024,
          build_year: 1960,
          floor_area_sqm: 296,
          land_area_sqm: 283,
          property_type: "House",
          sources_confirmed: [],
          sources_estimated: [],
        },
        realestate_listing: {
          address: "18 Peacock Street, Glendowie, Auckland City, Auckland",
          price: 3_500_000,
          priceText: "$3,500,000",
          landArea: 2694,
          landAreaSource: "realestate_page",
          landAreaConfidence: "verified",
          landAreaApprox: true,
          listingUrl: selectedUrl,
          photoUrl: null,
          photoUrls: [],
          zone: null,
          bedrooms: 4,
          bathrooms: 3,
          floorArea: 296,
          propertyType: "House",
          tenureText: "Freehold",
          legalDescription: "Lot 1 Deposited Plan 12345",
        },
        preferred_realestate_listing_url: selectedUrl,
      },
    );

    expect(merged.land_area_sqm).toBe(2694);
    expect(merged.data_sources.land_area_sqm).toBe("realestate.co.nz (selected active listing)");
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

  it("uses exact active listing area for unit-like properties instead of parent LINZ parcel area", () => {
    const merged = mergePropertyData(
      { area_sqm: 832 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        realestate_listing: {
          address: "1 Chesterfield Avenue, St Heliers, Auckland",
          price: 1_259_000,
          priceText: "$1,259,000",
          landArea: 342,
          landAreaSource: "realestate_page",
          landAreaConfidence: "verified",
          listingUrl: "https://www.realestate.co.nz/example",
          photoUrl: null,
          photoUrls: [],
          zone: null,
          bedrooms: 2,
          bathrooms: 1,
          floorArea: 115,
          propertyType: "Unit",
          tenureText: "Unit Title",
          legalDescription: "Unit A and Accessory Unit 1-2 Deposited Plan 91363",
        },
      },
    );

    expect(merged.land_area_sqm).toBe(342);
    expect(merged.data_sources.land_area_sqm).toContain("realestate.co.nz");
  });

  it("does not apply aggregate facts from a combined active listing to one subject address", () => {
    const merged = mergePropertyData(
      { area_sqm: 786 } as any,
      null,
      null,
      { zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 300 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        propertyValue: {
          cv_nzd: 2_075_000,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: 2024,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: 393,
          floor_area_sqm: 139,
          build_year: 1910,
          build_year_range: null,
          bedrooms: 3,
          bathrooms: 1,
          listing_active: false,
          photo_urls: [],
          address_confirmed: "15 Fisherton Street, Grey Lynn",
          property_id: 123,
        },
        analysed_address: "15 Fisherton Street, Grey Lynn, Auckland",
        realestate_listing: {
          address: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland",
          price: 3_000_000,
          priceText: "By negotiation",
          landArea: 786,
          landAreaSource: "realestate_page",
          landAreaConfidence: "verified",
          isCombinedListing: true,
          combinedListingReason: "multi_address_listing",
          listingUrl: "https://www.realestate.co.nz/example",
          photoUrl: null,
          photoUrls: [],
          zone: null,
          bedrooms: 6,
          bathrooms: 2,
          floorArea: 278,
          propertyType: "House",
          tenureText: "Freehold",
          legalDescription: "Lot 1 Deposited Plan 12345",
        },
      },
    );

    expect(merged.land_area_sqm).toBe(393);
    expect(merged.floor_area_sqm).toBe(139);
    expect(merged.bedrooms).toBe(3);
    expect(merged.bathrooms).toBe(1);
    expect(merged.data_sources.realestate_listing).toBe("ignored combined listing");
  });
});
