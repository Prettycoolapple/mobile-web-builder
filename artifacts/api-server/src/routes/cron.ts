import { Router, type Request } from "express";
import { runAfterResponse } from "../lib/vercel-wait-until";
import { runWatchlistMonitor } from "../lib/watchlist-monitor";

const router = Router();

function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = req.get("authorization") ?? "";
  if (secret && auth === `Bearer ${secret}`) return true;

  // Vercel Cron may identify scheduled invocations; keep local dev usable when
  // no secret is configured, but prefer CRON_SECRET for production.
  if (!secret && req.get("x-vercel-cron") === "1") return true;
  if (!secret && process.env.NODE_ENV !== "production") return true;
  return false;
}

router.get("/cron/watchlist-monitor", async (req, res) => {
  if (!isCronAuthorized(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (req.query.wait === "1") {
    try {
      const result = await runWatchlistMonitor();
      res.json({ ok: true, ...result });
    } catch (err) {
      req.log.error({ err }, "watchlist monitor cron failed");
      res.status(500).json({ error: "Watchlist monitor failed" });
    }
    return;
  }

  runAfterResponse(
    runWatchlistMonitor().catch((err) => {
      req.log.error({ err }, "watchlist monitor cron failed");
    }),
  );
  res.status(202).json({ ok: true, started: true });
});

export default router;
