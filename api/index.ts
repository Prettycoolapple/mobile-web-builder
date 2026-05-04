/**
 * Vercel serverless handler. Loads the pre-bundled Express app from `./vercel-app.mjs`
 * (from `pnpm --filter @workspace/api-server run build`). Types for the bundle are in
 * `vercel-app.d.mts` so `tsc` never follows source maps into `artifacts/api-server/src/**`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { default: app } = await import("./vercel-app.mjs");
  app(req, res);
}
