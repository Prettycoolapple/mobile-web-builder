import { describe, expect, it } from "vitest";
import { strictAttributePrefilter } from "../strict-prefilter";
import type { ListingResult } from "../scrapers/oneroof";

function listing(overrides: Partial<ListingResult>): ListingResult {
  return {
    address: "12 Example Road, St Heliers, Auckland City, Auckland",
    price: 1_800_000,
    priceText: "$1,800,000",
    landArea: 800,
    landAreaSource: "realestate_api",
    landAreaConfidence: "unverified",
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

describe("strictAttributePrefilter", () => {
  it("rejects apartment-format addresses", () => {
    const v = strictAttributePrefilter(listing({ address: "12/45 Queen Street, Auckland Central" }));
    expect(v.kind).toBe("reject");
  });

  it("rejects letter-suffixed street numbers (already-subdivided child lot)", () => {
    const v = strictAttributePrefilter(listing({ address: "352F Kohimarama Road, St Heliers" }));
    expect(v.kind).toBe("reject");
    if (v.kind === "reject") expect(v.reason).toMatch(/letter_suffix/);
  });

  it("rejects Unit / Apartment property types", () => {
    expect(strictAttributePrefilter(listing({ propertyType: "Unit" })).kind).toBe("reject");
    expect(strictAttributePrefilter(listing({ propertyType: "Apartment" })).kind).toBe("reject");
    expect(strictAttributePrefilter(listing({ propertyType: "Townhouse" })).kind).toBe("reject");
    expect(strictAttributePrefilter(listing({ propertyType: "Terrace" })).kind).toBe("reject");
  });

  it("does not reject standalone villa labels as unit typology", () => {
    expect(strictAttributePrefilter(listing({ propertyType: "Villa" })).kind).toBe("pass");
  });

  it("rejects non-freehold tenure", () => {
    expect(strictAttributePrefilter(listing({ tenureText: "Cross Lease" })).kind).toBe("reject");
    expect(strictAttributePrefilter(listing({ tenureText: "Unit Title" })).kind).toBe("reject");
    expect(strictAttributePrefilter(listing({ tenureText: "Leasehold" })).kind).toBe("reject");
  });

  it("rejects verified land area below the two-lot minimum", () => {
    const v = strictAttributePrefilter(listing({
      landArea: 380,
      landAreaConfidence: "verified",
    }));
    expect(v.kind).toBe("reject");
    if (v.kind === "reject") expect(v.reason).toMatch(/below_two_lot_minimum/);
  });

  it("does NOT reject when land area is unverified, even if small", () => {
    // The full pipeline could verify a different value (e.g. LINZ corrects 400 → 850).
    expect(
      strictAttributePrefilter(listing({ landArea: 380, landAreaConfidence: "unverified" })).kind,
    ).toBe("pass");
  });

  it("passes an ambiguous standalone freehold listing", () => {
    const v = strictAttributePrefilter(listing({
      address: "124 Example Road, St Heliers",
      propertyType: "House",
      tenureText: "Freehold",
      landArea: 800,
      landAreaConfidence: "verified",
    }));
    expect(v.kind).toBe("pass");
  });

  it("passes when propertyType is null (no signal either way)", () => {
    const v = strictAttributePrefilter(listing({
      propertyType: null,
      tenureText: null,
      landArea: undefined,
    }));
    expect(v.kind).toBe("pass");
  });
});
