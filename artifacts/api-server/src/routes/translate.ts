import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth";
import { normaliseLocale } from "../lib/prompts";
import { translateFreeTextBatchToChinese } from "../lib/translation";

const router: IRouter = Router();

const MAX_TEXTS_PER_REQUEST = 40;
const MAX_TEXT_LENGTH = 4000;

/**
 * Translate visible free-text (listing descriptions, headlines) to the caller's
 * OS locale. Used by the mobile listing cards and detail screen so agent-written
 * and scraped prose renders in Chinese for zh-OS users. Deterministic UI chrome
 * (labels, property type, stat units) is handled by the client i18n catalog, not
 * this endpoint. Proper nouns (addresses, suburbs, agency brands) are NOT sent
 * here — only descriptive prose.
 *
 * Non-zh locales and already-Chinese strings are echoed back unchanged at zero
 * LLM cost; results are cached server-side by exact source text.
 */
router.post("/translate", requireAuth, async (req: Request, res: Response) => {
  const { texts } = req.body as { texts?: unknown };
  if (!Array.isArray(texts) || texts.some((t) => typeof t !== "string")) {
    res.status(400).json({ error: "texts must be an array of strings", code: "INVALID_TEXTS" });
    return;
  }

  const input = (texts as string[]).slice(0, MAX_TEXTS_PER_REQUEST).map((t) => t.slice(0, MAX_TEXT_LENGTH));
  const locale = normaliseLocale(req.headers["x-locale"] ?? req.headers["accept-language"]);

  if (locale !== "zh") {
    res.json({ translations: input });
    return;
  }

  try {
    const translations = await translateFreeTextBatchToChinese(input);
    res.json({ translations });
  } catch (err) {
    req.log?.warn({ err }, "POST /translate failed — returning originals");
    res.json({ translations: input });
  }
});

export default router;
