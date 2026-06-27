import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const notificationItems = pgTable(
  "notification_items",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sourceId: text("source_id").notNull(),
    page: text("page").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    metadataJson: jsonb("metadata_json"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("notification_items_user_kind_source_unique").on(table.userId, table.kind, table.sourceId),
    index("notification_items_user_page_read_idx").on(table.userId, table.page, table.readAt, table.createdAt),
  ],
);

export type NotificationItem = typeof notificationItems.$inferSelect;
export type InsertNotificationItem = typeof notificationItems.$inferInsert;
