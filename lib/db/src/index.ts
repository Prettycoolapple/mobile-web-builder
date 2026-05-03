import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

const databaseUrl = process.env.DATABASE_URL;

// Supabase, and most hosted Postgres providers, require TLS. When we see a
// hosted URL (or the explicit PGSSL=true flag) we enable SSL and disable
// strict CA validation because Supabase's pooled certs can fail Node's
// default chain checks.
function shouldUseSsl(url: string): boolean {
  if (process.env.PGSSL === "true") return true;
  if (process.env.PGSSL === "false") return false;
  if (/sslmode=require/i.test(url)) return true;
  return /supabase\.(co|com)/i.test(url) || /\.neon\.tech/i.test(url);
}

const sslOption = shouldUseSsl(databaseUrl)
  ? { rejectUnauthorized: false }
  : undefined;

// Keep the pool small by default because serverless runtimes (Vercel) spawn
// one pool per invocation and a Supabase transaction pooler tolerates many
// short-lived callers with low `max`.
const maxConnections = Number(process.env.PGPOOL_MAX ?? "5");

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: sslOption,
  max: Number.isFinite(maxConnections) && maxConnections > 0 ? maxConnections : 5,
  // Recycle idle sockets before Supavisor (Supabase pooler) does. Supavisor
  // will sometimes return FATAL 28P01 when we reconnect on a socket it has
  // already torn down; closing ours first avoids the race.
  idleTimeoutMillis: 10_000,
  keepAlive: true,
  allowExitOnIdle: false,
});

// Swallow background connection errors. Without this listener a stray idle
// socket failure (ECONNRESET, 57P01, 28P01 on reconnect) bubbles up as an
// unhandled 'error' event and crashes the process.
pool.on("error", (err) => {
  const code = (err as NodeJS.ErrnoException).code;
  // eslint-disable-next-line no-console
  console.warn(`[db] background pool error (${code ?? "unknown"}): ${err.message}`);
});

export const db = drizzle(pool, { schema });

// Transient error codes worth a single retry. These are emitted by Supavisor
// on stale-connection reconnects, not by real credential/permission problems.
const TRANSIENT_DB_ERROR_CODES = new Set([
  "28P01", // invalid_password — Supavisor blip on stale session
  "08006", // connection_failure
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08004", // sqlserver_rejected_establishment_of_sqlconnection
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "ECONNRESET",
  "ETIMEDOUT",
]);

function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return typeof code === "string" && TRANSIENT_DB_ERROR_CODES.has(code);
}

export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isTransientDbError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw lastErr;
}

export * from "./schema";
