import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  passwordHash: text("password_hash").notNull(),
  subscriptionTier: text("subscription_tier").default("free").notNull(),
  reportsUsedThisMonth: integer("reports_used_this_month").default(0).notNull(),
  lastResetAt: timestamp("last_reset_at", { withTimezone: true }).defaultNow().notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  createdAt: true,
  lastResetAt: true,
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
