import { Router, type IRouter, type Request, type Response } from "express";
import { eq, or, and, desc, lt, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  profiles,
  salesAgentProfiles,
  serviceProviderProfiles,
  dmThreads,
  dmMessages,
  pushTokens,
  recommendations,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getIo } from "../lib/socket";
import { sendPushToUser } from "../lib/expo-push";

const router: IRouter = Router();

router.get("/dm/contacts", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  try {
    const agents = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        agencyName: salesAgentProfiles.agencyName,
        bio: salesAgentProfiles.bio,
      })
      .from(profiles)
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, profiles.id))
      .where(and(eq(profiles.role, "sales_agent"), sql`${profiles.id} != ${userId}`));

    const providers = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        role: profiles.role,
        companyName: serviceProviderProfiles.companyName,
        discipline: serviceProviderProfiles.discipline,
      })
      .from(profiles)
      .leftJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
      .where(and(eq(profiles.role, "service_provider"), sql`${profiles.id} != ${userId}`));

    const contacts = [
      ...agents.map((a) => ({
        id: a.id,
        fullName: a.fullName,
        role: a.role,
        subtitle: a.agencyName ?? null,
        bio: a.bio ?? null,
        avatarUrl: null,
      })),
      ...providers.map((p) => ({
        id: p.id,
        fullName: p.fullName,
        role: p.role,
        subtitle: p.companyName ?? p.discipline ?? null,
        bio: null,
        avatarUrl: null,
      })),
    ];

    res.json({ contacts });
  } catch (err) {
    req.log.error({ err }, "GET /dm/contacts failed");
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

router.post("/dm/threads", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { targetUserId } = req.body as { targetUserId?: string };

  if (!targetUserId) {
    res.status(400).json({ error: "targetUserId is required" });
    return;
  }

  if (targetUserId === userId) {
    res.status(400).json({ error: "Cannot start a thread with yourself" });
    return;
  }

  try {
    // Enforce paid-tier rule: a general user can only initiate a thread with a
    // service provider if they're on standard or pro. Sales agents and
    // providers can always initiate, and any user can DM another general user.
    const [me, target] = await Promise.all([
      db.select({ role: profiles.role, subscriptionTier: profiles.subscriptionTier })
        .from(profiles).where(eq(profiles.id, userId)).limit(1),
      db.select({ role: profiles.role })
        .from(profiles).where(eq(profiles.id, targetUserId)).limit(1),
    ]);
    const meRow = me[0];
    const targetRow = target[0];
    if (!meRow || !targetRow) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (meRow.role === "general" && targetRow.role === "service_provider") {
      const tier = meRow.subscriptionTier ?? "free";
      if (tier !== "standard" && tier !== "pro") {
        res.status(402).json({ error: "Upgrade required", upgradeRequired: true });
        return;
      }
    }

    const [canonA, canonB] = [userId, targetUserId].sort();

    const existing = await db
      .select()
      .from(dmThreads)
      .where(
        and(eq(dmThreads.participantA, canonA), eq(dmThreads.participantB, canonB)),
      )
      .limit(1);

    if (existing.length > 0) {
      res.json({ thread: existing[0] });
      return;
    }

    const [thread] = await db
      .insert(dmThreads)
      .values({ participantA: canonA, participantB: canonB })
      .onConflictDoNothing()
      .returning();

    if (!thread) {
      const [found] = await db
        .select()
        .from(dmThreads)
        .where(
          and(eq(dmThreads.participantA, canonA), eq(dmThreads.participantB, canonB)),
        )
        .limit(1);
      res.json({ thread: found });
      return;
    }

    res.status(201).json({ thread });
  } catch (err) {
    req.log.error({ err }, "POST /dm/threads failed");
    res.status(500).json({ error: "Failed to create thread" });
  }
});

router.get("/dm/threads", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  try {
    const threads = await db
      .select()
      .from(dmThreads)
      .where(
        or(eq(dmThreads.participantA, userId), eq(dmThreads.participantB, userId)),
      )
      .orderBy(desc(dmThreads.lastMessageAt));

    const enriched = await Promise.all(
      threads.map(async (thread) => {
        const otherId =
          thread.participantA === userId ? thread.participantB : thread.participantA;

        const [other] = await db
          .select({ id: profiles.id, fullName: profiles.fullName, role: profiles.role })
          .from(profiles)
          .where(eq(profiles.id, otherId))
          .limit(1);

        const [recRow] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(recommendations)
          .where(eq(recommendations.toUserId, otherId));

        const [lastMessage] = await db
          .select()
          .from(dmMessages)
          .where(eq(dmMessages.threadId, thread.id))
          .orderBy(desc(dmMessages.createdAt))
          .limit(1);

        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(dmMessages)
          .where(
            and(
              eq(dmMessages.threadId, thread.id),
              isNull(dmMessages.readAt),
              sql`${dmMessages.senderId} != ${userId}`,
            ),
          );

        return {
          ...thread,
          otherParticipant: other
            ? { ...other, recommendationCount: recRow?.count ?? 0 }
            : null,
          lastMessage: lastMessage ?? null,
          unreadCount: count,
        };
      }),
    );

    res.json({ threads: enriched });
  } catch (err) {
    req.log.error({ err }, "GET /dm/threads failed");
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

router.get("/dm/threads/:threadId/messages", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { threadId } = req.params;
  const { cursor, limit: limitStr } = req.query as { cursor?: string; limit?: string };
  const limit = Math.min(Number(limitStr) || 30, 100);

  try {
    const [thread] = await db
      .select()
      .from(dmThreads)
      .where(eq(dmThreads.id, threadId))
      .limit(1);

    if (!thread || (thread.participantA !== userId && thread.participantB !== userId)) {
      res.status(403).json({ error: "Thread not found or access denied" });
      return;
    }

    const conditions = [eq(dmMessages.threadId, threadId)];
    if (cursor) {
      const [cursorRow] = await db
        .select({ createdAt: dmMessages.createdAt })
        .from(dmMessages)
        .where(and(eq(dmMessages.id, cursor), eq(dmMessages.threadId, threadId)))
        .limit(1);
      if (cursorRow) {
        conditions.push(lt(dmMessages.createdAt, cursorRow.createdAt));
      }
    }

    const messages = await db
      .select()
      .from(dmMessages)
      .where(and(...conditions))
      .orderBy(desc(dmMessages.createdAt))
      .limit(limit + 1);

    const hasMore = messages.length > limit;
    const page = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? page[page.length - 1]?.id ?? null : null;

    res.json({ messages: page, nextCursor });
  } catch (err) {
    req.log.error({ err }, "GET /dm/threads/:threadId/messages failed");
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/dm/threads/:threadId/messages", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { threadId } = req.params;
  const { body: msgBody, imageUrl } = req.body as { body?: string; imageUrl?: string };

  if (!msgBody && !imageUrl) {
    res.status(400).json({ error: "body or imageUrl is required" });
    return;
  }

  try {
    const [thread] = await db
      .select()
      .from(dmThreads)
      .where(eq(dmThreads.id, threadId))
      .limit(1);

    if (!thread || (thread.participantA !== userId && thread.participantB !== userId)) {
      res.status(403).json({ error: "Thread not found or access denied" });
      return;
    }

    const [message] = await db
      .insert(dmMessages)
      .values({ threadId, senderId: userId, body: msgBody ?? null, imageUrl: imageUrl ?? null })
      .returning();

    await db
      .update(dmThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(dmThreads.id, threadId));

    const io = getIo();

    const recipientId =
      thread.participantA === userId ? thread.participantB : thread.participantA;

    if (io) {
      io.to(`user:${recipientId}`).emit("new_message", { threadId, message });
      io.to(`user:${userId}`).emit("new_message", { threadId, message });
    }

    // Always notify the recipient on a new DM so iOS/Android get a push when the
    // app is backgrounded — socket alone misses common cases (app swiped away,
    // OS suspended JS, user on another screen).
    try {
      const [sender] = await db
        .select({ fullName: profiles.fullName })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      const senderName = sender?.fullName ?? "Someone";
      const preview = msgBody ? msgBody.slice(0, 80) : "📷 Photo";

      await sendPushToUser(recipientId, senderName, preview, {
        type: "dm",
        threadId: String(threadId),
      });
    } catch (pushErr) {
      req.log.warn({ pushErr }, "DM push notification failed (non-fatal)");
    }

    res.status(201).json({ message });
  } catch (err) {
    req.log.error({ err }, "POST /dm/threads/:threadId/messages failed");
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.patch("/dm/threads/:threadId/read", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { threadId } = req.params;

  try {
    const [thread] = await db
      .select()
      .from(dmThreads)
      .where(eq(dmThreads.id, threadId))
      .limit(1);

    if (!thread || (thread.participantA !== userId && thread.participantB !== userId)) {
      res.status(403).json({ error: "Thread not found or access denied" });
      return;
    }

    await db
      .update(dmMessages)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(dmMessages.threadId, threadId),
          isNull(dmMessages.readAt),
          sql`${dmMessages.senderId} != ${userId}`,
        ),
      );

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PATCH /dm/threads/:threadId/read failed");
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

router.post("/dm/push-token", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { token, platform } = req.body as { token?: string; platform?: string };

  if (!token || !platform) {
    res.status(400).json({ error: "token and platform are required" });
    return;
  }

  try {
    await db
      .insert(pushTokens)
      .values({ userId, token, platform })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId, platform, updatedAt: new Date() },
      });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /dm/push-token failed");
    res.status(500).json({ error: "Failed to register push token" });
  }
});

export default router;
