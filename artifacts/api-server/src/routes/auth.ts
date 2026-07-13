import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import crypto from "node:crypto";
import {
  db,
  passwordResetTokens,
  profiles,
  salesAgentProfiles,
  serviceProviderProfiles,
  userLoginEvents,
  userUploads,
  pendingAgentSignups,
  pendingProviderSignups,
  type PendingProviderSignup,
} from "@workspace/db";
import { createSessionId, hashPassword, verifyPassword, signToken, requireAuth } from "../lib/auth";
import { ipRateLimit, bodyFieldRateLimit, minutes, hours } from "../lib/rateLimit";
import { noteSignup } from "../lib/abuse";
import { sendNewUserSignupNotification, sendPasswordResetCodeEmail } from "../lib/mailer";
import { usagePeriodExpired } from "../lib/billingPeriod";
import { verifyPhoneVerificationToken, consumePhoneVerification } from "./otp";
import {
  getPublicAppUrl,
  getSalesPortalUrl,
  getStripeAgentPriceId,
  getProviderPortalUrl,
  getStripeProviderPriceId,
  getProviderInvitationCode,
  isSalesAgentFreeSignupEnabled,
} from "../lib/env";
import { getStripe, subscriptionInfoFromStripe } from "../lib/stripe";
import { resolveProviderEntitlement } from "../lib/provider-entitlements";
import { agentAiUnlimited, isValidInvitationCode } from "../lib/agent-entitlements";
import { createAgentAccountFromPending, type AgentSubscriptionInfo } from "../lib/agent-account";
import type Stripe from "stripe";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { createStorageReviewToken } from "../lib/storage-review-token";
import { runAfterResponse } from "../lib/vercel-wait-until";
import { checkPhoneLineTypeForSignup, sendPhoneLineTypeBlock } from "../lib/phone-line-type";
import { checkSignupCreationLimits, sendSignupLimitBlock } from "../lib/signup-limits";
import { touchUserLastActive } from "../lib/user-activity";
import {
  checkPhoneCanRegister,
  normalizeRegistrationPhone,
  recordPhoneAccountDeletion,
  type PhoneRegistrationBlock,
} from "../lib/phone-registration";
import { claimOutstandingLimTitleLeads } from "../lib/lim-title-leads";

const router = Router();
const objectStorageService = new ObjectStorageService();
const PROVIDER_TRIAL_DAYS = 14;

type SignupNotificationArgs = Parameters<typeof sendNewUserSignupNotification>[0];

function queueSignupNotification(req: any, args: SignupNotificationArgs): void {
  runAfterResponse(
    sendNewUserSignupNotification(args).catch((mailErr) => {
      req.log?.warn?.({ mailErr, userId: args.profileId, email: args.email, role: args.role }, "New signup owner email failed");
    }),
  );
}

function sendPhoneRegistrationBlock(res: any, block: Exclude<PhoneRegistrationBlock, { allowed: true }>): void {
  res.status(block.status).json({
    error: block.message,
    code: block.code,
    retryAfterSeconds: block.retryAfterSeconds,
    blockedUntil: block.blockedUntil ? block.blockedUntil.toISOString() : undefined,
  });
}

async function guardPhoneAndSignupLimits(req: any, res: any, phoneNumber: string): Promise<boolean> {
  const lineType = await checkPhoneLineTypeForSignup(phoneNumber);
  if (!lineType.allowed) {
    sendPhoneLineTypeBlock(res, lineType);
    return false;
  }

  const signupLimit = await checkSignupCreationLimits(req);
  if (!signupLimit.allowed) {
    sendSignupLimitBlock(res, signupLimit);
    return false;
  }

  return true;
}

const salesAgentSchema = z.object({
  agencyName: z.string().optional(),
  reaaLicenceNumber: z.string().optional(),
  yearsExperience: z.number().int().min(0).optional(),
  regionsCovered: z.array(z.string()).default([]),
  propertyTypes: z.array(z.string()).default([]),
  websiteUrl: z.string().optional(),
  bio: z.string().optional(),
});

const serviceProviderSchema = z.object({
  companyName: z.string().optional(),
  nzCompanyRegisterNumber: z.string().optional(),
  discipline: z
    .enum(["architect_designer", "planner", "engineer", "quantity_surveyor", "other"])
    .optional(),
  otherDiscipline: z.string().optional(),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostcode: z.string().optional(),
  contactNumber: z.string().optional(),
  incorporationCertUrl: z.string().optional(),
  primaryLanguage: z.string().optional(),
  secondaryLanguage: z.string().optional(),
  avatarUrl: z.string().optional(),
});

const signupSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    fullName: z.string().min(1).optional(),
    role: z.enum(["general", "sales_agent", "service_provider"]).default("general"),
    languages: z.array(z.string()).default([]),
    phoneNumber: z.string().min(1),
    phoneVerificationToken: z.string().min(1),
    agentData: salesAgentSchema.optional(),
    providerData: serviceProviderSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.role === "sales_agent" && !data.agentData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "agentData is required for sales_agent role",
        path: ["agentData"],
      });
    }
    if (data.role === "sales_agent" && !data.agentData?.reaaLicenceNumber?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "REA licence number is required.",
        path: ["agentData", "reaaLicenceNumber"],
      });
    }
    if (data.role === "service_provider") {
      if (!data.providerData) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "providerData is required for service_provider role",
          path: ["providerData"],
        });
        return;
      }
      const p = data.providerData;
      const required: Array<{ key: keyof typeof p; label: string }> = [
        { key: "companyName", label: "Company name is required." },
        { key: "nzCompanyRegisterNumber", label: "NZ Companies Register number is required." },
        { key: "discipline", label: "Discipline is required." },
        { key: "contactNumber", label: "Contact number is required." },
        { key: "primaryLanguage", label: "Primary language is required." },
      ];
      for (const r of required) {
        const v = p[r.key];
        if (!v || (typeof v === "string" && v.trim().length === 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: r.label,
            path: ["providerData", r.key],
          });
        }
      }
      if (p.discipline === "other" && !p.otherDiscipline?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Please describe your discipline.",
          path: ["providerData", "otherDiscipline"],
        });
      }
    }
  });

const PASSWORD_RESET_TTL_MINUTES = 15;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;

const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  email: z.string().email(),
  code: z.string().min(4).max(12),
  password: z.string().min(8),
});

const salesAgentWebSignupSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(2),
    phoneNumber: z.string().min(1),
    phoneVerificationToken: z.string().min(1),
    primaryLanguage: z.string().min(1),
    agencyName: z.string().min(1),
    reaaLicenceNumber: z.string().min(1, "REA licence number is required."),
    // Present on the invitation-code path; absent on the subscribe path.
    invitationCode: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const phone = normalizeRegistrationPhone(data.phoneNumber);
    if (!/^\+64\d{7,10}$/.test(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid New Zealand mobile or contact number starting with +64.",
        path: ["phoneNumber"],
      });
    }
  });

const salesAgentWebProfileSchema = z
  .object({
    fullName: z.string().min(2),
    phoneNumber: z.string().min(1),
    primaryLanguage: z.string().min(1),
    agencyName: z.string().min(1),
    reaaLicenceNumber: z.string().min(1, "REA licence number is required."),
    phoneVerificationToken: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    const phone = normalizeRegistrationPhone(data.phoneNumber);
    if (!/^\+64\d{7,10}$/.test(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid New Zealand mobile or contact number starting with +64.",
        path: ["phoneNumber"],
      });
    }
  });

const serviceProviderWebProfileSchema = z
  .object({
    fullName: z.string().min(2),
    phoneNumber: z.string().min(1),
    primaryLanguage: z.string().min(1),
    secondaryLanguage: z.string().optional(),
    companyName: z.string().min(1),
    nzCompanyRegisterNumber: z.string().min(1),
    discipline: z.enum(["architect_designer", "planner", "engineer", "quantity_surveyor", "other"]),
    otherDiscipline: z.string().optional(),
    contactNumber: z.string().optional(),
    addressStreet: z.string().optional(),
    addressSuburb: z.string().optional(),
    addressCity: z.string().optional(),
    addressPostcode: z.string().optional(),
    bio: z.string().max(1200).optional(),
  })
  .superRefine((data, ctx) => {
    const phone = normalizeRegistrationPhone(data.phoneNumber);
    if (!/^\+64\d{7,10}$/.test(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid New Zealand mobile or contact number starting with +64.",
        path: ["phoneNumber"],
      });
    }
    const contact = normalizeRegistrationPhone(data.contactNumber ?? "");
    if (contact && !/^\+64\d{7,10}$/.test(contact)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid New Zealand contact number starting with +64.",
        path: ["contactNumber"],
      });
    }
    if (data.discipline === "other" && !data.otherDiscipline?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please describe your discipline.",
        path: ["otherDiscipline"],
      });
    }
  });

const serviceProviderWebSignupSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(2),
    phoneNumber: z.string().min(1),
    phoneVerificationToken: z.string().min(1),
    primaryLanguage: z.string().min(1),
    companyName: z.string().min(1),
    nzCompanyRegisterNumber: z.string().min(1),
    discipline: z.string().min(1),
    otherDiscipline: z.string().optional(),
    secondaryLanguage: z.string().optional(),
    addressStreet: z.string().optional(),
    addressSuburb: z.string().optional(),
    addressCity: z.string().optional(),
    addressPostcode: z.string().optional(),
    invitationCode: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    const phone = normalizeRegistrationPhone(data.phoneNumber);
    if (!/^\+64\d{7,10}$/.test(phone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter a valid New Zealand mobile or contact number starting with +64.",
        path: ["phoneNumber"],
      });
    }
  });

async function createProviderAccountFromPending(
  pending: PendingProviderSignup,
  sub: AgentSubscriptionInfo,
): Promise<{ profileId: string; email: string; created: boolean }> {
  const email = pending.email.toLowerCase().trim();
  const languages = [pending.primaryLanguage, ...(pending.secondaryLanguage ? [pending.secondaryLanguage] : [])];

  async function markDone() {
    await db
      .update(pendingProviderSignups)
      .set({ status: "completed" })
      .where(eq(pendingProviderSignups.id, pending.id))
      .catch(() => {});
  }

  const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, email)).limit(1);
  if (existing[0]) {
    await db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({
          role: "service_provider",
          subscriptionTier: "standard",
          stripeCustomerId: sub.stripeCustomerId,
          stripeSubscriptionId: sub.stripeSubscriptionId,
          subscriptionStatus: sub.subscriptionStatus,
          subscriptionPeriodEndAt: sub.subscriptionPeriodEndAt,
          subscriptionCancelAtPeriodEnd: sub.subscriptionCancelAtPeriodEnd,
          providerTrialStartedAt: null,
          providerTrialEndsAt: null,
        })
        .where(eq(profiles.id, existing[0].id));

      await tx
        .insert(serviceProviderProfiles)
        .values({
          userId: existing[0].id,
          companyName: pending.companyName,
          nzCompanyRegisterNumber: pending.nzCompanyRegisterNumber,
          discipline: pending.discipline,
          otherDiscipline: pending.otherDiscipline ?? null,
          primaryLanguage: pending.primaryLanguage,
          secondaryLanguage: pending.secondaryLanguage ?? null,
          contactNumber: pending.phoneNumber,
          languages,
          addressStreet: pending.addressStreet ?? null,
          addressSuburb: pending.addressSuburb ?? null,
          addressCity: pending.addressCity ?? null,
          addressPostcode: pending.addressPostcode ?? null,
        })
        .onConflictDoNothing();
    });
    await markDone();
    return { profileId: existing[0].id, email, created: false };
  }

  const newProfile = await db.transaction(async (tx) => {
    await consumePhoneVerification(pending.phoneVid, pending.phoneNumber, tx);

    const [p] = await tx
      .insert(profiles)
      .values({
        email,
        fullName: pending.fullName,
        passwordHash: pending.passwordHash,
        role: "service_provider",
        languages,
        subscriptionTier: "standard",
        reportsUsedThisMonth: 0,
        phoneNumber: pending.phoneNumber,
        phoneVerifiedAt: new Date(),
        stripeCustomerId: sub.stripeCustomerId,
        stripeSubscriptionId: sub.stripeSubscriptionId,
        subscriptionStatus: sub.subscriptionStatus,
        subscriptionPeriodEndAt: sub.subscriptionPeriodEndAt,
        subscriptionCancelAtPeriodEnd: sub.subscriptionCancelAtPeriodEnd,
        providerTrialStartedAt: null,
        providerTrialEndsAt: null,
      })
      .returning({ id: profiles.id, email: profiles.email });

    await tx.insert(serviceProviderProfiles).values({
      userId: p.id,
      companyName: pending.companyName,
      nzCompanyRegisterNumber: pending.nzCompanyRegisterNumber,
      discipline: pending.discipline,
      otherDiscipline: pending.otherDiscipline ?? null,
      primaryLanguage: pending.primaryLanguage,
      secondaryLanguage: pending.secondaryLanguage ?? null,
      contactNumber: pending.phoneNumber,
      languages,
      addressStreet: pending.addressStreet ?? null,
      addressSuburb: pending.addressSuburb ?? null,
      addressCity: pending.addressCity ?? null,
      addressPostcode: pending.addressPostcode ?? null,
    });

    return p;
  });

  await markDone();
  return { profileId: newProfile.id, email, created: true };
}

function resolvePasswordResetSecret(): string {
  const secret = process.env.PASSWORD_RESET_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("PASSWORD_RESET_SECRET (or SESSION_SECRET) must be set in production");
    }
    const dev = crypto.randomBytes(32).toString("hex");
    process.env.PASSWORD_RESET_SECRET = dev;
    return dev;
  }
  return secret;
}

const PASSWORD_RESET_SECRET = resolvePasswordResetSecret();

function objectPathFromStorageUrl(fileUrl: string | undefined): string | null {
  if (!fileUrl) return null;
  const relativeMatch = fileUrl.match(/\/api\/storage(\/objects\/[^?#]+)/);
  if (relativeMatch?.[1]) return relativeMatch[1];
  try {
    const parsed = new URL(fileUrl);
    const absoluteMatch = parsed.pathname.match(/\/api\/storage(\/objects\/[^?#]+)/);
    return absoluteMatch?.[1] ?? null;
  } catch {
    return null;
  }
}

async function assertUploadedObjectExists(objectPath: string): Promise<void> {
  if (objectStorageService.isLocal) {
    if (!objectStorageService.localFileExists(objectPath)) throw new ObjectNotFoundError();
    return;
  }
  await objectStorageService.getObjectEntityFile(objectPath);
}

function makeReviewUrl(objectPath: string): string {
  const token = createStorageReviewToken(objectPath);
  return `${getPublicAppUrl()}/api/storage/review${objectPath}?token=${encodeURIComponent(token)}`;
}

const passwordResetRateBuckets = new Map<string, number[]>();
function rateLimitPasswordReset(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = (passwordResetRateBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (arr.length >= limit) {
    passwordResetRateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  passwordResetRateBuckets.set(key, arr);
  return true;
}

function clientIp(req: { ip?: string }): string {
  return req.ip || "unknown";
}

function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

// Record a login event without blocking the response. Fire-and-forget — best-effort
// for admin retention/cohort analytics; failure must never break auth.
function recordLoginEvent(userId: string): void {
  void (async () => {
    try {
      const now = new Date();
      await touchUserLastActive(userId, now);
      await db.insert(userLoginEvents).values({ userId });
    } catch {
      // intentionally swallow — analytics must not impact auth
    }
  })();
}

function providerAccessPayload(profile: {
  role?: string | null;
  subscriptionTier?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPeriodEndAt?: Date | string | null;
  createdAt?: Date | string | null;
  providerTrialStartedAt?: Date | string | null;
  providerTrialEndsAt?: Date | string | null;
}) {
  return resolveProviderEntitlement(profile);
}

function createProviderTrialWindow(now = new Date()): { startedAt: Date; endsAt: Date } {
  return {
    startedAt: now,
    endsAt: new Date(now.getTime() + PROVIDER_TRIAL_DAYS * 24 * 60 * 60 * 1000),
  };
}

function generateResetCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function hashResetCode(code: string, email: string): string {
  return crypto
    .createHmac("sha256", PASSWORD_RESET_SECRET)
    .update(`${email}:${code.trim()}`)
    .digest("hex");
}

function genericResetResponse() {
  return { ok: true, expiresInSeconds: PASSWORD_RESET_TTL_MINUTES * 60 };
}

router.post(
  "/signup",
  // Signup is rare per IP; phone OTP already gates it. This caps account
  // farming (the cheap path to many harvesting accounts) from one host.
  ipRateLimit({ name: "signup", windowMs: hours(1), max: 15 }),
  ipRateLimit({ name: "signup-min", windowMs: minutes(1), max: 5 }),
  async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.status(400).json({
      error: firstError?.message || "Invalid signup data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const {
    email,
    password,
    firstName,
    lastName,
    role,
    languages,
    phoneNumber,
    phoneVerificationToken,
    agentData,
    providerData,
  } = parsed.data;
  const emailLower = email.toLowerCase().trim();
  const phoneTrimmed = normalizeRegistrationPhone(phoneNumber);
  const verifiedPhone = verifyPhoneVerificationToken(phoneVerificationToken, phoneTrimmed);
  if (!verifiedPhone) {
    res.status(400).json({
      error: "Phone verification token is invalid or expired. Please re-verify your number.",
      code: "PHONE_NOT_VERIFIED",
    });
    return;
  }
  const fullName =
    parsed.data.fullName?.trim() ||
    (firstName && lastName ? `${firstName.trim()} ${lastName.trim()}` : null);

  try {
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({
        error: "An account with this email already exists",
        code: "EMAIL_TAKEN",
      });
      return;
    }

    if (!(await guardPhoneAndSignupLimits(req, res, phoneTrimmed))) return;

    const passwordHash = await hashPassword(password);

    const sessionId = createSessionId();
    const signupResult = await db.transaction(async (tx) => {
      const phoneBlock = await checkPhoneCanRegister(tx, phoneTrimmed, role);
      if (!phoneBlock.allowed) return { phoneBlock };

      // Atomically consume the verification row inside the phone-registration
      // transaction so this token cannot be replayed during a concurrent signup.
      const consumed = await consumePhoneVerification(verifiedPhone.vid, phoneTrimmed, tx);
      if (!consumed) return { phoneConsumed: false as const };

      const [newProfile] = await tx
        .insert(profiles)
        .values({
          email: emailLower,
          fullName,
          passwordHash,
          role,
          languages,
          subscriptionTier: "free",
          reportsUsedThisMonth: 0,
          phoneNumber: phoneTrimmed,
          phoneVerifiedAt: new Date(),
          activeSessionId: sessionId,
        })
        .returning({
          id: profiles.id,
          email: profiles.email,
          fullName: profiles.fullName,
          role: profiles.role,
          languages: profiles.languages,
          subscriptionTier: profiles.subscriptionTier,
          reportsUsedThisMonth: profiles.reportsUsedThisMonth,
        });

      if (role === "sales_agent") {
        await tx.insert(salesAgentProfiles).values({
          userId: newProfile.id,
          agencyName: agentData?.agencyName,
          reaaLicenceNumber: agentData?.reaaLicenceNumber,
          yearsExperience: agentData?.yearsExperience,
          regionsCovered: agentData?.regionsCovered ?? [],
          propertyTypes: agentData?.propertyTypes ?? [],
          languages,
          websiteUrl: agentData?.websiteUrl,
          bio: agentData?.bio,
          // Account creation is free; publishing remains gated until this
          // agent activates Stripe or converts the row to lifetime via an
          // invitation code.
          listingPlan: "subscription",
          aiBoostExpiresAt: null,
        });
      }

      if (role === "service_provider") {
        // Override any user-supplied contactNumber with the verified phone — the
        // provider profile shares the same number that was OTP-verified.
        if (providerData) providerData.contactNumber = phoneTrimmed;
        if (providerData?.avatarUrl) {
          await tx.update(profiles).set({ avatarUrl: providerData.avatarUrl }).where(eq(profiles.id, newProfile.id));
        }
        // Signup no longer requires a certificate. If one is still supplied
        // by an older client, bind it to the new user so admin review keeps
        // working.
        const certUrl = providerData?.incorporationCertUrl?.trim();
        const certObjectPath = objectPathFromStorageUrl(certUrl);
        if (certUrl) {
          if (!certObjectPath) {
            throw new Error("Certificate upload is invalid.");
          }
          await assertUploadedObjectExists(certObjectPath);
          await tx
            .insert(userUploads)
            .values({ userId: newProfile.id, objectPath: certObjectPath })
            .onConflictDoNothing();
        }
        await tx.insert(serviceProviderProfiles).values({
          userId: newProfile.id,
          companyName: providerData?.companyName,
          nzCompanyRegisterNumber: providerData?.nzCompanyRegisterNumber,
          discipline: providerData?.discipline,
          otherDiscipline: providerData?.otherDiscipline,
          addressStreet: providerData?.addressStreet,
          addressSuburb: providerData?.addressSuburb,
          addressCity: providerData?.addressCity,
          addressPostcode: providerData?.addressPostcode,
          contactNumber: providerData?.contactNumber,
          languages,
          incorporationCertUrl: certUrl || undefined,
          primaryLanguage: providerData?.primaryLanguage,
          secondaryLanguage: providerData?.secondaryLanguage,
        });
      }

      return { profile: newProfile };
    });
    const blockedSignup = "phoneBlock" in signupResult ? signupResult.phoneBlock : null;
    if (blockedSignup) {
      sendPhoneRegistrationBlock(res, blockedSignup);
      return;
    }
    if ("phoneConsumed" in signupResult) {
      res.status(400).json({
        error: "Phone verification has already been used. Please re-verify your number.",
        code: "PHONE_VERIFICATION_CONSUMED",
      });
      return;
    }
    const profile = signupResult.profile;
    if (!profile) {
      throw new Error("PROFILE_INSERT_FAILED");
    }

    const token = signToken(profile.id, profile.email, role, sessionId);
    res.status(201).json({ token, user: { ...profile, isVerified: false } });
    recordLoginEvent(profile.id);
    // Detection only: flags account-farming from one IP. Does not affect signup.
    noteSignup({ userId: profile.id, ip: req.ip });
    if (role === "sales_agent") {
      runAfterResponse(claimOutstandingLimTitleLeads(profile.id, phoneTrimmed).catch((error) => {
        req.log.warn({ error, userId: profile.id }, "Could not claim pending LIM/title leads after signup");
      }));
    }

    const providerCertObjectPath = providerData
      ? objectPathFromStorageUrl(providerData.incorporationCertUrl)
      : null;
    queueSignupNotification(req, {
      role,
      profileId: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      phone: phoneTrimmed,
      languages,
      agentData: agentData ?? undefined,
      providerData: providerData
        ? {
            ...providerData,
            incorporationCertUrl: providerData.incorporationCertUrl || undefined,
            incorporationCertReviewUrl: providerCertObjectPath
              ? makeReviewUrl(providerCertObjectPath)
              : undefined,
          }
        : undefined,
    });
  } catch (error) {
    if (
      error instanceof ObjectNotFoundError ||
      (error instanceof Error && error.message === "Certificate upload is invalid.")
    ) {
      res.status(400).json({
        error: "Certificate upload could not be verified. Please upload the file again.",
        code: "CERT_UPLOAD_NOT_VERIFIED",
      });
      return;
    }
    req.log.error({ error }, "Signup failed");
    res.status(500).json({ error: "Signup failed. Please try again.", code: "SIGNUP_FAILED" });
  }
});

router.post("/sales-agent-web-signup", async (req, res) => {
  const parsed = salesAgentWebSignupSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.status(400).json({
      error: firstError?.message || "Invalid signup data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const emailLower = normalizeEmail(parsed.data.email);
  const phoneTrimmed = normalizeRegistrationPhone(parsed.data.phoneNumber);
  const verifiedPhone = verifyPhoneVerificationToken(parsed.data.phoneVerificationToken, phoneTrimmed);
  if (!verifiedPhone) {
    res.status(400).json({
      error: "Phone verification token is invalid or expired. Please re-verify your number.",
      code: "PHONE_NOT_VERIFIED",
    });
    return;
  }
  const fullName = parsed.data.fullName.trim();
  const primaryLanguage = parsed.data.primaryLanguage.trim();
  const agencyName = parsed.data.agencyName.trim();
  const reaaLicenceNumber = parsed.data.reaaLicenceNumber.trim();

  const freeSignupEnabled = isSalesAgentFreeSignupEnabled();
  // In legacy mode this remains the invitation-code signup path. In the
  // account-first mode the agent is created free and upgrades only on publish.
  if (!freeSignupEnabled && !isValidInvitationCode(parsed.data.invitationCode)) {
    res.status(402).json({
      error: "A valid invitation code is required, or subscribe to complete registration.",
      code: "INVITATION_OR_SUBSCRIPTION_REQUIRED",
    });
    return;
  }

  try {
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({
        error: "An account with this email already exists",
        code: "EMAIL_TAKEN",
      });
      return;
    }

    if (!(await guardPhoneAndSignupLimits(req, res, phoneTrimmed))) return;

    const passwordHash = await hashPassword(parsed.data.password);
    const sessionId = createSessionId();
    const languages = [primaryLanguage];
    const aiBoostExpiresAt = freeSignupEnabled
      ? null
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    const signupResult = await db.transaction(async (tx) => {
      const phoneBlock = await checkPhoneCanRegister(tx, phoneTrimmed, "sales_agent");
      if (!phoneBlock.allowed) return { phoneBlock };

      const consumed = await consumePhoneVerification(verifiedPhone.vid, phoneTrimmed, tx);
      if (!consumed) {
        return { phoneConsumed: false as const };
      }

      const [newProfile] = await tx
        .insert(profiles)
        .values({
          email: emailLower,
          fullName,
          passwordHash,
          role: "sales_agent",
          languages,
          subscriptionTier: "free",
          reportsUsedThisMonth: 0,
          phoneNumber: phoneTrimmed,
          phoneVerifiedAt: new Date(),
          activeSessionId: sessionId,
        })
        .returning({
          id: profiles.id,
          email: profiles.email,
          fullName: profiles.fullName,
          role: profiles.role,
          languages: profiles.languages,
          subscriptionTier: profiles.subscriptionTier,
          reportsUsedThisMonth: profiles.reportsUsedThisMonth,
          messagesUsedThisMonth: profiles.messagesUsedThisMonth,
          avatarUrl: profiles.avatarUrl,
          phoneNumber: profiles.phoneNumber,
        });

      await tx.insert(salesAgentProfiles).values({
        userId: newProfile.id,
        agencyName,
        reaaLicenceNumber,
        languages,
        regionsCovered: [],
        propertyTypes: [],
        listingPlan: freeSignupEnabled ? "subscription" : "lifetime",
        aiBoostExpiresAt,
      });

      return { profile: newProfile };
    });
    const blockedSignup = "phoneBlock" in signupResult ? signupResult.phoneBlock : null;
    if (blockedSignup) {
      sendPhoneRegistrationBlock(res, blockedSignup);
      return;
    }
    if ("phoneConsumed" in signupResult) {
      res.status(400).json({
        error: "Phone verification has already been used. Please re-verify your number.",
        code: "PHONE_VERIFICATION_CONSUMED",
      });
      return;
    }
    const profile = signupResult.profile;
    if (!profile) {
      throw new Error("PROFILE_INSERT_FAILED");
    }

    const token = signToken(profile.id, profile.email, profile.role, sessionId);
    recordLoginEvent(profile.id);
    res.status(201).json({
      token,
      user: {
        ...profile,
        agencyName,
        reaaLicenceNumber,
        primaryLanguage,
        isVerified: false,
      },
    });

    queueSignupNotification(req, {
      role: "sales_agent",
      profileId: profile.id,
      email: profile.email,
      fullName: profile.fullName,
      phone: phoneTrimmed,
      languages,
      agentData: {
        agencyName,
        reaaLicenceNumber,
      },
    });
    runAfterResponse(claimOutstandingLimTitleLeads(profile.id, phoneTrimmed).catch((error) => {
      req.log.warn({ error, userId: profile.id }, "Could not claim pending LIM/title leads after web signup");
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "PHONE_VERIFICATION_CONSUMED") {
      res.status(400).json({
        error: "Phone verification has already been used. Please re-verify your number.",
        code: "PHONE_VERIFICATION_CONSUMED",
      });
      return;
    }
    req.log.error({ error }, "Sales-agent web signup failed");
    res.status(500).json({ error: "Signup failed. Please try again.", code: "SIGNUP_FAILED" });
  }
});

// ── Subscribe path, step 1: create a Stripe Checkout session ─────────────────
// The account is NOT created here — signup data is stashed in pending_agent_signups
// and the account is created only after payment succeeds (webhook / claim).
router.post("/sales-agent-web-signup/checkout", async (req, res) => {
  const parsed = salesAgentWebSignupSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.status(400).json({
      error: firstError?.message || "Invalid signup data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const emailLower = normalizeEmail(parsed.data.email);
  const phoneTrimmed = normalizeRegistrationPhone(parsed.data.phoneNumber);
  const verifiedPhone = verifyPhoneVerificationToken(parsed.data.phoneVerificationToken, phoneTrimmed);
  if (!verifiedPhone) {
    res.status(400).json({
      error: "Phone verification token is invalid or expired. Please re-verify your number.",
      code: "PHONE_NOT_VERIFIED",
    });
    return;
  }
  const fullName = parsed.data.fullName.trim();
  const primaryLanguage = parsed.data.primaryLanguage.trim();
  const agencyName = parsed.data.agencyName.trim();
  const reaaLicenceNumber = parsed.data.reaaLicenceNumber.trim();

  try {
    const existing = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_TAKEN" });
      return;
    }

    if (!(await guardPhoneAndSignupLimits(req, res, phoneTrimmed))) return;

    const phoneBlock = await db.transaction((tx) => checkPhoneCanRegister(tx, phoneTrimmed, "sales_agent"));
    if (!phoneBlock.allowed) {
      sendPhoneRegistrationBlock(res, phoneBlock);
      return;
    }

    const passwordHash = await hashPassword(parsed.data.password);
    const stripe = getStripe();

    // Reuse a customer for this email if one exists, else create one.
    let customerId: string;
    const found = await stripe.customers.list({ email: emailLower, limit: 1 });
    if (found.data[0]) {
      customerId = found.data[0].id;
    } else {
      const customer = await stripe.customers.create({ email: emailLower, name: fullName, phone: phoneTrimmed });
      customerId = customer.id;
    }

    const [pending] = await db
      .insert(pendingAgentSignups)
      .values({
        email: emailLower,
        passwordHash,
        fullName,
        phoneNumber: phoneTrimmed,
        phoneVid: verifiedPhone.vid,
        primaryLanguage,
        agencyName,
        reaaLicenceNumber,
        stripeCustomerId: customerId,
        status: "pending",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: pendingAgentSignups.id });

    const portal = getSalesPortalUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: getStripeAgentPriceId(), quantity: 1 }],
      success_url: `${portal}?agentSignup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${portal}?agentSignup=cancelled`,
      metadata: { pendingSignupId: pending.id },
      subscription_data: { metadata: { pendingSignupId: pending.id } },
    });

    await db
      .update(pendingAgentSignups)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(pendingAgentSignups.id, pending.id));

    res.json({ checkoutUrl: session.url });
  } catch (error) {
    req.log.error({ error }, "Agent checkout creation failed");
    res.status(500).json({ error: "Could not start checkout. Please try again.", code: "CHECKOUT_FAILED" });
  }
});

// ── Subscribe path, step 2: claim a completed checkout → create account + login ─
router.post("/sales-agent-web-signup/claim", async (req, res) => {
  const checkoutSessionId =
    typeof req.body?.checkoutSessionId === "string" ? req.body.checkoutSessionId.trim() : "";
  if (!checkoutSessionId) {
    res.status(400).json({ error: "checkoutSessionId is required", code: "MISSING_SESSION_ID" });
    return;
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ["subscription"],
    });

    const paid = session.payment_status === "paid" || session.status === "complete";
    if (!paid) {
      res.status(409).json({ error: "Payment not completed yet.", code: "PAYMENT_PENDING" });
      return;
    }

    const pendingId = session.metadata?.pendingSignupId;
    if (!pendingId) {
      res.status(400).json({ error: "Invalid checkout session.", code: "INVALID_SESSION" });
      return;
    }

    const [pending] = await db
      .select()
      .from(pendingAgentSignups)
      .where(eq(pendingAgentSignups.id, pendingId))
      .limit(1);
    if (!pending) {
      res.status(404).json({ error: "Signup session not found.", code: "PENDING_NOT_FOUND" });
      return;
    }

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const subscription = (session.subscription as Stripe.Subscription | null) ?? null;
    const subInfo: AgentSubscriptionInfo = subscription
      ? subscriptionInfoFromStripe(subscription, customerId)
      : {
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          subscriptionStatus: "active",
          subscriptionPeriodEndAt: null,
          subscriptionCancelAtPeriodEnd: false,
        };

    const ensured = await createAgentAccountFromPending(pending, subInfo);

    // Issue a fresh device session (auto-login on return from Stripe).
    const sessionId = createSessionId();
    await db.update(profiles).set({ activeSessionId: sessionId }).where(eq(profiles.id, ensured.profileId));

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, ensured.profileId)).limit(1);
    const [agentProfile] = await db
      .select({
        agencyName: salesAgentProfiles.agencyName,
        reaaLicenceNumber: salesAgentProfiles.reaaLicenceNumber,
        listingPlan: salesAgentProfiles.listingPlan,
        aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt,
      })
      .from(salesAgentProfiles)
      .where(eq(salesAgentProfiles.userId, ensured.profileId))
      .limit(1);

    const token = signToken(profile.id, profile.email, profile.role, sessionId);
    recordLoginEvent(profile.id);
    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        languages: profile.languages,
        subscriptionTier: profile.subscriptionTier,
        subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt,
        reportsUsedThisMonth: profile.reportsUsedThisMonth,
        messagesUsedThisMonth: profile.messagesUsedThisMonth,
        avatarUrl: profile.avatarUrl,
        phoneNumber: profile.phoneNumber,
        agencyName: agentProfile?.agencyName ?? null,
        reaaLicenceNumber: agentProfile?.reaaLicenceNumber ?? null,
        isVerified: profile.isVerified,
      },
    });
  } catch (error) {
    const phoneBlock = (error as { phoneRegistrationBlock?: PhoneRegistrationBlock })?.phoneRegistrationBlock;
    if (phoneBlock && !phoneBlock.allowed) {
      sendPhoneRegistrationBlock(res, phoneBlock);
      return;
    }
    req.log.error({ error }, "Agent signup claim failed");
    res.status(500).json({ error: "Could not finish registration. Please try again.", code: "CLAIM_FAILED" });
  }
});

router.patch("/sales-agent-web-profile", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = salesAgentWebProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.status(400).json({
      error: firstError?.message || "Invalid profile data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const fullName = parsed.data.fullName.trim();
  const phoneNumber = normalizeRegistrationPhone(parsed.data.phoneNumber);
  const primaryLanguage = parsed.data.primaryLanguage.trim();
  const agencyName = parsed.data.agencyName.trim();
  const reaaLicenceNumber = parsed.data.reaaLicenceNumber.trim();
  const languages = [primaryLanguage];
  const requestedPhoneVerification = parsed.data.phoneVerificationToken
    ? verifyPhoneVerificationToken(parsed.data.phoneVerificationToken, phoneNumber)
    : null;

  try {
    const [agentProfile] = await db
      .select({ id: salesAgentProfiles.id })
      .from(salesAgentProfiles)
      .where(eq(salesAgentProfiles.userId, userId))
      .limit(1);

    if (!agentProfile) {
      res.status(403).json({ error: "This portal is only for sales agents.", code: "SALES_AGENT_REQUIRED" });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      const [currentProfile] = await tx
        .select({ phoneNumber: profiles.phoneNumber, phoneVerifiedAt: profiles.phoneVerifiedAt })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      const phoneChanged = normalizeRegistrationPhone(currentProfile?.phoneNumber ?? "") !== phoneNumber;
      if (phoneChanged) {
        if (!requestedPhoneVerification) {
          return { phoneVerificationRequired: true as const };
        }
        const phoneBlock = await checkPhoneCanRegister(tx, phoneNumber, "sales_agent", new Date(), userId);
        if (!phoneBlock.allowed) return { phoneBlock };
        const consumed = await consumePhoneVerification(requestedPhoneVerification.vid, phoneNumber, tx);
        if (!consumed) return { phoneConsumed: false as const };
      }

      const [profile] = await tx
        .update(profiles)
        .set({
          fullName,
          phoneNumber,
          languages,
          ...(phoneChanged ? { phoneVerifiedAt: new Date() } : {}),
        })
        .where(eq(profiles.id, userId))
        .returning({
          id: profiles.id,
          email: profiles.email,
          fullName: profiles.fullName,
          role: profiles.role,
          languages: profiles.languages,
          subscriptionTier: profiles.subscriptionTier,
          reportsUsedThisMonth: profiles.reportsUsedThisMonth,
          messagesUsedThisMonth: profiles.messagesUsedThisMonth,
          avatarUrl: profiles.avatarUrl,
          phoneNumber: profiles.phoneNumber,
        });

      await tx
        .update(salesAgentProfiles)
        .set({ agencyName, reaaLicenceNumber, languages })
        .where(eq(salesAgentProfiles.userId, userId));

      return { profile };
    });
    const blockedUpdate = "phoneBlock" in updated ? updated.phoneBlock : null;
    if (blockedUpdate) {
      sendPhoneRegistrationBlock(res, blockedUpdate);
      return;
    }
    if ("phoneVerificationRequired" in updated) {
      res.status(400).json({
        error: "Verify the new mobile number before saving it.",
        code: "PHONE_REVERIFY_REQUIRED",
      });
      return;
    }
    if ("phoneConsumed" in updated) {
      res.status(400).json({
        error: "Phone verification has already been used. Please request a new code.",
        code: "PHONE_VERIFICATION_CONSUMED",
      });
      return;
    }

    res.json({
      user: {
        ...updated.profile,
        agencyName,
        reaaLicenceNumber,
        primaryLanguage,
      },
    });
    runAfterResponse(claimOutstandingLimTitleLeads(userId, phoneNumber).catch((error) => {
      req.log.warn({ error, userId }, "Could not claim pending LIM/title leads after phone verification");
    }));
  } catch (error) {
    req.log.error({ error }, "Sales-agent web profile update failed");
    res.status(500).json({ error: "Profile update failed. Please try again.", code: "PROFILE_UPDATE_FAILED" });
  }
});

router.patch("/service-provider-web-profile", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const parsed = serviceProviderWebProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.status(400).json({
      error: firstError?.message || "Invalid profile data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const fullName = parsed.data.fullName.trim();
  const phoneNumber = normalizeRegistrationPhone(parsed.data.phoneNumber);
  const contactNumber = parsed.data.contactNumber?.trim()
    ? normalizeRegistrationPhone(parsed.data.contactNumber)
    : phoneNumber;
  const primaryLanguage = parsed.data.primaryLanguage.trim();
  const secondaryLanguage = parsed.data.secondaryLanguage?.trim() || null;
  const languages = [primaryLanguage, ...(secondaryLanguage ? [secondaryLanguage] : [])];
  const companyName = parsed.data.companyName.trim();
  const nzCompanyRegisterNumber = parsed.data.nzCompanyRegisterNumber.trim();
  const discipline = parsed.data.discipline;
  const otherDiscipline = discipline === "other" ? parsed.data.otherDiscipline?.trim() || null : null;
  const addressStreet = parsed.data.addressStreet?.trim() || null;
  const addressSuburb = parsed.data.addressSuburb?.trim() || null;
  const addressCity = parsed.data.addressCity?.trim() || null;
  const addressPostcode = parsed.data.addressPostcode?.trim() || null;
  const bio = parsed.data.bio?.trim() || null;

  try {
    const [providerProfile] = await db
      .select({ id: serviceProviderProfiles.id })
      .from(serviceProviderProfiles)
      .where(eq(serviceProviderProfiles.userId, userId))
      .limit(1);

    if (!providerProfile) {
      res.status(403).json({ error: "This portal is only for service providers.", code: "SERVICE_PROVIDER_REQUIRED" });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      const [currentProfile] = await tx
        .select({ phoneNumber: profiles.phoneNumber })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (normalizeRegistrationPhone(currentProfile?.phoneNumber ?? "") !== phoneNumber) {
        const phoneBlock = await checkPhoneCanRegister(tx, phoneNumber, "service_provider", new Date(), userId);
        if (!phoneBlock.allowed) return { phoneBlock };
      }

      const [profile] = await tx
        .update(profiles)
        .set({ fullName, phoneNumber, languages })
        .where(eq(profiles.id, userId))
        .returning({
          id: profiles.id,
          email: profiles.email,
          fullName: profiles.fullName,
          role: profiles.role,
          languages: profiles.languages,
          subscriptionTier: profiles.subscriptionTier,
          subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
          reportsUsedThisMonth: profiles.reportsUsedThisMonth,
          messagesUsedThisMonth: profiles.messagesUsedThisMonth,
          avatarUrl: profiles.avatarUrl,
          phoneNumber: profiles.phoneNumber,
          isVerified: profiles.isVerified,
          specialStatus: profiles.specialStatus,
          specialStatusExpiresAt: profiles.specialStatusExpiresAt,
        });

      await tx
        .update(serviceProviderProfiles)
        .set({
          companyName,
          nzCompanyRegisterNumber,
          discipline,
          otherDiscipline,
          addressStreet,
          addressSuburb,
          addressCity,
          addressPostcode,
          contactNumber,
          primaryLanguage,
          secondaryLanguage,
          languages,
          bio,
        })
        .where(eq(serviceProviderProfiles.userId, userId));

      return { profile };
    });
    const blockedUpdate = "phoneBlock" in updated ? updated.phoneBlock : null;
    if (blockedUpdate) {
      sendPhoneRegistrationBlock(res, blockedUpdate);
      return;
    }

    res.json({
      user: {
        ...updated.profile,
        companyName,
        nzCompanyRegisterNumber,
        discipline,
        otherDiscipline,
        addressStreet,
        addressSuburb,
        addressCity,
        addressPostcode,
        contactNumber,
        primaryLanguage,
        secondaryLanguage,
        bio,
      },
    });
  } catch (error) {
    req.log.error({ error }, "Service-provider web profile update failed");
    res.status(500).json({ error: "Profile update failed. Please try again.", code: "PROFILE_UPDATE_FAILED" });
  }
});

router.post("/password-reset/request", async (req, res) => {
  const parsed = requestPasswordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Enter a valid email address",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const emailLower = normalizeEmail(parsed.data.email);
  if (!rateLimitPasswordReset(`pwd-reset:email:${emailLower}`, 3, 60 * 60 * 1000)) {
    res.status(429).json({
      error: "Too many reset codes requested for this email. Please try again later.",
      code: "RATE_LIMITED",
    });
    return;
  }
  if (!rateLimitPasswordReset(`pwd-reset:ip:${clientIp(req)}`, 15, 60 * 60 * 1000)) {
    res.status(429).json({
      error: "Too many requests. Please try again later.",
      code: "RATE_LIMITED",
    });
    return;
  }

  try {
    const [profile] = await db
      .select({ id: profiles.id, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);

    // Avoid account enumeration: unknown emails get the same successful shape.
    if (!profile) {
      res.json(genericResetResponse());
      return;
    }

    const row = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${emailLower}, 1))`);
      await tx
        .update(passwordResetTokens)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.email, emailLower),
            isNull(passwordResetTokens.usedAt),
          ),
        );

      const code = generateResetCode();
      const codeHash = hashResetCode(code, emailLower);
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
      await tx.insert(passwordResetTokens).values({
        userId: profile.id,
        email: emailLower,
        codeHash,
        expiresAt,
      });
      return { code };
    });

    const sent = await sendPasswordResetCodeEmail({
      to: profile.email,
      code: row.code,
      expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
    });
    if (!sent) {
      req.log.error({ email: emailLower }, "Password reset email could not be sent");
    }

    res.json(genericResetResponse());
  } catch (error) {
    req.log.error({ error }, "Password reset request failed");
    res.status(500).json({ error: "Could not request password reset", code: "RESET_REQUEST_FAILED" });
  }
});

router.post("/password-reset/confirm", async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    const firstError = parsed.error.issues[0];
    res.status(400).json({
      error: firstError?.message || "Invalid reset data",
      code: "VALIDATION_ERROR",
      details: parsed.error.issues,
    });
    return;
  }

  const emailLower = normalizeEmail(parsed.data.email);
  const expectedHash = hashResetCode(parsed.data.code, emailLower);

  try {
    const resetResult = await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.email, emailLower))
        .limit(1);

      if (!profile) return { status: "invalid" as const };

      const [usedToken] = await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResetTokens.userId, profile.id),
            eq(passwordResetTokens.email, emailLower),
            eq(passwordResetTokens.codeHash, expectedHash),
            isNull(passwordResetTokens.usedAt),
            sql`${passwordResetTokens.expiresAt} >= now()`,
            sql`${passwordResetTokens.attempts} < ${PASSWORD_RESET_MAX_ATTEMPTS}`,
          ),
        )
        .returning({ id: passwordResetTokens.id });

      if (usedToken) {
        const passwordHash = await hashPassword(parsed.data.password);
        await tx
          .update(profiles)
          .set({ passwordHash, activeSessionId: null })
          .where(eq(profiles.id, profile.id));
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(passwordResetTokens.userId, profile.id),
              isNull(passwordResetTokens.usedAt),
            ),
          );
        return { status: "ok" as const };
      }

      const [bumped] = await tx
        .update(passwordResetTokens)
        .set({ attempts: sql`${passwordResetTokens.attempts} + 1` })
        .where(
          and(
            eq(passwordResetTokens.userId, profile.id),
            eq(passwordResetTokens.email, emailLower),
            isNull(passwordResetTokens.usedAt),
            sql`${passwordResetTokens.expiresAt} >= now()`,
            sql`${passwordResetTokens.attempts} < ${PASSWORD_RESET_MAX_ATTEMPTS}`,
          ),
        )
        .returning({ attempts: passwordResetTokens.attempts });

      if (bumped?.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) return { status: "locked" as const };
      return { status: "invalid" as const };
    });

    if (resetResult.status === "ok") {
      res.json({ ok: true });
      return;
    }
    if (resetResult.status === "locked") {
      res.status(429).json({ error: "Too many attempts. Request a new code.", code: "RESET_LOCKED" });
      return;
    }
    res.status(400).json({ error: "Code is invalid or expired.", code: "RESET_INVALID" });
  } catch (error) {
    req.log.error({ error }, "Password reset confirmation failed");
    res.status(500).json({ error: "Could not reset password", code: "RESET_CONFIRM_FAILED" });
  }
});

router.post(
  "/login",
  // Brute-force / credential-stuffing protection: cap attempts per IP and per
  // targeted email. Generous enough that a fat-fingering real user never trips.
  ipRateLimit({ name: "login", windowMs: minutes(1), max: 20 }),
  ipRateLimit({ name: "login-hr", windowMs: hours(1), max: 100 }),
  bodyFieldRateLimit("email", { name: "login", windowMs: minutes(15), max: 10 }),
  async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required", code: "MISSING_FIELDS" });
    return;
  }

  const emailLower = email.toLowerCase().trim();

  try {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);

    if (!profile) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const valid = await verifyPassword(password, profile.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const now = new Date();
    const lastReset = new Date(profile.lastResetAt);
    const periodEnd = profile.subscriptionPeriodEndAt ? new Date(profile.subscriptionPeriodEndAt) : null;
    if (usagePeriodExpired(now, lastReset, profile.subscriptionTier, periodEnd)) {
      await db
        .update(profiles)
        .set({
          reportsUsedThisMonth: 0,
          messagesUsedThisMonth: 0,
          lastResetAt: now,
          subscriptionPeriodEndAt: null,
        })
        .where(eq(profiles.id, profile.id));
      profile.reportsUsedThisMonth = 0;
      profile.messagesUsedThisMonth = 0;
    }

    // Auto-revert expired Supercharge status so /login response reflects reality
    let effectiveSpecialStatus = profile.specialStatus;
    let effectiveSpecialStatusExpiresAt = profile.specialStatusExpiresAt;
    if (
      effectiveSpecialStatus === "supercharge" &&
      effectiveSpecialStatusExpiresAt &&
      now >= effectiveSpecialStatusExpiresAt
    ) {
      void (async () => {
        try {
          await db
            .update(profiles)
            .set({ specialStatus: null, specialStatusExpiresAt: null })
            .where(eq(profiles.id, profile.id));
        } catch {
          // non-critical; next /me request will retry
        }
      })();
      effectiveSpecialStatus = null;
      effectiveSpecialStatusExpiresAt = null;
    }

    const [agentProfile] = await db
      .select({
        agencyName: salesAgentProfiles.agencyName,
        reaaLicenceNumber: salesAgentProfiles.reaaLicenceNumber,
        listingPlan: salesAgentProfiles.listingPlan,
        aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt,
      })
      .from(salesAgentProfiles)
      .where(eq(salesAgentProfiles.userId, profile.id))
      .limit(1);

    const sessionId = createSessionId();
    await db
      .update(profiles)
      .set({ activeSessionId: sessionId })
      .where(eq(profiles.id, profile.id));

    const token = signToken(profile.id, profile.email, profile.role, sessionId);
    recordLoginEvent(profile.id);
    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        languages: profile.languages,
        subscriptionTier: profile.subscriptionTier,
        subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt,
        reportsUsedThisMonth: profile.reportsUsedThisMonth,
        messagesUsedThisMonth: profile.messagesUsedThisMonth,
        avatarUrl: profile.avatarUrl,
        phoneNumber: profile.phoneNumber,
        agencyName: agentProfile?.agencyName ?? null,
        reaaLicenceNumber: agentProfile?.reaaLicenceNumber ?? null,
        isVerified: profile.isVerified,
        specialStatus: effectiveSpecialStatus,
        specialStatusExpiresAt: effectiveSpecialStatusExpiresAt,
        agentAiUnlimited: agentProfile
          ? agentAiUnlimited(profile, agentProfile)
          : false,
        ...providerAccessPayload(profile),
      },
    });
  } catch (error) {
    req.log.error({ error }, "Login failed");
    res.status(500).json({ error: "Login failed. Please try again.", code: "LOGIN_FAILED" });
  }
});

router.post("/sales-agent-login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required", code: "MISSING_FIELDS" });
    return;
  }

  const emailLower = email.toLowerCase().trim();

  try {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);

    if (!profile) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const valid = await verifyPassword(password, profile.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const [agentProfile] = await db
      .select({
        agencyName: salesAgentProfiles.agencyName,
        reaaLicenceNumber: salesAgentProfiles.reaaLicenceNumber,
        listingPlan: salesAgentProfiles.listingPlan,
        aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt,
      })
      .from(salesAgentProfiles)
      .where(eq(salesAgentProfiles.userId, profile.id))
      .limit(1);

    if (profile.role !== "sales_agent" && !agentProfile) {
      res.status(403).json({ error: "This portal is only for sales agents.", code: "SALES_AGENT_REQUIRED" });
      return;
    }

    const now = new Date();
    const lastReset = new Date(profile.lastResetAt);
    const periodEnd = profile.subscriptionPeriodEndAt ? new Date(profile.subscriptionPeriodEndAt) : null;
    if (usagePeriodExpired(now, lastReset, profile.subscriptionTier, periodEnd)) {
      await db
        .update(profiles)
        .set({
          reportsUsedThisMonth: 0,
          messagesUsedThisMonth: 0,
          lastResetAt: now,
          subscriptionPeriodEndAt: null,
        })
        .where(eq(profiles.id, profile.id));
      profile.reportsUsedThisMonth = 0;
      profile.messagesUsedThisMonth = 0;
    }

    let effectiveSpecialStatus = profile.specialStatus;
    let effectiveSpecialStatusExpiresAt = profile.specialStatusExpiresAt;
    if (
      effectiveSpecialStatus === "supercharge" &&
      effectiveSpecialStatusExpiresAt &&
      now >= effectiveSpecialStatusExpiresAt
    ) {
      void (async () => {
        try {
          await db
            .update(profiles)
            .set({ specialStatus: null, specialStatusExpiresAt: null })
            .where(eq(profiles.id, profile.id));
        } catch {
          // non-critical; next /me request will retry
        }
      })();
      effectiveSpecialStatus = null;
      effectiveSpecialStatusExpiresAt = null;
    }

    const sessionId = createSessionId();
    await db
      .update(profiles)
      .set({ activeSessionId: sessionId })
      .where(eq(profiles.id, profile.id));

    const token = signToken(profile.id, profile.email, profile.role, sessionId);
    recordLoginEvent(profile.id);
    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        languages: profile.languages,
        subscriptionTier: profile.subscriptionTier,
        subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt,
        reportsUsedThisMonth: profile.reportsUsedThisMonth,
        messagesUsedThisMonth: profile.messagesUsedThisMonth,
        avatarUrl: profile.avatarUrl,
        phoneNumber: profile.phoneNumber,
        agencyName: agentProfile?.agencyName ?? null,
        reaaLicenceNumber: agentProfile?.reaaLicenceNumber ?? null,
        isVerified: profile.isVerified,
        specialStatus: effectiveSpecialStatus,
        specialStatusExpiresAt: effectiveSpecialStatusExpiresAt,
        agentAiUnlimited: agentProfile
          ? agentAiUnlimited(profile, agentProfile)
          : false,
      },
    });
  } catch (error) {
    req.log.error({ error }, "Sales-agent portal login failed");
    res.status(500).json({ error: "Login failed. Please try again.", code: "LOGIN_FAILED" });
  }
});

// Provider-portal login. Mirrors /sales-agent-login but gates on the
// service_provider role so general users / sales agents can't sign into the
// provider portal. Credentials live in the shared `profiles` table, so these
// are the same email/password used by the mobile app.
router.post("/service-provider-login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required", code: "MISSING_FIELDS" });
    return;
  }

  const emailLower = email.toLowerCase().trim();

  try {
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, emailLower))
      .limit(1);

    if (!profile) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const valid = await verifyPassword(password, profile.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid email or password", code: "INVALID_CREDENTIALS" });
      return;
    }

    const [providerProfile] = await db
      .select({
        companyName: serviceProviderProfiles.companyName,
        nzCompanyRegisterNumber: serviceProviderProfiles.nzCompanyRegisterNumber,
        discipline: serviceProviderProfiles.discipline,
        otherDiscipline: serviceProviderProfiles.otherDiscipline,
        addressStreet: serviceProviderProfiles.addressStreet,
        addressSuburb: serviceProviderProfiles.addressSuburb,
        addressCity: serviceProviderProfiles.addressCity,
        addressPostcode: serviceProviderProfiles.addressPostcode,
        contactNumber: serviceProviderProfiles.contactNumber,
        primaryLanguage: serviceProviderProfiles.primaryLanguage,
        secondaryLanguage: serviceProviderProfiles.secondaryLanguage,
        bio: serviceProviderProfiles.bio,
      })
      .from(serviceProviderProfiles)
      .where(eq(serviceProviderProfiles.userId, profile.id))
      .limit(1);

    if (profile.role !== "service_provider" && !providerProfile) {
      res.status(403).json({
        error: "This portal is only for service providers.",
        code: "SERVICE_PROVIDER_REQUIRED",
      });
      return;
    }

    const now = new Date();
    const lastReset = new Date(profile.lastResetAt);
    const periodEnd = profile.subscriptionPeriodEndAt ? new Date(profile.subscriptionPeriodEndAt) : null;
    if (usagePeriodExpired(now, lastReset, profile.subscriptionTier, periodEnd)) {
      await db
        .update(profiles)
        .set({
          reportsUsedThisMonth: 0,
          messagesUsedThisMonth: 0,
          lastResetAt: now,
          subscriptionPeriodEndAt: null,
        })
        .where(eq(profiles.id, profile.id));
      profile.reportsUsedThisMonth = 0;
      profile.messagesUsedThisMonth = 0;
    }

    let effectiveSpecialStatus = profile.specialStatus;
    let effectiveSpecialStatusExpiresAt = profile.specialStatusExpiresAt;
    if (
      effectiveSpecialStatus === "supercharge" &&
      effectiveSpecialStatusExpiresAt &&
      now >= effectiveSpecialStatusExpiresAt
    ) {
      void (async () => {
        try {
          await db
            .update(profiles)
            .set({ specialStatus: null, specialStatusExpiresAt: null })
            .where(eq(profiles.id, profile.id));
        } catch {
          // non-critical; next /me request will retry
        }
      })();
      effectiveSpecialStatus = null;
      effectiveSpecialStatusExpiresAt = null;
    }

    const sessionId = createSessionId();
    await db
      .update(profiles)
      .set({ activeSessionId: sessionId })
      .where(eq(profiles.id, profile.id));

    const token = signToken(profile.id, profile.email, profile.role, sessionId);
    recordLoginEvent(profile.id);
    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        languages: profile.languages,
        subscriptionTier: profile.subscriptionTier,
        subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt,
        reportsUsedThisMonth: profile.reportsUsedThisMonth,
        messagesUsedThisMonth: profile.messagesUsedThisMonth,
        avatarUrl: profile.avatarUrl,
        phoneNumber: profile.phoneNumber,
        companyName: providerProfile?.companyName ?? null,
        nzCompanyRegisterNumber: providerProfile?.nzCompanyRegisterNumber ?? null,
        discipline: providerProfile?.discipline ?? null,
        otherDiscipline: providerProfile?.otherDiscipline ?? null,
        addressStreet: providerProfile?.addressStreet ?? null,
        addressSuburb: providerProfile?.addressSuburb ?? null,
        addressCity: providerProfile?.addressCity ?? null,
        addressPostcode: providerProfile?.addressPostcode ?? null,
        contactNumber: providerProfile?.contactNumber ?? null,
        primaryLanguage: providerProfile?.primaryLanguage ?? null,
        secondaryLanguage: providerProfile?.secondaryLanguage ?? null,
        bio: providerProfile?.bio ?? null,
        isVerified: profile.isVerified,
        specialStatus: effectiveSpecialStatus,
        specialStatusExpiresAt: effectiveSpecialStatusExpiresAt,
        ...providerAccessPayload(profile),
      },
    });
  } catch (error) {
    req.log.error({ error }, "Service-provider portal login failed");
    res.status(500).json({ error: "Login failed. Please try again.", code: "LOGIN_FAILED" });
  }
});

// ── Provider portal web signup — invitation path ──────────────────────────────
router.post(
  "/service-provider-web-signup",
  ipRateLimit({ name: "provider-signup", windowMs: hours(1), max: 10 }),
  bodyFieldRateLimit("email", { name: "provider-signup", windowMs: hours(1), max: 3 }),
  async (req, res) => {
    const parsed = serviceProviderWebSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({
        error: firstError?.message || "Invalid signup data",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
      return;
    }

    const emailLower = normalizeEmail(parsed.data.email);
    const phoneTrimmed = normalizeRegistrationPhone(parsed.data.phoneNumber);
    const verifiedPhone = verifyPhoneVerificationToken(parsed.data.phoneVerificationToken, phoneTrimmed);
    if (!verifiedPhone) {
      res.status(400).json({
        error: "Phone verification token is invalid or expired. Please re-verify your number.",
        code: "PHONE_NOT_VERIFIED",
      });
      return;
    }

    const code = (parsed.data.invitationCode ?? "").trim().toLowerCase();
    const validCode = getProviderInvitationCode().trim().toLowerCase();
    if (!code || code !== validCode) {
      res.status(402).json({
        error: "A valid invitation code is required, or subscribe to complete registration.",
        code: "INVITATION_OR_SUBSCRIPTION_REQUIRED",
      });
      return;
    }

    const fullName = parsed.data.fullName.trim();
    const primaryLanguage = parsed.data.primaryLanguage.trim();
    const secondaryLanguage = parsed.data.secondaryLanguage?.trim() || null;
    const companyName = parsed.data.companyName.trim();
    const nzCompanyRegisterNumber = parsed.data.nzCompanyRegisterNumber.trim();
    const discipline = parsed.data.discipline.trim();
    const otherDiscipline = parsed.data.otherDiscipline?.trim() || null;
    const languages = [primaryLanguage, ...(secondaryLanguage ? [secondaryLanguage] : [])];

    try {
      const existing = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.email, emailLower))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_TAKEN" });
        return;
      }

      if (!(await guardPhoneAndSignupLimits(req, res, phoneTrimmed))) return;

      const passwordHash = await hashPassword(parsed.data.password);
      const sessionId = createSessionId();
      const trial = createProviderTrialWindow();

      const signupResult = await db.transaction(async (tx) => {
        const phoneBlock = await checkPhoneCanRegister(tx, phoneTrimmed, "service_provider");
        if (!phoneBlock.allowed) return { phoneBlock };

        const consumed = await consumePhoneVerification(verifiedPhone.vid, phoneTrimmed, tx);
        if (!consumed) return { phoneConsumed: false as const };

        const [newProfile] = await tx
          .insert(profiles)
          .values({
            email: emailLower,
            fullName,
            passwordHash,
            role: "service_provider",
            languages,
            subscriptionTier: "free",
            reportsUsedThisMonth: 0,
            phoneNumber: phoneTrimmed,
            phoneVerifiedAt: new Date(),
            activeSessionId: sessionId,
            subscriptionStatus: "active",
            providerTrialStartedAt: trial.startedAt,
            providerTrialEndsAt: trial.endsAt,
          })
          .returning({
            id: profiles.id,
            email: profiles.email,
            fullName: profiles.fullName,
            role: profiles.role,
            languages: profiles.languages,
            subscriptionTier: profiles.subscriptionTier,
            reportsUsedThisMonth: profiles.reportsUsedThisMonth,
            messagesUsedThisMonth: profiles.messagesUsedThisMonth,
            avatarUrl: profiles.avatarUrl,
            phoneNumber: profiles.phoneNumber,
            providerTrialStartedAt: profiles.providerTrialStartedAt,
            providerTrialEndsAt: profiles.providerTrialEndsAt,
          });

        await tx.insert(serviceProviderProfiles).values({
          userId: newProfile.id,
          companyName,
          nzCompanyRegisterNumber,
          discipline,
          otherDiscipline,
          primaryLanguage,
          secondaryLanguage,
          contactNumber: phoneTrimmed,
          languages,
          addressStreet: parsed.data.addressStreet?.trim() || null,
          addressSuburb: parsed.data.addressSuburb?.trim() || null,
          addressCity: parsed.data.addressCity?.trim() || null,
          addressPostcode: parsed.data.addressPostcode?.trim() || null,
        });

        return { profile: newProfile };
      });

      const blockedSignup = "phoneBlock" in signupResult ? signupResult.phoneBlock : null;
      if (blockedSignup) {
        sendPhoneRegistrationBlock(res, blockedSignup);
        return;
      }
      if ("phoneConsumed" in signupResult) {
        res.status(400).json({
          error: "Phone verification has already been used. Please re-verify your number.",
          code: "PHONE_VERIFICATION_CONSUMED",
        });
        return;
      }
      const profile = signupResult.profile!;

      const token = signToken(profile.id, profile.email, profile.role, sessionId);
      recordLoginEvent(profile.id);
      res.status(201).json({
        token,
        user: {
          ...profile,
          ...providerAccessPayload({
            ...profile,
            subscriptionStatus: "active",
            subscriptionPeriodEndAt: null,
          }),
          companyName,
          discipline,
          primaryLanguage,
          isVerified: false,
        },
      });

      queueSignupNotification(req, {
        role: "service_provider",
        profileId: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        phone: phoneTrimmed,
        languages,
        providerData: { companyName, nzCompanyRegisterNumber, discipline },
      });
    } catch (error) {
      req.log.error({ error }, "Provider web signup (invitation) failed");
      res.status(500).json({ error: "Signup failed. Please try again.", code: "SIGNUP_FAILED" });
    }
  },
);

// ── Provider portal web signup — Stripe checkout path ────────────────────────
router.post(
  "/service-provider-web-signup/checkout",
  ipRateLimit({ name: "provider-checkout", windowMs: hours(1), max: 10 }),
  bodyFieldRateLimit("email", { name: "provider-checkout", windowMs: hours(1), max: 3 }),
  async (req, res) => {
    const parsed = serviceProviderWebSignupSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0];
      res.status(400).json({
        error: firstError?.message || "Invalid signup data",
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
      return;
    }

    const emailLower = normalizeEmail(parsed.data.email);
    const phoneTrimmed = normalizeRegistrationPhone(parsed.data.phoneNumber);
    const verifiedPhone = verifyPhoneVerificationToken(parsed.data.phoneVerificationToken, phoneTrimmed);
    if (!verifiedPhone) {
      res.status(400).json({
        error: "Phone verification token is invalid or expired. Please re-verify your number.",
        code: "PHONE_NOT_VERIFIED",
      });
      return;
    }

    const fullName = parsed.data.fullName.trim();
    const primaryLanguage = parsed.data.primaryLanguage.trim();

    try {
      const existing = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.email, emailLower))
        .limit(1);
      if (existing.length > 0) {
        res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_TAKEN" });
        return;
      }

      if (!(await guardPhoneAndSignupLimits(req, res, phoneTrimmed))) return;

      const phoneBlock = await db.transaction((tx) => checkPhoneCanRegister(tx, phoneTrimmed, "service_provider"));
      if (!phoneBlock.allowed) {
        sendPhoneRegistrationBlock(res, phoneBlock);
        return;
      }

      const passwordHash = await hashPassword(parsed.data.password);
      const stripe = getStripe();

      let customerId: string;
      const found = await stripe.customers.list({ email: emailLower, limit: 1 });
      if (found.data[0]) {
        customerId = found.data[0].id;
      } else {
        const customer = await stripe.customers.create({ email: emailLower, name: fullName, phone: phoneTrimmed });
        customerId = customer.id;
      }

      const [pending] = await db
        .insert(pendingProviderSignups)
        .values({
          email: emailLower,
          passwordHash,
          fullName,
          phoneNumber: phoneTrimmed,
          phoneVid: verifiedPhone.vid,
          primaryLanguage,
          secondaryLanguage: parsed.data.secondaryLanguage?.trim() || null,
          companyName: parsed.data.companyName.trim(),
          nzCompanyRegisterNumber: parsed.data.nzCompanyRegisterNumber.trim(),
          discipline: parsed.data.discipline.trim(),
          otherDiscipline: parsed.data.otherDiscipline?.trim() || null,
          addressStreet: parsed.data.addressStreet?.trim() || null,
          addressSuburb: parsed.data.addressSuburb?.trim() || null,
          addressCity: parsed.data.addressCity?.trim() || null,
          addressPostcode: parsed.data.addressPostcode?.trim() || null,
          stripeCustomerId: customerId,
          status: "pending",
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        })
        .returning({ id: pendingProviderSignups.id });

      const portal = getProviderPortalUrl();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: getStripeProviderPriceId(), quantity: 1 }],
        success_url: `${portal}?providerSignup=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${portal}?providerSignup=cancelled`,
        metadata: { pendingProviderSignupId: pending.id },
        subscription_data: { metadata: { pendingProviderSignupId: pending.id } },
      });

      await db
        .update(pendingProviderSignups)
        .set({ stripeCheckoutSessionId: session.id })
        .where(eq(pendingProviderSignups.id, pending.id));

      res.json({ checkoutUrl: session.url });
    } catch (error) {
      req.log.error({ error }, "Provider checkout creation failed");
      res.status(500).json({ error: "Could not start checkout. Please try again.", code: "CHECKOUT_FAILED" });
    }
  },
);

// ── Provider portal web signup — claim after payment ─────────────────────────
router.post("/service-provider-web-signup/claim", async (req, res) => {
  const checkoutSessionId =
    typeof req.body?.checkoutSessionId === "string" ? req.body.checkoutSessionId.trim() : "";
  if (!checkoutSessionId) {
    res.status(400).json({ error: "checkoutSessionId is required", code: "MISSING_SESSION_ID" });
    return;
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
      expand: ["subscription"],
    });

    const paid = session.payment_status === "paid" || session.status === "complete";
    if (!paid) {
      res.status(409).json({ error: "Payment not completed yet.", code: "PAYMENT_PENDING" });
      return;
    }

    const pendingId = session.metadata?.pendingProviderSignupId;
    if (!pendingId) {
      res.status(400).json({ error: "Invalid checkout session.", code: "INVALID_SESSION" });
      return;
    }

    const [pending] = await db
      .select()
      .from(pendingProviderSignups)
      .where(eq(pendingProviderSignups.id, pendingId))
      .limit(1);
    if (!pending) {
      res.status(404).json({ error: "Signup session not found.", code: "PENDING_NOT_FOUND" });
      return;
    }

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;
    const subscription = (session.subscription as Stripe.Subscription | null) ?? null;
    const subInfo: AgentSubscriptionInfo = subscription
      ? subscriptionInfoFromStripe(subscription, customerId)
      : {
          stripeCustomerId: customerId,
          stripeSubscriptionId: null,
          subscriptionStatus: "active",
          subscriptionPeriodEndAt: null,
          subscriptionCancelAtPeriodEnd: false,
        };

    const ensured = await createProviderAccountFromPending(pending, subInfo);

    const sessionId = createSessionId();
    await db.update(profiles).set({ activeSessionId: sessionId }).where(eq(profiles.id, ensured.profileId));

    const [profile] = await db.select().from(profiles).where(eq(profiles.id, ensured.profileId)).limit(1);
    const [providerProfile] = await db
      .select({
        companyName: serviceProviderProfiles.companyName,
        discipline: serviceProviderProfiles.discipline,
        primaryLanguage: serviceProviderProfiles.primaryLanguage,
      })
      .from(serviceProviderProfiles)
      .where(eq(serviceProviderProfiles.userId, ensured.profileId))
      .limit(1);

    const token = signToken(profile.id, profile.email, profile.role, sessionId);
    recordLoginEvent(profile.id);
    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        languages: profile.languages,
        subscriptionTier: profile.subscriptionTier,
        subscriptionPeriodEndAt: profile.subscriptionPeriodEndAt,
        reportsUsedThisMonth: profile.reportsUsedThisMonth,
        messagesUsedThisMonth: profile.messagesUsedThisMonth,
        avatarUrl: profile.avatarUrl,
        phoneNumber: profile.phoneNumber,
        companyName: providerProfile?.companyName ?? null,
        discipline: providerProfile?.discipline ?? null,
        primaryLanguage: providerProfile?.primaryLanguage ?? null,
        isVerified: profile.isVerified,
        ...providerAccessPayload(profile),
      },
    });
  } catch (error) {
    req.log.error({ error }, "Provider signup claim failed");
    res.status(500).json({ error: "Could not finish registration. Please try again.", code: "CLAIM_FAILED" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const [profile] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        languages: profiles.languages,
        subscriptionTier: profiles.subscriptionTier,
        reportsUsedThisMonth: profiles.reportsUsedThisMonth,
        messagesUsedThisMonth: profiles.messagesUsedThisMonth,
        lastResetAt: profiles.lastResetAt,
        subscriptionPeriodEndAt: profiles.subscriptionPeriodEndAt,
        subscriptionStatus: profiles.subscriptionStatus,
        stripeSubscriptionId: profiles.stripeSubscriptionId,
        subscriptionCancelAtPeriodEnd: profiles.subscriptionCancelAtPeriodEnd,
        providerTrialStartedAt: profiles.providerTrialStartedAt,
        providerTrialEndsAt: profiles.providerTrialEndsAt,
        createdAt: profiles.createdAt,
        avatarUrl: profiles.avatarUrl,
        phoneNumber: profiles.phoneNumber,
        isVerified: profiles.isVerified,
        specialStatus: profiles.specialStatus,
        specialStatusExpiresAt: profiles.specialStatusExpiresAt,
        companyName: serviceProviderProfiles.companyName,
        nzCompanyRegisterNumber: serviceProviderProfiles.nzCompanyRegisterNumber,
        discipline: serviceProviderProfiles.discipline,
        otherDiscipline: serviceProviderProfiles.otherDiscipline,
        addressStreet: serviceProviderProfiles.addressStreet,
        addressSuburb: serviceProviderProfiles.addressSuburb,
        addressCity: serviceProviderProfiles.addressCity,
        addressPostcode: serviceProviderProfiles.addressPostcode,
        contactNumber: serviceProviderProfiles.contactNumber,
        primaryLanguage: serviceProviderProfiles.primaryLanguage,
        secondaryLanguage: serviceProviderProfiles.secondaryLanguage,
        bio: serviceProviderProfiles.bio,
        agencyName: salesAgentProfiles.agencyName,
        reaaLicenceNumber: salesAgentProfiles.reaaLicenceNumber,
        listingPlan: salesAgentProfiles.listingPlan,
        aiBoostExpiresAt: salesAgentProfiles.aiBoostExpiresAt,
      })
      .from(profiles)
      .leftJoin(salesAgentProfiles, eq(salesAgentProfiles.userId, profiles.id))
      .leftJoin(serviceProviderProfiles, eq(serviceProviderProfiles.userId, profiles.id))
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      res.status(404).json({ error: "Profile not found", code: "NOT_FOUND" });
      return;
    }

    const now = new Date();
    const lastReset = new Date(profile.lastResetAt);
    const periodEnd = profile.subscriptionPeriodEndAt ? new Date(profile.subscriptionPeriodEndAt) : null;
    if (usagePeriodExpired(now, lastReset, profile.subscriptionTier, periodEnd)) {
      await db
        .update(profiles)
        .set({
          reportsUsedThisMonth: 0,
          messagesUsedThisMonth: 0,
          lastResetAt: now,
          subscriptionPeriodEndAt: null,
        })
        .where(eq(profiles.id, userId));
      profile.reportsUsedThisMonth = 0;
      profile.messagesUsedThisMonth = 0;
    }

    // Auto-revert expired Supercharge status so the mobile UI never lies
    if (
      profile.specialStatus === "supercharge" &&
      profile.specialStatusExpiresAt &&
      now >= profile.specialStatusExpiresAt
    ) {
      void (async () => {
        try {
          await db
            .update(profiles)
            .set({ specialStatus: null, specialStatusExpiresAt: null })
            .where(eq(profiles.id, userId));
        } catch {
          // non-critical; next request will retry
        }
      })();
      profile.specialStatus = null;
      profile.specialStatusExpiresAt = null;
    }

    res.json({
      user: {
        ...profile,
        agentAiUnlimited: profile.role === "sales_agent" ? agentAiUnlimited(profile, profile) : false,
        ...providerAccessPayload(profile),
      },
    });
  } catch (error) {
    req.log.error({ error }, "Failed to get profile");
    res.status(500).json({ error: "Failed to get profile", code: "PROFILE_FAILED" });
  }
});

router.post("/activity", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;

  try {
    const lastActiveAt = await touchUserLastActive(userId);
    res.json({ ok: true, lastActiveAt: lastActiveAt.toISOString() });
  } catch (error) {
    req.log.error({ error }, "Failed to update last activity");
    res.status(500).json({ error: "Failed to update activity", code: "ACTIVITY_FAILED" });
  }
});

router.delete("/account", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    await db.transaction(async (tx) => {
      const [profile] = await tx
        .select({ phoneNumber: profiles.phoneNumber, role: profiles.role })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
      if (profile?.phoneNumber) {
        await recordPhoneAccountDeletion(tx, profile.phoneNumber, profile.role);
      }
      await tx.delete(profiles).where(eq(profiles.id, userId));
    });
    res.json({ success: true });
  } catch (error) {
    req.log.error({ error }, "Failed to delete account");
    res
      .status(500)
      .json({ error: "Failed to delete account. Please try again.", code: "DELETE_FAILED" });
  }
});

router.patch("/profile", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { fullName, languages, avatarUrl } = req.body as {
    fullName?: string;
    languages?: string[];
    avatarUrl?: string | null;
  };

  try {
    const updateFields: Partial<{
      fullName: string | null;
      languages: string[];
      avatarUrl: string | null;
    }> = {};
    if (fullName !== undefined) updateFields.fullName = fullName?.trim() || null;
    if (languages !== undefined) updateFields.languages = languages;
    if (avatarUrl !== undefined) updateFields.avatarUrl = avatarUrl ?? null;

    const [updated] = await db
      .update(profiles)
      .set(updateFields)
      .where(eq(profiles.id, userId))
      .returning({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        languages: profiles.languages,
        subscriptionTier: profiles.subscriptionTier,
        reportsUsedThisMonth: profiles.reportsUsedThisMonth,
        messagesUsedThisMonth: profiles.messagesUsedThisMonth,
        avatarUrl: profiles.avatarUrl,
      });

    res.json({ user: updated });
  } catch (error) {
    req.log.error({ error }, "Failed to update profile");
    res.status(500).json({ error: "Failed to update profile", code: "UPDATE_FAILED" });
  }
});

// PATCH /auth/service-provider/cert
// Allows an authenticated service provider to update their incorporation cert URL after signup
router.patch("/service-provider/cert", requireAuth, async (req, res) => {
  const authedReq = req as unknown as { userId: string; userRole?: string };
  const userId = authedReq.userId;

  // Enforce role — only service providers may update their cert
  const profile = await db.query.profiles.findFirst({ where: eq(profiles.id, userId) });
  if (!profile || profile.role !== "service_provider") {
    res.status(403).json({ error: "Forbidden", code: "FORBIDDEN" });
    return;
  }

  // Accept relative paths (e.g. /api/storage/...) or absolute URLs
  const schema = z.object({ incorporationCertUrl: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", code: "VALIDATION_ERROR", details: parsed.error.issues });
    return;
  }
  try {
    await db
      .update(serviceProviderProfiles)
      .set({ incorporationCertUrl: parsed.data.incorporationCertUrl })
      .where(eq(serviceProviderProfiles.userId, userId));
    res.json({ ok: true });
  } catch (error) {
    req.log.error({ error }, "Failed to update cert");
    res.status(500).json({ error: "Failed to update cert", code: "UPDATE_FAILED" });
  }
});

export default router;
