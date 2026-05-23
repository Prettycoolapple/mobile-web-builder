import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const agentCallEvents = pgTable(
  "agent_call_events",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: text("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    agentPhone: text("agent_phone"),
    agentName: text("agent_name"),
    agencyName: text("agency_name"),
    propertyAddress: text("property_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("idx_agent_call_user_time").on(t.userId, t.createdAt)],
);

export type AgentCallEvent = typeof agentCallEvents.$inferSelect;
export type InsertAgentCallEvent = typeof agentCallEvents.$inferInsert;
