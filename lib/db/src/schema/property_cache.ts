import {
  pgTable,
  text,
  jsonb,
  integer,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * Global, cross-user, durable cache of the RAW externally-acquired data behind a
 * feasibility analysis (geocode, LINZ parcel/title/memorials, Auckland Council
 * GIS zone/overlays/contour/infrastructure, the property scrapers, neighbourhood
 * & transport context). The first analysis of an address populates a row; every
 * later analysis of the same address — by ANY user — reuses it, skipping the slow
 * and costly external fetches. The derived/financial numbers (lots, costs, ROI,
 * scores) are NEVER stored here — they are recomputed fresh on every serve so
 * cost-model tuning always takes effect.
 *
 * This is also a deliberate strategic asset: by accumulating raw property data
 * for a large share of NZ properties we build resilience against a scraping
 * source blocking us — the data we have already collected keeps working.
 *
 * Retention is indefinite (no TTL). Freshness is maintained by an operator-
 * triggered admin "rescan", which re-runs the live pipeline for stored rows and
 * upserts the result (see routes/admin.ts). `lastRefreshedAt` records staleness
 * and orders the rescan oldest-first.
 *
 * Notably, `sourceUserId` has NO foreign key: deleting the user who first
 * populated a row must NOT evict globally-useful property data (unlike the
 * per-user discovery_shown_listings table).
 */
export const propertyCache = pgTable(
  "property_cache",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    /** normaliseAddressKey() output — the canonical cross-source lookup key. */
    addressKey: text("address_key").notNull(),
    /** LINZ parcel id when resolved — the most stable property identity; used to
     * dedupe/link format variants of the same parcel. Many rows are null. */
    canonicalParcelId: text("canonical_parcel_id"),
    /** LINZ title number when resolved. */
    canonicalTitleId: text("canonical_title_id"),
    /** Geocoded display address, retained for rescan + debugging. */
    formattedAddress: text("formatted_address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    suburb: text("suburb"),
    /** The RawPropertyData bundle (see lib/pipeline.ts). Volatile listing/photo
     * fields are stripped before storage and refetched live on every serve. */
    rawData: jsonb("raw_data").notNull(),
    /** Bumped when the cached field SET or scraper parsing changes; a stored
     * value below the current PIPELINE_VERSION is treated as a cache miss. */
    pipelineVersion: integer("pipeline_version").notNull().default(1),
    firstAnalysedAt: timestamp("first_analysed_at", { withTimezone: true }).defaultNow().notNull(),
    /** Refreshed on every fresh acquisition (first analysis or rescan). Drives
     * staleness ordering for the rescan job. */
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }).defaultNow().notNull(),
    /** Number of times this row has been (re)acquired from live sources. */
    refreshCount: integer("refresh_count").notNull().default(0),
    /** Number of times this row has been served from cache (any user). */
    hitCount: integer("hit_count").notNull().default(0),
    /** Profile id of the user whose analysis first populated the row. No FK on
     * purpose — see table doc comment. */
    sourceUserId: text("source_user_id"),
  },
  (table) => ({
    addressKeyUnique: uniqueIndex("property_cache_address_key_unique").on(table.addressKey),
    parcelIdx: index("property_cache_parcel_idx").on(table.canonicalParcelId),
    lastRefreshedIdx: index("property_cache_last_refreshed_idx").on(table.lastRefreshedAt),
  }),
);

export const insertPropertyCacheSchema = createInsertSchema(propertyCache).omit({
  id: true,
  firstAnalysedAt: true,
  lastRefreshedAt: true,
});

export type PropertyCacheRow = typeof propertyCache.$inferSelect;
export type InsertPropertyCache = z.infer<typeof insertPropertyCacheSchema>;
