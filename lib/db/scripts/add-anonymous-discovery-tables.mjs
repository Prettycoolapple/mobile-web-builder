/**
 * Migration: guest discovery memory and lightweight analytics.
 *
 * Adds anonymous discovery tables for install-hash based duplicate avoidance,
 * daily guest soft limits, and product analytics without full chat transcript
 * sync.
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
    CREATE TABLE IF NOT EXISTS anonymous_discovery_shown_listings (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      install_hash text NOT NULL,
      address_key text NOT NULL,
      listing_url text,
      address text,
      suburb text,
      shown_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS anonymous_discovery_shown_install_address_unique
    ON anonymous_discovery_shown_listings (install_hash, address_key)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS anonymous_discovery_shown_install_shown_at_idx
    ON anonymous_discovery_shown_listings (install_hash, shown_at)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS anonymous_discovery_events (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      install_hash text NOT NULL,
      ip_hash text,
      mode text NOT NULL,
      suburb text,
      criteria text,
      locale text,
      query text,
      result_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS anonymous_usage_events (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      install_hash text NOT NULL,
      ip_hash text,
      event_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS anonymous_usage_install_created_at_idx
    ON anonymous_usage_events (install_hash, created_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS anonymous_usage_ip_created_at_idx
    ON anonymous_usage_events (ip_hash, created_at)
  `);

  console.log("anonymous discovery tables ensured");
} finally {
  await client.end();
}
