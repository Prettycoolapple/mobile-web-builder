import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const watchlistPropertyStates = pgTable(
  "watchlist_property_states",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    monitorKey: text("monitor_key").notNull(),
    address: text("address").notNull(),
    listingUrl: text("listing_url"),
    source: text("source"),
    status: text("status").notNull().default("unknown"),
    priceNzd: integer("price_nzd"),
    priceDisplay: text("price_display"),
    propertyType: text("property_type"),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    landAreaSqm: integer("land_area_sqm"),
    photoUrl: text("photo_url"),
    rawFingerprint: text("raw_fingerprint"),
    rawJson: jsonb("raw_json"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    pendingOffMarketSince: timestamp("pending_off_market_since", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    lastChangedAt: timestamp("last_changed_at", { withTimezone: true }),
    nextCheckAfter: timestamp("next_check_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    monitorKeyUnique: uniqueIndex("watchlist_property_states_monitor_key_unique").on(table.monitorKey),
    nextCheckIdx: index("watchlist_property_states_next_check_idx").on(table.nextCheckAfter, table.lastCheckedAt),
  }),
);

export type WatchlistPropertyState = typeof watchlistPropertyStates.$inferSelect;
export type InsertWatchlistPropertyState = typeof watchlistPropertyStates.$inferInsert;
