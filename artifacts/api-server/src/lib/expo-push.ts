import { db, pushTokens } from "@workspace/db";
import { inArray } from "drizzle-orm";
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

const INVALID_TOKEN_ERRORS = new Set([
  "DeviceNotRegistered",
  "InvalidCredentials",
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
    if (
      ticket?.status === "error" &&
      ticket.details?.error &&
      INVALID_TOKEN_ERRORS.has(ticket.details.error)
    ) {
      const tok = tokens[idx];
      if (tok) invalidTokens.push(tok);
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
