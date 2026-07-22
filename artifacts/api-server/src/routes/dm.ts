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
  userBlocks,
  userReports,
  limTitleRequests,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getIo } from "../lib/socket";
import { getUnreadAppBadgeCount, sendPushToUser } from "../lib/expo-push";
import { sendOwnerNotification } from "../lib/mailer";
import {
  captureLimTitleDocument,
  isLimTitleDocumentType,
} from "../lib/lim-title-documents";
import { getLimTitleDeliveryState } from "../lib/lim-title-leads";
import type { PropertyDocumentLinkMethod } from "@workspace/db";

const router: IRouter = Router();

const DOCUMENT_LINK_METHODS = new Set<PropertyDocumentLinkMethod>([
  "auto_single_open",
  "agent_picker",
  "card_upload",
  "admin",
]);

function parseLinkMethod(value: unknown): PropertyDocumentLinkMethod {
  return typeof value === "string" && DOCUMENT_LINK_METHODS.has(value as PropertyDocumentLinkMethod)
    ? value as PropertyDocumentLinkMethod
    : "agent_picker";
}

async function validateDocumentRequest(
  requestId: string,
  thread: typeof dmThreads.$inferSelect,
  senderId: string,
) {
  const [[sender], [lead]] = await Promise.all([
    db.select({ role: profiles.role }).from(profiles).where(eq(profiles.id, senderId)).limit(1),
    db.select().from(limTitleRequests).where(eq(limTitleRequests.id, requestId)).limit(1),
  ]);
  if (!sender || sender.role !== "sales_agent" || !lead || lead.matchedAgentUserId !== senderId) return null;
  const participantsMatch =
    [thread.participantA, thread.participantB].includes(senderId) &&
    [thread.participantA, thread.participantB].includes(lead.requesterUserId);
  if (lead.dmThreadId !== thread.id && !participantsMatch) return null;
  return lead;
}

async function leadSummaryRows(threadId: string) {
  const rows = await db
    .select({
      id: limTitleRequests.id,
      propertyKey: limTitleRequests.propertyKey,
      propertyAddress: limTitleRequests.propertyAddress,
      requestedDocuments: limTitleRequests.requestedDocuments,
      status: limTitleRequests.status,
      consentedAt: limTitleRequests.consentedAt,
      documentsDeliveredAt: limTitleRequests.documentsDeliveredAt,
    })
    .from(limTitleRequests)
    .where(and(
      eq(limTitleRequests.dmThreadId, threadId),
      isNotNull(limTitleRequests.consentedAt),
    ))
    .orderBy(desc(limTitleRequests.consentedAt));
  return Promise.all(rows.map(async (row) => ({
    ...row,
    delivered: await getLimTitleDeliveryState(row.id),
  })));
}

type BlockRow = typeof userBlocks.$inferSelect;

function blockStatusForPair(userId: string, otherId: string, incident: BlockRow[]) {
  let iBlockedThem = false;
  let theyBlockedMe = false;
  for (const b of incident) {
    if (b.blockerId === userId && b.blockedId === otherId) iBlockedThem = true;
    if (b.blockerId === otherId && b.blockedId === userId) theyBlockedMe = true;
  }
  return {
    iBlockedThem,
    theyBlockedMe,
    messagingBlocked: iBlockedThem || theyBlockedMe,
  };
}

async function pairHasAnyBlock(userId: string, otherId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: userBlocks.id })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, otherId)),
        and(eq(userBlocks.blockerId, otherId), eq(userBlocks.blockedId, userId)),
      ),
    )
    .limit(1);
  return !!row;
}

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
    // Provider contact is free for all users, all tiers.
    const [me, target] = await Promise.all([
      db.select({ role: profiles.role })
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

    if (await pairHasAnyBlock(userId, targetUserId)) {
      res.status(403).json({ error: "Messaging is not available with this user", code: "BLOCKED" });
      return;
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

    const incidentBlocks = await db
      .select()
      .from(userBlocks)
      .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));

    const enriched = await Promise.all(
      threads.map(async (thread) => {
        const otherId =
          thread.participantA === userId ? thread.participantB : thread.participantA;

        const [other] = await db
          .select({
            id: profiles.id,
            fullName: profiles.fullName,
            role: profiles.role,
            avatarUrl: profiles.avatarUrl,
            // Use the denormalized column so admin overrides are reflected here too.
            recommendationCount: serviceProviderProfiles.recommendationCount,
          })
          .from(profiles)
          .leftJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
          .where(eq(profiles.id, otherId))
          .limit(1);

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

        const leadRows = await leadSummaryRows(thread.id);

        const blockStatus = blockStatusForPair(userId, otherId, incidentBlocks);

        return {
          ...thread,
          otherParticipant: other
            ? { ...other, recommendationCount: other.recommendationCount ?? 0 }
            : null,
          lastMessage: lastMessage ?? null,
          unreadCount: count,
          blockStatus,
          leadSummary: leadRows[0] ?? null,
          leads: leadRows,
          leadCount: leadRows.length,
        };
      }),
    );

    res.json({ threads: enriched });
  } catch (err) {
    req.log.error({ err }, "GET /dm/threads failed");
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

router.get("/dm/threads/:threadId/leads", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { threadId } = req.params;
  try {
    const [thread] = await db.select().from(dmThreads).where(eq(dmThreads.id, threadId)).limit(1);
    if (!thread || (thread.participantA !== userId && thread.participantB !== userId)) {
      res.status(403).json({ error: "Thread not found or access denied" });
      return;
    }
    const leads = (await leadSummaryRows(threadId)).filter((lead) => !lead.delivered.complete);
    res.json({ leads });
  } catch (err) {
    req.log.error({ err }, "GET /dm/threads/:threadId/leads failed");
    res.status(500).json({ error: "Failed to fetch document requests" });
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

    const otherId = thread.participantA === userId ? thread.participantB : thread.participantA;
    const incidentBlocks = await db
      .select()
      .from(userBlocks)
      .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
    const blockStatus = blockStatusForPair(userId, otherId, incidentBlocks);

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

    res.json({ messages: page, nextCursor, blockStatus });
  } catch (err) {
    req.log.error({ err }, "GET /dm/threads/:threadId/messages failed");
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

router.post("/dm/threads/:threadId/messages", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { threadId } = req.params;
  const {
    body: msgBody,
    imageUrl,
    fileUrl,
    fileName,
    fileMime,
    objectPath,
    fileSize,
    fileHash,
    leadRequestId,
    documentType,
    linkMethod,
  } = req.body as {
    body?: string;
    imageUrl?: string;
    fileUrl?: string;
    fileName?: string;
    fileMime?: string;
    objectPath?: string | null;
    fileSize?: number | null;
    fileHash?: string | null;
    leadRequestId?: string;
    documentType?: string;
    linkMethod?: string;
  };

  if (!msgBody && !imageUrl && !fileUrl) {
    res.status(400).json({ error: "body, imageUrl, or fileUrl is required" });
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

    const recipientId =
      thread.participantA === userId ? thread.participantB : thread.participantA;
    if (await pairHasAnyBlock(userId, recipientId)) {
      res.status(403).json({ error: "Messaging is not available with this user", code: "BLOCKED" });
      return;
    }

    let documentLead: typeof limTitleRequests.$inferSelect | null = null;
    if (leadRequestId != null || documentType != null) {
      if (!fileUrl || !leadRequestId || !isLimTitleDocumentType(documentType)) {
        res.status(400).json({ error: "A file, leadRequestId, and valid documentType are required" });
        return;
      }
      documentLead = await validateDocumentRequest(leadRequestId, thread, userId);
      if (!documentLead) {
        res.status(403).json({ error: "Document request not found or access denied" });
        return;
      }
    }

    const [message] = await db
      .insert(dmMessages)
      .values({
        threadId,
        senderId: userId,
        body: msgBody ?? null,
        imageUrl: imageUrl ?? null,
        fileUrl: fileUrl ?? null,
        fileName: fileName ?? null,
        fileMime: fileMime ?? null,
        messageKind: documentLead ? "lim_title_document" : null,
        leadRequestId: documentLead?.id ?? null,
        metadataJson: documentLead ? {
          requestId: documentLead.id,
          docType: documentType,
          propertyKey: documentLead.propertyKey,
          propertyAddress: documentLead.propertyAddress,
          linkMethod: parseLinkMethod(linkMethod),
          fileHash: fileHash?.replace(/^\"|\"$/g, "") || null,
          objectPath: objectPath ?? null,
          fileSize: typeof fileSize === "number" && Number.isFinite(fileSize) ? fileSize : null,
        } : null,
      })
      .returning();

    if (documentLead && fileUrl && isLimTitleDocumentType(documentType)) {
      void captureLimTitleDocument({
        requestId: documentLead.id,
        messageId: message.id,
        sourceAgentUserId: userId,
        propertyKey: documentLead.propertyKey,
        propertyAddress: documentLead.propertyAddress,
        docType: documentType,
        fileUrl,
        objectPath,
        fileName,
        fileMime,
        fileSize: typeof fileSize === "number" && Number.isFinite(fileSize) ? fileSize : null,
        fileHash,
        linkMethod: parseLinkMethod(linkMethod),
        reuseConsentAt: new Date(),
      });
    }

    await db
      .update(dmThreads)
      .set({ lastMessageAt: new Date() })
      .where(eq(dmThreads.id, threadId));

    const io = getIo();

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
      const preview = msgBody ? msgBody.slice(0, 80) : fileUrl ? "📄 File" : "📷 Photo";

      const badgeCount = await getUnreadAppBadgeCount(recipientId);

      await sendPushToUser(recipientId, senderName, preview, {
        type: "dm",
        threadId: String(threadId),
      }, {
        badgeCount,
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

router.post("/dm/messages/:messageId/tag-document", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { messageId } = req.params;
  const { leadRequestId, documentType, linkMethod } = (req.body ?? {}) as {
    leadRequestId?: string;
    documentType?: string;
    linkMethod?: string;
  };
  if (!leadRequestId || !isLimTitleDocumentType(documentType)) {
    res.status(400).json({ error: "leadRequestId and a valid documentType are required" });
    return;
  }
  try {
    const [existing] = await db.select().from(dmMessages).where(eq(dmMessages.id, messageId)).limit(1);
    if (!existing?.fileUrl || existing.senderId !== userId) {
      res.status(404).json({ error: "File message not found" });
      return;
    }
    const [thread] = await db.select().from(dmThreads).where(eq(dmThreads.id, existing.threadId)).limit(1);
    if (!thread || (thread.participantA !== userId && thread.participantB !== userId)) {
      res.status(403).json({ error: "Thread not found or access denied" });
      return;
    }
    const lead = await validateDocumentRequest(leadRequestId, thread, userId);
    if (!lead) {
      res.status(403).json({ error: "Document request not found or access denied" });
      return;
    }
    const existingMetadata = existing.metadataJson ?? {};
    const existingHash = typeof existingMetadata.fileHash === "string" ? existingMetadata.fileHash : null;
    const existingObjectPath = typeof existingMetadata.objectPath === "string" ? existingMetadata.objectPath : null;
    const existingFileSize = typeof existingMetadata.fileSize === "number" ? existingMetadata.fileSize : null;
    const [message] = await db.update(dmMessages).set({
      messageKind: "lim_title_document",
      leadRequestId: lead.id,
      metadataJson: {
        requestId: lead.id,
        docType: documentType,
        propertyKey: lead.propertyKey,
        propertyAddress: lead.propertyAddress,
        linkMethod: parseLinkMethod(linkMethod),
        fileHash: existingHash,
        objectPath: existingObjectPath,
        fileSize: existingFileSize,
      },
    }).where(eq(dmMessages.id, messageId)).returning();
    void captureLimTitleDocument({
      requestId: lead.id,
      messageId: message.id,
      sourceAgentUserId: userId,
      propertyKey: lead.propertyKey,
      propertyAddress: lead.propertyAddress,
      docType: documentType,
      fileUrl: existing.fileUrl,
      objectPath: existingObjectPath,
      fileName: existing.fileName,
      fileMime: existing.fileMime,
      fileSize: existingFileSize,
      fileHash: existingHash,
      linkMethod: parseLinkMethod(linkMethod),
      reuseConsentAt: new Date(),
      replaceExistingForMessage: true,
    });
    const io = getIo();
    io?.to(`user:${thread.participantA}`).emit("message_updated", { threadId: thread.id, message });
    io?.to(`user:${thread.participantB}`).emit("message_updated", { threadId: thread.id, message });
    res.json({ message });
  } catch (err) {
    req.log.error({ err }, "POST /dm/messages/:messageId/tag-document failed");
    res.status(500).json({ error: "Failed to tag document" });
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

    const readAt = new Date();
    const marked = await db
      .update(dmMessages)
      .set({ readAt })
      .where(
        and(
          eq(dmMessages.threadId, threadId),
          isNull(dmMessages.readAt),
          sql`${dmMessages.senderId} != ${userId}`,
        ),
      )
      .returning({ id: dmMessages.id });

    // Let the sender's open clients update read receipts live (shown to
    // sales agents as "Read" under their sent messages).
    if (marked.length > 0) {
      const otherId =
        thread.participantA === userId ? thread.participantB : thread.participantA;
      const io = getIo();
      if (io) {
        io.to(`user:${otherId}`).emit("messages_read", {
          threadId,
          messageIds: marked.map((row) => row.id),
          readAt: readAt.toISOString(),
        });
      }
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "PATCH /dm/threads/:threadId/read failed");
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// Toggle a single "like" reaction on a message. Either participant may add a
// like to an unliked message, but only the participant recorded in likedBy may
// remove it. Conditional updates prevent a concurrent request from replacing
// another participant's reaction.
router.post(
  "/dm/threads/:threadId/messages/:messageId/like",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const { threadId, messageId } = req.params;
    const { liked } = req.body as { liked?: boolean };

    if (typeof liked !== "boolean") {
      res.status(400).json({ error: "liked must be a boolean" });
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

      const [existing] = await db
        .select({
          id: dmMessages.id,
          likedAt: dmMessages.likedAt,
          likedBy: dmMessages.likedBy,
        })
        .from(dmMessages)
        .where(and(eq(dmMessages.id, messageId), eq(dmMessages.threadId, threadId)))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Message not found" });
        return;
      }

      if (existing.likedAt && existing.likedBy !== userId) {
        res.status(409).json({ error: "Only the person who liked this message can change the like" });
        return;
      }

      const [message] = await db
        .update(dmMessages)
        .set(
          liked
            ? { likedAt: new Date(), likedBy: userId }
            : { likedAt: null, likedBy: null },
        )
        .where(
          and(
            eq(dmMessages.id, messageId),
            eq(dmMessages.threadId, threadId),
            liked
              ? or(isNull(dmMessages.likedAt), eq(dmMessages.likedBy, userId))
              : eq(dmMessages.likedBy, userId),
          ),
        )
        .returning();

      if (!message) {
        res.status(409).json({ error: "The like was changed by the other participant" });
        return;
      }

      const otherId =
        thread.participantA === userId ? thread.participantB : thread.participantA;
      const io = getIo();
      if (io) {
        io.to(`user:${otherId}`).emit("message_like", { threadId, message });
        io.to(`user:${userId}`).emit("message_like", { threadId, message });
      }

      if (liked) {
        try {
          const [liker] = await db
            .select({ fullName: profiles.fullName })
            .from(profiles)
            .where(eq(profiles.id, userId))
            .limit(1);
          const likerName = liker?.fullName ?? "Someone";
          const badgeCount = await getUnreadAppBadgeCount(otherId);
          await sendPushToUser(otherId, likerName, "Liked a message", {
            type: "dm_like",
            threadId: String(threadId),
            messageId: String(messageId),
          }, {
            badgeCount,
          });
        } catch (pushErr) {
          req.log.warn({ pushErr }, "DM like push notification failed (non-fatal)");
        }
      }

      res.json({ message });
    } catch (err) {
      req.log.error({ err }, "POST /dm/threads/:threadId/messages/:messageId/like failed");
      res.status(500).json({ error: "Failed to update like" });
    }
  },
);

// Recipient opened a file attachment (e.g. a LIM/title PDF). Records the first
// view only and broadcasts so the sender's clients can show "File opened".
// Admin Message Hub clients receive the same persisted state through polling.
router.post(
  "/dm/threads/:threadId/messages/:messageId/file-viewed",
  requireAuth,
  async (req: Request, res: Response) => {
    const userId = (req as any).userId as string;
    const { threadId, messageId } = req.params;

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

      const [existing] = await db
        .select({
          id: dmMessages.id,
          senderId: dmMessages.senderId,
          fileUrl: dmMessages.fileUrl,
          fileViewedAt: dmMessages.fileViewedAt,
        })
        .from(dmMessages)
        .where(and(eq(dmMessages.id, messageId), eq(dmMessages.threadId, threadId)))
        .limit(1);
      if (!existing || !existing.fileUrl) {
        res.status(404).json({ error: "File message not found" });
        return;
      }
      // Only the recipient's open counts; senders opening their own file don't.
      // Already-viewed messages keep their first-view timestamp.
      if (existing.senderId === userId || existing.fileViewedAt) {
        res.json({ ok: true });
        return;
      }

      const [message] = await db
        .update(dmMessages)
        .set({ fileViewedAt: new Date() })
        .where(eq(dmMessages.id, messageId))
        .returning();

      const io = getIo();
      if (io) {
        io.to(`user:${existing.senderId}`).emit("file_viewed", { threadId, message });
      }

      res.json({ ok: true });
    } catch (err) {
      req.log.error({ err }, "POST /dm/threads/:threadId/messages/:messageId/file-viewed failed");
      res.status(500).json({ error: "Failed to record file view" });
    }
  },
);

router.post("/dm/block", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { blockedUserId } = req.body as { blockedUserId?: string };

  if (!blockedUserId || typeof blockedUserId !== "string") {
    res.status(400).json({ error: "blockedUserId is required" });
    return;
  }
  if (blockedUserId === userId) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  try {
    const [target] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, blockedUserId))
      .limit(1);
    if (!target) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const [already] = await db
      .select({ id: userBlocks.id })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, blockedUserId)))
      .limit(1);
    if (!already) {
      await db.insert(userBlocks).values({ blockerId: userId, blockedId: blockedUserId });
    }

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /dm/block failed");
    res.status(500).json({ error: "Failed to block user" });
  }
});

router.delete("/dm/block/:blockedUserId", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { blockedUserId } = req.params;

  if (!blockedUserId) {
    res.status(400).json({ error: "blockedUserId is required" });
    return;
  }

  try {
    await db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, blockedUserId)));

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "DELETE /dm/block/:blockedUserId failed");
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

router.post("/dm/report", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { reportedUserId, threadId, comment } = req.body as {
    reportedUserId?: string;
    threadId?: string | null;
    comment?: string;
  };
  const trimmed = (comment ?? "").trim();

  if (!reportedUserId || typeof reportedUserId !== "string") {
    res.status(400).json({ error: "reportedUserId is required" });
    return;
  }
  if (reportedUserId === userId) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (trimmed.length < 10) {
    res.status(400).json({ error: "Comment must be at least 10 characters", code: "COMMENT_TOO_SHORT" });
    return;
  }

  try {
    const [reported] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, reportedUserId))
      .limit(1);
    if (!reported) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (threadId && typeof threadId === "string") {
      const [thread] = await db
        .select()
        .from(dmThreads)
        .where(eq(dmThreads.id, threadId))
        .limit(1);
      if (!thread || (thread.participantA !== userId && thread.participantB !== userId)) {
        res.status(400).json({ error: "Invalid thread for this report" });
        return;
      }
      const other = thread.participantA === userId ? thread.participantB : thread.participantA;
      if (other !== reportedUserId) {
        res.status(400).json({ error: "Reported user must be the other participant in this thread" });
        return;
      }
    }

    await db.insert(userReports).values({
      reporterId: userId,
      reportedUserId,
      threadId: threadId && typeof threadId === "string" ? threadId : null,
      comment: trimmed,
    });

    const [reporterProfile] = await db
      .select({ email: profiles.email, fullName: profiles.fullName, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const [reportedProfile] = await db
      .select({ email: profiles.email, fullName: profiles.fullName, role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, reportedUserId))
      .limit(1);

    const subject = "[Project Alpha] DM user report";
    const body = [
      "A user submitted a report from a private chat.",
      "",
      `Reporter: ${reporterProfile?.fullName ?? "Unknown"} <${reporterProfile?.email ?? userId}>`,
      `Reporter id: ${userId} (${reporterProfile?.role ?? "?"})`,
      "",
      `Reported: ${reportedProfile?.fullName ?? "Unknown"} <${reportedProfile?.email ?? reportedUserId}>`,
      `Reported id: ${reportedUserId} (${reportedProfile?.role ?? "?"})`,
      "",
      threadId && typeof threadId === "string" ? `Thread id: ${threadId}` : "Thread id: (not specified)",
      "",
      "Comment:",
      trimmed,
      "",
      "—",
      "This message was generated by the Project Alpha API when SMTP owner notifications are configured (SMTP_USER / SMTP_PASS / SMTP_TO).",
    ].join("\n");

    try {
      await sendOwnerNotification(subject, body);
    } catch (mailErr) {
      req.log.warn({ mailErr }, "DM report saved but owner email failed");
    }

    res.status(201).json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /dm/report failed");
    res.status(500).json({ error: "Failed to submit report" });
  }
});

router.post("/dm/push-token", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as any).userId as string;
  const { token, platform, locale } = req.body as { token?: string; platform?: string; locale?: string };

  if (!token || !platform) {
    res.status(400).json({ error: "token and platform are required" });
    return;
  }

  try {
    await db
      .insert(pushTokens)
      .values({ userId, token, platform, locale: locale === "zh" ? "zh" : locale === "en" ? "en" : null })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId, guestSessionId: null, platform, locale: locale === "zh" ? "zh" : locale === "en" ? "en" : null, updatedAt: new Date() },
      });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /dm/push-token failed");
    res.status(500).json({ error: "Failed to register push token" });
  }
});

export default router;
