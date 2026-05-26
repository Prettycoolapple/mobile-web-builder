import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

router.post("/subscription/sync", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { tier, subscriptionPeriodEndISO } = req.body as {
    tier?: string;
    subscriptionPeriodEndISO?: string;
  };
  if (tier !== "pro" && tier !== "free") {
    res.status(400).json({ error: "Invalid tier" });
    return;
  }

  function parsePeriodEnd(iso: string | undefined): Date | null {
    if (!iso || typeof iso !== "string") return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const incomingEnd = parsePeriodEnd(subscriptionPeriodEndISO);

  try {
    const [row] = await db
      .select({
        subscriptionTier: profiles.subscriptionTier,
        subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    const wasPaid = row.subscriptionTier === "pro" || row.subscriptionTier === "standard";

    if (tier === "free") {
      await db
        .update(profiles)
        .set({ subscriptionTier: "free", subscriptionPeriodEndAt: null })
        .where(eq(profiles.id, userId));
      res.json({ success: true, tier });
      return;
    }

    const storedEnd = row.subscriptionPeriodEndAt ? new Date(row.subscriptionPeriodEndAt) : null;
    const hasValidStoredEnd = storedEnd !== null && !Number.isNaN(storedEnd.getTime());
    let resetUsage = false;

    if (!wasPaid) {
      resetUsage = true;
    } else if (incomingEnd && hasValidStoredEnd && incomingEnd.getTime() > storedEnd!.getTime()) {
      resetUsage = true;
    }

    if (resetUsage) {
      await db
        .update(profiles)
        .set({
          subscriptionTier: tier,
          reportsUsedThisMonth: 0,
          messagesUsedThisMonth: 0,
          lastResetAt: new Date(),
          subscriptionPeriodEndAt: incomingEnd,
        })
        .where(eq(profiles.id, userId));
    } else {
      const patch: {
        subscriptionTier: string;
        subscriptionPeriodEndAt?: Date | null;
      } = { subscriptionTier: tier };
      if (incomingEnd) {
        patch.subscriptionPeriodEndAt = incomingEnd;
      }
      await db.update(profiles).set(patch).where(eq(profiles.id, userId));
    }

    res.json({ success: true, tier });
  } catch (err) {
    logger.error({ err }, "Failed to sync subscription");
    res.status(500).json({ error: "Failed to sync subscription" });
  }
});

export default router;
