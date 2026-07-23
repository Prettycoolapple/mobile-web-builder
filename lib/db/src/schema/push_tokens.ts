import { check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { newsGuestSessions } from "./news_guests";

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    guestSessionId: text("guest_session_id").references(() => newsGuestSessions.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: text("platform").notNull(),
    /** OS-derived content locale. Null until an updated app re-registers the token. */
    locale: text("locale"),
    /** Set only by app builds that implement the News feed and deep links. */
    newsCapableAt: timestamp("news_capable_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "push_tokens_exactly_one_owner",
      sql`(${table.userId} is not null)::integer + (${table.guestSessionId} is not null)::integer = 1`,
    ),
    index("push_tokens_guest_session_idx").on(table.guestSessionId),
  ],
);

export type PushToken = typeof pushTokens.$inferSelect;
export type InsertPushToken = typeof pushTokens.$inferInsert;
