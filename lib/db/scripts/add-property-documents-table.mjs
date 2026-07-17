/**
 * Migration: property-keyed LIM/title document library.
 *
 * Idempotent and safe to run more than once. Run manually before deploying
 * code that writes tagged LIM/title documents.
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
    CREATE TABLE IF NOT EXISTS property_documents (
      id text PRIMARY KEY DEFAULT gen_random_uuid(),
      property_key text NOT NULL,
      property_address text NOT NULL,
      doc_type text NOT NULL CHECK (doc_type IN ('lim_report', 'title', 'combined')),
      object_path text NOT NULL,
      file_url text NOT NULL,
      file_name text,
      file_mime text,
      file_size bigint,
      file_hash text,
      source_agent_user_id text REFERENCES profiles(id) ON DELETE SET NULL,
      source_request_id text REFERENCES lim_title_requests(id) ON DELETE SET NULL,
      source_message_id text REFERENCES dm_messages(id) ON DELETE SET NULL,
      link_method text NOT NULL CHECK (link_method IN ('auto_single_open', 'agent_picker', 'card_upload', 'admin')),
      verification_status text NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'text_match', 'mismatch', 'no_text_layer', 'admin_confirmed', 'rejected')),
      verification_json jsonb,
      issued_at timestamptz,
      reuse_consent_at timestamptz,
      superseded_by_id text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS property_documents_property_hash_unique ON property_documents (property_key, file_hash)`);
  await client.query(`CREATE INDEX IF NOT EXISTS property_documents_property_type_idx ON property_documents (property_key, doc_type)`);
  await client.query(`CREATE INDEX IF NOT EXISTS property_documents_source_request_idx ON property_documents (source_request_id)`);
  console.log("property_documents table ensured");
} finally {
  await client.end();
}
