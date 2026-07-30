import { describe, expect, it } from "vitest";
import {
  combinedPackageFactsFromListing,
  extractAdvertisedCombinedLandArea,
} from "../combined-package-facts";

describe("combined package listing facts", () => {
  it("extracts an approximate combined landholding from agent copy", () => {
    expect(extractAdvertisedCombinedLandArea(
      "Secure a combined landholding of approximately 487 sqm across three adjoining titles.",
    )).toEqual({ areaSqm: 487, approximate: true });
  });

  it("handles combined-total and labelled combined-area wording", () => {
    expect(extractAdvertisedCombinedLandArea("Land Size: Combined total of 1,240 m²"))
      .toEqual({ areaSqm: 1240, approximate: false });
    expect(extractAdvertisedCombinedLandArea("Combined land area: approx. 825 sqm"))
      .toEqual({ areaSqm: 825, approximate: true });
  });

  it("does not treat an ordinary child or proposed floor area as package land", () => {
    expect(extractAdvertisedCombinedLandArea("Land area 171 sqm. Proposed home 140 sqm."))
      .toBeNull();
  });

  it("marks a confirmed multi-address listing price as package-level context", () => {
    expect(combinedPackageFactsFromListing({
      address: "39 - 43 Auranga Drive, Karaka",
      price: 825_000,
      priceText: "$825,000",
      landArea: null,
      listingUrl: "https://www.realestate.co.nz/43095711/residential/sale/example",
      zone: null,
      bedrooms: null,
      bathrooms: null,
      photoUrl: null,
      description: "Combined landholding of approximately 487 sqm across three adjoining titles.",
    })).toEqual({
      listingPriceNzd: 825_000,
      listingPriceApprox: false,
      advertisedLandAreaSqm: 487,
      advertisedLandAreaApprox: true,
      listingUrl: "https://www.realestate.co.nz/43095711/residential/sale/example",
      source: "realestate.co.nz",
    });
  });
});
