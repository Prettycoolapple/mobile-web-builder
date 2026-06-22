/**
 * Migration: per-provider white-label brand kit for PDF report exports.
 *
 * Adds the provider_brand_kits table: one row per user holding the branding a
 * service provider stamps onto exported feasibility-report PDFs (logo, brand
 * colour, company + contact details). Web-only feature (provider workspace);
 * the mobile app does not touch this table.
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
    CREATE TABLE IF NOT EXISTS provider_brand_kits (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
      logo_url text,
      brand_color text,
      company_name text,
      contact_name text,
      contact_email text,
      contact_phone text,
      website text,
      licence_number text,
      footer_text text,
      extra_image_urls text[] NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  console.log("provider_brand_kits table ensured");
} finally {
  await client.end();
}
