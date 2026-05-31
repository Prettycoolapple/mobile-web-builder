import { describe, expect, it } from "vitest";
import { localiseTitleTypeForZh } from "../translation";

describe("localiseTitleTypeForZh", () => {
  it("maps Freehold / Fee Simple to the Chinese label with English in parens", () => {
    expect(localiseTitleTypeForZh("Freehold")).toBe("永久产权 (Freehold)");
    expect(localiseTitleTypeForZh("Fee Simple")).toBe("永久产权 (Freehold)");
    expect(localiseTitleTypeForZh("FREEHOLD")).toBe("永久产权 (Freehold)");
  });

  it("maps Leasehold", () => {
    expect(localiseTitleTypeForZh("Leasehold")).toBe("租赁产权 (Leasehold)");
  });

  it("maps Cross Lease (spelling variants)", () => {
    expect(localiseTitleTypeForZh("Cross Lease")).toBe("交叉租赁产权 (Cross Lease)");
    expect(localiseTitleTypeForZh("crosslease")).toBe("交叉租赁产权 (Cross Lease)");
    expect(localiseTitleTypeForZh("Cross  lease")).toBe("交叉租赁产权 (Cross Lease)");
  });

  it("maps Unit Title — the legitimate land-title type (not the building typology word)", () => {
    expect(localiseTitleTypeForZh("Unit Title")).toBe("单元产权 (Unit Title)");
    expect(localiseTitleTypeForZh("unit title")).toBe("单元产权 (Unit Title)");
  });

  it("maps Stratum", () => {
    expect(localiseTitleTypeForZh("Stratum")).toBe("层级产权 (Stratum)");
    expect(localiseTitleTypeForZh("Stratum in Freehold")).toBe("层级产权 (Stratum)");
  });

  it("returns null for unknown variants so the LLM path can take over", () => {
    expect(localiseTitleTypeForZh(null)).toBeNull();
    expect(localiseTitleTypeForZh(undefined)).toBeNull();
    expect(localiseTitleTypeForZh("")).toBeNull();
    expect(localiseTitleTypeForZh("   ")).toBeNull();
    expect(localiseTitleTypeForZh("Some Bespoke Tenure")).toBeNull();
  });
});
