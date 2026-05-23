import { Router, type IRouter, type Request, type Response } from "express";
import { db, agentCallEvents } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

/** Log a press on the "Call" button of the recommended agent card (not DM calls). */
router.post("/agent-call-event", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;
  const { agentPhone, agentName, agencyName, propertyAddress } = req.body as {
    agentPhone?: string | null;
    agentName?: string | null;
    agencyName?: string | null;
    propertyAddress?: string | null;
  };

  try {
    await db.insert(agentCallEvents).values({
      userId,
      agentPhone: typeof agentPhone === "string" && agentPhone.trim() ? agentPhone.trim() : null,
      agentName: typeof agentName === "string" && agentName.trim() ? agentName.trim() : null,
      agencyName: typeof agencyName === "string" && agencyName.trim() ? agencyName.trim() : null,
      propertyAddress:
        typeof propertyAddress === "string" && propertyAddress.trim() ? propertyAddress.trim() : null,
    });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "POST /agent-call-event failed");
    res.status(500).json({ error: "Failed to log agent call event" });
  }
});

export default router;
