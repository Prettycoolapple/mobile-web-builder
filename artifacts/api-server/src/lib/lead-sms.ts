import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, leadSmsDeliveries, limTitleRequests, listingAgentTargets } from "@workspace/db";
import { getLeadShortBaseUrl, getTwilioLeadStatusCallbackUrl, isLimTitleSmsEnabled } from "./env";
import { sendSms } from "./twilio";
import { logger } from "./logger";

const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"
    .split(""),
);
const GSM_EXTENDED = new Set("^{}\\[~]|€".split(""));
export const SINGLE_SMS_SEPTETS = 160;

export function gsm7SeptetLength(value: string): number | null {
  let count = 0;
  for (const char of value) {
    if (GSM_BASIC.has(char)) count += 1;
    else if (GSM_EXTENDED.has(char)) count += 2;
    else return null;
  }
  return count;
}

export function sanitizeSmsText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayedShortBase(): string {
  const configured = getLeadShortBaseUrl().replace(/\/+$/, "");
  return `https://${configured.replace(/^https?:\/\//i, "")}`;
}

export function buildLeadSms(args: { address: string; claimToken: string; agentName?: string | null; shortBase?: string }): string {
  const firstName = sanitizeSmsText(args.agentName ?? "").split(" ")[0]?.slice(0, 8) ?? "";
  const prefix = firstName
    ? `Project Alpha: Hi ${firstName}, buyer wants LIM/title: `
    : "Project Alpha: Buyer wants LIM/title: ";
  const middle = ". Lead: ";
  const suffix = ". STOP=opt out. Reply to this SMS will be charged";
  const suppliedBase = (args.shortBase ?? displayedShortBase()).replace(/\/+$/, "");
  const base = `https://${suppliedBase.replace(/^https?:\/\//i, "")}`;
  const shortUrl = `${base}/${args.claimToken}`;
  const street = sanitizeSmsText(args.address.split(",")[0] ?? args.address) || "this property";
  const fixed = `${prefix}${middle}${shortUrl}${suffix}`;
  const fixedLength = gsm7SeptetLength(fixed);
  if (fixedLength == null || fixedLength >= SINGLE_SMS_SEPTETS - 8) {
    throw new Error("LEAD_SHORT_BASE_URL is too long for a one-segment lead SMS");
  }

  const addressBudget = SINGLE_SMS_SEPTETS - fixedLength;
  let shortAddress = street;
  while (shortAddress.length > 1 && (gsm7SeptetLength(shortAddress) ?? Infinity) > addressBudget) {
    shortAddress = shortAddress.slice(0, -1).trimEnd();
  }
  if (shortAddress !== street && shortAddress.length > 3) {
    shortAddress = `${shortAddress.slice(0, Math.max(1, shortAddress.length - 3)).trimEnd()}...`;
  }

  const body = `${prefix}${shortAddress}${middle}${shortUrl}${suffix}`;
  const length = gsm7SeptetLength(body);
  if (length == null || length > SINGLE_SMS_SEPTETS) {
    throw new Error(`Lead SMS exceeded one GSM-7 segment (${length ?? "non-GSM"})`);
  }
  return body;
}

function retryAt(attemptCount: number): Date {
  const delays = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];
  return new Date(Date.now() + (delays[Math.min(attemptCount, delays.length - 1)] ?? delays.at(-1)!));
}

export function isNzSmsDaytime(date = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date));
  return Number.isFinite(hour) && hour >= 8 && hour < 20;
}

function nextNzDaytime(from = new Date()): Date {
  const candidate = new Date(from);
  candidate.setMinutes(candidate.getMinutes() + 30, 0, 0);
  for (let i = 0; i < 48; i += 1) {
    if (isNzSmsDaytime(candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 30);
  }
  return new Date(from.getTime() + 12 * 60 * 60_000);
}

export async function queueLeadSms(requestId: string): Promise<void> {
  const [row] = await db
    .select({
      requestId: limTitleRequests.id,
      address: limTitleRequests.propertyAddress,
      claimToken: limTitleRequests.claimToken,
      targetId: listingAgentTargets.id,
      phone: listingAgentTargets.phoneNumber,
      agentName: listingAgentTargets.agentName,
      optedOutAt: listingAgentTargets.optedOutAt,
    })
    .from(limTitleRequests)
    .innerJoin(listingAgentTargets, eq(listingAgentTargets.id, limTitleRequests.agentTargetId))
    .where(eq(limTitleRequests.id, requestId))
    .limit(1);
  if (!row) return;

  let body: string;
  try {
    body = buildLeadSms({ address: row.address, claimToken: row.claimToken, agentName: row.agentName });
  } catch (error) {
    const lastError = error instanceof Error ? error.message : String(error);
    await db
      .insert(leadSmsDeliveries)
      .values({
        requestId,
        agentTargetId: row.targetId,
        toPhone: row.phone,
        body: "",
        status: "configuration_error",
        nextAttemptAt: new Date(),
        lastError: lastError.slice(0, 1000),
      })
      .onConflictDoNothing({ target: leadSmsDeliveries.requestId });
    logger.error({ error, requestId }, "Lead SMS configuration is invalid");
    return;
  }

  const status = row.optedOutAt ? "suppressed" : isLimTitleSmsEnabled() ? "queued" : "disabled";
  await db
    .insert(leadSmsDeliveries)
    .values({
      requestId,
      agentTargetId: row.targetId,
      toPhone: row.phone,
      body,
      status,
      nextAttemptAt: new Date(),
      lastError: status === "disabled" ? "LIM_TITLE_SMS_ENABLED is not true" : null,
    })
    .onConflictDoNothing({ target: leadSmsDeliveries.requestId });

  if (status === "queued") await deliverLeadSmsForRequest(requestId);
}

export async function deliverLeadSmsForRequest(requestId: string): Promise<boolean> {
  if (!isLimTitleSmsEnabled()) return false;
  if (!isNzSmsDaytime()) {
    await db
      .update(leadSmsDeliveries)
      .set({ nextAttemptAt: nextNzDaytime(), updatedAt: new Date() })
      .where(and(
        eq(leadSmsDeliveries.requestId, requestId),
        inArray(leadSmsDeliveries.status, ["queued", "failed", "undelivered"]),
      ));
    return false;
  }
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT d.id
      FROM lead_sms_deliveries d
      JOIN listing_agent_targets t ON t.id = d.agent_target_id
      WHERE d.request_id = ${requestId}
        AND d.status IN ('queued', 'failed', 'undelivered')
        AND d.next_attempt_at <= now()
        AND d.attempt_count < 5
        AND t.opted_out_at IS NULL
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    const id = (rows as unknown as { rows?: Array<{ id: string }> }).rows?.[0]?.id;
    if (!id) return null;
    const [delivery] = await tx
      .update(leadSmsDeliveries)
      .set({ status: "processing", attemptCount: sql`${leadSmsDeliveries.attemptCount} + 1`, updatedAt: new Date() })
      .where(eq(leadSmsDeliveries.id, id))
      .returning();
    return delivery ?? null;
  });
  if (!claimed) return false;

  try {
    const message = await sendSms(claimed.toPhone, claimed.body, {
      statusCallback: getTwilioLeadStatusCallbackUrl(),
    });
    await db
      .update(leadSmsDeliveries)
      .set({
        twilioSid: message.sid,
        status: "submitted",
        sentAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(leadSmsDeliveries.id, claimed.id));
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(leadSmsDeliveries)
      .set({ status: "failed", lastError: message.slice(0, 1000), nextAttemptAt: retryAt(claimed.attemptCount), updatedAt: new Date() })
      .where(eq(leadSmsDeliveries.id, claimed.id));
    logger.warn({ error, requestId }, "Lead SMS send failed; queued for retry");
    return false;
  }
}

export async function retryDueLeadSms(limit = 25): Promise<{ attempted: number; delivered: number }> {
  if (!isLimTitleSmsEnabled()) return { attempted: 0, delivered: 0 };
  const due = await db
    .select({ requestId: leadSmsDeliveries.requestId })
    .from(leadSmsDeliveries)
    .where(and(
      inArray(leadSmsDeliveries.status, ["queued", "failed", "undelivered"]),
      lte(leadSmsDeliveries.nextAttemptAt, new Date()),
    ))
    .orderBy(asc(leadSmsDeliveries.nextAttemptAt))
    .limit(Math.max(1, Math.min(limit, 100)));
  let delivered = 0;
  for (const row of due) if (await deliverLeadSmsForRequest(row.requestId)) delivered += 1;
  return { attempted: due.length, delivered };
}
