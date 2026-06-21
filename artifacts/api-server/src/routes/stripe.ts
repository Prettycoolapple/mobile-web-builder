import { Router } from "express";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db, profiles, listings, pendingAgentSignups } from "@workspace/db";
import { getStripe, subscriptionInfoFromStripe, ACTIVE_SUBSCRIPTION_STATUSES } from "../lib/stripe";
import { getStripeWebhookSecret } from "../lib/env";
import { createAgentAccountFromPending } from "../lib/agent-account";
import { logger } from "../lib/logger";

const router = Router();

/** Pause an agent's live listings (hide from buyers) when their plan lapses. */
async function pauseAgentListings(userId: string): Promise<void> {
  await db
    .update(listings)
    .set({ status: "paused" })
    .where(and(eq(listings.userId, userId), eq(listings.status, "active")));
}

/** Sync the latest subscription state onto the matching profile (by sub id). */
async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const info = subscriptionInfoFromStripe(sub);
  const [profile] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.stripeSubscriptionId, sub.id))
    .limit(1);
  if (!profile) {
    // The account may not exist yet (subscription event arrived before
    // checkout.session.completed). It will be created with current state then.
    return;
  }

  const active = ACTIVE_SUBSCRIPTION_STATUSES.has(info.subscriptionStatus ?? "");
  await db
    .update(profiles)
    .set({
      ...(profile.role === "service_provider" ? { subscriptionTier: active ? "standard" : "free" } : {}),
      subscriptionStatus: info.subscriptionStatus,
      subscriptionPeriodEndAt: info.subscriptionPeriodEndAt,
      subscriptionCancelAtPeriodEnd: info.subscriptionCancelAtPeriodEnd,
      stripeCustomerId: info.stripeCustomerId,
      ...(profile.role === "service_provider" && active
        ? { providerTrialStartedAt: null, providerTrialEndsAt: null }
        : {}),
    })
    .where(eq(profiles.id, profile.id));

  // On lapse (status left active/trialing) auto-pause their live listings.
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(info.subscriptionStatus ?? "")) {
    await pauseAgentListings(profile.id);
  }
}

// POST /stripe/webhook — raw body is provided by express.raw() in app.ts.
router.post("/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body as Buffer, sig, getStripeWebhookSecret());
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Stripe webhook signature verification failed");
    res.status(400).send("Webhook signature verification failed");
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription") break;
        const pendingId = session.metadata?.pendingSignupId;
        const providerUserId = session.metadata?.providerUserId;
        if (!pendingId && providerUserId) {
          const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
          const subInfo = subId
            ? subscriptionInfoFromStripe(await getStripe().subscriptions.retrieve(subId), customerId)
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
              stripeCustomerId: subInfo.stripeCustomerId,
              stripeSubscriptionId: subInfo.stripeSubscriptionId,
              subscriptionStatus: subInfo.subscriptionStatus,
              subscriptionPeriodEndAt: subInfo.subscriptionPeriodEndAt,
              subscriptionCancelAtPeriodEnd: subInfo.subscriptionCancelAtPeriodEnd,
              providerTrialStartedAt: null,
              providerTrialEndsAt: null,
            })
            .where(eq(profiles.id, providerUserId));
          logger.info({ providerUserId }, "Stripe: provider subscription attached from checkout.session.completed");
          break;
        }
        if (!pendingId) break;

        const [pending] = await db
          .select()
          .from(pendingAgentSignups)
          .where(eq(pendingAgentSignups.id, pendingId))
          .limit(1);
        if (!pending) break;

        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null;
        const subInfo = subId
          ? subscriptionInfoFromStripe(await getStripe().subscriptions.retrieve(subId), customerId)
          : {
              stripeCustomerId: customerId,
              stripeSubscriptionId: null,
              subscriptionStatus: "active",
              subscriptionPeriodEndAt: null,
              subscriptionCancelAtPeriodEnd: false,
            };

        await createAgentAccountFromPending(pending, subInfo);
        logger.info({ pendingId, email: pending.email }, "Stripe: agent account created from checkout.session.completed");
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null };
        const subId =
          typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id ?? null;
        if (subId) {
          const [profile] = await db
            .select({ id: profiles.id, role: profiles.role })
            .from(profiles)
            .where(eq(profiles.stripeSubscriptionId, subId))
            .limit(1);
          await db
            .update(profiles)
            .set({ subscriptionStatus: "past_due", ...(profile?.role === "service_provider" ? { subscriptionTier: "free" } : {}) })
            .where(eq(profiles.stripeSubscriptionId, subId));
          if (profile) {
            await pauseAgentListings(profile.id);
          }
        }
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    logger.error({ err, type: event.type }, "Stripe webhook handler failed");
    res.status(500).json({ error: "Webhook handler failed" });
  }
});

export default router;
