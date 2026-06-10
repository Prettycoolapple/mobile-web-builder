/**
 * Migration: total-views feature.
 *   1. Add listings.real_views (int, default 0) and listings.fake_view_seed (int).
 *   2. Create listing_views table (de-dup of real views) + unique(listing_id, viewer_user_id).
 *   3. Backfill fake_view_seed = random 4..29 for existing rows that lack one.
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage (from repo root):
 *   node lib/db/scripts/add-listing-views.mjs
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
  // 1. Columns on listings
  await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS real_views integer NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS fake_view_seed integer`);
  console.log("✓ listings.real_views and listings.fake_view_seed ensured");

  // 2. listing_views table + unique index
  await client.query(`
    CREATE TABLE IF NOT EXISTS listing_views (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id text NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
      viewer_user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uniq_listing_viewer ON listing_views (listing_id, viewer_user_id)`,
  );
  console.log("✓ listing_views table + uniq_listing_viewer index ensured");

  // 3. Backfill fake_view_seed (4..29 inclusive) for rows that don't have one
  const r = await client.query(
    `UPDATE listings
     SET fake_view_seed = floor(random() * 26)::int + 4
     WHERE fake_view_seed IS NULL
     RETURNING id`,
  );
  console.log(`✓ Backfilled fake_view_seed for ${r.rowCount} existing listing(s)`);
} finally {
  await client.end();
}
