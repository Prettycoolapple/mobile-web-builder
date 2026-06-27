/**
 * Migration: server-backed notification items.
 *
 * Adds a per-user ledger for non-DM notifications that contribute to app and
 * page badges. DMs keep using dm_messages.read_at so message counts stay tied
 * to the actual chat rows.
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
    CREATE TABLE IF NOT EXISTS notification_items (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      kind text NOT NULL,
      source_id text NOT NULL,
      page text NOT NULL,
      title text NOT NULL,
      body text,
      metadata_json jsonb,
      read_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS notification_items_user_kind_source_unique
    ON notification_items (user_id, kind, source_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS notification_items_user_page_read_idx
    ON notification_items (user_id, page, read_at, created_at)
  `);

  console.log("notification_items table ensured");
} finally {
  await client.end();
}
