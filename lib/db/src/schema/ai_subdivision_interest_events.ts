import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const aiSubdivisionInterestEvents = pgTable(
  "ai_subdivision_interest_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    searchId: text("search_id"),
    propertyAddress: text("property_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("idx_ai_subdivision_interest_user_time").on(t.userId, t.createdAt),
    index("idx_ai_subdivision_interest_created_at").on(t.createdAt),
  ],
);

export type AiSubdivisionInterestEvent = typeof aiSubdivisionInterestEvents.$inferSelect;
export type InsertAiSubdivisionInterestEvent = typeof aiSubdivisionInterestEvents.$inferInsert;
