import { describe, expect, it } from "vitest";
import { assessPropertyEligibility, shouldForceSingleLotForEligibility } from "../property-eligibility";

describe("property eligibility verifier", () => {
  it("rejects 1 Chesterfield-style unit title signals with exact smaller land area", () => {
    const result = assessPropertyEligibility({
      address: "1 Chesterfield Avenue, St Heliers, Auckland",
      estateType: "Unit Title",
      legalDescription: "Unit A and Accessory Unit 1-2 Deposited Plan 91363",
      propertyType: "Unit",
      listingPropertyType: "Unit",
      landAreaSqm: 342,
      floorAreaSqm: 115,
      buildYear: 1950,
      zoneCode: "MHS",
      potentialLots: 1,
      minLotSize: 400,
    });

    expect(result.typology).toBe("unit_apartment");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("unit_or_crosslease_signal");
    expect(shouldForceSingleLotForEligibility(result)).toBe(true);
  });

  it("allows a pre-2000 standalone freehold site with enough verified land", () => {
    const result = assessPropertyEligibility({
      address: "124 Example Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 1 Deposited Plan 12345",
      propertyType: "Residential Dwelling",
      landAreaSqm: 800,
      floorAreaSqm: 160,
      buildYear: 1950,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    expect(result.typology).toBe("standalone");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(true);
    expect(result.subdivisionRejectReason).toBeNull();
  });

  it("rejects cross-lease or unit title even when parent parcel math works", () => {
    const result = assessPropertyEligibility({
      address: "2/10 Example Street, St Heliers, Auckland",
      estateType: "Cross Lease",
      legalDescription: "Flat 2 Deposited Plan 98765",
      propertyType: "House",
      landAreaSqm: 1000,
      floorAreaSqm: 130,
      buildYear: 1960,
      zoneCode: "MHU",
      potentialLots: 6,
      minLotSize: 150,
    });

    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("unit_or_crosslease_signal");
  });

  it("rejects unknown title or typology for strict subdivision discovery", () => {
    const result = assessPropertyEligibility({
      address: "20 Example Avenue, St Heliers, Auckland",
      landAreaSqm: 900,
      floorAreaSqm: 120,
      buildYear: 1955,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("title_not_confirmed_freehold");
  });

  it("rejects post-2000 standalone freehold sites per product rule", () => {
    const result = assessPropertyEligibility({
      address: "22 Example Avenue, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 3 Deposited Plan 22222",
      propertyType: "House",
      landAreaSqm: 900,
      floorAreaSqm: 180,
      buildYear: 2005,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("post_2000_build");
  });
});
