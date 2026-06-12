import { pgTable, text, integer, real, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

/**
 * Per-user "watchlist": properties a logged-in user has hearted to keep an eye
 * on. One row per (user, property), keyed by a normalised property key
 * (listingUrl || address, lowercased). A denormalised snapshot of the card's
 * display fields is stored so the Watchlist tab renders without re-fetching,
 * and so future price-drop / sold-status monitoring has prior values to diff
 * against. `snapshotJson` holds the full PropertyCandidate for faithful
 * re-rendering of the original card.
 */
export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** Normalised dedup key: (listingUrl || address).trim().toLowerCase(). */
    propertyKey: text("property_key").notNull(),
    address: text("address").notNull(),
    listingUrl: text("listing_url"),
    photoUrl: text("photo_url"),
    priceDisplay: text("price_display"),
    propertyType: text("property_type"),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    landAreaSqm: integer("land_area_sqm"),
    zone: text("zone"),
    compositeScore: real("composite_score"),
    /** Full PropertyCandidate snapshot for faithful card re-render. */
    snapshotJson: jsonb("snapshot_json"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userPropertyUnique: uniqueIndex("watchlist_user_property_unique").on(
      table.userId,
      table.propertyKey,
    ),
    userCreatedIdx: index("watchlist_user_created_idx").on(table.userId, table.createdAt),
  }),
);

export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).omit({
  id: true,
  createdAt: true,
});

export type WatchlistItem = typeof watchlistItems.$inferSelect;
export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
