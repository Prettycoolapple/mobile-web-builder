/**
 * Vercel serverless handler. Loads the pre-bundled Express app from `./vercel-app.mjs`
 * (produced by `pnpm --filter @workspace/api-server run build`) so Vercel’s TypeScript
 * step never typechecks `artifacts/api-server/src/**` with incompatible compiler settings.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { default: app } = await import("./vercel-app.mjs");
  (app as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
