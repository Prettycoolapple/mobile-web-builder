import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const phoneRegistrationHistory = pgTable("phone_registration_history", {
  phoneNumber: text("phone_number").primaryKey(),
  deletedAccountCount: integer("deleted_account_count").default(0).notNull(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  permanentlyBanned: boolean("permanently_banned").default(false).notNull(),
  lastDeletedAt: timestamp("last_deleted_at", { withTimezone: true }),
  lastDeletedRole: text("last_deleted_role"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertPhoneRegistrationHistorySchema = createInsertSchema(phoneRegistrationHistory).omit({
  createdAt: true,
  updatedAt: true,
});

export type PhoneRegistrationHistory = typeof phoneRegistrationHistory.$inferSelect;
export type InsertPhoneRegistrationHistory = z.infer<typeof insertPhoneRegistrationHistorySchema>;
