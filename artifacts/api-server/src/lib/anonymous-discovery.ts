import crypto from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import {
  anonymousDiscoveryEvents,
  anonymousDiscoveryShownListings,
  anonymousUsageEvents,
  db,
  withDbRetry,
} from "@workspace/db";
import type { RecentShownListing, ShownListingInput } from "./discovery-shown-memory";

const SHOWN_WINDOW_DAYS = 30;
const USAGE_WINDOW_HOURS = 24;
const DEFAULT_GUEST_DAILY_LIMIT = 10;

export function hashAnonymousValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function getAnonymousInstallHash(headers: Record<string, unknown>): string | null {
  const raw = headers["x-anonymous-install-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return hashAnonymousValue(typeof value === "string" ? value : null);
}

export function getIpHash(req: { ip?: string; headers: Record<string, unknown> }): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = typeof forwardedValue === "string" && forwardedValue.trim()
    ? forwardedValue.split(",")[0]?.trim()
    : req.ip;
  return hashAnonymousValue(ip ?? null);
}

export function guestDailyLimit(): number {
  const parsed = Number(process.env.GUEST_DISCOVERY_DAILY_LIMIT ?? DEFAULT_GUEST_DAILY_LIMIT);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_GUEST_DAILY_LIMIT;
}

export async function checkAndRecordAnonymousUsage(args: {
  installHash: string;
  ipHash: string | null;
  eventType: string;
}): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = guestDailyLimit();
  const cutoff = new Date(Date.now() - USAGE_WINDOW_HOURS * 60 * 60 * 1000);
  const ipHash = args.ipHash;
  const [installRows, ipRows] = await Promise.all([
    withDbRetry(() =>
      db
        .select({ total: count() })
        .from(anonymousUsageEvents)
        .where(
          and(
            eq(anonymousUsageEvents.installHash, args.installHash),
            eq(anonymousUsageEvents.eventType, args.eventType),
            gte(anonymousUsageEvents.createdAt, cutoff),
          ),
        ),
    ),
    ipHash
      ? withDbRetry(() =>
          db
            .select({ total: count() })
            .from(anonymousUsageEvents)
            .where(
              and(
                eq(anonymousUsageEvents.ipHash, ipHash),
                eq(anonymousUsageEvents.eventType, args.eventType),
                gte(anonymousUsageEvents.createdAt, cutoff),
              ),
            ),
        )
      : Promise.resolve([{ total: 0 }]),
  ]);
  const used = Math.max(Number(installRows[0]?.total ?? 0), Number(ipRows[0]?.total ?? 0));
  if (used >= limit) return { allowed: false, used, limit };

  await withDbRetry(() =>
    db.insert(anonymousUsageEvents).values({
      installHash: args.installHash,
      ipHash: args.ipHash,
      eventType: args.eventType,
    }),
  );
  return { allowed: true, used: used + 1, limit };
}

export async function getRecentShownForAnonymous(
  installHash: string,
): Promise<{ addressKeys: string[]; urls: string[]; entries: RecentShownListing[] }> {
  const cutoff = new Date(Date.now() - SHOWN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await withDbRetry(() =>
    db
      .select({
        addressKey: anonymousDiscoveryShownListings.addressKey,
        listingUrl: anonymousDiscoveryShownListings.listingUrl,
        suburb: anonymousDiscoveryShownListings.suburb,
      })
      .from(anonymousDiscoveryShownListings)
      .where(
        and(
          eq(anonymousDiscoveryShownListings.installHash, installHash),
          gte(anonymousDiscoveryShownListings.shownAt, cutoff),
        ),
      )
      .limit(5000),
  );

  const addressKeys: string[] = [];
  const urls: string[] = [];
  const entries: RecentShownListing[] = [];
  for (const r of rows) {
    if (r.addressKey) addressKeys.push(r.addressKey);
    if (r.listingUrl) urls.push(r.listingUrl);
    entries.push({
      addressKey: r.addressKey,
      listingUrl: r.listingUrl,
      suburb: r.suburb,
    });
  }
  return { addressKeys, urls, entries };
}

export async function clearRecentShownForAnonymousSuburb(installHash: string, suburb: string): Promise<void> {
  const normalized = suburb.toLowerCase().trim();
  if (!normalized) return;
  await withDbRetry(() =>
    db
      .delete(anonymousDiscoveryShownListings)
      .where(
        and(
          eq(anonymousDiscoveryShownListings.installHash, installHash),
          sql`lower(coalesce(${anonymousDiscoveryShownListings.suburb}, '')) = ${normalized}`,
        ),
      ),
  );
}

export async function recordShownForAnonymous(
  installHash: string,
  items: ShownListingInput[],
): Promise<void> {
  const byKey = new Map<string, ShownListingInput>();
  for (const i of items) {
    if (i.addressKey && i.addressKey.length > 0) byKey.set(i.addressKey, i);
  }
  const values = Array.from(byKey.values()).map((i) => ({
    installHash,
    addressKey: i.addressKey,
    listingUrl: i.listingUrl ?? null,
    address: i.address ?? null,
    suburb: i.suburb ?? null,
  }));
  if (values.length === 0) return;

  await withDbRetry(() =>
    db
      .insert(anonymousDiscoveryShownListings)
      .values(values)
      .onConflictDoUpdate({
        target: [anonymousDiscoveryShownListings.installHash, anonymousDiscoveryShownListings.addressKey],
        set: {
          shownAt: new Date(),
          listingUrl: sql`coalesce(excluded.listing_url, ${anonymousDiscoveryShownListings.listingUrl})`,
          address: sql`coalesce(excluded.address, ${anonymousDiscoveryShownListings.address})`,
          suburb: sql`coalesce(excluded.suburb, ${anonymousDiscoveryShownListings.suburb})`,
        },
      }),
  );
}

export async function recordAnonymousDiscoveryEvent(args: {
  installHash: string;
  ipHash: string | null;
  mode: string;
  suburb?: string | null;
  criteria?: string | null;
  locale?: string | null;
  query?: string | null;
  resultCount: number;
}): Promise<void> {
  await withDbRetry(() =>
    db.insert(anonymousDiscoveryEvents).values({
      installHash: args.installHash,
      ipHash: args.ipHash,
      mode: args.mode,
      suburb: args.suburb ?? null,
      criteria: args.criteria ?? null,
      locale: args.locale ?? null,
      query: args.query?.slice(0, 1000) ?? null,
      resultCount: args.resultCount,
    }),
  );
}
