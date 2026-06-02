import { and, eq, gte, sql } from "drizzle-orm";
import { db, discoveryShownListings, withDbRetry } from "@workspace/db";

/** Rolling window — listings not shown to the user within this many days
 * become eligible to surface again, so the pool naturally refreshes. */
const SHOWN_WINDOW_DAYS = 30;

export interface ShownListingInput {
  addressKey: string;
  listingUrl?: string | null;
  address?: string | null;
  suburb?: string | null;
}

/**
 * Fetch the address keys + listing URLs this user has already been shown within
 * the rolling window. Used to seed the discovery dedup set so a brand-new
 * conversation doesn't restart from property #1.
 */
export async function getRecentShownForUser(
  userId: string,
): Promise<{ addressKeys: string[]; urls: string[] }> {
  const cutoff = new Date(Date.now() - SHOWN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await withDbRetry(() =>
    db
      .select({
        addressKey: discoveryShownListings.addressKey,
        listingUrl: discoveryShownListings.listingUrl,
      })
      .from(discoveryShownListings)
      .where(
        and(
          eq(discoveryShownListings.userId, userId),
          gte(discoveryShownListings.shownAt, cutoff),
        ),
      )
      .limit(5000),
  );

  const addressKeys: string[] = [];
  const urls: string[] = [];
  for (const r of rows) {
    if (r.addressKey) addressKeys.push(r.addressKey);
    if (r.listingUrl) urls.push(r.listingUrl);
  }
  return { addressKeys, urls };
}

/**
 * Record the listings shown to a user in this discovery turn. Idempotent per
 * (user, addressKey): re-showing refreshes `shownAt` (and back-fills url/address
 * if they were missing before), keeping the listing inside the 30-day window.
 *
 * Best-effort: callers should fire this after the response (runAfterResponse)
 * and never block the user-facing path on it.
 */
export async function recordShownForUser(
  userId: string,
  items: ShownListingInput[],
): Promise<void> {
  // Dedupe by addressKey within the batch — Postgres rejects an INSERT whose
  // ON CONFLICT target matches the same row twice ("cannot affect row a second
  // time"), which would fail the whole batch.
  const byKey = new Map<string, ShownListingInput>();
  for (const i of items) {
    if (i.addressKey && i.addressKey.length > 0) byKey.set(i.addressKey, i);
  }
  const values = Array.from(byKey.values()).map((i) => ({
    userId,
    addressKey: i.addressKey,
    listingUrl: i.listingUrl ?? null,
    address: i.address ?? null,
    suburb: i.suburb ?? null,
  }));
  if (values.length === 0) return;

  await withDbRetry(() =>
    db
      .insert(discoveryShownListings)
      .values(values)
      .onConflictDoUpdate({
        target: [discoveryShownListings.userId, discoveryShownListings.addressKey],
        set: {
          shownAt: new Date(),
          listingUrl: sql`coalesce(excluded.listing_url, ${discoveryShownListings.listingUrl})`,
          address: sql`coalesce(excluded.address, ${discoveryShownListings.address})`,
          suburb: sql`coalesce(excluded.suburb, ${discoveryShownListings.suburb})`,
        },
      }),
  );
}
