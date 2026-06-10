import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { listings } from "./listings";

// One row per (listing, viewer) so real views are de-duplicated: a buyer
// opening the same property info page twice only counts once. The unique
// index lets us INSERT ... ON CONFLICT DO NOTHING and increment
// listings.real_views only when a brand-new row is created.
export const listingViews = pgTable(
  "listing_views",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    listingId: text("listing_id")
      .references(() => listings.id, { onDelete: "cascade" })
      .notNull(),
    viewerUserId: text("viewer_user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("uniq_listing_viewer").on(t.listingId, t.viewerUserId)],
);

export type ListingView = typeof listingViews.$inferSelect;
export type InsertListingView = typeof listingViews.$inferInsert;
