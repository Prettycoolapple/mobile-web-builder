import { beforeEach, describe, expect, it, vi } from "vitest";
import { preScreenListingsFastDetailed } from "../pre-screen";
import { geocodeAddress } from "../geocode";
import { fetchOverlays, fetchUnitaryPlanZone } from "../auckland-council";
import { screenAddressFreehold } from "../linz";
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
// Keep the real tenureCategoryFromEstate / estateTypeFromLrsTitles; only fake the
// network/time-gated calls the freehold gate makes.
vi.mock("../linz", async () => {
  const actual = await vi.importActual<typeof import("../linz")>("../linz");
  return {
    ...actual,
    fetchLINZParcel: vi.fn(async () => null),
    fetchLINZChildAddressCount: vi.fn(async () => null),
    screenAddressFreehold: vi.fn(),
    isLinzTitleServiceAvailable: vi.fn(() => true),
  };
});
vi.mock("../scrapers/homes", () => ({ scrapeHomes: vi.fn() }));
vi.mock("../scrapers/propertyvalue", () => ({ scrapePropertyValue: vi.fn() }));
vi.mock("../property-data", () => ({ fetchPropertyHistory: vi.fn() }));

const mockedGeocode = vi.mocked(geocodeAddress);
const mockedZone = vi.mocked(fetchUnitaryPlanZone);
const mockedOverlays = vi.mocked(fetchOverlays);
const mockedScreenFreehold = vi.mocked(screenAddressFreehold);
const mockedHomes = vi.mocked(scrapeHomes);
const mockedPropertyValue = vi.mocked(scrapePropertyValue);
const mockedPropertyHistory = vi.mocked(fetchPropertyHistory);

function listing(overrides: Partial<ListingResult>): ListingResult {
  return {
    address: "124 Example Road, St Heliers, Auckland City, Auckland",
    price: 1_400_000,
    priceText: "$1,400,000",
    landArea: 800,
    landAreaSource: "realestate_page",
    landAreaConfidence: "verified",
    photoUrl: null,
    listingUrl: "https://www.realestate.co.nz/example",
    zone: null,
    bedrooms: 3,
    bathrooms: 2,
    propertyType: "House",
    // No tenure text — the ONLY tenure signal in these tests comes from the
    // mocked LINZ title lookup, isolating the freehold gate + opt-in behaviour.
    tenureText: null,
    legalDescription: null,
    ...overrides,
  };
}

describe("freehold gate + non-freehold opt-in", () => {
  beforeEach(() => {
    clearScreenVerdictCache();
    mockedGeocode.mockImplementation(async (address: string) => ({
      lat: -36.85,
      lng: 174.86,
      formatted: `${address}, New Zealand`,
      suburb: "st heliers",
    }));
    mockedZone.mockResolvedValue({ zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 300 } as any);
    mockedOverlays.mockResolvedValue([]);
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

  it("drops a LINZ-confirmed cross-lease and counts it when the user has not opted in", async () => {
    mockedScreenFreehold.mockResolvedValue({ decision: "reject", estate: "Cross Lease" });

    const detailed = await preScreenListingsFastDetailed([
      listing({ address: "200 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true, verifyFreeholdTitle: true });

    expect(detailed.candidates).toEqual([]);
    expect(detailed.excludedTenures).toEqual({ cross_lease: 1, leasehold: 0, unit_title: 0 });
  });

  it("keeps an opted-in cross-lease with a warning and screens it on land potential", async () => {
    mockedScreenFreehold.mockResolvedValue({ decision: "reject", estate: "Cross Lease" });

    const detailed = await preScreenListingsFastDetailed([
      listing({ address: "202 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
    ], 1, null, {
      allowMissingListingPrice: true,
      strictStandardSubdivision: true,
      verifyFreeholdTitle: true,
      includeTenures: ["cross_lease"],
    });

    expect(detailed.candidates).toHaveLength(1);
    expect(detailed.candidates[0].titleType).toBe("Cross Lease");
    expect(detailed.candidates[0].titleStatus).toBe("verified");
    expect(detailed.candidates[0].subdivisionTenureWarning).toBe("cross_lease");
    expect(detailed.candidates[0].subdivisionEligible).toBe(true);
    expect(detailed.excludedTenures).toEqual({ cross_lease: 0, leasehold: 0, unit_title: 0 });
  });

  it("keeps a confirmed fee-simple title as a freehold candidate", async () => {
    mockedScreenFreehold.mockResolvedValue({ decision: "keep", titleType: "Freehold", estate: "Fee Simple" });

    const detailed = await preScreenListingsFastDetailed([
      listing({ address: "204 Example Road, St Heliers, Auckland City, Auckland", landArea: 800 }),
    ], 1, null, { allowMissingListingPrice: true, strictStandardSubdivision: true, verifyFreeholdTitle: true });

    expect(detailed.candidates).toHaveLength(1);
    expect(detailed.candidates[0].titleType).toBe("Freehold");
    expect(detailed.candidates[0].titleStatus).toBe("verified");
    expect(detailed.candidates[0].subdivisionTenureWarning).toBeUndefined();
  });
});
