import { Router, type IRouter, type Request, type Response } from "express";
import { db, chatLlmFeedback } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

/** Thumbs up / down on the first LLM reply in a client chat session (telemetry). */
router.post("/feedback/llm", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;
  const { clientSessionId, rating, responseMode } = req.body as {
    clientSessionId?: string;
    rating?: string;
    responseMode?: string | null;
  };

  if (!clientSessionId?.trim()) {
    res.status(400).json({ error: "clientSessionId is required" });
    return;
  }
  if (rating !== "up" && rating !== "down") {
    res.status(400).json({ error: "rating must be 'up' or 'down'" });
    return;
  }

  try {
    await db.insert(chatLlmFeedback).values({
      userId,
      clientSessionId: clientSessionId.trim(),
      rating,
      responseMode: responseMode?.trim() || null,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /feedback/llm failed");
    res.status(500).json({ error: "Failed to save feedback" });
  }
});

export default router;
