import { and, asc, eq, lt, sql } from "drizzle-orm";
import { db, propertyCache, withDbRetry, type PropertyCacheRow } from "@workspace/db";
import { RAW_PROPERTY_SCHEMA_VERSION, type RawPropertyData } from "./pipeline";
import { logger } from "./logger";

/**
 * Global property-cache data layer. Mirrors the conventions in
 * lib/discovery-shown-memory.ts (db + withDbRetry + onConflictDoUpdate).
 *
 * The cache stores the RAW externally-acquired data behind an analysis so any
 * user's first analysis of an address populates a row that every later analysis
 * reuses, skipping the slow/costly scrapers + LINZ + GIS calls. Derived numbers
 * are never stored; they recompute on serve.
 */

/**
 * Bump when the SHAPE of the cached RawPropertyData bundle changes (a new field
 * the derived layer now needs, or different scraper parsing). A stored row with
 * a lower version is treated as a cache MISS and re-acquired. Derived-only
 * changes (cost/ROI model tuning) need NO bump — those recompute by design.
 *
 * Kept in lock-step with RAW_PROPERTY_SCHEMA_VERSION so there is one source of
 * truth for "what version is the cached data".
 */
export const PIPELINE_VERSION = RAW_PROPERTY_SCHEMA_VERSION;

export interface CachedRaw {
  rawData: RawPropertyData;
  row: PropertyCacheRow;
}

/**
 * Look up a globally-cached raw bundle by normalised address key. Returns null
 * on a miss OR when the stored row predates the current PIPELINE_VERSION (forcing
 * a fresh re-acquisition that will upsert at the new version).
 */
export async function getCachedRaw(addressKey: string): Promise<CachedRaw | null> {
  if (!addressKey) return null;
  try {
    const rows = await withDbRetry(() =>
      db.select().from(propertyCache).where(eq(propertyCache.addressKey, addressKey)).limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    if (row.pipelineVersion < PIPELINE_VERSION) return null;
    return { rawData: row.rawData as RawPropertyData, row };
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
    const row = rows[0];
    if (!row) return null;
    if (row.pipelineVersion < PIPELINE_VERSION) return null;
    return { rawData: row.rawData as RawPropertyData, row };
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

/** Total number of cached rows (optionally only those older than a cutoff). */
export async function countCached(beforeRefreshedAt?: Date | null): Promise<number> {
  const where = beforeRefreshedAt ? lt(propertyCache.lastRefreshedAt, beforeRefreshedAt) : undefined;
  const rows = await withDbRetry(() =>
    db.select({ n: sql<number>`count(*)::int` }).from(propertyCache).where(where),
  );
  return rows[0]?.n ?? 0;
}
