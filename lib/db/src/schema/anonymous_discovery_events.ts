import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const anonymousDiscoveryEvents = pgTable("anonymous_discovery_events", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  installHash: text("install_hash").notNull(),
  ipHash: text("ip_hash"),
  mode: text("mode").notNull(),
  suburb: text("suburb"),
  criteria: text("criteria"),
  locale: text("locale"),
  query: text("query"),
  resultCount: integer("result_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertAnonymousDiscoveryEventSchema = createInsertSchema(anonymousDiscoveryEvents).omit({
  id: true,
  createdAt: true,
});

export type AnonymousDiscoveryEvent = typeof anonymousDiscoveryEvents.$inferSelect;
export type InsertAnonymousDiscoveryEvent = z.infer<typeof insertAnonymousDiscoveryEventSchema>;
