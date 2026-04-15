import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  profiles,
  salesAgentProfiles,
  serviceProviderProfiles,
} from "@workspace/db";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../lib/auth";

const router = Router();

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
    if (data.role === "service_provider" && !data.providerData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "providerData is required for service_provider role",
        path: ["providerData"],
      });
    }
  });

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

  const { email, password, firstName, lastName, role, languages, agentData, providerData } =
    parsed.data;
  const emailLower = email.toLowerCase().trim();
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
        if (providerData?.avatarUrl) {
          await tx.update(profiles).set({ avatarUrl: providerData.avatarUrl }).where(eq(profiles.id, newProfile.id));
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
          incorporationCertUrl: providerData?.incorporationCertUrl,
          primaryLanguage: providerData?.primaryLanguage,
          secondaryLanguage: providerData?.secondaryLanguage,
        });
      }

      return newProfile;
    });

    const token = signToken(profile.id, profile.email, role);
    res.status(201).json({ token, user: profile });
  } catch (error) {
    req.log.error({ error }, "Signup failed");
    res.status(500).json({ error: "Signup failed. Please try again.", code: "SIGNUP_FAILED" });
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
    const sameMonth =
      now.getFullYear() === lastReset.getFullYear() && now.getMonth() === lastReset.getMonth();

    if (!sameMonth) {
      await db
        .update(profiles)
        .set({ reportsUsedThisMonth: 0, lastResetAt: now })
        .where(eq(profiles.id, profile.id));
      profile.reportsUsedThisMonth = 0;
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
        reportsUsedThisMonth: profile.reportsUsedThisMonth,
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
        lastResetAt: profiles.lastResetAt,
        createdAt: profiles.createdAt,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);

    if (!profile) {
      res.status(404).json({ error: "Profile not found", code: "NOT_FOUND" });
      return;
    }

    const now = new Date();
    const lastReset = new Date(profile.lastResetAt);
    const sameMonth =
      now.getFullYear() === lastReset.getFullYear() && now.getMonth() === lastReset.getMonth();

    if (!sameMonth) {
      await db
        .update(profiles)
        .set({ reportsUsedThisMonth: 0, lastResetAt: now })
        .where(eq(profiles.id, userId));
      profile.reportsUsedThisMonth = 0;
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
  const { fullName } = req.body as { fullName?: string };

  try {
    const [updated] = await db
      .update(profiles)
      .set({ fullName: fullName?.trim() || null })
      .where(eq(profiles.id, userId))
      .returning({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        role: profiles.role,
        languages: profiles.languages,
        subscriptionTier: profiles.subscriptionTier,
        reportsUsedThisMonth: profiles.reportsUsedThisMonth,
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
