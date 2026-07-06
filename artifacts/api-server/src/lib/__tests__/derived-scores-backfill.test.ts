import { describe, expect, it } from "vitest";
import { shouldBackfillDerivedScores } from "../derived-scores-backfill";
import type { RawPropertyData } from "../pipeline";

type DerivedScores = NonNullable<RawPropertyData["derived_scores"]>;

function derived(overrides: Partial<DerivedScores> = {}): DerivedScores {
  return {
    scoringVersion: 3,
    scores: {
      ease: 3,
      cost: 3,
      roi: 3,
      composite: 3,
      ease_reasons: [],
      cost_reasons: [],
      roi_reasons: [],
    },
    scoreUnavailableReason: null,
    roiPercentBest: 12.5,
    landArea: 650,
    zone: "MHS",
    potentialLots: 2,
    minLotSize: 400,
    standardVacantLots: 2,
    standardPathViable: true,
    standardMinLotSize: 400,
    designLedEligible: false,
    designLedYieldRange: null,
    designLedConfidence: "low",
    designLedReasons: [],
    designLedBlockers: [],
    designLedSummary: null,
    designLedDetail: null,
    builtEnvironmentContext: null,
    ...overrides,
  };
}

function dwellingCondition(overrides: Partial<NonNullable<DerivedScores["dwellingCondition"]>> = {}): NonNullable<DerivedScores["dwellingCondition"]> {
  return {
    assessmentVersion: 1,
    sourceFingerprint: "fingerprint-a",
    assessedAt: "2026-01-01T00:00:00.000Z",
    condition: "renovated",
    recentImprovement: true,
    additionOrExtension: false,
    confidence: "high",
    source: "listing_text",
    evidence: ["fully renovated throughout"],
    costPenalty: 1,
    ...overrides,
  };
}

describe("shouldBackfillDerivedScores", () => {
  it("backfills missing and stale-version derived score payloads", () => {
    expect(shouldBackfillDerivedScores(null, derived())).toBe(true);
    expect(shouldBackfillDerivedScores(derived({ scoringVersion: 2 }), derived())).toBe(true);
  });

  it("repairs a same-version scoreless cached row when recomputation now has scores", () => {
    const current = derived({
      scores: null,
      scoreUnavailableReason: "unit_or_apartment_typology",
      roiPercentBest: null,
    });

    expect(shouldBackfillDerivedScores(current, derived())).toBe(true);
  });

  it("does not rewrite identical current derived scores", () => {
    const current = derived();

    expect(shouldBackfillDerivedScores(current, { ...current })).toBe(false);
  });

  it("backfills same-version rows when dwelling condition is added or changes", () => {
    const current = derived({ dwellingCondition: null });

    expect(shouldBackfillDerivedScores(current, derived({ dwellingCondition: dwellingCondition() }))).toBe(true);
    expect(
      shouldBackfillDerivedScores(
        derived({ dwellingCondition: dwellingCondition() }),
        derived({ dwellingCondition: dwellingCondition({ sourceFingerprint: "fingerprint-b", costPenalty: 0.5 }) }),
      ),
    ).toBe(true);
  });
});
