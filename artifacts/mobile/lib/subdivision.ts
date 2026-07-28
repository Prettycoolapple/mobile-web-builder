/**
 * AI Subdivision client — talks to our own API, which proxies Rubin's solver.
 * See `artifacts/api-server/src/lib/rubin.ts` for why we never call Rubin direct.
 *
 * Two calls, in sequence:
 *
 *   fetchSubdivisionSite()      fast. Resolves the parcel and reports whether
 *                               Rubin can analyse it. The result gates the
 *                               "AI Subdivision" button — a user must never tap
 *                               it and receive a raw error.
 *   solveSubdivisionScenario()  slow. Solves ONE scenario. Call it twice in
 *                               parallel (once per scenario) rather than asking
 *                               for both: the server solves scenarios serially
 *                               within a request, so two requests roughly halve
 *                               the wall clock.
 *
 * All coordinates are WGS84 `[lng, lat]` and go straight to the map.
 */

import { getApiBase } from "@/lib/api";

export type SubdivisionPolygon = {
  type: "Polygon";
  coordinates: Array<Array<[number, number]>>;
};

export interface SubdivisionSite {
  address: string;
  parcelId: string;
  legalDescription?: string | null;
  zone: string;
  areaM2: number;
  boundary: SubdivisionPolygon | null;
  centroid: { lat: number; lng: number };
}

export interface SubdivisionLot {
  id: string;
  areaM2: number;
  boundary: SubdivisionPolygon | null;
  /** 0 when the solver could not seat a building on the lot. */
  footprintM2: number;
  footprint: SubdivisionPolygon | null;
}

export type SubdivisionScenarioId = "max-yield" | "high-end";

export interface SubdivisionScenario {
  id: SubdivisionScenarioId;
  /** Display string, already pluralised by the solver (e.g. "3 lots"). */
  label: string;
  lotCount: number;
  lots: SubdivisionLot[];
  drivewayAreaM2: number;
  cached?: boolean;
}

export const SUBDIVISION_SCENARIO_IDS: SubdivisionScenarioId[] = ["max-yield", "high-end"];

export type SubdivisionSiteResult =
  | { supported: true; site: SubdivisionSite }
  | {
      supported: false;
      /** `out-of-area` — outside Auckland; `unsupported-zone` — rural/business. */
      reason: "out-of-area" | "unsupported-zone";
      message: string;
    };

export type SubdivisionSolveResult =
  | { solved: true; site: SubdivisionSite; scenario: SubdivisionScenario; solverVersion: string }
  | { solved: false; reason: "no-layout" | "unsupported" };

/** Retryable failure. Anything non-retryable is expressed in the result types above. */
export class SubdivisionError extends Error {
  readonly retryable: boolean;
  readonly code: string;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "SubdivisionError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * A `/site` lookup is network-bound (LINZ + Auckland Council); measured 5-12 s.
 */
const SITE_TIMEOUT_MS = 90_000;

/**
 * The cold-solve budget, and the single most important number in this file.
 *
 * A cold solve measured 10-37 s per scenario on ordinary suburban parcels, but
 * Rubin documents ~131 s for a hard one and allows itself 300 s. The default
 * fetch timeouts in some environments are tens of seconds — short enough to
 * abort a legitimate cold solve and present it to the user as a failure — so
 * this is set explicitly and generously. It sits above the server's own 240 s
 * Rubin budget, so a slow solve surfaces the server's structured error rather
 * than an opaque client-side abort.
 */
const SOLVE_TIMEOUT_MS = 270_000;

interface ApiFailure {
  error?: unknown;
  code?: unknown;
  retryable?: unknown;
}

async function postJson<T>(
  path: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as ApiFailure | null;
      const message = typeof data?.error === "string" ? data.error : "Subdivision analysis failed";
      const code = typeof data?.code === "string" ? data.code : `HTTP_${response.status}`;
      // 429 and 5xx are worth another attempt; a 4xx from our own API is not.
      const retryable = data?.retryable === true || response.status === 429 || response.status >= 500;
      throw new SubdivisionError(message, code, retryable);
    }

    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof SubdivisionError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SubdivisionError("Subdivision analysis timed out", "TIMEOUT", true);
    }
    throw new SubdivisionError("Could not reach the subdivision service", "NETWORK", true);
  } finally {
    clearTimeout(timer);
  }
}

export interface SubdivisionTarget {
  address?: string | null;
  /** Pass when known — it avoids a geocode round trip and is unambiguous. */
  lat?: number | null;
  lng?: number | null;
}

function targetBody(target: SubdivisionTarget): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (target.address?.trim()) body.address = target.address.trim();
  if (typeof target.lat === "number" && typeof target.lng === "number") {
    body.lat = target.lat;
    body.lng = target.lng;
  }
  return body;
}

export function canRequestSubdivision(target: SubdivisionTarget): boolean {
  const body = targetBody(target);
  return typeof body.address === "string" || typeof body.lat === "number";
}

export async function fetchSubdivisionSite(
  target: SubdivisionTarget,
  headers: Record<string, string>,
): Promise<SubdivisionSiteResult> {
  const data = await postJson<{
    supported?: boolean;
    site?: SubdivisionSite;
    reason?: "out-of-area" | "unsupported-zone";
    message?: string;
  }>("/subdivision/site", targetBody(target), headers, SITE_TIMEOUT_MS);

  if (data.supported && data.site) return { supported: true, site: data.site };
  return {
    supported: false,
    reason: data.reason ?? "out-of-area",
    message: data.message ?? "Subdivision analysis is not available for this property.",
  };
}

export async function solveSubdivisionScenario(
  target: SubdivisionTarget,
  scenario: SubdivisionScenarioId,
  headers: Record<string, string>,
): Promise<SubdivisionSolveResult> {
  const data = await postJson<{
    supported?: boolean;
    solved?: boolean;
    site?: SubdivisionSite;
    scenario?: SubdivisionScenario | null;
    solverVersion?: string;
  }>("/subdivision/solve", { ...targetBody(target), scenario }, headers, SOLVE_TIMEOUT_MS);

  if (data.supported === false) return { solved: false, reason: "unsupported" };
  if (!data.solved || !data.scenario || !data.site) return { solved: false, reason: "no-layout" };
  return {
    solved: true,
    site: data.site,
    scenario: data.scenario,
    solverVersion: data.solverVersion ?? "",
  };
}
