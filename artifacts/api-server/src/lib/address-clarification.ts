import { ai } from "@workspace/integrations-gemini-ai";
import { nominatimSearchNz, tryGeocodeAddress } from "./geocode";
import { fetchLINZAddressCandidates } from "./linz";
import { logger } from "./logger";
import type { Locale } from "./prompts";
import { ensureChinese } from "./translation";

export type AddressClarificationPayload = {
  clarificationType: "address";
  question: string;
  options: string[];
};

export type AddressOption = {
  formatted: string;
  lat: number | null;
  lng: number | null;
};

export type AddressResolution = {
  resolvedAddress: string;
  clarification: AddressClarificationPayload | null;
};

/** At or above: trust geocoder alignment and proceed without confirmation. */
const DICE_THRESHOLD_AUTO = 0.74;
const SAME_ADDRESS_DISTANCE_M = 250;

function leadingStreetNumber(s: string): string | null {
  const m = s.trim().match(/^([a-z]?\d+[a-z]?\s*\/\s*\d+[a-z]?|\d+[a-z]?)(?:\b|,)/i);
  return m ? m[1].replace(/\s+/g, "").toLowerCase() : null;
}

function tokenizeRough(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bst\.\b/g, "st")
    .replace(/\broad\b/g, "rd")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bterrace\b/g, "tce")
    .replace(/\bnew zealand\b/g, "nz")
    .replace(/,/g, " ")
    .replace(/[^a-z0-9\s']/gi, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => (w.length >= 2 || /^\d+[a-z]?$/i.test(w)) && !/^nz$/i.test(w));
}

/** Sørensen–Dice on token multiset overlap (cheap fuzzy match vs formatted geocoder output). */
function diceSimilarityTokens(aRaw: string, bRaw: string): number {
  const a = tokenizeRough(aRaw);
  const b = tokenizeRough(bRaw);
  if (a.length === 0 || b.length === 0) return 0;

  const count = (tokens: string[]) => {
    const m = new Map<string, number>();
    for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };

  const ma = count(a);
  const mb = count(b);

  let inter = 0;
  for (const [t, na] of ma) {
    const nb = mb.get(t) ?? 0;
    inter += Math.min(na, nb);
  }

  return (2 * inter) / (a.length + b.length);
}

function exactAddressKey(s: string): string {
  return tokenizeRough(s).join(" ");
}

function streetLineText(s: string): string {
  const parts = s.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && /^\d+[a-z]?$/i.test(parts[0]!)) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0] ?? s;
}

function streetKey(s: string): string | null {
  const tokens = tokenizeRough(streetLineText(s));
  let numberIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (/^\d+[a-z]?$/.test(tokens[i]!)) {
      numberIdx = i;
      break;
    }
  }
  if (numberIdx < 0) return null;

  const streetTypes = new Set([
    "rd",
    "st",
    "ave",
    "crescent",
    "place",
    "pl",
    "dr",
    "way",
    "lane",
    "tce",
    "close",
    "parade",
    "highway",
    "hwy",
    "motorway",
  ]);
  let typeIdx = -1;
  for (let i = numberIdx + 1; i < tokens.length; i++) {
    if (streetTypes.has(tokens[i]!)) typeIdx = i;
  }
  if (typeIdx < numberIdx + 1) {
    const hasStreetLineName = tokens.slice(numberIdx + 1).some((token) => /[a-z]/i.test(token));
    return hasStreetLineName ? tokens.slice(numberIdx).join(" ") : null;
  }

  return tokens.slice(numberIdx, typeIdx + 1).join(" ");
}

export function isFullStreetAddressForAnalysis(s: string): boolean {
  return streetKey(s) != null;
}

function looksLikePropertyAddressAttempt(s: string): boolean {
  const tokens = tokenizeRough(s);
  return leadingStreetNumber(s) != null && tokens.some((token) => /[a-z]/i.test(token));
}

// City/region/country markers that do NOT disambiguate one suburb from another.
const GENERIC_LOCALITY_TOKENS = new Set(["auckland", "city", "nz", "newzealand"]);

/**
 * True when the user's input names a suburb/locality beyond the bare street
 * number+name (e.g. "…, Avondale"). When it does, the geocoder can resolve a
 * single property and we don't need to ask which suburb. When it doesn't (just
 * "35 Rosebank Road"), the same street may exist in several suburbs.
 */
function inputSpecifiesSuburb(input: string): boolean {
  const sk = streetKey(input);
  if (!sk) return false;
  const streetTokens = new Set(tokenizeRough(sk));
  return tokenizeRough(input).some(
    (tok) =>
      !streetTokens.has(tok) &&
      !GENERIC_LOCALITY_TOKENS.has(tok) &&
      !/^\d{3,4}$/.test(tok) && // ignore postcodes
      /[a-z]/i.test(tok),
  );
}

/**
 * When the user typed a bare street address with no suburb and that same street
 * number+name resolves to two or more distinct suburbs, return those options so
 * the caller can ask which one the user meant. Returns null when the input is
 * suburb-qualified or the street is unambiguous. Options are expected to be
 * already deduped + filtered to the input's street number
 * ({@link dedupeEquivalentAddressOptions} / {@link filterAddressOptionsForAnalysis}),
 * so two survivors sharing a street key are genuinely different locations.
 */
export function detectMultiSuburbAmbiguity(
  input: string,
  options: AddressOption[],
): AddressOption[] | null {
  if (inputSpecifiesSuburb(input)) return null;
  const inputStreet = streetKey(input);
  if (!inputStreet) return null;
  const sameStreet = options.filter((option) => streetKey(option.formatted) === inputStreet);
  return sameStreet.length >= 2 ? sameStreet : null;
}

export function filterAddressOptionsForAnalysis(input: string, options: AddressOption[]): AddressOption[] {
  const inputNumber = leadingStreetNumber(input);

  return options.filter((option) => {
    if (!isFullStreetAddressForAnalysis(option.formatted)) return false;

    const optionNumber = leadingStreetNumber(option.formatted);
    if (inputNumber && optionNumber && inputNumber !== optionNumber) return false;

    return true;
  });
}

async function noPropertyAddressResolution(input: string, locale: Locale): Promise<AddressResolution> {
  const questionEn =
    `We could not confidently match "${input}" to a property address. ` +
    `Please enter the full street address or check the spelling before running the feasibility analysis.`;

  return {
    resolvedAddress: input,
    clarification: {
      clarificationType: "address",
      question: locale === "zh" ? await ensureChinese(questionEn) : questionEn,
      options: [],
    },
  };
}

function distanceMetres(a: AddressOption, b: AddressOption): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * 6_371_000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function sameAddressCandidate(a: AddressOption, b: AddressOption): boolean {
  const exactA = exactAddressKey(a.formatted);
  const exactB = exactAddressKey(b.formatted);
  if (exactA && exactA === exactB) return true;

  const streetA = streetKey(a.formatted);
  const streetB = streetKey(b.formatted);
  if (!streetA || streetA !== streetB) return false;

  const distance = distanceMetres(a, b);
  if (distance != null) return distance <= SAME_ADDRESS_DISTANCE_M;

  return diceSimilarityTokens(a.formatted, b.formatted) >= 0.78;
}

export function dedupeEquivalentAddressOptions(options: AddressOption[]): AddressOption[] {
  const deduped: AddressOption[] = [];
  for (const option of options) {
    const formatted = option.formatted.trim();
    if (!formatted) continue;
    const candidate = { ...option, formatted };
    if (deduped.some((existing) => sameAddressCandidate(existing, candidate))) continue;
    deduped.push(candidate);
  }
  return deduped;
}

async function hydrateMissingOptionCoordinates(options: AddressOption[]): Promise<AddressOption[]> {
  return Promise.all(options.map(async (option) => {
    if (option.lat != null && option.lng != null) return option;
    const geocoded = await tryGeocodeAddress(option.formatted).catch(() => null);
    if (!geocoded || leadingStreetNumber(geocoded.formatted) !== leadingStreetNumber(option.formatted)) {
      return option;
    }
    return {
      formatted: geocoded.formatted,
      lat: geocoded.lat,
      lng: geocoded.lng,
    };
  }));
}

async function llmSuggestedAddresses(raw: string): Promise<string[]> {
  const safeInput = raw.length > 320 ? raw.slice(0, 320) : raw;

  try {
    const response = await ai.models.generateContent({
      model: "deepseek-chat",
      config: {
        maxOutputTokens: 512,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                `The user typed what they believe is a New Zealand residential street address, but automated geocoding failed or returned no confident match.\n` +
                `Return up to 3 corrected FULL addresses anywhere in NZ (preserve the user's implied street NUMBER — do not change the number unless fixing an obvious OCR typo next to digits).\n` +
                `Fix suburb spelling mistakes and token confusions ("At Heliers" → Saint Heliers, etc.). Prefer Auckland when ambiguous.\n` +
                `Output JSON ONLY: {"addresses":["...", "..."]}. If you have zero plausible suggestions return {"addresses":[]}.\n` +
                `USER_INPUT:\n"""${safeInput}"""`,
            },
          ],
        },
      ],
    });

    const out = (response.text ?? "").trim();
    const start = out.indexOf("{");
    const end = out.lastIndexOf("}");
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(out.slice(start, end + 1)) as { addresses?: unknown };

    const arr = Array.isArray(parsed.addresses) ? parsed.addresses.filter((x) => typeof x === "string") : [];
    return arr.map((x) => x.trim()).filter((x) => x.length > 8);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "LLM address-suggestion fallback failed");
    return [];
  }
}

/**
 * When the typed address might be a typo of a NZ property geocoder resolved elsewhere,
 * return a clarification payload so the client can confirm before consuming a full report quota.
 *
 * Uses fuzzy comparison between user input and best geocoder string + extra Nominatim hits.
 * The LLM suggests strings only when nobody returns a usable hit.
 */
export async function resolveAddressForAnalysis(
  userTypedAddress: string,
  locale: Locale,
): Promise<AddressResolution> {
  const trimmed = userTypedAddress.trim();
  if (trimmed.length < 10) return { resolvedAddress: trimmed, clarification: null };
  if (!looksLikePropertyAddressAttempt(trimmed)) return noPropertyAddressResolution(trimmed, locale);

  let nominatim: Awaited<ReturnType<typeof nominatimSearchNz>> = [];
  try {
    nominatim = await nominatimSearchNz(trimmed, 8);
  } catch (err) {
    logger.warn({ err }, "nominatimSearchNz failed during address clarification");
  }

  const geoPrimary = await tryGeocodeAddress(trimmed);

  const opts: AddressOption[] = [];
  const push = (g?: { formatted?: string | null; lat?: number | null; lng?: number | null } | null) => {
    const v = (g?.formatted ?? "").trim();
    if (!v) return;
    opts.push({
      formatted: v,
      lat: typeof g?.lat === "number" ? g.lat : null,
      lng: typeof g?.lng === "number" ? g.lng : null,
    });
  };

  push(geoPrimary);
  for (const g of nominatim) push(g);

  try {
    const linzCandidates = await fetchLINZAddressCandidates(trimmed, { maxResults: 5 });
    for (const candidate of linzCandidates) {
      push({ formatted: candidate.address, lat: null, lng: null });
    }
  } catch (err) {
    logger.warn({ err }, "LINZ address candidates failed during address clarification");
  }

  let deduped = filterAddressOptionsForAnalysis(
    trimmed,
    dedupeEquivalentAddressOptions(await hydrateMissingOptionCoordinates(opts)),
  );

  if (!deduped.length) {
    const llmAdds = await llmSuggestedAddresses(trimmed);
    for (const sug of llmAdds) {
      const gHit = await tryGeocodeAddress(sug);
      if (gHit?.formatted) push(gHit);
    }
    deduped = filterAddressOptionsForAnalysis(
      trimmed,
      dedupeEquivalentAddressOptions(await hydrateMissingOptionCoordinates(opts)),
    );
  }

  if (!deduped.length) return noPropertyAddressResolution(trimmed, locale);

  // Same street number+name in multiple suburbs and the user gave no suburb
  // (e.g. "35 Rosebank Road" → Avondale AND Papatoetoe). Always confirm before
  // analysing — this must take precedence over the high-similarity auto-proceed
  // below, since a bare street is a near-subset of any single resolved match.
  const multiSuburb = detectMultiSuburbAmbiguity(trimmed, deduped);
  if (multiSuburb) {
    const questionEn = `"${trimmed}" matches more than one suburb. Tap the exact property you want me to analyse:`;
    return {
      resolvedAddress: trimmed,
      clarification: {
        clarificationType: "address",
        question: locale === "zh" ? await ensureChinese(questionEn) : questionEn,
        options: multiSuburb.map((option) => option.formatted).slice(0, 5),
      },
    };
  }

  let resolvedBest = deduped.find((option) => option.formatted === geoPrimary?.formatted)?.formatted ?? deduped[0]!.formatted;
  resolvedBest = resolvedBest.trim();

  const dice = diceSimilarityTokens(trimmed, resolvedBest);
  const nu = leadingStreetNumber(trimmed);
  const nr = leadingStreetNumber(resolvedBest);
  const numMismatch = !!(nu && nr && nu !== nr);

  if (!numMismatch && dice >= DICE_THRESHOLD_AUTO) {
    return { resolvedAddress: resolvedBest, clarification: null };
  }

  if (!numMismatch && deduped.length === 1 && streetKey(trimmed) === streetKey(resolvedBest)) {
    return { resolvedAddress: resolvedBest, clarification: null };
  }

  if (!numMismatch && deduped.length === 1 && dice >= 0.62) {
    return { resolvedAddress: resolvedBest, clarification: null };
  }

  const questionEn =
    dice >= 0.48 && resolvedBest
      ? `Do you mean "${resolvedBest}"? Tap the correct address below to run the feasibility analysis.`
      : `We could not confidently match "${trimmed}". Tap the address that matches the property you meant:`;

  const question =
    locale === "zh"
      ? await ensureChinese(questionEn)
      : questionEn;

  return {
    resolvedAddress: trimmed,
    clarification: {
      clarificationType: "address",
      question,
      options: deduped.map((o) => o.formatted).slice(0, 5),
    },
  };
}

export async function maybeAddressClarification(
  userTypedAddress: string,
  locale: Locale,
): Promise<AddressClarificationPayload | null> {
  const resolution = await resolveAddressForAnalysis(userTypedAddress, locale);
  return resolution.clarification;
}
