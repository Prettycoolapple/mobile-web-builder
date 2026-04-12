import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { getUncachableStripeClient, getStripeSync } from "../lib/stripeClient";
import { verifyToken } from "../lib/auth";
import { logger } from "../lib/logger";

const router = Router();

const PRO_PRICE_NZD_CENTS = 4900;
const PRO_PRODUCT_NAME = "DevFeasible NZ Pro";

function getBaseUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  return "http://localhost:8080";
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

  try {
    const [profile] = await db.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
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

    const prices = await stripe.prices.list({ active: true, type: "recurring", limit: 20 });
    let priceId = prices.data.find(
      (p) => p.unit_amount === PRO_PRICE_NZD_CENTS && p.currency === "nzd" && p.recurring?.interval === "month",
    )?.id;

    if (!priceId) {
      let productId: string;
      const existingProducts = await stripe.products.search({ query: `name:'${PRO_PRODUCT_NAME}'`, limit: 1 }).catch(() => ({ data: [] }));
      if (existingProducts.data.length > 0) {
        productId = existingProducts.data[0].id;
      } else {
        const product = await stripe.products.create({
          name: PRO_PRODUCT_NAME,
          description: "Unlimited AI property development feasibility reports for NZ",
          metadata: { tier: "pro" },
        });
        productId = product.id;
      }

      const price = await stripe.prices.create({
        product: productId,
        unit_amount: PRO_PRICE_NZD_CENTS,
        currency: "nzd",
        recurring: { interval: "month" },
        nickname: "Pro Monthly NZD",
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
      metadata: { user_id: userId },
      subscription_data: { metadata: { user_id: userId } },
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
    const stripeSync = await getStripeSync();
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing Stripe signature" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    await stripeSync.processWebhook(req.body as Buffer, sig);

    const body = (() => {
      try { return JSON.parse(req.body.toString()); } catch { return {}; }
    })();

    const eventType: string = body?.type ?? "";
    const data = body?.data?.object ?? {};

    if (eventType === "customer.subscription.created" || eventType === "customer.subscription.updated") {
      const userId: string | undefined = data?.metadata?.user_id;
      if (userId && data.status === "active") {
        await db.update(profiles).set({ subscriptionTier: "pro", reportsUsedThisMonth: 0 }).where(eq(profiles.id, userId)).catch(() => {});
        logger.info({ userId }, "Subscription activated — set tier to pro");
      }
    } else if (eventType === "customer.subscription.deleted") {
      const userId: string | undefined = data?.metadata?.user_id;
      if (userId) {
        await db.update(profiles).set({ subscriptionTier: "free" }).where(eq(profiles.id, userId)).catch(() => {});
        logger.info({ userId }, "Subscription cancelled — set tier to free");
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err }, "Stripe webhook processing failed");
    res.status(400).json({ error: "Webhook processing failed" });
  }
});

export default router;
