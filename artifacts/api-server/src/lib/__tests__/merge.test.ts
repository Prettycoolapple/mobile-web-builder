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

  it("ignores PropertyValue bed/bath when it fuzzy-matched a different address", () => {
    const merged = mergePropertyData(
      { area_sqm: 400 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        propertyValue: {
          cv_nzd: 1_800_000,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: 2024,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: 405,
          floor_area_sqm: 160,
          build_year: 1965,
          build_year_range: null,
          bedrooms: 5,
          bathrooms: 2,
          listing_active: false,
          photo_urls: [],
          address_confirmed: "12 Hampton Drive, St Heliers",
          property_id: 456,
        },
        analysed_address: "8 Hampton Drive, St Heliers",
      },
    );

    expect(merged.bedrooms).toBeNull();
    expect(merged.bathrooms).toBeNull();
  });

  it("ignores neighbour bed/bath when a source resolved 8A Hampton Drive for 8 Hampton Drive", () => {
    const merged = mergePropertyData(
      { area_sqm: 400 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        propertyValue: {
          cv_nzd: 1_800_000,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: 2024,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: 405,
          floor_area_sqm: 160,
          build_year: 1965,
          build_year_range: null,
          bedrooms: 5,
          bathrooms: 2,
          listing_active: false,
          photo_urls: [],
          address_confirmed: "8A Hampton Drive, St Heliers",
          property_id: 456,
        },
        homes: {
          cv_nzd: null,
          cv_year: null,
          land_area_sqm: null,
          floor_area_sqm: null,
          build_year: null,
          bedrooms: 5,
          bathrooms: 2,
          last_sale_price: null,
          last_sale_date: null,
          address_confirmed: "https://homes.co.nz/address/auckland/st-heliers/8a-hampton-drive",
        },
        qv: {
          cv_nzd: null,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: null,
          land_area_sqm: null,
          floor_area_sqm: null,
          build_year: null,
          build_year_range: null,
          bedrooms: 5,
          bathrooms: 2,
          address_confirmed: "https://www.qv.co.nz/property/auckland/st-heliers/8a-hampton-drive",
          contour_text: null,
          contour_classification: null,
        },
        analysed_address: "8 Hampton Drive, St Heliers",
      },
    );

    expect(merged.bedrooms).toBeNull();
    expect(merged.bathrooms).toBeNull();
  });

  it("keeps PropertyValue bed/bath when its confirmed address matches the subject", () => {
    const merged = mergePropertyData(
      { area_sqm: 400 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        propertyValue: {
          cv_nzd: 1_800_000,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: 2024,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: 405,
          floor_area_sqm: 160,
          build_year: 1965,
          build_year_range: null,
          bedrooms: 3,
          bathrooms: 1,
          listing_active: false,
          photo_urls: [],
          address_confirmed: "8 Hampton Drive, St Heliers, Auckland",
          property_id: 456,
        },
        analysed_address: "8 Hampton Drive, St Heliers",
      },
    );

    expect(merged.bedrooms).toBe(3);
    expect(merged.bathrooms).toBe(1);
  });

  it("lets exact Homes/QV consensus correct conflicting PropertyValue bed and bath counts", () => {
    const merged = mergePropertyData(
      { area_sqm: 437 } as any,
      null,
      null,
      { zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 300 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38 Te Arawa Street, Orakei, Auckland",
        propertyValue: {
          cv_nzd: 1_350_000,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: 2024,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: 437,
          floor_area_sqm: 84,
          build_year: 1930,
          build_year_range: null,
          bedrooms: 3,
          bathrooms: 3,
          listing_active: false,
          photo_urls: [],
          address_confirmed: "38 Te Arawa Street, Orakei, Auckland",
          property_id: 789,
        },
        homes: {
          cv_nzd: null,
          cv_year: null,
          land_area_sqm: null,
          floor_area_sqm: 84,
          build_year: null,
          bedrooms: 2,
          bathrooms: 1,
          last_sale_price: null,
          last_sale_date: null,
          address_confirmed: "38 Te Arawa Street, Orakei, Auckland",
        },
        qv: {
          cv_nzd: null,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: null,
          land_area_sqm: null,
          floor_area_sqm: null,
          build_year: null,
          build_year_range: null,
          bedrooms: 2,
          bathrooms: 1,
          address_confirmed: "38 Te Arawa Street, Orakei, Auckland",
          contour_text: null,
          contour_classification: null,
        },
      },
    );

    expect(merged.bedrooms).toBe(2);
    expect(merged.bathrooms).toBe(1);
    expect(merged.data_sources.bedrooms).toBe("homes");
    expect(merged.data_sources.bathrooms).toBe("homes");
  });

  it("keeps exact Homes profile bed/bath ahead of stale unlisted records", () => {
    const merged = mergePropertyData(
      { area_sqm: 500 } as any,
      null,
      {
        found: true,
        cv_nzd: null,
        cv_year: null,
        last_sale_price: null,
        last_sale_date: null,
        listing_price: null,
        listing_active: false,
        floor_area_sqm: null,
        land_area_sqm: null,
        build_year: null,
        bedrooms: 3,
        bathrooms: 2,
        tenureText: null,
        main_photo_url: null,
        photo_urls: [],
        comparables: [],
        data_source: "oneroof",
        scraped_at: "2026-06-01T00:00:00.000Z",
      },
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "8 Hampton Drive, St Heliers, Auckland",
        propertyValue: {
          cv_nzd: 1_900_000,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: 2024,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: 500,
          floor_area_sqm: 126,
          build_year: 1964,
          build_year_range: null,
          bedrooms: 5,
          bathrooms: 2,
          listing_active: false,
          photo_urls: [],
          address_confirmed: "8 Hampton Drive, St Heliers, Auckland",
          property_id: 456,
        },
        homes: {
          cv_nzd: null,
          cv_year: null,
          land_area_sqm: null,
          floor_area_sqm: null,
          build_year: null,
          bedrooms: 3,
          bathrooms: 1,
          last_sale_price: null,
          last_sale_date: null,
          address_confirmed: "8 Hampton Drive, St Heliers, Auckland",
        },
      },
    );

    expect(merged.bedrooms).toBe(3);
    expect(merged.bathrooms).toBe(1);
    expect(merged.data_sources.bedrooms).toBe("homes");
    expect(merged.data_sources.bathrooms).toBe("homes");
  });

  it("does not use non-listing property-record photos as feasibility report fallbacks", () => {
    const merged = mergePropertyData(
      { area_sqm: 500 } as any,
      null,
      {
        found: true,
        cv_nzd: null,
        cv_year: null,
        last_sale_price: null,
        last_sale_date: null,
        listing_price: null,
        listing_active: false,
        floor_area_sqm: null,
        land_area_sqm: null,
        build_year: null,
        bedrooms: null,
        bathrooms: null,
        tenureText: null,
        main_photo_url: "https://s.oneroof.co.nz/image/old.jpg",
        photo_urls: ["https://s.oneroof.co.nz/image/old.jpg"],
        comparables: [],
        data_source: "oneroof",
        scraped_at: "2026-05-31T00:00:00.000Z",
      },
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        propertyValue: {
          cv_nzd: null,
          lv_nzd: null,
          iv_nzd: null,
          cv_year: null,
          property_type: "House",
          property_sub_type: null,
          legal_descriptions: [],
          land_use_primary: null,
          property_improvements: null,
          land_area_sqm: null,
          floor_area_sqm: null,
          build_year: null,
          build_year_range: null,
          bedrooms: null,
          bathrooms: null,
          listing_active: false,
          photo_urls: ["https://example.com/propertyvalue-neighbour.jpg"],
          address_confirmed: "8 Hampton Drive, St Heliers",
          property_id: 456,
        },
        analysed_address: "8 Hampton Drive, St Heliers",
      },
    );

    expect(merged.photo_urls).toEqual([]);
    expect(merged.main_photo_url).toBeNull();
  });
});
