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
  // Non-image attachment (e.g. a PDF a service provider sends). Stored as a
  // served object URL plus original name + mime so clients can render a file
  // card and open/download it. Null for plain text / image messages.
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  fileMime: text("file_mime"),
  // Message "like" reaction. In a 1:1 DM either participant may like any
  // message; we store a single like (who + when) rather than a separate
  // reactions table. likedAt null = not liked. Toggling off clears both.
  likedAt: timestamp("liked_at", { withTimezone: true }),
  likedBy: text("liked_by").references(() => profiles.id, { onDelete: "set null" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type DmMessage = typeof dmMessages.$inferSelect;
export type InsertDmMessage = typeof dmMessages.$inferInsert;
