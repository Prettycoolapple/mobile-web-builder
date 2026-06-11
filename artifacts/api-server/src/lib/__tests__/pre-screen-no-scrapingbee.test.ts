import { beforeEach, describe, expect, it, vi } from "vitest";
import { preScreenListingsFast, type PreScreenDetailedResult } from "../pre-screen";
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
vi.mock("../linz", () => ({ fetchLINZParcel: vi.fn(), fetchLINZChildAddressCount: vi.fn(async () => null) }));
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
    landArea: null,
    landAreaSource: "unknown",
    landAreaConfidence: "unverified",
    photoUrl: null,
    listingUrl: "https://www.realestate.co.nz/test-no-bee",
    zone: null,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "House",
    tenureText: "Freehold",
    legalDescription: "Lot 1 Deposited Plan 12345",
    ...overrides,
  };
}

describe("strict-subdivision pre-screen never calls the paid scraper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearScreenVerdictCache();
    mockedGeocode.mockImplementation(async (address: string) => ({
      lat: -36.85, lng: 174.86, formatted: `${address}, New Zealand`, suburb: "st heliers",
    }));
    mockedZone.mockResolvedValue({ zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 300 } as any);
    mockedOverlays.mockResolvedValue([]);
    // LINZ deliberately returns null so the legacy code would have fallen
    // through to scrapeHomes â€” but the new disablePaidScrapers flag prevents it.
    mockedLinz.mockResolvedValue(null);
    mockedPropertyValue.mockResolvedValue(null);
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: null, cv_year: null, build_year: 1950, floor_area_sqm: 150,
      land_area_sqm: null, property_type: "Residential Dwelling",
      sources_confirmed: [], sources_estimated: [],
    });
    mockedHomes.mockImplementation(async () => {
      throw new Error("scrapeHomes must not be called in strict-subdivision discovery");
    });
  });

  it("never invokes scrapeHomes even when LINZ + PropertyValue both miss", async () => {
    await preScreenListingsFast(
      [listing({ landArea: null, landAreaConfidence: "unverified" })],
      1,
      null,
      { allowMissingListingPrice: true, strictStandardSubdivision: true },
    );
    expect(mockedHomes).not.toHaveBeenCalled();
  }, 30_000);

  it("returns indeterminate (not rejected) for a listing whose land area couldn't be verified by free sources", async () => {
    const { preScreenListingsFastDetailed } = await import("../pre-screen");
    const result: PreScreenDetailedResult = await preScreenListingsFastDetailed(
      [listing({ landArea: null, landAreaConfidence: "unverified" })],
      1,
      null,
      { allowMissingListingPrice: true, strictStandardSubdivision: true },
    );
    expect(mockedHomes).not.toHaveBeenCalled();
    // No candidates surface because land area can't be verified by free sources,
    // and the listing is marked indeterminate so the outer retry pass can
    // try again later.
    expect(result.candidates).toEqual([]);
    expect(result.indeterminate.length).toBe(1);
  }, 30_000);
});
