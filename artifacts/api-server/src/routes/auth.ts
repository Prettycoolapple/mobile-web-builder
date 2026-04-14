import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { hashPassword, verifyPassword, signToken, requireAuth } from "../lib/auth";

const router = Router();

router.post("/signup", async (req, res) => {
  const { email, password, fullName } = req.body as {
    email?: string;
    password?: string;
    fullName?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required", code: "MISSING_FIELDS" });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters", code: "WEAK_PASSWORD" });
    return;
  }

  const emailLower = email.toLowerCase().trim();

  try {
    const existing = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.email, emailLower)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "An account with this email already exists", code: "EMAIL_TAKEN" });
      return;
    }

    const passwordHash = await hashPassword(password);
    const [profile] = await db.insert(profiles).values({
      email: emailLower,
      fullName: fullName?.trim() || null,
      passwordHash,
      subscriptionTier: "free",
      reportsUsedThisMonth: 0,
    }).returning({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      subscriptionTier: profiles.subscriptionTier,
      reportsUsedThisMonth: profiles.reportsUsedThisMonth,
    });

    const token = signToken(profile.id, profile.email);
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
    const [profile] = await db.select().from(profiles).where(eq(profiles.email, emailLower)).limit(1);

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
    const sameMonth = now.getFullYear() === lastReset.getFullYear() && now.getMonth() === lastReset.getMonth();

    if (!sameMonth) {
      await db.update(profiles).set({
        reportsUsedThisMonth: 0,
        lastResetAt: now,
      }).where(eq(profiles.id, profile.id));
      profile.reportsUsedThisMonth = 0;
    }

    const token = signToken(profile.id, profile.email);
    res.json({
      token,
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
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
    const [profile] = await db.select({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      subscriptionTier: profiles.subscriptionTier,
      reportsUsedThisMonth: profiles.reportsUsedThisMonth,
      lastResetAt: profiles.lastResetAt,
      createdAt: profiles.createdAt,
    }).from(profiles).where(eq(profiles.id, userId)).limit(1);

    if (!profile) {
      res.status(404).json({ error: "Profile not found", code: "NOT_FOUND" });
      return;
    }

    const now = new Date();
    const lastReset = new Date(profile.lastResetAt);
    const sameMonth = now.getFullYear() === lastReset.getFullYear() && now.getMonth() === lastReset.getMonth();

    if (!sameMonth) {
      await db.update(profiles).set({
        reportsUsedThisMonth: 0,
        lastResetAt: now,
      }).where(eq(profiles.id, userId));
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
    // searches cascade-delete automatically via FK constraint
    await db.delete(profiles).where(eq(profiles.id, userId));
    res.json({ success: true });
  } catch (error) {
    req.log.error({ error }, "Failed to delete account");
    res.status(500).json({ error: "Failed to delete account. Please try again.", code: "DELETE_FAILED" });
  }
});

router.patch("/profile", requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const { fullName } = req.body as { fullName?: string };

  try {
    const [updated] = await db.update(profiles).set({
      fullName: fullName?.trim() || null,
    }).where(eq(profiles.id, userId)).returning({
      id: profiles.id,
      email: profiles.email,
      fullName: profiles.fullName,
      subscriptionTier: profiles.subscriptionTier,
      reportsUsedThisMonth: profiles.reportsUsedThisMonth,
    });

    res.json({ user: updated });
  } catch (error) {
    req.log.error({ error }, "Failed to update profile");
    res.status(500).json({ error: "Failed to update profile", code: "UPDATE_FAILED" });
  }
});

export default router;
