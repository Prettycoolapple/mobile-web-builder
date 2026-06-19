import { eq, sql } from "drizzle-orm";
import { db, phoneLineTypeCache, withDbRetry } from "@workspace/db";
import { getTwilioClient } from "./twilio";
import { logger } from "./logger";
import { noteAbuseSignal } from "./abuse";

const CACHE_TTL_DAYS = 30;
const PHONE_TYPE_NOT_ALLOWED_MESSAGE =
  "Please use a real mobile number. Virtual, VoIP, landline, or toll-free numbers cannot be used for registration.";
const PHONE_TYPE_LOOKUP_FAILED_MESSAGE =
  "We could not verify this phone number right now. Please try again shortly.";

export interface PhoneLineTypeAllowed {
  allowed: true;
  lineType: string;
}

export interface PhoneLineTypeBlocked {
  allowed: false;
  status: number;
  code: "PHONE_TYPE_NOT_ALLOWED" | "PHONE_TYPE_LOOKUP_FAILED";
  message: string;
  lineType?: string | null;
}

export type PhoneLineTypeCheck = PhoneLineTypeAllowed | PhoneLineTypeBlocked;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function normalizeLineType(raw: unknown): string {
  return String(raw ?? "unknown").trim() || "unknown";
}

function cacheExpiry(now = new Date()): Date {
  return new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function buildPhoneLineTypeBlock(lineType?: string | null): PhoneLineTypeBlocked {
  return {
    allowed: false,
    status: 400,
    code: "PHONE_TYPE_NOT_ALLOWED",
    message: PHONE_TYPE_NOT_ALLOWED_MESSAGE,
    lineType: lineType ?? null,
  };
}

function lookupFailedBlock(): PhoneLineTypeBlocked {
  return {
    allowed: false,
    status: 503,
    code: "PHONE_TYPE_LOOKUP_FAILED",
    message: PHONE_TYPE_LOOKUP_FAILED_MESSAGE,
  };
}

function typeFromLineTypeIntelligence(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "unknown";
  const data = raw as Record<string, unknown>;
  return normalizeLineType(data.type ?? data.line_type ?? data.lineType);
}

function carrierFromLineTypeIntelligence(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const carrier = data.carrier_name ?? data.carrierName;
  return typeof carrier === "string" && carrier.trim() ? carrier.trim() : null;
}

async function getCachedLineType(phoneNumber: string): Promise<{ lineType: string; carrierName: string | null } | null> {
  const [cached] = await withDbRetry(() =>
    db
      .select({
        lineType: phoneLineTypeCache.lineType,
        carrierName: phoneLineTypeCache.carrierName,
      })
      .from(phoneLineTypeCache)
      .where(eq(phoneLineTypeCache.phoneNumber, phoneNumber))
      .limit(1),
  );
  if (!cached) return null;

  const rows = await withDbRetry(() =>
    db
      .select({ fresh: sql<boolean>`${phoneLineTypeCache.expiresAt} > now()` })
      .from(phoneLineTypeCache)
      .where(eq(phoneLineTypeCache.phoneNumber, phoneNumber))
      .limit(1),
  );
  return rows[0]?.fresh ? cached : null;
}

async function cacheLineType(phoneNumber: string, lineType: string, carrierName: string | null, rawData: unknown): Promise<void> {
  const now = new Date();
  await withDbRetry(() =>
    db
      .insert(phoneLineTypeCache)
      .values({
        phoneNumber,
        lineType,
        carrierName,
        rawData: rawData && typeof rawData === "object" ? rawData : null,
        checkedAt: now,
        expiresAt: cacheExpiry(now),
      })
      .onConflictDoUpdate({
        target: phoneLineTypeCache.phoneNumber,
        set: {
          lineType,
          carrierName,
          rawData: rawData && typeof rawData === "object" ? rawData : null,
          checkedAt: now,
          expiresAt: cacheExpiry(now),
        },
      }),
  );
}

async function lookupLineType(phoneNumber: string): Promise<{ lineType: string; carrierName: string | null; rawData: unknown }> {
  const result = await getTwilioClient()
    .lookups.v2.phoneNumbers(phoneNumber)
    .fetch({ fields: "line_type_intelligence" });
  const raw = result.lineTypeIntelligence;
  return {
    lineType: typeFromLineTypeIntelligence(raw),
    carrierName: carrierFromLineTypeIntelligence(raw),
    rawData: raw,
  };
}

export async function checkPhoneLineTypeForSignup(phoneNumber: string): Promise<PhoneLineTypeCheck> {
  try {
    const cached = await getCachedLineType(phoneNumber);
    const resolved = cached ?? await lookupLineType(phoneNumber);
    if (!cached && "rawData" in resolved) {
      await cacheLineType(phoneNumber, resolved.lineType, resolved.carrierName, resolved.rawData);
    }

    if (resolved.lineType.toLowerCase() === "mobile") {
      return { allowed: true, lineType: resolved.lineType };
    }
    return buildPhoneLineTypeBlock(resolved.lineType);
  } catch (error) {
    logger.warn({ error, phoneNumber }, "Phone line-type lookup failed");
    if (isProduction()) return lookupFailedBlock();
    return { allowed: true, lineType: "lookup_unavailable" };
  }
}

export function sendPhoneLineTypeBlock(res: any, block: PhoneLineTypeBlocked): void {
  if (block.code === "PHONE_TYPE_NOT_ALLOWED") {
    noteAbuseSignal({
      kind: "phone_type_blocked",
      ip: res.req?.ip,
      detail: `blocked phone line type: ${block.lineType ?? "unknown"}`,
    });
  }
  res.status(block.status).json({
    error: block.message,
    code: block.code,
    lineType: block.lineType ?? undefined,
  });
}
