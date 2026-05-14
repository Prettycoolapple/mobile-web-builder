import { pgTable, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

/** Background feasibility runs (client may disconnect; work continues on the server). */
export const feasibilityJobs = pgTable("feasibility_jobs", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  queryAddress: text("query_address").notNull(),
  analysisAddress: text("analysis_address").notNull(),
  locale: text("locale").notNull().default("en"),
  translateTitleSchool: boolean("translate_title_school").notNull().default(false),
  conversationHistory: jsonb("conversation_history"),
  searchId: text("search_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FeasibilityJob = typeof feasibilityJobs.$inferSelect;
