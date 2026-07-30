/**
 * Migration: Rubin subdivision layouts — per-user restore + training corpus.
 *
 * Three tables:
 *   rubin_layouts             append-only, deduped on (site_key, fingerprint);
 *                             every distinct layout ever generated for a site
 *   rubin_layout_generations  one row per generation event, dedup hits included
 *   rubin_user_layouts        each user's current layout per site (overwritten)
 *
 * RLS is disabled across this database and the `anon` role has broad table
 * privileges by default, so every new table is explicitly revoked from it at
 * the end — a layout corpus readable with the public anon key would hand over
 * both the users' work and the training data.
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
    CREATE TABLE IF NOT EXISTS rubin_layouts (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      site_key text NOT NULL,
      geo_key text NOT NULL,
      fingerprint text NOT NULL,
      canonical text NOT NULL,
      layout jsonb NOT NULL,
      parcel_id text,
      address text,
      zone text,
      typology text,
      intensity text,
      solver_version text,
      lot_count integer,
      site_context jsonb,
      created_by text REFERENCES profiles(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // The dedup constraint. The save transaction's ON CONFLICT targets it by
  // column list, so it must exist before any write path runs.
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS rubin_layouts_site_fingerprint_unique
    ON rubin_layouts (site_key, fingerprint)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS rubin_layouts_site_key_idx ON rubin_layouts (site_key)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS rubin_layouts_geo_key_idx ON rubin_layouts (geo_key)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rubin_layout_generations (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      layout_id text NOT NULL REFERENCES rubin_layouts(id) ON DELETE CASCADE,
      user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source text NOT NULL DEFAULT 'embed',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS rubin_layout_generations_layout_idx
    ON rubin_layout_generations (layout_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS rubin_layout_generations_user_time_idx
    ON rubin_layout_generations (user_id, created_at)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS rubin_user_layouts (
      user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      site_key text NOT NULL,
      geo_key text NOT NULL,
      layout_id text NOT NULL REFERENCES rubin_layouts(id) ON DELETE CASCADE,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, site_key)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS rubin_user_layouts_user_geo_idx
    ON rubin_user_layouts (user_id, geo_key)
  `);

  // Must come last, and must be re-run on every invocation: a later
  // GRANT ... ON ALL TABLES would silently re-open these.
  await client.query(`
    REVOKE ALL ON TABLE rubin_layouts, rubin_layout_generations, rubin_user_layouts FROM anon
  `);

  console.log("rubin_layouts, rubin_layout_generations, rubin_user_layouts ensured; anon revoked");
} finally {
  await client.end();
}
