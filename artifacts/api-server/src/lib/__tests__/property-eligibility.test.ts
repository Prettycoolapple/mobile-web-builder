import { describe, expect, it } from "vitest";
import {
  assessPropertyEligibility,
  resolveSubjectLandAreaForEligibility,
  shouldForceSingleLotForEligibility,
} from "../property-eligibility";
import { extractListingClaims } from "../listing-claims";

describe("property eligibility verifier", () => {
  it("treats listing-claimed townhouse as verified terrace typology", () => {
    const result = assessPropertyEligibility({
      address: "6 Riddell Road, Glendowie, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 1 Deposited Plan 12345",
      landAreaSqm: 842,
      buildYear: 1935,
      zoneCode: "MHU",
      potentialLots: 2,
      minLotSize: 400,
      listingClaims: extractListingClaims({
        description: "Introducing 10 brand new townhouses in the heart of Glendowie.",
      }),
    });
    expect(result.typology).toBe("terrace_townhouse");
    expect(result.typologyConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("listing_claims_new_build");
    expect(shouldForceSingleLotForEligibility(result)).toBe(true);
  });

  it("rejects multi-unit development claims without a new-build signal", () => {
    const result = assessPropertyEligibility({
      address: "10 Example Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 1 Deposited Plan 12345",
      landAreaSqm: 900,
      buildYear: 1985,
      zoneCode: "MHU",
      potentialLots: 2,
      minLotSize: 400,
      listingClaims: extractListingClaims({
        description: "Rare investment: four freehold units returning solid rent, all tenanted.",
      }),
    });
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("listing_claims_multi_unit_development");
  });

  it("leaves behaviour unchanged when claims are absent or all-false", () => {
    const withNoClaims = assessPropertyEligibility({
      address: "124 Example Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 1 Deposited Plan 12345",
      propertyType: "Residential Dwelling",
      landAreaSqm: 800,
      buildYear: 1950,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
      listingClaims: extractListingClaims({
        description: "Original weatherboard home, potential to build townhouses STCA.",
      }),
    });
    expect(withNoClaims.subdivisionEligible).toBe(true);
  });
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

  it("treats slash-prefixed apartment addresses as verified unit/apartment typology", () => {
    const result = assessPropertyEligibility({
      address: "3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland",
      estateType: null,
      propertyType: null,
      landAreaSqm: null,
      floorAreaSqm: 95,
      buildYear: null,
      zoneCode: "THAB",
      potentialLots: null,
      minLotSize: null,
    });

    expect(result.typology).toBe("unit_apartment");
    expect(result.typologyConfidence).toBe("verified");
    expect(result.titleConfidence).toBe("unknown");
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("unit_or_crosslease_signal");
    expect(shouldForceSingleLotForEligibility(result)).toBe(true);
  });

  it("rejects ownership home unit signals from PropertyValue even when listing tenure says freehold", () => {
    const result = assessPropertyEligibility({
      address: "1 Chesterfield Avenue, St Heliers, Auckland",
      estateType: "Freehold",
      propertyType: "RESIDENTIAL",
      propertySubType: "Ownership home units",
      propertyValueLegalDescriptions: ["Unit A and Accessory Unit 1-2 Deposited Plan 91363"],
      landUsePrimary: "Single Unit excluding Bach",
      propertyImprovements: "UNIT & CARPORT",
      landAreaSqm: 832,
      floorAreaSqm: 115,
      buildYear: 1950,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    expect(result.typology).toBe("unit_apartment");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("unit_or_crosslease_signal");
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

  it("treats PropertyValue Dwelling subtype as standalone when title and land also qualify", () => {
    const result = assessPropertyEligibility({
      address: "88 Example Avenue, Albany, Auckland",
      estateType: "Freehold",
      propertyType: "RESIDENTIAL",
      propertySubType: "Dwelling",
      landUsePrimary: "Single Unit excluding Bach",
      propertyImprovements: "DWG OI",
      legalDescription: "Lot 124 Deposited Plan 331306",
      landAreaSqm: 900,
      floorAreaSqm: 160,
      buildYear: 1980,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    expect(result.typology).toBe("standalone");
    expect(result.subdivisionEligible).toBe(true);
  });

  it("treats single-unit land-use wording as standalone, not as unknown typology", () => {
    const result = assessPropertyEligibility({
      address: "35 Clarendon Road, St Heliers, Auckland",
      estateType: "Freehold",
      propertyType: "RESIDENTIAL",
      landUsePrimary: "Single Unit excluding Bach",
      propertyImprovements: "DWG OI",
      landAreaSqm: 1138,
      floorAreaSqm: 220,
      buildYear: 1960,
      zoneCode: "MHU",
      potentialLots: 3,
      minLotSize: 300,
    });

    expect(result.typology).toBe("standalone");
    expect(result.typologyConfidence).toBe("verified");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(true);
  });

  it("does not treat fee-simple home-and-income HOUSE & FLAT wording as unit title", () => {
    const result = assessPropertyEligibility({
      address: "35 Clarendon Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      propertyType: "RESIDENTIAL",
      propertySubType: "Home & income",
      landUsePrimary: "Multi-unit",
      propertyImprovements: "HOUSE & FLAT",
      propertyValueLegalDescriptions: ["Lot 2 Deposited Plan 56787"],
      landAreaSqm: 1138,
      floorAreaSqm: 293,
      buildYear: 1970,
      zoneCode: "MHU",
      potentialLots: 3,
      minLotSize: 300,
    });

    expect(result.typology).toBe("standalone");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(true);
  });

  it("treats Deeds Plan lot descriptions as freehold-style title evidence", () => {
    const result = assessPropertyEligibility({
      address: "36 King Street, Grey Lynn, Auckland",
      estateType: null,
      propertyType: "RESIDENTIAL",
      propertySubType: "Dwelling",
      landUsePrimary: "Single Unit excluding Bach",
      propertyImprovements: "HOUSE",
      propertyValueLegalDescriptions: ["Part Lot 103 Deeds Plan 1378"],
      landAreaSqm: 374,
      floorAreaSqm: 87,
      buildYear: 1910,
      zoneCode: "SHZ",
      potentialLots: 1,
      minLotSize: 600,
    });

    expect(result.typology).toBe("standalone");
    expect(result.titleConfidence).toBe("verified");
    expect(result.titleIsFreehold).toBe(true);
    expect(result.subdivisionRejectReason).toBe("insufficient_land_for_two_lots");
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
      minLotSize: 300,
    });

    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("unit_or_crosslease_signal");
  });

  it("rejects combined listing aggregate facts for strict subdivision", () => {
    const result = assessPropertyEligibility({
      address: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      estateType: "Freehold",
      legalDescription: "Lot 1 Deposited Plan 12345",
      propertyType: "House",
      buildYear: 1910,
      landAreaSqm: 786,
      floorAreaSqm: 139,
      zoneCode: "MHU",
      potentialLots: 2,
      minLotSize: 300,
      isCombinedListingAggregate: true,
    });

    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("combined_listing_aggregate");
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

  it("suppresses a Chesterfield-style parent parcel area when unit land is unavailable", () => {
    const eligibility = assessPropertyEligibility({
      address: "1 Chesterfield Avenue, St Heliers, Auckland",
      estateType: "Unit Title",
      propertyType: "RESIDENTIAL",
      propertySubType: "Ownership home units",
      propertyValueLegalDescriptions: ["Unit A and Accessory Unit 1-2 Deposited Plan 91363"],
      listingPropertyType: "Unit",
      listingTenureText: "Unit Title",
      landAreaSqm: 832,
      floorAreaSqm: 115,
      buildYear: 1950,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    const result = resolveSubjectLandAreaForEligibility({
      eligibility,
      currentLandAreaSqm: 832,
      currentLandAreaSource: "linz",
      propertyValueLandAreaSqm: null,
      listingLandAreaSqm: null,
      listingLandAreaSource: "unknown",
      listingLandAreaConfidence: "unverified",
    });

    expect(result.landAreaSqm).toBeNull();
    expect(result.source).toBe("unavailable_unit_or_non_standalone");
    expect(result.suppressedParentLandArea).toBe(true);
  });

  it("uses exact PropertyValue child land for a unit instead of a parent parcel", () => {
    const eligibility = assessPropertyEligibility({
      address: "2/15 Toru Street, Te Atatu Peninsula, Auckland",
      propertyType: "RESIDENTIAL",
      propertySubType: "Ownership home units",
      propertyValueLegalDescriptions: ["Lot 1 Deposited Plan 607766", "Lot 9 Deposited Plan 607766"],
      landUsePrimary: "Multi-unit",
      propertyImprovements: "DUPLEX OI",
      landAreaSqm: 600,
      floorAreaSqm: 56,
      buildYear: 2023,
      zoneCode: "MHS",
      potentialLots: 1,
      minLotSize: 400,
    });

    const result = resolveSubjectLandAreaForEligibility({
      eligibility,
      currentLandAreaSqm: 600,
      currentLandAreaSource: "linz",
      propertyValueLandAreaSqm: 58,
    });

    expect(result.landAreaSqm).toBe(58);
    expect(result.source).toBe("propertyvalue");
    expect(result.suppressedParentLandArea).toBe(true);
  });

  it("uses verified subject listing land for a unit when PropertyValue has no land", () => {
    const eligibility = assessPropertyEligibility({
      address: "1/10 Example Street, Auckland",
      estateType: "Unit Title",
      legalDescription: "Unit A Deposited Plan 12345",
      listingPropertyType: "Unit",
      listingTenureText: "Unit Title",
      landAreaSqm: 832,
      floorAreaSqm: 115,
      buildYear: 1970,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });

    const result = resolveSubjectLandAreaForEligibility({
      eligibility,
      currentLandAreaSqm: 832,
      currentLandAreaSource: "linz",
      propertyValueLandAreaSqm: null,
      listingLandAreaSqm: 342,
      listingLandAreaSource: "realestate_page",
      listingLandAreaConfidence: "verified",
      listingLandAreaApprox: false,
    });

    expect(result.landAreaSqm).toBe(342);
    expect(result.source).toContain("realestate.co.nz");
  });

  it("leaves standalone freehold land area untouched", () => {
    const eligibility = assessPropertyEligibility({
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

    const result = resolveSubjectLandAreaForEligibility({
      eligibility,
      currentLandAreaSqm: 800,
      currentLandAreaSource: "linz",
      propertyValueLandAreaSqm: null,
    });

    expect(result.landAreaSqm).toBe(800);
    expect(result.source).toBe("linz");
    expect(result.suppressedParentLandArea).toBe(false);
  });

  it("uses a LINZ-verified fee-simple estate to confirm freehold even when listing copy is silent", () => {
    const result = assessPropertyEligibility({
      address: "12 Verified Road, St Heliers, Auckland",
      estateType: null,
      verifiedEstateType: "Fee Simple",
      legalDescription: "",
      landAreaSqm: 900,
      buildYear: 1980,
      zoneCode: "MHU",
      potentialLots: 2,
      minLotSize: 400,
    });
    expect(result.titleConfidence).toBe("verified");
    expect(result.titleIsFreehold).toBe(true);
  });

  it("treats a LINZ-verified cross lease as confirmed non-freehold", () => {
    const result = assessPropertyEligibility({
      address: "8 Crosslease Ave, Kohimarama, Auckland",
      estateType: null,
      verifiedEstateType: "Cross Lease",
      legalDescription: "",
      landAreaSqm: 800,
      buildYear: 1980,
      zoneCode: "MHU",
      potentialLots: 2,
      minLotSize: 400,
    });
    expect(result.titleConfidence).toBe("verified");
    expect(result.titleIsFreehold).toBe(false);
    expect(result.subdivisionEligible).toBe(false);
  });

  it("waives the tenure/typology gates for an opted-in cross-lease site with land potential", () => {
    const base = {
      address: "2/10 Example Street, St Heliers, Auckland",
      estateType: "Cross Lease",
      legalDescription: "Flat 2 Deposited Plan 98765",
      propertyType: "House",
      landAreaSqm: 1000,
      floorAreaSqm: 130,
      buildYear: 1960,
      zoneCode: "MHU",
      potentialLots: 6,
      minLotSize: 300,
    } as const;

    // Without the waiver it is rejected on the cross-lease signal (baseline).
    expect(assessPropertyEligibility(base).subdivisionEligible).toBe(false);

    // With the opt-in waiver the land/zone potential carries it through.
    const waived = assessPropertyEligibility({ ...base, waiveTenureForSubdivision: "cross_lease" });
    expect(waived.subdivisionEligible).toBe(true);
    expect(waived.subdivisionRejectReason).toBeNull();
  });

  it("still rejects an opted-in tenure when a structural gate fails (post-2000 build)", () => {
    const result = assessPropertyEligibility({
      address: "3/22 New Build Lane, Kohimarama, Auckland",
      estateType: "Cross Lease",
      legalDescription: "Flat 3 Deposited Plan 55555",
      propertyType: "House",
      landAreaSqm: 1000,
      floorAreaSqm: 150,
      buildYear: 2010,
      zoneCode: "MHU",
      potentialLots: 4,
      minLotSize: 300,
      waiveTenureForSubdivision: "cross_lease",
    });
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("post_2000_build");
  });

  it("still rejects an opted-in tenure when the parcel can't yield two lots", () => {
    const result = assessPropertyEligibility({
      address: "1/5 Tiny Site Road, St Heliers, Auckland",
      estateType: "Leasehold",
      legalDescription: "Flat 1 Deposited Plan 44444",
      propertyType: "House",
      landAreaSqm: 350,
      floorAreaSqm: 120,
      buildYear: 1965,
      zoneCode: "MHS",
      potentialLots: 1,
      minLotSize: 400,
      waiveTenureForSubdivision: "leasehold",
    });
    expect(result.subdivisionEligible).toBe(false);
    expect(result.subdivisionRejectReason).toBe("insufficient_land_for_two_lots");
  });
});
