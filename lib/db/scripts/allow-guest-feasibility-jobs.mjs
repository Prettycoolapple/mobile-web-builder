/**
 * Migration: allow guest-owned background feasibility jobs.
 *
 * Logged-out visitors could only run analyses synchronously, because
 * feasibility_jobs.user_id was NOT NULL and references profiles. A 3-5 minute
 * report then died with the request whenever the app was backgrounded or the
 * network dropped. Guests now own a job through their hashed install id and
 * read the finished report straight off the job row (they have no `searches`
 * history to save it to).
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
    ALTER TABLE feasibility_jobs
    ALTER COLUMN user_id DROP NOT NULL
  `);

  await client.query(`
    ALTER TABLE feasibility_jobs
      ADD COLUMN IF NOT EXISTS guest_hash text,
      ADD COLUMN IF NOT EXISTS guest_ip_hash text,
      ADD COLUMN IF NOT EXISTS result_json jsonb
  `);

  // A job with neither owner could never be polled back by anyone, and would
  // quietly burn a full pipeline run. Reject it at the table.
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'feasibility_jobs_owner_present'
      ) THEN
        ALTER TABLE feasibility_jobs
          ADD CONSTRAINT feasibility_jobs_owner_present
          CHECK (user_id IS NOT NULL OR guest_hash IS NOT NULL);
      END IF;
    END $$;
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS feasibility_jobs_guest_created_idx
    ON feasibility_jobs (guest_hash, created_at)
  `);

  console.log("feasibility_jobs: user_id nullable, guest ownership + result_json ready");
} finally {
  await client.end();
}
