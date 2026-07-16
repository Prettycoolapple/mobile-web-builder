/**
 * Migration: LIM/title re-request + admin "new lead" tracking.
 *
 * Adds three columns to lim_title_requests:
 *  - last_requested_at: bumped on the initial consent and on every allowed
 *    re-request (after the cooldown window) — backfilled from consented_at /
 *    created_at for existing rows.
 *  - request_count: how many times the buyer has (re)requested this.
 *  - admin_viewed_at: when an admin last viewed the LIM/title leads list —
 *    drives the sidebar badge / red-dot "new" indicator.
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
    ALTER TABLE lim_title_requests
      ADD COLUMN IF NOT EXISTS last_requested_at timestamptz,
      ADD COLUMN IF NOT EXISTS request_count integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS admin_viewed_at timestamptz
  `);
  await client.query(`
    UPDATE lim_title_requests
    SET last_requested_at = COALESCE(consented_at, offer_shown_at, created_at)
    WHERE last_requested_at IS NULL
  `);
  await client.query(`
    ALTER TABLE lim_title_requests
      ALTER COLUMN last_requested_at SET NOT NULL,
      ALTER COLUMN last_requested_at SET DEFAULT now()
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS lim_title_requests_last_requested_idx
    ON lim_title_requests (last_requested_at)
  `);

  console.log("lim_title_requests tracking columns ensured");
} finally {
  await client.end();
}
