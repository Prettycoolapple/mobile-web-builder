import { pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const recommendations = pgTable(
  "recommendations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    fromUserId: text("from_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    toUserId: text("to_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique("uniq_recommendation").on(t.fromUserId, t.toUserId)],
);

export type Recommendation = typeof recommendations.$inferSelect;
export type InsertRecommendation = typeof recommendations.$inferInsert;
