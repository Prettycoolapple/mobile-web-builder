import { describe, expect, it } from "vitest";
import {
  assessPropertyEligibility,
  resolveSubjectLandAreaForEligibility,
  shouldForceSingleLotForEligibility,
  shouldSuppressParentLandAreaForEligibility,
} from "../property-eligibility";
import { extractListingClaims } from "../listing-claims";

describe("property eligibility verifier", () => {
  it("keeps a LINZ-verified Fee Simple home-and-income house standalone despite council 'HOUSE & FLAT' phrasing", () => {
    // Regression: 35 Clarendon Road, St Heliers — LINZ title NA10C/398 is Fee
    // Simple, but Auckland Council records "HOUSE & FLAT" improvements +
    // "Multi-unit" land use + "Home & income" sub-type. The joined corpus used
    // to read "...flat residential..." across field boundaries and classify it
    // as unit_apartment, suppressing all development scores.
    const result = assessPropertyEligibility({
      address: "35 Clarendon Road, St Heliers, Auckland 1071, New Zealand",
      estateType: "Fee Simple",
      verifiedEstateType: "Fee Simple",
      legalDescription: "Lot 2 DP 56787",
      propertyType: "RESIDENTIAL",
      propertySubType: "Home & income",
      propertyValueLegalDescriptions: ["Lot 2 Deposited Plan 56787"],
      landUsePrimary: "Multi-unit",
      propertyImprovements: "HOUSE & FLAT",
      landAreaSqm: 1138,
      floorAreaSqm: 241,
      buildYear: 1970,
      zoneCode: "SHZ",
      potentialLots: 1,
      minLotSize: 600,
    });
    expect(result.typology).not.toBe("unit_apartment");
    expect(result.unitLikeSignal).toBe(false);
    expect(result.crossLeaseSignal).toBe(false);
    expect(result.titleIsFreehold).toBe(true);
    expect(result.titleConfidence).toBe("verified");
  });

  it("does not form unit signals ACROSS corpus field boundaries", () => {
    // Improvements ending in "FLAT" must not merge with the next field
    // ("RESIDENTIAL") into a phantom "flat residential" phrase — and a bare
    // "FLAT" improvements value must not pair with a DP number from a
    // DIFFERENT field into a phantom "Flat ... Deposited Plan" title.
    const result = assessPropertyEligibility({
      address: "12 Example Road, Epsom, Auckland",
      legalDescription: "Lot 3 Deposited Plan 11111",
      propertyType: "RESIDENTIAL",
      propertyImprovements: "DWG & FLAT",
      landAreaSqm: 900,
      floorAreaSqm: 200,
      buildYear: 1955,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });
    expect(result.typology).not.toBe("unit_apartment");
    expect(result.unitLikeSignal).toBe(false);
  });

  it("still classifies a genuine cross-lease flat legal description as unit-like (no verified freehold)", () => {
    const result = assessPropertyEligibility({
      address: "36 King Street, Cambridge",
      estateType: "Cross Lease",
      legalDescription: "Flat 1 Deposited Plan South Auckland 42927",
      propertyType: "House",
      landAreaSqm: 804,
      floorAreaSqm: 110,
      buildYear: 1986,
      zoneCode: "MHS",
      potentialLots: 2,
      minLotSize: 400,
    });
    expect(result.typology).toBe("unit_apartment");
    expect(result.subdivisionRejectReason).toBe("unit_or_crosslease_signal");
  });

  it("a verified NON-freehold estate does not unlock the freehold override", () => {
    const result = assessPropertyEligibility({
      address: "2/8 Shared Drive, Kohimarama, Auckland",
      estateType: "Cross Lease",
      verifiedEstateType: "Cross Lease",
      legalDescription: "Flat 2 Deposited Plan 33333",
      propertyType: "House",
      landAreaSqm: 700,
      floorAreaSqm: 130,
      buildYear: 1978,
      zoneCode: "MHS",
      potentialLots: 1,
      minLotSize: 400,
    });
    expect(result.typology).toBe("unit_apartment");
    expect(result.titleIsFreehold).toBe(false);
  });

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

  it("treats home-and-income freehold-flat wording as standalone when LRS verification is unavailable", () => {
    const result = assessPropertyEligibility({
      address: "35 Clarendon Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 2 Deposited Plan 56787",
      propertyType: "RESIDENTIAL",
      propertySubType: "Home and income",
      landUsePrimary: "Multi-unit",
      propertyImprovements: "FREEHOLD & FLAT",
      landAreaSqm: 1138,
      floorAreaSqm: 293,
      buildYear: 1970,
      zoneCode: "MHU",
      potentialLots: 3,
      minLotSize: 300,
    });

    expect(result.unitLikeSignal).toBe(false);
    expect(result.crossLeaseSignal).toBe(false);
    expect(result.typology).toBe("standalone");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(true);
  });

  it("uses Lot/DP evidence to classify DWG & FLAT as a standalone minor-dwelling property", () => {
    const result = assessPropertyEligibility({
      address: "35 Clarendon Road, St Heliers, Auckland",
      legalDescription: "Lot 2 Deposited Plan 56787",
      propertyType: "RESIDENTIAL",
      propertySubType: "Home & income",
      landUsePrimary: "Multi-unit",
      propertyImprovements: "DWG & FLAT",
      landAreaSqm: 1138,
      floorAreaSqm: 293,
      buildYear: 1970,
      zoneCode: "MHU",
      potentialLots: 3,
      minLotSize: 300,
    });

    expect(result.unitLikeSignal).toBe(false);
    expect(result.typology).toBe("standalone");
    expect(result.titleConfidence).toBe("verified");
    expect(result.subdivisionEligible).toBe(true);
  });

  it("does not treat flat residential wording as a Flat 1-style legal title", () => {
    const result = assessPropertyEligibility({
      address: "35 Clarendon Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 2 Deposited Plan 56787",
      propertyType: "RESIDENTIAL",
      propertySubType: "Home & income",
      landUsePrimary: "Flat residential",
      propertyImprovements: "HOUSE & FLAT",
      landAreaSqm: 1138,
      floorAreaSqm: 293,
      buildYear: 1970,
      zoneCode: "MHU",
      potentialLots: 3,
      minLotSize: 300,
    });

    expect(result.unitLikeSignal).toBe(false);
    expect(result.typology).toBe("standalone");
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

describe("redeveloped-parcel land-area suppression", () => {
  // Regression for 7 Sultan Street, Ellerslie: an old council build (pre-2000)
  // marketed as brand-new townhouses. LINZ still reports the whole ~2018m²
  // pre-demolition parent parcel. The subject townhouse has no land area of its
  // own, so the stale parent area must be suppressed rather than shown.
  const townhouseRedevelopment = () =>
    assessPropertyEligibility({
      address: "7 Sultan Street, Ellerslie, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 1 Deposited Plan 12345",
      landAreaSqm: 2018,
      floorAreaSqm: 90,
      buildYear: 1935,
      zoneCode: "BMU",
      potentialLots: 1,
      minLotSize: 400,
      listingClaims: extractListingClaims({
        description: "Brand new townhouses — one of several in this boutique development.",
      }),
    });

  it("suppresses the parent parcel land area for a redeveloped townhouse/new-build", () => {
    const eligibility = townhouseRedevelopment();
    expect(eligibility.typology).toBe("terrace_townhouse");
    expect(eligibility.subdivisionRejectReason).toBe("listing_claims_new_build");
    expect(shouldSuppressParentLandAreaForEligibility(eligibility)).toBe(true);

    // No listing/PropertyValue subject area available → parent area is excluded.
    const resolved = resolveSubjectLandAreaForEligibility({
      eligibility,
      currentLandAreaSqm: 2018,
      currentLandAreaSource: "linz",
      propertyValueLandAreaSqm: null,
      listingLandAreaSqm: null,
    });
    expect(resolved.landAreaSqm).toBeNull();
    expect(resolved.suppressedParentLandArea).toBe(true);
  });

  it("suppresses the parent area for a multi-unit development claim without a new-build signal", () => {
    const eligibility = assessPropertyEligibility({
      address: "10 Example Road, St Heliers, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 1 Deposited Plan 12345",
      landAreaSqm: 1600,
      buildYear: 1985,
      zoneCode: "MHU",
      potentialLots: 1,
      minLotSize: 400,
      listingClaims: extractListingClaims({
        description: "Rare investment: four freehold units returning solid rent, all tenanted.",
      }),
    });
    expect(eligibility.subdivisionRejectReason).toBe("listing_claims_multi_unit_development");
    expect(shouldSuppressParentLandAreaForEligibility(eligibility)).toBe(true);
  });

  it("does NOT suppress a genuine standalone new build's own land area", () => {
    const eligibility = assessPropertyEligibility({
      address: "50 Example Road, Flat Bush, Auckland",
      estateType: "Fee Simple",
      legalDescription: "Lot 7 Deposited Plan 54321",
      propertyType: "Residential Dwelling",
      landAreaSqm: 420,
      floorAreaSqm: 210,
      buildYear: 1990,
      zoneCode: "MHS",
      potentialLots: 1,
      minLotSize: 400,
      listingClaims: extractListingClaims({
        description: "Stunning brand new standalone home on its own freehold title.",
      }),
    });
    // Reject reason is the new-build signal, but typology stays standalone …
    expect(eligibility.typology).toBe("standalone");
    expect(eligibility.subdivisionRejectReason).toBe("listing_claims_new_build");
    // … so its own valid parcel area must be kept, not suppressed.
    expect(shouldSuppressParentLandAreaForEligibility(eligibility)).toBe(false);
    const resolved = resolveSubjectLandAreaForEligibility({
      eligibility,
      currentLandAreaSqm: 420,
      currentLandAreaSource: "linz",
      propertyValueLandAreaSqm: null,
    });
    expect(resolved.landAreaSqm).toBe(420);
    expect(resolved.suppressedParentLandArea).toBe(false);
  });
});
