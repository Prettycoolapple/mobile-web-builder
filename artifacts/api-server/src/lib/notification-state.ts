import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, dmMessages, dmThreads, notificationItems } from "@workspace/db";

export type NotificationPage = "search" | "messages" | "history";

export interface NotificationSummary {
  total: number;
  pages: Record<NotificationPage, number>;
}

export interface CreateNotificationItemInput {
  userId: string;
  kind: string;
  sourceId: string;
  page: Exclude<NotificationPage, "messages">;
  title: string;
  body?: string | null;
  metadata?: unknown;
}

export async function getUnreadDmBadgeCount(userId: string): Promise<number> {
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dmMessages)
    .innerJoin(dmThreads, eq(dmThreads.id, dmMessages.threadId))
    .where(
      and(
        isNull(dmMessages.readAt),
        sql`${dmMessages.senderId} != ${userId}`,
        or(eq(dmThreads.participantA, userId), eq(dmThreads.participantB, userId)),
      ),
    );

  return count ?? 0;
}

export async function getUnreadNotificationPageCounts(userId: string): Promise<Record<"search" | "history", number>> {
  const rows = await db
    .select({
      page: notificationItems.page,
      count: sql<number>`count(*)::int`,
    })
    .from(notificationItems)
    .where(and(eq(notificationItems.userId, userId), isNull(notificationItems.readAt)))
    .groupBy(notificationItems.page);

  const counts = { search: 0, history: 0 };
  for (const row of rows) {
    if (row.page === "search" || row.page === "history") {
      counts[row.page] = row.count ?? 0;
    }
  }
  return counts;
}

export async function getUnreadAppBadgeSummary(userId: string): Promise<NotificationSummary> {
  const [messages, otherPages] = await Promise.all([
    getUnreadDmBadgeCount(userId),
    getUnreadNotificationPageCounts(userId),
  ]);

  const pages = {
    search: otherPages.search,
    messages,
    history: otherPages.history,
  };
  return {
    pages,
    total: pages.search + pages.messages + pages.history,
  };
}

export async function getUnreadAppBadgeCount(userId: string): Promise<number> {
  const summary = await getUnreadAppBadgeSummary(userId);
  return summary.total;
}

export async function createNotificationItem(input: CreateNotificationItemInput) {
  const [item] = await db
    .insert(notificationItems)
    .values({
      userId: input.userId,
      kind: input.kind,
      sourceId: input.sourceId,
      page: input.page,
      title: input.title,
      body: input.body ?? null,
      metadataJson: input.metadata ?? null,
      readAt: null,
    })
    .onConflictDoUpdate({
      target: [notificationItems.userId, notificationItems.kind, notificationItems.sourceId],
      set: {
        page: input.page,
        title: input.title,
        body: input.body ?? null,
        metadataJson: input.metadata ?? null,
        readAt: null,
        createdAt: new Date(),
      },
    })
    .returning();

  return item;
}

export async function markNotificationItemRead(userId: string, itemId: string): Promise<boolean> {
  const rows = await db
    .update(notificationItems)
    .set({ readAt: new Date() })
    .where(and(eq(notificationItems.id, itemId), eq(notificationItems.userId, userId), isNull(notificationItems.readAt)))
    .returning({ id: notificationItems.id });

  return rows.length > 0;
}

export async function markNotificationSourceRead(userId: string, kind: string, sourceId: string): Promise<boolean> {
  const rows = await db
    .update(notificationItems)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationItems.userId, userId),
        eq(notificationItems.kind, kind),
        eq(notificationItems.sourceId, sourceId),
        isNull(notificationItems.readAt),
      ),
    )
    .returning({ id: notificationItems.id });

  return rows.length > 0;
}
