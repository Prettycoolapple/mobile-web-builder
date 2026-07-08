import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const watchlistMonitorRuns = pgTable(
  "watchlist_monitor_runs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    targetsTotal: integer("targets_total").notNull().default(0),
    targetsChecked: integer("targets_checked").notNull().default(0),
    changesDetected: integer("changes_detected").notNull().default(0),
    notificationsSent: integer("notifications_sent").notNull().default(0),
    failures: integer("failures").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => ({
    startedAtIdx: index("watchlist_monitor_runs_started_at_idx").on(table.startedAt),
  }),
);

export type WatchlistMonitorRun = typeof watchlistMonitorRuns.$inferSelect;
export type InsertWatchlistMonitorRun = typeof watchlistMonitorRuns.$inferInsert;
