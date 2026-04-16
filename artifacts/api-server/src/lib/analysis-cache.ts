import { logger } from "./logger";
import { computeLightScore, type LightScoreInput } from "./light-score";

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
  updatedAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, CardScoreEntry>();

function normalise(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
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
    const key = normalise(c.address);
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
          updatedAt: Date.now(),
        });
        logger.info(
          { address: c.address, scores: { ease: result.scores.ease, cost: result.scores.cost, roi: result.scores.roi }, landArea: result.landArea, zone: result.zone },
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
  addresses: string[],
): Array<{ address: string; status: string; scores?: CardScoreEntry["scores"]; landArea?: number; zone?: string | null }> {
  evictStale();
  return addresses.map((addr) => {
    const key = normalise(addr);
    const entry = cache.get(key);
    if (!entry) return { address: addr, status: "pending" };
    return {
      address: addr,
      status: entry.status,
      scores: entry.scores,
      landArea: entry.landArea,
      zone: entry.zone,
    };
  });
}
