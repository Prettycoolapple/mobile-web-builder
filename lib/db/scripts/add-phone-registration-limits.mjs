/**
 * Migration: phone registration history and active phone+role uniqueness.
 *
 * Idempotent, except it intentionally stops before creating the unique index
 * when existing active duplicate (phone_number, role) rows need manual cleanup.
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
    CREATE TABLE IF NOT EXISTS phone_registration_history (
      phone_number text PRIMARY KEY,
      deleted_account_count integer NOT NULL DEFAULT 0,
      blocked_until timestamptz,
      permanently_banned boolean NOT NULL DEFAULT false,
      last_deleted_at timestamptz,
      last_deleted_role text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const duplicates = await client.query(`
    SELECT phone_number, role, array_agg(id ORDER BY created_at) AS user_ids, count(*)::int AS count
    FROM profiles
    WHERE phone_number IS NOT NULL AND btrim(phone_number) <> ''
    GROUP BY phone_number, role
    HAVING count(*) > 1
    ORDER BY phone_number, role
  `);

  if (duplicates.rows.length > 0) {
    console.error("Cannot create unique phone+role index until duplicate active accounts are cleaned up:");
    for (const row of duplicates.rows) {
      console.error(JSON.stringify(row));
    }
    process.exit(1);
  }

  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_role_unique
    ON profiles (phone_number, role)
    WHERE phone_number IS NOT NULL AND btrim(phone_number) <> ''
  `);

  console.log("phone registration limits ensured");
} finally {
  await client.end();
}
