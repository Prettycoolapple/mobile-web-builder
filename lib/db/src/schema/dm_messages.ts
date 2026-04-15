import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { dmThreads } from "./dm_threads";

export const dmMessages = pgTable("dm_messages", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: text("thread_id")
    .references(() => dmThreads.id, { onDelete: "cascade" })
    .notNull(),
  senderId: text("sender_id")
    .references(() => profiles.id, { onDelete: "cascade" })
    .notNull(),
  body: text("body"),
  imageUrl: text("image_url"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DmMessage = typeof dmMessages.$inferSelect;
export type InsertDmMessage = typeof dmMessages.$inferInsert;
