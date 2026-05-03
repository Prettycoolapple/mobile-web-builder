const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { defineConfig } = require("drizzle-kit");

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

const dbPackageRoot = __dirname;
const workspaceRoot = findWorkspaceRoot(dbPackageRoot);

// Load base env first, then *.env.local with override: true so repo files win
// over a stale DATABASE_URL (or other vars) set in the OS / shell — dotenv's
// default is to never override existing process.env keys.
const envBaseFiles = [
  path.join(workspaceRoot, ".env"),
  path.join(dbPackageRoot, ".env"),
];
const envLocalFiles = [
  path.join(workspaceRoot, ".env.local"),
  path.join(dbPackageRoot, ".env.local"),
];

for (const envPath of envBaseFiles) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}
for (const envPath of envLocalFiles) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: true });
  }
}

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error(
    "DATABASE_URL is not set. Add it to the repo root .env.local (Supabase: Project Settings → Database → Connection string), then run pnpm --filter @workspace/db run push again.",
  );
}

// Use forward slashes so drizzle-kit resolves the schema file on Windows.
const schemaPath = path.join(__dirname, "src", "schema", "index.ts").replace(/\\/g, "/");

module.exports = defineConfig({
  schema: schemaPath,
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
