import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { searches } from "./searches";

export type PostReportPromptChannel = "lim_title" | "service_provider";

/**
 * Durable mutual-exclusion claim for proactive prompts attached to one saved
 * feasibility report. Explicit user requests never create rows here.
 */
export const postReportPromptAllocations = pgTable(
  "post_report_prompt_allocations",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    reportHistoryId: text("report_history_id")
      .notNull()
      .references(() => searches.id, { onDelete: "cascade" }),
    channel: text("channel").$type<PostReportPromptChannel>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("post_report_prompt_allocations_user_report_unique").on(
      table.requesterUserId,
      table.reportHistoryId,
    ),
    index("post_report_prompt_allocations_report_idx").on(
      table.reportHistoryId,
    ),
  ],
);

export type PostReportPromptAllocation =
  typeof postReportPromptAllocations.$inferSelect;
export type InsertPostReportPromptAllocation =
  typeof postReportPromptAllocations.$inferInsert;
