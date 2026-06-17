import { index, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Append-only log of abuse / harvest-pattern signals (Layer 2 of the
 * anti-distillation defense). Each row is one observed signal — signup velocity
 * from an IP, a brand-new account burning its quota, a rate-limit trip, or a
 * manual admin flag. `weight` contributes to a per-account rolling abuse score.
 *
 * Not FK-constrained on user_id: some signals (signup velocity) are about an IP
 * and we want the audit trail to survive even if the account is later deleted.
 * IPs are stored hashed (ip_hash), never raw, matching anonymous_usage_events.
 */
export const abuseEvents = pgTable(
  "abuse_events",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id"),
    ipHash: text("ip_hash"),
    kind: text("kind").notNull(),
    weight: real("weight").notNull().default(0),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userCreatedIdx: index("abuse_events_user_created_idx").on(table.userId, table.createdAt),
    ipCreatedIdx: index("abuse_events_ip_created_idx").on(table.ipHash, table.createdAt),
    kindCreatedIdx: index("abuse_events_kind_created_idx").on(table.kind, table.createdAt),
  }),
);

export type AbuseEvent = typeof abuseEvents.$inferSelect;
export type InsertAbuseEvent = typeof abuseEvents.$inferInsert;
