import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const anonymousDiscoveryShownListings = pgTable(
  "anonymous_discovery_shown_listings",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    installHash: text("install_hash").notNull(),
    addressKey: text("address_key").notNull(),
    listingUrl: text("listing_url"),
    address: text("address"),
    suburb: text("suburb"),
    shownAt: timestamp("shown_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    installAddressUnique: uniqueIndex("anonymous_discovery_shown_install_address_unique").on(
      table.installHash,
      table.addressKey,
    ),
    installShownAtIdx: index("anonymous_discovery_shown_install_shown_at_idx").on(table.installHash, table.shownAt),
  }),
);

export const insertAnonymousDiscoveryShownListingSchema = createInsertSchema(anonymousDiscoveryShownListings).omit({
  id: true,
  shownAt: true,
});

export type AnonymousDiscoveryShownListing = typeof anonymousDiscoveryShownListings.$inferSelect;
export type InsertAnonymousDiscoveryShownListing = z.infer<typeof insertAnonymousDiscoveryShownListingSchema>;
