import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

/**
 * Per-provider white-label "brand kit" for PDF report exports. One row per user.
 * Holds the branding a service provider stamps onto exported feasibility reports
 * (logo, brand colour, company + contact details) so it's reused across every
 * report without re-entering it. Web-only feature (provider workspace); the
 * mobile app does not read or write this table.
 */
export const providerBrandKits = pgTable("provider_brand_kits", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color"),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  website: text("website"),
  licenceNumber: text("licence_number"),
  footerText: text("footer_text"),
  /** Additional brand images (e.g. secondary logo, partner marks) by URL. */
  extraImageUrls: text("extra_image_urls").array().default(sql`'{}'`).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProviderBrandKitSchema = createInsertSchema(providerBrandKits).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type ProviderBrandKit = typeof providerBrandKits.$inferSelect;
export type InsertProviderBrandKit = z.infer<typeof insertProviderBrandKitSchema>;
