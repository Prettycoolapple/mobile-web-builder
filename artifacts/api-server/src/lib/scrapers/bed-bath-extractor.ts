/**
 * Pull bed/bath counts from a listing card's flat text. Handles common forms:
 *   "3 Beds", "6+ Beds", "2 Bath", "3 br/2 ba", "3-Bedroom 2-Bathroom",
 *   "4 bedroom, 2.5 bathroom" (decimals truncated for display),
 *   "Bedrooms: 3", "Bathrooms: 2", "Bathrooms 2" (label then count).
 *
 * Bathroom extraction prefers **label-first** matches (`Bathrooms: 2`,
 * `Baths 5`, `Bathroom 2`) before **number-first** (`2 baths`). That avoids
 * stealing the bedroom digit from strings like "Bedrooms 3 Bathrooms 2"
 * (where a naive `(\d+)\s+Bathrooms` would capture **3** as baths).
 *
 * Number-first bath is rejected when the count is immediately followed by
 * **living** + area/space wording ("3 Living areas") so living counts never
 * map to bathrooms.
 *
 * Lives in its own module so it can be imported by the vitest suite at
 * `__tests__/bed-bath-extractor.test.ts` without dragging in the
 * Playwright/cheerio dependency chain that the rest of `oneroof.ts` carries.
 */

function clampCount(n: number): number | null {
  if (!Number.isFinite(n) || n <= 0 || n >= 20) return null;
  return Math.floor(n);
}

export function extractBedsBaths(text: string): { bedrooms: number | null; bathrooms: number | null } {
  const norm = text.replace(/\s+/g, " ").trim();

  let bedrooms: number | null = null;
  let bathrooms: number | null = null;

  // ── Bathrooms (label-first wins; never "3 Living areas" as baths) ─────────
  let m = norm.match(/\bbath(?:room)?s?\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (m) bathrooms = clampCount(parseFloat(m[1]));

  if (bathrooms == null) {
    m = norm.match(/\bbaths?\s+(\d+(?:\.\d+)?)\b/i);
    if (m) bathrooms = clampCount(parseFloat(m[1]));
  }
  if (bathrooms == null) {
    m = norm.match(/\bbath(?:room)?s?\s+(\d+(?:\.\d+)?)\b/i);
    if (m) bathrooms = clampCount(parseFloat(m[1]));
  }
  // Abbreviated "2 ba" (must be standalone token, not a prefix of "back", "bay", …)
  if (bathrooms == null) {
    m = norm.match(/(\d+(?:\.\d+)?)\s+\bba\b(?![a-z])/i);
    if (m) bathrooms = clampCount(parseFloat(m[1]));
  }
  if (bathrooms == null) {
    m = norm.match(
      /(\d+(?:\.\d+)?)\s*[-\s]*(?!\s*living\s+(?:area|areas|space|spaces|rms?|room|rooms)\b)bath(?:room)?s?\b/i,
    );
    if (m) bathrooms = clampCount(parseFloat(m[1]));
  }

  // ── Bedrooms ─────────────────────────────────────────────────────────────
  m = norm.match(/\bbed(?:room)?s?\s*[:=]\s*(\d+(?:\.\d+)?)/i);
  if (m) bedrooms = clampCount(parseFloat(m[1]));

  if (bedrooms == null) {
    m = norm.match(/(\d+)(?:\.\d+)?\s*[-\s]?\s*(?:bed(?:room)?s?|br|bd)\b/i);
    if (m) bedrooms = clampCount(parseFloat(m[1]));
  }
  if (bedrooms == null) {
    m = norm.match(/(\d+)(?:\s*\+\s*|\s+)(?:bed(?:room)?s?|br|bd)\b/i);
    if (m) bedrooms = clampCount(parseFloat(m[1]));
  }
  if (bedrooms == null) {
    m = norm.match(/\bbed(?:room)?s?\s+(\d+(?:\.\d+)?)\b/i);
    if (m) bedrooms = clampCount(parseFloat(m[1]));
  }
  if (bedrooms == null) {
    m = norm.match(/\bbeds?\s+(\d+(?:\.\d+)?)\b/i);
    if (m) bedrooms = clampCount(parseFloat(m[1]));
  }

  return { bedrooms, bathrooms };
}
