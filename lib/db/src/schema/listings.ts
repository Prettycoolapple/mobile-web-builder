import { boolean, jsonb, pgTable, text, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

export type ListingDocument = {
  category: "title" | "lim" | "other";
  fileName: string;
  fileUrl: string;
  objectPath?: string | null;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export const listingStatusEnum = pgEnum("listing_status", ["draft", "active", "paused", "sold", "withdrawn"]);
export const listingTypeEnum = pgEnum("listing_type", ["for_sale", "for_rent"]);
export const methodOfSaleEnum = pgEnum("method_of_sale", [
  "auction",
  "tender",
  "asking_price",
  "deadline_sale",
  "price_by_negotiation",
]);
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
  googlePlaceId: text("google_place_id"),

  propertyType: propertyTypeEnum("property_type").default("house").notNull(),
  propertySubtype: text("property_subtype"),
  bedrooms: integer("bedrooms"),
  bathrooms: integer("bathrooms"),
  toilets: integer("toilets"),
  garages: integer("garages"),
  landAreaSqm: integer("land_area_sqm"),
  floorAreaSqm: integer("floor_area_sqm"),
  titleStatus: text("title_status"),

  priceNzd: integer("price_nzd"),
  priceDisplay: text("price_display"),
  methodOfSale: methodOfSaleEnum("method_of_sale"),
  backendSearchPriceMin: integer("backend_search_price_min"),
  backendSearchPriceMax: integer("backend_search_price_max"),
  buyerPriceRangeMin: integer("buyer_price_range_min"),
  buyerPriceRangeMax: integer("buyer_price_range_max"),
  buyerPriceRangeConfirmed: boolean("buyer_price_range_confirmed").default(false).notNull(),

  listingTitle: text("listing_title"),
  description: text("description"),
  imageUrls: text("image_urls").array().default(sql`'{}'`).notNull(),
  documentUrls: jsonb("document_urls").$type<ListingDocument[]>().default(sql`'[]'::jsonb`).notNull(),
  features: text("features").array().default(sql`'{}'`).notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Listing = typeof listings.$inferSelect;
export type InsertListing = typeof listings.$inferInsert;
