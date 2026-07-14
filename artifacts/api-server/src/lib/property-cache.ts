import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { db, propertyCache, withDbRetry, type PropertyCacheRow } from "@workspace/db";
import type { RawPropertyData } from "./pipeline";
import { logger } from "./logger";
import {
  cachedPlanningProviderId,
  cachedRawNeedsRegionalPropertyHistoryRefresh,
  cachedRawNeedsRegionalZoneRefresh,
} from "./property-cache-rules";

/**
 * Global property-cache data layer. Mirrors the conventions in
 * lib/discovery-shown-memory.ts (db + withDbRetry + onConflictDoUpdate).
 *
 * The cache stores the RAW externally-acquired data behind an analysis so any
 * user's first analysis of an address populates a row that every later analysis
 * reuses, skipping the slow/costly scrapers + LINZ + GIS calls. Derived numbers
 * are never stored; they recompute on serve.
 */

export { PIPELINE_VERSION, PROPERTY_CACHE_TTL_DAYS, cacheRowFreshness } from "./property-cache-freshness";
import { PIPELINE_VERSION, PROPERTY_CACHE_TTL_DAYS, cacheRowFreshness } from "./property-cache-freshness";

export interface CachedRaw {
  rawData: RawPropertyData;
  row: PropertyCacheRow;
  /** Whole days since the row was last refreshed. */
  ageDays: number;
}

function freshCachedRawOrNull(row: PropertyCacheRow | undefined, context: Record<string, unknown>): CachedRaw | null {
  if (!row) return null;
  const { fresh, ageDays } = cacheRowFreshness(row);
  if (!fresh) {
    if (row.pipelineVersion >= PIPELINE_VERSION) {
      logger.info({ ...context, ageDays, ttlDays: PROPERTY_CACHE_TTL_DAYS }, "property-cache: row exceeded TTL — treating as miss");
    }
    return null;
  }
  const rawData = row.rawData as RawPropertyData;
  if (cachedRawNeedsRegionalZoneRefresh(rawData)) {
    logger.info({ ...context, providerId: cachedPlanningProviderId(rawData) }, "property-cache: regional zone unresolved - treating as miss");
    return null;
  }
  if (cachedRawNeedsRegionalPropertyHistoryRefresh(rawData)) {
    logger.info({ ...context, providerId: cachedPlanningProviderId(rawData) }, "property-cache: regional property history incomplete - treating as miss");
    return null;
  }
  return { rawData, row, ageDays };
}

/**
 * Look up a globally-cached raw bundle by normalised address key. Returns null
 * on a miss, when the stored row predates the current PIPELINE_VERSION, or when
 * the row is older than the TTL (each forcing a fresh re-acquisition that will
 * upsert a new row).
 */
export async function getCachedRaw(addressKey: string): Promise<CachedRaw | null> {
  if (!addressKey) return null;
  try {
    const rows = await withDbRetry(() =>
      db.select().from(propertyCache).where(eq(propertyCache.addressKey, addressKey)).limit(1),
    );
    return freshCachedRawOrNull(rows[0], { addressKey });
  } catch (err) {
    logger.warn({ err: (err as Error).message, addressKey }, "property-cache getCachedRaw failed");
    return null;
  }
}

/**
 * Secondary lookup by LINZ parcel id — collapses genuinely different address
 * spellings that resolve to the same parcel. Returns the freshest matching row.
 */
export async function getCachedRawByParcel(parcelId: string | null | undefined): Promise<CachedRaw | null> {
  if (!parcelId) return null;
  try {
    const rows = await withDbRetry(() =>
      db
        .select()
        .from(propertyCache)
        .where(eq(propertyCache.canonicalParcelId, parcelId))
        .orderBy(asc(propertyCache.lastRefreshedAt))
        .limit(1),
    );
    return freshCachedRawOrNull(rows[0], { parcelId });
  } catch (err) {
    logger.warn({ err: (err as Error).message, parcelId }, "property-cache getCachedRawByParcel failed");
    return null;
  }
}

export interface UpsertCachedRawArgs {
  addressKey: string;
  rawData: RawPropertyData;
  canonicalParcelId?: string | null;
  canonicalTitleId?: string | null;
  formattedAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  suburb?: string | null;
  sourceUserId?: string | null;
}

/**
 * Insert (first analysis) or refresh (rescan / re-analysis) a cache row, keyed by
 * addressKey. Each acquisition bumps refreshCount + lastRefreshedAt. Canonical
 * ids and geocode fields are coalesced so a later resolve back-fills nulls
 * without clobbering existing values; sourceUserId keeps its ORIGINAL value.
 * Best-effort — callers should `void` this and never block the user path on it.
 */
export async function upsertCachedRaw(args: UpsertCachedRawArgs): Promise<void> {
  if (!args.addressKey) return;
  try {
    await withDbRetry(() =>
      db
        .insert(propertyCache)
        .values({
          addressKey: args.addressKey,
          rawData: args.rawData as unknown as Record<string, unknown>,
          canonicalParcelId: args.canonicalParcelId ?? null,
          canonicalTitleId: args.canonicalTitleId ?? null,
          formattedAddress: args.formattedAddress ?? null,
          lat: args.lat ?? null,
          lng: args.lng ?? null,
          suburb: args.suburb ?? null,
          pipelineVersion: PIPELINE_VERSION,
          refreshCount: 1,
          sourceUserId: args.sourceUserId ?? null,
        })
        .onConflictDoUpdate({
          target: propertyCache.addressKey,
          set: {
            rawData: args.rawData as unknown as Record<string, unknown>,
            pipelineVersion: PIPELINE_VERSION,
            lastRefreshedAt: new Date(),
            refreshCount: sql`${propertyCache.refreshCount} + 1`,
            canonicalParcelId: sql`coalesce(excluded.canonical_parcel_id, ${propertyCache.canonicalParcelId})`,
            canonicalTitleId: sql`coalesce(excluded.canonical_title_id, ${propertyCache.canonicalTitleId})`,
            formattedAddress: sql`coalesce(excluded.formatted_address, ${propertyCache.formattedAddress})`,
            lat: sql`coalesce(excluded.lat, ${propertyCache.lat})`,
            lng: sql`coalesce(excluded.lng, ${propertyCache.lng})`,
            suburb: sql`coalesce(excluded.suburb, ${propertyCache.suburb})`,
            sourceUserId: sql`coalesce(${propertyCache.sourceUserId}, excluded.source_user_id)`,
          },
        }),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, addressKey: args.addressKey }, "property-cache upsertCachedRaw failed");
  }
}

/**
 * Backfill ONLY the `derived_scores` key of a cached row's rawData (so screening
 * cards can show the exact report score), without touching `lastRefreshedAt` /
 * `pipelineVersion` / `refreshCount`. Crucially this does NOT reset the freshness
 * clock — a cache-serve read must never revive stale data. Best-effort.
 */
export async function backfillDerivedScores(addressKey: string, derivedScores: unknown): Promise<void> {
  if (!addressKey || derivedScores == null) return;
  const incomingScoringVersion =
    typeof (derivedScores as { scoringVersion?: unknown }).scoringVersion === "number"
      ? (derivedScores as { scoringVersion: number }).scoringVersion
      : null;
  const versionGuard =
    incomingScoringVersion == null
      ? undefined
      : sql`coalesce((${propertyCache.rawData} #>> '{derived_scores,scoringVersion}')::int, -1) <= ${incomingScoringVersion}`;
  const whereClause = versionGuard
    ? and(eq(propertyCache.addressKey, addressKey), versionGuard)
    : eq(propertyCache.addressKey, addressKey);
  try {
    await withDbRetry(() =>
      db
        .update(propertyCache)
        .set({
          rawData: sql`jsonb_set(${propertyCache.rawData}, '{derived_scores}', ${JSON.stringify(derivedScores)}::jsonb, true)`,
        })
        .where(whereClause),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, addressKey }, "property-cache backfillDerivedScores failed");
  }
}

/** Best-effort increment of the served-from-cache counter (any user). */
export async function bumpHitCount(addressKey: string): Promise<void> {
  if (!addressKey) return;
  try {
    await withDbRetry(() =>
      db
        .update(propertyCache)
        .set({ hitCount: sql`${propertyCache.hitCount} + 1` })
        .where(eq(propertyCache.addressKey, addressKey)),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, addressKey }, "property-cache bumpHitCount failed");
  }
}

/**
 * Fetch a batch of rows for the admin rescan, oldest-`lastRefreshedAt` first so
 * the most stale data is refreshed first. Pass `beforeRefreshedAt` to only
 * include rows last refreshed before a cutoff (the olderThanDays filter).
 */
export async function listForRescan(
  limit: number,
  beforeRefreshedAt?: Date | null,
): Promise<PropertyCacheRow[]> {
  const where = beforeRefreshedAt
    ? and(lt(propertyCache.lastRefreshedAt, beforeRefreshedAt))
    : undefined;
  return withDbRetry(() =>
    db
      .select()
      .from(propertyCache)
      .where(where)
      .orderBy(asc(propertyCache.lastRefreshedAt))
      .limit(limit),
  );
}

/**
 * List cached rows ranked by their persisted feasibility composite score, highest
 * first — the data source for the public Explore page. Only rows that already
 * carry derived scores at (or above) the current scoring version are included, so
 * the list never surfaces stale numbers a later report would contradict. Tiebreaks
 * on freshest-first. Volatile listing/photo fields are not stored, so callers get
 * address + derived headline figures only.
 */
export async function listByScore(
  limit: number,
  offset: number,
  minScoringVersion: number,
): Promise<PropertyCacheRow[]> {
  const compositeExpr = sql`(${propertyCache.rawData} #>> '{derived_scores,scores,composite}')`;
  return withDbRetry(() =>
    db
      .select()
      .from(propertyCache)
      .where(
        and(
          sql`${compositeExpr} IS NOT NULL`,
          sql`(${propertyCache.rawData} #>> '{derived_scores,scoringVersion}')::int >= ${minScoringVersion}`,
        ),
      )
      .orderBy(desc(sql`${compositeExpr}::numeric`), desc(propertyCache.lastRefreshedAt))
      .limit(limit)
      .offset(offset),
  );
}

/** Total number of cached rows (optionally only those older than a cutoff). */
export async function countCached(beforeRefreshedAt?: Date | null): Promise<number> {
  const where = beforeRefreshedAt ? lt(propertyCache.lastRefreshedAt, beforeRefreshedAt) : undefined;
  const rows = await withDbRetry(() =>
    db.select({ n: sql<number>`count(*)::int` }).from(propertyCache).where(where),
  );
  return rows[0]?.n ?? 0;
}
