import { describe, expect, it } from "vitest";
import {
  applySelectedListingContextToReport,
  selectedListingContextFromHistory,
  selectedListingContextToHistoryMarker,
} from "../../lib/selected-listing-context";

describe("selected listing context", () => {
  it("overrides user-visible listing facts and prioritizes selected photos", () => {
    const report: Record<string, unknown> = {
      propertyOverview: {
        bedrooms: 5,
        bathrooms: 4,
        landArea: "1945m²",
      },
      photoUrls: ["https://old.example/photo.jpg"],
      photoUrl: "https://old.example/photo.jpg",
      data_sources: {},
    };

    applySelectedListingContextToReport(report, {
      listingUrl: "https://www.trademe.co.nz/a/property/residential/sale/listing/5850075796",
      photoUrl: "https://photos.trademe.co.nz/property/selected.jpg",
      price: 5_750_000,
      bedrooms: 6,
      bathrooms: 4,
      source: "trademe",
    });

    expect(report.propertyOverview).toMatchObject({
      bedrooms: 6,
      bathrooms: 4,
      listingPrice: "$5,750,000",
      isOnMarket: true,
      listingSource: "trademe",
    });
    expect(report.photoUrls).toEqual([
      "https://photos.trademe.co.nz/property/selected.jpg",
      "https://old.example/photo.jpg",
    ]);
  });

  it("round-trips selected context through the background-job history marker", () => {
    const marker = selectedListingContextToHistoryMarker({
      listingUrl: "https://homes.co.nz/address/auckland/st-heliers/30-dingle-road/kYBNaw",
      bedrooms: 6,
      bathrooms: 4,
      source: "homes",
    });

    expect(selectedListingContextFromHistory([{ role: "assistant", content: marker }])).toMatchObject({
      listingUrl: "https://homes.co.nz/address/auckland/st-heliers/30-dingle-road/kYBNaw",
      bedrooms: 6,
      bathrooms: 4,
      source: "homes",
    });
  });
});
