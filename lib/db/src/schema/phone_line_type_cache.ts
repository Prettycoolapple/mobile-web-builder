import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const phoneLineTypeCache = pgTable(
  "phone_line_type_cache",
  {
    phoneNumber: text("phone_number").primaryKey(),
    lineType: text("line_type").notNull(),
    carrierName: text("carrier_name"),
    rawData: jsonb("raw_data"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiresAtIdx: index("phone_line_type_cache_expires_at_idx").on(table.expiresAt),
  }),
);

export const insertPhoneLineTypeCacheSchema = createInsertSchema(phoneLineTypeCache);

export type PhoneLineTypeCache = typeof phoneLineTypeCache.$inferSelect;
export type InsertPhoneLineTypeCache = z.infer<typeof insertPhoneLineTypeCacheSchema>;
