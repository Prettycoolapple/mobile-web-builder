import { createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";

const scryptAsync = promisify(scrypt);

const JWT_SECRET = process.env.SESSION_SECRET || "devfeasible-dev-secret-change-in-prod";
const JWT_EXPIRES = "30d";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: string;
  sid?: string;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString("hex")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, hashed] = hash.split(":");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const hashedBuf = Buffer.from(hashed, "hex");
  return timingSafeEqual(buf, hashedBuf);
}

export function createSessionId(): string {
  return randomUUID();
}

export function signToken(userId: string, email: string, role?: string, sessionId?: string): string {
  const payload: AuthTokenPayload = { sub: userId, email, role: role ?? "general" };
  if (sessionId) payload.sid = sessionId;
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): AuthTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
  } catch {
    return null;
  }
}

export async function verifyActiveToken(token: string): Promise<AuthTokenPayload | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  const [profile] = await db
    .select({ activeSessionId: profiles.activeSessionId })
    .from(profiles)
    .where(eq(profiles.id, payload.sub))
    .limit(1);

  if (!profile) return null;

  // Legacy tokens issued before single-device sessions did not include `sid`.
  // Allow them only until the account receives its first new-session login.
  if (!profile.activeSessionId && !payload.sid) return payload;
  if (profile.activeSessionId && payload.sid === profile.activeSessionId) return payload;
  return null;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
    return;
  }

  const token = authHeader.slice(7);
  let payload: AuthTokenPayload | null = null;
  try {
    payload = await verifyActiveToken(token);
  } catch {
    res.status(401).json({ error: "Could not validate session", code: "INVALID_TOKEN" });
    return;
  }
  if (!payload) {
    res.status(401).json({ error: "This account is now signed in on another device.", code: "SESSION_REPLACED" });
    return;
  }

  (req as any).userId = payload.sub;
  (req as any).userEmail = payload.email;
  (req as any).role = payload.role ?? "general";
  next();
};

/**
 * Resolve a valid bearer token when present, while allowing genuinely
 * anonymous callers through. An invalid/expired bearer is never downgraded to
 * guest access because that could hide session-replacement errors.
 */
export const optionalAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next();
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Invalid authorization header", code: "UNAUTHORIZED" });
    return;
  }
  try {
    const payload = await verifyActiveToken(authHeader.slice(7));
    if (!payload) {
      res.status(401).json({ error: "This account is now signed in on another device.", code: "SESSION_REPLACED" });
      return;
    }
    (req as any).userId = payload.sub;
    (req as any).userEmail = payload.email;
    (req as any).role = payload.role ?? "general";
    next();
  } catch {
    res.status(401).json({ error: "Could not validate session", code: "INVALID_TOKEN" });
  }
};

export const requireAdmin: RequestHandler = (req, res, next) => {
  requireAuth(req, res, () => {
    if ((req as any).role !== "admin") {
      res.status(403).json({ error: "Admin access required", code: "FORBIDDEN" });
      return;
    }
    next();
  });
};
