/**
 * Land title / tenure strings for UI: LINZ often returns "Fee Simple", which is
 * legalese for ordinary freehold — users expect plain "Freehold" only.
 */
export function formatTitleTypeForDisplay(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  if (/\bcross\s*lease\b/i.test(s)) return s;
  if (/\bstratum\b/i.test(s)) return s;
  if (/\bunit\s+title\b/i.test(s)) return s;

  if (/\bfee\s*simple\b/i.test(s) || /\bfreehold\b/i.test(s)) {
    return "Freehold";
  }
  return s;
}
