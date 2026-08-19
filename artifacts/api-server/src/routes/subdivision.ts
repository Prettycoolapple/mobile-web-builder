import { Router, type IRouter, type Request, type Response } from "express";
import { optionalAuth, requireAuth } from "../lib/auth";
import { ipRateLimit, userRateLimit, minutes, hours } from "../lib/rateLimit";
import {
  fetchRubinScenario,
  fetchRubinSite,
  RubinError,
  RUBIN_SCENARIO_IDS,
  type RubinScenarioId,
} from "../lib/rubin";

/**
 * AI Subdivision — the app's façade over Rubin's solver (see `lib/rubin.ts`).
 *
 * Two endpoints, called in sequence by the client:
 *
 *   POST /subdivision/site   fast; resolves the parcel and says whether Rubin
 *                            can analyse it at all. Gates the UI button.
 *   POST /subdivision/solve  slow; solves ONE scenario. The client fires two of
 *                            these in parallel, one per scenario.
 *
 * **"Unsupported" is a 200, not an error.** Rubin covers Auckland only and
 * answers 404 for anywhere else — a status that reads like a bug. Collapsing
 * that into `{ supported: false, reason }` on a 200 means the client can state
 * the limitation honestly, and a real 4xx/5xx from this route still means
 * something actually went wrong.
 */

const router: IRouter = Router();

interface SiteInput {
  address?: string;
  lat?: number;
  lng?: number;
}

/**
 * Prefer coordinates when the client has them: Rubin geocodes an address string
 * through LINZ, which costs a round trip and can resolve to a neighbouring
 * property when the formatting differs. The address still rides along as a label
 * for the response.
 */
function readSiteInput(req: Request): SiteInput | null {
  const body = (req.body ?? {}) as { address?: unknown; lat?: unknown; lng?: unknown };
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const lat = typeof body.lat === "number" && Number.isFinite(body.lat) ? body.lat : null;
  const lng = typeof body.lng === "number" && Number.isFinite(body.lng) ? body.lng : null;

  if (lat !== null && lng !== null) {
    return address ? { address, lat, lng } : { lat, lng };
  }
  if (address.length >= 3) return { address };
  return null;
}

/** Human-readable reason a site cannot be analysed, keyed for client i18n. */
function unsupportedReason(err: RubinError): "out-of-area" | "unsupported-zone" {
  return err.status === 422 ? "unsupported-zone" : "out-of-area";
}

/**
 * Translate a RubinError into our response. Only `unsupported` becomes a 200 —
 * everything else stays a failure so the client can offer a retry rather than
 * telling the user the feature does not work at their address.
 */
function sendRubinFailure(req: Request, res: Response, err: RubinError, route: string): void {
  if (err.kind === "unsupported") {
    res.json({
      supported: false,
      reason: unsupportedReason(err),
      message: err.message,
    });
    return;
  }

  if (err.kind === "bad-request") {
    // Rubin rejected the request shape. That is our defect, not the user's, and
    // it is invisible from the client — log it loudly.
    req.log.error({ err, detail: err.detail }, `${route}: Rubin rejected our request`);
    res.status(500).json({ error: "Subdivision request failed", code: "CLIENT_BUG" });
    return;
  }

  const code = err.kind === "timeout" ? "TIMEOUT" : "UPSTREAM";
  req.log.warn({ err, detail: err.detail }, `${route}: Rubin ${err.kind}`);
  res.status(err.status).json({ error: err.message, code, retryable: true });
}

function handleUnexpected(req: Request, res: Response, err: unknown, route: string): void {
  if (err instanceof RubinError) {
    sendRubinFailure(req, res, err, route);
    return;
  }
  req.log.error({ err }, `${route} failed`);
  res.status(500).json({ error: "Subdivision analysis failed" });
}

// AI Subdivision is free and open to guests as well as signed-in users, so this
// gate takes `optionalAuth`: a valid token still identifies the caller (and arms
// `userRateLimit`), but its absence is not a refusal. Guests fall back to the IP
// velocity cap, which is what bounds this call for them.
router.post(
  "/subdivision/site",
  optionalAuth,
  ipRateLimit({ name: "subdivision-site", windowMs: minutes(1), max: 60 }),
  userRateLimit({ name: "subdivision-site", windowMs: minutes(1), max: 30 }),
  async (req: Request, res: Response) => {
    const input = readSiteInput(req);
    if (!input) {
      res.status(400).json({ error: "Supply an address (min 3 chars) or numeric lat and lng." });
      return;
    }

    try {
      const data = await fetchRubinSite(input);
      // Rubin resolved the parcel but flagged it unsolvable (e.g. a business
      // zone). Same shape as a 404 so the client has one code path.
      if (!data.subdivisionSupported) {
        res.json({
          supported: false,
          reason: "unsupported-zone",
          message: `Subdivision analysis does not cover ${data.site?.zone ?? "this zone"}.`,
          site: data.site ?? null,
        });
        return;
      }
      res.json({ supported: true, site: data.site });
    } catch (err) {
      handleUnexpected(req, res, err, "POST /subdivision/site");
    }
  },
);

router.post(
  "/subdivision/solve",
  requireAuth,
  // A cold solve is minutes of billed compute on Rubin. One user tap costs two
  // requests, so these caps allow several taps a minute and a long session's
  // worth per hour, while making bulk harvesting impractical.
  ipRateLimit({ name: "subdivision-solve", windowMs: minutes(1), max: 20 }),
  userRateLimit({ name: "subdivision-solve", windowMs: minutes(1), max: 6 }),
  userRateLimit({ name: "subdivision-solve-hr", windowMs: hours(1), max: 60 }),
  async (req: Request, res: Response) => {
    const input = readSiteInput(req);
    if (!input) {
      res.status(400).json({ error: "Supply an address (min 3 chars) or numeric lat and lng." });
      return;
    }

    const requested = (req.body as { scenario?: unknown })?.scenario;
    if (typeof requested !== "string" || !RUBIN_SCENARIO_IDS.includes(requested as RubinScenarioId)) {
      res.status(400).json({ error: `scenario must be one of: ${RUBIN_SCENARIO_IDS.join(", ")}` });
      return;
    }
    const scenario = requested as RubinScenarioId;

    try {
      const data = await fetchRubinScenario({ ...input, scenario });
      // Rubin drops a scenario it could not lay out rather than failing the
      // request, so an empty array is "no viable layout on this site" — a real
      // answer, and one the UI must show as such instead of an empty card.
      const solved = data.scenarios.find((entry) => entry.id === scenario) ?? null;
      if (!solved) {
        res.json({
          supported: true,
          solved: false,
          reason: "no-layout",
          site: data.site,
          scenario: null,
          solverVersion: data.solverVersion,
        });
        return;
      }

      res.json({
        supported: true,
        solved: true,
        site: data.site,
        scenario: solved,
        solverVersion: data.solverVersion,
        // Surfaced for diagnostics: a deploy without the Supabase pair recomputes
        // every solve, which presents as unexplained latency rather than an error.
        cacheEnabled: data.cacheEnabled,
      });
    } catch (err) {
      handleUnexpected(req, res, err, "POST /subdivision/solve");
    }
  },
);

export default router;
