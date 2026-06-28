import { afterEach, describe, expect, it, vi } from "vitest";
import { _resetSuburbIndexCacheForTests } from "../realestate-api";
import { fetchListingBatch, searchRealEstateListings } from "../realestate-search";

afterEach(() => {
  vi.restoreAllMocks();
  _resetSuburbIndexCacheForTests();
});

describe("realestate-search legacy metadata fallback", () => {
  it("does not invent a midpoint price when the listing page has no explicit price", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: async () => `
        <html>
          <head>
            <meta property="og:title" content="50 Marine Parade, Mellons Bay - For Sale" />
            <meta property="og:description" content="A coastal home with flexible living and sea views." />
            <meta property="og:image" content="https://img.example.test/listing.jpg" />
          </head>
        </html>
      `,
    } as Response);

    try {
      const [listing] = await fetchListingBatch(["https://www.realestate.co.nz/123456/residential/sale/50-marine-parade"], 2_750_000);

      expect(listing).toMatchObject({
        address: "50 Marine Parade, Mellons Bay",
        price: null,
        priceText: "Price on application",
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("does not run an unscoped HTML fallback when the suburb cannot be resolved", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], included: [] }),
    } as Response);

    const result = await searchRealEstateListings({
      suburb: "not a real place",
      minPrice: 0,
      maxPrice: 3_000_000,
    });

    expect(result).toMatchObject({
      firstBatch: [],
      remainingListings: [],
      totalFound: 0,
      done: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
