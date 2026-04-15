import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, listings } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

const createListingSchema = z.object({
  address: z.string().min(3),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostcode: z.string().optional(),
  lat: z.string().optional(),
  lng: z.string().optional(),
  listingType: z.enum(["for_sale", "for_rent"]).default("for_sale"),
  propertyType: z
    .enum(["house", "apartment", "townhouse", "unit", "section", "commercial", "industrial", "rural", "other"])
    .default("house"),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  garages: z.number().int().min(0).optional(),
  landAreaSqm: z.number().int().min(0).optional(),
  floorAreaSqm: z.number().int().min(0).optional(),
  priceNzd: z.number().int().min(0).optional(),
  priceDisplay: z.string().optional(),
  description: z.string().optional(),
  imageUrls: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
});

router.get("/listings/address-autocomplete", requireAuth, async (req, res) => {
  const q = (req.query.q as string) ?? "";
  if (!q.trim() || q.trim().length < 2) {
    res.json({ predictions: [] });
    return;
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.json({ predictions: [], noKey: true });
    return;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:nz&types=address&key=${apiKey}`;
    const r = await fetch(url);
    const data = (await r.json()) as { predictions?: unknown[] };
    res.json({ predictions: data.predictions ?? [] });
  } catch {
    res.json({ predictions: [] });
  }
});

router.get("/listings/place-details/:placeId", requireAuth, async (req, res) => {
  const { placeId } = req.params;
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    res.json({ result: null });
    return;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_address,address_components,geometry&key=${apiKey}`;
    const r = await fetch(url);
    const data = (await r.json()) as { result?: unknown };
    res.json({ result: data.result ?? null });
  } catch {
    res.json({ result: null });
  }
});

router.post("/listings", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const role = (req as any).role as string;

  if (role !== "sales_agent") {
    res.status(403).json({ error: "Only sales agents can create listings", code: "FORBIDDEN" });
    return;
  }

  const parsed = createListingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing data", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;
  const [listing] = await db
    .insert(listings)
    .values({
      userId,
      address: data.address,
      addressStreet: data.addressStreet,
      addressSuburb: data.addressSuburb,
      addressCity: data.addressCity,
      addressPostcode: data.addressPostcode,
      lat: data.lat,
      lng: data.lng,
      listingType: data.listingType,
      propertyType: data.propertyType,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      garages: data.garages,
      landAreaSqm: data.landAreaSqm,
      floorAreaSqm: data.floorAreaSqm,
      priceNzd: data.priceNzd,
      priceDisplay: data.priceDisplay,
      description: data.description,
      imageUrls: data.imageUrls,
      features: data.features,
    })
    .returning();

  res.status(201).json({ listing });
});

router.get("/listings/my", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const myListings = await db
    .select()
    .from(listings)
    .where(eq(listings.userId, userId))
    .orderBy(desc(listings.createdAt));
  res.json({ listings: myListings });
});

router.get("/listings/:id", requireAuth, async (req, res) => {
  const { id } = req.params;
  const [listing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!listing) {
    res.status(404).json({ error: "Listing not found", code: "NOT_FOUND" });
    return;
  }
  res.json({ listing });
});

export default router;
