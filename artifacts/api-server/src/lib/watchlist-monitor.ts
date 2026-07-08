import crypto from "node:crypto";
import { desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  watchlistItems,
  watchlistMonitorRuns,
  watchlistPropertyEvents,
  watchlistPropertyStates,
  withDbRetry,
  type WatchlistPropertyState,
} from "@workspace/db";
import { normaliseAddressKey } from "./address-key";
import { logger } from "./logger";
import { fetchWithScrapingBee } from "./scrapers/scrapingbee";
import { parseArea, parseNZDollar } from "./scrapers/scraper-parsers";
import { extractBedsBaths } from "./scrapers/bed-bath-extractor";
import { resolveActiveListingContext } from "./active-listing-context";
import { createNotificationItem, getUnreadAppBadgeCount } from "./notification-state";
import { sendPushToUser } from "./expo-push";

type ListingStatus = "active" | "sold" | "off_market" | "unknown";
type ChangeType = "price_changed" | "sold" | "off_market" | "relisted" | "listing_changed";

interface WatchlistSeedInput {
  address: string;
  listingUrl?: string | null;
  priceDisplay?: string | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  landAreaSqm?: number | null;
  photoUrl?: string | null;
  snapshot?: unknown;
}

interface WatchTarget {
  monitorKey: string;
  address: string;
  latestItem: WatchlistSeedInput;
  userIds: string[];
  state: WatchlistPropertyState;
}

interface ListingSnapshot {
  monitorKey: string;
  address: string;
  listingUrl: string | null;
  source: string | null;
  status: ListingStatus;
  priceNzd: number | null;
  priceDisplay: string | null;
  propertyType: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  landAreaSqm: number | null;
  photoUrl: string | null;
  fingerprint: string;
  raw: Record<string, unknown>;
}

interface MonitorResult {
  runId: string;
  targetsTotal: number;
  targetsChecked: number;
  changesDetected: number;
  notificationsSent: number;
  failures: number;
}

function asPositiveInt(value: string | undefined, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function intervalHours(): number {
  return asPositiveInt(process.env.WATCHLIST_MONITOR_INTERVAL_HOURS, 24, 168);
}

function nextCheckDate(now = new Date()): Date {
  return new Date(now.getTime() + intervalHours() * 60 * 60 * 1000);
}

function sourceFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.includes("realestate.co.nz")) return "realestate.co.nz";
    if (host.includes("oneroof.co.nz")) return "oneroof";
    if (host.includes("hougarden.com")) return "hougarden";
    if (host.includes("trademe.co.nz")) return "trademe";
    if (host.includes("homes.co.nz")) return "homes";
    return host;
  } catch {
    return null;
  }
}

function finiteInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Math.round(Number(value));
  return null;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMetaImage(html: string): string | null {
  const raw =
    html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ??
    null;
  return raw?.startsWith("http") ? raw : null;
}

function normalizePriceDisplay(value: string | null): string | null {
  if (!value) return null;
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function extractPrice(text: string, status: ListingStatus): { priceNzd: number | null; priceDisplay: string | null } {
  const labelled =
    text.match(/(?:asking price|asking|enquiries over|buyer enquiry over|offers over|sale price|sold for|price)\s*[:\s]*([$]?\s?[\d,.]+(?:\s?[mk])?)/i)?.[1] ??
    null;
  const fallback = labelled ?? text.match(/\$[ ]?[\d,.]+(?:\s?[mk])?/i)?.[0] ?? null;
  const priceNzd = fallback ? parseNZDollar(fallback) : null;
  if (priceNzd) return { priceNzd, priceDisplay: `$${priceNzd.toLocaleString("en-NZ")}` };

  const method =
    text.match(/\b(price by negotiation|by negotiation|deadline sale|tender|auction|price on application|poa)\b/i)?.[1] ??
    null;
  if (method) return { priceNzd: null, priceDisplay: method };
  if (status === "sold") return { priceNzd: null, priceDisplay: "Sold" };
  return { priceNzd: null, priceDisplay: null };
}

function extractLandArea(text: string): number | null {
  const raw =
    text.match(/(?:land area|land size|section|site area)\s*[:\s]*([\d,.]+\s*m(?:2|\u00b2)?)/i)?.[1] ??
    text.match(/([\d,.]+\s*m(?:2|\u00b2)?)\s*(?:land|section|site)/i)?.[1] ??
    null;
  return raw ? parseArea(raw) : null;
}

function extractPropertyType(text: string): string | null {
  const match = text.match(/\b(house|townhouse|apartment|unit|section|lifestyle|home and income|terrace)\b/i);
  if (!match) return null;
  return match[1].replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferStatus(text: string, url: string): ListingStatus {
  const lower = text.toLowerCase();
  if (/\b(recently sold|sold for|sold by|property sold|has sold|settled)\b/i.test(text)) return "sold";
  if (/\b(no longer available|listing withdrawn|listing removed|property not found|page not found|404|expired listing|off market)\b/i.test(text)) {
    return "off_market";
  }
  if (/\b(for sale|asking price|enquire now|make an enquiry|request a viewing|open home|price on application|by negotiation|auction)\b/i.test(text)) {
    return "active";
  }
  if (/\/sale\/|for-sale|\/find\/buy|\/property\//i.test(url) && /\$|bed|bath|land|enquire|agent/i.test(lower)) {
    return "active";
  }
  return "unknown";
}

function hashSnapshot(snapshot: Omit<ListingSnapshot, "fingerprint">): string {
  const material = {
    status: snapshot.status,
    priceNzd: snapshot.priceNzd,
    priceDisplay: normalizePriceDisplay(snapshot.priceDisplay),
    listingUrl: snapshot.listingUrl?.toLowerCase() ?? null,
    source: snapshot.source,
  };
  return crypto.createHash("sha256").update(JSON.stringify(material)).digest("hex").slice(0, 24);
}

function finalizeSnapshot(snapshot: Omit<ListingSnapshot, "fingerprint">): ListingSnapshot {
  const fingerprint = hashSnapshot(snapshot);
  return {
    ...snapshot,
    fingerprint,
    raw: { ...snapshot.raw, fingerprint },
  };
}

function snapshotFromSeed(input: WatchlistSeedInput): ListingSnapshot | null {
  const monitorKey = normaliseAddressKey(input.address);
  if (!monitorKey) return null;
  const source = sourceFromUrl(input.listingUrl);
  const priceNzd =
    finiteInt((input.snapshot as { price?: unknown } | null)?.price) ??
    (input.priceDisplay ? parseNZDollar(input.priceDisplay) : null);
  return finalizeSnapshot({
    monitorKey,
    address: input.address,
    listingUrl: input.listingUrl ?? null,
    source,
    status: input.listingUrl ? "active" : "unknown",
    priceNzd,
    priceDisplay: input.priceDisplay ?? (priceNzd ? `$${priceNzd.toLocaleString("en-NZ")}` : null),
    propertyType: input.propertyType ?? null,
    bedrooms: input.bedrooms ?? null,
    bathrooms: input.bathrooms ?? null,
    landAreaSqm: input.landAreaSqm ?? null,
    photoUrl: input.photoUrl ?? null,
    raw: { seededFromWatchlist: true, snapshot: input.snapshot ?? null },
  });
}

function snapshotFromHtml(args: { address: string; monitorKey: string; listingUrl: string; html: string }): ListingSnapshot {
  const text = stripHtmlToText(args.html);
  const status = inferStatus(text, args.listingUrl);
  const bedsBaths = extractBedsBaths(text);
  const price = extractPrice(text, status);
  return finalizeSnapshot({
    monitorKey: args.monitorKey,
    address: args.address,
    listingUrl: args.listingUrl,
    source: sourceFromUrl(args.listingUrl),
    status,
    priceNzd: price.priceNzd,
    priceDisplay: price.priceDisplay,
    propertyType: extractPropertyType(text),
    bedrooms: bedsBaths.bedrooms,
    bathrooms: bedsBaths.bathrooms,
    landAreaSqm: extractLandArea(text),
    photoUrl: extractMetaImage(args.html),
    raw: {
      checkedUrl: args.listingUrl,
      textSample: text.slice(0, 1200),
    },
  });
}

async function fetchSnapshotFromUrl(address: string, monitorKey: string, listingUrl: string): Promise<ListingSnapshot | null> {
  if (!/^https?:\/\//i.test(listingUrl)) return null;
  const attempts = [
    { wait: 3000, premium_proxy: false },
    { wait: 5000, premium_proxy: true },
  ];
  for (const attempt of attempts) {
    const html = await fetchWithScrapingBee(listingUrl, {
      render_js: true,
      wait: attempt.wait,
      premium_proxy: attempt.premium_proxy,
    }).catch(() => null);
    if (!html || html.length < 500) continue;
    return snapshotFromHtml({ address, monitorKey, listingUrl, html });
  }
  return null;
}

async function fetchSnapshotFromAddress(address: string, monitorKey: string): Promise<ListingSnapshot | null> {
  const resolved = await resolveActiveListingContext(address, { purpose: "agent_contact" }).catch(() => null);
  const ctx = resolved?.context;
  if (!ctx || !ctx.isActiveListing) return null;
  const priceNzd = finiteInt(ctx.price);
  return finalizeSnapshot({
    monitorKey,
    address,
    listingUrl: ctx.listingUrl ?? null,
    source: ctx.source ?? sourceFromUrl(ctx.listingUrl),
    status: "active",
    priceNzd,
    priceDisplay: priceNzd ? `$${priceNzd.toLocaleString("en-NZ")}` : null,
    propertyType: ctx.propertyType ?? null,
    bedrooms: finiteInt(ctx.bedrooms),
    bathrooms: finiteInt(ctx.bathrooms),
    landAreaSqm: finiteInt(ctx.landArea),
    photoUrl: ctx.photoUrl ?? ctx.photoUrls?.[0] ?? null,
    raw: { resolvedFromAddress: true, context: ctx },
  });
}

async function fetchLatestSnapshot(target: WatchTarget): Promise<ListingSnapshot | null> {
  const listingUrl = target.state.listingUrl ?? target.latestItem.listingUrl ?? null;
  if (listingUrl) {
    const direct = await fetchSnapshotFromUrl(target.address, target.monitorKey, listingUrl);
    if (direct && direct.status !== "unknown") return direct;
    const fallback = await fetchSnapshotFromAddress(target.address, target.monitorKey);
    if (fallback) return fallback;
    return null;
  }
  return fetchSnapshotFromAddress(target.address, target.monitorKey);
}

function stateToSnapshot(state: WatchlistPropertyState): ListingSnapshot | null {
  if (!state.rawFingerprint) return null;
  return {
    monitorKey: state.monitorKey,
    address: state.address,
    listingUrl: state.listingUrl,
    source: state.source,
    status: state.status as ListingStatus,
    priceNzd: state.priceNzd,
    priceDisplay: state.priceDisplay,
    propertyType: state.propertyType,
    bedrooms: state.bedrooms,
    bathrooms: state.bathrooms,
    landAreaSqm: state.landAreaSqm,
    photoUrl: state.photoUrl,
    fingerprint: state.rawFingerprint,
    raw: (state.rawJson as Record<string, unknown> | null) ?? {},
  };
}

function priceChanged(previous: ListingSnapshot, current: ListingSnapshot): boolean {
  if (current.priceNzd == null && !normalizePriceDisplay(current.priceDisplay)) return false;
  if (previous.priceNzd != null && current.priceNzd != null) return previous.priceNzd !== current.priceNzd;
  return normalizePriceDisplay(previous.priceDisplay) !== normalizePriceDisplay(current.priceDisplay);
}

function detectChange(previous: ListingSnapshot | null, current: ListingSnapshot): ChangeType | null {
  if (!previous || !previous.fingerprint || previous.fingerprint === current.fingerprint) return null;
  if ((previous.status === "sold" || previous.status === "off_market") && current.status === "active") return "relisted";
  if (previous.status !== "sold" && current.status === "sold") return "sold";
  if (previous.status !== "off_market" && current.status === "off_market") return "off_market";
  if (
    previous.status === "active" &&
    current.status === "active" &&
    previous.listingUrl &&
    current.listingUrl &&
    previous.listingUrl !== current.listingUrl
  ) {
    return "listing_changed";
  }
  if (previous.status === "active" && current.status === "active" && priceChanged(previous, current)) return "price_changed";
  return null;
}

function notificationCopy(changeType: ChangeType, previous: ListingSnapshot | null, current: ListingSnapshot): { title: string; body: string } {
  const shortAddress = current.address.split(",")[0]?.trim() || current.address;
  switch (changeType) {
    case "price_changed":
      return {
        title: `Price changed for ${shortAddress}`,
        body: `${previous?.priceDisplay ?? "Previous price"} -> ${current.priceDisplay ?? "new price available"}`,
      };
    case "sold":
      return {
        title: `${shortAddress} appears to be sold`,
        body: current.priceDisplay ? `Sale price/status: ${current.priceDisplay}` : "A property in your watchlist appears to be sold.",
      };
    case "off_market":
      return {
        title: `${shortAddress} is no longer listed`,
        body: "A property in your watchlist appears to be off market.",
      };
    case "relisted":
      return {
        title: `${shortAddress} is back on the market`,
        body: current.priceDisplay ? `Current price/status: ${current.priceDisplay}` : "A watched property appears to be active again.",
      };
    case "listing_changed":
      return {
        title: `Listing changed for ${shortAddress}`,
        body: "A watched property appears to have a new listing page.",
      };
  }
}

async function insertEvent(changeType: ChangeType, previous: ListingSnapshot | null, current: ListingSnapshot) {
  const copy = notificationCopy(changeType, previous, current);
  const [event] = await db
    .insert(watchlistPropertyEvents)
    .values({
      monitorKey: current.monitorKey,
      changeType,
      address: current.address,
      previousJson: previous ? { ...previous.raw, snapshot: previous } : null,
      currentJson: { ...current.raw, snapshot: current },
      title: copy.title,
      body: copy.body,
    })
    .returning();
  return event;
}

async function notifyWatchers(target: WatchTarget, event: Awaited<ReturnType<typeof insertEvent>>): Promise<number> {
  let sent = 0;
  for (const userId of target.userIds) {
    try {
      await createNotificationItem({
        userId,
        kind: "watchlist_property_change",
        sourceId: event.id,
        page: "history",
        title: event.title,
        body: event.body,
        metadata: {
          eventId: event.id,
          monitorKey: event.monitorKey,
          changeType: event.changeType,
          address: event.address,
        },
      });
      const badgeCount = await getUnreadAppBadgeCount(userId);
      await sendPushToUser(
        userId,
        event.title,
        event.body,
        {
          type: "watchlist_change",
          eventId: event.id,
          monitorKey: event.monitorKey,
        },
        { badgeCount },
      );
      sent += 1;
    } catch (err) {
      logger.warn({ err, userId, eventId: event.id }, "watchlist monitor notification failed");
    }
  }
  return sent;
}

async function writeSnapshotState(current: ListingSnapshot, previous: ListingSnapshot | null, changed: boolean): Promise<void> {
  const setValues: Partial<typeof watchlistPropertyStates.$inferInsert> = {
    address: current.address,
    listingUrl: current.listingUrl,
    source: current.source,
    status: current.status,
    priceNzd: current.priceNzd,
    priceDisplay: current.priceDisplay,
    propertyType: current.propertyType,
    bedrooms: current.bedrooms,
    bathrooms: current.bathrooms,
    landAreaSqm: current.landAreaSqm,
    photoUrl: current.photoUrl,
    rawFingerprint: current.fingerprint,
    rawJson: current.raw,
    consecutiveFailures: 0,
    pendingOffMarketSince: null,
    lastCheckedAt: new Date(),
    nextCheckAfter: nextCheckDate(),
    updatedAt: new Date(),
  };
  if (changed) {
    setValues.lastChangedAt = new Date();
  } else if (!previous) {
    setValues.lastChangedAt = null;
  }

  await db
    .update(watchlistPropertyStates)
    .set(setValues)
    .where(eq(watchlistPropertyStates.monitorKey, current.monitorKey));
}

async function handleWeakFailure(target: WatchTarget): Promise<{ checked: number; changes: number; notifications: number; failures: number }> {
  const failures = target.state.consecutiveFailures + 1;
  const previous = stateToSnapshot(target.state);
  const shouldMarkOffMarket = previous?.status === "active" && failures >= 2;
  if (!shouldMarkOffMarket || !previous) {
    await db
      .update(watchlistPropertyStates)
      .set({
        consecutiveFailures: failures,
        pendingOffMarketSince: target.state.pendingOffMarketSince ?? new Date(),
        lastCheckedAt: new Date(),
        nextCheckAfter: nextCheckDate(),
        updatedAt: new Date(),
      })
      .where(eq(watchlistPropertyStates.monitorKey, target.monitorKey));
    return { checked: 1, changes: 0, notifications: 0, failures: 1 };
  }

  const current = finalizeSnapshot({
    ...previous,
    status: "off_market",
    raw: { ...previous.raw, inferredAfterConsecutiveFailures: failures },
  });
  const event = await insertEvent("off_market", previous, current);
  await writeSnapshotState(current, previous, true);
  const notifications = await notifyWatchers(target, event);
  return { checked: 1, changes: 1, notifications, failures: 1 };
}

async function processTarget(target: WatchTarget): Promise<{ checked: number; changes: number; notifications: number; failures: number }> {
  const current = await fetchLatestSnapshot(target);
  if (!current) return handleWeakFailure(target);

  const previous = stateToSnapshot(target.state);
  const changeType = detectChange(previous, current);
  let notifications = 0;
  if (changeType) {
    const event = await insertEvent(changeType, previous, current);
    notifications = await notifyWatchers(target, event);
  }
  await writeSnapshotState(current, previous, Boolean(changeType));
  return { checked: 1, changes: changeType ? 1 : 0, notifications, failures: 0 };
}

export async function seedWatchlistMonitorStateFromItem(input: WatchlistSeedInput): Promise<void> {
  const snapshot = snapshotFromSeed(input);
  if (!snapshot) return;
  await withDbRetry(() =>
    db
      .insert(watchlistPropertyStates)
      .values({
        monitorKey: snapshot.monitorKey,
        address: snapshot.address,
        listingUrl: snapshot.listingUrl,
        source: snapshot.source,
        status: snapshot.status,
        priceNzd: snapshot.priceNzd,
        priceDisplay: snapshot.priceDisplay,
        propertyType: snapshot.propertyType,
        bedrooms: snapshot.bedrooms,
        bathrooms: snapshot.bathrooms,
        landAreaSqm: snapshot.landAreaSqm,
        photoUrl: snapshot.photoUrl,
        rawFingerprint: snapshot.fingerprint,
        rawJson: snapshot.raw,
        nextCheckAfter: new Date(),
      })
      .onConflictDoNothing({ target: watchlistPropertyStates.monitorKey }),
  );
}

async function loadTargets(maxTargets: number): Promise<WatchTarget[]> {
  const rows = await withDbRetry(() =>
    db
      .select({
        userId: watchlistItems.userId,
        address: watchlistItems.address,
        listingUrl: watchlistItems.listingUrl,
        priceDisplay: watchlistItems.priceDisplay,
        propertyType: watchlistItems.propertyType,
        bedrooms: watchlistItems.bedrooms,
        bathrooms: watchlistItems.bathrooms,
        landAreaSqm: watchlistItems.landAreaSqm,
        photoUrl: watchlistItems.photoUrl,
        snapshot: watchlistItems.snapshotJson,
        createdAt: watchlistItems.createdAt,
      })
      .from(watchlistItems)
      .orderBy(desc(watchlistItems.createdAt)),
  );

  const grouped = new Map<string, { latestItem: WatchlistSeedInput; userIds: Set<string> }>();
  for (const row of rows) {
    const monitorKey = normaliseAddressKey(row.address);
    if (!monitorKey) continue;
    const existing = grouped.get(monitorKey);
    if (!existing) {
      grouped.set(monitorKey, {
        latestItem: {
          address: row.address,
          listingUrl: row.listingUrl,
          priceDisplay: row.priceDisplay,
          propertyType: row.propertyType,
          bedrooms: row.bedrooms,
          bathrooms: row.bathrooms,
          landAreaSqm: row.landAreaSqm,
          photoUrl: row.photoUrl,
          snapshot: row.snapshot,
        },
        userIds: new Set([row.userId]),
      });
    } else {
      existing.userIds.add(row.userId);
      if (!existing.latestItem.listingUrl && row.listingUrl) existing.latestItem.listingUrl = row.listingUrl;
    }
  }

  const keys = Array.from(grouped.keys());
  if (keys.length === 0) return [];
  const states = await withDbRetry(() =>
    db.select().from(watchlistPropertyStates).where(inArray(watchlistPropertyStates.monitorKey, keys)),
  );
  const statesByKey = new Map(states.map((state) => [state.monitorKey, state]));

  const now = Date.now();
  const due: WatchTarget[] = [];
  for (const [monitorKey, group] of grouped.entries()) {
    const state = statesByKey.get(monitorKey);
    if (!state) {
      await seedWatchlistMonitorStateFromItem(group.latestItem);
      continue;
    }
    if (state.nextCheckAfter && state.nextCheckAfter.getTime() > now) continue;
    due.push({
      monitorKey,
      address: state.address || group.latestItem.address,
      latestItem: group.latestItem,
      userIds: Array.from(group.userIds),
      state,
    });
  }

  due.sort((a, b) => {
    const aTime = a.state.lastCheckedAt?.getTime() ?? 0;
    const bTime = b.state.lastCheckedAt?.getTime() ?? 0;
    return aTime - bTime;
  });
  return due.slice(0, maxTargets);
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await worker(item);
    }
  });
  await Promise.all(workers);
}

export async function runWatchlistMonitor(): Promise<MonitorResult> {
  const [run] = await db.insert(watchlistMonitorRuns).values({ status: "running" }).returning();
  const maxTargets = asPositiveInt(process.env.WATCHLIST_MONITOR_MAX_TARGETS, 500, 2000);
  const concurrency = asPositiveInt(process.env.WATCHLIST_MONITOR_CONCURRENCY, 2, 10);
  let targetsTotal = 0;
  let targetsChecked = 0;
  let changesDetected = 0;
  let notificationsSent = 0;
  let failures = 0;

  try {
    const targets = await loadTargets(maxTargets);
    targetsTotal = targets.length;
    await db
      .update(watchlistMonitorRuns)
      .set({ targetsTotal })
      .where(eq(watchlistMonitorRuns.id, run.id));

    await runWithConcurrency(targets, concurrency, async (target) => {
      try {
        const result = await processTarget(target);
        targetsChecked += result.checked;
        changesDetected += result.changes;
        notificationsSent += result.notifications;
        failures += result.failures;
      } catch (err) {
        failures += 1;
        logger.warn({ err, monitorKey: target.monitorKey }, "watchlist monitor target failed");
      }
    });

    await db
      .update(watchlistMonitorRuns)
      .set({
        status: "completed",
        finishedAt: new Date(),
        targetsChecked,
        changesDetected,
        notificationsSent,
        failures,
      })
      .where(eq(watchlistMonitorRuns.id, run.id));
  } catch (err) {
    await db
      .update(watchlistMonitorRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        targetsChecked,
        changesDetected,
        notificationsSent,
        failures,
        lastError: err instanceof Error ? err.message : String(err),
      })
      .where(eq(watchlistMonitorRuns.id, run.id));
    throw err;
  }

  return {
    runId: run.id,
    targetsTotal,
    targetsChecked,
    changesDetected,
    notificationsSent,
    failures,
  };
}

export async function getWatchlistMonitorAdminStatus() {
  const [latestRun] = await db.select().from(watchlistMonitorRuns).orderBy(desc(watchlistMonitorRuns.startedAt)).limit(1);
  const [counts] = await db.execute<{
    state_count: string;
    due_count: string;
    watched_count: string;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::text FROM watchlist_property_states) AS state_count,
      (SELECT COUNT(*)::text FROM watchlist_property_states WHERE next_check_after IS NULL OR next_check_after <= now()) AS due_count,
      (SELECT COUNT(DISTINCT user_id || ':' || property_key)::text FROM watchlist_items) AS watched_count
  `).then((result) => ((result as any).rows ?? result));
  return {
    latestRun: latestRun ?? null,
    stateCount: Number(counts?.state_count ?? 0),
    dueCount: Number(counts?.due_count ?? 0),
    watchedCount: Number(counts?.watched_count ?? 0),
  };
}
