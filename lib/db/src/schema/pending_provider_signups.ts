import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const pendingProviderSignups = pgTable(
  "pending_provider_signups",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phoneNumber: text("phone_number").notNull(),
    phoneVid: text("phone_vid").notNull(),
    primaryLanguage: text("primary_language").notNull(),
    companyName: text("company_name").notNull(),
    nzCompanyRegisterNumber: text("nz_company_register_number").notNull(),
    discipline: text("discipline").notNull(),
    otherDiscipline: text("other_discipline"),
    secondaryLanguage: text("secondary_language"),
    addressStreet: text("address_street"),
    addressSuburb: text("address_suburb"),
    addressCity: text("address_city"),
    addressPostcode: text("address_postcode"),
    avatarUrl: text("avatar_url"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    checkoutSessionIdx: index("pending_provider_signups_checkout_session_idx").on(
      table.stripeCheckoutSessionId,
    ),
    emailIdx: index("pending_provider_signups_email_idx").on(table.email),
  }),
);

export type PendingProviderSignup = typeof pendingProviderSignups.$inferSelect;
