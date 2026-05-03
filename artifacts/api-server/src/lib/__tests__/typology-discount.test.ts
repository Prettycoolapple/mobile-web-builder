import { describe, expect, it } from "vitest";
import { exitGdvTypologyDiscountFactor } from "../roi-calculator";

describe("exitGdvTypologyDiscountFactor", () => {
  it("returns 1 for single-lot exit", () => {
    expect(exitGdvTypologyDiscountFactor("THAB", 1, 400)).toBe(1);
  });

  it("applies strong THAB discount for many small lots (terrace product)", () => {
    const f = exitGdvTypologyDiscountFactor("THAB", 7, 62);
    expect(f).toBeLessThan(0.75);
    expect(f).toBeGreaterThanOrEqual(0.5);
  });

  it("applies extra nudge when sqm per lot under 90", () => {
    const withSmall = exitGdvTypologyDiscountFactor("THAB", 4, 70);
    const withLarger = exitGdvTypologyDiscountFactor("THAB", 4, 120);
    expect(withSmall).toBeLessThan(withLarger);
  });

  it("is milder for MHS", () => {
    expect(exitGdvTypologyDiscountFactor("MHS", 7, 62)).toBeGreaterThan(
      exitGdvTypologyDiscountFactor("THAB", 7, 62),
    );
  });
});
