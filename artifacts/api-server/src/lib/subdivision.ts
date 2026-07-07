import { logger } from "./logger";
import { geocodeAddress } from "./geocode";
import { fetchLINZAddressCandidates, fetchLINZLetterSuffixAddresses, lrsAddressLooksExact } from "./linz";
import type { LinzAddressSearchCandidate } from "./linz";

/**
 * Subdivision detection.
 *
 * When a user types a parent street number, the public property sources we use
 * can sometimes still hold stale parent-parcel data after a true subdivision.
 * This helper checks for letter-suffixed child lots, but only interrupts the
 * user when the evidence is strong. A single neighbouring suffix, such as "8A"
 * beside a still-valid "8", is not enough to claim the parent address has gone.
 */

export interface SubdivisionResult {
  isSubdivided: boolean;
  parentAddress: string;
  subLots: string[];
}

/**
 * Recovers the parent street+number from a just-sent subdivision clarification
 * (see the "clarificationType": "subdivision" JSON payload, which carries a
 * `parentAddress` field) and merges it with a short follow-up reply that
 * ISN'T itself a full address — e.g. the user replies "Birkenhead" after being
 * asked to pick between "4A Inglis Street, Mosgiel" / "4B Inglis Street,
 * Mosgiel", meaning they intended "4 Inglis Street, Birkenhead" all along.
 *
 * Deliberately dependency-free (no import of the address-detection helpers in
 * claude.ts) so it stays trivially unit-testable; callers are expected to
 * apply their own additional guards (e.g. "is this a listing-browse phrase?")
 * before treating the result as authoritative.
 */
export function mergeSubdivisionCorrection(
  lastAssistantContent: string | null | undefined,
  currentUserText: string,
): { mergedAddress: string } | null {
  const trimmedReply = currentUserText.trim();
  if (!trimmedReply || trimmedReply.split(/\s+/).length > 6) return null;
  // A reply starting with a number is very likely the user picking one of the
  // offered sub-lots directly (e.g. "4A Inglis Street, Mosgiel"), which the
  // normal address-extraction path already handles correctly on its own.
  if (/^\d/.test(trimmedReply)) return null;
  if (!lastAssistantContent) return null;

  let parsed: { clarificationType?: unknown; parentAddress?: unknown } | null = null;
  try {
    parsed = JSON.parse(lastAssistantContent);
  } catch {
    return null;
  }
  if (parsed?.clarificationType !== "subdivision" || typeof parsed.parentAddress !== "string") return null;

  const streetLine = parsed.parentAddress.split(",")[0]?.trim();
  if (!streetLine) return null;

  return { mergedAddress: `${streetLine}, ${trimmedReply}` };
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
 * unit-letter suffix on the street number. Returns null when no leading number
 * can be parsed.
 */
export function parseStreetNumberSuffix(address: string): {
  number: string;
  letter: string;
  rest: string;
} | null {
  const trimmed = address.trim();
  const m = trimmed.match(/^(\d+)([A-Za-z])?\s+(.+)$/);
  if (!m) return null;
  return {
    number: m[1],
    letter: (m[2] ?? "").toUpperCase(),
    rest: m[3],
  };
}

function normaliseFormatted(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bmelons\s+bay\b/g, "mellons bay")
    .replace(/[^a-z0-9]/g, "");
}

function streetLineFromRest(rest: string): string {
  const firstPart = rest.split(",")[0]!.trim();
  const streetType =
    /\b(?:road|street|avenue|crescent|place|drive|way|lane|terrace|parade|close|grove|rise|view|heights|ridge|court|hill|mews|quay|boulevard|highway|motorway|esplanade|mall|row|walk|path|track|rd|st|ave|cres|pl|dr|ln|tce|pde|blvd|hwy)\b/i;
  const match = streetType.exec(firstPart);
  if (!match || match.index == null) return firstPart;
  return firstPart.slice(0, match.index + match[0].length).trim();
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
 * A geocoded result counts as a real sub-lot only when the formatted address
 * contains the queried letter immediately after the street number, e.g.
 * "66a marine parade". This guards against geocoders silently normalising
 * "66A" back to "66" and returning the parent address.
 */
function formattedContainsSubLot(formatted: string, number: string, letter: string): boolean {
  const norm = formatted.toLowerCase();
  const re = new RegExp(`(^|[^0-9])${number}${letter.toLowerCase()}(\\s|,)`);
  return re.test(norm);
}

function formattedContainsParentLot(formatted: string, number: string): boolean {
  const norm = formatted.toLowerCase();
  const re = new RegExp(`(^|[^0-9])${number}(?![a-z])(\\s|,)`);
  return re.test(norm);
}

function linzCandidateContainsParentLot(candidateAddress: string, requestedAddress: string, number: string): boolean {
  if (!lrsAddressLooksExact(requestedAddress, candidateAddress)) return false;
  return formattedContainsParentLot(candidateAddress, number);
}

export async function detectSubdivision(address: string): Promise<SubdivisionResult> {
  const parsed = parseStreetNumberSuffix(address);
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

  const linzParentCandidates = await fetchLINZAddressCandidates(address, { maxResults: 3 }).catch(
    (): LinzAddressSearchCandidate[] => [],
  );
  const linzParentLooksValid = linzParentCandidates.some((candidate) =>
    linzCandidateContainsParentLot(candidate.address, address, number),
  );
  if (linzParentLooksValid) {
    logger.info(
      { parent: address, source: "linz_lrs_address_search" },
      "Subdivision skipped because base address exists",
    );
    return { isSubdivided: false, parentAddress: address, subLots: [] };
  }

  const linzSubLots = await fetchLINZLetterSuffixAddresses(address, LETTERS).catch(() => []);
  if (linzSubLots.length >= 2) {
    const subLots = linzSubLots.map((hit) => hit.address);
    logger.info(
      { parent: address, subLots, source: "linz_lrs_address_search" },
      "Subdivision detected",
    );
    return {
      isSubdivided: true,
      parentAddress: address,
      subLots,
    };
  }

  let parentLooksValid = false;
  try {
    const parentGeo = await geocodeAddress(address);
    if (formattedContainsParentLot(parentGeo.formatted, number)) {
      parentLooksValid = true;
    }
  } catch {
    // Ignore parent geocode failures and keep probing likely child lots.
  }

  const probes = await Promise.all(
    LETTERS.map(async (letter) => {
      const candidate = `${number}${letter} ${rest}`;
      try {
        const geo = await geocodeAddress(candidate);
        if (!formattedContainsSubLot(geo.formatted, number, letter)) return null;
        return { letter, formatted: geo.formatted };
      } catch {
        return null;
      }
    }),
  );

  const hits = probes.filter((p): p is NonNullable<typeof p> => p !== null);

  const byFormatted = new Map<string, typeof hits[number]>();
  for (const h of hits) {
    const k = normaliseFormatted(h.formatted);
    if (!byFormatted.has(k)) byFormatted.set(k, h);
  }

  const deduped = Array.from(byFormatted.values())
    .sort((a, b) => a.letter.localeCompare(b.letter))
    .map((h) => h.formatted);

  if (deduped.length < 2 || parentLooksValid) {
    return { isSubdivided: false, parentAddress: address, subLots: [] };
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
