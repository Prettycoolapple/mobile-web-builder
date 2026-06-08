import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, profiles, salesAgentProfiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { getStripe, subscriptionInfoFromStripe } from "../lib/stripe";

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

// ── Sales-agent web subscription management ──────────────────────────────────

/** Current agent plan + subscription state for the Manage subscription tab. */
router.get("/subscription/agent-status", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const [profile] = await db
      .select({
        subscriptionStatus: profiles.subscriptionStatus,
        subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
        subscriptionCancelAtPeriodEnd: profiles.subscriptionCancelAtPeriodEnd,
        stripeSubscriptionId: profiles.stripeSubscriptionId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const [agent] = await db
      .select({ listingPlan: salesAgentProfiles.listingPlan, aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt })
      .from(salesAgentProfiles)
      .where(eq(salesAgentProfiles.userId, userId))
      .limit(1);

    if (!agent) {
      res.status(404).json({ error: "Not a sales agent", code: "NOT_AN_AGENT" });
      return;
    }

    res.json({
      listingPlan: agent.listingPlan ?? "lifetime",
      subscriptionStatus: profile?.subscriptionStatus ?? null,
      subscriptionPeriodEndAt: profile?.subscriptionPeriodEndAt ?? null,
      cancelAtPeriodEnd: profile?.subscriptionCancelAtPeriodEnd ?? false,
      aiBoostExpiresAt: agent.aiBoostExpiresAt ?? null,
      hasStripeSubscription: !!profile?.stripeSubscriptionId,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load agent subscription status");
    res.status(500).json({ error: "Failed to load subscription status" });
  }
});

async function setCancelAtPeriodEnd(userId: string, cancel: boolean, res: import("express").Response) {
  const [profile] = await db
    .select({ stripeSubscriptionId: profiles.stripeSubscriptionId })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  if (!profile?.stripeSubscriptionId) {
    res.status(400).json({ error: "No active subscription to manage.", code: "NO_SUBSCRIPTION" });
    return;
  }

  const sub = await getStripe().subscriptions.update(profile.stripeSubscriptionId, {
    cancel_at_period_end: cancel,
  });
  const info = subscriptionInfoFromStripe(sub);
  await db
    .update(profiles)
    .set({
      subscriptionStatus: info.subscriptionStatus,
      subscriptionPeriodEndAt: info.subscriptionPeriodEndAt,
      subscriptionCancelAtPeriodEnd: info.subscriptionCancelAtPeriodEnd,
    })
    .where(eq(profiles.id, userId));

  res.json({
    success: true,
    subscriptionStatus: info.subscriptionStatus,
    subscriptionPeriodEndAt: info.subscriptionPeriodEndAt,
    cancelAtPeriodEnd: info.subscriptionCancelAtPeriodEnd,
  });
}

/** Cancel at period end — agent keeps access until the paid period ends. */
router.post("/subscription/cancel", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    await setCancelAtPeriodEnd(userId, true, res);
  } catch (err) {
    logger.error({ err }, "Failed to cancel subscription");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

/** Resume a subscription that was set to cancel at period end. */
router.post("/subscription/resume", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    await setCancelAtPeriodEnd(userId, false, res);
  } catch (err) {
    logger.error({ err }, "Failed to resume subscription");
    res.status(500).json({ error: "Failed to resume subscription" });
  }
});

export default router;
