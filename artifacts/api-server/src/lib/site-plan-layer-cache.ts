import { eq } from "drizzle-orm";
import { db, sitePlanLayerCache, withDbRetry } from "@workspace/db";
import { logger } from "./logger";
import type { SitePlanLayer } from "./site-plan";

/**
 * TTL for cached site-plan GIS layers (council planning overlays, three-waters
 * service lines, contours). Zoning/infrastructure data changes rarely, so a
 * long TTL matching the property_cache convention (PROPERTY_CACHE_TTL_DAYS) is
 * safe and avoids re-hitting slow external ArcGIS servers on every report view.
 */
const SITE_PLAN_LAYER_CACHE_TTL_DAYS = Number(process.env.SITE_PLAN_LAYER_CACHE_TTL_DAYS ?? 90);
const SITE_PLAN_PROVIDER_CACHE_NAMESPACE: Partial<Record<string, string>> = {
  // Manawatu v1 includes both councils, three-water aggregation and the full
  // rollout overlay set. Keep pre-rollout partial bundles unreachable.
  manawatu: "manawatu-v1",
};

export function sitePlanLayerCacheKey(
  providerId: string | null | undefined,
  parcelId: string | null | undefined,
  lat: number,
  lng: number,
): string {
  const provider = providerId ?? "auckland-legacy";
  const namespacedProvider = SITE_PLAN_PROVIDER_CACHE_NAMESPACE[provider] ?? provider;
  if (parcelId) return `${namespacedProvider}:parcel:${parcelId}`;
  // Unresolved parcel: bucket by ~11m grid so nearby repeat lookups still hit.
  return `${namespacedProvider}:geo:${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

/** Best-effort cache read. Returns null on a miss, expiry, or any DB error. */
export async function getCachedSitePlanLayers(cacheKey: string): Promise<SitePlanLayer[] | null> {
  if (!cacheKey) return null;
  try {
    const rows = await withDbRetry(() =>
      db.select().from(sitePlanLayerCache).where(eq(sitePlanLayerCache.cacheKey, cacheKey)).limit(1),
    );
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return row.layers as unknown as SitePlanLayer[];
  } catch (err) {
    logger.warn({ err: (err as Error).message, cacheKey }, "site-plan-layer-cache: get failed");
    return null;
  }
}

/** Best-effort cache write. Callers should `void` this and never block the response on it. */
export async function setCachedSitePlanLayers(cacheKey: string, layers: SitePlanLayer[]): Promise<void> {
  if (!cacheKey) return;
  const expiresAt = new Date(Date.now() + SITE_PLAN_LAYER_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
  try {
    await withDbRetry(() =>
      db
        .insert(sitePlanLayerCache)
        .values({
          cacheKey,
          layers: layers as unknown as Record<string, unknown>,
          expiresAt,
        })
        .onConflictDoUpdate({
          target: sitePlanLayerCache.cacheKey,
          set: {
            layers: layers as unknown as Record<string, unknown>,
            refreshedAt: new Date(),
            expiresAt,
          },
        }),
    );
  } catch (err) {
    logger.warn({ err: (err as Error).message, cacheKey }, "site-plan-layer-cache: set failed");
  }
}
