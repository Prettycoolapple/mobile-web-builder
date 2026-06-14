import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export type DiscoveryContinuationPage = {
  candidates: unknown[];
};

export type DiscoveryContinuationState = {
  criteria?: string | null;
  preScreenOpts?: Record<string, unknown>;
  remainingListings?: unknown[];
  readyPages?: DiscoveryContinuationPage[];
  // Nearby "train" expansion: when the user taps "Search nearby", we resolve an
  // ordered list of nearby suburbs and expand outward one at a time as each is
  // drained — never revisiting the origin or already-drained suburbs.
  nearbyQueue?: string[];     // ordered nearby suburbs still to expand into
  originSuburb?: string;      // where the train started (for refresh-on-drain)
  currentSuburb?: string;     // suburb currently being served (for the exhausted prompt)
  requireSourceBackedPrice?: boolean; // true when the user gave an explicit budget; POA/unknown-price listings should not match
  // Lazy/incremental pagination of the current suburb. Generic browse fetches a
  // small window of source pages up front and refills the pool one window at a
  // time on Show-more, so a high-inventory suburb isn't fetched in full before
  // the first cards appear. These track where to resume and when the suburb's
  // source is genuinely drained. Reset when the train advances to a new suburb.
  pageOffset?: number;        // next raw API offset to resume the current suburb from
  pageTotal?: number | null;  // raw source total for the current suburb (null if unknown)
  pageDone?: boolean;         // true once the current suburb's source is fully drained
};

export const discoveryContinuations = pgTable(
  "discovery_continuations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    ownerKey: text("owner_key"),
    searchPresentation: text("search_presentation").notNull(),
    suburb: text("suburb"),
    minPrice: integer("min_price"),
    maxPrice: integer("max_price"),
    cacheKey: text("cache_key"),
    state: jsonb("state").$type<DiscoveryContinuationState>().default(sql`'{}'::jsonb`).notNull(),
    exhausted: boolean("exhausted").default(false).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerExpiresIdx: index("discovery_continuations_owner_expires_idx").on(table.ownerKey, table.expiresAt),
    expiresIdx: index("discovery_continuations_expires_idx").on(table.expiresAt),
  }),
);

export const insertDiscoveryContinuationSchema = createInsertSchema(discoveryContinuations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type DiscoveryContinuation = typeof discoveryContinuations.$inferSelect;
export type InsertDiscoveryContinuation = z.infer<typeof insertDiscoveryContinuationSchema>;
