import { logger } from "./logger";
import { computeLightScore, type LightScoreInput } from "./light-score";
import type { DesignLedConfidence, DesignLedYieldRange } from "./lot-calculator";

export interface CardScoreEntry {
  status: "pending" | "ready" | "failed";
  scores?: {
    ease: number;
    cost: number;
    roi: number;
    composite: number;
    ease_reasons?: string[];
    cost_reasons?: string[];
    roi_reasons?: string[];
  };
  landArea?: number;
  zone?: string | null;
  potentialLots?: number;
  minLotSize?: number | null;
  standardVacantLots?: number;
  standardPathViable?: boolean;
  standardMinLotSize?: number | null;
  designLedEligible?: boolean;
  designLedYieldRange?: DesignLedYieldRange | null;
  designLedConfidence?: DesignLedConfidence;
  designLedReasons?: string[];
  designLedBlockers?: string[];
  designLedSummary?: string | null;
  designLedDetail?: string | null;
  listingUrl?: string;
  updatedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CardScoreEntry>();

function cleanKeyPart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalise(address: string, listingUrl?: string | null): string {
  return `${cleanKeyPart(address)}::${cleanKeyPart(listingUrl ?? "")}`;
}

function getCachedScore(address: string, listingUrl?: string | null): CardScoreEntry | undefined {
  const exact = cache.get(normalise(address, listingUrl));
  if (exact || listingUrl) return exact;
  const addressPrefix = `${cleanKeyPart(address)}::`;
  for (const [key, value] of cache.entries()) {
    if (key.startsWith(addressPrefix)) return value;
  }
  return undefined;
}

function evictStale(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.updatedAt > CACHE_TTL_MS) cache.delete(key);
  }
}

export function queueBackgroundScores(candidates: LightScoreInput[]): void {
  evictStale();
  for (const c of candidates) {
    const key = normalise(c.address, c.listingUrl);
    const existing = cache.get(key);
    if (existing && existing.status !== "failed") continue;

    cache.set(key, { status: "pending", updatedAt: Date.now() });

    computeLightScore(c)
      .then((result) => {
        cache.set(key, {
          status: "ready",
          scores: {
            ease: result.scores.ease,
            cost: result.scores.cost,
            roi: result.scores.roi,
            composite: result.scores.composite,
            ease_reasons: result.scores.ease_reasons,
            cost_reasons: result.scores.cost_reasons,
            roi_reasons: result.scores.roi_reasons,
          },
          landArea: result.landArea,
          zone: result.zone,
          potentialLots: result.potentialLots,
          minLotSize: result.minLotSize,
          standardVacantLots: result.standardVacantLots,
          standardPathViable: result.standardPathViable,
          standardMinLotSize: result.standardMinLotSize,
          designLedEligible: result.designLedEligible,
          designLedYieldRange: result.designLedYieldRange,
          designLedConfidence: result.designLedConfidence,
          designLedReasons: result.designLedReasons,
          designLedBlockers: result.designLedBlockers,
          designLedSummary: result.designLedSummary,
          designLedDetail: result.designLedDetail,
          listingUrl: c.listingUrl,
          updatedAt: Date.now(),
        });
        logger.info(
          { address: c.address, scores: { ease: result.scores.ease, cost: result.scores.cost, roi: result.scores.roi }, landArea: result.landArea, zone: result.zone, potentialLots: result.potentialLots, minLotSize: result.minLotSize },
          "Light score computed for card",
        );
      })
      .catch((err) => {
        logger.warn({ err, address: c.address }, "Light score failed for card");
        cache.set(key, { status: "failed", updatedAt: Date.now() });
      });
  }
}

export function getCardScores(
  entries: Array<string | { address: string; listingUrl?: string | null }>,
): Array<{ address: string; listingUrl?: string | null; status: string; scores?: CardScoreEntry["scores"]; landArea?: number; zone?: string | null; potentialLots?: number; minLotSize?: number | null; standardVacantLots?: number; standardPathViable?: boolean; standardMinLotSize?: number | null; designLedEligible?: boolean; designLedYieldRange?: DesignLedYieldRange | null; designLedConfidence?: DesignLedConfidence; designLedReasons?: string[]; designLedBlockers?: string[]; designLedSummary?: string | null; designLedDetail?: string | null }> {
  evictStale();
  return entries.map((requested) => {
    const addr = typeof requested === "string" ? requested : requested.address;
    const listingUrl = typeof requested === "string" ? null : requested.listingUrl ?? null;
    const cached = getCachedScore(addr, listingUrl);
    if (!cached) return { address: addr, listingUrl, status: "pending" };
    return {
      address: addr,
      listingUrl,
      status: cached.status,
      scores: cached.scores,
      landArea: cached.landArea,
      zone: cached.zone,
      potentialLots: cached.potentialLots,
      minLotSize: cached.minLotSize,
      standardVacantLots: cached.standardVacantLots,
      standardPathViable: cached.standardPathViable,
      standardMinLotSize: cached.standardMinLotSize,
      designLedEligible: cached.designLedEligible,
      designLedYieldRange: cached.designLedYieldRange,
      designLedConfidence: cached.designLedConfidence,
      designLedReasons: cached.designLedReasons,
      designLedBlockers: cached.designLedBlockers,
      designLedSummary: cached.designLedSummary,
      designLedDetail: cached.designLedDetail,
    };
  });
}

export function clearCardScoreCacheForTests(): void {
  cache.clear();
}
