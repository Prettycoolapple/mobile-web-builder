import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveActiveListingContext, extractListingFactsFromHtml } from "../active-listing-context";
import { fetchRealestateListingForAddress, fetchRealestateListingByUrl } from "../scrapers/realestate-api";
import { scrapeHomesPhotos } from "../scrapers/homes-photos";
import { scrapeOneRoofPhotos } from "../scrapers/oneroof-photos";
import { scrapeTradeMePropertyPhotos } from "../scrapers/trademe-property";
import { fetchWithScrapingBee } from "../scrapers/scrapingbee";

vi.mock("../scrapers/realestate-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../scrapers/realestate-api")>();
  return {
    ...actual,
    fetchRealestateListingForAddress: vi.fn(),
    fetchRealestateListingByUrl: vi.fn(),
  };
});

vi.mock("../scrapers/homes-photos", () => ({
  scrapeHomesPhotos: vi.fn(),
}));

vi.mock("../scrapers/oneroof-photos", () => ({
  scrapeOneRoofPhotos: vi.fn(),
}));

vi.mock("../scrapers/trademe-property", () => ({
  scrapeTradeMePropertyPhotos: vi.fn(),
}));

vi.mock("../scrapers/scrapingbee", () => ({
  fetchWithScrapingBee: vi.fn(),
}));

const mockedFetchRealestateListingForAddress = vi.mocked(fetchRealestateListingForAddress);
const mockedFetchRealestateListingByUrl = vi.mocked(fetchRealestateListingByUrl);
const mockedScrapeHomesPhotos = vi.mocked(scrapeHomesPhotos);
const mockedScrapeOneRoofPhotos = vi.mocked(scrapeOneRoofPhotos);
const mockedScrapeTradeMePropertyPhotos = vi.mocked(scrapeTradeMePropertyPhotos);
const mockedFetchWithScrapingBee = vi.mocked(fetchWithScrapingBee);

describe("resolveActiveListingContext", () => {
  beforeEach(() => {
    mockedFetchRealestateListingForAddress.mockReset();
    mockedFetchRealestateListingByUrl.mockReset();
    mockedScrapeHomesPhotos.mockReset();
    mockedScrapeOneRoofPhotos.mockReset();
    mockedScrapeTradeMePropertyPhotos.mockReset();
    mockedFetchWithScrapingBee.mockReset();
  });

  it("uses the same realestate.co.nz listing source as sale property cards first", async () => {
    mockedFetchRealestateListingForAddress.mockResolvedValue({
      address: "10 Allen Road, Grey Lynn, Auckland",
      price: 1_900_000,
      priceText: "$1,900,000",
      landArea: 386,
      floorArea: 120,
      photoUrl: "https://mediaserver.realestate.co.nz/listing.crop.1280x720.jpg",
      photoUrls: ["https://mediaserver.realestate.co.nz/listing.crop.1280x720.jpg"],
      listingUrl: "https://www.realestate.co.nz/123/residential/sale/10-allen-road",
      zone: null,
      bedrooms: 4,
      bathrooms: 2,
    });

    const resolved = await resolveActiveListingContext("10 Allen Road, Grey Lynn", {
      suburb: "Grey Lynn",
      purpose: "feasibility",
    });

    expect(resolved.context).toMatchObject({
      source: "realestate.co.nz",
      bedrooms: 4,
      bathrooms: 2,
      photoUrl: "https://mediaserver.realestate.co.nz/listing.crop.1280x720.jpg",
      isActiveListing: true,
    });
    expect(mockedScrapeHomesPhotos).not.toHaveBeenCalled();
  });

  it("falls back to an exact Homes page and extracts browser-visible facts with ScrapingBee", async () => {
    mockedFetchRealestateListingForAddress.mockResolvedValue(null);
    mockedScrapeHomesPhotos.mockResolvedValue({
      photo_urls: ["https://images.homes.co.nz/property/10-allen-road/front.jpg"],
      listing_url: "https://homes.co.nz/address/auckland/grey-lynn/10-allen-road/RXZ7y",
      data_source: "homes_photos",
      scraped_at: "2026-05-28T00:00:00.000Z",
    });
    mockedFetchWithScrapingBee.mockResolvedValue(`
      <html><body>
        <h1>10 Allen Road, Grey Lynn</h1>
        <p>For sale</p>
        <p>4 bedrooms 2 bathrooms</p>
        <p>Floor area 120m2</p>
        <p>Land area 386m2</p>
        <p>Price by negotiation</p>
        <p>Listed by Jane Agent from Ray White</p>
        <p>${"Architectural family home with exact active listing content. ".repeat(20)}</p>
      </body></html>
    `);

    const resolved = await resolveActiveListingContext("10 Allen Road, Grey Lynn", {
      suburb: "Grey Lynn",
      purpose: "feasibility",
    });

    expect(resolved.context).toMatchObject({
      source: "homes",
      listingUrl: "https://homes.co.nz/address/auckland/grey-lynn/10-allen-road/RXZ7y",
      bedrooms: 4,
      bathrooms: 2,
      landArea: 386,
      floorArea: 120,
      agentName: "Jane Agent",
      agencyName: "Ray White",
    });
  });

  it("does not run paid fallback sources for subdivision screening purpose", async () => {
    mockedFetchRealestateListingForAddress.mockResolvedValue(null);

    const resolved = await resolveActiveListingContext("66A Marine Parade, Mellons Bay", {
      suburb: "Mellons Bay",
      purpose: "subdivision_screen",
    });

    expect(resolved.context).toBeNull();
    expect(mockedScrapeHomesPhotos).not.toHaveBeenCalled();
    expect(mockedScrapeOneRoofPhotos).not.toHaveBeenCalled();
    expect(mockedScrapeTradeMePropertyPhotos).not.toHaveBeenCalled();
  });

  it("marks combined realestate listings and excludes aggregate listing facts", async () => {
    mockedFetchRealestateListingForAddress.mockResolvedValue({
      address: "3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei",
      price: 3_500_000,
      priceText: "$3,500,000",
      landArea: 6337,
      floorArea: 483,
      photoUrl: "https://mediaserver.realestate.co.nz/package.jpg",
      photoUrls: ["https://mediaserver.realestate.co.nz/package.jpg"],
      listingUrl: "https://www.realestate.co.nz/package-rukutai",
      zone: null,
      bedrooms: 12,
      bathrooms: 6,
      isCombinedListing: true,
      combinedListingReason: "multi_address_listing",
    });

    const resolved = await resolveActiveListingContext("3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei", {
      suburb: "Orakei",
      purpose: "feasibility",
    });

    expect(resolved.context).toMatchObject({
      isCombinedListing: true,
      aggregateFactsExcluded: true,
      packageAddress: "3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei",
      childAddresses: [
        "3 Rukutai Street, Orakei",
        "5 Rukutai Street, Orakei",
        "7 Rukutai Street, Orakei",
        "9 Rukutai Street, Orakei",
        "11 Rukutai Street, Orakei",
        "12 Godden Crescent, Orakei",
      ],
      bedrooms: null,
      bathrooms: null,
      landArea: null,
      price: null,
    });
  });
});

describe("extractListingFactsFromHtml", () => {
  it("extracts 6+ style listing counts as approximate active listing facts", () => {
    const facts = extractListingFactsFromHtml(`
      <h1>30 Dingle Road, St Heliers</h1>
      <p>6+ bedrooms, 4 bathrooms</p>
      <p>Asking price $5.75m</p>
      <p>Land area 1945m2 Floor area 569m2</p>
      <p>Presented by Terry King, The Kings Of Real Estate</p>
    `);

    expect(facts).toMatchObject({
      bedrooms: 6,
      bathrooms: 4,
      bedroomsApprox: true,
      price: 5_750_000,
      landArea: 1945,
      floorArea: 569,
      agentName: "Terry King",
      agencyName: "The Kings Of Real Estate",
    });
  });
});
