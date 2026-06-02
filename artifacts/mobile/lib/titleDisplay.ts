// Every real NZ residential tenure contains one of these tokens — even the
// zh-localised display form keeps the English word in parentheses, e.g.
// "永久产权 (Freehold)". Anything without a token is not a tenure and must not
// render as a title badge (last line of defence against scraped page-nav text
// leaking into the tenure field, incl. cached/legacy reports re-rendered here).
const TENURE_TOKEN =
  /\b(free\s*hold|fee\s*simple|cross\s*lease|lease\s*hold|leasehold|stratum|strata|unit\s+title|unit\s+plan|licen[cs]e\s+to\s+occupy|company\s+(?:lease|share))\b/i;

/** Mirrors api-server: plain "Freehold" instead of legalese "Fee Simple" for users. */
export function formatTitleTypeForDisplay(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // ── Garbage guard ──────────────────────────────────────────────────────────
  // Reject scraped navigation/menu chrome (which may already be translated to
  // Chinese, e.g. ".co.nz 住宅移动导航 搜索：住宅 乡村 商业 面向卖家") before any
  // passthrough. A real tenure is short, free of web chrome, and ALWAYS carries
  // an English tenure token — even when localised.
  if (s.length > 60) return null;
  if (/https?:\/\/|www\.|\.co\.nz|\.com\b|搜索|导航|面向卖家/i.test(s)) return null;
  if (!TENURE_TOKEN.test(s)) return null;

  // Already-localised strings (e.g. "永久产权 (Freehold)") pass through unchanged
  // — they passed the token gate above, so the CJK is a real localised tenure.
  if (/[㐀-鿿]/.test(s)) return s;

  if (/\bcross\s*lease\b/i.test(s)) return s;
  if (/\bstratum\b/i.test(s)) return s;
  if (/\bunit\s+title\b/i.test(s)) return s;

  if (/\bfee\s*simple\b/i.test(s) || /\bfreehold\b/i.test(s)) {
    return "Freehold";
  }
  return s;
}

/**
 * Defence-in-depth Chinese mapping for NZ land-title statuses. The backend
 * normally localises titleType before sending the report (see api-server
 * translation.ts `localiseTitleTypeForZh`), but cached/legacy reports may
 * arrive with English. Call this on the mobile when the active locale is "zh".
 *
 * Returns null for unknown variants so the caller falls back to the original
 * display string.
 */
export function localiseTitleTypeZh(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  // Already localised — leave alone.
  if (/[㐀-鿿]/.test(s)) return s;
  // Priority order: more-specific tenures first so compound phrases like
  // "Stratum in Freehold" pick up the specific tenure (Stratum) rather than
  // the generic Freehold catch-all.
  if (/\bstratum\b/i.test(s)) return "层级产权 (Stratum)";
  if (/\bcross\s*lease\b/i.test(s)) return "交叉租赁产权 (Cross Lease)";
  if (/\bunit\s+title\b/i.test(s)) return "单元产权 (Unit Title)";
  if (/\bleasehold\b/i.test(s)) return "租赁产权 (Leasehold)";
  if (/\bfee\s*simple\b/i.test(s) || /\bfreehold\b/i.test(s)) return "永久产权 (Freehold)";
  return null;
}
