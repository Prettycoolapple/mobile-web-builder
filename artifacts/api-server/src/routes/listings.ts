import { Router } from "express";
import { and, eq, desc, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, listings, salesAgentProfiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

const propertyTypes = ["house", "apartment", "townhouse", "unit", "section", "commercial", "industrial", "rural", "other"] as const;
const listingStatuses = ["draft", "active", "paused", "sold", "withdrawn"] as const;
const methodsOfSale = ["auction", "tender", "asking_price", "deadline_sale", "price_by_negotiation"] as const;
const titleStatuses = ["freehold", "crosslease", "unit_title", "leasehold", "other"] as const;
const documentCategories = ["title", "lim", "other"] as const;

const listingDocumentSchema = z.object({
  category: z.enum(documentCategories),
  fileName: z.string().min(1).max(240),
  fileUrl: z.string().min(1),
  objectPath: z.string().nullable().optional(),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  uploadedAt: z.string().min(1),
});

const listingPayloadSchema = z.object({
  listingTitle: z.string().trim().min(3).max(180),
  address: z.string().trim().min(3),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostcode: z.string().optional(),
  lat: z.string().optional(),
  lng: z.string().optional(),
  googlePlaceId: z.string().optional(),
  status: z.enum(listingStatuses).default("active"),
  listingType: z.enum(["for_sale", "for_rent"]).default("for_sale"),
  propertyType: z.enum(propertyTypes),
  propertySubtype: z.string().trim().min(1).max(120),
  bedrooms: z.number().int().min(0),
  bathrooms: z.number().int().min(0),
  toilets: z.number().int().min(0),
  garages: z.number().int().min(0),
  landAreaSqm: z.number().int().positive(),
  floorAreaSqm: z.number().int().positive(),
  titleStatus: z.enum(titleStatuses),
  methodOfSale: z.enum(methodsOfSale),
  backendSearchPriceMin: z.number().int().positive(),
  backendSearchPriceMax: z.number().int().positive(),
  buyerPriceRangeMin: z.number().int().positive().optional(),
  buyerPriceRangeMax: z.number().int().positive().optional(),
  buyerPriceRangeConfirmed: z.boolean().default(false),
  priceNzd: z.number().int().min(0).optional(),
  priceDisplay: z.string().optional(),
  description: z.string().trim().min(20),
  imageUrls: z.array(z.string().min(1)).min(1).max(20),
  documentUrls: z.array(listingDocumentSchema).default([]),
  features: z.array(z.string()).default([]),
});

function validateListingRules(
  data: Partial<z.infer<typeof listingPayloadSchema>>,
  ctx: z.RefinementCtx,
) {
  if (
    data.backendSearchPriceMin !== undefined &&
    data.backendSearchPriceMax !== undefined &&
    data.backendSearchPriceMax < data.backendSearchPriceMin
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["backendSearchPriceMax"],
      message: "Backend search price maximum must be greater than or equal to the minimum.",
    });
  }

  const hasBuyerMin = data.buyerPriceRangeMin !== undefined;
  const hasBuyerMax = data.buyerPriceRangeMax !== undefined;
  if (hasBuyerMin !== hasBuyerMax) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["buyerPriceRangeMin"],
      message: "Enter both ends of the buyer-facing price range, or leave both blank.",
    });
  }
  if (hasBuyerMin && hasBuyerMax) {
    if ((data.buyerPriceRangeMax ?? 0) < (data.buyerPriceRangeMin ?? 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyerPriceRangeMax"],
        message: "Buyer-facing price range maximum must be greater than or equal to the minimum.",
      });
    }
    if (!data.buyerPriceRangeConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["buyerPriceRangeConfirmed"],
        message: "Confirm the lowest quoted figure is an amount the vendor would seriously consider.",
      });
    }
  }

  for (const [index, document] of (data.documentUrls ?? []).entries()) {
    const mime = document.mimeType.toLowerCase();
    if ((document.category === "title" || document.category === "lim") && mime !== "application/pdf") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentUrls", index, "mimeType"],
        message: "Property Title and LIM files must be PDFs.",
      });
    }
  }
}

const createListingSchema = listingPayloadSchema.superRefine(validateListingRules);

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

  const [agentProfile] = role === "sales_agent"
    ? [{ userId }]
    : await db
        .select({ userId: salesAgentProfiles.userId })
        .from(salesAgentProfiles)
        .where(eq(salesAgentProfiles.userId, userId))
        .limit(1);

  if (role !== "sales_agent" && !agentProfile) {
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
      googlePlaceId: data.googlePlaceId,
      status: data.status,
      listingType: data.listingType,
      propertyType: data.propertyType,
      propertySubtype: data.propertySubtype,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      toilets: data.toilets,
      garages: data.garages,
      landAreaSqm: data.landAreaSqm,
      floorAreaSqm: data.floorAreaSqm,
      titleStatus: data.titleStatus,
      methodOfSale: data.methodOfSale,
      backendSearchPriceMin: data.backendSearchPriceMin,
      backendSearchPriceMax: data.backendSearchPriceMax,
      buyerPriceRangeMin: data.buyerPriceRangeMin,
      buyerPriceRangeMax: data.buyerPriceRangeMax,
      buyerPriceRangeConfirmed: data.buyerPriceRangeConfirmed,
      priceNzd: data.priceNzd,
      priceDisplay: data.priceDisplay,
      listingTitle: data.listingTitle,
      description: data.description,
      imageUrls: data.imageUrls,
      documentUrls: data.documentUrls,
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
    .where(and(eq(listings.userId, userId), isNull(listings.removedAt)))
    .orderBy(desc(listings.createdAt));
  res.json({ listings: myListings });
});

router.get("/listings/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  const [listing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!listing) {
    res.status(404).json({ error: "Listing not found", code: "NOT_FOUND" });
    return;
  }
  if (listing.userId !== userId) {
    res.status(403).json({ error: "You can only view your own listings", code: "FORBIDDEN" });
    return;
  }
  res.json({ listing });
});

const updateListingSchema = listingPayloadSchema.partial().extend({
  status: z.enum(listingStatuses).optional(),
}).superRefine(validateListingRules);

router.patch("/listings/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  const [existing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!existing) {
    res.status(404).json({ error: "Listing not found", code: "NOT_FOUND" });
    return;
  }
  if (existing.userId !== userId) {
    res.status(403).json({ error: "You can only edit your own listings", code: "FORBIDDEN" });
    return;
  }

  const parsed = updateListingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid listing data", details: parsed.error.issues });
    return;
  }

  const data = parsed.data;
  const [updated] = await db
    .update(listings)
    .set({
      ...(data.address !== undefined && { address: data.address }),
      ...(data.addressStreet !== undefined && { addressStreet: data.addressStreet }),
      ...(data.addressSuburb !== undefined && { addressSuburb: data.addressSuburb }),
      ...(data.addressCity !== undefined && { addressCity: data.addressCity }),
      ...(data.addressPostcode !== undefined && { addressPostcode: data.addressPostcode }),
      ...(data.lat !== undefined && { lat: data.lat }),
      ...(data.lng !== undefined && { lng: data.lng }),
      ...(data.googlePlaceId !== undefined && { googlePlaceId: data.googlePlaceId }),
      ...(data.listingType !== undefined && { listingType: data.listingType }),
      ...(data.propertyType !== undefined && { propertyType: data.propertyType }),
      ...(data.propertySubtype !== undefined && { propertySubtype: data.propertySubtype }),
      ...(data.bedrooms !== undefined && { bedrooms: data.bedrooms }),
      ...(data.bathrooms !== undefined && { bathrooms: data.bathrooms }),
      ...(data.toilets !== undefined && { toilets: data.toilets }),
      ...(data.garages !== undefined && { garages: data.garages }),
      ...(data.landAreaSqm !== undefined && { landAreaSqm: data.landAreaSqm }),
      ...(data.floorAreaSqm !== undefined && { floorAreaSqm: data.floorAreaSqm }),
      ...(data.titleStatus !== undefined && { titleStatus: data.titleStatus }),
      ...(data.methodOfSale !== undefined && { methodOfSale: data.methodOfSale }),
      ...(data.backendSearchPriceMin !== undefined && { backendSearchPriceMin: data.backendSearchPriceMin }),
      ...(data.backendSearchPriceMax !== undefined && { backendSearchPriceMax: data.backendSearchPriceMax }),
      ...(data.buyerPriceRangeMin !== undefined && { buyerPriceRangeMin: data.buyerPriceRangeMin }),
      ...(data.buyerPriceRangeMax !== undefined && { buyerPriceRangeMax: data.buyerPriceRangeMax }),
      ...(data.buyerPriceRangeConfirmed !== undefined && { buyerPriceRangeConfirmed: data.buyerPriceRangeConfirmed }),
      ...(data.priceNzd !== undefined && { priceNzd: data.priceNzd }),
      ...(data.priceDisplay !== undefined && { priceDisplay: data.priceDisplay }),
      ...(data.listingTitle !== undefined && { listingTitle: data.listingTitle }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.imageUrls !== undefined && { imageUrls: data.imageUrls }),
      ...(data.documentUrls !== undefined && { documentUrls: data.documentUrls }),
      ...(data.features !== undefined && { features: data.features }),
      ...(data.status !== undefined && { status: data.status }),
      updatedAt: new Date(),
    })
    .where(eq(listings.id, id))
    .returning();

  res.json({ listing: updated });
});

router.delete("/listings/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;

  const [existing] = await db.select().from(listings).where(eq(listings.id, id));
  if (!existing) {
    res.status(404).json({ error: "Listing not found", code: "NOT_FOUND" });
    return;
  }
  if (existing.userId !== userId) {
    res.status(403).json({ error: "You can only delete your own listings", code: "FORBIDDEN" });
    return;
  }

  await db
    .update(listings)
    .set({ status: "paused", removedAt: new Date(), updatedAt: new Date() })
    .where(eq(listings.id, id));
  res.json({ success: true });
});

export default router;
