import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { dmThreads } from "./dm_threads";

export const userReports = pgTable("user_reports", {
  id: text("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  reporterId: text("reporter_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  reportedUserId: text("reported_user_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  threadId: text("thread_id").references(() => dmThreads.id, { onDelete: "set null" }),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserReport = typeof userReports.$inferSelect;
export type InsertUserReport = typeof userReports.$inferInsert;
