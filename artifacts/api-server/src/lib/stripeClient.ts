import Stripe from "stripe";
import { getStripePublishableKey as readStripePublishableKey, getStripeSecretKey, getStripeWebhookSecret } from "./env";

let stripeClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(getStripeSecretKey(), { apiVersion: "2025-08-27.basil" as any });
  }

  return stripeClient;
}

export function getUncachableStripeClient(): Stripe {
  return new Stripe(getStripeSecretKey(), { apiVersion: "2025-08-27.basil" as any });
}

export function getStripePublishableKey(): string {
  return readStripePublishableKey();
}

export function getConfiguredStripeWebhookSecret(): string {
  return getStripeWebhookSecret();
}
