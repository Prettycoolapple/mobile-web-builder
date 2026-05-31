import { describe, expect, it } from "vitest";
import {
  addressLineAppearsInText,
  addressesLikelyMatch,
  extractCombinedListingAddressParts,
  extractListingFactAreaSqm,
  looksLikeCombinedListingAddress,
  normaliseListingLandAreaSqm,
  reconcileListingBedBath,
  reconcileListingLandArea,
} from "../realestate-api";

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

describe("realestate-api listing bed/bath reconciliation", () => {
  it("prefers the listing-page bathroom count over the API aggregate", () => {
    // 66A Marine Parade: API bathrooms-total-count 9, page shows 5.
    expect(reconcileListingBedBath(6, 9, 6, 5)).toEqual({ bedrooms: 6, bathrooms: 5 });
  });

  it("drops an implausible bathroom aggregate when the page has no count", () => {
    // API says 9 baths / 6 beds and the page gave us no bathroom value.
    expect(reconcileListingBedBath(6, 9, 6, null)).toEqual({ bedrooms: 6, bathrooms: null });
  });

  it("keeps the API count when it is plausible and the page agrees", () => {
    expect(reconcileListingBedBath(3, 1, 3, 1)).toEqual({ bedrooms: 3, bathrooms: 1 });
  });

  it("keeps the API count when the page offers no comparison and it is plausible", () => {
    expect(reconcileListingBedBath(4, 3, null, null)).toEqual({ bedrooms: 4, bathrooms: 3 });
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

  it("expands comma-separated shared-street package numbers", () => {
    expect(extractCombinedListingAddressParts("3, 5, 7, 9 and 11 Rukutai Street, Orakei, Auckland")).toEqual({
      packageAddress: "3, 5, 7, 9 and 11 Rukutai Street, Orakei, Auckland",
      childAddresses: [
        "3 Rukutai Street, Orakei, Auckland",
        "5 Rukutai Street, Orakei, Auckland",
        "7 Rukutai Street, Orakei, Auckland",
        "9 Rukutai Street, Orakei, Auckland",
        "11 Rukutai Street, Orakei, Auckland",
      ],
    });
  });

  it("expands package listings across multiple street groups", () => {
    expect(extractCombinedListingAddressParts("3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei")).toEqual({
      packageAddress: "3, 5, 7, 9 and 11 Rukutai Street and 12 Godden Crescent, Orakei",
      childAddresses: [
        "3 Rukutai Street, Orakei",
        "5 Rukutai Street, Orakei",
        "7 Rukutai Street, Orakei",
        "9 Rukutai Street, Orakei",
        "11 Rukutai Street, Orakei",
        "12 Godden Crescent, Orakei",
      ],
    });
  });

  it("normalises Cresent typo while detecting package listings", () => {
    expect(extractCombinedListingAddressParts("11 Rukutai Street and 12 Godden Cresent, Orakei")).toEqual({
      packageAddress: "11 Rukutai Street and 12 Godden Crescent, Orakei",
      childAddresses: [
        "11 Rukutai Street, Orakei",
        "12 Godden Crescent, Orakei",
      ],
    });
  });

  it("keeps more than four package children", () => {
    const parsed = extractCombinedListingAddressParts("1, 3, 5, 7, 9 and 11 Example Street, Orakei");
    expect(parsed?.childAddresses).toHaveLength(6);
    expect(parsed?.childAddresses.at(-1)).toBe("11 Example Street, Orakei");
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

describe("realestate-api address matching", () => {
  it("matches geocoder comma-formatted street numbers to listing addresses", () => {
    expect(
      addressesLikelyMatch(
        "1, Chesterfield Avenue, Saint Heliers, Orakei, Auckland, 1074",
        "1 Chesterfield Avenue, Saint Heliers, Auckland City, Auckland",
      ),
    ).toBe(true);
  });

  it("rejects a different street number on the same street", () => {
    expect(
      addressesLikelyMatch("8 Hampton Drive, St Heliers", "12 Hampton Drive, St Heliers"),
    ).toBe(false);
  });

  it("rejects letter-suffix neighbours in free text and URL slugs", () => {
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "https://homes.co.nz/address/auckland/st-heliers/8a-hampton-drive",
      ),
    ).toBe(false);
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "<h1>8A Hampton Drive, St Heliers</h1><p>5 bedrooms 2 bathrooms</p>",
      ),
    ).toBe(false);
  });

  it("accepts exact street lines in text and URL slugs", () => {
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "https://homes.co.nz/address/auckland/st-heliers/8-hampton-drive",
      ),
    ).toBe(true);
    expect(
      addressLineAppearsInText(
        "8 Hampton Drive, St Heliers",
        "<h1>8 Hampton Dr, Saint Heliers</h1><p>3 bedrooms 1 bathroom</p>",
      ),
    ).toBe(true);
  });

  it("rejects the same number on a different street type", () => {
    expect(
      addressesLikelyMatch("8 Hampton Drive, St Heliers", "8 Hampton Street, St Heliers"),
    ).toBe(false);
  });

  it("accepts street-type abbreviation variants (Rd vs Road)", () => {
    expect(
      addressesLikelyMatch("8 Hampton Road, St Heliers", "8 Hampton Rd, St Heliers"),
    ).toBe(true);
  });

  it("accepts a unit/suffix variant via containment", () => {
    expect(
      addressesLikelyMatch("8 Hampton Drive", "8 Hampton Drive Flat 2"),
    ).toBe(true);
  });
});
