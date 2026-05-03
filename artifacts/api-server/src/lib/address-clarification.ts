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

/** At or above: trust geocoder alignment and proceed without confirmation. */
const DICE_THRESHOLD_AUTO = 0.74;

function leadingStreetNumber(s: string): string | null {
  const m = s.trim().match(/^(\d+[a-z]?)\b/i);
  return m ? m[1].toLowerCase() : null;
}

function tokenizeRough(s: string): string[] {
  return s
    .toLowerCase()
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
export async function maybeAddressClarification(
  userTypedAddress: string,
  locale: Locale,
): Promise<AddressClarificationPayload | null> {
  const trimmed = userTypedAddress.trim();
  if (trimmed.length < 10) return null;

  let nominatim: Awaited<ReturnType<typeof nominatimSearchNz>> = [];
  try {
    nominatim = await nominatimSearchNz(trimmed, 8);
  } catch (err) {
    logger.warn({ err }, "nominatimSearchNz failed during address clarification");
  }

  const geoPrimary = await tryGeocodeAddress(trimmed);

  const uniqLower = new Set<string>();
  const opts: string[] = [];
  const push = (f?: string | null) => {
    const v = (f ?? "").trim();
    if (!v) return;
    const key = v.toLowerCase().replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    if (uniqLower.has(key)) return;
    uniqLower.add(key);
    opts.push(v);
  };

  push(geoPrimary?.formatted);
  for (const g of nominatim) push(g.formatted);

  if (!opts.length) {
    const llmAdds = await llmSuggestedAddresses(trimmed);
    for (const sug of llmAdds) {
      const gHit = await tryGeocodeAddress(sug);
      if (gHit?.formatted) push(gHit.formatted);
    }
  }

  if (!opts.length) return null;

  let resolvedBest = geoPrimary?.formatted ?? opts[0];
  resolvedBest = resolvedBest.trim();

  const dice = diceSimilarityTokens(trimmed, resolvedBest);
  const nu = leadingStreetNumber(trimmed);
  const nr = leadingStreetNumber(resolvedBest);
  const numMismatch = !!(nu && nr && nu !== nr);

  if (!numMismatch && dice >= DICE_THRESHOLD_AUTO) {
    return null;
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
    clarificationType: "address",
    question,
    options: opts.slice(0, 5),
  };
}
