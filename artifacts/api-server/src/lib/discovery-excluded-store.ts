import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, discoveryContinuations, withDbRetry, type DiscoveryContinuationState } from "@workspace/db";

export type ExcludedNonFreeholdItem = NonNullable<DiscoveryContinuationState["excludedNonFreehold"]>[number];

/** How long a persisted excluded-listing set stays available for an "include
 *  them" reply. Generous so the user can come back to the offer later. */
const EXCLUDED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Durably persist the non-freehold listings dropped this turn, keyed (loosely)
 * by owner + suburb, so a later "include them" reply can re-screen them even on
 * a different serverless instance. Writes a lightweight carrier row in the
 * existing discovery_continuations table (exhausted=true so the paging machinery
 * ignores it); the loader simply reads back `state.excludedNonFreehold`.
 *
 * Best-effort — call via runAfterResponse; never block the user path on it.
 */
export async function persistExcludedNonFreehold(args: {
  ownerKey: string | null;
  suburb: string | null;
  cacheKey: string | null;
  items: ExcludedNonFreeholdItem[];
}): Promise<void> {
  if (!args.ownerKey || !args.suburb || args.items.length === 0) return;
  await withDbRetry(() =>
    db.insert(discoveryContinuations).values({
      id: randomUUID(),
      ownerKey: args.ownerKey,
      searchPresentation: "scored_screening",
      suburb: args.suburb,
      minPrice: null,
      maxPrice: null,
      cacheKey: args.cacheKey,
      state: { excludedNonFreehold: args.items } satisfies DiscoveryContinuationState,
      exhausted: true,
      expiresAt: new Date(Date.now() + EXCLUDED_TTL_MS),
    }),
  );
}

/**
 * Load the non-freehold listings (cross-lease / leasehold / unit-title) that a
 * recent discovery turn dropped for this owner + suburb, persisted in the
 * continuation row's `state.excludedNonFreehold`. Used by the "include them"
 * opt-in to re-screen exactly those listings with the tenure waiver — durably,
 * so it works even when the offer turn and the opt-in turn land on different
 * serverless instances (an in-memory stash would be empty on the second one).
 *
 * Returns the items from the most recent non-expired row that actually carries
 * any (rows are written newest-first; we skip empty ones).
 */
export async function loadExcludedNonFreehold(
  ownerKey: string | null,
  suburb: string | null,
): Promise<ExcludedNonFreeholdItem[]> {
  if (!ownerKey || !suburb) return [];
  const normalized = suburb.toLowerCase().trim();
  if (!normalized) return [];
  const rows = await withDbRetry(() =>
    db
      .select({ state: discoveryContinuations.state })
      .from(discoveryContinuations)
      .where(
        and(
          eq(discoveryContinuations.ownerKey, ownerKey),
          gt(discoveryContinuations.expiresAt, new Date()),
          sql`lower(coalesce(${discoveryContinuations.suburb}, '')) = ${normalized}`,
        ),
      )
      .orderBy(desc(discoveryContinuations.createdAt))
      .limit(10),
  ).catch(() => [] as Array<{ state: DiscoveryContinuationState }>);

  for (const row of rows) {
    const items = row.state?.excludedNonFreehold;
    if (Array.isArray(items) && items.length > 0) return items;
  }
  return [];
}
