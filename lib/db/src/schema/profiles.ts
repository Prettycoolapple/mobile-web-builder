import { pgTable, text, integer, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["general", "sales_agent", "service_provider"]);

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").default("general").notNull(),
  languages: text("languages").array().default(sql`'{}'`).notNull(),
  subscriptionTier: text("subscription_tier").default("free").notNull(),
  reportsUsedThisMonth: integer("reports_used_this_month").default(0).notNull(),
  messagesUsedThisMonth: integer("messages_used_this_month").default(0).notNull(),
  lastResetAt: timestamp("last_reset_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * End of the current App Store / Play Billing period for the active subscription,
   * copied from RevenueCat (entitlement expiration). Usage quotas for paid tiers use
   * this (not calendar month) so renewal aligns with IAP. Null for free / unknown.
   */
  subscriptionPeriodEndAt: timestamp("subscription_period_end_at", { withTimezone: true }),
  avatarUrl: text("avatar_url"),
  isVerified: boolean("is_verified").default(false).notNull(),
  phoneNumber: text("phone_number"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  createdAt: true,
  lastResetAt: true,
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
