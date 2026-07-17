import { Router, type IRouter, type Request, type Response } from "express";
import { count, eq } from "drizzle-orm";
import { db, aiSubdivisionInterestEvents } from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.post("/ai-subdivision-interest", requireAuth, async (req: Request, res: Response) => {
  const userId = (req as unknown as { userId: string }).userId;
  const { searchId, propertyAddress } = req.body as {
    searchId?: string | null;
    propertyAddress?: string | null;
  };

  try {
    await db.insert(aiSubdivisionInterestEvents).values({
      userId,
      searchId: typeof searchId === "string" && searchId.trim() ? searchId.trim() : null,
      propertyAddress:
        typeof propertyAddress === "string" && propertyAddress.trim() ? propertyAddress.trim() : null,
    });

    const [totalRow] = await db
      .select({ total: count() })
      .from(aiSubdivisionInterestEvents)
      .where(eq(aiSubdivisionInterestEvents.userId, userId));

    res.json({ ok: true, total: totalRow?.total ?? 0 });
  } catch (err) {
    req.log.error({ err }, "POST /ai-subdivision-interest failed");
    res.status(500).json({ error: "Failed to log AI subdivision interest" });
  }
});

export default router;
