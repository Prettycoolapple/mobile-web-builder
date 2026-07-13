import { index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

/**
 * A listing agent identity captured from an active marketplace listing.
 *
 * Phone ownership is deliberately the only automatic claim key.  The phone is
 * normalized to E.164 before insertion and must be OTP-verified on the matched
 * sales-agent profile before matched_agent_user_id is populated.
 */
export const listingAgentTargets = pgTable(
  "listing_agent_targets",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    phoneNumber: text("phone_number").notNull(),
    agentName: text("agent_name"),
    agencyName: text("agency_name"),
    source: text("source"),
    sourceListingUrl: text("source_listing_url"),
    matchedAgentUserId: text("matched_agent_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    optOutKeyword: text("opt_out_keyword"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("listing_agent_targets_phone_unique").on(table.phoneNumber),
    index("listing_agent_targets_matched_agent_idx").on(table.matchedAgentUserId),
  ],
);

export type ListingAgentTarget = typeof listingAgentTargets.$inferSelect;
export type InsertListingAgentTarget = typeof listingAgentTargets.$inferInsert;
