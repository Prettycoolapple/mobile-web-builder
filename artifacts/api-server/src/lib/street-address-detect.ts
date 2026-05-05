/**
 * Heuristics for spotting a numbered NZ street lot in free text (chat intent, routing).
 * Kept Gemini-free so callers and tests do not load `@workspace/integrations-gemini-ai`.
 */

const NUMBERED_STREET_RE =
  /\b\d+[a-zA-Z]?(?:\s*\/\s*\d+[a-zA-Z]?)?\s+\w[\w''-]*(?:\s+\w[\w''-]*){0,4}\s+(?:road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|boulevard|esplanade|quay|highway|motorway|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i;

const UNNUMBERED_STREET_TYPE_RE =
  /\b(?:road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i;

/**
 * True when the text names a numbered street lot (e.g. "66 Marine Parade", "66A Marine Parade",
 * "12B Remuera Road", "2/14 Example Street Road"). Supports optional letter suffix or /flat
 * after the street number — required so "66A marine parade" is not misclassified as a
 * suburb-only / whole-street browse (which would hit `hasUnnumberedStreetLine` and force discover).
 */
export function hasNumberedStreetAddress(message: string): boolean {
  return NUMBERED_STREET_RE.test(message);
}

/** Street type present but no leading street number — describes a road/area, not one postal address. */
export function hasUnnumberedStreetLine(message: string): boolean {
  if (hasNumberedStreetAddress(message)) return false;
  return UNNUMBERED_STREET_TYPE_RE.test(message);
}
