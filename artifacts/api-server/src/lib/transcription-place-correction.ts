import {
  findClosestSuburbByName,
  findSuburbId,
  type FuzzySuburbMatch,
} from "./scrapers/realestate-api";

export const NZ_PROPERTY_TRANSCRIPTION_PROMPT =
  "Project Alpha is a New Zealand property app. Preserve spoken NZ place names, street names, and suburbs. Common Auckland examples: Marine Parade, Mellons Bay, St Heliers, Saint Heliers, Mission Bay, Kohimarama, Orakei, Remuera, Glendowie, Meadowbank, Bucklands Beach, Half Moon Bay. The speaker may use English, Mandarin Chinese, or a mix. Transcribe in the language spoken; do not translate.";

type CandidateCorrection = {
  text: string;
  confidence: number;
};

type SuburbCorrectionLookup = (candidate: string) => Promise<CandidateCorrection | null>;

type Replacement = {
  start: number;
  end: number;
  text: string;
};

const STREET_TYPE_WORDS = new Set([
  "road",
  "street",
  "avenue",
  "crescent",
  "place",
  "drive",
  "way",
  "lane",
  "terrace",
  "parade",
  "close",
  "grove",
  "rise",
  "view",
  "heights",
  "ridge",
  "court",
  "hill",
  "mews",
  "quay",
  "boulevard",
  "highway",
  "motorway",
  "esplanade",
  "mall",
  "row",
  "walk",
  "path",
  "track",
  "rd",
  "st",
  "ave",
  "cres",
  "pl",
  "dr",
  "ln",
  "tce",
  "pde",
  "blvd",
  "hwy",
]);

const LOCATION_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "this",
  "that",
  "area",
  "suburb",
  "properties",
  "property",
  "listings",
  "listing",
  "houses",
  "homes",
  "land",
  "currently",
  "available",
  "listed",
  "sale",
  "for",
]);

const PLACE_SUFFIX_TOKENS = new Set([
  "bay",
  "beach",
  "heights",
  "park",
  "point",
  "shore",
  "harbour",
  "harbor",
  "island",
  "hill",
  "hills",
  "vale",
  "view",
  "glen",
  "field",
  "fields",
  "town",
  "city",
  "village",
  "valley",
  "creek",
]);

function normalisePlaceName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenList(value: string): string[] {
  return normalisePlaceName(value).split(" ").filter(Boolean);
}

function sameFinalToken(a: string, b: string): boolean {
  const at = tokenList(a);
  const bt = tokenList(b);
  return !!at.length && !!bt.length && at[at.length - 1] === bt[bt.length - 1];
}

function startsSimilarly(a: string, b: string): boolean {
  const an = normalisePlaceName(a);
  const bn = normalisePlaceName(b);
  return !!an && !!bn && an[0] === bn[0];
}

export function isHighConfidenceSuburbMatch(input: string, match: FuzzySuburbMatch): boolean {
  const tokens = tokenList(input);
  if (tokens.length === 0) return false;
  if (match.distance <= 2 && match.similarity >= 0.78 && match.margin >= 0.035) return true;
  return (
    tokens.length >= 2 &&
    match.distance <= 3 &&
    match.similarity >= 0.68 &&
    match.margin >= 0.055 &&
    sameFinalToken(input, match.alias) &&
    startsSimilarly(input, match.alias)
  );
}

async function defaultSuburbCorrectionLookup(candidate: string): Promise<CandidateCorrection | null> {
  const cleaned = cleanCandidate(candidate);
  if (!cleaned) return null;

  const direct = await findSuburbId(cleaned);
  if (direct) {
    const same = normalisePlaceName(cleaned) === normalisePlaceName(direct.title);
    return same ? null : { text: direct.title, confidence: 1 };
  }

  const fuzzy = await findClosestSuburbByName(cleaned);
  if (!fuzzy || !isHighConfidenceSuburbMatch(cleaned, fuzzy)) return null;
  return { text: fuzzy.suburb.title, confidence: fuzzy.similarity };
}

function cleanCandidate(raw: string): string | null {
  const cleaned = raw
    .replace(/^[\s,.;:!?'"()]+|[\s,.;:!?'"()]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || !/[A-Za-z]/.test(cleaned)) return null;
  const tokens = tokenList(cleaned);
  if (tokens.length === 0 || tokens.length > 4) return null;
  if (tokens.every((token) => LOCATION_STOPWORDS.has(token))) return null;
  return cleaned;
}

function trailingLocalityAfterStreetType(segment: string): { candidate: string; start: number; end: number } | null {
  const words = [...segment.matchAll(/[A-Za-z][A-Za-z']*/g)].map((match) => ({
    raw: match[0],
    lower: match[0].toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  if (words.length < 3) return null;

  let streetTypeIndex = -1;
  for (let i = 0; i < words.length; i++) {
    if (STREET_TYPE_WORDS.has(words[i]!.lower)) streetTypeIndex = i;
  }
  if (streetTypeIndex < 0 || streetTypeIndex >= words.length - 1) return null;

  const tail = words.slice(streetTypeIndex + 1);
  if (tail.length === 0 || tail.length > 3) return null;
  const start = tail[0]!.start;
  const end = tail[tail.length - 1]!.end;
  return { candidate: segment.slice(start, end), start, end };
}

function containsStreetType(candidate: string): boolean {
  return tokenList(candidate).some((token) => STREET_TYPE_WORDS.has(token));
}

function looksLikeStandalonePlaceCandidate(candidate: string): boolean {
  const tokens = tokenList(candidate);
  if (tokens.length < 2 || tokens.length > 3) return false;
  return PLACE_SUFFIX_TOKENS.has(tokens[tokens.length - 1]!);
}

function addReplacement(replacements: Replacement[], replacement: Replacement): void {
  if (replacement.start >= replacement.end) return;
  if (replacement.text.length === 0) return;
  if (replacements.some((existing) => replacement.start < existing.end && replacement.end > existing.start)) return;
  replacements.push(replacement);
}

async function maybeCorrection(candidate: string, lookup: SuburbCorrectionLookup): Promise<string | null> {
  const cleaned = cleanCandidate(candidate);
  if (!cleaned) return null;
  const corrected = await lookup(cleaned);
  if (!corrected) return null;
  if (normalisePlaceName(cleaned) === normalisePlaceName(corrected.text)) return null;
  return corrected.text;
}

export async function correctTranscribedNzPlaces(
  transcript: string,
  lookup: SuburbCorrectionLookup = defaultSuburbCorrectionLookup,
): Promise<string> {
  if (!transcript || !/[A-Za-z]/.test(transcript)) return transcript;

  const replacements: Replacement[] = [];

  for (const match of transcript.matchAll(/,\s*([A-Za-z][A-Za-z' -]{2,48})(?=[,.;!?]|$)/g)) {
    const candidate = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].indexOf(candidate);
    const corrected = await maybeCorrection(candidate, lookup);
    if (corrected) addReplacement(replacements, { start, end: start + candidate.length, text: corrected });
  }

  for (const match of transcript.matchAll(/\b(?:in|at|near|around|within)\s+([A-Za-z][A-Za-z' -]{2,80})(?=[,.;!?]|$)/gi)) {
    const segment = match[1] ?? "";
    const segmentStart = (match.index ?? 0) + match[0].indexOf(segment);
    const tail = trailingLocalityAfterStreetType(segment);
    const candidate = tail?.candidate ?? segment;
    const candidateStart = segmentStart + (tail?.start ?? 0);
    const corrected = await maybeCorrection(candidate, lookup);
    if (corrected) addReplacement(replacements, { start: candidateStart, end: candidateStart + candidate.length, text: corrected });
  }

  for (const match of transcript.matchAll(/\b([A-Za-z][A-Za-z']+(?:\s+[A-Za-z][A-Za-z']+){1,2})\b/g)) {
    const candidate = match[1] ?? "";
    if (containsStreetType(candidate)) continue;
    if (!looksLikeStandalonePlaceCandidate(candidate)) continue;
    const start = match.index ?? 0;
    const corrected = await maybeCorrection(candidate, lookup);
    if (corrected) addReplacement(replacements, { start, end: start + candidate.length, text: corrected });
  }

  if (!replacements.length) return transcript;
  replacements.sort((a, b) => b.start - a.start);
  let output = transcript;
  for (const replacement of replacements) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  return output;
}
