import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import type Stripe from "stripe";
import { getConfiguredStripeWebhookSecret, getUncachableStripeClient } from "../lib/stripeClient";
import { verifyToken } from "../lib/auth";
import { getPublicAppUrl } from "../lib/env";
import { logger } from "../lib/logger";

const router = Router();

const PLAN_CONFIG = {
  pro: {
    priceCents: 4900,
    productName: "Project Alpha Pro",
    nickname: "Pro Monthly NZD",
    description: "Unlimited AI property development feasibility reports for NZ",
    tier: "pro",
  },
  sales_agent: {
    priceCents: 9900,
    productName: "Project Alpha Sales Agent",
    nickname: "Sales Agent Monthly NZD",
    description: "Project Alpha Sales Agent subscription — leads, listings & AI placement",
    tier: "pro",
  },
  service_provider: {
    priceCents: 14900,
    productName: "Project Alpha Service Provider",
    nickname: "Service Provider Monthly NZD",
    description: "Project Alpha Service Provider subscription — leads, profile listing & AI placement",
    tier: "pro",
  },
} as const;

type PlanKey = keyof typeof PLAN_CONFIG;

function getBaseUrl(): string {
  return getPublicAppUrl();
}

function getUserIdFromHeader(req: any): string | null {
  const authHeader = req.headers.authorization as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const payload = verifyToken(authHeader.slice(7));
  return payload?.sub ?? null;
}

router.post("/stripe/checkout", async (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const { plan } = req.body as { plan?: string };
  const planKey: PlanKey = plan === "sales_agent" || plan === "service_provider" ? plan : "pro";
  const planCfg = PLAN_CONFIG[planKey];

  try {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }

    if (planKey === "sales_agent" && profile.role !== "sales_agent") {
      res.status(403).json({ error: "This plan is only available to Sales Agents." });
      return;
    }
    if (planKey === "service_provider" && profile.role !== "service_provider") {
      res.status(403).json({ error: "This plan is only available to Service Providers." });
      return;
    }

    const stripe = await getUncachableStripeClient();

    let customerId = profile.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: profile.email,
        name: profile.fullName ?? undefined,
        metadata: { user_id: userId },
      });
      customerId = customer.id;
      await db.update(profiles).set({ stripeCustomerId: customerId }).where(eq(profiles.id, userId));
    }

    const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 100 });
    let priceId = prices.data.find(
      (p) =>
        p.unit_amount === planCfg.priceCents &&
        p.currency === "nzd" &&
        p.recurring?.interval === "month" &&
        p.nickname === planCfg.nickname,
    )?.id;

    if (!priceId) {
      let productId: string;
      const existingProducts = await stripe.products
        .search({ query: `name:'${planCfg.productName}'`, limit: 1 })
        .catch(() => ({ data: [] }));
      if (existingProducts.data.length > 0) {
        productId = existingProducts.data[0].id;
      } else {
        const product = await stripe.products.create({
          name: planCfg.productName,
          description: planCfg.description,
          metadata: { tier: planCfg.tier, plan: planKey },
        });
        productId = product.id;
      }

      const price = await stripe.prices.create({
        product: productId,
        unit_amount: planCfg.priceCents,
        currency: "nzd",
        recurring: { interval: "month" },
        nickname: planCfg.nickname,
      });
      priceId = price.id;
    }

    const base = getBaseUrl();
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/profile?upgraded=true`,
      cancel_url: `${base}/profile`,
      metadata: { user_id: userId, plan: planKey },
      subscription_data: { metadata: { user_id: userId, plan: planKey }, trial_period_days: 14 },
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "Stripe checkout failed");
    res.status(500).json({ error: "Payment setup failed. Please try again or contact support." });
  }
});

router.post("/stripe/portal", async (req, res) => {
  const userId = getUserIdFromHeader(req);
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!profile?.stripeCustomerId) {
      res.status(400).json({ error: "No billing account found" });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const base = getBaseUrl();

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: profile.stripeCustomerId,
      return_url: `${base}/profile`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    logger.error({ err }, "Stripe portal failed");
    res.status(500).json({ error: "Could not open billing portal. Please try again." });
  }
});

router.post("/stripe/webhook", async (req, res) => {
  try {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing Stripe signature" });
      return;
    }

    const sig = Array.isArray(signature) ? signature[0] : signature;
    const stripe = getUncachableStripeClient();
    const event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      sig,
      getConfiguredStripeWebhookSecret(),
    );

    const eventType = event.type;
    const data = event.data.object as Stripe.Subscription | Stripe.Checkout.Session;

    if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") {
      const subscription = data as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      if (userId && subscription.status === "active") {
        const periodEndSec = subscription.current_period_end;
        const periodEnd =
          typeof periodEndSec === "number" ? new Date(periodEndSec * 1000) : null;
        await db
          .update(profiles)
          .set({
            subscriptionTier: "pro",
            reportsUsedThisMonth: 0,
            messagesUsedThisMonth: 0,
            lastResetAt: new Date(),
            subscriptionPeriodEndAt: periodEnd && !Number.isNaN(periodEnd.getTime()) ? periodEnd : null,
          })
          .where(eq(profiles.id, userId))
          .catch(() => {});
        logger.info({ userId }, "Subscription activated — set tier to pro");
      }
    } else if (eventType === "customer.subscription.deleted") {
      const subscription = data as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      if (userId) {
        await db
          .update(profiles)
          .set({ subscriptionTier: "free", subscriptionPeriodEndAt: null })
          .where(eq(profiles.id, userId))
          .catch(() => {});
        logger.info({ userId }, "Subscription cancelled — set tier to free");
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, "Stripe webhook processing failed");
    res.status(400).json({ error: "Webhook processing failed" });
  }
});

router.post("/subscription/sync", async (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { verifyToken } = await import("../lib/auth");
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

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
      .where(eq(profiles.id, payload.sub))
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
        .where(eq(profiles.id, payload.sub));
      res.json({ success: true, tier });
      return;
    }

    const storedEnd = row.subscriptionPeriodEndAt ? new Date(row.subscriptionPeriodEndAt) : null;
    const hasValidStoredEnd = storedEnd !== null && !Number.isNaN(storedEnd.getTime());
    let resetUsage = false;

    if (!wasPaid) {
      resetUsage = true;
    } else if (incomingEnd && hasValidStoredEnd && incomingEnd.getTime() > storedEnd!.getTime()) {
      // App Store / Play renewed — entitlement expiration moved forward; start a new usage window.
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
        .where(eq(profiles.id, payload.sub));
    } else {
      const patch: {
        subscriptionTier: string;
        subscriptionPeriodEndAt?: Date | null;
      } = { subscriptionTier: tier };
      if (incomingEnd) {
        patch.subscriptionPeriodEndAt = incomingEnd;
      }
      await db.update(profiles).set(patch).where(eq(profiles.id, payload.sub));
    }

    res.json({ success: true, tier });
  } catch (err) {
    logger.error({ err }, "Failed to sync subscription");
    res.status(500).json({ error: "Failed to sync subscription" });
  }
});

export default router;
