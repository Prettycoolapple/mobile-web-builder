/**
 * The app's half of the Rubin WebView bridge.
 *
 * Rubin owns the whole generation experience — the intensity picker, the load
 * gate, the detect→subdivide orchestrator — because it ships through Vercel and
 * reaches users the same day. The app owns the two things Rubin has none of:
 * who the user is, and anywhere to put a layout. This module is that seam, plus
 * the two API calls behind it.
 *
 * Mirrors `rubin/utils/hostBridge.ts`. **Both sides ignore unknown message
 * types and unknown envelope versions**, and that is load-bearing rather than
 * defensive habit: this file ships inside a TestFlight build that can never be
 * upgraded, while Rubin behind it changes weekly. A new Rubin will be talking to
 * this exact code months from now, and must be able to add messages without
 * breaking it.
 */

import { getApiBase } from "@/lib/api";

export const RUBIN_BRIDGE_VERSION = 1;

/**
 * Density stop, as it travels and as it is stored.
 *
 * The wire values outlive their labels: Rubin's panel calls them Standard, High
 * and Max, and they select standard, dense and super-dense subdivision. This
 * build must not care which — a Rubin deployed next month may relabel or
 * re-point them, and the `typology` field on `layout-complete` is what actually
 * names the solver. These three strings are only ever passed through to storage.
 */
export type RubinIntensity = "low" | "medium" | "high";

/** Native feedback styles Rubin can ask for while a gesture is in flight. */
export type RubinHapticStyle = "light" | "medium" | "heavy" | "selection";

export type RubinRunState =
  | "idle"
  | "confirming"
  | "checking"
  | "resetting"
  | "awaiting-site"
  | "detecting"
  | "subdividing"
  | "populating"
  | "capturing"
  | "done"
  | "error";

export interface RubinSiteIdentity {
  parcelId: string | null;
  address: string | null;
  zone: string | null;
  lat: number | null;
  lng: number | null;
}

export type RubinInboundMessage =
  | { type: "ready"; caps: string[]; build: string }
  | ({ type: "site-ready" } & RubinSiteIdentity)
  | { type: "site-error"; stage: string; message: string; retryable: boolean }
  | { type: "run-state"; state: RubinRunState; intensity: RubinIntensity | null }
  | {
      type: "layout-complete";
      intensity: RubinIntensity;
      typology: string;
      solverVersion: string;
      lotCount: number;
      site: RubinSiteIdentity;
      canonical: string;
      layout: unknown;
    }
  | { type: "layout-error"; failedState: RubinRunState; message: string }
  | { type: "hydrated"; ok: boolean; message?: string }
  /**
   * "Tap the phone." Rubin's density slider ticks as the thumb passes a stop,
   * and it cannot do that itself — there is no Vibration API in an iOS
   * WKWebView. Purely advisory: the host taps or it does not, and nothing in
   * Rubin waits for an answer.
   */
  | { type: "haptic"; style: RubinHapticStyle }
  | { type: "generate-permission-request"; requestId: string; intensity: RubinIntensity };

export type RubinOutboundMessage =
  | { type: "init"; hasSavedLayout: boolean }
  | { type: "hydrate"; layout: unknown; savedAt: string | null }
  | {
      type: "generate-permission";
      requestId: string;
      allowed: boolean;
      limit?: number;
      remaining?: number;
      resetInSeconds?: number;
    };

const INBOUND_TYPES = new Set([
  "ready",
  "site-ready",
  "site-error",
  "run-state",
  "layout-complete",
  "layout-error",
  "hydrated",
  "haptic",
  "generate-permission-request",
]);

/**
 * Parse a `onMessage` payload. Returns null for anything this build does not
 * understand — a newer Rubin's new message type, or a newer envelope version.
 */
export function parseRubinMessage(raw: string): RubinInboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const envelope = parsed as { v?: unknown; type?: unknown };
  // A missing `v` can only come from a Rubin predating the field; a *different*
  // one is a protocol this build was not written against.
  if (typeof envelope.v === "number" && envelope.v !== RUBIN_BRIDGE_VERSION) return null;
  if (typeof envelope.type !== "string" || !INBOUND_TYPES.has(envelope.type)) return null;

  return parsed as RubinInboundMessage;
}

/**
 * Build the source for `webView.injectJavaScript`.
 *
 * Injected rather than posted through `window.postMessage` because the two
 * platforms disagree about where that event lands (iOS delivers on `window`,
 * Android on `document`), and code listening to both double-handles on one of
 * them. A function call means one thing everywhere.
 *
 * The payload is embedded as a JSON *string literal* — `JSON.stringify` twice —
 * so a layout containing quotes or newlines cannot break out of the expression.
 * The trailing `true;` is required: iOS warns when injected script evaluates to
 * a non-serialisable value.
 */
export function buildRubinInjection(message: RubinOutboundMessage): string {
  const payload = JSON.stringify(JSON.stringify({ v: RUBIN_BRIDGE_VERSION, ...message }));
  return `window.__RUBIN_BRIDGE__ && window.__RUBIN_BRIDGE__.receive(${payload}); true;`;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface SaveRubinLayoutInput {
  site: RubinSiteIdentity & { lat: number; lng: number };
  canonical: string;
  layout: unknown;
  meta: {
    typology: string;
    intensity: RubinIntensity;
    solverVersion: string;
    lotCount: number;
  };
}

export interface RubinLayoutSummary {
  exists: boolean;
  layoutId?: string;
  updatedAt?: string;
  lotCount?: number | null;
  intensity?: string | null;
  typology?: string | null;
  solverVersion?: string | null;
  /** Absent in summary form. */
  layout?: unknown;
}

/** A layout is minutes of solver time; a transient network blip must not lose it. */
const SAVE_ATTEMPTS = 3;
const SAVE_RETRY_DELAY_MS = [750, 2500];
const REQUEST_TIMEOUT_MS = 20_000;

async function withTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Persist a generated layout. Resolves false when every attempt failed.
 *
 * Deliberately non-throwing: the layout is already drawn on the canvas and the
 * user is looking at it. A failed save is worth a log, not an error over their
 * work — and the server's unique constraint makes a later duplicate attempt
 * harmless anyway.
 */
export async function saveRubinLayout(
  input: SaveRubinLayoutInput,
  headers: Record<string, string>,
): Promise<boolean> {
  for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt += 1) {
    try {
      const response = await withTimeout(`${getApiBase()}/rubin-layouts`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(input),
      });
      if (response.ok) return true;
      // A 4xx means this payload will never be accepted — retrying just burns
      // battery and rate limit.
      if (response.status < 500 && response.status !== 429) {
        console.warn("[rubinBridge] layout save rejected:", response.status);
        return false;
      }
    } catch (err) {
      console.warn("[rubinBridge] layout save failed:", err);
    }
    const delay = SAVE_RETRY_DELAY_MS[attempt];
    if (delay !== undefined) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
  return false;
}

export interface RubinGenerateQuota {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
  resetInSeconds: number;
}

/**
 * Claim one generation against the account's hourly allowance.
 *
 * **Calling this consumes a slot.** Rubin asks for permission once per confirmed
 * Generate press and this is the answer — it must not be called speculatively.
 *
 * Throws on any transport failure. The caller lets the run proceed in that case:
 * the allowance is a fairness cap on expensive work, and refusing to generate
 * because our own API is unreachable would break the feature to enforce it.
 */
export async function claimRubinGenerateQuota(
  headers: Record<string, string>,
): Promise<RubinGenerateQuota> {
  const response = await withTimeout(`${getApiBase()}/rubin-layouts/quota`, {
    method: "POST",
    headers: { ...headers, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Quota check failed: HTTP ${response.status}`);
  return (await response.json()) as RubinGenerateQuota;
}

export interface LatestRubinLayoutQuery {
  lat: number;
  lng: number;
  parcelId?: string | null;
  /** Summary form: everything except the geometry. */
  summary?: boolean;
}

/** The caller's saved layout for a site, or `{ exists: false }`. */
export async function fetchLatestRubinLayout(
  query: LatestRubinLayoutQuery,
  headers: Record<string, string>,
): Promise<RubinLayoutSummary> {
  const params = new URLSearchParams({
    lat: String(query.lat),
    lng: String(query.lng),
  });
  if (query.parcelId) params.set("parcelId", query.parcelId);
  if (query.summary) params.set("summary", "1");

  const response = await withTimeout(`${getApiBase()}/rubin-layouts/latest?${params.toString()}`, {
    headers: { ...headers, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Layout lookup failed: HTTP ${response.status}`);
  return (await response.json()) as RubinLayoutSummary;
}
