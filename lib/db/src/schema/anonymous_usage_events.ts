import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const anonymousUsageEvents = pgTable(
  "anonymous_usage_events",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    installHash: text("install_hash").notNull(),
    ipHash: text("ip_hash"),
    eventType: text("event_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    installCreatedAtIdx: index("anonymous_usage_install_created_at_idx").on(table.installHash, table.createdAt),
    ipCreatedAtIdx: index("anonymous_usage_ip_created_at_idx").on(table.ipHash, table.createdAt),
  }),
);

export const insertAnonymousUsageEventSchema = createInsertSchema(anonymousUsageEvents).omit({
  id: true,
  createdAt: true,
});

export type AnonymousUsageEvent = typeof anonymousUsageEvents.$inferSelect;
export type InsertAnonymousUsageEvent = z.infer<typeof insertAnonymousUsageEventSchema>;
