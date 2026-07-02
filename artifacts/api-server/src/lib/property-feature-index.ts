import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  db,
  propertyFeatureIndex,
  withDbRetry,
  type InsertPropertyFeatureIndex,
  type PropertyFeatureIndexRow,
} from "@workspace/db";
import type { RawPropertyData } from "./pipeline";
import { deriveFeatureRow, type FeatureRowIdentity } from "./property-feature-row";
import { logger } from "./logger";

/**
 * Structured feature index over property_cache — the retrieval layer behind
 * "reverse engineering" criteria search. deriveFeatureRow() (property-feature-row.ts)
 * flattens a cached raw_data bundle into indexable columns; upsertFeatureRow()
 * persists it (best-effort, mirroring upsertCachedRaw); searchFeatureIndex()
 * turns a filter spec into a SQL query. property_cache remains the source of
 * truth — this is a search accelerator, re-derived whenever the cache is written.
 */

// Re-export the pure extraction so callers have a single entry point.
export { deriveFeatureRow };
export type { FeatureRowIdentity };

/**
 * Insert or refresh an index row keyed by addressKey. Best-effort — callers
 * `void` this and never block the user path on it (mirrors upsertCachedRaw).
 */
export async function upsertFeatureRow(row: InsertPropertyFeatureIndex): Promise<void> {
  if (!row.addressKey) return;
  try {
    await withDbRetry(() =>
      db
        .insert(propertyFeatureIndex)
        .values(row)
        .onConflictDoUpdate({
          target: propertyFeatureIndex.addressKey,
          set: { ...row, indexedAt: new Date() },
        }),
    );
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, addressKey: row.addressKey },
      "property-feature-index upsertFeatureRow failed",
    );
  }
}

/** Minimal structural view of a PipelineResult — avoids importing the heavy type. */
type PipelineLike = {
  raw_property?: RawPropertyData | null;
  linz_parcel?: { parcel_id?: string | null } | null;
  suburb?: string | null;
  geocode?: { lat?: number | null; lng?: number | null; formatted?: string | null } | null;
};

/**
 * Fire-and-forget index refresh from a completed pipeline result, at the same
 * sites the property cache is written. Pass the cache row's lastRefreshedAt when
 * refreshing an existing row so the index never revives stale freshness.
 */
export function upsertFeatureRowFromPipeline(
  pipelineResult: PipelineLike,
  args: { addressKey: string; lastRefreshedAt?: Date | null; pipelineVersion?: number | null },
): void {
  const raw = pipelineResult.raw_property;
  if (!raw || !args.addressKey) return;
  void upsertFeatureRow(
    deriveFeatureRow(raw, {
      addressKey: args.addressKey,
      canonicalParcelId: pipelineResult.linz_parcel?.parcel_id ?? null,
      suburb: pipelineResult.suburb ?? null,
      formattedAddress: pipelineResult.geocode?.formatted ?? null,
      lat: pipelineResult.geocode?.lat ?? null,
      lng: pipelineResult.geocode?.lng ?? null,
      pipelineVersion: args.pipelineVersion ?? null,
      lastRefreshedAt: args.lastRefreshedAt ?? new Date(),
    }),
  );
}

/** Structured criteria to match against the index. All fields optional. */
export interface FeatureSearchFilter {
  /** Lowercased suburb names; at least one must match (case-insensitive). */
  suburbs?: string[];
  minPotentialLots?: number | null;
  maxSlopeDegrees?: number | null;
  servicesOnParcel?: ("storm" | "sewer" | "water")[];
  minRoiPct?: number | null;
  /** Require a recognised AUP zone — set for any lot/ROI constrained query. */
  requireAupCovered?: boolean;
  /** Exclude rows scored under an older formula for score/lot/ROI queries. */
  minScoringVersion?: number | null;
}

/**
 * Turn a filter spec into a ranked query over the index. Mirrors listByScore()
 * in property-cache.ts: score/lot/ROI constraints are gated on scoringVersion so
 * stale-formula rows never surface; ordered by composite score, freshest first.
 */
export async function searchFeatureIndex(
  filter: FeatureSearchFilter,
  opts: { limit: number; offset: number },
): Promise<PropertyFeatureIndexRow[]> {
  const conds: SQL[] = [];

  if (filter.suburbs && filter.suburbs.length > 0) {
    const lowered = filter.suburbs.map((s) => s.toLowerCase());
    conds.push(sql`lower(${propertyFeatureIndex.suburb}) = ANY(${lowered}::text[])`);
  }
  if (typeof filter.minPotentialLots === "number") {
    conds.push(gte(propertyFeatureIndex.potentialLots, filter.minPotentialLots));
  }
  if (typeof filter.maxSlopeDegrees === "number") {
    conds.push(lte(propertyFeatureIndex.slopeDegrees, filter.maxSlopeDegrees));
  }
  for (const svc of filter.servicesOnParcel ?? []) {
    if (svc === "storm") conds.push(eq(propertyFeatureIndex.stormOnParcel, true));
    if (svc === "sewer") conds.push(eq(propertyFeatureIndex.sewerOnParcel, true));
    if (svc === "water") conds.push(eq(propertyFeatureIndex.waterOnParcel, true));
  }
  if (typeof filter.minRoiPct === "number") {
    conds.push(gte(propertyFeatureIndex.roiPercentBest, filter.minRoiPct));
  }
  if (filter.requireAupCovered) {
    conds.push(eq(propertyFeatureIndex.aupCovered, true));
  }

  // Any query constraining a derived number must exclude stale-formula rows.
  const constrainsDerived =
    typeof filter.minPotentialLots === "number" || typeof filter.minRoiPct === "number";
  if (constrainsDerived && typeof filter.minScoringVersion === "number") {
    conds.push(gte(propertyFeatureIndex.scoringVersion, filter.minScoringVersion));
  }

  return withDbRetry(() =>
    db
      .select()
      .from(propertyFeatureIndex)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(
        sql`${propertyFeatureIndex.scoreComposite} DESC NULLS LAST`,
        desc(propertyFeatureIndex.lastRefreshedAt),
      )
      .limit(opts.limit)
      .offset(opts.offset),
  );
}
