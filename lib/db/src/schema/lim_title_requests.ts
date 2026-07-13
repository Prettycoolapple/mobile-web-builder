import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";
import { listingAgentTargets } from "./listing_agent_targets";
import { dmThreads } from "./dm_threads";

export type LimTitleRequestMetadata = {
  agentMatchType?: "subject" | null;
  selectedListingContext?: Record<string, unknown> | null;
  intentReason?: string | null;
};

/** One durable offer/request for a buyer, property and listing-agent target. */
export const limTitleRequests = pgTable(
  "lim_title_requests",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    requesterUserId: text("requester_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    agentTargetId: text("agent_target_id")
      .notNull()
      .references(() => listingAgentTargets.id, { onDelete: "restrict" }),
    matchedAgentUserId: text("matched_agent_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    dmThreadId: text("dm_thread_id").references(() => dmThreads.id, { onDelete: "set null" }),
    claimToken: text("claim_token").notNull(),
    reportKey: text("report_key").notNull(),
    reportHistoryId: text("report_history_id"),
    chatSessionId: text("chat_session_id").notNull(),
    propertyKey: text("property_key").notNull(),
    propertyAddress: text("property_address").notNull(),
    listingUrl: text("listing_url"),
    listingSource: text("listing_source"),
    requestedDocuments: text("requested_documents")
      .array()
      .default(sql`ARRAY['lim_report','title']::text[]`)
      .notNull(),
    offerSource: text("offer_source").notNull(),
    status: text("status").default("offered").notNull(),
    metadataJson: jsonb("metadata_json").$type<LimTitleRequestMetadata>(),
    offerShownAt: timestamp("offer_shown_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    consentedAt: timestamp("consented_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lim_title_requests_buyer_target_property_unique").on(
      table.requesterUserId,
      table.agentTargetId,
      table.propertyKey,
    ),
    uniqueIndex("lim_title_requests_claim_token_unique").on(table.claimToken),
    index("lim_title_requests_report_idx").on(table.requesterUserId, table.reportKey),
    index("lim_title_requests_agent_status_idx").on(table.matchedAgentUserId, table.status),
    index("lim_title_requests_target_status_idx").on(table.agentTargetId, table.status),
  ],
);

export type LimTitleRequest = typeof limTitleRequests.$inferSelect;
export type InsertLimTitleRequest = typeof limTitleRequests.$inferInsert;
