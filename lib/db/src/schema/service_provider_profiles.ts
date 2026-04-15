import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { profiles } from "./profiles";

export const disciplineEnum = pgEnum("service_discipline", [
  "architect_designer",
  "planner",
  "engineer",
  "quantity_surveyor",
  "other",
]);

export const serviceProviderProfiles = pgTable("service_provider_profiles", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => profiles.id, { onDelete: "cascade" }),
  companyName: text("company_name"),
  nzCompanyRegisterNumber: text("nz_company_register_number"),
  discipline: disciplineEnum("discipline"),
  addressStreet: text("address_street"),
  addressSuburb: text("address_suburb"),
  addressCity: text("address_city"),
  addressPostcode: text("address_postcode"),
  contactNumber: text("contact_number"),
  incorporationCertUrl: text("incorporation_cert_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertServiceProviderProfileSchema = createInsertSchema(serviceProviderProfiles).omit({
  id: true,
  createdAt: true,
});

export type ServiceProviderProfile = typeof serviceProviderProfiles.$inferSelect;
export type InsertServiceProviderProfile = z.infer<typeof insertServiceProviderProfileSchema>;
