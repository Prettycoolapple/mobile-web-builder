/**
 * Deterministic extraction of structured claims from a listing's own marketing
 * copy (title + description + propertyType). Dependency-free — same pattern as
 * `scrapers/scraper-parsers.ts` — so the vitest suite can exercise it directly.
 *
 * Why this exists: council/valuation sources (AC GIS, propertyvalue.co.nz,
 * LINZ) lag redevelopment by months-to-years. A demolished 1935 house replaced
 * by ten new townhouses still reads as "build_year 1935, land 842m²" in every
 * backend source — the only party that knows about the new dwelling is the
 * listing itself ("10 brand new townhouses…"). These claims let screening and
 * the analysis pipeline cross-check the listing against the records and reject
 * or flag already-redeveloped parcels (the 6 Riddell Road incident).
 *
 * The hard constraint throughout: genuinely subdividable do-ups advertise
 * "potential to build townhouses STCA" — the extractor must distinguish "the
 * dwelling IS a (brand-new) townhouse" from "you could build townhouses here",
 * and "brand new townhouse" from "brand new kitchen". When a mention is
 * ambiguous we fail open (no flag) so downstream gates behave as before.
 */

export interface ListingClaims {
  /** The dwelling being sold IS a townhouse/terrace (not "you could build some"). */
  dwellingIsTownhouse: boolean;
  /** Townhouse/terrace words appear only as development potential ("build townhouses STCA"). */
  townhousePotentialOnly: boolean;
  /** Listing markets the dwelling as a new/near-new build. */
  isNewBuild: boolean;
  /** Explicit completion/build year when stated and >= 2000 ("completed 2025"). */
  completionYear: number | null;
  /** Listing is one unit of (or the whole of) a multi-unit development. */
  multiUnitDevelopment: boolean;
  unitCount: number | null;
  /** Snippets that triggered each signal — for logs, reject reasons, and report warnings. */
  evidence: string[];
}

export interface ListingClaimsInput {
  listingTitle?: string | null;
  description?: string | null;
  propertyType?: string | null;
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * "Could build" markers. When one of these appears in the ~60 chars before a
 * townhouse / multi-unit mention, the mention describes development POTENTIAL
 * of the site, not the dwelling being sold.
 */
const COULD_BUILD_WINDOW_RE =
  /\b(?:build|building|develop|developing|developable|add|adding|erect|construct(?:ing)?|land\s?-?bank\w*|potential|possib\w+|scope|opportunit\w+|site\s+for|room\s+(?:for|to)|future|consent(?:ed)?(?:\s+for)?|stca|subject\s+to|plans?\s+(?:for|to)|could|zoned?\s+for|ideal\s+for|perfect\s+for)\b/i;

/**
 * "Selling the thing" phrasings: the mention can only describe the dwelling
 * itself. These win over could-build markers in the same window ("brand new
 * townhouses, consents complete" is still a built townhouse).
 */
const IS_TOWNHOUSE_RES: RegExp[] = [
  /\b(?:brand|near)[-\s]?new\s+(?:\w+[-\s]){0,3}?town\s?houses?\b/i,
  /\bthis\s+(?:\w+[-\s]){0,3}?town\s?house\b/i,
  /\btown\s?house\s+(?:living|lifestyle|offers|features|boasts|presents|delivers)\b/i,
  /\b(?:freestanding|free-standing|standalone|stand-alone|modern|stunning|luxury|executive|stylish|spacious|architecturally[-\s]designed|beautifully\s+presented|immaculate)\s+town\s?house\b/i,
  /\bterraced?\s+(?:home|house)\s+(?:living|lifestyle|offers|features|boasts)\b/i,
  /\b(?:brand|near)[-\s]?new\s+(?:\w+[-\s]){0,3}?duplex\b/i,
];

/** Dwelling words "brand/near new" can govern to mean a new BUILD. */
const NEW_BUILD_NOUN_RE =
  /^(?:home|homes|house|houses|town\s?house|town\s?houses|terrace[sd]?|build|builds|residence|residences|property|properties|development|unit|units|duplex(?:es)?|dwelling|dwellings|apartment|apartments)\b/i;

/** Chattel/renovation words — "brand new kitchen" is a renovation, not a new build. */
const CHATTEL_WORD_RE =
  /^(?:kitchen|kitchens|bathroom|bathrooms|carpet|carpets|paint(?:work)?|roof(?:ing)?|deck(?:ing)?|fence|fencing|appliance|appliances|flooring|floors?|heat\s?pumps?|wardrobes?|lighting|curtains|blinds|joinery|bench(?:top)?s?|cabinetry|garage\s+door|renovations?|plumbing|wiring|cladding|insulation|hot\s+water)\b/i;

/** Multi-unit nouns ("10 brand new townhouses", "4 dwellings"). */
const MULTI_UNIT_RE =
  /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:x\s+)?(?:(?:brand|near)[-\s]?new\s+|new\s+|stunning\s+|modern\s+|luxury\s+|executive\s+|architecturally[-\s]designed\s+|freehold\s+|quality\s+)*(town\s?houses|terraces|terraced\s+(?:homes|houses)|units|homes|dwellings|residences|duplexes)\b/gi;

const TOWNHOUSE_MENTION_RE = /\btown\s?houses?\b|\bterraced?\s+(?:homes?|houses?)\b|\bduplex(?:es)?\b/gi;

function normalise(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function snippet(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function windowBefore(text: string, index: number, span = 60): string {
  return text.slice(Math.max(0, index - span), index);
}

function parseUnitCount(token: string): number | null {
  const numeric = parseInt(token, 10);
  if (!isNaN(numeric)) return numeric >= 2 && numeric <= 99 ? numeric : null;
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

export function extractListingClaims(input: ListingClaimsInput): ListingClaims {
  const text = [normalise(input.listingTitle), normalise(input.description)]
    .filter(Boolean)
    .join(" | ");
  const propertyType = normalise(input.propertyType);
  const evidence: string[] = [];

  // ── Townhouse: IS vs COULD-BUILD ─────────────────────────────────────────
  let dwellingIsTownhouse = false;
  let townhousePotentialOnly = false;

  if (/\btown\s?house\b|\bterraced?\b|\bduplex\b/i.test(propertyType)) {
    dwellingIsTownhouse = true;
    evidence.push(`property type: ${propertyType}`);
  }

  for (const re of IS_TOWNHOUSE_RES) {
    const m = re.exec(text);
    if (m) {
      dwellingIsTownhouse = true;
      evidence.push(snippet(text, m.index, m[0].length));
      break;
    }
  }

  const mentions = [...text.matchAll(TOWNHOUSE_MENTION_RE)];
  if (!dwellingIsTownhouse && mentions.length > 0) {
    const allPotential = mentions.every((m) =>
      COULD_BUILD_WINDOW_RE.test(windowBefore(text, m.index ?? 0)),
    );
    if (allPotential) townhousePotentialOnly = true;
    // Mentions that are neither selling-phrasing nor could-build remain
    // ambiguous: no flag either way (fail open).
  }

  // ── New build vs renovation ──────────────────────────────────────────────
  let isNewBuild = false;
  let completionYear: number | null = null;

  for (const m of text.matchAll(/\b(?:brand|near)[-\s]?new\b/gi)) {
    const after = text.slice((m.index ?? 0) + m[0].length).trimStart();
    // Walk up to 4 words: a chattel word before any dwelling word kills the
    // signal ("brand new kitchen"); a dwelling word confirms it.
    const words = after.split(/\s+/).slice(0, 4);
    let matched = false;
    for (let i = 0; i < words.length; i++) {
      const rest = words.slice(i).join(" ");
      if (CHATTEL_WORD_RE.test(rest)) break;
      if (NEW_BUILD_NOUN_RE.test(rest)) { matched = true; break; }
    }
    if (matched) {
      isNewBuild = true;
      evidence.push(snippet(text, m.index ?? 0, m[0].length));
      break;
    }
  }

  const simpleNewBuildRes: RegExp[] = [
    /\bnewly\s+(?:built|completed|constructed)\b/i,
    /\boff[-\s]the[-\s]plans?\b/i,
    /\boff[-\s]plan\b/i,
    /\bunder\s+construction\b/i,
    /\bnever\s+(?:been\s+)?lived\s+in\b/i,
    /\b(?:10|ten)[-\s]year\s+(?:master\s?build(?:ers?)?|build(?:ers?)?|halo|stamford)\s*(?:guarantee|warranty)\b/i,
    /\bmaster\s?build(?:ers?)?\s+(?:10[-\s]year\s+)?(?:guarantee|warranty)\b/i,
  ];
  if (!isNewBuild) {
    for (const re of simpleNewBuildRes) {
      const m = re.exec(text);
      if (m) {
        isNewBuild = true;
        evidence.push(snippet(text, m.index, m[0].length));
        break;
      }
    }
  }

  // "new build" as a phrase — guarded against "new build potential / ideal
  // new-build site" style could-build copy.
  if (!isNewBuild) {
    for (const m of text.matchAll(/\bnew\s+builds?\b/gi)) {
      const before = windowBefore(text, m.index ?? 0);
      const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 40);
      if (COULD_BUILD_WINDOW_RE.test(before) || /^\s*(?:potential|opportunit|site|section)/i.test(after)) continue;
      isNewBuild = true;
      evidence.push(snippet(text, m.index ?? 0, m[0].length));
      break;
    }
  }

  const yearM =
    /\bcompleted\s+(?:in\s+)?(20\d{2})\b/i.exec(text) ??
    /\b(?:built|constructed)\s+(?:in\s+)?(20\d{2})\b/i.exec(text);
  if (yearM) {
    const y = parseInt(yearM[1], 10);
    if (y >= 2000 && y <= new Date().getFullYear() + 2) {
      completionYear = y;
      evidence.push(snippet(text, yearM.index, yearM[0].length));
      if (/\bcompleted\b/i.test(yearM[0]) && y >= 2015) isNewBuild = true;
    }
  }

  // ── Multi-unit development ───────────────────────────────────────────────
  let multiUnitDevelopment = false;
  let unitCount: number | null = null;

  for (const m of text.matchAll(MULTI_UNIT_RE)) {
    if (COULD_BUILD_WINDOW_RE.test(windowBefore(text, m.index ?? 0))) continue;
    const count = parseUnitCount(m[1]);
    if (count == null) continue;
    multiUnitDevelopment = true;
    unitCount = count;
    evidence.push(snippet(text, m.index ?? 0, m[0].length));
    // A built multi-unit offering of townhouses/terraces means the dwelling
    // stock IS townhouses.
    if (/town\s?houses|terrace/i.test(m[2])) dwellingIsTownhouse = true;
    break;
  }

  if (!multiUnitDevelopment) {
    const devRes: RegExp[] = [
      /\bstage\s+\d+\b/i,
      /\b(?:lot|unit)\s+\d+\s+(?:of|in)\b[\s\S]{0,40}\b(?:development|release|complex)\b/i,
      /\bfinal\s+release\b/i,
      /\bonly\s+\d+\s+remaining\b/i,
    ];
    for (const re of devRes) {
      const m = re.exec(text);
      if (m) {
        multiUnitDevelopment = true;
        evidence.push(snippet(text, m.index, m[0].length));
        break;
      }
    }
  }

  if (dwellingIsTownhouse) townhousePotentialOnly = false;

  return {
    dwellingIsTownhouse,
    townhousePotentialOnly,
    isNewBuild,
    completionYear,
    multiUnitDevelopment,
    unitCount,
    evidence,
  };
}

/**
 * True when the marketing copy mentions townhouse/terrace/duplex but the
 * deterministic extractor could classify it neither as "the dwelling IS one"
 * nor as "could build some" — the only case worth escalating to the LLM
 * tie-breaker (listing-claims-llm.ts). Returns false whenever the
 * deterministic extractor already reached a verdict.
 */
export function hasAmbiguousListingSignals(input: ListingClaimsInput): boolean {
  const claims = extractListingClaims(input);
  if (claims.dwellingIsTownhouse || claims.multiUnitDevelopment || claims.isNewBuild) return false;
  if (claims.townhousePotentialOnly) return false;
  const text = [normalise(input.listingTitle), normalise(input.description)]
    .filter(Boolean)
    .join(" | ");
  return [...text.matchAll(TOWNHOUSE_MENTION_RE)].length > 0;
}

export interface RedevelopmentConflictInput {
  claims: ListingClaims;
  /** Build year from council/valuation records (AC GIS property history / propertyvalue.co.nz). */
  councilBuildYear: number | null;
  listingFloorAreaSqm?: number | null;
  councilFloorAreaSqm?: number | null;
  /** Count of LINZ unit-style child addresses ("1/6, 2/6 … 10/6") at the parent address, when probed. */
  linzChildAddressCount?: number | null;
}

export interface RedevelopmentConflictResult {
  suspected: boolean;
  reasons: string[];
}

/**
 * Council-lag detector: the listing claims a new/near-new dwelling (or a
 * townhouse stock) while council records still describe a pre-2000 build on
 * the parcel — the parcel has very likely been demolished and redeveloped, so
 * the recorded land area / CV / build year describe the PRE-development parent
 * site and must not feed subdivision feasibility unflagged.
 */
export function detectRedevelopmentConflict(input: RedevelopmentConflictInput): RedevelopmentConflictResult {
  const { claims, councilBuildYear } = input;
  const reasons: string[] = [];
  const councilSaysOld = councilBuildYear != null && councilBuildYear < 2000;

  if (councilSaysOld && (claims.isNewBuild || (claims.completionYear ?? 0) >= 2015)) {
    reasons.push(
      `listing markets a new build${claims.completionYear ? ` (completed ${claims.completionYear})` : ""} but council records show a ${councilBuildYear} build`,
    );
  }
  if (councilSaysOld && claims.dwellingIsTownhouse) {
    reasons.push(`listing is a townhouse but council records show a ${councilBuildYear} build on this parcel`);
  }
  if (councilSaysOld && claims.multiUnitDevelopment) {
    reasons.push(
      `listing is part of a multi-unit development${claims.unitCount ? ` (~${claims.unitCount} units)` : ""} but council records show a ${councilBuildYear} build`,
    );
  }
  if ((input.linzChildAddressCount ?? 0) >= 2) {
    reasons.push(`LINZ lists ${input.linzChildAddressCount} unit-style child addresses at this parent address`);
  }

  // Secondary corroboration only — a floor-area mismatch alone is too noisy
  // (extensions, bad scrapes) to flag a redevelopment by itself.
  if (reasons.length > 0) {
    const lf = input.listingFloorAreaSqm ?? null;
    const cf = input.councilFloorAreaSqm ?? null;
    if (lf != null && cf != null && lf > 0 && cf > 0) {
      const diff = Math.abs(lf - cf) / Math.max(lf, cf);
      if (diff > 0.4) reasons.push(`listing floor area ${lf}m² differs >40% from recorded ${cf}m²`);
    }
  }

  return { suspected: reasons.length > 0, reasons };
}
