/**
 * One-shot backfill: populate property_feature_index from every existing
 * property_cache row. Pure JSONB reshaping via deriveFeatureRow — no network and
 * no pipeline re-run. Idempotent (upsert by address_key), safe to re-run.
 *
 * Run AFTER the table exists (pnpm --filter @workspace/db add-property-feature-index):
 *   pnpm --filter @workspace/api-server backfill-feature-index
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Load env BEFORE importing @workspace/db — its module init throws without
// DATABASE_URL. Mirror the workspace-root + lib/db resolution the .mjs
// migrations use, then dynamically import the db-dependent modules so dotenv has
// already run by the time @workspace/db is evaluated.
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
const { deriveFeatureRow, upsertFeatureRow } = await import("../lib/property-feature-index");
type RawPropertyData = import("../lib/pipeline").RawPropertyData;

const PAGE = 500;
let lastId = "";
let total = 0;

// Keyset pagination by id so a growing table can't loop or skip rows.
for (;;) {
  const rows = await withDbRetry(() =>
    db
      .select()
      .from(propertyCache)
      .where(lastId ? gt(propertyCache.id, lastId) : undefined)
      .orderBy(asc(propertyCache.id))
      .limit(PAGE),
  );
  if (rows.length === 0) break;
  for (const row of rows) {
    await upsertFeatureRow(
      deriveFeatureRow(row.rawData as RawPropertyData, {
        addressKey: row.addressKey,
        canonicalParcelId: row.canonicalParcelId,
        suburb: row.suburb,
        formattedAddress: row.formattedAddress,
        lat: row.lat,
        lng: row.lng,
        pipelineVersion: row.pipelineVersion,
        lastRefreshedAt: row.lastRefreshedAt as unknown as Date,
      }),
    );
    total++;
  }
  lastId = rows[rows.length - 1]!.id;
  console.log(`indexed ${total}...`);
}

console.log(`Done. Indexed ${total} property_cache rows into property_feature_index.`);
process.exit(0);
