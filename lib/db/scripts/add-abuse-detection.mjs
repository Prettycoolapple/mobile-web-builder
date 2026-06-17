/**
 * Migration: abuse / harvest-pattern detection (Layer 2).
 *
 * Adds the abuse_events log and the abuse flag columns on profiles. The flag is
 * informational until Layer 3 reads it; this migration is safe to run on its
 * own. Idempotent - safe to run multiple times.
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
    CREATE TABLE IF NOT EXISTS abuse_events (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text,
      ip_hash text,
      kind text NOT NULL,
      weight real NOT NULL DEFAULT 0,
      detail text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS abuse_events_user_created_idx
    ON abuse_events (user_id, created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS abuse_events_ip_created_idx
    ON abuse_events (ip_hash, created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS abuse_events_kind_created_idx
    ON abuse_events (kind, created_at)
  `);

  await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS abuse_flag boolean NOT NULL DEFAULT false`);
  await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS abuse_flag_reason text`);
  await client.query(`ALTER TABLE profiles ADD COLUMN IF NOT EXISTS abuse_flagged_at timestamptz`);

  console.log("abuse_events table + profiles abuse flag columns ensured");
} finally {
  await client.end();
}
