import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearCardScoreCacheForTests, getCardScores, queueBackgroundScores } from "../analysis-cache";
import { computeLightScore } from "../light-score";

vi.mock("../light-score", () => ({
  computeLightScore: vi.fn(),
}));

const mockedComputeLightScore = vi.mocked(computeLightScore);

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
});
