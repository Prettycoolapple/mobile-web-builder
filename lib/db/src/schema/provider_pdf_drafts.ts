import { jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

/**
 * Per-provider saved edits for white-label PDF report exports.
 * Web-only provider workspace feature; mobile does not read or write this table.
 */
export const providerPdfDrafts = pgTable(
  "provider_pdf_drafts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    reportAddress: text("report_address").notNull().default(""),
    draftJson: jsonb("draft_json").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    userReportUnique: uniqueIndex("provider_pdf_drafts_user_report_unique").on(table.userId, table.reportKey),
  }),
);

export const insertProviderPdfDraftSchema = createInsertSchema(providerPdfDrafts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProviderPdfDraft = typeof providerPdfDrafts.$inferSelect;
export type InsertProviderPdfDraft = z.infer<typeof insertProviderPdfDraftSchema>;
