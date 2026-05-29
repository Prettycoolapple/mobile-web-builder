import { describe, expect, it } from "vitest";

/**
 * `scrapeOneRoofPhotos` is currently a no-op since the DuckDuckGo-backed
 * public-search fallback was removed. Photos come from `scrapeOneRoof`'s
 * ScrapingBee path instead. This test guards the no-op contract — the
 * pipeline still calls it for parallel photo enrichment and expects an empty
 * `OneRoofPhotoData` shape.
 */
describe("scrapeOneRoofPhotos", () => {
  it("returns empty OneRoofPhotoData", async () => {
    const { scrapeOneRoofPhotos } = await import("../oneroof-photos");
    const data = await scrapeOneRoofPhotos("70 Screen Road, Coatesville 0793, New Zealand");
    expect(data.data_source).toBe("oneroof_photos");
    expect(data.photo_urls).toEqual([]);
    expect(data.listing_url).toBeNull();
  });
});
