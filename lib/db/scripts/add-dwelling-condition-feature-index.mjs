/**
 * Migration: add dwelling-condition projection columns to property_feature_index.
 *
 * Idempotent and safe to run multiple times. Backfill existing rows afterwards
 * with `pnpm --filter @workspace/api-server backfill-feature-index` or by
 * running the derived-score recompute flow that refreshes feature rows.
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
    ALTER TABLE property_feature_index
      ADD COLUMN IF NOT EXISTS dwelling_condition text,
      ADD COLUMN IF NOT EXISTS recent_improvement boolean,
      ADD COLUMN IF NOT EXISTS condition_confidence text,
      ADD COLUMN IF NOT EXISTS condition_cost_penalty double precision
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS property_feature_index_recent_improvement_idx
    ON property_feature_index (suburb, recent_improvement)
  `);

  console.log("dwelling-condition feature-index columns ensured");
} finally {
  await client.end();
}
