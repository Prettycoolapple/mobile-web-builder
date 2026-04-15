import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const dmThreads = pgTable("dm_threads", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  participantA: text("participant_a")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  participantB: text("participant_b")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DmThread = typeof dmThreads.$inferSelect;
export type InsertDmThread = typeof dmThreads.$inferInsert;
