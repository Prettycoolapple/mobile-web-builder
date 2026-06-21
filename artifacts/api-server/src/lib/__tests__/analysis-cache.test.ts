import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCardScoreCacheForTests, getCardScores, queueBackgroundScores } from "../analysis-cache";
import { computeLightScore } from "../light-score";
import { getCachedRaw } from "../property-cache";
import { SCORING_VERSION } from "../card-score";

vi.mock("../light-score", () => ({
  computeLightScore: vi.fn(),
}));

// The card path now consults the global property cache first; mock it so unit
// tests stay deterministic and DB-free. Default: a cache miss (returns null).
vi.mock("../property-cache", () => ({
  getCachedRaw: vi.fn().mockResolvedValue(null),
}));

const mockedComputeLightScore = vi.mocked(computeLightScore);
const mockedGetCachedRaw = vi.mocked(getCachedRaw);

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function lightScoreResult(overrides: {
  scores: { ease: number; cost: number; roi: number; composite: number; ease_reasons: string[]; cost_reasons: string[]; roi_reasons: string[] };
  landArea: number;
  zone: string;
  potentialLots: number;
  minLotSize: number;
}) {
  return {
    ...overrides,
    standardVacantLots: overrides.potentialLots,
    standardPathViable: overrides.potentialLots >= 2,
    standardMinLotSize: overrides.minLotSize,
    designLedEligible: false,
    designLedYieldRange: null,
    designLedConfidence: "none" as const,
    designLedReasons: [],
    designLedBlockers: [],
    designLedSummary: null,
    designLedDetail: null,
  };
}

describe("card score cache", () => {
  beforeEach(() => {
    clearCardScoreCacheForTests();
    mockedComputeLightScore.mockReset();
    mockedGetCachedRaw.mockReset();
    mockedGetCachedRaw.mockResolvedValue(null);
  });

  it("keeps separate cache entries for the same address with different listing URLs", async () => {
    mockedComputeLightScore
      .mockResolvedValueOnce(lightScoreResult({
        scores: { ease: 2, cost: 2, roi: 2, composite: 2, ease_reasons: [], cost_reasons: [], roi_reasons: [] },
        landArea: 290,
        zone: "MHU",
        potentialLots: 1,
        minLotSize: 300,
      }))
      .mockResolvedValueOnce(lightScoreResult({
        scores: { ease: 4, cost: 4, roi: 4, composite: 4, ease_reasons: [], cost_reasons: [], roi_reasons: [] },
        landArea: 900,
        zone: "MHU",
        potentialLots: 6,
        minLotSize: 300,
      }));

    queueBackgroundScores([
      { address: "352F Kohimarama Road, St Heliers", listingUrl: "https://example.test/a", price: 1_270_000, landArea: 290 },
      { address: "352F Kohimarama Road, St Heliers", listingUrl: "https://example.test/b", price: 1_270_000, landArea: 900 },
    ]);
    await flushPromises();

    const scores = getCardScores([
      { address: "352F Kohimarama Road, St Heliers", listingUrl: "https://example.test/a" },
      { address: "352F Kohimarama Road, St Heliers", listingUrl: "https://example.test/b" },
    ]);

    expect(scores[0].landArea).toBe(290);
    expect(scores[1].landArea).toBe(900);
  });

  it("falls back to an address-only lookup for older clients without listing URLs", async () => {
    mockedComputeLightScore.mockResolvedValueOnce(lightScoreResult({
      scores: { ease: 2, cost: 2, roi: 2, composite: 2, ease_reasons: [], cost_reasons: [], roi_reasons: [] },
      landArea: 290,
      zone: "MHU",
      potentialLots: 1,
      minLotSize: 300,
    }));

    queueBackgroundScores([
      { address: "352F Kohimarama Road, St Heliers", listingUrl: "https://example.test/a", price: 1_270_000, landArea: 290 },
    ]);
    await flushPromises();

    const scores = getCardScores(["352F Kohimarama Road, St Heliers"]);

    expect(scores[0].status).toBe("ready");
    expect(scores[0].landArea).toBe(290);
  });

  it("uses the REAL persisted report scores when the property is cached (exact match, no estimate)", async () => {
    // Simulate a property analysed earlier (by any user): the global cache holds
    // the report-grade scores. The card must show those, not the estimate.
    mockedGetCachedRaw.mockResolvedValue({
      ageDays: 3,
      row: {} as never,
      rawData: {
        derived_scores: {
          scoringVersion: SCORING_VERSION,
          scores: { ease: 4.5, cost: 4, roi: 5, composite: 4.6, ease_reasons: [], cost_reasons: [], roi_reasons: [] },
          landArea: 820,
          zone: "MHU",
          potentialLots: 5,
          minLotSize: 300,
          standardVacantLots: 5,
          standardPathViable: true,
          standardMinLotSize: 300,
          designLedEligible: false,
          designLedYieldRange: null,
          designLedConfidence: "none",
          designLedReasons: [],
          designLedBlockers: [],
          designLedSummary: null,
          designLedDetail: null,
          builtEnvironmentContext: {
            radiusM: 100,
            assessedProperties: 8,
            knownBuildYearCount: 8,
            modernCount: 4,
            post2000Count: 6,
            oldCount: 1,
            unknownCount: 0,
            modernShare: 0.5,
            post2000Share: 0.75,
            medianBuildYear: 2016,
            subjectBuildYear: 1955,
            subjectBuildYearRange: null,
            signal: "last_missing_piece",
            confidence: "high",
            reasons: ["Older dwelling among newer nearby homes suggests rebuild value may be unlocked."],
            nearbyExamples: [],
          },
        },
      },
    } as never);

    queueBackgroundScores([
      { address: "10 Premium Street, Mission Bay", listingUrl: "https://example.test/x", price: 3_295_000, landArea: 820 },
    ]);
    await flushPromises();

    const scores = getCardScores([{ address: "10 Premium Street, Mission Bay", listingUrl: "https://example.test/x" }]);
    expect(scores[0].status).toBe("ready");
    expect(scores[0].scores).toMatchObject({ ease: 4.5, cost: 4, roi: 5, composite: 4.6 });
    expect(scores[0].potentialLots).toBe(5);
    expect(scores[0].builtEnvironmentContext?.signal).toBe("last_missing_piece");
    expect(mockedComputeLightScore).not.toHaveBeenCalled();
  });

  it("honours cached score-unavailable reports without falling back to an estimate", async () => {
    mockedGetCachedRaw.mockResolvedValue({
      ageDays: 1,
      row: {} as never,
      rawData: {
        derived_scores: {
          scoringVersion: SCORING_VERSION,
          scores: null,
          scoreUnavailableReason: "unit_or_apartment_typology",
          landArea: null,
          zone: "THAB",
          potentialLots: 1,
          minLotSize: null,
          standardVacantLots: 1,
          standardPathViable: false,
          standardMinLotSize: null,
          designLedEligible: false,
          designLedYieldRange: null,
          designLedConfidence: "none",
          designLedReasons: [],
          designLedBlockers: ["Unit/apartment typology is not a subdivision candidate."],
          designLedSummary: null,
          designLedDetail: null,
        },
      },
    } as never);

    queueBackgroundScores([
      { address: "3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland", listingUrl: "https://example.test/unit", price: 1_000_000 },
    ]);
    await flushPromises();

    const scores = getCardScores([{ address: "3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland", listingUrl: "https://example.test/unit" }]);
    expect(scores[0].status).toBe("ready");
    expect(scores[0].scores).toBeUndefined();
    expect(mockedComputeLightScore).not.toHaveBeenCalled();
  });

  it("does not estimate card scores for unit slash addresses", async () => {
    queueBackgroundScores([
      { address: "3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland", listingUrl: "https://example.test/unit", price: 1_000_000 },
    ]);
    await flushPromises();

    const scores = getCardScores([{ address: "3F/31 Scanlan Street, Grey Lynn, Auckland City, Auckland", listingUrl: "https://example.test/unit" }]);
    expect(scores[0].status).toBe("ready");
    expect(scores[0].scores).toBeUndefined();
    expect(mockedComputeLightScore).not.toHaveBeenCalled();
  });

  it("ignores persisted scores from a stale SCORING_VERSION and falls back to the estimate", async () => {
    mockedGetCachedRaw.mockResolvedValue({
      ageDays: 3,
      row: {} as never,
      rawData: {
        derived_scores: {
          scoringVersion: SCORING_VERSION - 1,
          scores: { ease: 5, cost: 5, roi: 5, composite: 5, ease_reasons: [], cost_reasons: [], roi_reasons: [] },
          landArea: 820, zone: "MHU", potentialLots: 5, minLotSize: 300,
          standardVacantLots: 5, standardPathViable: true, standardMinLotSize: 300,
          designLedEligible: false, designLedYieldRange: null, designLedConfidence: "none",
          designLedReasons: [], designLedBlockers: [], designLedSummary: null, designLedDetail: null,
        },
      },
    } as never);
    mockedComputeLightScore.mockResolvedValueOnce(lightScoreResult({
      scores: { ease: 3, cost: 3, roi: 3, composite: 3, ease_reasons: [], cost_reasons: [], roi_reasons: [] },
      landArea: 820, zone: "MHU", potentialLots: 4, minLotSize: 300,
    }));

    queueBackgroundScores([
      { address: "11 Stale Street, Mission Bay", listingUrl: "https://example.test/y", price: 3_000_000, landArea: 820 },
    ]);
    await flushPromises();

    const scores = getCardScores([{ address: "11 Stale Street, Mission Bay", listingUrl: "https://example.test/y" }]);
    expect(scores[0].scores).toMatchObject({ composite: 3 });
    expect(mockedComputeLightScore).toHaveBeenCalledTimes(1);
  });
});
