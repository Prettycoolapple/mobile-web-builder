import { beforeEach, describe, expect, it, vi } from "vitest";
import { preScreenListingsFast, preScreenListingsFastDetailed } from "../pre-screen";
import { geocodeAddress } from "../geocode";
import { fetchOverlays, fetchUnitaryPlanZone } from "../auckland-council";
import { fetchLINZParcel } from "../linz";
import { scrapeHomes } from "../scrapers/homes";
import { scrapePropertyValue } from "../scrapers/propertyvalue";
import { fetchPropertyHistory } from "../property-data";
import { clearScreenVerdictCache } from "../listing-cache";
import type { ListingResult } from "../scrapers/oneroof";

vi.mock("../geocode", () => ({ geocodeAddress: vi.fn() }));
vi.mock("../auckland-council", () => ({
  fetchUnitaryPlanZone: vi.fn(),
  fetchOverlays: vi.fn(),
}));
vi.mock("../linz", () => ({ fetchLINZParcel: vi.fn() }));
vi.mock("../scrapers/homes", () => ({ scrapeHomes: vi.fn() }));
vi.mock("../scrapers/propertyvalue", () => ({ scrapePropertyValue: vi.fn() }));
vi.mock("../property-data", () => ({ fetchPropertyHistory: vi.fn() }));

const mockedGeocode = vi.mocked(geocodeAddress);
const mockedZone = vi.mocked(fetchUnitaryPlanZone);
const mockedOverlays = vi.mocked(fetchOverlays);
const mockedLinz = vi.mocked(fetchLINZParcel);
const mockedHomes = vi.mocked(scrapeHomes);
const mockedPropertyValue = vi.mocked(scrapePropertyValue);
const mockedPropertyHistory = vi.mocked(fetchPropertyHistory);

function listing(overrides: Partial<ListingResult>): ListingResult {
  return {
    address: "124 Example Road, St Heliers, Auckland City, Auckland",
    price: 2_000_000,
    priceText: "$2,000,000",
    landArea: 800,
    landAreaSource: "realestate_page",
    landAreaConfidence: "verified",
    photoUrl: null,
    listingUrl: "https://www.realestate.co.nz/example",
    zone: null,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "House",
    tenureText: "Freehold",
    legalDescription: "Lot 1 Deposited Plan 12345",
    ...overrides,
  };
}

describe("strict subdivision pre-screening", () => {
  beforeEach(() => {
    // Verdict cache persists across calls — clear it between tests so each
    // test's mocked sources actually take effect.
    clearScreenVerdictCache();
    mockedGeocode.mockImplementation(async (address: string) => ({
      lat: -36.85,
      lng: 174.86,
      formatted: `${address}, New Zealand`,
      suburb: "st heliers",
    }));
    mockedZone.mockResolvedValue({ zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 300 } as any);
    mockedOverlays.mockResolvedValue([]);
    mockedLinz.mockResolvedValue(null);
    mockedHomes.mockResolvedValue(null);
    mockedPropertyValue.mockResolvedValue(null);
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: 1950,
      floor_area_sqm: 150,
      land_area_sqm: 800,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });
  });

  it("excludes 352F Kohimarama Road after exact land area verifies below subdivision threshold", async () => {
    const results = await preScreenListingsFast([
      listing({
        address: "352F Kohimarama Road, St Heliers, Auckland City, Auckland",
        landArea: 290,
        isParentParcelSuspect: true,
      }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toEqual([]);
  });

  it("excludes 166A St Heliers Bay Road as an already-subdivided child lot even when LINZ returns parent area", async () => {
    mockedLinz.mockResolvedValue({
      parcel_id: "parent",
      appellation: null,
      area_sqm: 1007,
      survey_area_sqm: 1007,
      calc_area_sqm: 1007,
      title_no: null,
      legal_description: null,
      topology_type: null,
      bbox: null,
    });

    const results = await preScreenListingsFast([
      listing({
        address: "166A St Heliers Bay Road, Saint Heliers, Auckland City, Auckland",
        landArea: 503,
      }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toEqual([]);
  });

  it("keeps a verified unsuffixed MHU site that supports at least two lots", async () => {
    const results = await preScreenListingsFast([
      listing({ address: "124 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toHaveLength(1);
    expect(results[0].landArea).toBe(800);
    expect(results[0].potentialLots).toBeGreaterThanOrEqual(2);
    expect(results[0].landAreaConfidence).toBe("verified");
    expect(results[0].typology).toBe("standalone");
    expect(results[0].subdivisionEligible).toBe(true);
  });

  it("returns a preliminary strict subdivision candidate without waiting for build year", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: null,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({ address: "124 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
    ], 1, null, {
      allowMissingListingPrice: true,
      strictStandardSubdivision: true,
      preliminarySubdivision: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].screeningStatus).toBe("preliminary");
    expect(results[0].subdivisionRejectReason).toBe("build_year_unknown");
    expect(results[0].potentialLots).toBeGreaterThanOrEqual(2);
  });

  it("checks trusted subject land when listing land is missing in preliminary strict subdivision", async () => {
    mockedPropertyValue.mockResolvedValue({
      cv_nzd: null,
      lv_nzd: null,
      iv_nzd: null,
      cv_year: null,
      property_type: "Residential Dwelling",
      property_sub_type: null,
      legal_descriptions: ["Lot 1 Deposited Plan 12345"],
      land_use_primary: "Single Unit excluding Bach",
      property_improvements: "DWELLING",
      land_area_sqm: 800,
      floor_area_sqm: 150,
      build_year: null,
      build_year_range: null,
      bedrooms: null,
      bathrooms: null,
      listing_active: false,
      photo_urls: [],
      address_confirmed: "124 Example Road, St Heliers",
      property_id: null,
    });

    const results = await preScreenListingsFast([
      listing({
        address: "124 Example Road, St Heliers, Auckland City, Auckland",
        landArea: null,
        landAreaConfidence: "unverified",
      }),
    ], 1, null, {
      allowMissingListingPrice: true,
      strictStandardSubdivision: true,
      preliminarySubdivision: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].landArea).toBe(800);
    expect(results[0].landAreaSource).toBe("propertyvalue");
    expect(results[0].screeningStatus).toBe("preliminary");
  });

  it("allows a preliminary candidate when title and typology are not confirmed but no unit signal exists", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: null,
      property_type: null,
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({
        address: "128 Example Road, St Heliers, Auckland City, Auckland",
        landArea: 800,
        propertyType: null,
        tenureText: null,
        legalDescription: null,
      }),
    ], 1, null, {
      allowMissingListingPrice: true,
      strictStandardSubdivision: true,
      preliminarySubdivision: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].typology).toBe("unknown");
    expect(results[0].titleConfidence).toBe("unknown");
    expect(results[0].subdivisionRejectReason).toBe("title_not_confirmed_freehold");
    expect(results[0].screeningStatus).toBe("preliminary");
  });

  it("does not fetch or reject on build year during preliminary screening", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: 2015,
      floor_area_sqm: 180,
      land_area_sqm: 900,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({ address: "130 Example Road, St Heliers, Auckland City, Auckland", landArea: 900 }),
    ], 1, null, {
      allowMissingListingPrice: true,
      strictStandardSubdivision: true,
      preliminarySubdivision: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].buildYear).toBeNull();
    expect(results[0].subdivisionRejectReason).toBe("build_year_unknown");
    expect(results[0].screeningStatus).toBe("preliminary");
  });

  it("excludes a Fisherton-style MHU single property below the 600sqm two-lot threshold", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: 1910,
      floor_area_sqm: 139,
      land_area_sqm: 393,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({
        address: "15 Fisherton Street, Grey Lynn, Auckland City, Auckland",
        landArea: 393,
        bedrooms: 3,
        bathrooms: 1,
      }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toEqual([]);
  });

  it("keeps combined multi-address package listings with package metadata and aggregate facts flagged", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: 1910,
      floor_area_sqm: 139,
      land_area_sqm: 393,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({
        address: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland City, Auckland",
        landArea: 786,
        bedrooms: 6,
        bathrooms: 2,
        isCombinedListing: true,
        combinedListingReason: "multi_address_listing",
      }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      address: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland City, Auckland",
      isCombinedListing: true,
      packageAddress: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland City, Auckland",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn, Auckland City, Auckland",
        "7 Stanmore Road, Grey Lynn, Auckland City, Auckland",
      ],
      aggregateFactsExcluded: true,
      subdivisionRejectReason: "combined_listing_aggregate",
    });
  });

  it("excludes an MHS site that cannot fit two compliant minimum lots", async () => {
    mockedZone.mockResolvedValue({ zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any);

    const results = await preScreenListingsFast([
      listing({ address: "31 Example Street, St Heliers, Auckland City, Auckland", landArea: 700 }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toEqual([]);
  });

  it("excludes a preliminary MHS site that cannot fit two compliant minimum lots", async () => {
    mockedZone.mockResolvedValue({ zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any);
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: null,
      floor_area_sqm: null,
      land_area_sqm: null,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({ address: "33 Example Street, St Heliers, Auckland City, Auckland", landArea: 700 }),
    ], 1, null, {
      allowMissingListingPrice: true,
      strictStandardSubdivision: true,
      preliminarySubdivision: true,
    });

    expect(results).toEqual([]);
  });

  it("excludes a unit-title listing even when parent parcel land area would pass", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: 1950,
      floor_area_sqm: 115,
      land_area_sqm: 342,
      property_type: "Unit",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({
        address: "1 Chesterfield Avenue, St Heliers, Auckland City, Auckland",
        landArea: 342,
        propertyType: "Unit",
        tenureText: "Unit Title",
        legalDescription: "Unit A and Accessory Unit 1-2 Deposited Plan 91363",
      }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toEqual([]);
  });

  it("keeps a non-strict under-budget unit card but suppresses parent parcel land area", async () => {
    mockedLinz.mockResolvedValue({
      parcel_id: "parent",
      appellation: "Lot 1 Deposited Plan 91363",
      area_sqm: 832,
      survey_area_sqm: 832,
      calc_area_sqm: 832,
      title_no: null,
      legal_description: "Lot 1 Deposited Plan 91363",
      topology_type: null,
      bbox: null,
    });
    mockedPropertyValue.mockResolvedValue({
      cv_nzd: 1_200_000,
      lv_nzd: 780_000,
      iv_nzd: 420_000,
      cv_year: 2024,
      property_type: "RESIDENTIAL",
      property_sub_type: "Ownership home units",
      legal_descriptions: ["Unit A and Accessory Unit 1-2 Deposited Plan 91363"],
      land_use_primary: "Single Unit excluding Bach",
      property_improvements: "UNIT & CARPORT",
      land_area_sqm: null,
      floor_area_sqm: 115,
      build_year: 1950,
      build_year_range: null,
      bedrooms: 2,
      bathrooms: 1,
      listing_active: true,
      photo_urls: [],
      address_confirmed: "1 Chesterfield Avenue, St Heliers, Auckland 1071",
      property_id: 6100672,
    });

    const results = await preScreenListingsFast([
      listing({
        address: "1 Chesterfield Avenue, St Heliers, Auckland City, Auckland",
        landArea: 832,
        landAreaConfidence: "unverified",
        propertyType: "Unit",
        tenureText: "Freehold",
        legalDescription: null,
      }),
    ], 1, null, { allowMissingListingPrice: true });

    expect(results).toHaveLength(1);
    expect(results[0].landArea).toBeUndefined();
    expect(results[0].landAreaConfidence).toBe("unverified");
    expect(results[0].typology).toBe("unit_apartment");
    expect(results[0].subdivisionEligible).toBe(false);
    expect(results[0].subdivisionRejectReason).toBe("unit_or_crosslease_signal");
  });

  it("excludes post-2000 standalone freehold sites from strict subdividable cards", async () => {
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null,
      cv_year: null,
      build_year: 2005,
      floor_area_sqm: 180,
      land_area_sqm: 900,
      property_type: "Residential Dwelling",
      sources_confirmed: [],
      sources_estimated: [],
    });

    const results = await preScreenListingsFast([
      listing({ address: "24 Example Road, St Heliers, Auckland City, Auckland", landArea: 900 }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

    expect(results).toEqual([]);
  });

  describe("indeterminate marking (outer retry pass)", () => {
    it("reports a listing as indeterminate when the zone lookup keeps failing", async () => {
      mockedZone.mockRejectedValue(new Error("zone API down"));
      mockedPropertyHistory.mockResolvedValue({
        cv_nzd: null,
        cv_year: null,
        build_year: 1950,
        floor_area_sqm: 150,
        land_area_sqm: 800,
        property_type: "Residential Dwelling",
        sources_confirmed: [],
        sources_estimated: [],
      });

      const { candidates, indeterminate } = await preScreenListingsFastDetailed([
        listing({ address: "124 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
      ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

      expect(candidates).toEqual([]);
      expect(indeterminate).toHaveLength(1);
      expect(indeterminate[0].address).toContain("124 Example Road");
    }, 30_000);

    it("reports a listing as indeterminate when build year cannot be resolved", async () => {
      mockedPropertyHistory.mockResolvedValue({
        cv_nzd: null,
        cv_year: null,
        build_year: null,
        floor_area_sqm: 150,
        land_area_sqm: 800,
        property_type: "Residential Dwelling",
        sources_confirmed: [],
        sources_estimated: [],
      });
      mockedPropertyValue.mockResolvedValue(null);

      const { candidates, indeterminate } = await preScreenListingsFastDetailed([
        listing({ address: "127 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
      ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

      expect(candidates).toEqual([]);
      expect(indeterminate).toHaveLength(1);
    }, 30_000);

    it("treats a post-2000 standalone freehold as a definitive reject, not indeterminate", async () => {
      mockedPropertyHistory.mockResolvedValue({
        cv_nzd: null,
        cv_year: null,
        build_year: 2010,
        floor_area_sqm: 180,
        land_area_sqm: 900,
        property_type: "Residential Dwelling",
        sources_confirmed: [],
        sources_estimated: [],
      });

      const { candidates, indeterminate } = await preScreenListingsFastDetailed([
        listing({ address: "26 Example Road, St Heliers, Auckland City, Auckland", landArea: 900 }),
      ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

      expect(candidates).toEqual([]);
      expect(indeterminate).toEqual([]);
    });
  });
});
