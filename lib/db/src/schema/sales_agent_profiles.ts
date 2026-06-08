import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

export const salesAgentProfiles = pgTable("sales_agent_profiles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  agencyName: text("agency_name"),
  reaaLicenceNumber: text("reaa_licence_number"),
  yearsExperience: integer("years_experience"),
  regionsCovered: text("regions_covered").array().default(sql`'{}'`).notNull(),
  propertyTypes: text("property_types").array().default(sql`'{}'`).notNull(),
  languages: text("languages").array().default(sql`'{}'`).notNull(),
  websiteUrl: text("website_url"),
  bio: text("bio"),
  /**
   * How the agent's listing entitlement was obtained:
   * "lifetime"     → invitation-code (or grandfathered legacy) agent; can always list.
   * "subscription" → paid via Stripe; can list only while the subscription is active.
   * null           → legacy row not yet backfilled (treated as lifetime by agentCanList).
   */
  listingPlan: text("listing_plan"),
  /**
   * For invitation-code agents: end of the 3-month unlimited AI search/analysis
   * window. After this, AI quotas fall back to normal free limits. Null = no boost.
   */
  aiBoostExpiresAt: timestamp("ai_boost_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSalesAgentProfileSchema = createInsertSchema(salesAgentProfiles).omit({
  id: true,
  createdAt: true,
});

export type SalesAgentProfile = typeof salesAgentProfiles.$inferSelect;
export type InsertSalesAgentProfile = z.infer<typeof insertSalesAgentProfileSchema>;
