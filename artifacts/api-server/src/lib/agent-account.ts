import { eq } from "drizzle-orm";
import { db, profiles, salesAgentProfiles, pendingAgentSignups, type PendingAgentSignup } from "@workspace/db";
import { consumePhoneVerification } from "../routes/otp";
import { sendNewUserSignupNotification } from "./mailer";
import { logger } from "./logger";
import { checkPhoneCanRegister, normalizeRegistrationPhone } from "./phone-registration";

export interface AgentSubscriptionInfo {
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionPeriodEndAt: Date | null;
  subscriptionCancelAtPeriodEnd: boolean;
}

export interface EnsuredAgentAccount {
  profileId: string;
  email: string;
  role: string;
  created: boolean;
}

async function markPendingCompleted(pendingId: string): Promise<void> {
  await db
    .update(pendingAgentSignups)
    .set({ status: "completed" })
    .where(eq(pendingAgentSignups.id, pendingId));
}

async function findProfileByEmail(email: string) {
  const rows = await db
    .select({ id: profiles.id, email: profiles.email, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.email, email))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create the sales-agent account for a paid subscription, from a pending signup
 * row. IDEMPOTENT: safe to call from BOTH the Stripe webhook and the portal
 * claim endpoint (and from a concurrent race between them). If a profile for the
 * email already exists it is reused and its subscription fields refreshed; the
 * OTP is consumed and the pending row marked completed only on first creation.
 */
export async function createAgentAccountFromPending(
  pending: PendingAgentSignup,
  sub: AgentSubscriptionInfo,
): Promise<EnsuredAgentAccount> {
  const email = pending.email.toLowerCase().trim();
  const phoneNumber = normalizeRegistrationPhone(pending.phoneNumber);

  // Fast path: already created (e.g. webhook ran first).
  const existing = await findProfileByEmail(email);
  if (existing) {
    await db
      .update(profiles)
      .set({
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        subscriptionStatus: sub.subscriptionStatus,
        subscriptionPeriodEndAt: sub.subscriptionPeriodEndAt,
        subscriptionCancelAtPeriodEnd: sub.subscriptionCancelAtPeriodEnd,
      })
      .where(eq(profiles.id, existing.id));
    await markPendingCompleted(pending.id).catch(() => {});
    return { profileId: existing.id, email, role: existing.role, created: false };
  }

  const languages = [pending.primaryLanguage];

  try {
    const profile = await db.transaction(async (tx) => {
      const phoneBlock = await checkPhoneCanRegister(tx, phoneNumber, "sales_agent");
      if (!phoneBlock.allowed) {
        throw Object.assign(new Error(phoneBlock.message), { phoneRegistrationBlock: phoneBlock });
      }

      // Consume the OTP now that the account is actually being created. Payment
      // already succeeded, so we don't block creation if it was already consumed
      // (e.g. a concurrent path) — just log.
      const consumed = await consumePhoneVerification(pending.phoneVid, phoneNumber, tx);
      if (!consumed) {
        logger.warn({ pendingId: pending.id }, "Agent account creation: OTP already consumed (continuing)");
      }

      const [newProfile] = await tx
        .insert(profiles)
        .values({
          email,
          fullName: pending.fullName,
          passwordHash: pending.passwordHash,
          role: "sales_agent",
          languages,
          subscriptionTier: "free",
          reportsUsedThisMonth: 0,
          phoneNumber,
          phoneVerifiedAt: new Date(),
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          subscriptionStatus: sub.subscriptionStatus,
          subscriptionPeriodEndAt: sub.subscriptionPeriodEndAt,
          subscriptionCancelAtPeriodEnd: sub.subscriptionCancelAtPeriodEnd,
        })
        .returning({ id: profiles.id, email: profiles.email, role: profiles.role });

      await tx.insert(salesAgentProfiles).values({
        userId: newProfile.id,
        agencyName: pending.agencyName,
        reaaLicenceNumber: pending.reaaLicenceNumber,
        languages,
        regionsCovered: [],
        propertyTypes: [],
        listingPlan: "subscription",
      });

      return newProfile;
    });

    await markPendingCompleted(pending.id).catch(() => {});

    await sendNewUserSignupNotification({
      role: "sales_agent",
      profileId: profile.id,
      email: profile.email,
      fullName: pending.fullName,
      phone: phoneNumber,
      languages,
      agentData: {
        agencyName: pending.agencyName,
        reaaLicenceNumber: pending.reaaLicenceNumber,
      },
    }).catch((mailErr) => {
      logger.warn({ mailErr, userId: profile.id, email }, "New sales-agent signup owner email failed");
    });

    return { profileId: profile.id, email, role: profile.role, created: true };
  } catch (err) {
    // Likely a unique-email race with the other creator (webhook vs claim).
    // Re-resolve the now-existing profile and treat as success.
    const raced = await findProfileByEmail(email);
    if (raced) {
      await markPendingCompleted(pending.id).catch(() => {});
      return { profileId: raced.id, email, role: raced.role, created: false };
    }
    throw err;
  }
}
