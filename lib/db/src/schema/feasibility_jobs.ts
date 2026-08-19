import { pgTable, text, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

/** Background feasibility runs (client may disconnect; work continues on the server). */
export const feasibilityJobs = pgTable(
  "feasibility_jobs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    /**
     * Null for logged-out visitors — they own the job through `guestHash`
     * instead. Exactly one of the two is set (enforced by a table CHECK).
     */
    userId: text("user_id").references(() => profiles.id, { onDelete: "cascade" }),
    /**
     * Hashed anonymous install id of the guest who queued this job. It is the
     * only thing authorising the status poll, so it must be the real install
     * hash — never the IP fallback, which everyone behind a NAT would share.
     */
    guestHash: text("guest_hash"),
    /** Hashed IP at queue time, so guest jobs still count toward the per-IP report ceiling. */
    guestIpHash: text("guest_ip_hash"),
    status: text("status").notNull().default("pending"),
    queryAddress: text("query_address").notNull(),
    analysisAddress: text("analysis_address").notNull(),
    locale: text("locale").notNull().default("en"),
    translateTitleSchool: boolean("translate_title_school").notNull().default(false),
    conversationHistory: jsonb("conversation_history"),
    searchId: text("search_id"),
    /**
     * Finished report for guest jobs only. Signed-in jobs keep their result in
     * `searches` (referenced by `searchId`); guests have no history to save to,
     * so the job row itself is the only place the report can live.
     */
    resultJson: jsonb("result_json"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    guestCreatedIdx: index("feasibility_jobs_guest_created_idx").on(table.guestHash, table.createdAt),
  }),
);

export type FeasibilityJob = typeof feasibilityJobs.$inferSelect;
