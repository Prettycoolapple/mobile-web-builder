import { ACTIVE_SUBSCRIPTION_STATUSES } from "./stripe";

type ProviderProfileLike = {
  role?: string | null;
  subscriptionTier?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPeriodEndAt?: Date | string | null;
  providerTrialStartedAt?: Date | string | null;
  providerTrialEndsAt?: Date | string | null;
};

export type ProviderAccessKind = "stripe" | "trial" | "iap" | "expired_trial" | "none";

export interface ProviderEntitlement {
  providerAccessActive: boolean;
  providerAccessKind: ProviderAccessKind;
  providerAccessEndsAt: Date | null;
  providerTrialStartedAt: Date | null;
  providerTrialEndsAt: Date | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodAllowsAccess(periodEnd: Date | null, now: Date): boolean {
  return !periodEnd || periodEnd > now;
}

export function resolveProviderEntitlement(
  profile: ProviderProfileLike | null | undefined,
  now = new Date(),
): ProviderEntitlement {
  const trialStartedAt = toDate(profile?.providerTrialStartedAt);
  const trialEndsAt = toDate(profile?.providerTrialEndsAt);
  const periodEnd = toDate(profile?.subscriptionPeriodEndAt);

  const base: ProviderEntitlement = {
    providerAccessActive: false,
    providerAccessKind: "none",
    providerAccessEndsAt: null,
    providerTrialStartedAt: trialStartedAt,
    providerTrialEndsAt: trialEndsAt,
  };

  if (profile?.role !== "service_provider") return base;

  const hasActiveStripe =
    ACTIVE_SUBSCRIPTION_STATUSES.has(profile.subscriptionStatus ?? "") &&
    periodAllowsAccess(periodEnd, now);
  if (hasActiveStripe) {
    return {
      ...base,
      providerAccessActive: true,
      providerAccessKind: "stripe",
      providerAccessEndsAt: periodEnd,
    };
  }

  if (trialEndsAt && trialEndsAt > now) {
    return {
      ...base,
      providerAccessActive: true,
      providerAccessKind: "trial",
      providerAccessEndsAt: trialEndsAt,
    };
  }

  const paidTier = profile.subscriptionTier === "standard" || profile.subscriptionTier === "pro";
  const hasStripeState = !!profile.subscriptionStatus;
  if (!hasStripeState && paidTier && periodAllowsAccess(periodEnd, now)) {
    return {
      ...base,
      providerAccessActive: true,
      providerAccessKind: "iap",
      providerAccessEndsAt: periodEnd,
    };
  }

  if (trialEndsAt && trialEndsAt <= now) {
    return { ...base, providerAccessKind: "expired_trial", providerAccessEndsAt: trialEndsAt };
  }

  return base;
}

export function hasProviderWebEntitlement(profile: ProviderProfileLike | null | undefined, now = new Date()): boolean {
  const entitlement = resolveProviderEntitlement(profile, now);
  return entitlement.providerAccessKind === "stripe" || entitlement.providerAccessKind === "trial";
}
