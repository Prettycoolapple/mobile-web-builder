import { integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Durable fixed-window rate-limit counters.
 *
 * One row per (bucket_key, window_start). The API increments `count` with an
 * atomic INSERT ... ON CONFLICT DO UPDATE so velocity limits hold across
 * separate serverless invocations — in-memory counters do not survive on
 * Vercel, where each request can hit a fresh instance.
 *
 * `expires_at` marks when a window's row is safe to delete; the limiter prunes
 * expired rows opportunistically so the table stays bounded without a cron.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.bucketKey, table.windowStart] }),
  }),
);

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
