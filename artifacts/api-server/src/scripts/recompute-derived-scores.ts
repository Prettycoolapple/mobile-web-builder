/**
 * Targeted recompute: for every existing property_cache row, re-run the
 * DERIVED layer only (scores, potential lots, roiPercentBest) from the RAW
 * data already on file — NOT a full rescan. This is deliberately much
 * cheaper than /admin/property-cache/rescan:
 *
 *   - LINZ parcel/title, Auckland Council zone/overlays/contour/infrastructure,
 *     and the property scrapers (Hougarden/OneRoof/QV/Homes/PropertyValue) are
 *     all served from the cached raw_data bundle — NO live calls to those.
 *   - Only two lightweight live checks still run (same as any normal serve):
 *     the "is this still an active listing" lookup (for price/photo context)
 *     and, if the cached comparables are thin (<3), a small supplemental
 *     comparables fetch. Everything else — cost model, ROI scenarios, lot
 *     yield, scoring — is pure computation over the cached raw bundle.
 *
 * Use this after a SCORING_VERSION bump (e.g. to populate the new
 * roiPercentBest field) instead of a full rescan — it brings every cached
 * property's derived_scores up to the current formula without re-hitting
 * LINZ/council/scrapers for data that hasn't changed.
 *
 * Writes back via the SAME best-effort hooks the live serve path uses:
 *   - backfillDerivedScores(): patches ONLY rawData.derived_scores, and
 *     deliberately does NOT touch lastRefreshedAt / pipelineVersion /
 *     refreshCount — a recompute is not a re-acquisition, so it must never
 *     reset the cache row's staleness clock.
 *   - upsertFeatureRowFromPipeline(): refreshes the property_feature_index
 *     row's derived columns (lots, scores, roiPercentBest, scoringVersion)
 *     the same way, preserving last_refreshed_at.
 *
 * Concurrency model: rows are processed in SEQUENTIAL batches of `--concurrency`
 * (default 3) via Promise.all — never more than that many in flight at once,
 * and each property only ever touches its own row (keyed by addressKey), so
 * there is no shared mutable state and no race condition between properties.
 * A single property that keeps failing gets up to 4 attempts with exponential
 * backoff (1s/2s/4s) before being counted as failed and skipped.
 *
 * Idempotent (upsert), resumable (keyset pagination) — a failed row is simply
 * picked up again (and retried) on the next run, so re-running the whole
 * script is always safe.
 *
 *   pnpm --filter @workspace/api-server recompute-derived-scores
 *   pnpm --filter @workspace/api-server recompute-derived-scores -- --concurrency=5 --limit=500
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function findWorkspaceRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}
const workspaceRoot = findWorkspaceRoot(__dirname);
const dbPackageRoot = path.join(workspaceRoot, "lib", "db");
for (const envPath of [path.join(workspaceRoot, ".env"), path.join(dbPackageRoot, ".env")]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}
for (const envPath of [path.join(workspaceRoot, ".env.local"), path.join(dbPackageRoot, ".env.local")]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: true });
}

const { asc, gt } = await import("drizzle-orm");
const { db, propertyCache, withDbRetry } = await import("@workspace/db");
const { runPropertyPipeline, hasCacheableCore } = await import("../lib/pipeline");
const { backfillDerivedScores } = await import("../lib/property-cache");
const { upsertFeatureRowFromPipeline } = await import("../lib/property-feature-index");
const { SCORING_VERSION } = await import("../lib/card-score");
type RawPropertyData = import("../lib/pipeline").RawPropertyData;
type PropertyCacheRow = import("@workspace/db").PropertyCacheRow;

const args = process.argv.slice(2);
const flag = (name: string, def: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : def;
};
const CONCURRENCY = flag("concurrency", 3);
const LIMIT = flag("limit", Infinity);
const PAGE = 200;

let lastId = "";
let processed = 0;
let updated = 0;
let skippedCurrent = 0;
let failed = 0;

function alreadyCurrent(row: PropertyCacheRow): boolean {
  const ds = (row.rawData as RawPropertyData | null)?.derived_scores;
  return ds?.scoringVersion === SCORING_VERSION && ds?.roiPercentBest != null;
}

const MAX_ATTEMPTS = 4; // 1 try + 3 retries
const BASE_DELAY_MS = 1000; // 1s, 2s, 4s

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a single property's recompute with exponential backoff. Transient
 * failures (a flaky live listing lookup, a momentary comparables-fetch
 * timeout) are the expected failure mode here — not data problems — so a
 * short backoff is enough to ride them out before giving up on this row.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_ATTEMPTS) break;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(`${label}: attempt ${attempt}/${MAX_ATTEMPTS} failed (${(err as Error).message}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function recomputeOne(row: PropertyCacheRow): Promise<void> {
  if (!row.formattedAddress) {
    failed++;
    return;
  }
  if (alreadyCurrent(row)) {
    skippedCurrent++;
    return;
  }
  try {
    const result = await withRetry(row.addressKey, () =>
      runPropertyPipeline(row.formattedAddress!, {
        cachedRaw: row.rawData as RawPropertyData,
        cachedRawAcquiredAt: (row.lastRefreshedAt as unknown as Date)?.toISOString?.() ?? null,
      }),
    );
    if (!hasCacheableCore(result) || !result.raw_property?.derived_scores) {
      failed++;
      return;
    }
    // Patch ONLY derived_scores — never resets lastRefreshedAt/pipelineVersion.
    await backfillDerivedScores(row.addressKey, result.raw_property.derived_scores);
    // Mirror the same freshness-preserving refresh into the feature index.
    upsertFeatureRowFromPipeline(result, {
      addressKey: row.addressKey,
      lastRefreshedAt: row.lastRefreshedAt as unknown as Date,
      pipelineVersion: row.pipelineVersion,
    });
    updated++;
  } catch (err) {
    failed++;
    console.warn(`recompute permanently failed for ${row.addressKey} after ${MAX_ATTEMPTS} attempts: ${(err as Error).message}`);
  }
}

console.log(`Recomputing derived scores (target SCORING_VERSION=${SCORING_VERSION}), concurrency=${CONCURRENCY}...`);

outer: for (;;) {
  const rows = await withDbRetry(() =>
    db
      .select()
      .from(propertyCache)
      .where(lastId ? gt(propertyCache.id, lastId) : undefined)
      .orderBy(asc(propertyCache.id))
      .limit(PAGE),
  );
  if (rows.length === 0) break;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const slice = rows.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(recomputeOne));
    processed += slice.length;
    if (processed >= LIMIT) break outer;
  }

  lastId = rows[rows.length - 1]!.id;
  console.log(`processed ${processed} (updated ${updated}, already-current ${skippedCurrent}, failed ${failed})...`);
}

console.log(
  `Done. Processed ${processed}: updated ${updated}, already-current ${skippedCurrent}, failed ${failed}.`,
);
process.exit(0);
