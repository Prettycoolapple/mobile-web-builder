import { describe, expect, it } from "vitest";
import {
  applySelectedListingContextToReport,
  reconcileSelectedListingContextWithLiveListing,
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

  it("does not apply package aggregate facts as single-property overview facts", () => {
    const report: Record<string, unknown> = {
      propertyOverview: {
        bedrooms: 2,
        bathrooms: 1,
        landArea: "393m²",
      },
      data_sources: {},
    };

    applySelectedListingContextToReport(report, {
      address: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      listingUrl: "https://www.realestate.co.nz/package",
      price: 3_500_000,
      landArea: 786,
      bedrooms: 6,
      bathrooms: 2,
      source: "realestate.co.nz",
      isCombinedListing: true,
      packageAddress: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn",
        "7 Stanmore Road, Grey Lynn",
      ],
      aggregateFactsExcluded: true,
    });

    expect(report.propertyOverview).toMatchObject({
      bedrooms: 2,
      bathrooms: 1,
      landArea: "393m²",
      isOnMarket: true,
      combinedListingContext: {
        isCombinedListingMatch: true,
        aggregateFactsExcluded: true,
      },
    });
  });

  it("does not overwrite overview facts with a neighbouring selected listing suffix", () => {
    const report: Record<string, unknown> = {
      propertyOverview: {
        address: "38A Rosebank Road, Papatoetoe, Auckland",
        bedrooms: 4,
        bathrooms: 2,
        landArea: "150mÂ²",
        land_area_sqm: 150,
      },
      data_sources: {},
    };

    applySelectedListingContextToReport(report, {
      address: "38B Rosebank Road, Papatoetoe, Auckland",
      listingUrl: "https://www.barfoot.co.nz/property/residential/manukau-city/papatoetoe/house/923840",
      landArea: 129,
      bedrooms: 4,
      bathrooms: 2,
      source: "barfoot",
    });

    expect(report.propertyOverview).toMatchObject({
      address: "38A Rosebank Road, Papatoetoe, Auckland",
      landArea: "150mÂ²",
      land_area_sqm: 150,
      isOnMarket: true,
    });
  });

  it("allows selected listing facts when the selected address matches the overview address", () => {
    const report: Record<string, unknown> = {
      propertyOverview: {
        address: "38A Rosebank Road, Papatoetoe, Auckland",
        landArea: "129mÂ²",
        land_area_sqm: 129,
      },
      data_sources: {},
    };

    applySelectedListingContextToReport(report, {
      address: "38A Rosebank Road, Papatoetoe, Auckland",
      listingUrl: "https://www.barfoot.co.nz/property/residential/manukau-city/papatoetoe/house/921708",
      landArea: 150,
      floorArea: 136,
      source: "barfoot",
    });

    expect(report.propertyOverview).toMatchObject({
      landArea: "150m²",
      land_area_sqm: 150,
      floorArea: "136m²",
      floor_area_sqm: 136,
    });
  });

  it("clears a stale selected realestate price when the live listing is negotiation", () => {
    const report: Record<string, unknown> = {
      propertyOverview: {
        address: "9 Cathay Lane, Takanini, Papakura, Auckland",
        listingPrice: null,
        listing_price_nzd: null,
      },
      data_sources: {},
    };

    const reconciled = reconcileSelectedListingContextWithLiveListing(
      {
        address: "9 Cathay Lane, Takanini, Papakura, Auckland",
        listingUrl: "https://www.realestate.co.nz/42986379/residential/sale/9-cathay-lane-takanini",
        price: 3_500_000,
        source: "curated",
      },
      {
        address: "9 Cathay Lane, Takanini, Papakura, Auckland",
        listingUrl: "https://www.realestate.co.nz/42986379/residential/sale/9-cathay-lane-takanini?source=test",
        price: null,
        priceText: "Negotiation",
        landArea: 808,
        photoUrl: null,
        photoUrls: [],
        zone: null,
        bedrooms: 3,
        bathrooms: 1,
        listingStatus: "active",
      },
    );

    applySelectedListingContextToReport(report, reconciled);

    expect(report.propertyOverview).toMatchObject({
      address: "9 Cathay Lane, Takanini, Papakura, Auckland",
      listingPrice: null,
      listing_price_nzd: null,
      isOnMarket: true,
    });
    expect((report.data_sources as Record<string, string>).listing_price).toBeUndefined();
  });

  it("clears stale selected land area when the current live listing publishes no land area", () => {
    const report: Record<string, unknown> = {
      propertyOverview: {
        address: "7 Sultan Street, Ellerslie, Auckland",
        landArea: "2018m²",
        land_area_sqm: 2018,
      },
      data_sources: {
        land_area_sqm: "linz",
        landArea_display: "linz",
      },
    };

    const reconciled = reconcileSelectedListingContextWithLiveListing(
      {
        address: "7 Sultan Street, Ellerslie, Auckland",
        listingUrl: "https://www.realestate.co.nz/43000001/residential/sale/7-sultan-street-ellerslie",
        landArea: 2018,
        source: "realestate.co.nz",
      },
      {
        address: "7 Sultan Street, Ellerslie, Auckland",
        listingUrl: "https://www.realestate.co.nz/43000001/residential/sale/7-sultan-street-ellerslie",
        price: null,
        priceText: "By negotiation",
        landArea: null,
        floorArea: 90,
        photoUrl: null,
        photoUrls: [],
        zone: null,
        bedrooms: 3,
        bathrooms: 2,
        listingStatus: "active",
      },
    );

    applySelectedListingContextToReport(report, reconciled);

    expect(report.propertyOverview).not.toHaveProperty("landArea");
    expect(report.propertyOverview).not.toHaveProperty("land_area_sqm");
    expect(report.propertyOverview).toMatchObject({
      floorArea: "90m²",
      isOnMarket: true,
    });
    expect((report.data_sources as Record<string, string>).land_area_sqm).toBeUndefined();
    expect((report.data_sources as Record<string, string>).landArea_display).toBeUndefined();
  });
});
