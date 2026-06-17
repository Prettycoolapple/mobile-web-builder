/**
 * Migration: durable rate-limit counters.
 *
 * Adds rate_limit_counters: one row per (bucket_key, window_start) used by the
 * API's fixed-window velocity limiter so per-IP / per-account limits hold
 * across serverless invocations (in-memory counters do not survive on Vercel).
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
    CREATE TABLE IF NOT EXISTS rate_limit_counters (
      bucket_key text NOT NULL,
      window_start timestamptz NOT NULL,
      count integer NOT NULL DEFAULT 0,
      expires_at timestamptz NOT NULL,
      PRIMARY KEY (bucket_key, window_start)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_idx
    ON rate_limit_counters (expires_at)
  `);

  console.log("rate_limit_counters table ensured");
} finally {
  await client.end();
}
