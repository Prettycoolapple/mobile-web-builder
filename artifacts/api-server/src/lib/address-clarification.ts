import { ai } from "@workspace/integrations-gemini-ai";
import { nominatimSearchNz, tryGeocodeAddress } from "./geocode";
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
  const m = s.trim().match(/^(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : null;
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

function streetKey(s: string): string | null {
  const tokens = tokenizeRough(s);
  let numberIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (/^\d+[a-z]?$/.test(tokens[i]!)) {
      numberIdx = i;
      break;
    }
  }
  if (numberIdx < 0) return null;

  const streetTypes = new Set(["rd", "st", "ave", "crescent", "place", "pl", "dr", "way", "lane", "tce", "close", "parade"]);
  let typeIdx = -1;
  for (let i = numberIdx + 1; i < tokens.length; i++) {
    if (streetTypes.has(tokens[i]!)) typeIdx = i;
  }
  if (typeIdx < numberIdx + 1) return null;

  return tokens.slice(numberIdx, typeIdx + 1).join(" ");
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

async function llmSuggestedAddresses(raw: string): Promise<string[]> {
  const safeInput = raw.length > 320 ? raw.slice(0, 320) : raw;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
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
    logger.warn({ err: (err as Error).message }, "Gemini address-suggestion fallback failed");
    return [];
  }
}

/**
 * When the typed address might be a typo of a NZ property geocoder resolved elsewhere,
 * return a clarification payload so the client can confirm before consuming a full report quota.
 *
 * Uses fuzzy comparison between user input and best geocoder string + extra Nominatim hits.
 * Gemini suggests strings only when nobody returns a usable hit.
 */
export async function resolveAddressForAnalysis(
  userTypedAddress: string,
  locale: Locale,
): Promise<AddressResolution> {
  const trimmed = userTypedAddress.trim();
  if (trimmed.length < 10) return { resolvedAddress: trimmed, clarification: null };

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

  if (!opts.length) {
    const llmAdds = await llmSuggestedAddresses(trimmed);
    for (const sug of llmAdds) {
      const gHit = await tryGeocodeAddress(sug);
      if (gHit?.formatted) push(gHit);
    }
  }

  const deduped = dedupeEquivalentAddressOptions(opts);
  if (!deduped.length) return { resolvedAddress: trimmed, clarification: null };

  let resolvedBest = geoPrimary?.formatted ?? deduped[0]!.formatted;
  resolvedBest = resolvedBest.trim();

  const dice = diceSimilarityTokens(trimmed, resolvedBest);
  const nu = leadingStreetNumber(trimmed);
  const nr = leadingStreetNumber(resolvedBest);
  const numMismatch = !!(nu && nr && nu !== nr);

  if (!numMismatch && dice >= DICE_THRESHOLD_AUTO) {
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
