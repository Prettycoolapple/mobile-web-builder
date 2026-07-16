import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Durable cache of externally-fetched site-plan GIS layers (council planning
 * overlays, three-waters service lines, contours) keyed by parcel/location +
 * planning jurisdiction. Before this table existed, site-plan.ts re-queried
 * every council ArcGIS server on every Plan-tab open with no caching at all,
 * holding the Vercel function alive on slow (9-20s timeout) external
 * round-trips every time — even for a property just viewed minutes earlier.
 * Zoning/infrastructure line data changes rarely, so a long TTL is safe.
 */
export const sitePlanLayerCache = pgTable(
  "site_plan_layer_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    /** The concatenated [...planning, ...services, contours] layer array. */
    layers: jsonb("layers").notNull(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresAtIdx: index("site_plan_layer_cache_expires_at_idx").on(table.expiresAt),
  }),
);

export const insertSitePlanLayerCacheSchema = createInsertSchema(sitePlanLayerCache);

export type SitePlanLayerCacheRow = typeof sitePlanLayerCache.$inferSelect;
export type InsertSitePlanLayerCache = z.infer<typeof insertSitePlanLayerCacheSchema>;
