import { describe, expect, it } from "vitest";
import {
  inferComparableTypology,
  selectComparableSalesForExit,
} from "../market-comparables";
import type { ComparableSale } from "../comparables";

function comp(address: string, land_sqm: number, floor_sqm: number, price_nzd: number, source: ComparableSale["source"] = "oneroof_sold"): ComparableSale {
  return {
    address,
    sale_date: "2025-01-01",
    price_nzd,
    land_sqm,
    floor_sqm,
    price_per_sqm: Math.round(price_nzd / Math.max(1, floor_sqm)),
    cv_nzd: null,
    build_year: 2020,
    source,
  };
}

describe("market comparable selection", () => {
  it("infers terrace/townhouse typology from type, unit address, and small lot size", () => {
    expect(inferComparableTypology({ rawType: "Terrace house" })).toBe("terrace_townhouse");
    expect(inferComparableTypology({ address: "2/31 Example Street", land_sqm: 180 })).toBe("terrace_townhouse");
    expect(inferComparableTypology({ address: "31 Example Street", land_sqm: 650 })).toBe("standalone");
  });

  it("prefers same-product terrace/townhouse comps for small multi-lot rebuilds", () => {
    const result = selectComparableSalesForExit({
      lots: 4,
      sqmPerLot: 185,
      subjectLandSqm: 740,
      comparables: [
        comp("1 Big Avenue", 720, 220, 1_900_000),
        comp("2 Big Avenue", 680, 210, 1_850_000),
        comp("1/10 Small Lane", 155, 130, 1_050_000),
        comp("2/10 Small Lane", 162, 135, 1_075_000),
        comp("3/10 Small Lane", 168, 138, 1_080_000),
      ],
    });

    expect(result.typologyMatched).toBe(true);
    expect(result.comparables).toHaveLength(3);
    expect(result.comparables.every((c) => c.typology === "terrace_townhouse")).toBe(true);
    expect(result.comparables.every((c) => c.relevanceScore != null)).toBe(true);
  });

  it("falls back to best available comps when typology-matched pool is insufficient", () => {
    const result = selectComparableSalesForExit({
      lots: 4,
      sqmPerLot: 185,
      subjectLandSqm: 740,
      comparables: [
        comp("1 Big Avenue", 720, 220, 1_900_000),
        comp("2 Big Avenue", 680, 210, 1_850_000),
        comp("1/10 Small Lane", 155, 130, 1_050_000),
      ],
    });

    expect(result.typologyMatched).toBe(false);
    expect(result.comparables).toHaveLength(3);
  });
});
