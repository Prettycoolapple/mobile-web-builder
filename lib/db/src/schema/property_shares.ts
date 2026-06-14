import {
  pgTable,
  text,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

export const propertyShares = pgTable(
  "property_shares",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    token: text("token").notNull().unique(),
    ownerUserId: text("owner_user_id")
      .references(() => profiles.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    address: text("address").notNull(),
    previewTitle: text("preview_title").notNull(),
    previewDescription: text("preview_description").notNull(),
    previewImageUrl: text("preview_image_url"),
    payloadJson: jsonb("payload_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
  },
  (table) => ({
    tokenIdx: index("property_shares_token_idx").on(table.token),
    ownerIdx: index("property_shares_owner_idx").on(table.ownerUserId),
    createdAtIdx: index("property_shares_created_at_idx").on(table.createdAt),
  }),
);

export const insertPropertyShareSchema = createInsertSchema(propertyShares).omit({
  id: true,
  createdAt: true,
});

export type PropertyShare = typeof propertyShares.$inferSelect;
export type InsertPropertyShare = z.infer<typeof insertPropertyShareSchema>;
