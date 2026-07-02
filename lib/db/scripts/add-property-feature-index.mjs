/**
 * Migration: property_feature_index — a queryable projection of the measured
 * facts in each property_cache row's raw_data JSONB, powering "reverse
 * engineering" criteria search (flat land / pipes on-parcel / splits into N
 * lots / return over X%) without scanning JSONB on every query.
 *
 * One row per property_cache row, keyed by address_key. property_cache stays the
 * source of truth; deriveFeatureRow() (lib/property-feature-index.ts) fills these
 * columns and refreshes them wherever the cache is written. Backfill existing
 * rows with `pnpm --filter @workspace/api-server backfill-feature-index`.
 *
 * Idempotent — safe to run multiple times.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findWorkspaceRoot(startDir) {
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

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS property_feature_index (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      address_key text NOT NULL,
      canonical_parcel_id text,
      suburb text,
      formatted_address text,
      lat double precision,
      lng double precision,
      region text,
      aup_covered boolean NOT NULL DEFAULT false,
      slope_degrees double precision,
      contour_class text,
      storm_on_parcel boolean NOT NULL DEFAULT false,
      sewer_on_parcel boolean NOT NULL DEFAULT false,
      water_on_parcel boolean NOT NULL DEFAULT false,
      all_services_on_parcel boolean NOT NULL DEFAULT false,
      max_infra_risk text,
      land_area_sqm double precision,
      zone_code text,
      potential_lots integer,
      standard_vacant_lots integer,
      min_lot_size_sqm double precision,
      cv_nzd bigint,
      estate_type text,
      score_composite double precision,
      score_roi double precision,
      roi_percent_best double precision,
      scoring_version integer,
      pipeline_version integer,
      last_refreshed_at timestamptz,
      indexed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS property_feature_index_address_key_unique
    ON property_feature_index (address_key)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS property_feature_index_parcel_idx
    ON property_feature_index (canonical_parcel_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS property_feature_index_suburb_lots_idx
    ON property_feature_index (suburb, potential_lots)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS property_feature_index_suburb_slope_idx
    ON property_feature_index (suburb, slope_degrees)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS property_feature_index_suburb_score_idx
    ON property_feature_index (suburb, score_composite)
  `);
  // Partial index for the "all services on the parcel" query shape.
  await client.query(`
    CREATE INDEX IF NOT EXISTS property_feature_index_all_services_idx
    ON property_feature_index (suburb)
    WHERE all_services_on_parcel
  `);

  console.log("property_feature_index ensured");
} finally {
  await client.end();
}
