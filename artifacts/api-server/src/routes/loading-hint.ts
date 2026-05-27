import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth";
import { classifyWideScanSubdivisionIntent, type Message } from "../lib/claude";
import { normaliseLocale } from "../lib/prompts";

const router: IRouter = Router();

/**
 * Lightweight LLM classifier endpoint. The mobile calls this in parallel with
 * the main /analyse (or /chat-analyse) request so the loading bubble can show
 * an honest "this usually takes 1-5 min" subtitle as soon as the user submits
 * an area-wide subdivision sweep.
 *
 * Keeping this separate from extractChatIntent means the user-facing hint
 * shows up in ~1-2 s instead of waiting for the much heavier discovery work
 * (which still runs the full intent extractor server-side for routing).
 */
router.post("/loading-hint/check", requireAuth, async (req: Request, res: Response) => {
  try {
    const { messages } = req.body as { messages?: Message[] };
    const locale = normaliseLocale(req.headers["x-locale"] ?? req.headers["accept-language"]);
    const wide = await classifyWideScanSubdivisionIntent(messages ?? [], locale);
    if (wide) {
      res.json({
        loadingHint: {
          kind: "wide_scan_subdivision",
          etaSecondsMin: 60,
          etaSecondsMax: 300,
        },
      });
      return;
    }
    res.json({ loadingHint: null });
  } catch (err) {
    req.log.error({ err }, "POST /loading-hint/check failed");
    // Failure is benign — mobile will just not show the hint.
    res.json({ loadingHint: null });
  }
});

export default router;
