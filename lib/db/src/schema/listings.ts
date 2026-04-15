import { pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export const listingStatusEnum = pgEnum("listing_status", ["draft", "active", "sold", "withdrawn"]);
export const listingTypeEnum = pgEnum("listing_type", ["for_sale", "for_rent"]);
export const propertyTypeEnum = pgEnum("property_type_enum", [
  "house",
  "apartment",
  "townhouse",
  "unit",
  "section",
  "commercial",
  "industrial",
  "rural",
  "other",
]);

export const listings = pgTable("listings", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id")
    .references(() => profiles.id)
    .notNull(),
  status: listingStatusEnum("status").default("active").notNull(),
  listingType: listingTypeEnum("listing_type").default("for_sale").notNull(),

  address: text("address").notNull(),
  addressStreet: text("address_street"),
  addressSuburb: text("address_suburb"),
  addressCity: text("address_city"),
  addressPostcode: text("address_postcode"),
  lat: text("lat"),
  lng: text("lng"),

  propertyType: propertyTypeEnum("property_type").default("house").notNull(),
  bedrooms: integer("bedrooms"),
  bathrooms: integer("bathrooms"),
  garages: integer("garages"),
  landAreaSqm: integer("land_area_sqm"),
  floorAreaSqm: integer("floor_area_sqm"),

  priceNzd: integer("price_nzd"),
  priceDisplay: text("price_display"),

  description: text("description"),
  imageUrls: text("image_urls").array().default(sql`'{}'`).notNull(),
  features: text("features").array().default(sql`'{}'`).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;
