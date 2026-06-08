import { ACTIVE_SUBSCRIPTION_STATUSES } from "./stripe";
import { getAgentInvitationCode } from "./env";

/** Validate an invitation code against the configured shared code (case/space-insensitive). */
export function isValidInvitationCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return code.trim().toLowerCase() === getAgentInvitationCode().trim().toLowerCase();
}

/** Subset of profile fields needed for entitlement checks. */
export interface EntitlementProfile {
  subscriptionStatus?: string | null;
  subscriptionPeriodEndAt?: Date | string | null;
}

/** Subset of sales_agent_profile fields needed for entitlement checks. */
export interface EntitlementAgentProfile {
  listingPlan?: string | null;
  aiBoostExpiresAt?: Date | string | null;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Whether the agent may create/publish listings.
 * - lifetime (or legacy null plan) → always.
 * - subscription → only while the Stripe subscription is active/trialing AND the
 *   paid period hasn't elapsed.
 */
export function agentCanList(
  profile: EntitlementProfile,
  agentProfile: EntitlementAgentProfile,
): boolean {
  const plan = agentProfile.listingPlan ?? null;
  if (plan === "subscription") {
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(profile.subscriptionStatus ?? "")) return false;
    const periodEnd = toDate(profile.subscriptionPeriodEndAt);
    if (periodEnd && periodEnd.getTime() < Date.now()) return false;
    return true;
  }
  // "lifetime" and legacy/grandfathered (null) agents can always list.
  return true;
}

/**
 * Whether the agent currently gets unlimited AI search/analysis (bypasses the
 * normal report/chat quota).
 * - subscription → while active.
 * - lifetime/invite → while inside the 3-month aiBoostExpiresAt window.
 */
export function agentAiUnlimited(
  profile: EntitlementProfile,
  agentProfile: EntitlementAgentProfile,
): boolean {
  if (agentProfile.listingPlan === "subscription") {
    return agentCanList(profile, agentProfile);
  }
  const boostEnd = toDate(agentProfile.aiBoostExpiresAt);
  return boostEnd !== null && boostEnd.getTime() > Date.now();
}
