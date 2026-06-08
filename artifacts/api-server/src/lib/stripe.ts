import Stripe from "stripe";
import { getStripeSecretKey } from "./env";
import type { AgentSubscriptionInfo } from "./agent-account";

let cached: Stripe | null = null;

/**
 * Lazily-initialised Stripe client. Lazy so the server can boot in environments
 * where Stripe isn't configured (the key is only required when an agent actually
 * subscribes or a webhook fires).
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  cached = new Stripe(getStripeSecretKey(), {
    // Use the SDK's pinned API version (keeps webhook payload shapes predictable).
    appInfo: { name: "ProjectAlpha-SalesPortal" },
  });
  return cached;
}

/** Stripe subscription statuses we treat as "the agent may list". */
export const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/**
 * Normalise a Stripe Subscription into the fields we persist. Handles the API
 * shift where `current_period_end` may live on the subscription item rather than
 * the subscription itself.
 */
export function subscriptionInfoFromStripe(
  sub: Stripe.Subscription,
  fallbackCustomerId?: string | null,
): AgentSubscriptionInfo {
  const anySub = sub as unknown as { current_period_end?: number };
  const periodEndUnix =
    anySub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  return {
    stripeCustomerId: customerIdOf(sub.customer) ?? fallbackCustomerId ?? null,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: sub.status,
    subscriptionPeriodEndAt: periodEndUnix ? new Date(periodEndUnix * 1000) : null,
    subscriptionCancelAtPeriodEnd: sub.cancel_at_period_end === true,
  };
}
