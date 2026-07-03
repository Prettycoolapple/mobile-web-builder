/**
 * Targeted LIVE re-acquisition of property_cache rows — the heavier cousin of
 * recompute-derived-scores.ts. Where `recompute` reuses the cached raw bundle
 * (so it can NOT fix missing comparables / stale parcel geometry), this script
 * runs the pipeline with NO cachedRaw, so every source is fetched fresh:
 *
 *   runPropertyPipeline(address, {})   // cachedRaw omitted → fully live
 *
 * Use it to repair cached bundles that were stored incomplete — e.g. a property
 * whose first analysis captured no OneRoof "Nearby Sales" comparables, which
 * suppresses the ROI scenarios and therefore the whole development score
 * (`missing_roi_market_evidence`), and can also leave the report without the
 * parcel geometry the site plan needs. A fresh re-acquisition re-scrapes
 * comparables and re-fetches the LINZ parcel, then upserts the complete bundle
 * back into property_cache + property_feature_index. The next serve of that
 * address then has scores + a working site plan.
 *
 * This is essentially the admin /admin/property-cache/rescan, but TARGETABLE:
 *   --address=<substring>   only rows whose formatted_address ILIKE %substring%
 *   --only-unavailable      only rows whose cached derived_scores.scores is null
 *                           (i.e. currently score-less — the broken ones)
 *   --concurrency=N         parallel live fetches per batch (default 2 — live!)
 *   --limit=N               stop after N processed (for a safe test batch)
 *
 * Idempotent, resumable (keyset pagination), retries each row with backoff.
 *
 *   pnpm --filter @workspace/api-server reacquire-cache -- --address="36 King Street"
 *   pnpm --filter @workspace/api-server reacquire-cache -- --only-unavailable --limit=50
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

const { and, asc, gt, ilike } = await import("drizzle-orm");
const { db, propertyCache, withDbRetry } = await import("@workspace/db");
const { runPropertyPipeline, hasCacheableCore } = await import("../lib/pipeline");
const { upsertCachedRaw, PIPELINE_VERSION } = await import("../lib/property-cache");
const { upsertFeatureRowFromPipeline } = await import("../lib/property-feature-index");
type PropertyCacheRow = import("@workspace/db").PropertyCacheRow;
type SQL = import("drizzle-orm").SQL;

const args = process.argv.slice(2);
const numFlag = (name: string, def: number): number => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : def;
};
const strFlag = (name: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(`--${name}=`.length) : null;
};
const boolFlag = (name: string): boolean => args.includes(`--${name}`);

const CONCURRENCY = numFlag("concurrency", 2);
const LIMIT = numFlag("limit", Infinity);
const ADDRESS = strFlag("address");
const ONLY_UNAVAILABLE = boolFlag("only-unavailable");
const PAGE = 100;

let lastId = "";
let processed = 0;
let repaired = 0; // now has scores after re-acquisition
let stillNoScores = 0; // re-acquired but genuinely no comparables/scores
let failed = 0;

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

async function reacquireOne(row: PropertyCacheRow): Promise<void> {
  const address = row.formattedAddress;
  if (!address) {
    failed++;
    return;
  }
  try {
    // NO cachedRaw → every external source (LINZ parcel geometry, OneRoof
    // comparables, council GIS, scrapers) is fetched live and re-cached.
    const result = await withRetry(row.addressKey, () => runPropertyPipeline(address, {}));
    if (!hasCacheableCore(result) || !result.raw_property) {
      // Re-acquisition came back empty — keep the existing cached data.
      failed++;
      return;
    }
    await upsertCachedRaw({
      addressKey: row.addressKey,
      rawData: result.raw_property,
      canonicalParcelId: result.linz_parcel?.parcel_id ?? row.canonicalParcelId,
      canonicalTitleId: result.linz_parcel?.title_no ?? result.linz_title?.title_no ?? row.canonicalTitleId,
      formattedAddress: result.geocode?.formatted ?? row.formattedAddress,
      lat: result.geocode?.lat ?? row.lat,
      lng: result.geocode?.lng ?? row.lng,
      suburb: result.suburb ?? row.suburb,
      sourceUserId: row.sourceUserId,
    });
    upsertFeatureRowFromPipeline(result, {
      addressKey: row.addressKey,
      lastRefreshedAt: new Date(),
      pipelineVersion: PIPELINE_VERSION, // match the version upsertCachedRaw just stamped
    });
    if (result.scores) repaired++;
    else stillNoScores++;
  } catch (err) {
    failed++;
    console.warn(`re-acquire permanently failed for ${row.addressKey}: ${(err as Error).message}`);
  }
}

function scoreless(row: PropertyCacheRow): boolean {
  const raw = row.rawData as { derived_scores?: { scores?: unknown } } | null;
  return raw?.derived_scores?.scores == null;
}

console.log(
  `Live re-acquisition starting (concurrency=${CONCURRENCY}${ADDRESS ? `, address~"${ADDRESS}"` : ""}${ONLY_UNAVAILABLE ? ", only-unavailable" : ""})...`,
);

outer: for (;;) {
  const conds: SQL[] = [];
  if (lastId) conds.push(gt(propertyCache.id, lastId));
  if (ADDRESS) conds.push(ilike(propertyCache.formattedAddress, `%${ADDRESS}%`));
  const rows = await withDbRetry(() =>
    db
      .select()
      .from(propertyCache)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(propertyCache.id))
      .limit(PAGE),
  );
  if (rows.length === 0) break;
  lastId = rows[rows.length - 1]!.id;

  // JSONB "score-less" filter is applied in JS (keeps the SQL simple/portable).
  const targets = ONLY_UNAVAILABLE ? rows.filter(scoreless) : rows;

  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const slice = targets.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(reacquireOne));
    processed += slice.length;
    if (processed >= LIMIT) break outer;
  }
  console.log(`processed ${processed} (repaired ${repaired}, still-no-scores ${stillNoScores}, failed ${failed})...`);
}

console.log(
  `Done. Processed ${processed}: repaired ${repaired} (scores now present), still-no-scores ${stillNoScores} (genuinely no comparables), failed ${failed}.`,
);
process.exit(0);
