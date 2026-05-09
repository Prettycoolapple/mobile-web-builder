/**
 * Health check with zero dependencies — no Express, no DATABASE_URL import.
 * Uses the Web fetch handler shape required by current Vercel Node runtimes.
 * .mjs so the runtime always parses this file as ESM (root package.json has no "type": "module").
 */
export default {
  fetch() {
    return Response.json({ status: "ok" });
  },
};
