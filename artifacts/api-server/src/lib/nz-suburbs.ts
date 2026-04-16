/**
 * Comprehensive list of NZ suburb/place names for intent detection and suburb extraction.
 * Used by both the regex fallback intent detector and the parseDiscoverParams helper.
 *
 * Keep entries lowercase. Entries are checked via String.includes() so longer/more
 * specific names should come first where ambiguity exists.
 */
export const NZ_SUBURBS: string[] = [
  // ─── Auckland City ───────────────────────────────────────────────────────────
  "herne bay", "grey lynn", "ponsonby", "parnell", "westmere", "kingsland",
  "sandringham", "eden terrace", "grafton", "newmarket", "waterview",
  "blockhouse bay", "freemans bay", "arch hill", "auckland central",
  "remuera", "epsom", "mt eden", "mount eden", "newton",

  // ─── Albert-Eden ─────────────────────────────────────────────────────────────
  "mt albert", "mount albert", "mt roskill", "mount roskill", "avondale",
  "three kings", "owairaka",

  // ─── Orakei / Eastern ────────────────────────────────────────────────────────
  "st heliers", "saint heliers", "kohimarama", "mission bay", "glendowie",
  "meadowbank", "st johns", "saint johns", "ellerslie", "remuera east",
  "glen innes", "panmure", "tamaki", "pt england", "point england",

  // ─── Maungakiekie-Tāmaki ─────────────────────────────────────────────────────
  "onehunga", "penrose", "royal oak", "mt wellington", "mount wellington", "otahuhu",

  // ─── Henderson-Massey / West ──────────────────────────────────────────────────
  "new lynn", "titirangi", "henderson", "glen eden", "massey", "ranui",
  "swanson", "westgate", "royal heights", "te atatu peninsula", "te atatu south",
  "te atatu",

  // ─── Howick ──────────────────────────────────────────────────────────────────
  "howick", "pakuranga", "botany downs", "botany", "east tamaki", "flat bush",
  "dannemora", "bucklands beach", "buckland beach", "beachlands", "half moon bay",
  "cockle bay", "highland park", "shelly park", "sunnyhills", "clover park",
  "somerville", "golflands", "ormiston", "windsor park",

  // ─── Upper Harbour / North Shore ─────────────────────────────────────────────
  "albany", "hobsonville", "whenuapai", "takapuna", "devonport", "northcote",
  "glenfield", "milford", "browns bay", "birkenhead", "hillcrest", "beach haven",
  "birkdale", "forrest hill", "rothesay bay", "torbay", "mairangi bay", "long bay",
  "unsworth heights", "schnapper rock", "coatesville", "greenhithe", "murrays bay",
  "pinehill", "oteha", "rosedale", "northcross", "campbells bay", "castor bay",
  "stanley bay", "belmont",

  // ─── Hibiscus Coast ──────────────────────────────────────────────────────────
  "orewa", "whangaparaoa", "gulf harbour", "stanmore bay", "red beach",
  "arkles bay", "manly",

  // ─── South Auckland ──────────────────────────────────────────────────────────
  "mangere bridge", "mangere east", "mangere", "manurewa", "papatoetoe",
  "papakura", "clendon park", "weymouth", "takanini", "favona", "wattle downs",
  "randwick park", "rowandale",

  // ─── Franklin ────────────────────────────────────────────────────────────────
  "pukekohe", "waiuku", "tuakau", "pokeno", "clarks beach", "karaka", "drury",

  // ─── Rodney ──────────────────────────────────────────────────────────────────
  "silverdale", "helensville", "kumeu", "huapai", "warkworth", "wellsford",
  "snells beach", "mangawhai",

  // ─── Wellington / Kapiti / Wairarapa ─────────────────────────────────────────
  "karori", "johnsonville", "newlands", "khandallah", "ngaio", "crofton downs",
  "hataitai", "kilbirnie", "miramar", "island bay", "brooklyn", "te aro",
  "thorndon", "aro valley", "newtown", "berhampore", "tawa", "churton park",
  "grenada village", "seatoun", "eastbourne", "petone", "naenae",
  "stokes valley", "wainuiomata", "lower hutt", "upper hutt", "silverstream",
  "porirua", "titahi bay", "whitby", "paremata", "paraparaumu", "waikanae",
  "raumati", "paekakariki", "masterton", "wellington",

  // ─── Canterbury / Christchurch ────────────────────────────────────────────────
  "fendalton", "merivale", "papanui", "riccarton", "st albans", "saint albans",
  "shirley", "burnside", "ilam", "sockburn", "halswell", "hornby", "addington",
  "sydenham", "spreydon", "beckenham", "cashmere", "hillmorton", "opawa",
  "wainoni", "aranui", "linwood", "bromley", "woolston", "sumner", "lyttelton",
  "diamond harbour", "rolleston", "lincoln", "prebbleton", "rangiora", "kaiapoi",
  "christchurch",

  // ─── Waikato / Hamilton ───────────────────────────────────────────────────────
  "frankton", "rototuna", "flagstaff", "chartwell", "te rapa", "cambridge",
  "te awamutu", "huntly", "ngaruawahia", "raglan", "hamilton",

  // ─── Bay of Plenty ───────────────────────────────────────────────────────────
  "mount maunganui", "mt maunganui", "papamoa", "bethlehem", "welcome bay",
  "tauranga", "rotorua", "whakatane", "katikati", "te puke",

  // ─── Northland ───────────────────────────────────────────────────────────────
  "whangarei", "dargaville", "kerikeri", "kaitaia", "paihia",

  // ─── Hawke's Bay ─────────────────────────────────────────────────────────────
  "napier", "hastings", "havelock north",

  // ─── Manawatu-Whanganui ───────────────────────────────────────────────────────
  "palmerston north", "whanganui", "levin",

  // ─── Taranaki ────────────────────────────────────────────────────────────────
  "new plymouth",

  // ─── Otago / Queenstown ───────────────────────────────────────────────────────
  "mosgiel", "st kilda", "saint kilda", "north dunedin", "south dunedin",
  "queenstown", "arrowtown", "wanaka", "dunedin",

  // ─── Nelson / Marlborough ────────────────────────────────────────────────────
  "nelson", "richmond", "blenheim",

  // ─── Southland ───────────────────────────────────────────────────────────────
  "invercargill",

  // ─── Gisborne ────────────────────────────────────────────────────────────────
  "gisborne",
];

/**
 * Normalise abbreviations to canonical form for matching.
 */
export function normaliseSuburbText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/\bmt\b\.?/g, "mt")
    .replace(/\bst\b\.?/g, "st")
    .replace(/\bpt\b\.?/g, "pt")
    .replace(/\bmount\b/g, "mt")
    .replace(/\bsaint\b/g, "st")
    .replace(/\bpoint\b/g, "pt")
    .replace(/\s+/g, " ");
}

/**
 * Try to find a known NZ suburb within arbitrary text.
 * Returns the matched suburb name (normalised, as it appears in NZ_SUBURBS) or null.
 */
export function findSuburbInText(text: string): string | null {
  const normalised = normaliseSuburbText(text);

  // Check longest entries first so "bucklands beach" beats "beach"
  const sorted = [...NZ_SUBURBS].sort((a, b) => b.length - a.length);
  for (const s of sorted) {
    if (normalised.includes(s)) return s;
  }

  // Try with/without trailing 's' (buckland beach ↔ bucklands beach)
  for (const s of sorted) {
    if (normalised.includes(s + "s") || (s.endsWith("s") && normalised.includes(s.slice(0, -1)))) {
      return s;
    }
  }

  return null;
}

/**
 * Return true if the text appears to be purely a suburb/location name
 * (short, no verb or question words, matches a known suburb).
 */
export function looksLikeSuburbOnly(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.split(/\s+/).length > 5) return false;
  if (/\b(is|are|was|were|what|where|how|find|show|search|properties|property|house|land|section)\b/i.test(trimmed)) return false;
  return findSuburbInText(trimmed) !== null;
}

/**
 * Last-resort suburb extractor: pull the phrase following "in/near/around/at" from
 * arbitrary text and return it as a raw suburb string, even if it doesn't appear in
 * the NZ_SUBURBS list. This allows the scraper's dynamic fallback to attempt a
 * keyword search for any NZ location, not just known entries.
 *
 * Returns null if no location phrase can be confidently extracted.
 */
export function extractLocationPhrase(text: string): string | null {
  // Try location phrases after positional prepositions
  const m = text.match(
    /\b(?:in|near|around|at|for\s+properties\s+in|properties\s+in|homes?\s+in|listings?\s+in|market\s+in)\s+([A-Za-z][A-Za-z\s''-]{2,30})(?:\s+under|\s+below|\s+above|\s+around|\s+(?:for\s+)?(?:sale|rent)|\?|[.,!]|$)/i,
  );
  if (m) {
    const phrase = m[1].trim().toLowerCase();
    // Reject generic words that aren't suburbs
    if (/^(the|a|an|my|your|our|any|all|some|new|more|properties|area|region|place|suburb|city|town|country)$/i.test(phrase)) return null;
    if (phrase.split(/\s+/).length > 5) return null;
    return phrase;
  }
  return null;
}
