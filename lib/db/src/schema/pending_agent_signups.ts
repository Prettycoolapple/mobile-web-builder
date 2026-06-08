import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * Holds a sales-agent signup between Stripe Checkout creation and payment
 * completion. For the subscribe path the account is created ONLY after payment
 * succeeds (via the Stripe webhook / claim), so the validated signup data must
 * survive the redirect to Stripe and back. Phone OTP is NOT consumed until the
 * account is actually created — we store `phoneVid` and consume it then.
 *
 * Rows are short-lived (status flips to "completed" once the account exists, and
 * stale "pending" rows past `expiresAt` can be swept).
 */
export const pendingAgentSignups = pgTable(
  "pending_agent_signups",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phoneNumber: text("phone_number").notNull(),
    /** phone_verifications.id, consumed when the account is created. */
    phoneVid: text("phone_vid").notNull(),
    primaryLanguage: text("primary_language").notNull(),
    agencyName: text("agency_name").notNull(),
    stripeCustomerId: text("stripe_customer_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    /** "pending" until the account is created, then "completed". */
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    checkoutSessionIdx: index("pending_agent_signups_checkout_session_idx").on(
      table.stripeCheckoutSessionId,
    ),
    emailIdx: index("pending_agent_signups_email_idx").on(table.email),
  }),
);

export const insertPendingAgentSignupSchema = createInsertSchema(pendingAgentSignups).omit({
  id: true,
  createdAt: true,
});

export type PendingAgentSignup = typeof pendingAgentSignups.$inferSelect;
export type InsertPendingAgentSignup = z.infer<typeof insertPendingAgentSignupSchema>;
