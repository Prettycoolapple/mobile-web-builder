import type { Request, Response, RequestHandler } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { verifyActiveToken } from "./auth";
import { noteAbuseSignal } from "./abuse";

// Velocity rate limiting (the "speed limit"). A normal user makes a handful of
// requests; a scraper harvesting address→analysis pairs makes hundreds. Limits
// here are tuned well above real usage so no genuine user is ever affected.
//
// Backed by the rate_limit_counters table (not in-memory) so counts hold across
// Vercel's stateless serverless invocations. Set RATE_LIMIT_DISABLED=true to
// bypass entirely (handy for local dev / load tests).

const DISABLED = process.env.RATE_LIMIT_DISABLED === "true";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
export const minutes = (n: number): number => n * MINUTE_MS;
export const hours = (n: number): number => n * HOUR_MS;

function clientIp(req: Request): string {
  // Relies on app.set("trust proxy", ...) so req.ip is the edge proxy's
  // X-Forwarded-For entry, not whatever the client supplied.
  return req.ip || "unknown";
}

export interface HitResult {
  allowed: boolean;
  count: number;
  retryAfterSeconds: number;
}

/**
 * Register one hit against a fixed time window and report whether the caller is
 * now over `max`. Atomic via INSERT ... ON CONFLICT so concurrent requests
 * cannot both slip under the cap.
 *
 * Fail-open: any DB error returns allowed=true. A database blip must never take
 * down the API for legitimate users — the limiter is defence-in-depth, not the
 * primary access control.
 */
export async function hitRateLimit(key: string, max: number, windowMs: number): Promise<HitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const expiresAt = new Date(windowStart.getTime() + windowMs);
  try {
    const result = (await db.execute(sql`
      INSERT INTO rate_limit_counters (bucket_key, window_start, count, expires_at)
      VALUES (${key}, ${windowStart}, 1, ${expiresAt})
      ON CONFLICT (bucket_key, window_start)
      DO UPDATE SET count = rate_limit_counters.count + 1
      RETURNING count
    `)) as unknown as { rows?: Array<{ count: number | string }> };

    const count = Number(result.rows?.[0]?.count ?? 0);

    // Opportunistic cleanup so the table stays bounded without a cron job.
    if (Math.random() < 0.01) {
      void db.execute(sql`DELETE FROM rate_limit_counters WHERE expires_at < now()`).catch(() => {});
    }

    if (count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));
      return { allowed: false, count, retryAfterSeconds };
    }
    return { allowed: true, count, retryAfterSeconds: 0 };
  } catch {
    return { allowed: true, count: 0, retryAfterSeconds: 0 };
  }
}

function reject(res: Response, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    error: "Too many requests. Please slow down and try again shortly.",
    code: "RATE_LIMITED",
    retryAfterSeconds,
  });
}

export interface RateLimitRule {
  /** Stable name; namespaces the counter key so different routes never collide. */
  name: string;
  windowMs: number;
  max: number;
}

/**
 * Per-IP velocity limit. Needs no auth, so it suits anonymous-capable endpoints
 * (search / discovery) and acts as a coarse cap on authed ones — it catches a
 * farm of accounts all driven from one host or proxy.
 */
export function ipRateLimit(rule: RateLimitRule): RequestHandler {
  return async (req, res, next) => {
    if (DISABLED) return next();
    const { allowed, retryAfterSeconds } = await hitRateLimit(
      `${rule.name}:ip:${clientIp(req)}`,
      rule.max,
      rule.windowMs,
    );
    if (!allowed) return reject(res, retryAfterSeconds);
    next();
  };
}

/**
 * Per-account velocity limit. These routes do their own auth *inside* the
 * handler (no upstream requireAuth middleware), so we resolve the bearer token
 * here too. Anonymous / invalid callers pass straight through — the route's own
 * auth check handles them — so this never blocks logged-out browsing.
 */
export function userRateLimit(rule: RateLimitRule): RequestHandler {
  return async (req, res, next) => {
    if (DISABLED) return next();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return next();
    const payload = await verifyActiveToken(authHeader.slice(7)).catch(() => null);
    if (!payload?.sub) return next();
    const { allowed, retryAfterSeconds } = await hitRateLimit(
      `${rule.name}:user:${payload.sub}`,
      rule.max,
      rule.windowMs,
    );
    if (!allowed) {
      // A logged-in account tripping its velocity cap is itself a mild abuse
      // signal — feed it into Layer 2 (fire-and-forget).
      noteAbuseSignal({ kind: "rate_limit_trip", userId: payload.sub, ip: clientIp(req), detail: rule.name });
      return reject(res, retryAfterSeconds);
    }
    next();
  };
}

/**
 * Per-identity limit keyed off a request-body field (e.g. email on login).
 * Throttles credential-stuffing against a single account without penalising
 * other users behind the same NAT/IP. Requires express.json() to have run first
 * (it has — the global parser is mounted before the router).
 */
export function bodyFieldRateLimit(field: string, rule: RateLimitRule): RequestHandler {
  return async (req, res, next) => {
    if (DISABLED) return next();
    const raw = (req.body as Record<string, unknown> | undefined)?.[field];
    const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    if (!value) return next();
    const { allowed, retryAfterSeconds } = await hitRateLimit(
      `${rule.name}:${field}:${value}`,
      rule.max,
      rule.windowMs,
    );
    if (!allowed) return reject(res, retryAfterSeconds);
    next();
  };
}
