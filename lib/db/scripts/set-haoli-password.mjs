/**
 * One-off: set a known login password on an existing service-provider profile
 * (e.g. the "hao li" account that was inserted directly into the DB and therefore
 * has no usable credential). This lets you log into the provider portal/workspace
 * as that account and read messages real users have sent it.
 *
 * Replicates hashPassword() from artifacts/api-server/src/lib/auth.ts EXACTLY
 * (Node scrypt, 16-byte hex salt, keylen 64, stored as `salt:digest`) so the
 * /auth/service-provider-login verifyPassword() accepts it.
 *
 * Loads DATABASE_URL like drizzle.config (repo root .env / .env.local).
 *
 * Usage (from repo root):
 *   node lib/db/scripts/set-haoli-password.mjs <email> [password]
 *   # or: pnpm --filter @workspace/db run set-haoli-password "<email>" ["password"]
 *
 * If [password] is omitted it defaults to AlphaAdmin2025!.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import dotenv from "dotenv";

const scryptAsync = promisify(scrypt);

// Must match artifacts/api-server/src/lib/auth.ts hashPassword().
async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(password, salt, 64);
  return `${salt}:${buf.toString("hex")}`;
}

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

const emailArg = process.argv[2]?.trim();
const passwordArg = process.argv[3];
const password = (passwordArg && passwordArg.length > 0) ? passwordArg : "AlphaAdmin2025!";

if (!emailArg) {
  console.error("Usage: node lib/db/scripts/set-haoli-password.mjs <email> [password]");
  console.error("  <email>    the email used for the hao li account (required)");
  console.error("  [password] defaults to AlphaAdmin2025!");
  process.exit(1);
}

const email = emailArg.toLowerCase();

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  // 1. Confirm the account exists.
  const profileRes = await client.query(
    `SELECT id, full_name, role FROM profiles WHERE email = $1`,
    [email],
  );
  if (profileRes.rowCount === 0) {
    console.error(`No profile found with email = '${email}'.`);
    console.error("Check the exact email used for the hao li account (it is stored lower-cased).");
    process.exit(1);
  }
  const profile = profileRes.rows[0];

  // 2. Confirm the provider-login role gate will pass:
  //    role = 'service_provider' OR a service_provider_profiles row exists.
  const providerRes = await client.query(
    `SELECT 1 FROM service_provider_profiles WHERE user_id = $1 LIMIT 1`,
    [profile.id],
  );
  const hasProviderRow = providerRes.rowCount > 0;
  const isProviderRole = profile.role === "service_provider";

  if (!isProviderRole && !hasProviderRow) {
    console.error(
      `Account '${email}' (role='${profile.role}') is not a service provider ` +
        `and has no service_provider_profiles row.`,
    );
    console.error(
      "The /auth/service-provider-login route would reject it (403 SERVICE_PROVIDER_REQUIRED). " +
        "Aborting without setting a password.",
    );
    process.exit(1);
  }

  // 3. Set the password hash.
  const passwordHash = await hashPassword(password);
  const updateRes = await client.query(
    `UPDATE profiles SET password_hash = $1 WHERE email = $2
     RETURNING id, full_name, role`,
    [passwordHash, email],
  );
  const updated = updateRes.rows[0];

  console.log("Password set successfully.");
  console.log(`  id:    ${updated.id}`);
  console.log(`  name:  ${updated.full_name}`);
  console.log(`  role:  ${updated.role}${isProviderRole ? "" : " (login allowed via service_provider_profiles row)"}`);
  console.log(`  email: ${email}`);
  console.log(`  password: ${password}`);
  console.log("");
  console.log("Log in at the provider portal/workspace with the email + password above.");
} finally {
  await client.end();
}
