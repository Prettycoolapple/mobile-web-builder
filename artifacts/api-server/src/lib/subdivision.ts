import { logger } from "./logger";
import { geocodeAddress } from "./geocode";

/**
 * Subdivision detection.
 *
 * When a user types a "parent" street number (e.g. "66 Marine Parade") that has
 * been subdivided into sub-lots ("66A", "66B", "66C"), the data sources we
 * rely on (LINZ, Auckland Council GIS, OneRoof, Hougarden, QV) may still hold
 * stale parent-parcel data — leading to a feasibility report that does not
 * match what is actually on the ground today.
 *
 * This helper probes the geocoder for letter-suffixed variants of the input
 * address. If two or more variants resolve to distinct addresses where the
 * formatted result actually contains the expected letter, we treat the parent
 * as subdivided and return the discovered sub-lots so the caller can ask the
 * user which one they meant.
 *
 * The detection runs in parallel and is bounded by the geocoder's own timeout
 * (~10 s per probe) — total worst case ~10 s for 4 concurrent probes.
 */

export interface SubdivisionResult {
  isSubdivided: boolean;
  parentAddress: string;
  subLots: string[];
}

const LETTERS = ["A", "B", "C", "D"] as const;

/**
 * Returns { number, letter, rest } where `letter` is "" if the address has no
 * unit-letter suffix on the street number. Returns null when no leading
 * number can be parsed.
 */
export function parseStreetNumberSuffix(address: string): {
  number: string;
  letter: string;
  rest: string;
} | null {
  const trimmed = address.trim();
  // Match "<digits><optional-letter> <rest>" — letter is captured separately so
  // we can detect parents (no letter) vs. sub-lots (with letter).
  const m = trimmed.match(/^(\d+)([A-Za-z])?\s+(.+)$/);
  if (!m) return null;
  return {
    number: m[1],
    letter: (m[2] ?? "").toUpperCase(),
    rest: m[3],
  };
}

function normaliseFormatted(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Heuristic: a geocoded result counts as a real sub-lot only when the formatted
 * address contains the queried letter immediately after the street number
 * (e.g. "66a marine parade"). This guards against geocoders that silently
 * normalise "66A" → "66" and return the parent address.
 */
function formattedContainsSubLot(formatted: string, number: string, letter: string): boolean {
  const norm = formatted.toLowerCase();
  // Require a non-digit boundary before the street number so "66a" does not
  // false-match inside "166a". Allow start-of-string or any non-digit prefix.
  const re = new RegExp(`(^|[^0-9])${number}${letter.toLowerCase()}(\\s|,)`);
  return re.test(norm);
}

export async function detectSubdivision(address: string): Promise<SubdivisionResult> {
  const parsed = parseStreetNumberSuffix(address);
  // Only probe when the user typed a parent number (no letter). If they already
  // gave us "66A Marine Parade" trust them and skip the probe.
  if (!parsed || parsed.letter !== "") {
    return { isSubdivided: false, parentAddress: address, subLots: [] };
  }

  const { number, rest } = parsed;

  const probes = await Promise.all(
    LETTERS.map(async (letter) => {
      const candidate = `${number}${letter} ${rest}`;
      try {
        const geo = await geocodeAddress(candidate);
        if (!geo) return null;
        if (!formattedContainsSubLot(geo.formatted, number, letter)) return null;
        return { letter, formatted: geo.formatted, lat: geo.lat, lng: geo.lng };
      } catch {
        return null;
      }
    }),
  );

  const hits = probes.filter((p): p is NonNullable<typeof p> => p !== null);

  // De-duplicate by lat/lng (some geocoders give the same point for adjacent
  // letters when only one real sub-lot exists). Key by coordinates only so
  // that A and B at identical coordinates collapse to one hit.
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    const key = `${h.lat.toFixed(5)}|${h.lng.toFixed(5)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Also drop hits whose formatted address normalises identically (likely the
  // same physical lot returned twice).
  const byFormatted = new Map<string, typeof unique[number]>();
  for (const h of unique) {
    const k = normaliseFormatted(h.formatted);
    if (!byFormatted.has(k)) byFormatted.set(k, h);
  }
  const finalHits = Array.from(byFormatted.values()).sort((a, b) =>
    a.letter.localeCompare(b.letter),
  );

  if (finalHits.length < 2) {
    return { isSubdivided: false, parentAddress: address, subLots: [] };
  }

  logger.info(
    { parent: address, subLots: finalHits.map((h) => `${number}${h.letter}`) },
    "Subdivision detected",
  );

  return {
    isSubdivided: true,
    parentAddress: address,
    subLots: finalHits.map((h) => h.formatted),
  };
}
