// Deterministic detection of the "include the non-freehold tenures you left out"
// affirmation. Subdivision/freehold discovery drops cross-lease / leasehold /
// unit-title listings and the assistant offers to include them (see
// buildTenureExclusionReminder in routes/analyse.ts). When the user replies with
// a bare "yes", the affirmation must map back to those tenures. Relying on the
// LLM to re-parse that from history is unreliable; this module does it directly
// from the prior assistant message (text we control) so "Yes include" always
// works. The LLM `includeTenures` path remains as a secondary source.

export type Tenure = "cross_lease" | "leasehold" | "unit_title";

/**
 * Extract which non-freehold tenures a prior assistant turn offered to include.
 * Returns [] unless the message actually looks like the tenure-exclusion offer
 * (so tenure words mentioned in unrelated prose don't count).
 */
export function parseOfferedTenuresFromAssistant(text: string | null | undefined): Tenure[] {
  if (!text) return [];
  const lower = text.toLowerCase();

  // Gate: only treat as an offer when the message carries the offer's shape.
  // EN: "I left out … because subdivision needs a freehold title. Tell me if
  // you'd like me to include …". ZH (translated): mentions a tenure plus a
  // freehold/subdivision context. Combined with the caller requiring a bare
  // affirmation, this is safe against false positives.
  const enOffer =
    (/\bi left out\b/.test(lower) && /\bfreehold title\b/.test(lower)) ||
    /tell me if you('?| woul)d? like me to include/.test(lower) ||
    /note on what'?s involved/.test(lower);
  const zhOffer = /(地契|產權|产权)/.test(text) && /(细分|細分|分割|不能|無法|无法|需要自由保有|freehold)/.test(text);
  if (!enOffer && !zhOffer) return [];

  const out: Tenure[] = [];
  if (/cross[\s-]?lease/i.test(text) || /交叉地契|十字地契/.test(text)) out.push("cross_lease");
  if (/lease\s?hold/i.test(text) || /租赁产权|租賃產權|租地|租约地|租約地/.test(text)) out.push("leasehold");
  if (/unit[\s-]?title/i.test(text) || /单位产权|單位產權|分契产权|分契產權|地契公寓/.test(text)) out.push("unit_title");
  return out;
}

/**
 * True when the user's message is a bare affirmative / "include them" reply with
 * no negation — the kind that should accept a pending offer.
 */
export function isBareTenureAffirmation(userText: string | null | undefined): boolean {
  if (!userText) return false;
  const raw = userText.trim();
  if (!raw) return false;
  const t = raw.toLowerCase();

  // Never treat an explicit negative as an affirmation.
  if (/\b(no|not|don'?t|nope|skip|exclude|without|leave (?:it|them) out)\b/.test(t)) return false;
  if (/不(?:要|用|加|看)|别|別|跳过|跳過|排除/.test(raw)) return false;

  // Chinese affirmations.
  if (/^(?:好的?|可以|行|是的?|對|对|要|都要|都加|都看|加进来|加進來|都加进来|都加進來|全部加|包括(?:它们|它們|这些|這些)?)/.test(raw)) {
    return true;
  }

  // English affirmations / "include them" phrasings. A leading "show"/"add" must
  // be followed by an inclusion object (them/all/…) — otherwise "show me Ponsonby
  // instead" would read as an affirmation.
  if (/^(?:yes|yep|yeah|yup|sure|okay|ok|go ahead|do it|include|please (?:do|include)|definitely|absolutely)\b/.test(t)) {
    return true;
  }
  if (/\b(?:include|add|show|keep|see)\s+(?:me\s+)?(?:them|those|these|it|all|any|the\s|cross|lease|unit)/.test(t)) {
    return true;
  }
  return false;
}
