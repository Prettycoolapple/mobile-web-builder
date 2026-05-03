// Vercel serverless entry for the API server.
//
// Vercel's Node runtime expects a default export of a request handler:
// `(req, res) => void`. An Express application object is exactly that, so we
// can import the shared app and export it directly.
//
// Notes about Vercel-specific behavior:
// - Socket.IO is NOT started here; long-lived connections do not work on
//   serverless. The mobile client falls back to REST polling (see
//   EXPO_PUBLIC_ENABLE_SOCKETS=false).
// - Playwright-based scraper routes will not work on Vercel out of the box.
//   Host those flows separately or replace them with external APIs.
// - `/api/stripe/webhook` expects a raw body; Vercel passes the raw request
//   to the handler so Express's raw-body middleware in app.ts works as-is.
// - The database pool is small by default (PGPOOL_MAX) because each
//   function instance opens its own pool.

import "../src/lib/loadEnv";
import app from "../src/app";
import type { IncomingMessage, ServerResponse } from "http";

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}

export const config = {
  runtime: "nodejs20.x",
};
