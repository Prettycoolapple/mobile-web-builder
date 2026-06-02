import { Router } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, conversationSyncs, withDbRetry } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router = Router();

/** Coerce an incoming epoch-ms / ISO timestamp into a Date, or null. */
function toDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * GET /conversations — full payload of every saved conversation for this user,
 * newest first. Used by the client to hydrate conversations created on other
 * devices.
 */
router.get("/conversations", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const rows = await withDbRetry(() =>
      db
        .select({
          clientId: conversationSyncs.clientId,
          title: conversationSyncs.title,
          data: conversationSyncs.data,
          messageCount: conversationSyncs.messageCount,
          clientUpdatedAt: conversationSyncs.clientUpdatedAt,
          createdAt: conversationSyncs.createdAt,
          updatedAt: conversationSyncs.updatedAt,
        })
        .from(conversationSyncs)
        .where(eq(conversationSyncs.userId, userId))
        .orderBy(desc(conversationSyncs.clientUpdatedAt))
        .limit(300),
    );

    const conversations = rows.map((r) => ({
      id: r.clientId,
      title: r.title,
      data: r.data,
      messageCount: r.messageCount,
      updatedAt: (r.clientUpdatedAt ?? r.updatedAt)?.getTime?.() ?? null,
      createdAt: r.createdAt?.getTime?.() ?? null,
    }));

    res.json({ conversations });
  } catch (error) {
    req.log.error({ err: error }, "Failed to list conversations");
    res.status(500).json({ error: "Failed to list conversations", code: "CONVERSATIONS_LIST_FAILED" });
  }
});

/**
 * POST /conversations — batch upsert. Body: { conversations: [{ id, title,
 * updatedAt, createdAt, data, messageCount }] }. Idempotent per (user, id);
 * last-write-wins by the device's updatedAt so an older device can't clobber a
 * newer edit synced from elsewhere.
 */
router.post("/conversations", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const incoming = Array.isArray(req.body?.conversations) ? req.body.conversations : null;
  if (!incoming) {
    res.status(400).json({ error: "conversations array required", code: "BAD_REQUEST" });
    return;
  }

  try {
    let saved = 0;
    for (const c of incoming) {
      const clientId = typeof c?.id === "string" ? c.id : null;
      if (!clientId || c?.data == null) continue;
      const clientUpdatedAt = toDate(c.updatedAt) ?? new Date();
      const createdAt = toDate(c.createdAt) ?? clientUpdatedAt;
      const title = typeof c.title === "string" ? c.title.slice(0, 300) : "";
      const messageCount =
        typeof c.messageCount === "number" && Number.isFinite(c.messageCount)
          ? Math.max(0, Math.trunc(c.messageCount))
          : Array.isArray(c.data?.messages)
            ? c.data.messages.length
            : 0;

      await withDbRetry(() =>
        db
          .insert(conversationSyncs)
          .values({
            userId,
            clientId,
            title,
            data: c.data,
            messageCount,
            clientUpdatedAt,
            createdAt,
          })
          .onConflictDoUpdate({
            target: [conversationSyncs.userId, conversationSyncs.clientId],
            set: {
              title: sql`excluded.title`,
              data: sql`excluded.data`,
              messageCount: sql`excluded.message_count`,
              clientUpdatedAt: sql`excluded.client_updated_at`,
              updatedAt: new Date(),
            },
            // Only overwrite when the incoming edit is at least as new.
            setWhere: sql`${conversationSyncs.clientUpdatedAt} is null or excluded.client_updated_at >= ${conversationSyncs.clientUpdatedAt}`,
          }),
      );
      saved += 1;
    }

    res.json({ success: true, saved });
  } catch (error) {
    req.log.error({ err: error }, "Failed to upsert conversations");
    res.status(500).json({ error: "Failed to save conversations", code: "CONVERSATIONS_SAVE_FAILED" });
  }
});

/** DELETE /conversations/:id — remove one conversation (id = device session id). */
router.delete("/conversations/:id", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { id } = req.params;
  try {
    await withDbRetry(() =>
      db
        .delete(conversationSyncs)
        .where(and(eq(conversationSyncs.userId, userId), eq(conversationSyncs.clientId, id))),
    );
    res.json({ success: true });
  } catch (error) {
    req.log.error({ err: error }, "Failed to delete conversation");
    res.status(500).json({ error: "Failed to delete conversation", code: "CONVERSATION_DELETE_FAILED" });
  }
});

export default router;
