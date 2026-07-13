import { Router, type Request } from "express";
import twilio from "twilio";
import { and, eq, inArray } from "drizzle-orm";
import { db, leadSmsDeliveries, listingAgentTargets } from "@workspace/db";
import { getPublicAppUrl, getTwilioAuthToken } from "../lib/env";
import { normalizeRegistrationPhone } from "../lib/phone-registration";

const router = Router();

function validateTwilio(req: Request): boolean {
  const signature = req.get("x-twilio-signature");
  if (!signature) return false;
  let token: string;
  try {
    token = getTwilioAuthToken();
  } catch {
    return false;
  }
  const base = getPublicAppUrl().replace(/\/+$/, "");
  const path = req.originalUrl.split("?")[0] ?? req.originalUrl;
  const url = `${base}${path}`;
  return twilio.validateRequest(token, signature, url, req.body as Record<string, string>);
}

function twiml(res: any, message?: string): void {
  res.type("text/xml");
  if (!message) {
    res.send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
    return;
  }
  const escaped = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`);
}

router.post("/webhooks/twilio/sms-status", async (req, res) => {
  if (!validateTwilio(req)) {
    res.status(403).json({ error: "Invalid Twilio signature" });
    return;
  }
  const sid = String(req.body?.MessageSid ?? "").trim();
  const rawStatus = String(req.body?.MessageStatus ?? "").trim().toLowerCase();
  if (!sid || !rawStatus) {
    res.status(400).json({ error: "MessageSid and MessageStatus are required" });
    return;
  }
  const allowed = new Set(["accepted", "queued", "sending", "sent", "delivered", "undelivered", "failed"]);
  const status = allowed.has(rawStatus) ? rawStatus : "submitted";
  const now = new Date();
  const retryable = status === "failed" || status === "undelivered";
  await db
    .update(leadSmsDeliveries)
    .set({
      status,
      deliveredAt: status === "delivered" ? now : undefined,
      lastError: retryable
        ? [req.body?.ErrorCode, req.body?.ErrorMessage].filter(Boolean).join(": ").slice(0, 1000) || status
        : null,
      nextAttemptAt: retryable ? new Date(Date.now() + 30 * 60_000) : undefined,
      updatedAt: now,
    })
    .where(eq(leadSmsDeliveries.twilioSid, sid));
  res.status(204).end();
});

router.post("/webhooks/twilio/inbound", async (req, res) => {
  if (!validateTwilio(req)) {
    res.status(403).json({ error: "Invalid Twilio signature" });
    return;
  }
  const phone = normalizeRegistrationPhone(String(req.body?.From ?? ""));
  const keyword = String(req.body?.Body ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const stopWords = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
  const startWords = new Set(["START", "UNSTOP"]);
  if (phone && stopWords.has(keyword)) {
    const targets = await db
      .update(listingAgentTargets)
      .set({ optedOutAt: new Date(), optOutKeyword: keyword, updatedAt: new Date() })
      .where(eq(listingAgentTargets.phoneNumber, phone))
      .returning({ id: listingAgentTargets.id });
    for (const target of targets) {
      await db
        .update(leadSmsDeliveries)
        .set({ status: "suppressed", lastError: `Recipient opted out with ${keyword}`, updatedAt: new Date() })
        .where(and(
          eq(leadSmsDeliveries.agentTargetId, target.id),
          inArray(leadSmsDeliveries.status, ["queued", "failed", "undelivered"]),
        ));
    }
    twiml(res, "Project Alpha: You have been unsubscribed from lead alerts.");
    return;
  }
  if (phone && startWords.has(keyword)) {
    await db
      .update(listingAgentTargets)
      .set({ optedOutAt: null, optOutKeyword: null, updatedAt: new Date() })
      .where(eq(listingAgentTargets.phoneNumber, phone));
    twiml(res, "Project Alpha: Lead alerts have been restored. Reply STOP to opt out.");
    return;
  }
  if (keyword === "HELP" || keyword === "INFO") {
    twiml(res, "Project Alpha property lead alerts. Visit the Project Alpha sales portal for help. Reply STOP to opt out.");
    return;
  }
  twiml(res);
});

export default router;
