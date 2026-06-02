import { describe, it, expect } from "vitest";
import { formatTitleTypeForDisplay, sanitizeTenureField } from "../titleDisplay";

describe("formatTitleTypeForDisplay", () => {
  it("normalises fee simple / freehold to plain Freehold", () => {
    expect(formatTitleTypeForDisplay("Fee Simple")).toBe("Freehold");
    expect(formatTitleTypeForDisplay("freehold")).toBe("Freehold");
    expect(formatTitleTypeForDisplay("FREEHOLD")).toBe("Freehold");
  });

  it("preserves recognised non-freehold tenures", () => {
    expect(formatTitleTypeForDisplay("Cross Lease")).toBe("Cross Lease");
    expect(formatTitleTypeForDisplay("Leasehold")).toBe("Leasehold");
    expect(formatTitleTypeForDisplay("Unit Title")).toBe("Unit Title");
    expect(formatTitleTypeForDisplay("Stratum in Freehold")).toBe("Stratum in Freehold");
  });

  it("accepts a valid zh-localised tenure (has English token in parens) — not rejected", () => {
    // api-server copy normalises to the English token (zh localisation happens
    // later in translation); the key point is it is NOT rejected as garbage.
    expect(formatTitleTypeForDisplay("永久产权 (Freehold)")).toBe("Freehold");
    expect(formatTitleTypeForDisplay("交叉租赁产权 (Cross Lease)")).toBe("交叉租赁产权 (Cross Lease)");
  });

  it("REJECTS scraped page-navigation chrome (the yellow-tag bug)", () => {
    // The exact class of garbage seen in production, English + translated forms.
    expect(
      formatTitleTypeForDisplay(
        "realestate.co.nz residential mobile nav Search: Residential Rural Business Business For sellers:",
      ),
    ).toBeNull();
    expect(
      formatTitleTypeForDisplay(".co.nz 住宅移动导航 搜索：住宅 乡村 商业 商业 面向卖家："),
    ).toBeNull();
    expect(formatTitleTypeForDisplay("住宅 乡村 商业 面向卖家")).toBeNull();
    expect(formatTitleTypeForDisplay("https://www.realestate.co.nz/residential")).toBeNull();
  });

  it("rejects empty / nullish / non-tenure free text", () => {
    expect(formatTitleTypeForDisplay(null)).toBeNull();
    expect(formatTitleTypeForDisplay(undefined)).toBeNull();
    expect(formatTitleTypeForDisplay("   ")).toBeNull();
    expect(formatTitleTypeForDisplay("3 bedroom house with garage")).toBeNull();
  });
});

describe("sanitizeTenureField (source guard)", () => {
  it("keeps raw tenure wording for downstream scoring regexes", () => {
    expect(sanitizeTenureField("Fee Simple")).toBe("Fee Simple"); // NOT normalised
    expect(sanitizeTenureField("Cross Lease")).toBe("Cross Lease");
    expect(sanitizeTenureField("Leasehold")).toBe("Leasehold");
  });

  it("drops scraped nav chrome to null", () => {
    expect(
      sanitizeTenureField("realestate.co.nz residential mobile nav Search: Residential Rural Business"),
    ).toBeNull();
    expect(sanitizeTenureField("住宅移动导航 搜索：住宅 乡村 商业 面向卖家")).toBeNull();
    expect(sanitizeTenureField("Modern family home")).toBeNull();
  });
});
