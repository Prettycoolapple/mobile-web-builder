import { beforeEach, describe, expect, it, vi } from "vitest";
import { preScreenListingsFast } from "../pre-screen";
import { geocodeAddress } from "../geocode";
import { fetchOverlays, fetchUnitaryPlanZone } from "../auckland-council";
import { fetchLINZParcel } from "../linz";
import { scrapeHomes } from "../scrapers/homes";
import { fetchPropertyHistory } from "../property-data";
import type { ListingResult } from "../scrapers/oneroof";

vi.mock("../geocode", () => ({ geocodeAddress: vi.fn() }));
vi.mock("../auckland-council", () => ({
  fetchUnitaryPlanZone: vi.fn(),
  fetchOverlays: vi.fn(),
}));
vi.mock("../linz", () => ({ fetchLINZParcel: vi.fn() }));
vi.mock("../scrapers/homes", () => ({ scrapeHomes: vi.fn() }));
vi.mock("../property-data", () => ({ fetchPropertyHistory: vi.fn() }));

const mockedGeocode = vi.mocked(geocodeAddress);
const mockedZone = vi.mocked(fetchUnitaryPlanZone);
const mockedOverlays = vi.mocked(fetchOverlays);
const mockedLinz = vi.mocked(fetchLINZParcel);
const mockedHomes = vi.mocked(scrapeHomes);
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
    mockedGeocode.mockImplementation(async (address: string) => ({
      lat: -36.85,
      lng: 174.86,
      formatted: `${address}, New Zealand`,
      suburb: "st heliers",
    }));
    mockedZone.mockResolvedValue({ zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 150 } as any);
    mockedOverlays.mockResolvedValue([]);
    mockedLinz.mockResolvedValue(null);
    mockedHomes.mockResolvedValue(null);
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

  it("excludes an MHS site below the two-lot minimum area", async () => {
    mockedZone.mockResolvedValue({ zone_code: "MHS", zone_description: "Mixed Housing Suburban", min_lot_size_sqm: 400 } as any);

    const results = await preScreenListingsFast([
      listing({ address: "31 Example Street, St Heliers, Auckland City, Auckland", landArea: 300 }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true });

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
});
