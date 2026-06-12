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
