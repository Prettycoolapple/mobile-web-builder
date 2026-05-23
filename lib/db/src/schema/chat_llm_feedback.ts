import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

export const chatLlmFeedback = pgTable("chat_llm_feedback", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .references(() => profiles.id, { onDelete: "cascade" }),
  clientSessionId: text("client_session_id").notNull(),
  rating: text("rating").notNull(),
  responseMode: text("response_mode"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertChatLlmFeedbackSchema = createInsertSchema(chatLlmFeedback).omit({
  id: true,
  createdAt: true,
});

export type ChatLlmFeedback = typeof chatLlmFeedback.$inferSelect;
export type InsertChatLlmFeedback = z.infer<typeof insertChatLlmFeedbackSchema>;
