/**
 * Client for Rubin's public B2C API — the subdivision solver behind the app's
 * "AI Subdivision" feature. See `rubin/docs/architecture-b2c-b2b.md`.
 *
 * The mobile app never calls Rubin directly, for three reasons:
 *
 *  1. **CORS.** Rubin's `/api/v1/*` routes send no `Access-Control-Allow-Origin`,
 *     so the app's web target would be blocked outright. We are same-origin.
 *  2. **Reachability.** The Rubin base URL becomes an env var here rather than a
 *     constant baked into a shipped binary, so it can move without an App Store
 *     release.
 *  3. **Cost.** A cold solve is minutes of billed Vercel compute on Rubin's side
 *     and is currently unauthenticated. Fronting it with our own auth + per-user
 *     rate limit is the only thing standing between it and a scraper.
 *
 * Rubin covers **Auckland only** — it reads Auckland Council parcels and applies
 * Auckland Unitary Plan rules. Anywhere else 404s with a message about a missing
 * cadastral parcel, which reads like a bug rather than "unsupported region"; the
 * classification below turns that into something a UI can state honestly.
 */

import { getRubinApiBase } from "./env";

/** GeoJSON Polygon in WGS84 `[lng, lat]` order — drawable with no conversion. */
export type RubinPolygon = {
  type: "Polygon";
  coordinates: Array<Array<[number, number]>>;
};

export interface RubinSite {
  address: string;
  parcelId: string;
  legalDescription?: string | null;
  zone: string;
  areaM2: number;
  boundary: RubinPolygon | null;
  centroid: { lat: number; lng: number };
  nztm?: { easting: number; northing: number };
}

export interface RubinLot {
  id: string;
  areaM2: number;
  boundary: RubinPolygon | null;
  footprintM2: number;
  footprint: RubinPolygon | null;
}

export type RubinScenarioId = "max-yield" | "high-end";

export interface RubinScenario {
  id: RubinScenarioId;
  label: string;
  lotCount: number;
  lots: RubinLot[];
  drivewayAreaM2: number;
  cached?: boolean;
}

export interface RubinSiteResponse {
  site: RubinSite;
  subdivisionSupported: boolean;
}

export interface RubinSubdivideResponse {
  site: RubinSite;
  scenarios: RubinScenario[];
  solverVersion: string;
  cacheEnabled: boolean;
}

export const RUBIN_SCENARIO_IDS: RubinScenarioId[] = ["max-yield", "high-end"];

/**
 * Why a Rubin call could not produce a subdivision. `unsupported` is the one the
 * UI must treat as a normal, expected answer rather than a failure: it covers
 * both "outside Auckland" (404) and "rural/business zone" (422).
 */
export type RubinFailureKind =
  | "unsupported"
  | "upstream"
  | "bad-request"
  | "timeout"
  | "unknown";

export class RubinError extends Error {
  readonly kind: RubinFailureKind;
  /** HTTP status to hand back to our own client; mirrors Rubin's where sensible. */
  readonly status: number;
  readonly detail: string | null;

  constructor(kind: RubinFailureKind, status: number, message: string, detail: string | null = null) {
    super(message);
    this.name = "RubinError";
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * A `/site` lookup is network-bound (LINZ + Auckland Council), never CPU-bound.
 * Measured ~5-12 s; 60 s is Rubin's own ceiling for the route.
 */
const SITE_TIMEOUT_MS = 60_000;

/**
 * A cold solve is the slow path this whole feature is designed around. Measured
 * 10-37 s per scenario on ordinary suburban parcels, but Rubin documents ~131 s
 * for a hard one and caps its own function at 300 s. We wait 240 s so that a
 * genuinely slow solve completes rather than being aborted and reported to the
 * user as a failure — an abort here wastes the compute *and* loses the cache
 * write that would have made every later view instant.
 */
const SUBDIVIDE_TIMEOUT_MS = 240_000;

interface RubinErrorBody {
  error?: unknown;
  detail?: unknown;
}

function readErrorBody(body: RubinErrorBody | null): { error: string | null; detail: string | null } {
  return {
    error: typeof body?.error === "string" ? body.error : null,
    detail: typeof body?.detail === "string" ? body.detail : null,
  };
}

/**
 * Map a Rubin HTTP status onto a failure kind. Rubin's status codes are part of
 * its frozen v1 contract, so switching on them is safe.
 */
function classify(status: number, error: string | null): RubinError {
  if (status === 404) {
    // "No cadastral parcel found" / "No address matched" — either the address is
    // unknown to LINZ or it sits outside Auckland's parcel coverage. Both mean
    // the same thing to a consumer: not something we can analyse here.
    return new RubinError("unsupported", 404, error ?? "No parcel found for that address");
  }
  if (status === 422) {
    // Rural, business or otherwise unmapped zone — Rubin carries AUP residential
    // rules only and refuses rather than inventing plausible, wrong lots.
    return new RubinError("unsupported", 422, error ?? "Unsupported zone");
  }
  if (status === 400) {
    // Malformed request — ours to fix, so it must be loud in the logs.
    return new RubinError("bad-request", 500, error ?? "Malformed request to Rubin");
  }
  if (status === 502 || status === 503 || status === 504) {
    // LINZ or Auckland Council upstream wobble. Transient; worth retrying.
    return new RubinError("upstream", 502, error ?? "Rubin upstream data source failed");
  }
  return new RubinError("unknown", 502, error ?? `Rubin returned HTTP ${status}`);
}

async function callRubin<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const url = `${getRubinApiBase()}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new RubinError(
      aborted ? "timeout" : "upstream",
      aborted ? 504 : 502,
      aborted ? "Subdivision analysis timed out" : "Could not reach the subdivision service",
      String(err),
    );
  }

  if (!response.ok) {
    const parsed = (await response.json().catch(() => null)) as RubinErrorBody | null;
    const { error, detail } = readErrorBody(parsed);
    const classified = classify(response.status, error);
    throw new RubinError(classified.kind, classified.status, classified.message, detail);
  }

  return (await response.json()) as T;
}

/**
 * Resolve an address (or coordinate) to a parcel, zone, area and boundary.
 * Fast — no solving. Gate the "AI Subdivision" entry point on the
 * `subdivisionSupported` flag this returns.
 */
export function fetchRubinSite(input: {
  address?: string;
  lat?: number;
  lng?: number;
}): Promise<RubinSiteResponse> {
  return callRubin<RubinSiteResponse>("/api/v1/site", input, SITE_TIMEOUT_MS);
}

/**
 * Solve ONE scenario. Always pass a scenario: omitting it makes Rubin solve both
 * sequentially in a single function (~260 s cold). Two calls, one per scenario,
 * run as separate Vercel functions and roughly halve the wall clock.
 */
export function fetchRubinScenario(input: {
  address?: string;
  lat?: number;
  lng?: number;
  scenario: RubinScenarioId;
}): Promise<RubinSubdivideResponse> {
  return callRubin<RubinSubdivideResponse>("/api/v1/subdivide", input, SUBDIVIDE_TIMEOUT_MS);
}
