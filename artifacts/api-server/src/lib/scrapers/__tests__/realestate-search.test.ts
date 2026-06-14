import { describe, expect, it, vi } from "vitest";
import { fetchListingBatch } from "../realestate-search";

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
});
