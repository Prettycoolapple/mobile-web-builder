import { describe, expect, it } from "vitest";
import { buildSubdivisionPathwayNote, calculatePotentialLots } from "../lot-calculator";

describe("lot calculator", () => {
  it("does not default unknown zoning to Mixed Housing Suburban", () => {
    const result = calculatePotentialLots(19996, null);

    expect(result.lots).toBe(1);
    expect(result.min_lot_size).toBe(0);
    expect(result.zone_label).toBe("Unknown zone");
  });

  it("calculates countryside living yield using a 10,000sqm minimum lot size", () => {
    const result = calculatePotentialLots(20000, "CLZ");

    expect(result.lots).toBe(2);
    expect(result.min_lot_size).toBe(10000);
    expect(result.zone_label).toBe("Countryside Living Zone");
  });

  it("requires 800sqm for two standard vacant lots in Mixed Housing Suburban", () => {
    const undersized = calculatePotentialLots(300, "MHS");
    const twoLots = calculatePotentialLots(800, "MHS");

    expect(undersized.lots).toBe(1);
    expect(undersized.min_lot_size).toBe(400);
    expect(twoLots.lots).toBe(2);
  });

  it("requires 600sqm for two standard vacant lots in Mixed Housing Urban", () => {
    const undersized = calculatePotentialLots(599, "MHU");
    const twoLots = calculatePotentialLots(600, "MHU");

    expect(undersized.lots).toBe(1);
    expect(undersized.min_lot_size).toBe(300);
    expect(twoLots.lots).toBe(2);
    expect(twoLots.min_lot_size).toBe(300);
  });

  it("explains that unknown zoning cannot produce an automatic lot yield", () => {
    const note = buildSubdivisionPathwayNote(19996, null, 1, 0, "Unknown zone");

    expect(note.standard_path_viable).toBe(false);
    expect(note.headline).toContain("Zone unavailable");
  });

  it("explains zone minimums without inventing a site area when land area is unavailable", () => {
    const note = buildSubdivisionPathwayNote(null, "MHS", 1, 400, "Mixed Housing Suburban");

    expect(note.standard_path_viable).toBe(false);
    expect(note.headline).toContain("Subject land area unavailable");
    expect(note.headline).toContain("800m²");
    expect(note.detail).toContain("does not compare this specific property");
    expect(note.detail).not.toMatch(/(^|[^0-9])0m²/);
  });
});
