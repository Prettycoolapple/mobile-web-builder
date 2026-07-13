import { index, pgTable, text, timestamp, uniqueIndex, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { limTitleRequests } from "./lim_title_requests";
import { listingAgentTargets } from "./listing_agent_targets";

export const leadSmsDeliveries = pgTable(
  "lead_sms_deliveries",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    requestId: text("request_id")
      .notNull()
      .references(() => limTitleRequests.id, { onDelete: "cascade" }),
    agentTargetId: text("agent_target_id")
      .notNull()
      .references(() => listingAgentTargets.id, { onDelete: "cascade" }),
    toPhone: text("to_phone").notNull(),
    body: text("body").notNull(),
    twilioSid: text("twilio_sid"),
    status: text("status").default("queued").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("lead_sms_deliveries_request_unique").on(table.requestId),
    uniqueIndex("lead_sms_deliveries_twilio_sid_unique")
      .on(table.twilioSid)
      .where(sql`${table.twilioSid} IS NOT NULL`),
    index("lead_sms_deliveries_retry_idx").on(table.status, table.nextAttemptAt),
  ],
);

export type LeadSmsDelivery = typeof leadSmsDeliveries.$inferSelect;
export type InsertLeadSmsDelivery = typeof leadSmsDeliveries.$inferInsert;
