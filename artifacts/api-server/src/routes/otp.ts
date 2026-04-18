import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { db, phoneVerifications } from "@workspace/db";
import { sendSms } from "../lib/twilio";

const router: IRouter = Router();

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const PHONE_TOKEN_TTL_SECONDS = 30 * 60;

function resolvePhoneSecret(): string {
  const secret = process.env.PHONE_VERIFICATION_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "PHONE_VERIFICATION_SECRET (or SESSION_SECRET) must be set in production",
      );
    }
    // Development only: derive a per-process random secret so tokens cannot be
    // forged with a known value, but they will not survive a server restart.
    const dev = crypto.randomBytes(32).toString("hex");
    process.env.PHONE_VERIFICATION_SECRET = dev;
    return dev;
  }
  return secret;
}

const PHONE_VERIFICATION_SECRET = resolvePhoneSecret();

// Lightweight in-memory sliding-window rate limiter. Sufficient for the single
// API instance we run today; if we ever scale horizontally this needs to move
// to Redis or a DB-backed counter.
const rateBuckets = new Map<string, number[]>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const arr = (rateBuckets.get(key) ?? []).filter((t) => t > cutoff);
  if (arr.length >= limit) {
    rateBuckets.set(key, arr);
    return false;
  }
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}
function clientIp(req: Request): string {
  // Relies on `app.set("trust proxy", 1)` in app.ts so req.ip is taken from
  // the X-Forwarded-For entry written by the edge proxy, not whatever the
  // client supplied themselves.
  return req.ip || "unknown";
}

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "").trim();
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

function generateCode(): string {
  return (crypto.randomInt(0, 1_000_000)).toString().padStart(6, "0");
}

function hashCode(code: string, phone: string): string {
  return crypto
    .createHmac("sha256", PHONE_VERIFICATION_SECRET)
    .update(`${phone}:${code}`)
    .digest("hex");
}

export interface PhoneVerificationToken {
  phone: string;
  vid: string;
  verifiedAt: number;
}

export function signPhoneVerificationToken(phone: string, verificationId: string): string {
  const payload: PhoneVerificationToken = {
    phone,
    vid: verificationId,
    verifiedAt: Math.floor(Date.now() / 1000),
  };
  return jwt.sign(payload, PHONE_VERIFICATION_SECRET, { expiresIn: PHONE_TOKEN_TTL_SECONDS });
}

export function verifyPhoneVerificationToken(
  token: string,
  expectedPhone: string,
): PhoneVerificationToken | null {
  try {
    const decoded = jwt.verify(token, PHONE_VERIFICATION_SECRET) as PhoneVerificationToken;
    if (!decoded?.phone || !decoded?.vid) return null;
    if (normalizePhone(decoded.phone) !== normalizePhone(expectedPhone)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Atomically mark a verification row as consumed (single-use). Returns true
 * iff exactly one row was updated — i.e. the token had not been consumed
 * before. Callers should reject signup when this returns false.
 */
export async function consumePhoneVerification(
  verificationId: string,
  expectedPhone: string,
): Promise<boolean> {
  const normalized = normalizePhone(expectedPhone);
  const result = await db
    .update(phoneVerifications)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(phoneVerifications.id, verificationId),
        eq(phoneVerifications.phone, normalized),
        isNull(phoneVerifications.consumedAt),
      ),
    )
    .returning({ id: phoneVerifications.id });
  return result.length === 1;
}

router.post("/auth/send-otp", async (req: Request, res: Response) => {
  const { phone } = (req.body ?? {}) as { phone?: string };
  if (!phone || typeof phone !== "string") {
    res.status(400).json({ error: "Phone number is required", code: "MISSING_PHONE" });
    return;
  }

  const normalized = normalizePhone(phone);
  if (!isValidE164(normalized)) {
    res.status(400).json({
      error: "Enter a valid phone number in international format (e.g. +6421...)",
      code: "INVALID_PHONE",
    });
    return;
  }

  // Anti-abuse: per-phone (3/hour) and per-IP (10/hour) sliding window limits
  // to deter SMS flooding and toll-fraud.
  if (!rateLimit(`otp:phone:${normalized}`, 3, 60 * 60 * 1000)) {
    res.status(429).json({
      error: "Too many codes requested for this number. Please try again later.",
      code: "RATE_LIMITED",
    });
    return;
  }
  if (!rateLimit(`otp:ip:${clientIp(req)}`, 10, 60 * 60 * 1000)) {
    res.status(429).json({
      error: "Too many requests. Please try again later.",
      code: "RATE_LIMITED",
    });
    return;
  }

  try {
    const row = await db.transaction(async (tx) => {
      // Serialize per-phone work via an advisory transaction lock so two
      // concurrent /send-otp calls cannot both bypass the prior-row
      // invalidation and create multiple active OTPs (which would multiply
      // the attacker's effective guess budget).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${normalized}, 0))`,
      );

      // Invalidate any previous unverified, unconsumed OTP rows for this
      // phone so each phone has at most one active OTP at any time.
      await tx
        .update(phoneVerifications)
        .set({ expiresAt: new Date() })
        .where(
          and(
            eq(phoneVerifications.phone, normalized),
            isNull(phoneVerifications.verifiedAt),
            isNull(phoneVerifications.consumedAt),
          ),
        );

      const code = generateCode();
      const codeHash = hashCode(code, normalized);
      const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

      const [inserted] = await tx
        .insert(phoneVerifications)
        .values({ phone: normalized, codeHash, expiresAt })
        .returning({ id: phoneVerifications.id });

      return { id: inserted.id, code };
    });

    try {
      await sendSms(
        normalized,
        `Your Project Alpha verification code is ${row.code}. It expires in ${OTP_TTL_MINUTES} minutes.`,
      );
    } catch (smsErr) {
      req.log.error({ smsErr, phone: normalized }, "Failed to send OTP via SMS");
      res.status(502).json({
        error: "Could not send verification SMS. Please check the number and try again.",
        code: "SMS_SEND_FAILED",
      });
      return;
    }

    res.json({ verificationId: row.id, expiresInSeconds: OTP_TTL_MINUTES * 60 });
  } catch (err) {
    req.log.error({ err }, "POST /auth/send-otp failed");
    res.status(500).json({ error: "Failed to send code", code: "OTP_SEND_FAILED" });
  }
});

router.post("/auth/verify-otp", async (req: Request, res: Response) => {
  const { verificationId, phone, code } = (req.body ?? {}) as {
    verificationId?: string;
    phone?: string;
    code?: string;
  };

  if (!verificationId || !phone || !code) {
    res.status(400).json({
      error: "verificationId, phone and code are required",
      code: "MISSING_FIELDS",
    });
    return;
  }

  const normalized = normalizePhone(phone);
  const expectedHash = hashCode(code.trim(), normalized);

  try {
    // Atomic single-statement verify: succeed only when the row is unverified,
    // unexpired, attempts < MAX, and the code hash matches. Returning the row
    // proves we — and only we — flipped it from unverified to verified.
    const updated = await db
      .update(phoneVerifications)
      .set({ verifiedAt: new Date() })
      .where(
        and(
          eq(phoneVerifications.id, verificationId),
          eq(phoneVerifications.phone, normalized),
          isNull(phoneVerifications.verifiedAt),
          sql`${phoneVerifications.expiresAt} >= now()`,
          sql`${phoneVerifications.attempts} < ${MAX_ATTEMPTS}`,
          eq(phoneVerifications.codeHash, expectedHash),
        ),
      )
      .returning({ id: phoneVerifications.id });

    if (updated.length === 1) {
      const token = signPhoneVerificationToken(normalized, updated[0].id);
      res.json({ token, phone: normalized });
      return;
    }

    // Did not match. Try to atomically increment attempts on an active row so
    // we can return the right error code. We only bump attempts when the row
    // is still active (unverified, unexpired, attempts < MAX) — that prevents
    // attempts from being inflated past the cap.
    const bumped = await db
      .update(phoneVerifications)
      .set({ attempts: sql`${phoneVerifications.attempts} + 1` })
      .where(
        and(
          eq(phoneVerifications.id, verificationId),
          eq(phoneVerifications.phone, normalized),
          isNull(phoneVerifications.verifiedAt),
          sql`${phoneVerifications.expiresAt} >= now()`,
          sql`${phoneVerifications.attempts} < ${MAX_ATTEMPTS}`,
        ),
      )
      .returning({ attempts: phoneVerifications.attempts });

    if (bumped.length === 1) {
      if (bumped[0].attempts >= MAX_ATTEMPTS) {
        res.status(429).json({ error: "Too many attempts. Request a new code.", code: "OTP_LOCKED" });
        return;
      }
      res.status(400).json({ error: "Incorrect code. Please try again.", code: "OTP_INVALID" });
      return;
    }

    // Row was either expired, already verified, or attempts exhausted.
    const [existing] = await db
      .select({
        verifiedAt: phoneVerifications.verifiedAt,
        attempts: phoneVerifications.attempts,
        expiresAt: phoneVerifications.expiresAt,
      })
      .from(phoneVerifications)
      .where(
        and(
          eq(phoneVerifications.id, verificationId),
          eq(phoneVerifications.phone, normalized),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(400).json({ error: "Code expired. Please request a new one.", code: "OTP_EXPIRED" });
      return;
    }
    if (existing.verifiedAt) {
      res.status(400).json({ error: "This code has already been used.", code: "OTP_USED" });
      return;
    }
    if (existing.attempts >= MAX_ATTEMPTS) {
      res.status(429).json({ error: "Too many attempts. Request a new code.", code: "OTP_LOCKED" });
      return;
    }
    res.status(400).json({ error: "Code expired. Please request a new one.", code: "OTP_EXPIRED" });
  } catch (err) {
    req.log.error({ err }, "POST /auth/verify-otp failed");
    res.status(500).json({ error: "Failed to verify code", code: "OTP_VERIFY_FAILED" });
  }
});

export default router;
