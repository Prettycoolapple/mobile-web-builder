/**
 * Land title / tenure strings for UI: LINZ often returns "Fee Simple", which is
 * legalese for ordinary freehold — users expect plain "Freehold" only.
 *
 * SECURITY/CORRECTNESS: this is the single chokepoint that produces the title
 * badge shown on the property card. It MUST reject anything that is not a real
 * NZ land-tenure token. A scraper occasionally captures page navigation/menu
 * chrome (e.g. "realestate.co.nz residential mobile nav Search: Residential
 * Rural Business … For sellers") into the tenure field; left unchecked it was
 * translated to Chinese and rendered as a yellow "non-freehold" badge. The
 * whitelist below guarantees that can never happen regardless of upstream data:
 * if the string does not contain a recognised tenure token, we return null and
 * no badge renders.
 */

// Every real NZ residential tenure contains one of these tokens — even the
// zh-localised display form keeps the English word in parentheses, e.g.
// "永久产权 (Freehold)". Anything without a token is not a tenure.
const TENURE_TOKEN =
  /\b(free\s*hold|fee\s*simple|cross\s*lease|lease\s*hold|leasehold|stratum|strata|unit\s+title|unit\s+plan|licen[cs]e\s+to\s+occupy|company\s+(?:lease|share))\b/i;

/**
 * Source-level guard for the `estate_type` field. Unlike formatTitleTypeForDisplay
 * this PRESERVES the raw tenure wording (e.g. keeps "Fee Simple" rather than
 * normalising to "Freehold") so downstream scoring/risk regexes stay accurate —
 * it only strips values that are not a tenure at all (scraped nav/menu text).
 * Returns null when the input is not a recognisable NZ tenure.
 */
export function sanitizeTenureField(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 60) return null;
  if (/https?:\/\/|www\.|\.co\.nz|\.com\b|搜索|导航|面向卖家/i.test(s)) return null;
  if (!TENURE_TOKEN.test(s)) return null;
  return s;
}

export function formatTitleTypeForDisplay(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  // ── Garbage guard ──────────────────────────────────────────────────────────
  // A genuine tenure string is short and free of web/nav chrome. Reject scraped
  // page navigation before doing anything else.
  if (s.length > 60) return null;
  if (/https?:\/\/|www\.|\.co\.nz|\.com\b|搜索|导航|面向卖家/i.test(s)) return null;
  // Must look like a tenure at all, otherwise it is not safe to display.
  if (!TENURE_TOKEN.test(s)) return null;

  // ── Normalise recognised tenures (specific first) ──────────────────────────
  if (/\bcross\s*lease\b/i.test(s)) return s;
  if (/\bstratum\b/i.test(s)) return s;
  if (/\bunit\s+title\b/i.test(s)) return s;

  if (/\bfee\s*simple\b/i.test(s) || /\bfree\s*hold\b/i.test(s)) {
    return "Freehold";
  }
  return s;
}
