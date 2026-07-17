/**
 * Migration: AI subdivision interest tracking.
 *
 * Stores every authenticated AI subdivision funnel tap and completion so admin
 * can view per-user, global, and general-free conversion metrics.
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

for (const envPath of [
  path.join(workspaceRoot, ".env"),
  path.join(dbPackageRoot, ".env"),
]) {
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });
}
for (const envPath of [
  path.join(workspaceRoot, ".env.local"),
  path.join(dbPackageRoot, ".env.local"),
]) {
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
    CREATE TABLE IF NOT EXISTS ai_subdivision_interest_events (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      search_id text,
      property_address text,
      funnel_version integer NOT NULL DEFAULT 0,
      audience_segment text,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    ALTER TABLE ai_subdivision_interest_events
      ADD COLUMN IF NOT EXISTS funnel_version integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS audience_segment text,
      ADD COLUMN IF NOT EXISTS completed_at timestamptz
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_subdivision_interest_user_time
    ON ai_subdivision_interest_events (user_id, created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_subdivision_interest_created_at
    ON ai_subdivision_interest_events (created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_ai_subdivision_interest_funnel_completion
    ON ai_subdivision_interest_events (funnel_version, completed_at)
  `);

  console.log("ai_subdivision_interest_events table ensured");
} finally {
  await client.end();
}
