/**
 * One-time cleanup: wipe the discovery cache tables for a clean start.
 *
 * Clears ONLY derived/cached discovery state:
 *   - discovery_shown_listings            (account 30-day "already shown" memory)
 *   - anonymous_discovery_shown_listings  (guest equivalent)
 *   - discovery_continuations             (Show-more pagination + cross-lease
 *                                          exclusions + nearby-train state)
 *
 * Does NOT touch property_cache (expensive LINZ/council data), messages,
 * searches, reports, or any user-authored content. Everything wiped here is
 * regenerated on the next search.
 *
 * Safe to run multiple times. Skips tables that don't exist.
 *
 *   node lib/db/scripts/wipe-discovery-caches.mjs
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

const TABLES = [
  "discovery_shown_listings",
  "anonymous_discovery_shown_listings",
  "discovery_continuations",
];

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  for (const table of TABLES) {
    const { rows } = await client.query("SELECT to_regclass($1) AS reg", [`public.${table}`]);
    if (!rows[0]?.reg) {
      console.log(`skip   ${table} (does not exist)`);
      continue;
    }
    await client.query(`TRUNCATE TABLE ${table}`);
    console.log(`wiped  ${table}`);
  }
  console.log("Discovery caches cleared.");
} finally {
  await client.end();
}
