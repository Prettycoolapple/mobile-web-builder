import { logger } from "./logger";
import { computeLightScore, type LightScoreInput, type LightScoreResult } from "./light-score";
import type { DesignLedConfidence, DesignLedYieldRange } from "./lot-calculator";
import { getCachedRaw } from "./property-cache";
import { normaliseDiscoveryAddressKey } from "./address-key";
import { SCORING_VERSION, type DerivedCardScores } from "./card-score";
import type { BuiltEnvironmentContext } from "./built-environment-context";
import { looksLikeUnitOrApartmentAddress } from "./address-patterns";
import { isAucklandBusinessZone } from "./auckland-zone-classification";

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
  builtEnvironmentContext?: BuiltEnvironmentContext | null;
  listingUrl?: string;
  scoreUnavailableReason?: string | null;
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

function derivedToLightResult(ds: DerivedCardScores & { scores: NonNullable<DerivedCardScores["scores"]> }): LightScoreResult {
  return {
    scores: ds.scores,
    landArea: ds.landArea ?? 0,
    zone: ds.zone,
    potentialLots: ds.potentialLots,
    minLotSize: ds.minLotSize,
    standardVacantLots: ds.standardVacantLots,
    standardPathViable: ds.standardPathViable,
    standardMinLotSize: ds.standardMinLotSize,
    designLedEligible: ds.designLedEligible,
    designLedYieldRange: ds.designLedYieldRange,
    designLedConfidence: ds.designLedConfidence,
    designLedReasons: ds.designLedReasons,
    designLedBlockers: ds.designLedBlockers,
    designLedSummary: ds.designLedSummary,
    designLedDetail: ds.designLedDetail,
    builtEnvironmentContext: ds.builtEnvironmentContext ?? null,
  };
}

function cardScoreUnavailableReason(input: LightScoreInput): string | null {
  if (looksLikeUnitOrApartmentAddress(input.address)) return "unit_or_apartment_address";
  if (input.typology === "unit_apartment") return "unit_or_apartment_typology";
  if (
    input.subdivisionEligible === false
    && input.subdivisionRejectReason != null
    && /unit|apartment|crosslease|cross[-\s]*lease/i.test(input.subdivisionRejectReason)
  ) {
    return input.subdivisionRejectReason;
  }
  return null;
}

/**
 * Resolve a card score: prefer the REAL report-grade scores persisted in the
 * global property cache (so the card matches the report exactly, for any user,
 * once anyone has analysed the property — and faster, since it skips the live
 * geocode/LINZ/zone lookups). Fall back to the lightweight estimate on a miss.
 */
async function resolveCardScore(
  c: LightScoreInput,
): Promise<{ result: LightScoreResult | null; source: "report" | "estimate"; unavailableReason?: string | null }> {
  const addressKey = normaliseDiscoveryAddressKey(c.address);
  if (addressKey) {
    try {
      const cached = await getCachedRaw(addressKey);
      const ds = cached?.rawData.derived_scores;
      if (ds && ds.scoringVersion === SCORING_VERSION) {
        if (!ds.scores) {
          return { result: null, source: "report", unavailableReason: ds.scoreUnavailableReason ?? "score_unavailable" };
        }
        return { result: derivedToLightResult(ds as DerivedCardScores & { scores: NonNullable<DerivedCardScores["scores"]> }), source: "report" };
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message, address: c.address }, "card-score: cached real-score lookup failed");
    }
  }
  const unavailableReason = cardScoreUnavailableReason(c);
  if (unavailableReason) return { result: null, source: "estimate", unavailableReason };
  const result = await computeLightScore(c);
  if (isAucklandBusinessZone(result.zone)) {
    return {
      result: null,
      source: "estimate",
      unavailableReason: "non_residential_business_zone",
    };
  }
  return { result, source: "estimate" };
}

export function queueBackgroundScores(candidates: LightScoreInput[]): void {
  evictStale();
  for (const c of candidates) {
    const key = normalise(c.address, c.listingUrl);
    const existing = cache.get(key);
    if (existing && existing.status !== "failed") continue;

    cache.set(key, { status: "pending", updatedAt: Date.now() });

    resolveCardScore(c)
      .then(({ result, source, unavailableReason }) => {
        if (!result) {
          cache.set(key, {
            status: "ready",
            listingUrl: c.listingUrl,
            scoreUnavailableReason: unavailableReason ?? "score_unavailable",
            updatedAt: Date.now(),
          });
          logger.info(
            { address: c.address, source, unavailableReason },
            source === "report" ? "Card score unavailable from cached report" : "Card score estimate suppressed",
          );
          return;
        }
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
          builtEnvironmentContext: result.builtEnvironmentContext ?? null,
          listingUrl: c.listingUrl,
          updatedAt: Date.now(),
        });
        logger.info(
          { address: c.address, source, scores: { ease: result.scores.ease, cost: result.scores.cost, roi: result.scores.roi, composite: result.scores.composite }, landArea: result.landArea, zone: result.zone, potentialLots: result.potentialLots, minLotSize: result.minLotSize },
          source === "report" ? "Card score from cached report (exact match)" : "Light score estimate computed for card",
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
): Array<{ address: string; listingUrl?: string | null; status: string; scores?: CardScoreEntry["scores"]; landArea?: number; zone?: string | null; potentialLots?: number; minLotSize?: number | null; standardVacantLots?: number; standardPathViable?: boolean; standardMinLotSize?: number | null; designLedEligible?: boolean; designLedYieldRange?: DesignLedYieldRange | null; designLedConfidence?: DesignLedConfidence; designLedReasons?: string[]; designLedBlockers?: string[]; designLedSummary?: string | null; designLedDetail?: string | null; builtEnvironmentContext?: BuiltEnvironmentContext | null }> {
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
      builtEnvironmentContext: cached.builtEnvironmentContext ?? null,
    };
  });
}

export function clearCardScoreCacheForTests(): void {
  cache.clear();
}
