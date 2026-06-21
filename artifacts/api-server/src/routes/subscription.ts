import { Router } from "express";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, profiles, salesAgentProfiles } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { getStripe, subscriptionInfoFromStripe } from "../lib/stripe";
import { getProviderPortalUrl, getStripeProviderPriceId } from "../lib/env";
import { hasProviderWebEntitlement, resolveProviderEntitlement } from "../lib/provider-entitlements";

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
        role: profiles.role,
        subscriptionTier: profiles.subscriptionTier,
        subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
        stripeSubscriptionId: profiles.stripeSubscriptionId,
        subscriptionStatus: profiles.subscriptionStatus,
        createdAt: profiles.createdAt,
        providerTrialStartedAt: profiles.providerTrialStartedAt,
        providerTrialEndsAt: profiles.providerTrialEndsAt,
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
      if (hasProviderWebEntitlement(row)) {
        const entitlement = resolveProviderEntitlement(row);
        res.json({
          success: true,
          tier: row.subscriptionTier,
          ignored: true,
          providerAccessActive: entitlement.providerAccessActive,
          providerAccessKind: entitlement.providerAccessKind,
        });
        return;
      }
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

router.get("/subscription/provider-status", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const [profile] = await db
      .select({
        role: profiles.role,
        subscriptionTier: profiles.subscriptionTier,
        subscriptionStatus: profiles.subscriptionStatus,
        subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
        subscriptionCancelAtPeriodEnd: profiles.subscriptionCancelAtPeriodEnd,
        stripeCustomerId: profiles.stripeCustomerId,
        stripeSubscriptionId: profiles.stripeSubscriptionId,
        createdAt: profiles.createdAt,
        providerTrialStartedAt: profiles.providerTrialStartedAt,
        providerTrialEndsAt: profiles.providerTrialEndsAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile || profile.role !== "service_provider") {
      res.status(404).json({ error: "Not a service provider", code: "NOT_A_PROVIDER" });
      return;
    }

    if (profile.stripeSubscriptionId) {
      try {
        const sub = await getStripe().subscriptions.retrieve(profile.stripeSubscriptionId);
        const info = subscriptionInfoFromStripe(sub, profile.stripeCustomerId);
        profile.subscriptionStatus = info.subscriptionStatus;
        profile.subscriptionPeriodEndAt = info.subscriptionPeriodEndAt;
        profile.subscriptionCancelAtPeriodEnd = info.subscriptionCancelAtPeriodEnd;
        await db
          .update(profiles)
          .set({
            stripeCustomerId: info.stripeCustomerId,
            subscriptionStatus: info.subscriptionStatus,
            subscriptionPeriodEndAt: info.subscriptionPeriodEndAt,
            subscriptionCancelAtPeriodEnd: info.subscriptionCancelAtPeriodEnd,
          })
          .where(eq(profiles.id, userId));
      } catch (err) {
        logger.warn({ err, userId }, "Could not refresh provider Stripe subscription before status response");
      }
    }

    const entitlement = resolveProviderEntitlement(profile);
    res.json({
      ...entitlement,
      subscriptionTier: profile.subscriptionTier,
      subscriptionStatus: profile.subscriptionStatus,
      subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt,
      cancelAtPeriodEnd: profile.subscriptionCancelAtPeriodEnd,
      hasStripeSubscription: !!profile.stripeSubscriptionId,
    });
  } catch (err) {
    logger.error({ err }, "Failed to load provider subscription status");
    res.status(500).json({ error: "Failed to load subscription status" });
  }
});

router.post("/subscription/provider-checkout", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    const [profile] = await db
      .select({
        id: profiles.id,
        role: profiles.role,
        email: profiles.email,
        fullName: profiles.fullName,
        phoneNumber: profiles.phoneNumber,
        stripeCustomerId: profiles.stripeCustomerId,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile || profile.role !== "service_provider") {
      res.status(403).json({ error: "Service provider account required.", code: "NOT_A_PROVIDER" });
      return;
    }

    const stripe = getStripe();
    let customerId = profile.stripeCustomerId;
    if (!customerId) {
      const found = await stripe.customers.list({ email: profile.email, limit: 1 });
      customerId = found.data[0]?.id ?? null;
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        name: profile.fullName ?? undefined,
        phone: profile.phoneNumber ?? undefined,
      });
      customerId = customer.id;
    }

    if (customerId !== profile.stripeCustomerId) {
      await db.update(profiles).set({ stripeCustomerId: customerId }).where(eq(profiles.id, userId));
    }

    const portal = getProviderPortalUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getStripeProviderPriceId(), quantity: 1 }],
      success_url: `${portal}?providerSubscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${portal}?providerSubscription=cancelled`,
      metadata: { providerUserId: userId },
      subscription_data: { metadata: { providerUserId: userId } },
    });

    res.json({ checkoutUrl: session.url });
  } catch (err) {
    logger.error({ err }, "Failed to start provider checkout");
    res.status(500).json({ error: "Could not start checkout. Please try again.", code: "CHECKOUT_FAILED" });
  }
});

router.post("/subscription/provider-checkout/claim", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const checkoutSessionId =
    typeof req.body?.checkoutSessionId === "string" ? req.body.checkoutSessionId.trim() : "";
  if (!checkoutSessionId) {
    res.status(400).json({ error: "checkoutSessionId is required", code: "MISSING_SESSION_ID" });
    return;
  }

  try {
    const session = await getStripe().checkout.sessions.retrieve(checkoutSessionId, {
      expand: ["subscription"],
    });
    if (session.metadata?.providerUserId !== userId) {
      res.status(403).json({ error: "This checkout session does not belong to this account.", code: "SESSION_MISMATCH" });
      return;
    }
    const paid = session.payment_status === "paid" || session.status === "complete";
    if (!paid) {
      res.status(409).json({ error: "Payment not completed yet.", code: "PAYMENT_PENDING" });
      return;
    }
    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const subscription = session.subscription as Stripe.Subscription | null;
    const info = subscription
      ? subscriptionInfoFromStripe(subscription, customerId)
      : {
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          subscriptionStatus: "active",
          subscriptionPeriodEndAt: null,
          subscriptionCancelAtPeriodEnd: false,
        };

    await db
      .update(profiles)
      .set({
        subscriptionTier: "standard",
        stripeCustomerId: info.stripeCustomerId,
        stripeSubscriptionId: info.stripeSubscriptionId,
        subscriptionStatus: info.subscriptionStatus,
        subscriptionPeriodEndAt: info.subscriptionPeriodEndAt,
        subscriptionCancelAtPeriodEnd: info.subscriptionCancelAtPeriodEnd,
        providerTrialStartedAt: null,
        providerTrialEndsAt: null,
      })
      .where(eq(profiles.id, userId));

    const entitlement = resolveProviderEntitlement({
      role: "service_provider",
      subscriptionTier: "standard",
      subscriptionStatus: info.subscriptionStatus,
      subscriptionPeriodEndAt: info.subscriptionPeriodEndAt,
      providerTrialStartedAt: null,
      providerTrialEndsAt: null,
    });
    res.json({ success: true, ...entitlement });
  } catch (err) {
    logger.error({ err }, "Failed to claim provider checkout");
    res.status(500).json({ error: "Could not finish subscription. Please try again.", code: "CLAIM_FAILED" });
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
