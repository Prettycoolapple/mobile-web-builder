import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, watchlistItems, withDbRetry } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

/** Normalised dedup key for a property: prefer the listing URL, fall back to address. */
function propertyKeyOf(input: { propertyKey?: unknown; listingUrl?: unknown; address?: unknown }): string {
  const explicit = typeof input.propertyKey === "string" ? input.propertyKey.trim() : "";
  if (explicit) return explicit.toLowerCase();
  const url = typeof input.listingUrl === "string" ? input.listingUrl.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  return (url || address).toLowerCase();
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

router.get("/watchlist", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const rows = await withDbRetry(() =>
      db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, userId))
        .orderBy(desc(watchlistItems.createdAt)),
    );

    const items = rows.map((r) => ({
      id: r.id,
      propertyKey: r.propertyKey,
      address: r.address,
      listingUrl: r.listingUrl,
      photoUrl: r.photoUrl,
      priceDisplay: r.priceDisplay,
      propertyType: r.propertyType,
      bedrooms: r.bedrooms,
      bathrooms: r.bathrooms,
      landAreaSqm: r.landAreaSqm,
      zone: r.zone,
      compositeScore: r.compositeScore,
      snapshot: r.snapshotJson,
      createdAt: r.createdAt,
    }));

    res.json({ items });
  } catch (error) {
    req.log.error({ err: error }, "Failed to get watchlist");
    res.status(500).json({ error: "Failed to get watchlist", code: "WATCHLIST_FAILED" });
  }
});

/**
 * Toggle a property in the user's watchlist. Body is a candidate snapshot
 * (the PropertyCandidate shape) plus an optional pre-computed `propertyKey`.
 * Returns `{ watched }` reflecting the new state.
 */
router.post("/watchlist/toggle", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const body = (req.body ?? {}) as Record<string, unknown>;

  const propertyKey = propertyKeyOf(body);
  const address = str(body.address);
  if (!propertyKey || !address) {
    res.status(400).json({ error: "address is required", code: "INVALID_WATCHLIST_ITEM" });
    return;
  }

  try {
    const [existing] = await withDbRetry(() =>
      db
        .select({ id: watchlistItems.id })
        .from(watchlistItems)
        .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.propertyKey, propertyKey)))
        .limit(1),
    );

    if (existing) {
      await withDbRetry(() =>
        db
          .delete(watchlistItems)
          .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.propertyKey, propertyKey))),
      );
      res.json({ watched: false });
      return;
    }

    const scores = (body.scores ?? null) as Record<string, unknown> | null;
    await withDbRetry(() =>
      db
        .insert(watchlistItems)
        .values({
          userId,
          propertyKey,
          address,
          listingUrl: str(body.listingUrl),
          photoUrl: str(body.photoUrl),
          priceDisplay: str(body.price) ?? str(body.priceDisplay),
          propertyType: str(body.propertyType),
          bedrooms: num(body.bedrooms),
          bathrooms: num(body.bathrooms),
          landAreaSqm: num(body.landArea) ?? num(body.landAreaSqm),
          zone: str(body.zone),
          compositeScore: num(scores?.composite),
          snapshotJson: body,
        })
        // Concurrent double-tap safety: the unique (user, propertyKey) index
        // means a racing insert is a no-op rather than an error.
        .onConflictDoNothing({
          target: [watchlistItems.userId, watchlistItems.propertyKey],
        }),
    );
    res.json({ watched: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to toggle watchlist item");
    res.status(500).json({ error: "Failed to update watchlist", code: "WATCHLIST_TOGGLE_FAILED" });
  }
});

export default router;
