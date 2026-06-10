/**
 * One-off: fix sales agents whose profile was created with role = 'general'
 * due to a bug in the signup flow.
 *
 * Safe to run multiple times (idempotent).
 *
 * Logic: any profile with role = 'general' that has a row in sales_agent_profiles
 * is actually a sales agent and should have role = 'sales_agent'.
 *
 * Usage (from repo root):
 *   node lib/db/scripts/fix-agent-roles.mjs
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
  // Preview: show affected rows before updating
  const preview = await client.query(`
    SELECT p.id, p.email, p.full_name, p.role
    FROM profiles p
    JOIN sales_agent_profiles sap ON sap.user_id = p.id
    WHERE p.role = 'general'
    ORDER BY p.created_at
  `);

  if (preview.rowCount === 0) {
    console.log("✓ No profiles to fix — all sales agents already have the correct role.");
  } else {
    console.log(`Found ${preview.rowCount} profile(s) with role = 'general' that have a sales_agent_profiles row:`);
    for (const row of preview.rows) {
      console.log(`  • ${row.email} (${row.full_name}) — id: ${row.id}`);
    }

    const result = await client.query(`
      UPDATE profiles
      SET role = 'sales_agent'
      WHERE role = 'general'
        AND id IN (SELECT user_id FROM sales_agent_profiles)
      RETURNING id, email, full_name, role
    `);

    console.log(`\n✓ Updated ${result.rowCount} profile(s) to role = 'sales_agent':`);
    for (const row of result.rows) {
      console.log(`  • ${row.email} (${row.full_name}) — new role: ${row.role}`);
    }
  }
} finally {
  await client.end();
}
