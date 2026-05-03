/**
 * Usage quotas (reports / chat):
 * - Paid (App Store / Play): anchored to RevenueCat entitlement `expirationDate` stored as
 *   `subscription_period_end_at` — renews when the store subscription period rolls, not on the calendar 1st.
 * - Free: rolling 1-month window from `last_reset_at`.
 */

/** Add N calendar months in UTC, clamping overflow (e.g. Jan 31 → Feb end). */
export function addCalendarMonthsUtc(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCMonth(result.getUTCMonth() + months);
  if (result.getUTCDate() !== day) {
    result.setUTCDate(0);
  }
  return result;
}

function isPaidTier(tier: string | null | undefined): boolean {
  return tier === "pro" || tier === "standard";
}

/**
 * True when the usage period has ended and counts should reset.
 * Paid users prefer the store-reported period end; otherwise rolling month from `lastResetAt`.
 */
export function usagePeriodExpired(
  now: Date,
  lastResetAt: Date,
  subscriptionTier?: string | null,
  subscriptionPeriodEndAt?: Date | null,
): boolean {
  if (isPaidTier(subscriptionTier) && subscriptionPeriodEndAt && !Number.isNaN(subscriptionPeriodEndAt.getTime())) {
    return now.getTime() >= subscriptionPeriodEndAt.getTime();
  }
  const periodEnd = addCalendarMonthsUtc(lastResetAt, 1);
  return now.getTime() >= periodEnd.getTime();
}
