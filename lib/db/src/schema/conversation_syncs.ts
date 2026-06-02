import { pgTable, text, jsonb, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

/**
 * Full chat-conversation sync for cross-device continuity.
 *
 * Each row is one device "session" (a continuous conversation thread) stored
 * verbatim as JSON in `data` — every message, report, search result, provider
 * card, etc. The device-generated session id is kept in `clientId` so the same
 * conversation upserts (rather than duplicating) when re-synced from any device.
 *
 * The complete payload is retained deliberately so conversations can be
 * reviewed/evaluated later; nothing is trimmed server-side beyond what the
 * client chooses not to send (e.g. on-device file URIs that are meaningless on
 * another device).
 */
export const conversationSyncs = pgTable(
  "conversation_syncs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    /** Device-generated session id (stable across syncs from the same device). */
    clientId: text("client_id").notNull(),
    title: text("title").notNull().default(""),
    /** Entire session payload: messages[], currentReport, flags, etc. */
    data: jsonb("data").notNull(),
    messageCount: integer("message_count").notNull().default(0),
    /** session.updatedAt from the device — drives last-write-wins merging. */
    clientUpdatedAt: timestamp("client_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userClientUnique: uniqueIndex("conversation_syncs_user_client_unique").on(
      table.userId,
      table.clientId,
    ),
  }),
);

export const insertConversationSyncSchema = createInsertSchema(conversationSyncs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ConversationSync = typeof conversationSyncs.$inferSelect;
export type InsertConversationSync = z.infer<typeof insertConversationSyncSchema>;
