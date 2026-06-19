/**
 * Migration: background screening jobs.
 *
 * Stores queued generic/subdivision screening requests so mobile users can
 * switch apps or lock the device while the backend completes the work.
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
    CREATE TABLE IF NOT EXISTS screening_jobs (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      status text NOT NULL DEFAULT 'pending',
      mode text NOT NULL DEFAULT 'unknown',
      query_text text NOT NULL,
      locale text NOT NULL DEFAULT 'en',
      conversation_history jsonb,
      request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      result_json jsonb,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS screening_jobs_user_status_created_idx
    ON screening_jobs (user_id, status, created_at)
  `);

  console.log("screening_jobs ensured");
} finally {
  await client.end();
}
