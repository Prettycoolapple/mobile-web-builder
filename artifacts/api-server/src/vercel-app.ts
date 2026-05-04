/**
 * Minimal entry for Vercel serverless: only the Express app (no HTTP listen, no Socket.IO).
 * Bundled to `dist/vercel-app.mjs` and copied to repo-root `api/vercel-app.mjs` during build.
 */
import "./lib/loadEnv";
import app from "./app";

export default app;
