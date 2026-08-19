import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  rubinLayoutGenerations,
  rubinLayouts,
  rubinUserLayouts,
} from "@workspace/db";
import { optionalAuth, requireAuth } from "../lib/auth";
import { getAnonymousInstallHash } from "../lib/anonymous-discovery";
import { hitRateLimit, hours, ipRateLimit, minutes, userRateLimit } from "../lib/rateLimit";

/**
 * Who an hourly generate allowance is counted against.
 *
 * A signed-in caller is their account; a guest is their hashed install id. The
 * `guest:` prefix keeps the two key spaces from ever colliding. Null means the
 * caller offered no identity at all and cannot be metered.
 */
function generateQuotaOwner(req: Request): string | null {
  const userId = (req as unknown as { userId?: string }).userId;
  if (userId) return userId;
  const installHash = getAnonymousInstallHash(req.headers as Record<string, unknown>);
  return installHash ? `guest:${installHash}` : null;
}

/**
 * Storage for the layouts Rubin generates inside the app's WebView.
 *
 * Rubin has no database and no idea who the user is; the app has both. So the
 * embed generates a layout, posts it up through the WebView bridge, and the app
 * calls this — the only place a layout is ever persisted.
 *
 *   POST /rubin-layouts         save one (deduped into the corpus)
 *   GET  /rubin-layouts/latest  the caller's current layout for a site
 *
 * Two things are stored at once, and they are not the same thing:
 *
 *   - the **corpus** (`rubin_layouts`), append-only and deduped on geometry, so
 *     every distinct way a site can be cut up is kept exactly once, with every
 *     generation that produced it attributed in `rubin_layout_generations`;
 *   - the **user's current layout** (`rubin_user_layouts`), overwritten freely,
 *     which is what a re-entry restores.
 */

const router: IRouter = Router();

/** Layouts are dense polygon soup. Generous, but not a memory-exhaustion vector. */
const MAX_CANONICAL_BYTES = 1_000_000;
const MAX_LAYOUT_BYTES = 1_000_000;

/**
 * How many layouts one account may generate per hour.
 *
 * A generation is minutes of solver work on Rubin's Vercel functions, kicked off
 * by a single tap. This is a fairness cap on a genuinely expensive operation,
 * not an abuse control — five is several honest attempts at a site.
 */
const GENERATE_LIMIT_PER_HOUR = 5;

interface SiteInput {
  parcelId: string | null;
  address: string | null;
  zone: string | null;
  lat: number;
  lng: number;
}

/**
 * Four decimal places is roughly 11 m — finer than a parcel, coarser than the
 * jitter between one geocode of an address and the next. Anything tighter and
 * two openings of the same property would key differently and the user's layout
 * would appear to vanish.
 */
function geoKeyOf(lat: number, lng: number): string {
  return `${lat.toFixed(4)}:${lng.toFixed(4)}`;
}

/**
 * The dedup scope. Parcel id when the cadastral lookup produced one, because
 * that is the thing a layout is actually *of*; coordinates otherwise, so a site
 * whose lookup came back empty still accumulates a corpus.
 */
function siteKeyOf(parcelId: string | null, geoKey: string): string {
  return parcelId ? `parcel:${parcelId}` : geoKey;
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next : null;
}

function readSite(raw: unknown): SiteInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const site = raw as Record<string, unknown>;
  const lat = typeof site.lat === "number" && Number.isFinite(site.lat) ? site.lat : null;
  const lng = typeof site.lng === "number" && Number.isFinite(site.lng) ? site.lng : null;
  // Coordinates are mandatory even when a parcel id is present: `geo_key` is
  // the only lookup key the app has before a site finishes loading.
  if (lat === null || lng === null) return null;
  return {
    parcelId: trimmed(site.parcelId),
    address: trimmed(site.address),
    zone: trimmed(site.zone),
    lat,
    lng,
  };
}

/**
 * Claim one generation against the hourly allowance.
 *
 * **Calling this consumes a slot**, so it is called exactly once per confirmed
 * Generate press — not when the panel opens, and not on a retry of a run that
 * already claimed one. Rubin cannot do this itself: it has no idea who the user
 * is, so the WebView asks its host, and the host asks here.
 *
 * The counter is the durable `rate_limit_counters` table rather than anything
 * in memory, because the API runs on stateless serverless instances that do not
 * share state — an in-memory count would reset unpredictably and cap nothing.
 */
router.post(
  "/rubin-layouts/quota",
  optionalAuth,
  // Velocity limits on top of the allowance itself: the allowance is meant to
  // be *reached* by ordinary use, so it cannot double as abuse protection.
  ipRateLimit({ name: "rubin-generate-quota", windowMs: minutes(1), max: 60 }),
  userRateLimit({ name: "rubin-generate-quota", windowMs: minutes(1), max: 20 }),
  async (req: Request, res: Response) => {
    // Guests get the same hourly allowance, counted against their install hash.
    // This has to answer for them: the client treats a failed check as "allowed"
    // (see `answerGeneratePermission`), so a 401 here would hand every guest
    // unlimited solver time rather than capping it.
    const owner = generateQuotaOwner(req);
    if (!owner) {
      res.status(401).json({ error: "Authentication required", code: "UNAUTHORIZED" });
      return;
    }
    const windowMs = hours(1);

    const hit = await hitRateLimit(`rubin-generate:${owner}`, GENERATE_LIMIT_PER_HOUR, windowMs);

    // Fixed windows are aligned to the hour, so the reset is a property of the
    // clock rather than of when this user started — compute it either way so
    // the client can say "resets in N minutes" without a second call.
    const now = Date.now();
    const windowEnd = Math.floor(now / windowMs) * windowMs + windowMs;
    const resetInSeconds = Math.max(1, Math.ceil((windowEnd - now) / 1000));

    // Always a 200. A refusal here is a normal, expected answer about the
    // user's allowance, and a 429 would be indistinguishable from the velocity
    // limiters above tripping — which mean something entirely different.
    res.json({
      allowed: hit.allowed,
      limit: GENERATE_LIMIT_PER_HOUR,
      used: Math.min(hit.count, GENERATE_LIMIT_PER_HOUR),
      remaining: Math.max(0, GENERATE_LIMIT_PER_HOUR - hit.count),
      resetInSeconds,
    });
  },
);

// Guests generate layouts too, and a layout is worth the same to the corpus
// whoever produced it — so the save is open, and only the per-account
// bookkeeping below is skipped for them.
router.post(
  "/rubin-layouts",
  optionalAuth,
  // A layout costs minutes of solver time to produce, so a genuine user cannot
  // reach these. They exist to stop a broken retry loop or a scripted client
  // from filling the corpus with junk.
  ipRateLimit({ name: "rubin-layout-save", windowMs: minutes(1), max: 30 }),
  userRateLimit({ name: "rubin-layout-save", windowMs: minutes(1), max: 10 }),
  userRateLimit({ name: "rubin-layout-save-hr", windowMs: hours(1), max: 120 }),
  async (req: Request, res: Response) => {
    const userId = (req as unknown as { userId?: string }).userId ?? null;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const site = readSite(body.site);
    if (!site) {
      res.status(400).json({ error: "site.lat and site.lng are required numbers." });
      return;
    }

    const canonical = typeof body.canonical === "string" ? body.canonical : "";
    if (!canonical) {
      res.status(400).json({ error: "canonical is required." });
      return;
    }
    if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES) {
      res.status(413).json({ error: "Layout is too large to store." });
      return;
    }

    const layout = body.layout;
    if (typeof layout !== "object" || layout === null) {
      res.status(400).json({ error: "layout must be an object." });
      return;
    }
    if (Buffer.byteLength(JSON.stringify(layout), "utf8") > MAX_LAYOUT_BYTES) {
      res.status(413).json({ error: "Layout is too large to store." });
      return;
    }

    const meta = (body.meta ?? {}) as Record<string, unknown>;
    const lotCountRaw = meta.lotCount;
    const lotCount =
      typeof lotCountRaw === "number" && Number.isFinite(lotCountRaw)
        ? Math.max(0, Math.trunc(lotCountRaw))
        : null;

    // Computed here, never accepted from the client. The fingerprint IS the
    // corpus's notion of identity — a caller that could choose it could collapse
    // two different layouts into one row, or fork one into thousands.
    const fingerprint = createHash("sha256").update(canonical, "utf8").digest("hex");
    const geoKey = geoKeyOf(site.lat, site.lng);
    const siteKey = siteKeyOf(site.parcelId, geoKey);

    try {
      const result = await db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(rubinLayouts)
          .values({
            siteKey,
            geoKey,
            fingerprint,
            canonical,
            layout,
            parcelId: site.parcelId,
            address: site.address,
            zone: site.zone,
            typology: trimmed(meta.typology),
            intensity: trimmed(meta.intensity),
            solverVersion: trimmed(meta.solverVersion),
            lotCount,
            createdBy: userId,
          })
          // Two users generating the same arrangement is the expected case, not
          // a conflict to report. The existing row wins and keeps its original
          // author; this save becomes another attribution.
          .onConflictDoNothing({ target: [rubinLayouts.siteKey, rubinLayouts.fingerprint] })
          .returning({ id: rubinLayouts.id });

        let layoutId = inserted?.id ?? null;
        const deduped = layoutId === null;
        if (!layoutId) {
          const [existing] = await tx
            .select({ id: rubinLayouts.id })
            .from(rubinLayouts)
            .where(
              and(
                eq(rubinLayouts.siteKey, siteKey),
                eq(rubinLayouts.fingerprint, fingerprint),
              ),
            )
            .limit(1);
          layoutId = existing?.id ?? null;
        }
        if (!layoutId) throw new Error("layout row vanished between insert and select");

        // Both of these are keyed on a profile id, so a guest run contributes
        // its layout to the corpus above but leaves no attribution row and no
        // "current layout" to restore later. Giving guests those would mean a
        // second owner column on each table and a primary-key change on
        // rubin_user_layouts — worth doing deliberately, not as a side effect.
        if (userId) {
          // Always written, dedup or not — this is the only record that the run
          // happened at all.
          await tx.insert(rubinLayoutGenerations).values({ layoutId, userId, source: "embed" });

          await tx
            .insert(rubinUserLayouts)
            .values({ userId, siteKey, geoKey, layoutId, updatedAt: new Date() })
            .onConflictDoUpdate({
              target: [rubinUserLayouts.userId, rubinUserLayouts.siteKey],
              set: { layoutId, geoKey, updatedAt: new Date() },
            });
        }

        return { layoutId, deduped };
      });

      res.json({ ok: true, layoutId: result.layoutId, deduped: result.deduped });
    } catch (err) {
      req.log.error({ err }, "POST /rubin-layouts failed");
      res.status(500).json({ error: "Failed to save layout" });
    }
  },
);

router.get(
  "/rubin-layouts/latest",
  optionalAuth,
  ipRateLimit({ name: "rubin-layout-latest", windowMs: minutes(1), max: 120 }),
  userRateLimit({ name: "rubin-layout-latest", windowMs: minutes(1), max: 60 }),
  async (req: Request, res: Response) => {
    const userId = (req as unknown as { userId?: string }).userId ?? null;
    // Guests keep no per-account current layout (see the save route), so there
    // is nothing to restore. The same "no saved layout" shape the lookup below
    // returns, rather than a 401, so the Rubin screen's parallel restore fetch
    // takes its normal miss path instead of an error path.
    if (!userId) {
      res.json({ exists: false });
      return;
    }
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: "lat and lng are required numbers." });
      return;
    }
    const parcelId = trimmed(req.query.parcelId);
    // `summary=1` is the pre-navigation check: it decides whether to skip the
    // intro slides, and must not drag a megabyte of geometry over mobile data
    // to answer a yes/no question.
    const summaryOnly = req.query.summary === "1" || req.query.summary === "true";

    const geoKey = geoKeyOf(lat, lng);
    const siteKey = siteKeyOf(parcelId, geoKey);

    try {
      const columns = {
        updatedAt: rubinUserLayouts.updatedAt,
        lotCount: rubinLayouts.lotCount,
        intensity: rubinLayouts.intensity,
        typology: rubinLayouts.typology,
        solverVersion: rubinLayouts.solverVersion,
        layoutId: rubinLayouts.id,
        layout: rubinLayouts.layout,
      };

      const findBy = async (predicate: ReturnType<typeof and>) =>
        db
          .select(columns)
          .from(rubinUserLayouts)
          .innerJoin(rubinLayouts, eq(rubinUserLayouts.layoutId, rubinLayouts.id))
          .where(predicate)
          .orderBy(desc(rubinUserLayouts.updatedAt))
          .limit(1);

      // Exact site first, then the geo key — unconditionally, because the case
      // the fallback exists for is the caller having *no* parcel id: the app's
      // Rubin screen asks before its own site load has resolved one, while the
      // save that produced the layout had it and keyed on `parcel:{id}`.
      // Gating the fallback on a parcel id would skip it exactly when it is the
      // only thing that can find the row.
      let [row] = await findBy(
        and(eq(rubinUserLayouts.userId, userId), eq(rubinUserLayouts.siteKey, siteKey)),
      );
      if (!row) {
        [row] = await findBy(
          and(eq(rubinUserLayouts.userId, userId), eq(rubinUserLayouts.geoKey, geoKey)),
        );
      }

      if (!row) {
        res.json({ exists: false });
        return;
      }

      const summary = {
        exists: true,
        layoutId: row.layoutId,
        updatedAt: row.updatedAt,
        lotCount: row.lotCount,
        intensity: row.intensity,
        typology: row.typology,
        solverVersion: row.solverVersion,
      };
      res.json(summaryOnly ? summary : { ...summary, layout: row.layout });
    } catch (err) {
      req.log.error({ err }, "GET /rubin-layouts/latest failed");
      res.status(500).json({ error: "Failed to load layout" });
    }
  },
);

export default router;
