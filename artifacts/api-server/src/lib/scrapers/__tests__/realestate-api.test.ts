import { describe, expect, it } from "vitest";
import { extractCombinedListingAddressParts, extractListingFactAreaSqm, looksLikeCombinedListingAddress, normaliseListingLandAreaSqm, reconcileListingLandArea } from "../realestate-api";

describe("realestate-api listing land-area reconciliation", () => {
  it("uses listing-page land area when the search API returns a large outlier", () => {
    const result = reconcileListingLandArea(6337, 1198);

    expect(result).toEqual({ landArea: 1198, landAreaApprox: true });
  });

  it("keeps the search API land area when the listing page agrees within tolerance", () => {
    const result = reconcileListingLandArea(1200, 1198);

    expect(result).toEqual({ landArea: 1200, landAreaApprox: false });
  });

  it("does not invent a land area when the search API and listing page are both missing", () => {
    const result = reconcileListingLandArea(null, null);

    expect(result).toEqual({ landArea: null, landAreaApprox: false });
  });
});

describe("realestate-api listing fact extraction", () => {
  it("prefers explicit listing-description area facts over bad header totals", () => {
    const text = `
      Floor area 483m2 Land area 6337m2
      Property details
      Floor Area:79sqm (more or less)
      Land Area:1199sqm (more or less)
    `;

    expect(extractListingFactAreaSqm(text, "floor")).toBe(79);
    expect(extractListingFactAreaSqm(text, "land")).toBe(1199);
  });
});

describe("realestate-api structured listing area units", () => {
  it("converts hectare land-area values to square metres", () => {
    expect(normaliseListingLandAreaSqm(1.4933, "HA")).toBe(14933);
    expect(normaliseListingLandAreaSqm(8734, "SQM")).toBe(8734);
  });
});

describe("realestate-api combined listing detection", () => {
  it("flags package listings with multiple street addresses", () => {
    expect(looksLikeCombinedListingAddress("15 Fisherton Street & 7 Stanmore Road, Grey Lynn")).toBe(true);
    expect(looksLikeCombinedListingAddress("15 Fisherton Street, Grey Lynn")).toBe(false);
  });

  it("extracts child addresses from explicit package listings", () => {
    expect(extractCombinedListingAddressParts("15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland")).toEqual({
      packageAddress: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn, Auckland",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn, Auckland",
        "7 Stanmore Road, Grey Lynn, Auckland",
      ],
    });
  });

  it("expands shared street names for package listing shorthand", () => {
    expect(extractCombinedListingAddressParts("15 & 17 Fisherton Street, Grey Lynn")).toEqual({
      packageAddress: "15 & 17 Fisherton Street, Grey Lynn",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn",
        "17 Fisherton Street, Grey Lynn",
      ],
    });
  });

  it("ignores prompt text before an embedded package address", () => {
    expect(extractCombinedListingAddressParts("Analyse the package 15 Fisherton Street & 7 Stanmore Road, Grey Lynn")).toEqual({
      packageAddress: "15 Fisherton Street & 7 Stanmore Road, Grey Lynn",
      childAddresses: [
        "15 Fisherton Street, Grey Lynn",
        "7 Stanmore Road, Grey Lynn",
      ],
    });
  });
});
