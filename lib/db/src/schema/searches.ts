import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

export const searches = pgTable("searches", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  query: text("query").notNull(),
  address: text("address"),
  resultJson: jsonb("result_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSearchSchema = createInsertSchema(searches).omit({
  id: true,
  createdAt: true,
});

export type Search = typeof searches.$inferSelect;
export type InsertSearch = z.infer<typeof insertSearchSchema>;
