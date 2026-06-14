import { getApiBase } from "@/lib/api";

// On-device free-text translation for listing prose (agent descriptions,
// headlines). UI chrome is handled by the i18n catalog; this only covers
// dynamic, user/scraped text. Results are memoised by exact source string and
// in-flight requests for identical text are de-duplicated, so a screen full of
// cards that share a blurb makes a single network call.

const cache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

// CJK Unified Ideographs (incl. extension A) + compatibility ideographs.
const CJK_RE = /[㐀-鿿豈-﫿]/;

/** True when the text already contains Chinese characters (skip translation). */
export function isProbablyChinese(text: string): boolean {
  return CJK_RE.test(text);
}

function isBadTranslationOutput(source: string, translated: string): boolean {
  const out = translated.trim();
  if (!out) return true;
  if (/无法执行这个请求|请提供需要翻译|不能执行该请求|无法翻译|provide.*english/i.test(out)) return true;
  if (!isProbablyChinese(out) && !isProbablyChinese(source)) return true;
  return false;
}

/** Synchronous cache peek so components can render the translation immediately on re-mount. */
export function getCachedTranslation(text: string): string | undefined {
  return cache.get(text);
}

/**
 * Translate a single string to the user's locale via the backend (which no-ops
 * for non-zh callers and already-Chinese text). Falls back to the original text
 * on any failure so the UI never blanks out.
 */
export async function translateOne(headers: Record<string, string>, text: string): Promise<string> {
  if (!text || !text.trim() || isProbablyChinese(text)) return text;
  const cached = cache.get(text);
  if (cached != null) return cached;
  const pending = inFlight.get(text);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const resp = await fetch(`${getApiBase()}/translate`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [text] }),
      });
      const data = (await resp.json().catch(() => null)) as { translations?: string[] } | null;
      const out = data?.translations?.[0];
      const isValid = typeof out === "string" && !isBadTranslationOutput(text, out);
      const final = isValid ? out.trim() : text;
      if (!isValid) return final;
      cache.set(text, final);
      return final;
    } catch {
      return text;
    } finally {
      inFlight.delete(text);
    }
  })();

  inFlight.set(text, promise);
  return promise;
}
