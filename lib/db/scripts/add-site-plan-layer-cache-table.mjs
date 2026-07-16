/**
 * Migration: durable cache for site-plan GIS layers.
 *
 * Adds the site_plan_layer_cache table so the Plan-tab's council planning
 * overlay / three-waters service / contour queries (currently re-fetched from
 * external ArcGIS servers on every request with no caching) can be served from
 * a long-TTL cache keyed by parcel/location + jurisdiction.
 *
 * Idempotent - safe to run multiple times.
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
    CREATE TABLE IF NOT EXISTS site_plan_layer_cache (
      cache_key text PRIMARY KEY,
      layers jsonb NOT NULL,
      refreshed_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS site_plan_layer_cache_expires_at_idx
    ON site_plan_layer_cache (expires_at)
  `);

  console.log("site_plan_layer_cache table ensured");
} finally {
  await client.end();
}
