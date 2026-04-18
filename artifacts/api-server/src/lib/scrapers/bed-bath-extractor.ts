/**
 * Pull bed/bath counts from a listing card's flat text. Handles common forms:
 *   "3 Beds", "2 Bath", "3 br/2 ba", "3-Bedroom 2-Bathroom",
 *   "4 bedroom, 2.5 bathroom" (decimals truncated for display),
 *   "Bedrooms: 3" label form.
 *
 * The number-then-label patterns allow an optional hyphen between the digit and
 * the label (common in marketing copy: "4-bedroom"). The label-then-number
 * fallback requires an explicit `:` or `=` separator so that a sequence like
 * "Bedroom 2-Bathroom" doesn't pull the "2" from the bathroom token into the
 * bedroom count.
 *
 * Lives in its own module so it can be imported by the standalone verification
 * suite at `__tests__/extractBedsBaths.test.ts` without dragging in the
 * Playwright/cheerio dependency chain that the rest of `oneroof.ts` carries.
 */
export function extractBedsBaths(text: string): { bedrooms: number | null; bathrooms: number | null } {
  const bedM =
    text.match(/(\d+)(?:\.\d+)?\s*[-\s]?\s*(?:bed(?:room)?s?|br|bd)\b/i) ??
    text.match(/\bbed(?:room)?s?\s*[:=]\s*(\d+)/i);
  const bathM =
    text.match(/(\d+)(?:\.\d+)?\s*[-\s]?\s*(?:bath(?:room)?s?|ba)\b/i) ??
    text.match(/\bbath(?:room)?s?\s*[:=]\s*(\d+)/i);
  const beds = bedM ? parseInt(bedM[1], 10) : null;
  const baths = bathM ? parseInt(bathM[1], 10) : null;
  return {
    bedrooms: beds && beds > 0 && beds < 20 ? beds : null,
    bathrooms: baths && baths > 0 && baths < 20 ? baths : null,
  };
}
