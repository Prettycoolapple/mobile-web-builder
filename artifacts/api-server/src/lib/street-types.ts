/**
 * Canonical NZ street-type normalisation, shared by every address-matching
 * comparator so the same address typed with different street-type forms
 * ("19 Chatsworth Cres" vs "19 Chatsworth Crescent", "8 Hampton Dr" vs
 * "8 Hampton Drive") collapses to one key and matches.
 *
 * Used by `streetKey` (built-environment-context.ts) and `normaliseLrsAddress`
 * / `lrsAddressLooksExact` (linz.ts). NOT used by `normaliseAddressKey`
 * (address-key.ts) — that is the persisted property_cache key and is left
 * untouched to avoid invalidating existing cache rows.
 *
 * Ambiguity rule: the bare token "st" is intentionally NOT auto-expanded in
 * free text because it means BOTH "Street" (suffix) and "Saint" (suburb
 * prefix, e.g. "St Heliers"). Whole-string callers must keep their own
 * Saint/St handling. The trailing-token helper DOES expand "st"→"street"
 * because in a parsed street-name (locality already split off) a trailing
 * "st" is unambiguously the street type.
 */

/**
 * Every common NZ street type plus its short form(s), mapped to one canonical
 * full word. Genuinely ambiguous bare abbreviations are deliberately omitted:
 *   - "cr"  → Crescent OR Court
 *   - "gr"  → Grove OR Green
 *   - "pt"  → Point (also a suburb prefix: Pt Chevalier)
 *   - "st"  → Street OR Saint  (handled positionally, see below)
 */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  street: "street", str: "street",
  road: "road", rd: "road",
  avenue: "avenue", ave: "avenue", av: "avenue",
  crescent: "crescent", cres: "crescent", cresc: "crescent",
  drive: "drive", dr: "drive", drv: "drive",
  lane: "lane", ln: "lane",
  place: "place", pl: "place",
  terrace: "terrace", tce: "terrace", terr: "terrace", ter: "terrace",
  parade: "parade", pde: "parade",
  boulevard: "boulevard", blvd: "boulevard", bvd: "boulevard",
  highway: "highway", hwy: "highway",
  way: "way",
  close: "close", cl: "close",
  court: "court", ct: "court", crt: "court",
  grove: "grove", gve: "grove", grv: "grove",
  quay: "quay", qy: "quay",
  esplanade: "esplanade", esp: "esplanade",
  heights: "heights", hts: "heights",
  rise: "rise",
  view: "view", vw: "view",
  ridge: "ridge", rdg: "ridge",
  mews: "mews",
  walk: "walk", wlk: "walk",
  track: "track", trk: "track",
  square: "square", sq: "square",
  promenade: "promenade", prom: "promenade",
  circle: "circle", cir: "circle",
  green: "green", grn: "green",
  grange: "grange",
  gardens: "gardens", gdns: "gardens", gdn: "gardens",
  glade: "glade",
  glen: "glen",
  loop: "loop",
  strand: "strand",
  vista: "vista",
  cove: "cove",
  bay: "bay",
  mall: "mall",
  row: "row",
  plaza: "plaza", plz: "plaza",
  crest: "crest",
  downs: "downs",
  edge: "edge",
  end: "end",
};

/** Trailing-position-only aliases that are ambiguous in free text but safe as
 *  the last token of an already-parsed street name. */
const TRAILING_ONLY_ALIAS: Record<string, string> = {
  st: "street",
};

/** Canonical full words for street types — used to recognise/ignore a
 *  street-type token after normalisation. */
export const STREET_TYPE_WORDS: ReadonlySet<string> = new Set(Object.values(ALIAS_TO_CANONICAL));

/** Canonical full form for a single street-type token, or null if not one. */
export function canonicalStreetType(token: string): string | null {
  return ALIAS_TO_CANONICAL[token.toLowerCase()] ?? null;
}

/**
 * Canonicalise the trailing street-type token of an already-parsed street NAME
 * (locality must already be split off). Safe to expand "st"→"street" here.
 * Returns a lowercase, single-spaced string.
 */
export function canonicaliseTrailingStreetType(streetName: string): string {
  const cleaned = streetName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!cleaned) return cleaned;
  const parts = cleaned.split(" ");
  const last = parts[parts.length - 1];
  const canonical = ALIAS_TO_CANONICAL[last] ?? TRAILING_ONLY_ALIAS[last] ?? null;
  if (canonical) parts[parts.length - 1] = canonical;
  return parts.join(" ");
}

/**
 * Canonicalise every whole-word street-type token in a free-form address
 * string to its canonical full word. The bare token "st" is left untouched
 * (ambiguous Street/Saint); callers keep their own Saint handling. Operates on
 * word boundaries, so run BEFORE stripping punctuation.
 */
export function canonicaliseStreetTypesInText(text: string): string {
  return text.replace(/\b[a-z]+\b/gi, (word) => {
    const lower = word.toLowerCase();
    if (lower === "st" || lower === "str") return word; // ambiguous with Saint — leave as-is
    return ALIAS_TO_CANONICAL[lower] ?? word;
  });
}
