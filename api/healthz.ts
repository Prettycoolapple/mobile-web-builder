/**
 * Health check with zero dependencies — no Express, no DATABASE_URL import.
 * Uses the Web fetch handler shape required by current Vercel Node runtimes.
 */
export default {
  fetch(): Response {
    return Response.json({ status: "ok" });
  },
};
