import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export type BrowseListingAgent = {
  fullName?: string | null;
  agencyName?: string | null;
  avatarUrl?: string | null;
  phone?: string | null;
};

/**
 * Global, cross-user cache of external marketplace listings used by Browse.
 * Agent-owned Project Alpha listings stay in the first-class `listings` table;
 * this cache is only for temporary external inventory so one user's browse
 * query can warm results for later users without scraping every request.
 */
export const browseListingCache = pgTable(
  "browse_listing_cache",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    source: text("source").notNull(),
    externalUrl: text("external_url").notNull(),
    externalId: text("external_id"),

    address: text("address").notNull(),
    addressSuburb: text("address_suburb"),
    addressCity: text("address_city"),
    listingType: text("listing_type").default("for_sale").notNull(),
    propertyType: text("property_type"),
    listingStatus: text("listing_status").default("active").notNull(),
    isActive: boolean("is_active").default(true).notNull(),

    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    garages: integer("garages"),
    landAreaSqm: integer("land_area_sqm"),
    floorAreaSqm: integer("floor_area_sqm"),
    priceNzd: integer("price_nzd"),
    priceDisplay: text("price_display"),

    listingTitle: text("listing_title"),
    description: text("description"),
    imageUrls: text("image_urls").array().default(sql`'{}'`).notNull(),
    features: text("features").array().default(sql`'{}'`).notNull(),
    agent: jsonb("agent").$type<BrowseListingAgent>().default(sql`'{}'::jsonb`).notNull(),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }).defaultNow().notNull(),
    refreshCount: integer("refresh_count").default(1).notNull(),
    hitCount: integer("hit_count").default(0).notNull(),
  },
  (table) => ({
    sourceUrlUnique: uniqueIndex("browse_listing_cache_source_url_unique").on(table.source, table.externalUrl),
    activeSuburbIdx: index("browse_listing_cache_active_suburb_idx").on(table.isActive, table.addressSuburb),
    activeRefreshedIdx: index("browse_listing_cache_active_refreshed_idx").on(table.isActive, table.lastRefreshedAt),
    priceIdx: index("browse_listing_cache_price_idx").on(table.priceNzd),
  }),
);

export const insertBrowseListingCacheSchema = createInsertSchema(browseListingCache).omit({
  id: true,
  firstSeenAt: true,
  lastSeenAt: true,
  lastRefreshedAt: true,
});

export type BrowseListingCache = typeof browseListingCache.$inferSelect;
export type InsertBrowseListingCache = z.infer<typeof insertBrowseListingCacheSchema>;
