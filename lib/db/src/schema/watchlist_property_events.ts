import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { watchlistPropertyStates } from "./watchlist_property_states";

export const watchlistPropertyEvents = pgTable(
  "watchlist_property_events",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    monitorKey: text("monitor_key")
      .notNull()
      .references(() => watchlistPropertyStates.monitorKey, { onDelete: "cascade" }),
    changeType: text("change_type").notNull(),
    address: text("address").notNull(),
    previousJson: jsonb("previous_json"),
    currentJson: jsonb("current_json").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    monitorDetectedIdx: index("watchlist_property_events_monitor_detected_idx").on(table.monitorKey, table.detectedAt),
  }),
);

export type WatchlistPropertyEvent = typeof watchlistPropertyEvents.$inferSelect;
export type InsertWatchlistPropertyEvent = typeof watchlistPropertyEvents.$inferInsert;
