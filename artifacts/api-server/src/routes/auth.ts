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
  userUploads,
} from "@workspace/db";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../lib/auth";
import { sendNewUserSignupNotification, sendPasswordResetCodeEmail } from "../lib/mailer";
import { usagePeriodExpired } from "../lib/billingPeriod";
import { verifyPhoneVerificationToken, consumePhoneVerification } from "./otp";
import { getPublicAppUrl } from "../lib/env";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { createStorageReviewToken } from "../lib/storage-review-token";

const router = Router();
const objectStorageService = new ObjectStorageService();

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

router.post("/signup", async (req, res) => {
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
  const phoneTrimmed = phoneNumber.replace(/[\s\-()]/g, "").trim();
  const verifiedPhone = verifyPhoneVerificationToken(phoneVerificationToken, phoneTrimmed);
  if (!verifiedPhone) {
    res.status(400).json({
      error: "Phone verification token is invalid or expired. Please re-verify your number.",
      code: "PHONE_NOT_VERIFIED",
    });
    return;
  }
  // Atomically consume the verification row so this token cannot be replayed
  // to create more than one account during its TTL window.
  const consumed = await consumePhoneVerification(verifiedPhone.vid, phoneTrimmed);
  if (!consumed) {
    res.status(400).json({
      error: "Phone verification has already been used. Please re-verify your number.",
      code: "PHONE_VERIFICATION_CONSUMED",
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

    const passwordHash = await hashPassword(password);

    const profile = await db.transaction(async (tx) => {
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

      return newProfile;
    });

    const token = signToken(profile.id, profile.email, role);
    res.status(201).json({ token, user: { ...profile, isVerified: false } });

    const providerCertObjectPath = providerData
      ? objectPathFromStorageUrl(providerData.incorporationCertUrl)
      : null;
    sendNewUserSignupNotification({
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
          .set({ passwordHash })
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

router.post("/login", async (req, res) => {
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

    const token = signToken(profile.id, profile.email, profile.role);
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
        isVerified: profile.isVerified,
      },
    });
  } catch (error) {
    req.log.error({ error }, "Login failed");
    res.status(500).json({ error: "Login failed. Please try again.", code: "LOGIN_FAILED" });
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
        createdAt: profiles.createdAt,
        avatarUrl: profiles.avatarUrl,
        isVerified: profiles.isVerified,
        discipline: serviceProviderProfiles.discipline,
      })
      .from(profiles)
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

    res.json({ user: profile });
  } catch (error) {
    req.log.error({ error }, "Failed to get profile");
    res.status(500).json({ error: "Failed to get profile", code: "PROFILE_FAILED" });
  }
});

router.delete("/account", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  try {
    await db.delete(profiles).where(eq(profiles.id, userId));
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
