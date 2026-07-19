import { describe, expect, it } from "vitest";
import { mergePropertyData } from "../scrapers/merge";

describe("mergePropertyData", () => {
  it("prefers the newer authoritative Whakatane council CV", () => {
    const merged = mergePropertyData(
      { area_sqm: 61_829 } as any,
      null,
      null,
      { zone_code: "Rural Production Zone", zone_description: "Rural Production Zone" } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        property_history: {
          cv_nzd: 1_310_000,
          cv_year: 2025,
          build_year: null,
          floor_area_sqm: null,
          land_area_sqm: 61_829,
          property_type: null,
          sources_confirmed: ["cv_nzd (Whakatane District Council rating GIS)"],
          sources_estimated: [],
        },
        propertyValue: {
          cv_nzd: 900_000,
          cv_year: 2022,
        } as any,
      },
    );

    expect(merged.cv_nzd).toBe(1_310_000);
    expect(merged.cv_year).toBe(2025);
    expect(merged.data_sources.cv_nzd).toBe("whakatane_council_rating_gis");
  });

  it("preserves PNCC council provenance for the authoritative CV", () => {
    const merged = mergePropertyData(
      null,
      null,
      null,
      { zone_code: "Residential", zone_description: "Residential - Palmerston North City District Plan Zone" } as any,
      [],
      {
        contour: "flat",
        asbestos_risk: "unknown",
        infrastructure: [],
        property_history: {
          cv_nzd: 710_000,
          cv_year: 2026,
          build_year: null,
          floor_area_sqm: null,
          land_area_sqm: 786,
          land_area_source: "pncc_council_rating_gis",
          land_area_scope: "rating_unit",
          property_type: null,
          sources_confirmed: [
            "cv_nzd (Palmerston North City Council rating GIS)",
            "land_area_sqm (Palmerston North City Council rating GIS)",
          ],
          sources_estimated: [],
        },
      },
    );

    expect(merged.cv_nzd).toBe(710_000);
    expect(merged.data_sources.cv_nzd).toBe("pncc_council_rating_gis");
    expect(merged.data_sources.land_area_sqm).toBe("pncc_council_rating_gis");
  });

  it("uses Christchurch's complete rating unit while preserving floor area, CV, and zone", () => {
    const merged = mergePropertyData(
      { area_sqm: 363 } as any,
      null,
      null,
      { zone_code: "Residential Medium Density", zone_description: "Medium Density Residential Zone" } as any,
      [],
      {
        contour: "flat",
        asbestos_risk: "low",
        infrastructure: [],
        analysed_address: "21 Defoe Place, Waltham, Christchurch",
        linz_lrs_title_preview: {
          address_id: "237895",
          address: "21 Defoe Place, Waltham, Christchurch",
          titles: [{
            title_no: "CB22B/808",
            title_type: "Fee Simple",
            title_status: "Live",
            legal_descriptions: ["Part Lot 13-14 Deposited Plan 1417"],
            land_district: "Canterbury",
            issue_date: null,
            indicative_area_sqm: 548,
          }],
        },
        property_history: {
          cv_nzd: null,
          cv_year: null,
          build_year: null,
          floor_area_sqm: null,
          land_area_sqm: 552,
          land_area_source: "christchurch_council_rating_unit",
          land_area_scope: "rating_unit",
          property_type: null,
          sources_confirmed: ["land_area_sqm (Christchurch City Council rating unit GIS)"],
          sources_estimated: [],
        },
        propertyValue: {
          cv_nzd: 530_000,
          cv_year: 2025,
          floor_area_sqm: 120,
          land_area_sqm: 552,
          address_confirmed: "21 Defoe Place, Waltham, Christchurch",
        } as any,
      },
    );

    expect(merged.land_area_sqm).toBe(552);
    expect(merged.data_sources.land_area_sqm).toBe("christchurch_council_rating_unit");
    expect(merged.floor_area_sqm).toBe(120);
    expect(merged.cv_nzd).toBe(530_000);
    expect(merged.zone_description).toBe("Medium Density Residential Zone");
    expect(merged.discrepancies).toEqual(expect.arrayContaining([
      expect.stringContaining("complete property-level area"),
    ]));
  });

  it("uses one exact live fee-simple title area when it clearly spans multiple parcels", () => {
    const merged = mergePropertyData(
      { area_sqm: 363 } as any,
      null,
      null,
      null,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "21 Defoe Place, Waltham, Christchurch",
        linz_lrs_title_preview: {
          address_id: "237895",
          address: "21 Defoe Place, Waltham, Christchurch",
          titles: [{
            title_no: "CB22B/808",
            title_type: "Fee Simple",
            title_status: "Live",
            legal_descriptions: ["Part Lot 13-14 Deposited Plan 1417"],
            land_district: "Canterbury",
            issue_date: null,
            indicative_area_sqm: 548,
          }],
        },
      },
    );

    expect(merged.land_area_sqm).toBe(548);
    expect(merged.data_sources.land_area_sqm).toBe("linz_lrs_title");
  });

  it("retains the point parcel for ordinary, multiple-title, cross-lease, and child-address cases", () => {
    const baseTitle = {
      title_no: "TEST/1",
      title_status: "Live",
      land_district: "Canterbury",
      issue_date: null,
      indicative_area_sqm: 552,
    };
    const mergeWith = (address: string, titles: any[], propertyHistory?: any) => mergePropertyData(
      { area_sqm: 363 } as any,
      null,
      null,
      null,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: address,
        linz_lrs_title_preview: { address_id: "test", address, titles },
        property_history: propertyHistory,
      },
    );
    const christchurchRatingUnit = {
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: 552,
      land_area_source: "christchurch_council_rating_unit",
      land_area_scope: "rating_unit",
      property_type: null,
      sources_confirmed: [],
      sources_estimated: [],
    };

    const ordinary = mergeWith("10 Example Road, Christchurch", [{
      ...baseTitle,
      title_type: "Fee Simple",
      legal_descriptions: ["Lot 1 Deposited Plan 12345"],
    }]);
    expect(ordinary.land_area_sqm).toBe(363);
    expect(ordinary.data_sources.land_area_sqm).toBe("linz");

    const multipleTitle = mergeWith("21 Defoe Place, Christchurch", [
      { ...baseTitle, title_no: "TEST/1", title_type: "Fee Simple", legal_descriptions: ["Lot 1 DP 1"] },
      { ...baseTitle, title_no: "TEST/2", title_type: "Fee Simple", legal_descriptions: ["Lot 2 DP 1"] },
    ], christchurchRatingUnit);
    expect(multipleTitle.land_area_sqm).toBe(363);

    const crossLease = mergeWith("21 Defoe Place, Christchurch", [{
      ...baseTitle,
      title_type: "Cross Lease",
      legal_descriptions: ["Flat 1 Deposited Plan 12345"],
    }], christchurchRatingUnit);
    expect(crossLease.land_area_sqm).toBe(363);

    const child = mergeWith("21A Defoe Place, Christchurch", [{
      ...baseTitle,
      title_type: "Fee Simple",
      legal_descriptions: ["Part Lot 13-14 Deposited Plan 1417"],
    }], christchurchRatingUnit);
    expect(child.land_area_sqm).toBe(363);
  });

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
    expect(merged.listing_price).toBe(3_500_000);
    expect(merged.data_sources.listing_price).toBe("realestate.co.nz (active listing)");
  });

  it("does not backfill parent parcel land when the selected active listing has no land area", () => {
    const selectedUrl = "https://www.realestate.co.nz/43000001/residential/sale/7-sultan-street-ellerslie";
    const merged = mergePropertyData(
      { area_sqm: 2018 } as any,
      null,
      null,
      { zone_code: "BMU", zone_description: "Business - Mixed Use Zone", min_lot_size_sqm: 0 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        property_history: {
          cv_nzd: null,
          cv_year: null,
          build_year: 1935,
          floor_area_sqm: 90,
          land_area_sqm: 2018,
          property_type: "Residential Dwelling",
          sources_confirmed: [],
          sources_estimated: [],
        },
        realestate_listing: {
          address: "7 Sultan Street, Ellerslie, Auckland",
          price: null,
          priceText: "By negotiation",
          landArea: null,
          landAreaSource: "realestate_page",
          landAreaConfidence: "unverified",
          listingUrl: selectedUrl,
          photoUrl: null,
          photoUrls: [],
          zone: null,
          bedrooms: 3,
          bathrooms: 2,
          floorArea: 90,
          propertyType: "Townhouse",
        },
        preferred_realestate_listing_url: selectedUrl,
      },
    );

    expect(merged.land_area_sqm).toBeNull();
    expect(merged.data_sources.land_area_sqm).toBe("unavailable_selected_active_listing");
    expect(merged.missing_critical_fields).toContain("land_area_sqm");
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
          build_year_range: null,
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
          build_year_range: null,
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
          build_year_range: null,
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

  it("ignores child-address build years when analysing the parent address", () => {
    const merged = mergePropertyData(
      { area_sqm: 809 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38 Rosebank Road, Papatoetoe, Auckland",
        property_history: {
          cv_nzd: null,
          cv_year: null,
          build_year: 1950,
          floor_area_sqm: null,
          land_area_sqm: null,
          property_type: "House",
          sources_confirmed: [],
          sources_estimated: [],
        },
        propertyValue: {
          build_year: 2020,
          build_year_range: null,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "38A Rosebank Road, Papatoetoe, Auckland",
        } as any,
        homes: {
          build_year: 2020,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "https://homes.co.nz/address/auckland/papatoetoe/38b-rosebank-road",
        } as any,
        qv: {
          build_year: 2020,
          build_year_range: null,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "https://www.qv.co.nz/property/auckland/papatoetoe/38b-rosebank-road",
        } as any,
      },
    );

    expect(merged.build_year).toBe(1950);
    expect(merged.data_sources.build_year).toBe("auckland_council_gis");
  });

  it("accepts a child-address build year when that child is the analysed subject", () => {
    const merged = mergePropertyData(
      { area_sqm: 300 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38A Rosebank Road, Papatoetoe, Auckland",
        propertyValue: {
          build_year: 2020,
          build_year_range: null,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "38A Rosebank Road, Papatoetoe, Auckland",
        } as any,
      },
    );

    expect(merged.build_year).toBe(2020);
    expect(merged.data_sources.build_year).toBe("propertyvalue");
  });

  it("does not let neighbouring suffix records supply land or floor area for the analysed child", () => {
    const merged = mergePropertyData(
      null,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38A Rosebank Road, Papatoetoe, Auckland",
        propertyValue: {
          land_area_sqm: 129,
          floor_area_sqm: 120,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "38B Rosebank Road, Papatoetoe, Auckland",
        } as any,
        qv: {
          land_area_sqm: 129,
          floor_area_sqm: 129,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "https://www.qv.co.nz/property/auckland/papatoetoe/38b-rosebank-road",
        } as any,
        homes: {
          land_area_sqm: 150,
          floor_area_sqm: 136,
          bedrooms: 4,
          bathrooms: 2,
          build_year: null,
          build_year_range: "2020-2029",
          address_confirmed: "https://homes.co.nz/address/auckland/papatoetoe/38a-rosebank-road/O0v58N",
        } as any,
      },
    );

    expect(merged.land_area_sqm).toBe(150);
    expect(merged.floor_area_sqm).toBe(136);
    expect(merged.data_sources.land_area_sqm).toBe("homes");
    expect(merged.data_sources.floor_area_sqm).toBe("homes");
  });

  it("prefers exact child Homes land over a conflicting LINZ parcel area", () => {
    const merged = mergePropertyData(
      { area_sqm: 129 } as any,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38A Rosebank Road, Papatoetoe, Auckland",
        homes: {
          land_area_sqm: 150,
          floor_area_sqm: 136,
          bedrooms: 3,
          bathrooms: 1,
          build_year: null,
          build_year_range: "2020-2029",
          address_confirmed: "https://homes.co.nz/address/auckland/papatoetoe/38a-rosebank-road/O0v58N",
        } as any,
        propertyValue: {
          land_area_sqm: 129,
          floor_area_sqm: 120,
          bedrooms: 4,
          bathrooms: 2,
          address_confirmed: "38B Rosebank Road, Papatoetoe, Auckland",
        } as any,
      },
    );

    expect(merged.land_area_sqm).toBe(150);
    expect(merged.floor_area_sqm).toBe(136);
    expect(merged.data_sources.land_area_sqm).toBe("homes");
    expect(merged.data_sources.floor_area_sqm).toBe("homes");
  });

  it("keeps a Homes-only build decade as an approximate range", () => {
    const merged = mergePropertyData(
      null,
      null,
      null,
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38A Rosebank Road, Papatoetoe, Auckland",
        homes: {
          build_year: null,
          build_year_range: "2020-2029",
          address_confirmed: "38A Rosebank Road, Papatoetoe, Auckland",
        } as any,
      },
    );

    expect(merged.build_year).toBeNull();
    expect(merged.build_year_range).toBe("2020-2029");
    expect(merged.data_sources.build_year).toBeUndefined();
  });

  it("does not let an inactive OneRoof page replace an older council build year", () => {
    const merged = mergePropertyData(
      { area_sqm: 809 } as any,
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
        build_year: 2020,
        bedrooms: null,
        bathrooms: null,
        tenureText: null,
        main_photo_url: null,
        photo_urls: [],
        comparables: [],
        data_source: "oneroof",
        scraped_at: "2026-06-18T00:00:00.000Z",
      },
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "38 Rosebank Road, Papatoetoe, Auckland",
        property_history: {
          cv_nzd: null,
          cv_year: null,
          build_year: 1950,
          floor_area_sqm: null,
          land_area_sqm: null,
          property_type: "House",
          sources_confirmed: [],
          sources_estimated: [],
        },
      },
    );

    expect(merged.build_year).toBe(1950);
    expect(merged.data_sources.build_year).toBe("auckland_council_gis");
  });

  it("does not expose inactive OneRoof listing price as current asking price", () => {
    const merged = mergePropertyData(
      { area_sqm: 809 } as any,
      null,
      {
        found: true,
        cv_nzd: null,
        cv_year: null,
        last_sale_price: null,
        last_sale_date: null,
        listing_price: 3_500_000,
        listing_active: false,
        floor_area_sqm: null,
        land_area_sqm: null,
        build_year: null,
        bedrooms: null,
        bathrooms: null,
        tenureText: null,
        main_photo_url: null,
        photo_urls: [],
        comparables: [],
        data_source: "oneroof",
        scraped_at: "2026-06-18T00:00:00.000Z",
      },
      { zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any,
      [],
      {
        contour: null,
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "19 Chatsworth Crescent, Pakuranga, Auckland",
      },
    );

    expect(merged.listing_price).toBeNull();
    expect(merged.data_sources.listing_price).toBeUndefined();
  });

  it("does not let a stray bathroom turn an address-matched vacant section into a dwelling", () => {
    const merged = mergePropertyData(
      { area_sqm: 819 } as any,
      null,
      null,
      { zone_code: "Residential", zone_description: "Residential - Pukehina" } as any,
      [],
      {
        contour: "flat",
        asbestos_risk: "unknown",
        infrastructure: [],
        analysed_address: "481 Pukehina Parade, Pukehina",
        propertyValue: {
          cv_nzd: 1_020_000,
          lv_nzd: 1_020_000,
          iv_nzd: null,
          cv_year: 2025,
          property_type: "RESIDENTIAL",
          property_sub_type: "Vacant",
          land_area_sqm: 819,
          floor_area_sqm: null,
          build_year: null,
          bedrooms: null,
          bathrooms: 1,
          address_confirmed: "481 Pukehina Parade, Pukehina, 3189",
        } as any,
        qv: {
          cv_nzd: 1_020_000,
          lv_nzd: 1_020_000,
          iv_nzd: null,
          land_area_sqm: 819,
          floor_area_sqm: null,
          build_year: null,
          bedrooms: null,
          bathrooms: null,
          address_confirmed: "481 Pukehina Parade, Pukehina",
        } as any,
      },
    );

    expect(merged).toMatchObject({
      property_type: "Vacant land / section",
      floor_area_sqm: null,
      build_year: null,
      bedrooms: null,
      bathrooms: null,
    });
    expect(merged.data_sources.property_type).toBe("propertyvalue (vacant valuation record)");
    expect(merged.discrepancies).toEqual(expect.arrayContaining([
      expect.stringContaining("classify the property as vacant land"),
    ]));
  });
});
