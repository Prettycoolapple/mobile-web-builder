import { pgTable, text, timestamp, index, integer } from "drizzle-orm/pg-core";
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
    funnelVersion: integer("funnel_version").default(0).notNull(),
    audienceSegment: text("audience_segment"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("idx_ai_subdivision_interest_user_time").on(t.userId, t.createdAt),
    index("idx_ai_subdivision_interest_created_at").on(t.createdAt),
    index("idx_ai_subdivision_interest_funnel_completion").on(
      t.funnelVersion,
      t.completedAt,
    ),
  ],
);

export type AiSubdivisionInterestEvent =
  typeof aiSubdivisionInterestEvents.$inferSelect;
export type InsertAiSubdivisionInterestEvent =
  typeof aiSubdivisionInterestEvents.$inferInsert;
