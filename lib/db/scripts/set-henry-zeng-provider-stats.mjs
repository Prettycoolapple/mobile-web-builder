/**
 * One-off: set Henry Zeng (service provider) recommendation_count = 324 and is_verified = true.
 *
 * Loads DATABASE_URL like drizzle.config (repo root .env / .env.local).
 *
 * Usage (from repo root):
 *   node lib/db/scripts/set-henry-zeng-provider-stats.mjs
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
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
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
  console.error("DATABASE_URL is not set. Add it to .env.local at the repo root.");
  process.exit(1);
}

const FULL_NAME = "Henry Zeng";

const sqlProfile = `
  UPDATE profiles
  SET is_verified = true
  WHERE full_name = $1
    AND role = 'service_provider'
`;

const sqlRec = `
  UPDATE service_provider_profiles AS sp
  SET recommendation_count = 324
  FROM profiles AS p
  WHERE sp.user_id = p.id
    AND p.full_name = $1
    AND p.role = 'service_provider'
`;

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const r1 = await client.query(sqlProfile, [FULL_NAME]);
  const r2 = await client.query(sqlRec, [FULL_NAME]);
  console.log(`profiles.is_verified: ${r1.rowCount} row(s) updated`);
  console.log(`service_provider_profiles.recommendation_count: ${r2.rowCount} row(s) updated`);
  if (r1.rowCount === 0 && r2.rowCount === 0) {
    console.warn(`No matching service_provider with full_name = '${FULL_NAME}'. Check spelling or use SQL manually.`);
  }
} finally {
  await client.end();
}
