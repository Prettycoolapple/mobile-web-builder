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

  // 6 Riddell Road incident: a brand-new multi-townhouse development marketed
  // at the parent address, with no propertyType from the source feed. The
  // marketing copy is the only signal — it must reject before any backend fetch
  // returns the (stale) 1935 council build year.
  it("rejects a new townhouse development described only in marketing copy", () => {
    const v = strictAttributePrefilter(listing({
      address: "6 Riddell Road, Glendowie, Auckland City, Auckland",
      propertyType: null,
      tenureText: null,
      legalDescription: null,
      landArea: 842,
      listingTitle: "6 Riddell Road, Glendowie",
      description:
        "Introducing 10 brand new townhouses in the heart of Glendowie. " +
        "Flexible floorplans: Choose from spacious 3 or 4 bedroom layouts.",
    }));
    expect(v.kind).toBe("reject");
    if (v.kind === "reject") expect(v.reason).toMatch(/listing_claims|verified_typology/);
  });

  it("still passes a genuine do-up that merely advertises townhouse POTENTIAL", () => {
    const v = strictAttributePrefilter(listing({
      propertyType: "House",
      landArea: 842,
      landAreaConfidence: "verified",
      description:
        "Solid 1950s bungalow on a full 842m² MHU section. " +
        "Potential to build townhouses STCA, or land bank and hold.",
    }));
    expect(v.kind).toBe("pass");
  });

  it("rejects a marketed new build even when propertyType says House", () => {
    const v = strictAttributePrefilter(listing({
      propertyType: "House",
      description: "Brand new home completed 2025 with 10-year Master Build guarantee.",
    }));
    expect(v.kind).toBe("reject");
    if (v.kind === "reject") expect(v.reason).toMatch(/listing_claims_new_build/);
  });
});
