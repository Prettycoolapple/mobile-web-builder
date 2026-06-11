/**
 * Migration: require REA licence number for paid sales-agent signup.
 *
 * Adds pending_agent_signups.reaa_licence_number so the value collected before
 * Stripe Checkout survives the redirect and can be written into
 * sales_agent_profiles once payment succeeds.
 *
 * Idempotent - safe to run multiple times.
 *
 * Usage (from repo root):
 *   node lib/db/scripts/add-pending-agent-rea-licence.mjs
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
  await client.query(`ALTER TABLE pending_agent_signups ADD COLUMN IF NOT EXISTS reaa_licence_number text`);
  await client.query(`
    UPDATE pending_agent_signups
    SET reaa_licence_number = 'LEGACY_PENDING_SIGNUP'
    WHERE reaa_licence_number IS NULL
  `);
  await client.query(`ALTER TABLE pending_agent_signups ALTER COLUMN reaa_licence_number SET NOT NULL`);
  console.log("pending_agent_signups.reaa_licence_number ensured");
} finally {
  await client.end();
}
