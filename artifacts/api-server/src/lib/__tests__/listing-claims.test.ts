import { describe, expect, it } from "vitest";
import { extractListingClaims, detectRedevelopmentConflict, hasAmbiguousListingSignals } from "../listing-claims";

describe("extractListingClaims", () => {
  it("detects the 6 Riddell Road shape: new multi-unit townhouse development at a parent address", () => {
    const claims = extractListingClaims({
      propertyType: null,
      listingTitle: "6 Riddell Road, Glendowie, Auckland City",
      description:
        "Introducing 10 brand new townhouses in the heart of Glendowie. " +
        "Flexible floorplans: Choose from spacious 3 or 4 bedroom layouts. " +
        "10-year Master Build guarantee for total peace of mind.",
    });
    expect(claims.dwellingIsTownhouse).toBe(true);
    expect(claims.isNewBuild).toBe(true);
    expect(claims.multiUnitDevelopment).toBe(true);
    expect(claims.unitCount).toBe(10);
    expect(claims.townhousePotentialOnly).toBe(false);
    expect(claims.evidence.length).toBeGreaterThan(0);
  });

  it("detects townhouse from the propertyType field alone", () => {
    const claims = extractListingClaims({
      propertyType: "Townhouse",
      listingTitle: "6 Riddell Road, Glendowie",
      description: "Sunny and private with great indoor-outdoor flow.",
    });
    expect(claims.dwellingIsTownhouse).toBe(true);
  });

  it("does NOT flag a do-up advertising townhouse POTENTIAL (STCA)", () => {
    const claims = extractListingClaims({
      propertyType: "House",
      listingTitle: "84 Example Road, Glendowie",
      description:
        "Solid 1950s bungalow on a full 842m² section zoned MHU. " +
        "Potential to build townhouses STCA, or land bank and hold. " +
        "Scope to develop terraces down the line.",
    });
    expect(claims.dwellingIsTownhouse).toBe(false);
    expect(claims.townhousePotentialOnly).toBe(true);
    expect(claims.isNewBuild).toBe(false);
    expect(claims.multiUnitDevelopment).toBe(false);
  });

  it("does NOT treat 'brand new kitchen' as a new build", () => {
    const claims = extractListingClaims({
      propertyType: "House",
      description: "Charming villa with brand new kitchen and bathroom, freshly painted throughout.",
    });
    expect(claims.isNewBuild).toBe(false);
  });

  it("treats 'brand new home' as a new build", () => {
    const claims = extractListingClaims({
      propertyType: "House",
      description: "Move straight into this brand new home, finished to a high standard.",
    });
    expect(claims.isNewBuild).toBe(true);
  });

  it("extracts completion year and flags new build for 'completed 2025, never lived in'", () => {
    const claims = extractListingClaims({
      description: "Completed 2025 and never lived in — be the first to call it home.",
    });
    expect(claims.isNewBuild).toBe(true);
    expect(claims.completionYear).toBe(2025);
  });

  it("does NOT flag 'consent issued for 4 townhouses' as a built multi-unit development", () => {
    const claims = extractListingClaims({
      propertyType: "House",
      description: "Resource consent issued for 4 townhouses — do the groundwork's been done for you.",
    });
    expect(claims.multiUnitDevelopment).toBe(false);
    expect(claims.dwellingIsTownhouse).toBe(false);
  });

  it("flags an actually-built multi-unit offering", () => {
    const claims = extractListingClaims({
      description: "Rare investment: four freehold townhouses returning $2,080pw combined.",
    });
    expect(claims.multiUnitDevelopment).toBe(true);
    expect(claims.unitCount).toBe(4);
    expect(claims.dwellingIsTownhouse).toBe(true);
  });

  it("does NOT flag 'new build potential' copy as a new build", () => {
    const claims = extractListingClaims({
      description: "Flat 700m² site with new build potential in a sought-after street.",
    });
    expect(claims.isNewBuild).toBe(false);
  });

  it("returns all-false for plain do-up copy", () => {
    const claims = extractListingClaims({
      propertyType: "House",
      listingTitle: "12 Quiet Street, Avondale",
      description: "Original 1960s weatherboard home on 680m², first time on the market in 40 years.",
    });
    expect(claims.dwellingIsTownhouse).toBe(false);
    expect(claims.townhousePotentialOnly).toBe(false);
    expect(claims.isNewBuild).toBe(false);
    expect(claims.multiUnitDevelopment).toBe(false);
    expect(claims.completionYear).toBeNull();
  });
});

describe("hasAmbiguousListingSignals", () => {
  it("is true for townhouse mentions the extractor classified neither way", () => {
    expect(hasAmbiguousListingSignals({
      description: "A unique offering near the townhouse precinct of the village.",
    })).toBe(true);
  });

  it("is false when the deterministic extractor already decided IS-townhouse", () => {
    expect(hasAmbiguousListingSignals({
      description: "This stunning townhouse offers easy living.",
    })).toBe(false);
  });

  it("is false for potential-only mentions", () => {
    expect(hasAmbiguousListingSignals({
      description: "Potential to build townhouses STCA on this MHU site.",
    })).toBe(false);
  });

  it("is false when no townhouse words appear at all", () => {
    expect(hasAmbiguousListingSignals({
      description: "Classic villa on a sunny street.",
    })).toBe(false);
  });
});

describe("detectRedevelopmentConflict", () => {
  const newBuildClaims = extractListingClaims({
    description: "Brand new townhouse completed 2025, 10-year Master Build guarantee.",
  });
  const noClaims = extractListingClaims({
    description: "Original 1935 bungalow awaiting your renovation vision.",
  });

  it("suspects redevelopment when listing claims a new build but council says 1935", () => {
    const result = detectRedevelopmentConflict({ claims: newBuildClaims, councilBuildYear: 1935 });
    expect(result.suspected).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("does not suspect anything when the listing makes no new-build claims", () => {
    const result = detectRedevelopmentConflict({ claims: noClaims, councilBuildYear: 1935 });
    expect(result.suspected).toBe(false);
  });

  it("does not suspect a new build when council agrees it's recent", () => {
    const result = detectRedevelopmentConflict({ claims: newBuildClaims, councilBuildYear: 2024 });
    expect(result.suspected).toBe(false);
  });

  it("suspects redevelopment from LINZ child addresses alone", () => {
    const result = detectRedevelopmentConflict({
      claims: noClaims,
      councilBuildYear: 1935,
      linzChildAddressCount: 10,
    });
    expect(result.suspected).toBe(true);
    expect(result.reasons.join(" ")).toMatch(/child addresses/);
  });

  it("adds floor-area corroboration only when a primary conflict exists", () => {
    const corroborated = detectRedevelopmentConflict({
      claims: newBuildClaims,
      councilBuildYear: 1935,
      listingFloorAreaSqm: 110,
      councilFloorAreaSqm: 210,
    });
    expect(corroborated.suspected).toBe(true);
    expect(corroborated.reasons.join(" ")).toMatch(/floor area/);

    const floorOnly = detectRedevelopmentConflict({
      claims: noClaims,
      councilBuildYear: 1935,
      listingFloorAreaSqm: 110,
      councilFloorAreaSqm: 210,
    });
    expect(floorOnly.suspected).toBe(false);
  });
});
