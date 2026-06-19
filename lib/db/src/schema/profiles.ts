import { pgTable, text, integer, timestamp, pgEnum, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["general", "sales_agent", "service_provider", "admin"]);

export const profiles = pgTable(
  "profiles",
  {
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
  stripeCustomerId: text("stripe_customer_id"),
  /**
   * Stripe subscription id for web agent subscriptions ($199/mo). Null for
   * mobile IAP / invite-code / free accounts.
   */
  stripeSubscriptionId: text("stripe_subscription_id"),
  /**
   * Latest Stripe subscription status, kept in sync by the Stripe webhook:
   * active | trialing | past_due | canceled | unpaid | incomplete | null.
   */
  subscriptionStatus: text("subscription_status"),
  /** True when the agent has cancelled but the paid period hasn't ended yet. */
  subscriptionCancelAtPeriodEnd: boolean("subscription_cancel_at_period_end")
    .default(false)
    .notNull(),
  avatarUrl: text("avatar_url"),
  isVerified: boolean("is_verified").default(false).notNull(),
  phoneNumber: text("phone_number"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  /**
   * Server-side id for the only currently valid device session. New logins
   * replace this value, which invalidates tokens issued to previous devices.
   */
  activeSessionId: text("active_session_id"),
  /**
   * Admin-granted special status that overrides the normal plan report limit.
   * "supercharge"    → 60 reports/month, expires after 6 months (see specialStatusExpiresAt)
   * "friends_family" → 9999 reports/month, no expiry
   * null             → normal plan-based limits apply
   */
  specialStatus: text("special_status"),
  specialStatusExpiresAt: timestamp("special_status_expires_at", { withTimezone: true }),
  /**
   * Abuse / harvesting flag (Layer 2 detection → Layer 3 enforcement). Set
   * manually by an admin or auto when the rolling abuse score crosses a
   * threshold. Read by Layer 3 to degrade output for confirmed abusers; until
   * Layer 3 ships this is purely informational. Legitimate accounts stay false.
   */
  abuseFlag: boolean("abuse_flag").default(false).notNull(),
  abuseFlagReason: text("abuse_flag_reason"),
  abuseFlaggedAt: timestamp("abuse_flagged_at", { withTimezone: true }),
  },
  (table) => ({
    phoneRoleUnique: uniqueIndex("profiles_phone_role_unique")
      .on(table.phoneNumber, table.role)
      .where(sql`${table.phoneNumber} IS NOT NULL AND btrim(${table.phoneNumber}) <> ''`),
  }),
);

export const insertProfileSchema = createInsertSchema(profiles).omit({
  id: true,
  createdAt: true,
  lastResetAt: true,
});

export type Profile = typeof profiles.$inferSelect;
export type InsertProfile = z.infer<typeof insertProfileSchema>;
