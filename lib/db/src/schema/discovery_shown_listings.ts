import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

/**
 * Account-level memory of which discovery listings a user has already been
 * shown, so a *new* conversation asking the same thing ("what's available for
 * subdivision in St Heliers") doesn't restart from property #1.
 *
 * The in-conversation dedup (parsed from the message history) and the in-memory
 * listing cache both reset per conversation / on server restart. This table is
 * the durable, cross-conversation, cross-device equivalent: one row per
 * (user, listing), keyed by a normalised address. Reads use a rolling 30-day
 * window so the pool naturally "refreshes" — a property not seen in 30 days
 * becomes eligible to show again.
 */
export const discoveryShownListings = pgTable(
  "discovery_shown_listings",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** normaliseDiscoveryAddressKey() output — the cross-source dedup key. */
    addressKey: text("address_key").notNull(),
    /** Source listing URL when known (secondary dedup signal). */
    listingUrl: text("listing_url"),
    /** Human-readable address, retained for debugging/inspection. */
    address: text("address"),
    /** Search-area suburb at time of showing, for debugging. */
    suburb: text("suburb"),
    /** Refreshed every time the listing is re-shown; drives the 30-day window. */
    shownAt: timestamp("shown_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userAddressUnique: uniqueIndex("discovery_shown_user_address_unique").on(
      table.userId,
      table.addressKey,
    ),
    userShownAtIdx: index("discovery_shown_user_shown_at_idx").on(table.userId, table.shownAt),
  }),
);

export const insertDiscoveryShownListingSchema = createInsertSchema(discoveryShownListings).omit({
  id: true,
  shownAt: true,
});

export type DiscoveryShownListing = typeof discoveryShownListings.$inferSelect;
export type InsertDiscoveryShownListing = z.infer<typeof insertDiscoveryShownListingSchema>;
