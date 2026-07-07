import { describe, it, expect } from "vitest";
import { detectPropertyDataLookup, buildPropertyDataLookupAnswer } from "../property-data-lookup";
import type { RawPropertyData } from "../pipeline";

function raw(overrides: Partial<RawPropertyData>): RawPropertyData {
  return { ...overrides } as unknown as RawPropertyData;
}

describe("detectPropertyDataLookup", () => {
  it("classifies value / land / zone questions (EN + ZH)", () => {
    expect(detectPropertyDataLookup("What is the estimated market value of this property")).toBe("value");
    expect(detectPropertyDataLookup("这个房子估值多少")).toBe("value");
    expect(detectPropertyDataLookup("what's the land area?")).toBe("land_area");
    expect(detectPropertyDataLookup("这块地占地多少")).toBe("land_area");
    expect(detectPropertyDataLookup("what zone is this property")).toBe("zone");
    expect(detectPropertyDataLookup("这是什么区")).toBe("zone");
  });

  it("returns null for non-lookup followups", () => {
    expect(detectPropertyDataLookup("should I subdivide this?")).toBeNull();
    expect(detectPropertyDataLookup("what are the next steps")).toBeNull();
  });
});

describe("buildPropertyDataLookupAnswer", () => {
  const withCv = raw({
    propertyValue: { cv_nzd: 1_250_000, cv_year: 2021 } as RawPropertyData["propertyValue"],
    derived_scores: { zone: "MHS", landArea: 800 } as RawPropertyData["derived_scores"],
  });

  it("answers value from the cached CV with source + age, never as a live appraisal", () => {
    const ans = buildPropertyDataLookupAnswer("value", withCv, 12, "12 Example Rd", "en");
    expect(ans).toContain("$1,250,000");
    expect(ans).toContain("council valuation");
    expect(ans).toContain("2021");
    expect(ans).toContain("12 days ago");
    expect(ans).toMatch(/not a live market appraisal/i);
  });

  it("answers land area and zone", () => {
    expect(buildPropertyDataLookupAnswer("land_area", withCv, 1, "12 Example Rd", "en")).toContain("800 m²");
    expect(buildPropertyDataLookupAnswer("zone", withCv, 1, "12 Example Rd", "en")).toContain("MHS");
  });

  it("answers missing value lookups without exposing internal CV fields", () => {
    const answer = buildPropertyDataLookupAnswer("value", raw({}), 1, "x", "en");
    expect(answer).toContain("does not have enough confirmed valuation data");
    expect(answer).not.toMatch(/cv_nzd|cv_year|null/i);
  });

  it("returns null when non-value lookup data isn't cached (caller falls through)", () => {
    expect(buildPropertyDataLookupAnswer("zone", raw({}), 1, "x", "en")).toBeNull();
  });
});
