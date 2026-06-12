/**
 * Migration: discovery continuation cache for fast "Show more".
 *
 * Stores prepared/remaining discovery pages for a short time so mobile can
 * continue a detected search intent without re-running the LLM.
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
    CREATE TABLE IF NOT EXISTS discovery_continuations (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_key text,
      search_presentation text NOT NULL,
      suburb text,
      min_price integer,
      max_price integer,
      cache_key text,
      state jsonb NOT NULL DEFAULT '{}'::jsonb,
      exhausted boolean NOT NULL DEFAULT false,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS discovery_continuations_owner_expires_idx
    ON discovery_continuations (owner_key, expires_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS discovery_continuations_expires_idx
    ON discovery_continuations (expires_at)
  `);

  console.log("discovery_continuations ensured");
} finally {
  await client.end();
}
