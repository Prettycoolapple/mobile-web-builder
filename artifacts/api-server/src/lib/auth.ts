import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import jwt from "jsonwebtoken";
import type { RequestHandler } from "express";

const scryptAsync = promisify(scrypt);

const JWT_SECRET = process.env.SESSION_SECRET || "devfeasible-dev-secret-change-in-prod";
const JWT_EXPIRES = "30d";

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

export function signToken(userId: string, email: string, role?: string): string {
  return jwt.sign({ sub: userId, email, role: role ?? "general" }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): { sub: string; email: string; role: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { sub: string; email: string; role: string };
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
    return;
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token", code: "INVALID_TOKEN" });
    return;
  }

  (req as any).userId = payload.sub;
  (req as any).userEmail = payload.email;
  (req as any).role = payload.role ?? "general";
  next();
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
