/**
 * Migration: pending_provider_signups table.
 *
 * Stashes provider-portal signup data between Stripe Checkout creation and
 * payment confirmation, mirroring the pattern of pending_agent_signups.
 *
 * Idempotent — safe to run multiple times.
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
    CREATE TABLE IF NOT EXISTS pending_provider_signups (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      password_hash text NOT NULL,
      full_name text NOT NULL,
      phone_number text NOT NULL,
      phone_vid text NOT NULL,
      primary_language text NOT NULL,
      company_name text NOT NULL,
      nz_company_register_number text NOT NULL,
      discipline text NOT NULL,
      other_discipline text,
      secondary_language text,
      address_street text,
      address_suburb text,
      address_city text,
      address_postcode text,
      avatar_url text,
      stripe_customer_id text,
      stripe_checkout_session_id text,
      status text NOT NULL DEFAULT 'pending',
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS pending_provider_signups_checkout_session_idx
    ON pending_provider_signups (stripe_checkout_session_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS pending_provider_signups_email_idx
    ON pending_provider_signups (email)
  `);

  console.log("pending_provider_signups table ensured");
} finally {
  await client.end();
}
