/**
 * Vercel serverless handler. Loads the pre-bundled Express app from `./vercel-app.mjs`
 * (from `pnpm --filter @workspace/api-server run build`). Types for the bundle are in
 * `vercel-app.d.mts` so `tsc` never follows source maps into `artifacts/api-server/src/**`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  runtime: "nodejs",
};

let appPromise: Promise<(req: IncomingMessage, res: ServerResponse) => void> | null = null;

async function loadApp(): Promise<(req: IncomingMessage, res: ServerResponse) => void> {
  if (!appPromise) {
    appPromise = import("./vercel-app.mjs")
      .then((mod) => mod.default as (req: IncomingMessage, res: ServerResponse) => void)
      .catch((error) => {
        appPromise = null;
        throw error;
      });
  }
  return appPromise;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sendBootstrapError(res: ServerResponse, error: unknown): void {
  if (res.headersSent) return;
  res.statusCode = 500;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({
    status: "error",
    error: "API bootstrap failed",
    message: describeError(error),
  }));
}

function maybeHandleHealthCheck(req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url ?? "").split("?")[0]?.replace(/\/+$/, "") || "";
  if (req.method !== "GET" || !["/api/healthz", "/healthz"].includes(path)) return false;

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ status: "ok" }));
  return true;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (maybeHandleHealthCheck(req, res)) return;

  try {
    const app = await loadApp();
    app(req, res);
  } catch (error) {
    console.error("[api] bootstrap failed", error);
    sendBootstrapError(res, error);
  }
}
