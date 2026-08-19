import { and, count, eq, gte } from "drizzle-orm";
import { anonymousUsageEvents, db, withDbRetry } from "@workspace/db";
import { getAnonymousInstallHash, getIpHash } from "./anonymous-discovery";

// Guest feasibility reports. A logged-out visitor can generate a small number
// of full reports before we ask them to register — nothing about the allowance
// is surfaced up front; the register prompt is the first (and only) time they
// hear about it.
//
// Guest runs are deliberately *not* saved to history (no account to save them
// against), so the only durable trace is the usage event counted here.

/** Distinct from the discovery/browse `chat` event so the two quotas never mix. */
export const GUEST_REPORT_EVENT_TYPE = "analyse_report";

const DEFAULT_GUEST_MONTHLY_REPORT_LIMIT = 5;

/**
 * The install id is client-generated, so it is trivially rotated by anyone
 * determined to farm free reports. A looser per-IP ceiling closes that hole
 * without punishing genuine users who share a NAT (office, campus, carrier).
 */
const DEFAULT_GUEST_IP_LIMIT_MULTIPLIER = 4;

/**
 * Rolling window rather than a calendar month: a calendar reset lets a guest
 * burn 5 on the 31st and 5 more the next morning. The user-facing copy never
 * names a reset date, so "monthly" stays honest either way.
 */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface GuestIdentity {
  /** Hashed install id when the client sent one, else the hashed IP. */
  installHash: string;
  ipHash: string | null;
}

export interface GuestReportQuota {
  allowed: boolean;
  used: number;
  limit: number;
  /** Which ceiling was hit; only meaningful when `allowed` is false. */
  reason?: "install" | "ip";
}

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name] ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function guestMonthlyReportLimit(): number {
  return positiveIntEnv("GUEST_REPORT_MONTHLY_LIMIT", DEFAULT_GUEST_MONTHLY_REPORT_LIMIT);
}

export function guestMonthlyIpReportLimit(): number {
  return positiveIntEnv(
    "GUEST_REPORT_MONTHLY_IP_LIMIT",
    guestMonthlyReportLimit() * DEFAULT_GUEST_IP_LIMIT_MULTIPLIER,
  );
}

/**
 * Resolve the guest a request belongs to. Returns null when there is nothing to
 * count against at all (no install header, no resolvable IP) — callers treat
 * that as "cannot meter", and the endpoint's IP velocity limits still apply.
 */
export function guestIdentityFromRequest(req: {
  ip?: string;
  headers: Record<string, unknown>;
}): GuestIdentity | null {
  const ipHash = getIpHash(req);
  const installHash = getAnonymousInstallHash(req.headers) ?? ipHash;
  if (!installHash) return null;
  return { installHash, ipHash };
}

/** Build an identity from hashes a caller already resolved (e.g. the chat route). */
export function guestIdentityFromHashes(
  installHash: string | null | undefined,
  ipHash: string | null | undefined,
): GuestIdentity | null {
  const resolved = installHash ?? ipHash ?? null;
  if (!resolved) return null;
  return { installHash: resolved, ipHash: ipHash ?? null };
}

async function countEvents(column: "installHash" | "ipHash", value: string, since: Date): Promise<number> {
  const [row] = await withDbRetry(() =>
    db
      .select({ total: count() })
      .from(anonymousUsageEvents)
      .where(
        and(
          eq(anonymousUsageEvents[column], value),
          eq(anonymousUsageEvents.eventType, GUEST_REPORT_EVENT_TYPE),
          gte(anonymousUsageEvents.createdAt, since),
        ),
      ),
  );
  return Number(row?.total ?? 0);
}

/**
 * How many guest reports this identity has already generated in the window, and
 * whether another one is allowed.
 *
 * Fails open: a database blip must not lock genuine visitors out of the product.
 * The endpoint's IP velocity limits remain the hard backstop.
 */
export async function checkGuestReportQuota(identity: GuestIdentity | null): Promise<GuestReportQuota> {
  const limit = guestMonthlyReportLimit();
  if (!identity) return { allowed: true, used: 0, limit };

  const since = new Date(Date.now() - WINDOW_MS);
  try {
    const ipLimit = guestMonthlyIpReportLimit();
    const [installUsed, ipUsed] = await Promise.all([
      countEvents("installHash", identity.installHash, since),
      identity.ipHash && identity.ipHash !== identity.installHash
        ? countEvents("ipHash", identity.ipHash, since)
        : Promise.resolve(0),
    ]);

    if (installUsed >= limit) return { allowed: false, used: installUsed, limit, reason: "install" };
    if (ipUsed >= ipLimit) return { allowed: false, used: installUsed, limit, reason: "ip" };
    return { allowed: true, used: installUsed, limit };
  } catch {
    return { allowed: true, used: 0, limit };
  }
}

/**
 * Count one generated report against the guest's allowance.
 *
 * Called only once a report actually reached the caller, mirroring the
 * logged-in quota (which increments `reports_used_this_month` after the
 * pipeline succeeds). Charging up front would burn the small allowance on
 * transport failures, which the mobile client retries automatically.
 */
export async function recordGuestReport(identity: GuestIdentity | null): Promise<void> {
  if (!identity) return;
  await withDbRetry(() =>
    db.insert(anonymousUsageEvents).values({
      installHash: identity.installHash,
      ipHash: identity.ipHash,
      eventType: GUEST_REPORT_EVENT_TYPE,
    }),
  );
}
