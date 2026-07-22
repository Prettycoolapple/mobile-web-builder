import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

/**
 * A guest session is deliberately separate from the long-lived anonymous
 * installation id. The mobile app rotates it on sign-out so a shared device
 * cannot transfer one account's reading history to another account.
 */
export const newsGuestSessions = pgTable(
  "news_guest_sessions",
  {
    id: text("id").primaryKey(),
    installationHash: text("installation_hash").notNull(),
    claimedByUserId: text("claimed_by_user_id").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
  },
  (table) => [
    index("news_guest_sessions_install_idx").on(table.installationHash, table.lastSeenAt),
    index("news_guest_sessions_claimed_idx").on(table.claimedByUserId),
  ],
);

export type NewsGuestSession = typeof newsGuestSessions.$inferSelect;
