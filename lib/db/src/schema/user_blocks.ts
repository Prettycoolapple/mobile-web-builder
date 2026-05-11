import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

/** One-way block: `blockerId` chose to block `blockedId`. Messaging is disabled if either party has blocked the other. */
export const userBlocks = pgTable(
  "user_blocks",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    blockerId: text("blocker_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    blockedId: text("blocked_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("user_blocks_blocker_blocked_unique").on(t.blockerId, t.blockedId)],
);

export type UserBlock = typeof userBlocks.$inferSelect;
export type InsertUserBlock = typeof userBlocks.$inferInsert;
