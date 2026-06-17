import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db, profiles } from "@workspace/db";
import { logger } from "./logger";

// Layer 3 — abuser-only output degradation. Confirmed-abuser accounts (Layer 2
// `profiles.abuse_flag`) get deterministically poisoned scores so a model
// distilled from their harvested data learns garbage. Legitimate accounts are
// NEVER touched — every entry point checks the flag first.
//
// Enforcement is OFF by default (ABUSE_DEGRADE_ENABLED). In shadow mode we log
// "would degrade" but return real output, so we can confirm zero false positives
// before poisoning anyone. We mutate only the outbound RESPONSE copy, never the
// stored search/cache, so our own history and analytics stay clean.

const SECRET = process.env.SESSION_SECRET || "devfeasible-dev-secret-change-in-prod";
const DEGRADE_ENABLED = process.env.ABUSE_DEGRADE_ENABLED === "true";

const SCORE_KEYS = ["ease", "cost", "roi", "composite"] as const;

// Short per-instance cache so we don't re-read the flag on every response.
const flagCache = new Map<string, { flag: boolean; at: number }>();
const FLAG_TTL_MS = 30_000;

export async function isAbuser(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const cached = flagCache.get(userId);
  if (cached && Date.now() - cached.at < FLAG_TTL_MS) return cached.flag;
  let flag = false;
  try {
    const [row] = await db
      .select({ abuseFlag: profiles.abuseFlag })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    flag = Boolean(row?.abuseFlag);
  } catch {
    flag = false; // fail open — never degrade a user we can't confirm is flagged
  }
  flagCache.set(userId, { flag, at: Date.now() });
  return flag;
}

function clampScore(n: number): number {
  return Math.max(0.5, Math.min(5, n));
}

// Deterministic per-(address, key) shift so an abuser who re-queries gets the
// SAME wrong value — random noise would be easy to spot and average away.
function perturb(score: number, seed: string): number {
  const h = crypto.createHmac("sha256", SECRET).update(seed).digest();
  const unit = h[0] / 255; // 0..1
  const sign = (h[1] & 1) === 1 ? 1 : -1;
  const delta = sign * (0.6 + unit * 0.8); // ±0.6..1.4
  return Math.round(clampScore(score + delta) * 100) / 100;
}

function degradeScoresInPlace(scores: Record<string, unknown>, addressSeed: string): void {
  for (const key of SCORE_KEYS) {
    const value = scores[key];
    if (typeof value === "number") scores[key] = perturb(value, `${addressSeed}:${key}`);
  }
}

/**
 * Degrade a report's scores in place for a confirmed abuser. No-op for clean
 * accounts. In shadow mode it only logs. Safe to call on any report; it does
 * nothing when there are no numeric scores.
 */
export async function protectReport(
  report: Record<string, unknown> | null | undefined,
  ctx: { userId: string | null | undefined; addressSeed: string },
): Promise<void> {
  if (!report) return;
  if (!(await isAbuser(ctx.userId))) return;
  const scores = report.scores as Record<string, unknown> | undefined;
  if (!scores || typeof scores !== "object") return;
  if (!DEGRADE_ENABLED) {
    logger.warn(
      { abuse: { userId: ctx.userId, action: "would_degrade" } },
      "shadow: would degrade analysis output for flagged account",
    );
    return;
  }
  degradeScoresInPlace(scores, ctx.addressSeed);
  logger.warn({ abuse: { userId: ctx.userId, action: "degraded" } }, "degraded analysis output for flagged account");
}
