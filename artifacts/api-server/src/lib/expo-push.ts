import { db, pushTokens } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";

interface ExpoTicket {
  status?: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

interface ExpoResponse {
  data?: ExpoTicket[];
  errors?: unknown;
}

// Only DeviceNotRegistered indicates a per-device token that should be pruned
// (the user uninstalled the app, revoked notif permission, or the install was
// reset). Other errors like InvalidCredentials, MessageTooBig,
// MessageRateExceeded or MismatchSenderId are operational/config issues — they
// affect the *whole project*, not a single device, so deleting tokens on those
// errors would silently nuke the entire push fleet.
const INVALID_TOKEN_ERRORS = new Set(["DeviceNotRegistered"]);
const OPERATIONAL_ERRORS = new Set([
  "InvalidCredentials",
  "MismatchSenderId",
  "MessageTooBig",
  "MessageRateExceeded",
]);

/**
 * Send a batch of Expo push notifications and prune any tokens that Expo
 * reports as invalid (e.g. the user uninstalled the app or revoked notif
 * permission). Centralised so /dm and /recommendations stay in sync, and so
 * we never leak silent network errors that would mask delivery problems
 * during TestFlight / closed-track testing.
 */
export async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (tokens.length === 0) return;

  const messages = tokens.map((to) => ({ to, title, body, data, sound: "default" }));

  let parsed: ExpoResponse | null = null;
  try {
    const resp = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(messages),
    });
    if (!resp.ok) {
      logger.warn({ status: resp.status }, "Expo push: non-2xx response");
      return;
    }
    parsed = (await resp.json()) as ExpoResponse;
  } catch (err) {
    logger.warn({ err }, "Expo push: network error");
    return;
  }

  const tickets = parsed?.data ?? [];
  const invalidTokens: string[] = [];
  tickets.forEach((ticket, idx) => {
    if (ticket?.status !== "error") return;
    const code = ticket.details?.error;
    if (!code) return;
    if (INVALID_TOKEN_ERRORS.has(code)) {
      const tok = tokens[idx];
      if (tok) invalidTokens.push(tok);
    } else if (OPERATIONAL_ERRORS.has(code)) {
      // Surface but never prune — this is a project-level / config issue.
      logger.error(
        { code, message: ticket.message },
        "Expo push: operational error (NOT pruning tokens)",
      );
    }
  });

  if (invalidTokens.length > 0) {
    try {
      await db.delete(pushTokens).where(inArray(pushTokens.token, invalidTokens));
      logger.info({ count: invalidTokens.length }, "Expo push: pruned invalid push tokens");
    } catch (err) {
      logger.warn({ err }, "Expo push: failed to prune invalid tokens");
    }
  }
}

/** Load every Expo push token for a user and send (best-effort). */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  const rows = await db.select({ token: pushTokens.token }).from(pushTokens).where(eq(pushTokens.userId, userId));
  await sendExpoPush(
    rows.map((r) => r.token),
    title,
    body,
    data,
  );
}
