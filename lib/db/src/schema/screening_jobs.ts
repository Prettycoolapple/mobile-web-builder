import { index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

export type ScreeningJobMode = "generic_listing" | "scored_screening" | "unknown";

export const screeningJobs = pgTable(
  "screening_jobs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    mode: text("mode").notNull().default("unknown"),
    queryText: text("query_text").notNull(),
    locale: text("locale").notNull().default("en"),
    conversationHistory: jsonb("conversation_history"),
    requestPayload: jsonb("request_payload").notNull().default(sql`'{}'::jsonb`),
    resultJson: jsonb("result_json"),
    error: text("error"),
    stage: text("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    attemptCount: integer("attempt_count").notNull().default(0),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userStatusCreatedIdx: index("screening_jobs_user_status_created_idx").on(table.userId, table.status, table.createdAt),
  }),
);

export const insertScreeningJobSchema = createInsertSchema(screeningJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ScreeningJob = typeof screeningJobs.$inferSelect;
export type InsertScreeningJob = z.infer<typeof insertScreeningJobSchema>;
