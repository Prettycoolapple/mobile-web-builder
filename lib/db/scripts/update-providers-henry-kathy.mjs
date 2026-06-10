/**
 * One-off:
 *   1. Hide Henry Zeng from recommendations by setting role = 'general'
 *   2. Set Kathy Yuan's recommendation_count = 9
 *
 * Usage (from repo root):
 *   node lib/db/scripts/update-providers-henry-kathy.mjs
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
  // 1. Hide Henry Zeng — change role from service_provider → general so he
  //    no longer appears in the recommendations query (which filters role = 'service_provider').
  //    His login and account remain intact.
  const r1 = await client.query(
    `UPDATE profiles
     SET role = 'general'
     WHERE full_name ILIKE $1
       AND role = 'service_provider'
     RETURNING id, full_name, role`,
    ["Henry Zeng"],
  );
  if (r1.rowCount > 0) {
    console.log(`✓ Henry Zeng hidden: role changed to 'general' (${r1.rowCount} row)`);
    console.log("  User IDs:", r1.rows.map((r) => r.id).join(", "));
  } else {
    console.warn("⚠ No service_provider with full_name 'Henry Zeng' found — already hidden or name differs.");
  }

  // 2. Set Kathy Yuan recommendation_count = 9
  const r2 = await client.query(
    `UPDATE service_provider_profiles AS sp
     SET recommendation_count = 9
     FROM profiles AS p
     WHERE sp.user_id = p.id
       AND p.full_name ILIKE $1
     RETURNING p.id, p.full_name, sp.recommendation_count`,
    ["Kathy Yuan"],
  );
  if (r2.rowCount > 0) {
    console.log(`✓ Kathy Yuan recommendation_count set to 9 (${r2.rowCount} row)`);
    console.log("  User IDs:", r2.rows.map((r) => r.id).join(", "));
  } else {
    console.warn("⚠ No service_provider with full_name 'Kathy Yuan' found — check spelling.");
  }
} finally {
  await client.end();
}
