import { describe, expect, it } from "vitest";
import { resolveProviderEntitlement } from "../provider-entitlements";

const now = new Date("2026-06-21T00:00:00.000Z");
const future = new Date("2026-06-28T00:00:00.000Z");
const past = new Date("2026-06-14T00:00:00.000Z");

describe("provider entitlements", () => {
  it("allows active Stripe provider subscriptions", () => {
    expect(
      resolveProviderEntitlement({
        role: "service_provider",
        subscriptionTier: "standard",
        subscriptionStatus: "active",
        subscriptionPeriodEndAt: future,
      }, now),
    ).toMatchObject({
      providerAccessActive: true,
      providerAccessKind: "stripe",
      providerAccessEndsAt: future,
    });
  });

  it("allows active invitation-code trials even when the stored tier is free", () => {
    expect(
      resolveProviderEntitlement({
        role: "service_provider",
        subscriptionTier: "free",
        providerTrialStartedAt: now,
        providerTrialEndsAt: future,
      }, now),
    ).toMatchObject({
      providerAccessActive: true,
      providerAccessKind: "trial",
      providerAccessEndsAt: future,
    });
  });

  it("blocks expired invitation-code trials without active paid access", () => {
    expect(
      resolveProviderEntitlement({
        role: "service_provider",
        subscriptionTier: "free",
        providerTrialStartedAt: past,
        providerTrialEndsAt: past,
      }, now),
    ).toMatchObject({
      providerAccessActive: false,
      providerAccessKind: "expired_trial",
      providerAccessEndsAt: past,
    });
  });

  it("does not treat inactive Stripe state as mobile paid access", () => {
    expect(
      resolveProviderEntitlement({
        role: "service_provider",
        subscriptionTier: "standard",
        subscriptionStatus: "canceled",
        subscriptionPeriodEndAt: future,
      }, now),
    ).toMatchObject({
      providerAccessActive: false,
      providerAccessKind: "none",
    });
  });
});
