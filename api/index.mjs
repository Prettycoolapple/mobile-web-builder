/**
 * Vercel serves the bundled Express app from `./vercel-app.mjs`
 * (built by `pnpm --filter @workspace/api-server run build`).
 *
 * Use `export default app` (Express) — not a custom IncomingMessage handler —
 * so Vercel's Node adapter can wire Request/Response correctly.
 */
import app from "./vercel-app.mjs";

export default app;
