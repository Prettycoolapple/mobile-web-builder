/**
 * Migration: per-user property watchlist.
 *
 * Adds the watchlist_items table: one row per (user, property) for properties a
 * logged-in user has hearted. Stores a denormalised snapshot of display fields
 * plus the full PropertyCandidate JSON so the Watchlist tab renders without a
 * re-fetch and future monitoring can diff prior values.
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
    CREATE TABLE IF NOT EXISTS watchlist_items (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      property_key text NOT NULL,
      address text NOT NULL,
      listing_url text,
      photo_url text,
      price_display text,
      property_type text,
      bedrooms integer,
      bathrooms integer,
      land_area_sqm integer,
      zone text,
      composite_score real,
      snapshot_json jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS watchlist_user_property_unique
    ON watchlist_items (user_id, property_key)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS watchlist_user_created_idx
    ON watchlist_items (user_id, created_at)
  `);

  console.log("watchlist_items table ensured");
} finally {
  await client.end();
}
