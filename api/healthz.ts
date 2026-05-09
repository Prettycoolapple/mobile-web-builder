/**
 * Lightweight health check for Vercel — no Express bundle, no DATABASE_URL.
 * Kept separate because vercel.json rewrites `/api/(.*)` → `/api`, which strips
 * the subpath before `api/index.ts` runs, so `/api/healthz` never matched there.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  runtime: "nodejs",
};

export default function handler(_req: IncomingMessage, res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ status: "ok" }));
}
