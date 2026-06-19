import type { Request, Response } from "express";
import { hours, hitRateLimit } from "./rateLimit";
import { getAnonymousInstallHash } from "./anonymous-discovery";
import { noteAbuseSignal } from "./abuse";

const SIGNUP_LIMITED_MESSAGE =
  "Too many registrations have been created from this device or network. Please try again later.";

export interface SignupLimitAllowed {
  allowed: true;
}

export interface SignupLimitBlocked {
  allowed: false;
  status: 429;
  code: "SIGNUP_LIMITED";
  message: string;
  retryAfterSeconds: number;
  reason: string;
}

export type SignupLimitCheck = SignupLimitAllowed | SignupLimitBlocked;

function clientIp(req: Request): string {
  return req.ip || "unknown";
}

function block(reason: string, retryAfterSeconds: number): SignupLimitBlocked {
  return {
    allowed: false,
    status: 429,
    code: "SIGNUP_LIMITED",
    message: SIGNUP_LIMITED_MESSAGE,
    retryAfterSeconds,
    reason,
  };
}

async function checkBucket(key: string, max: number, windowMs: number, reason: string): Promise<SignupLimitCheck> {
  const hit = await hitRateLimit(key, max, windowMs);
  if (hit.allowed) return { allowed: true };
  return block(reason, hit.retryAfterSeconds);
}

export async function checkSignupCreationLimits(req: Request): Promise<SignupLimitCheck> {
  const ip = clientIp(req);
  const installHash = getAnonymousInstallHash(req.headers as Record<string, unknown>);
  const checks: Array<Promise<SignupLimitCheck>> = [
    checkBucket(`signup-create:ip:${ip}:1h`, 8, hours(1), "ip_1h"),
    checkBucket(`signup-create:ip:${ip}:24h`, 20, hours(24), "ip_24h"),
  ];

  if (installHash) {
    checks.push(
      checkBucket(`signup-create:install:${installHash}:24h`, 3, hours(24), "install_24h"),
      checkBucket(`signup-create:install:${installHash}:7d`, 5, hours(24 * 7), "install_7d"),
    );
  }

  const results = await Promise.all(checks);
  const blocked = results.find((result): result is SignupLimitBlocked => !result.allowed);
  if (!blocked) return { allowed: true };

  noteAbuseSignal({
    kind: "signup_limited",
    ip,
    detail: `signup creation limited: ${blocked.reason}`,
  });
  return blocked;
}

export function sendSignupLimitBlock(res: Response, block: SignupLimitBlocked): void {
  res.setHeader("Retry-After", String(block.retryAfterSeconds));
  res.status(block.status).json({
    error: block.message,
    code: block.code,
    retryAfterSeconds: block.retryAfterSeconds,
  });
}
