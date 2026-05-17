import { describe, expect, it } from "vitest";
import { extractListingFactAreaSqm, reconcileListingLandArea } from "../realestate-api";

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
