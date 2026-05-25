import { describe, expect, it } from "vitest";
import { shouldContinueDiscoveryDrain } from "../../lib/discovery-intent";

describe("discovery drain control", () => {
  it("continues strict subdivision scans past the legacy batch cap until three cards or exhaustion", () => {
    expect(shouldContinueDiscoveryDrain({
      currentCount: 0,
      remainingCount: 8,
      attempts: 6,
      strictStandardSubdivision: true,
      nonStrictAttemptLimit: 6,
    })).toBe(true);

    expect(shouldContinueDiscoveryDrain({
      currentCount: 2,
      remainingCount: 8,
      attempts: 12,
      strictStandardSubdivision: true,
      nonStrictAttemptLimit: 6,
    })).toBe(true);

    expect(shouldContinueDiscoveryDrain({
      currentCount: 3,
      remainingCount: 8,
      attempts: 12,
      strictStandardSubdivision: true,
      nonStrictAttemptLimit: 6,
    })).toBe(false);

    expect(shouldContinueDiscoveryDrain({
      currentCount: 0,
      remainingCount: 0,
      attempts: 12,
      strictStandardSubdivision: true,
      nonStrictAttemptLimit: 6,
    })).toBe(false);
  });

  it("keeps the bounded scan behaviour for non-strict discovery searches", () => {
    expect(shouldContinueDiscoveryDrain({
      currentCount: 0,
      remainingCount: 8,
      attempts: 5,
      strictStandardSubdivision: false,
      nonStrictAttemptLimit: 6,
    })).toBe(true);

    expect(shouldContinueDiscoveryDrain({
      currentCount: 0,
      remainingCount: 8,
      attempts: 6,
      strictStandardSubdivision: false,
      nonStrictAttemptLimit: 6,
    })).toBe(false);
  });
});
