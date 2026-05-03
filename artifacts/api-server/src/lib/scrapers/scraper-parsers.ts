/**
 * Numeric field parsers shared by the OneRoof scraper (and reusable by other
 * listing-source scrapers). Lives in its own dependency-free module — same
 * pattern as `bed-bath-extractor` — so the vitest suite at
 * `__tests__/scraper-parsers.test.ts` can exercise them without dragging in
 * the Playwright/cheerio chain that the rest of `oneroof.ts` carries.
 *
 * Every regex tweak here can silently turn a real listing's "$1.25m" into
 * `null` or pull "4000m²" out of a section that has no dwelling — the test
 * fixtures pin the contract for each shape we've seen in the wild.
 */

/**
 * Parse a NZ dollar amount as it appears on a listing card / og:description.
 * Accepts forms like "1,250,000", "$1.25m", "950k", "  $2.09M ".
 * Returns the integer NZD value or null when the string isn't a usable number.
 */
export function parseNZDollar(text: string): number | null {
  const clean = text.replace(/[,$\s]/g, "");
  const m = clean.match(/([\d.]+)([mk]?)/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (isNaN(v) || v <= 0) return null;
  const suffix = m[2].toLowerCase();
  if (suffix === "m") v *= 1_000_000;
  if (suffix === "k") v *= 1_000;
  return Math.round(v);
}

/**
 * Parse an area in square metres from a fragment like "572m²", "600 m2",
 * "1,250m²". Returns the integer m² value, or null when no usable number is
 * present. Caller is responsible for sanity bounds (the OneRoof code only
 * accepts areas > 10 m² for floor/land fields).
 */
export function parseArea(text: string): number | null {
  const m = text.replace(/,/g, "").match(/([\d.]+)\s*m/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return isNaN(v) || v <= 0 ? null : Math.round(v);
}

/**
 * Parse a 4-digit build year. Bounded to [1800, currentYear+1] so a stray
 * "2099" in a marketing blurb doesn't poison the dataset.
 */
export function parseYear(text: string): number | null {
  const m = text.match(/\b(19|20)\d{2}\b/);
  if (!m) return null;
  const y = parseInt(m[0]);
  return y >= 1800 && y <= new Date().getFullYear() + 1 ? y : null;
}

/**
 * OneRoof / listing pages vary copy ("Year built", "Built in", etc.). Try
 * several patterns and return the first plausible 19xx/20xx year.
 */
export function extractBuildYearFromListingText(text: string): number | null {
  const patterns: RegExp[] = [
    /\bYear\s+built[:\s]+(\d{4})\b/i,
    /\bBuilt\s+in\s+(\d{4})\b/i,
    /\bConstruction\s+(?:year|date)?[:\s]+(\d{4})\b/i,
    /\b(\d{4})\s*[-–]\s*(?:year\s+)?built\b/i,
    /\b[Bb]uilt[:\s]+(\d{4})\b/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) {
      const y = parseYear(m[1]);
      if (y) return y;
    }
  }
  return null;
}
