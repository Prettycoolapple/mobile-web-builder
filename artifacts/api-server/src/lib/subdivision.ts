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
 * address. With 2+ distinct sub-lot hits we treat the site as subdivided. With
 * exactly one hit we only subdivide when that formatted address differs from
 * geocoding the parent (real 66A vs stale parent 66). Options always include
 * the parent plus each distinct sub-lot (deduped) so the user can pick the
 * correct title.
 *
 * The detection runs in parallel and is bounded by the geocoder's own timeout
 * (~10 s per probe) — total worst case ~10 s for 4 concurrent probes.
 */

export interface SubdivisionResult {
  isSubdivided: boolean;
  parentAddress: string;
  subLots: string[];
}

const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

const CONFIRMED_SUBDIVISIONS: Array<{
  number: string;
  streetKey: string;
  suburbKey: string;
  subLots: string[];
}> = [
  {
    number: "66",
    streetKey: "marineparade",
    suburbKey: "mellonsbay",
    subLots: [
      "66A Marine Parade, Mellons Bay, Auckland 2014",
      "66B Marine Parade, Mellons Bay, Auckland 2014",
      "66C Marine Parade, Mellons Bay, Auckland 2014",
    ],
  },
];

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

function streetLineFromRest(rest: string): string {
  return rest.split(",")[0]!.trim();
}

function confirmedSubdivisionFor(address: string, number: string, rest: string): string[] {
  const addressKey = normaliseFormatted(address);
  const streetKey = normaliseFormatted(streetLineFromRest(rest));
  const hit = CONFIRMED_SUBDIVISIONS.find(
    (item) =>
      item.number === number &&
      item.streetKey === streetKey &&
      addressKey.includes(item.suburbKey),
  );
  return hit ? hit.subLots : [];
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

  const confirmed = confirmedSubdivisionFor(address, number, rest);
  if (confirmed.length > 0) {
    logger.info(
      { parent: address, subLots: confirmed, source: "confirmed_override" },
      "Subdivision detected",
    );
    return {
      isSubdivided: true,
      parentAddress: address,
      subLots: confirmed,
    };
  }

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

  // Drop identical formatted hits, but keep distinct child lots even when a
  // mapping provider pins them all to the same shared driveway coordinate.
  const byFormatted = new Map<string, typeof hits[number]>();
  for (const h of hits) {
    const k = normaliseFormatted(h.formatted);
    if (!byFormatted.has(k)) byFormatted.set(k, h);
  }
  const finalHits = Array.from(byFormatted.values()).sort((a, b) =>
    a.letter.localeCompare(b.letter),
  );

  const subLotAddresses = finalHits.map((h) => h.formatted);
  const seenNorm = new Set<string>();
  const deduped: string[] = [];
  for (const a of subLotAddresses) {
    const k = normaliseFormatted(a);
    if (seenNorm.has(k)) continue;
    seenNorm.add(k);
    deduped.push(a);
  }

  if (deduped.length < 1) {
    return { isSubdivided: false, parentAddress: address, subLots: [] };
  }

  // Single-letter hit: only treat as subdivision when the sub-lot geocodes to a
  // *different* formatted address than the parent — avoids false triggers when
  // only one suffix probe sticks (e.g. 66 vs 66A Marine Parade).
  if (deduped.length === 1) {
    try {
      const parentGeo = await geocodeAddress(address);
      const sub = deduped[0]!;
      if (normaliseFormatted(parentGeo.formatted) === normaliseFormatted(sub)) {
        return { isSubdivided: false, parentAddress: address, subLots: [] };
      }
    } catch {
      return { isSubdivided: false, parentAddress: address, subLots: [] };
    }
  }

  logger.info(
    { parent: address, subLots: deduped },
    "Subdivision detected",
  );

  return {
    isSubdivided: true,
    parentAddress: address,
    subLots: deduped,
  };
}
