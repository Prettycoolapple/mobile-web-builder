import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, watchlistItems, withDbRetry } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { normaliseAddressKey } from "../lib/address-key";
import { seedWatchlistMonitorStateFromItem } from "../lib/watchlist-monitor";

const router = Router();

/** Normalised dedup key for a property: prefer the listing URL, fall back to address. */
function propertyKeyOf(input: { propertyKey?: unknown; listingUrl?: unknown; internalListingId?: unknown; address?: unknown }): string {
  const explicit = typeof input.propertyKey === "string" ? input.propertyKey.trim() : "";
  if (explicit) return explicit.toLowerCase();
  const url = typeof input.listingUrl === "string" ? input.listingUrl.trim() : "";
  const internalListingId = typeof input.internalListingId === "string" ? input.internalListingId.trim() : "";
  const address = typeof input.address === "string" ? input.address.trim() : "";
  return (url || internalListingId || address).toLowerCase();
}

function aliasKeysOf(input: Record<string, unknown>): string[] {
  const snapshot = (input.snapshotJson ?? input.snapshot ?? null) as Record<string, unknown> | null;
  const address = str(input.address);
  const snapshotAddress = str(snapshot?.address);
  const exact = [
    str(input.propertyKey),
    str(input.listingUrl),
    str(input.internalListingId),
    str(snapshot?.propertyKey),
    str(snapshot?.listingUrl),
    str(snapshot?.internalListingId),
    address,
    snapshotAddress,
  ].map((value) => value?.toLowerCase());
  // Robust address keys collapse abbreviation/postcode/case (mirrors the mobile
  // WatchlistContext) so a card whose address is typed differently still matches
  // the saved row on remove, even when listing URL / internal id are absent.
  const robust = [normaliseAddressKey(address), normaliseAddressKey(snapshotAddress)];
  return Array.from(new Set([...exact, ...robust].filter((value): value is string => Boolean(value))));
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function publicWatchlistItem(r: typeof watchlistItems.$inferSelect) {
  return {
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
  };
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

    const items = rows.map(publicWatchlistItem);

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
    const aliases = aliasKeysOf({ ...body, propertyKey });
    const rows = await withDbRetry(() =>
      db
        .select()
        .from(watchlistItems)
        .where(eq(watchlistItems.userId, userId)),
    );
    const existing = rows.find((row) =>
      aliasKeysOf({
        propertyKey: row.propertyKey,
        listingUrl: row.listingUrl,
        address: row.address,
        snapshotJson: row.snapshotJson,
      }).some((alias) => aliases.includes(alias)),
    );

    if (existing) {
      await withDbRetry(() =>
        db
          .delete(watchlistItems)
          .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.id, existing.id))),
      );
      res.json({ watched: false, item: null, propertyKey: existing.propertyKey });
      return;
    }

    const scores = (body.scores ?? null) as Record<string, unknown> | null;
    const photoUrls = Array.isArray(body.photoUrls) ? body.photoUrls : [];
    const [inserted] = await withDbRetry(() =>
      db
        .insert(watchlistItems)
        .values({
          userId,
          propertyKey,
          address,
          listingUrl: str(body.listingUrl),
          photoUrl: str(body.photoUrl) ?? str(photoUrls[0]),
          priceDisplay: str(body.priceDisplay) ?? str(body.price),
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
        })
        .returning(),
    );
    const item = inserted ?? rows.find((row) => row.propertyKey === propertyKey) ?? null;
    if (item) {
      seedWatchlistMonitorStateFromItem({
        address: item.address,
        listingUrl: item.listingUrl,
        priceDisplay: item.priceDisplay,
        propertyType: item.propertyType,
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms,
        landAreaSqm: item.landAreaSqm,
        photoUrl: item.photoUrl,
        snapshot: item.snapshotJson,
      }).catch((err) => {
        req.log.warn({ err, propertyKey: item.propertyKey }, "Failed to seed watchlist monitor state");
      });
    }
    res.json({ watched: true, item: item ? publicWatchlistItem(item) : null, propertyKey });
  } catch (error) {
    req.log.error({ err: error }, "Failed to toggle watchlist item");
    res.status(500).json({ error: "Failed to update watchlist", code: "WATCHLIST_TOGGLE_FAILED" });
  }
});

export default router;
