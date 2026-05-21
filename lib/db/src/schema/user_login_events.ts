import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const userLoginEvents = pgTable(
  "user_login_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    loggedInAt: timestamp("logged_in_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_login_events_user_time").on(t.userId, t.loggedInAt)],
);

export type UserLoginEvent = typeof userLoginEvents.$inferSelect;
export type InsertUserLoginEvent = typeof userLoginEvents.$inferInsert;
