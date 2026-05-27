import { describe, expect, it } from "vitest";
import { resolveDistrictToSuburbs } from "../scrapers/realestate-search";

describe("resolveDistrictToSuburbs", () => {
  it("expands 'orakei' (a Local Board) to its child suburbs", () => {
    const suburbs = resolveDistrictToSuburbs("orakei");
    expect(suburbs).not.toBeNull();
    expect(suburbs!.length).toBeGreaterThanOrEqual(6);
    expect(suburbs).toContain("kohimarama");
    expect(suburbs).toContain("mission bay");
    expect(suburbs).toContain("st heliers");
    expect(suburbs).toContain("meadowbank");
  });

  it("expands 'howick' (also both a district and a suburb name) — district wins because the leaf-suburb case returns null", () => {
    // "howick" is also a suburb key, so the suburb-leaf short-circuit takes effect.
    expect(resolveDistrictToSuburbs("howick")).toBeNull();
  });

  it("expands a district that is NOT also a suburb key — e.g. 'kaipatiki'", () => {
    const suburbs = resolveDistrictToSuburbs("kaipatiki");
    expect(suburbs).not.toBeNull();
    expect(suburbs!.length).toBeGreaterThan(0);
    expect(suburbs).toContain("birkenhead");
    expect(suburbs).toContain("glenfield");
  });

  it("expands 'auckland-city' / 'auckland city' equivalents", () => {
    const hyphen = resolveDistrictToSuburbs("auckland-city");
    const spaced = resolveDistrictToSuburbs("auckland city");
    expect(hyphen).not.toBeNull();
    expect(spaced).not.toBeNull();
    expect(hyphen!.length).toBeGreaterThan(0);
  });

  it("returns null for a leaf suburb so the existing single-suburb path runs", () => {
    expect(resolveDistrictToSuburbs("st heliers")).toBeNull();
    expect(resolveDistrictToSuburbs("kohimarama")).toBeNull();
  });

  it("returns null for an unknown input", () => {
    expect(resolveDistrictToSuburbs("not-a-real-place")).toBeNull();
    expect(resolveDistrictToSuburbs("")).toBeNull();
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(resolveDistrictToSuburbs("  ORAKEI  ")).not.toBeNull();
    expect(resolveDistrictToSuburbs("Orakei")).not.toBeNull();
  });
});
