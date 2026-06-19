import crypto from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, abuseEvents, profiles } from "@workspace/db";
import { logger } from "./logger";

// Layer 2: abuse / harvest-pattern detection. Records discrete signals that
// distinguish a scraper building a training set from a human shopping for a
// home — account farming and quota-bursting fresh accounts — and rolls them
// into a per-account score.
//
// Detection-only by default: signals are logged (req.log / structured warn) and
// surfaced to admins, but no user is blocked. Auto-flagging is gated behind
// ABUSE_AUTOFLAG_ENABLED (default off) so thresholds can be tuned against real
// traffic before any enforcement (Layer 3) acts on the flag.

const ABUSE_SECRET = process.env.SESSION_SECRET || "devfeasible-dev-secret-change-in-prod";
const AUTOFLAG_ENABLED = process.env.ABUSE_AUTOFLAG_ENABLED === "true";

const SCORE_WINDOW_MS = 24 * 60 * 60 * 1000;
const AUTO_FLAG_SCORE = 10;

// Signups from one IP within this window above the threshold look like farming.
const SIGNUP_VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_VELOCITY_THRESHOLD = 4;

export type AbuseKind =
  | "signup_velocity"
  | "signup_limited"
  | "phone_type_blocked"
  | "quota_burst"
  | "rate_limit_trip"
  | "canary_hit"
  | "manual";

// Per-signal contribution to the rolling score. Tuned so a single weak signal
// never flags an account, but a combination (farming + quota burn) does. A
// canary hit is near-conclusive — a real user never types a trap address.
const WEIGHTS: Record<AbuseKind, number> = {
  signup_velocity: 5,
  signup_limited: 3,
  phone_type_blocked: 3,
  quota_burst: 4,
  rate_limit_trip: 1,
  canary_hit: 8,
  manual: AUTO_FLAG_SCORE,
};

/** One-way hash of an IP so we can group by source without storing PII. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto.createHmac("sha256", ABUSE_SECRET).update(ip).digest("hex").slice(0, 32);
}

interface RecordArgs {
  kind: AbuseKind;
  userId?: string | null;
  ip?: string | null;
  ipHash?: string | null;
  /** Override the default weight for this kind. */
  weight?: number;
  detail?: string;
}

async function recordAbuseSignal(args: RecordArgs): Promise<void> {
  const ipHash = args.ipHash ?? hashIp(args.ip);
  const weight = args.weight ?? WEIGHTS[args.kind] ?? 0;
  await db.insert(abuseEvents).values({
    userId: args.userId ?? null,
    ipHash: ipHash ?? null,
    kind: args.kind,
    weight,
    detail: args.detail ?? null,
  });
  logger.warn(
    { abuse: { kind: args.kind, userId: args.userId ?? null, ipHash, weight, detail: args.detail } },
    "abuse signal recorded",
  );
  if (args.userId) await maybeAutoFlag(args.userId);
}

/**
 * Fire-and-forget signal recording for the request path. Never blocks the
 * response and never throws — detection must not affect availability.
 */
export function noteAbuseSignal(args: RecordArgs): void {
  void recordAbuseSignal(args).catch((err) => logger.error({ err }, "recordAbuseSignal failed"));
}

/** Sum of signal weights for an account over the rolling window. */
export async function getRollingScore(userId: string, windowMs = SCORE_WINDOW_MS): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${abuseEvents.weight}), 0)` })
    .from(abuseEvents)
    .where(and(eq(abuseEvents.userId, userId), gte(abuseEvents.createdAt, since)));
  return Number(row?.total ?? 0);
}

async function maybeAutoFlag(userId: string): Promise<void> {
  if (!AUTOFLAG_ENABLED) return;
  const score = await getRollingScore(userId);
  if (score < AUTO_FLAG_SCORE) return;
  // Only flag a currently-clean account so we never clobber an admin's reason,
  // and the warn alert fires at most once per flag transition.
  const updated = await db
    .update(profiles)
    .set({
      abuseFlag: true,
      abuseFlagReason: `auto: rolling abuse score ${score.toFixed(1)} over 24h`,
      abuseFlaggedAt: new Date(),
    })
    .where(and(eq(profiles.id, userId), eq(profiles.abuseFlag, false)))
    .returning({ id: profiles.id });
  if (updated.length === 1) {
    logger.warn({ abuse: { userId, score, action: "auto_flag" } }, "account auto-flagged for abuse");
  }
}

/**
 * Record a signup and, if too many accounts have been created from the same IP
 * in the last hour, raise a signup_velocity signal against the new account.
 * Fire-and-forget; safe to call after the signup response has been sent.
 */
export function noteSignup(args: { userId: string; ip?: string | null }): void {
  const ipHash = hashIp(args.ip);
  void (async () => {
    try {
      // Log the signup itself (weight 0 — it's a marker we count, not a penalty).
      await db.insert(abuseEvents).values({ userId: args.userId, ipHash, kind: "signup", weight: 0 });
      if (!ipHash) return;
      const since = new Date(Date.now() - SIGNUP_VELOCITY_WINDOW_MS);
      const [row] = await db
        .select({ n: sql<number>`count(*)` })
        .from(abuseEvents)
        .where(and(eq(abuseEvents.ipHash, ipHash), eq(abuseEvents.kind, "signup"), gte(abuseEvents.createdAt, since)));
      const count = Number(row?.n ?? 0);
      if (count >= SIGNUP_VELOCITY_THRESHOLD) {
        await recordAbuseSignal({
          kind: "signup_velocity",
          userId: args.userId,
          ipHash,
          detail: `${count} signups from this IP in the last hour`,
        });
      }
    } catch (err) {
      logger.error({ err }, "noteSignup failed");
    }
  })();
}

/**
 * Raise a quota_burst signal when a brand-new free account is about to exhaust
 * its small free report quota — the fingerprint of a farmed harvesting account.
 * Caller passes values it already loaded for the quota check (no extra query).
 */
export function noteQuotaUsage(args: {
  userId: string;
  ip?: string | null;
  tier: string | null | undefined;
  reportsUsedThisMonth: number;
  reportLimit: number;
  accountCreatedAt: Date;
}): void {
  const isFreeTier = args.tier !== "standard" && args.tier !== "pro";
  const accountAgeMs = Date.now() - args.accountCreatedAt.getTime();
  const isNewAccount = accountAgeMs < 24 * 60 * 60 * 1000;
  // Fire once, as usage crosses one short of the limit, so we don't log on every
  // subsequent call from the same account.
  const atBurstPoint = args.reportsUsedThisMonth === Math.max(1, args.reportLimit - 1);
  if (isFreeTier && isNewAccount && atBurstPoint) {
    noteAbuseSignal({
      kind: "quota_burst",
      userId: args.userId,
      ip: args.ip,
      detail: `free account ${Math.round(accountAgeMs / 3_600_000)}h old at ${args.reportsUsedThisMonth}/${args.reportLimit} reports`,
    });
  }
}

/** Manually set or clear an account's abuse flag (admin action). */
export async function setAbuseFlag(userId: string, flag: boolean, reason?: string): Promise<boolean> {
  const updated = await db
    .update(profiles)
    .set({
      abuseFlag: flag,
      abuseFlagReason: flag ? reason ?? "manual admin flag" : null,
      abuseFlaggedAt: flag ? new Date() : null,
    })
    .where(eq(profiles.id, userId))
    .returning({ id: profiles.id });
  if (updated.length === 1 && flag) {
    await db.insert(abuseEvents).values({
      userId,
      kind: "manual",
      weight: WEIGHTS.manual,
      detail: reason ?? "manual admin flag",
    });
  }
  return updated.length === 1;
}
