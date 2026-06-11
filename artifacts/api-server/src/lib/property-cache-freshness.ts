import type { PropertyCacheRow } from "@workspace/db";
import { RAW_PROPERTY_SCHEMA_VERSION } from "./pipeline";

/**
 * Pure freshness rules for global property-cache rows. Lives in its own
 * dependency-free module (type-only import of the row shape) so the vitest
 * suite can exercise the TTL logic without a DATABASE_URL.
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

/**
 * Maximum age of a cached raw bundle before it is treated as a MISS and
 * re-acquired live. Council/valuation data drifts (annual CV rounds, zone
 * tweaks) and parcels get demolished/redeveloped — without a TTL a stale row
 * is served forever (the 6 Riddell Road incident: a 1935 build year survived
 * the parcel's redevelopment into 10 new townhouses). 90 days balances data
 * freshness against scraper cost; conflict-triggered refresh in analyse.ts
 * catches redevelopments inside the window.
 */
export const PROPERTY_CACHE_TTL_DAYS = Number(process.env["PROPERTY_CACHE_TTL_DAYS"] ?? 90);

/**
 * Pure freshness check for a cache row: version must be current and age within
 * the TTL. The db-backed lookups in property-cache.ts are thin wrappers around
 * this.
 */
export function cacheRowFreshness(
  row: Pick<PropertyCacheRow, "pipelineVersion" | "lastRefreshedAt">,
): { fresh: boolean; ageDays: number } {
  const refreshedAt = row.lastRefreshedAt instanceof Date
    ? row.lastRefreshedAt
    : new Date(row.lastRefreshedAt as unknown as string);
  const ageDays = Math.floor((Date.now() - refreshedAt.getTime()) / 86_400_000);
  const fresh = row.pipelineVersion >= PIPELINE_VERSION && ageDays <= PROPERTY_CACHE_TTL_DAYS;
  return { fresh, ageDays };
}
