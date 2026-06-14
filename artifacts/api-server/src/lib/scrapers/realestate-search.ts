import { logger } from "../logger";
import { fetchWithScrapingBee } from "./scrapingbee";
import { launchBrowser, newStealthPage, withBrowserSlot } from "./browser";
import { extractBedsBaths, type ListingResult } from "./oneroof";
import { searchListingsByName } from "./realestate-api";

/**
 * Maps suburb name → { slug, district, region } for realestate.co.nz URL construction.
 *
 * realestate.co.nz URL format:
 *   /residential/sale/{region}/{district}/{suburb-slug}
 *
 * Each entry may include `altDistricts` — alternative district slugs to try if the
 * primary URL returns no listings.
 */
const SUBURB_SLUG_MAP: Record<string, { slug: string; district: string; region: string; altDistricts?: string[] }> = {
  // ─── Auckland City ───────────────────────────────────────────────────────────
  "remuera":           { slug: "remuera",          district: "auckland-city",          region: "auckland" },
  "epsom":             { slug: "epsom",             district: "auckland-city",          region: "auckland" },
  "mt eden":           { slug: "mount-eden",        district: "auckland-city",          region: "auckland" },
  "mount eden":        { slug: "mount-eden",        district: "auckland-city",          region: "auckland" },
  "grey lynn":         { slug: "grey-lynn",         district: "auckland-city",          region: "auckland" },
  "ponsonby":          { slug: "ponsonby",          district: "auckland-city",          region: "auckland" },
  "parnell":           { slug: "parnell",           district: "auckland-city",          region: "auckland" },
  "herne bay":         { slug: "herne-bay",         district: "auckland-city",          region: "auckland" },
  "westmere":          { slug: "westmere",          district: "auckland-city",          region: "auckland" },
  "kingsland":         { slug: "kingsland",         district: "auckland-city",          region: "auckland" },
  "sandringham":       { slug: "sandringham",       district: "auckland-city",          region: "auckland" },
  "eden terrace":      { slug: "eden-terrace",      district: "auckland-city",          region: "auckland" },
  "grafton":           { slug: "grafton",           district: "auckland-city",          region: "auckland" },
  "newmarket":         { slug: "newmarket",         district: "auckland-city",          region: "auckland" },
  "pt chevalier":      { slug: "point-chevalier",   district: "auckland-city",          region: "auckland" },
  "point chevalier":   { slug: "point-chevalier",   district: "auckland-city",          region: "auckland" },
  "waterview":         { slug: "waterview",         district: "auckland-city",          region: "auckland" },
  "blockhouse bay":    { slug: "blockhouse-bay",    district: "auckland-city",          region: "auckland" },
  "freemans bay":      { slug: "freemans-bay",      district: "auckland-city",          region: "auckland" },
  "newton":            { slug: "newton",            district: "auckland-city",          region: "auckland" },
  "cbd":               { slug: "auckland-central",  district: "auckland-city",          region: "auckland" },
  "auckland central":  { slug: "auckland-central",  district: "auckland-city",          region: "auckland" },
  "city centre":       { slug: "auckland-central",  district: "auckland-city",          region: "auckland" },
  "arch hill":         { slug: "arch-hill",         district: "auckland-city",          region: "auckland" },
  "grey's avenue":     { slug: "greys-avenue",      district: "auckland-city",          region: "auckland" },

  // ─── Albert-Eden ─────────────────────────────────────────────────────────────
  "mt albert":         { slug: "mount-albert",      district: "albert-eden",            region: "auckland", altDistricts: ["auckland-city"] },
  "mount albert":      { slug: "mount-albert",      district: "albert-eden",            region: "auckland", altDistricts: ["auckland-city"] },
  "mt roskill":        { slug: "mount-roskill",     district: "albert-eden",            region: "auckland", altDistricts: ["auckland-city"] },
  "mount roskill":     { slug: "mount-roskill",     district: "albert-eden",            region: "auckland", altDistricts: ["auckland-city"] },
  "avondale":          { slug: "avondale",          district: "albert-eden",            region: "auckland", altDistricts: ["auckland-city"] },
  "three kings":       { slug: "three-kings",       district: "albert-eden",            region: "auckland" },
  "owairaka":          { slug: "owairaka",          district: "albert-eden",            region: "auckland" },

  // ─── Orakei ──────────────────────────────────────────────────────────────────
  "st heliers":        { slug: "st-heliers",        district: "orakei",                 region: "auckland" },
  "saint heliers":     { slug: "st-heliers",        district: "orakei",                 region: "auckland" },
  "kohimarama":        { slug: "kohimarama",        district: "orakei",                 region: "auckland" },
  "mission bay":       { slug: "mission-bay",       district: "orakei",                 region: "auckland" },
  "orakei":            { slug: "orakei",            district: "orakei",                 region: "auckland", altDistricts: ["auckland-city"] },
  "glendowie":         { slug: "glendowie",         district: "orakei",                 region: "auckland" },
  "meadowbank":        { slug: "meadowbank",        district: "orakei",                 region: "auckland" },
  "st johns":          { slug: "saint-johns",       district: "orakei",                 region: "auckland" },
  "saint johns":       { slug: "saint-johns",       district: "orakei",                 region: "auckland" },
  "ellerslie":         { slug: "ellerslie",         district: "orakei",                 region: "auckland", altDistricts: ["auckland-city"] },
  "remuera east":      { slug: "remuera",           district: "orakei",                 region: "auckland" },

  // ─── Tāmaki / Eastern ────────────────────────────────────────────────────────
  "glen innes":        { slug: "glen-innes",        district: "auckland-city",          region: "auckland", altDistricts: ["orakei", "tamaki"] },
  "panmure":           { slug: "panmure",           district: "auckland-city",          region: "auckland", altDistricts: ["maungakiekie-tamaki"] },
  "tamaki":            { slug: "tamaki",            district: "auckland-city",          region: "auckland" },
  "pt england":        { slug: "point-england",     district: "auckland-city",          region: "auckland" },
  "point england":     { slug: "point-england",     district: "auckland-city",          region: "auckland" },

  // ─── Maungakiekie-Tāmaki ─────────────────────────────────────────────────────
  "onehunga":          { slug: "onehunga",          district: "maungakiekie-tamaki",    region: "auckland", altDistricts: ["auckland-city"] },
  "penrose":           { slug: "penrose",           district: "maungakiekie-tamaki",    region: "auckland", altDistricts: ["auckland-city"] },
  "royal oak":         { slug: "royal-oak",         district: "maungakiekie-tamaki",    region: "auckland" },
  "mt wellington":     { slug: "mount-wellington",  district: "maungakiekie-tamaki",    region: "auckland", altDistricts: ["auckland-city"] },
  "mount wellington":  { slug: "mount-wellington",  district: "maungakiekie-tamaki",    region: "auckland", altDistricts: ["auckland-city"] },
  "otahuhu":           { slug: "otahuhu",           district: "maungakiekie-tamaki",    region: "auckland" },

  // ─── Henderson-Massey ────────────────────────────────────────────────────────
  "new lynn":          { slug: "new-lynn",          district: "henderson-massey",       region: "auckland" },
  "titirangi":         { slug: "titirangi",         district: "henderson-massey",       region: "auckland" },
  "henderson":         { slug: "henderson",         district: "henderson-massey",       region: "auckland" },
  "glen eden":         { slug: "glen-eden",         district: "henderson-massey",       region: "auckland" },
  "massey":            { slug: "massey",            district: "henderson-massey",       region: "auckland" },
  "ranui":             { slug: "ranui",             district: "henderson-massey",       region: "auckland" },
  "swanson":           { slug: "swanson",           district: "henderson-massey",       region: "auckland" },
  "westgate":          { slug: "westgate",          district: "henderson-massey",       region: "auckland" },
  "royal heights":     { slug: "royal-heights",     district: "henderson-massey",       region: "auckland" },
  "te atatu":          { slug: "te-atatu-peninsula",district: "henderson-massey",       region: "auckland" },
  "te atatu peninsula":{ slug: "te-atatu-peninsula",district: "henderson-massey",       region: "auckland" },
  "te atatu south":    { slug: "te-atatu-south",    district: "henderson-massey",       region: "auckland" },

  // ─── Howick ──────────────────────────────────────────────────────────────────
  "howick":            { slug: "howick",            district: "howick",                 region: "auckland" },
  "pakuranga":         { slug: "pakuranga",         district: "howick",                 region: "auckland" },
  "botany":            { slug: "botany-downs",      district: "howick",                 region: "auckland" },
  "botany downs":      { slug: "botany-downs",      district: "howick",                 region: "auckland" },
  "east tamaki":       { slug: "east-tamaki",       district: "howick",                 region: "auckland" },
  "flat bush":         { slug: "flat-bush",         district: "howick",                 region: "auckland" },
  "dannemora":         { slug: "dannemora",         district: "howick",                 region: "auckland" },
  "bucklands beach":   { slug: "bucklands-beach",   district: "howick",                 region: "auckland" },
  "buckland beach":    { slug: "bucklands-beach",   district: "howick",                 region: "auckland" },
  "beachlands":        { slug: "beachlands",        district: "howick",                 region: "auckland" },
  "half moon bay":     { slug: "half-moon-bay",     district: "howick",                 region: "auckland" },
  "cockle bay":        { slug: "cockle-bay",        district: "howick",                 region: "auckland" },
  "mellons bay":       { slug: "mellons-bay",       district: "howick",                 region: "auckland" },
  "highland park":     { slug: "highland-park",     district: "howick",                 region: "auckland" },
  "shelly park":       { slug: "shelly-park",       district: "howick",                 region: "auckland" },
  "sunnyhills":        { slug: "sunnyhills",        district: "howick",                 region: "auckland" },
  "clover park":       { slug: "clover-park",       district: "howick",                 region: "auckland" },
  "somerville":        { slug: "somerville",        district: "howick",                 region: "auckland" },
  "golflands":         { slug: "golflands",         district: "howick",                 region: "auckland" },
  "ormiston":          { slug: "ormiston",          district: "howick",                 region: "auckland" },
  "windsor park":      { slug: "windsor-park",      district: "howick",                 region: "auckland" },

  // ─── Upper Harbour / North Shore ─────────────────────────────────────────────
  "albany":            { slug: "albany",            district: "upper-harbour",          region: "auckland" },
  "hobsonville":       { slug: "hobsonville",       district: "upper-harbour",          region: "auckland" },
  "whenuapai":         { slug: "whenuapai",         district: "upper-harbour",          region: "auckland" },
  "takapuna":          { slug: "takapuna",          district: "devonport-takapuna",     region: "auckland" },
  "devonport":         { slug: "devonport",         district: "devonport-takapuna",     region: "auckland" },
  "northcote":         { slug: "northcote",         district: "kaipatiki",              region: "auckland" },
  "glenfield":         { slug: "glenfield",         district: "kaipatiki",              region: "auckland" },
  "milford":           { slug: "milford",           district: "devonport-takapuna",     region: "auckland" },
  "browns bay":        { slug: "browns-bay",        district: "hibiscus-and-bays",      region: "auckland" },
  "birkenhead":        { slug: "birkenhead",        district: "kaipatiki",              region: "auckland" },
  "hillcrest":         { slug: "hillcrest",         district: "kaipatiki",              region: "auckland" },
  "beach haven":       { slug: "beach-haven",       district: "kaipatiki",              region: "auckland" },
  "birkdale":          { slug: "birkdale",          district: "kaipatiki",              region: "auckland" },
  "forrest hill":      { slug: "forrest-hill",      district: "devonport-takapuna",     region: "auckland" },
  "rothesay bay":      { slug: "rothesay-bay",      district: "hibiscus-and-bays",      region: "auckland" },
  "torbay":            { slug: "torbay",            district: "hibiscus-and-bays",      region: "auckland" },
  "mairangi bay":      { slug: "mairangi-bay",      district: "hibiscus-and-bays",      region: "auckland" },
  "long bay":          { slug: "long-bay",          district: "hibiscus-and-bays",      region: "auckland" },
  "unsworth heights":  { slug: "unsworth-heights",  district: "upper-harbour",          region: "auckland" },
  "schnapper rock":    { slug: "schnapper-rock",    district: "upper-harbour",          region: "auckland" },
  "coatesville":       { slug: "coatesville",       district: "upper-harbour",          region: "auckland" },
  "lucas heights":     { slug: "lucas-heights",     district: "upper-harbour",          region: "auckland" },
  "greenhithe":        { slug: "greenhithe",        district: "upper-harbour",          region: "auckland" },
  "murrays bay":       { slug: "murrays-bay",       district: "hibiscus-and-bays",      region: "auckland" },
  "pinehill":          { slug: "pinehill",          district: "hibiscus-and-bays",      region: "auckland" },
  "oteha":             { slug: "oteha",             district: "upper-harbour",          region: "auckland" },
  "rosedale":          { slug: "rosedale",          district: "upper-harbour",          region: "auckland" },
  "northcross":        { slug: "northcross",        district: "hibiscus-and-bays",      region: "auckland" },
  "campbells bay":     { slug: "campbells-bay",     district: "hibiscus-and-bays",      region: "auckland" },
  "castor bay":        { slug: "castor-bay",        district: "devonport-takapuna",     region: "auckland" },
  "stanley bay":       { slug: "stanley-bay",       district: "devonport-takapuna",     region: "auckland" },
  "belmont":           { slug: "belmont",           district: "devonport-takapuna",     region: "auckland" },

  // ─── Hibiscus Coast ──────────────────────────────────────────────────────────
  "orewa":             { slug: "orewa",             district: "hibiscus-and-bays",      region: "auckland" },
  "whangaparaoa":      { slug: "whangaparaoa",      district: "hibiscus-and-bays",      region: "auckland" },
  "gulf harbour":      { slug: "gulf-harbour",      district: "hibiscus-and-bays",      region: "auckland" },
  "stanmore bay":      { slug: "stanmore-bay",      district: "hibiscus-and-bays",      region: "auckland" },
  "red beach":         { slug: "red-beach",         district: "hibiscus-and-bays",      region: "auckland" },
  "arkles bay":        { slug: "arkles-bay",        district: "hibiscus-and-bays",      region: "auckland" },
  "manly":             { slug: "manly",             district: "hibiscus-and-bays",      region: "auckland" },

  // ─── South Auckland ──────────────────────────────────────────────────────────
  "mangere":           { slug: "mangere",           district: "manurewa-papakura",      region: "auckland", altDistricts: ["mangere-otahuhu"] },
  "mangere bridge":    { slug: "mangere-bridge",    district: "mangere-otahuhu",        region: "auckland" },
  "mangere east":      { slug: "mangere-east",      district: "mangere-otahuhu",        region: "auckland" },
  "manurewa":          { slug: "manurewa",          district: "manurewa-papakura",      region: "auckland" },
  "papatoetoe":        { slug: "papatoetoe",        district: "manurewa-papakura",      region: "auckland" },
  "papakura":          { slug: "papakura",          district: "manurewa-papakura",      region: "auckland" },
  "clendon park":      { slug: "clendon-park",      district: "manurewa-papakura",      region: "auckland" },
  "weymouth":          { slug: "weymouth",          district: "manurewa-papakura",      region: "auckland" },
  "takanini":          { slug: "takanini",          district: "manurewa-papakura",      region: "auckland" },
  "favona":            { slug: "favona",            district: "mangere-otahuhu",        region: "auckland" },
  "wattle downs":      { slug: "wattle-downs",      district: "manurewa-papakura",      region: "auckland" },
  "randwick park":     { slug: "randwick-park",     district: "manurewa-papakura",      region: "auckland" },
  "rowandale":         { slug: "rowandale",         district: "manurewa-papakura",      region: "auckland" },

  // ─── Franklin ────────────────────────────────────────────────────────────────
  "pukekohe":          { slug: "pukekohe",          district: "franklin",               region: "auckland" },
  "waiuku":            { slug: "waiuku",            district: "franklin",               region: "auckland" },
  "tuakau":            { slug: "tuakau",            district: "franklin",               region: "auckland" },
  "pokeno":            { slug: "pokeno",            district: "franklin",               region: "auckland" },
  "clarks beach":      { slug: "clarks-beach",      district: "franklin",               region: "auckland" },
  "karaka":            { slug: "karaka",            district: "franklin",               region: "auckland" },
  "drury":             { slug: "drury",             district: "manurewa-papakura",      region: "auckland" },

  // ─── Rodney ──────────────────────────────────────────────────────────────────
  "silverdale":        { slug: "silverdale",        district: "rodney",                 region: "auckland" },
  "helensville":       { slug: "helensville",       district: "rodney",                 region: "auckland" },
  "kumeu":             { slug: "kumeu",             district: "rodney",                 region: "auckland" },
  "huapai":            { slug: "huapai",            district: "rodney",                 region: "auckland" },
  "warkworth":         { slug: "warkworth",         district: "rodney",                 region: "auckland" },
  "wellsford":         { slug: "wellsford",         district: "rodney",                 region: "auckland" },
  "snells beach":      { slug: "snells-beach",      district: "rodney",                 region: "auckland" },
  "algies bay":        { slug: "algies-bay",        district: "rodney",                 region: "auckland" },
  "mahurangi":         { slug: "mahurangi",         district: "rodney",                 region: "auckland" },
  "parakai":           { slug: "parakai",           district: "rodney",                 region: "auckland" },

  // ─── Wellington ──────────────────────────────────────────────────────────────
  "wellington":        { slug: "wellington",        district: "wellington-city",        region: "wellington" },
  "karori":            { slug: "karori",            district: "wellington-city",        region: "wellington" },
  "johnsonville":      { slug: "johnsonville",      district: "wellington-city",        region: "wellington" },
  "newlands":          { slug: "newlands",          district: "wellington-city",        region: "wellington" },
  "khandallah":        { slug: "khandallah",        district: "wellington-city",        region: "wellington" },
  "ngaio":             { slug: "ngaio",             district: "wellington-city",        region: "wellington" },
  "crofton downs":     { slug: "crofton-downs",     district: "wellington-city",        region: "wellington" },
  "hataitai":          { slug: "hataitai",          district: "wellington-city",        region: "wellington" },
  "kilbirnie":         { slug: "kilbirnie",         district: "wellington-city",        region: "wellington" },
  "miramar":           { slug: "miramar",           district: "wellington-city",        region: "wellington" },
  "island bay":        { slug: "island-bay",        district: "wellington-city",        region: "wellington" },
  "brooklyn":          { slug: "brooklyn",          district: "wellington-city",        region: "wellington" },
  "te aro":            { slug: "te-aro",            district: "wellington-city",        region: "wellington" },
  "thorndon":          { slug: "thorndon",          district: "wellington-city",        region: "wellington" },
  "aro valley":        { slug: "aro-valley",        district: "wellington-city",        region: "wellington" },
  "newtown":           { slug: "newtown",           district: "wellington-city",        region: "wellington" },
  "berhampore":        { slug: "berhampore",        district: "wellington-city",        region: "wellington" },
  "tawa":              { slug: "tawa",              district: "wellington-city",        region: "wellington" },
  "churton park":      { slug: "churton-park",      district: "wellington-city",        region: "wellington" },
  "grenada village":   { slug: "grenada-village",   district: "wellington-city",        region: "wellington" },
  "seatoun":           { slug: "seatoun",           district: "wellington-city",        region: "wellington" },
  "eastbourne":        { slug: "eastbourne",        district: "lower-hutt-city",        region: "wellington" },
  "lower hutt":        { slug: "lower-hutt",        district: "lower-hutt-city",        region: "wellington" },
  "petone":            { slug: "petone",            district: "lower-hutt-city",        region: "wellington" },
  "naenae":            { slug: "naenae",            district: "lower-hutt-city",        region: "wellington" },
  "stokes valley":     { slug: "stokes-valley",     district: "lower-hutt-city",        region: "wellington" },
  "wainuiomata":       { slug: "wainuiomata",       district: "lower-hutt-city",        region: "wellington" },
  "upper hutt":        { slug: "upper-hutt",        district: "upper-hutt-city",        region: "wellington" },
  "silverstream":      { slug: "silverstream",      district: "upper-hutt-city",        region: "wellington" },
  "porirua":           { slug: "porirua",           district: "porirua-city",           region: "wellington" },
  "titahi bay":        { slug: "titahi-bay",        district: "porirua-city",           region: "wellington" },
  "whitby":            { slug: "whitby",            district: "porirua-city",           region: "wellington" },
  "paremata":          { slug: "paremata",          district: "porirua-city",           region: "wellington" },
  "paraparaumu":       { slug: "paraparaumu",       district: "kapiti-coast",           region: "wellington" },
  "waikanae":          { slug: "waikanae",          district: "kapiti-coast",           region: "wellington" },
  "raumati":           { slug: "raumati",           district: "kapiti-coast",           region: "wellington" },
  "paekakariki":       { slug: "paekakariki",       district: "kapiti-coast",           region: "wellington" },
  "masterton":         { slug: "masterton",         district: "masterton",              region: "wellington" },

  // ─── Canterbury / Christchurch ────────────────────────────────────────────────
  "christchurch":      { slug: "christchurch",      district: "christchurch-city",      region: "canterbury" },
  "fendalton":         { slug: "fendalton",         district: "christchurch-city",      region: "canterbury" },
  "merivale":          { slug: "merivale",          district: "christchurch-city",      region: "canterbury" },
  "papanui":           { slug: "papanui",           district: "christchurch-city",      region: "canterbury" },
  "riccarton":         { slug: "riccarton",         district: "christchurch-city",      region: "canterbury" },
  "st albans":         { slug: "st-albans",         district: "christchurch-city",      region: "canterbury" },
  "saint albans":      { slug: "st-albans",         district: "christchurch-city",      region: "canterbury" },
  "shirley":           { slug: "shirley",           district: "christchurch-city",      region: "canterbury" },
  "burnside":          { slug: "burnside",          district: "christchurch-city",      region: "canterbury" },
  "ilam":              { slug: "ilam",              district: "christchurch-city",      region: "canterbury" },
  "sockburn":          { slug: "sockburn",          district: "christchurch-city",      region: "canterbury" },
  "halswell":          { slug: "halswell",          district: "christchurch-city",      region: "canterbury" },
  "hornby":            { slug: "hornby",            district: "christchurch-city",      region: "canterbury" },
  "addington":         { slug: "addington",         district: "christchurch-city",      region: "canterbury" },
  "sydenham":          { slug: "sydenham",          district: "christchurch-city",      region: "canterbury" },
  "spreydon":          { slug: "spreydon",          district: "christchurch-city",      region: "canterbury" },
  "beckenham":         { slug: "beckenham",         district: "christchurch-city",      region: "canterbury" },
  "cashmere":          { slug: "cashmere",          district: "christchurch-city",      region: "canterbury" },
  "hillmorton":        { slug: "hillmorton",        district: "christchurch-city",      region: "canterbury" },
  "opawa":             { slug: "opawa",             district: "christchurch-city",      region: "canterbury" },
  "wainoni":           { slug: "wainoni",           district: "christchurch-city",      region: "canterbury" },
  "aranui":            { slug: "aranui",            district: "christchurch-city",      region: "canterbury" },
  "linwood":           { slug: "linwood",           district: "christchurch-city",      region: "canterbury" },
  "bromley":           { slug: "bromley",           district: "christchurch-city",      region: "canterbury" },
  "woolston":          { slug: "woolston",          district: "christchurch-city",      region: "canterbury" },
  "sumner":            { slug: "sumner",            district: "christchurch-city",      region: "canterbury" },
  "lyttelton":         { slug: "lyttelton",         district: "christchurch-city",      region: "canterbury" },
  "diamond harbour":   { slug: "diamond-harbour",   district: "christchurch-city",      region: "canterbury" },
  "rolleston":         { slug: "rolleston",         district: "selwyn",                 region: "canterbury" },
  "lincoln":           { slug: "lincoln",           district: "selwyn",                 region: "canterbury" },
  "prebbleton":        { slug: "prebbleton",        district: "selwyn",                 region: "canterbury" },
  "rangiora":          { slug: "rangiora",          district: "waimakariri",            region: "canterbury" },
  "kaiapoi":           { slug: "kaiapoi",           district: "waimakariri",            region: "canterbury" },

  // ─── Waikato / Hamilton ───────────────────────────────────────────────────────
  "hamilton":          { slug: "hamilton",          district: "hamilton-city",          region: "waikato" },
  "frankton":          { slug: "frankton",          district: "hamilton-city",          region: "waikato" },
  "rototuna":          { slug: "rototuna",          district: "hamilton-city",          region: "waikato" },
  "flagstaff":         { slug: "flagstaff",         district: "hamilton-city",          region: "waikato" },
  "chartwell":         { slug: "chartwell",         district: "hamilton-city",          region: "waikato" },
  "te rapa":           { slug: "te-rapa",           district: "hamilton-city",          region: "waikato" },
  "cambridge":         { slug: "cambridge",         district: "waipa",                  region: "waikato" },
  "te awamutu":        { slug: "te-awamutu",        district: "waipa",                  region: "waikato" },
  "te kauwhata":       { slug: "te-kauwhata",       district: "waikato",                region: "waikato" },
  "huntly":            { slug: "huntly",            district: "waikato",                region: "waikato" },
  "ngaruawahia":       { slug: "ngaruawahia",       district: "waikato",                region: "waikato" },
  "raglan":            { slug: "raglan",            district: "waikato",                region: "waikato" },

  // ─── Bay of Plenty ───────────────────────────────────────────────────────────
  "tauranga":          { slug: "tauranga",          district: "tauranga-city",          region: "bay-of-plenty" },
  "mount maunganui":   { slug: "mount-maunganui",   district: "tauranga-city",          region: "bay-of-plenty" },
  "mt maunganui":      { slug: "mount-maunganui",   district: "tauranga-city",          region: "bay-of-plenty" },
  "papamoa":           { slug: "papamoa",           district: "tauranga-city",          region: "bay-of-plenty" },
  "bethlehem":         { slug: "bethlehem",         district: "tauranga-city",          region: "bay-of-plenty" },
  "welcome bay":       { slug: "welcome-bay",       district: "tauranga-city",          region: "bay-of-plenty" },
  "rotorua":           { slug: "rotorua",           district: "rotorua",                region: "bay-of-plenty" },
  "whakatane":         { slug: "whakatane",         district: "whakatane",              region: "bay-of-plenty" },
  "katikati":          { slug: "katikati",          district: "western-bay-of-plenty",  region: "bay-of-plenty" },
  "te puke":           { slug: "te-puke",           district: "western-bay-of-plenty",  region: "bay-of-plenty" },

  // ─── Northland ───────────────────────────────────────────────────────────────
  "whangarei":         { slug: "whangarei",         district: "whangarei",              region: "northland" },
  "dargaville":        { slug: "dargaville",        district: "kaipara",                region: "northland" },
  "kerikeri":          { slug: "kerikeri",          district: "far-north",              region: "northland" },
  "kaitaia":           { slug: "kaitaia",           district: "far-north",              region: "northland" },
  "paihia":            { slug: "paihia",            district: "far-north",              region: "northland" },
  "mangawhai":         { slug: "mangawhai",         district: "kaipara",                region: "northland" },
  "langs beach":       { slug: "langs-beach",       district: "kaipara",                region: "northland" },

  // ─── Hawke's Bay ─────────────────────────────────────────────────────────────
  "napier":            { slug: "napier",            district: "napier-city",            region: "hawkes-bay" },
  "hastings":          { slug: "hastings",          district: "hastings",               region: "hawkes-bay" },
  "havelock north":    { slug: "havelock-north",    district: "hastings",               region: "hawkes-bay" },

  // ─── Manawatu-Whanganui ───────────────────────────────────────────────────────
  "palmerston north":  { slug: "palmerston-north",  district: "palmerston-north-city",  region: "manawatu-whanganui" },
  "whanganui":         { slug: "whanganui",         district: "whanganui",              region: "manawatu-whanganui" },
  "levin":             { slug: "levin",             district: "horowhenua",             region: "manawatu-whanganui" },

  // ─── Taranaki ────────────────────────────────────────────────────────────────
  "new plymouth":      { slug: "new-plymouth",      district: "new-plymouth",           region: "taranaki" },

  // ─── Otago / Dunedin ─────────────────────────────────────────────────────────
  "dunedin":           { slug: "dunedin",           district: "dunedin-city",           region: "otago" },
  "mosgiel":           { slug: "mosgiel",           district: "dunedin-city",           region: "otago" },
  "st kilda":          { slug: "st-kilda",          district: "dunedin-city",           region: "otago" },
  "saint kilda":       { slug: "st-kilda",          district: "dunedin-city",           region: "otago" },
  "north dunedin":     { slug: "north-dunedin",     district: "dunedin-city",           region: "otago" },
  "south dunedin":     { slug: "south-dunedin",     district: "dunedin-city",           region: "otago" },
  "queenstown":        { slug: "queenstown",        district: "queenstown-lakes",       region: "otago" },
  "arrowtown":         { slug: "arrowtown",         district: "queenstown-lakes",       region: "otago" },
  "wanaka":            { slug: "wanaka",            district: "queenstown-lakes",       region: "otago" },

  // ─── Nelson / Marlborough ────────────────────────────────────────────────────
  "nelson":            { slug: "nelson",            district: "nelson-city",            region: "nelson" },
  "richmond":          { slug: "richmond",          district: "tasman",                 region: "nelson" },
  "blenheim":          { slug: "blenheim",          district: "marlborough",            region: "marlborough" },

  // ─── Southland ───────────────────────────────────────────────────────────────
  "invercargill":      { slug: "invercargill",      district: "invercargill-city",      region: "southland" },

  // ─── Gisborne / East Coast ───────────────────────────────────────────────────
  "gisborne":          { slug: "gisborne",          district: "gisborne",               region: "gisborne" },
};

/**
 * Normalise a suburb string for lookup:
 * - lowercase + trim
 * - expand abbreviations: "mt" → "mount", "pt" → "point", "st" → "saint"
 * - contracts: "mount" → "mt", "point" → "pt", "saint" → "st"
 * Returns a prioritised list of keys to try.
 */
function suburbLookupKeys(suburb: string): string[] {
  const base = suburb.toLowerCase().trim();
  const keys = new Set<string>([base]);

  const expand = base
    .replace(/\bmt\b/g, "mount")
    .replace(/\bpt\b/g, "point")
    .replace(/\bst\b/g, "saint");
  keys.add(expand);

  const contract = base
    .replace(/\bmount\b/g, "mt")
    .replace(/\bpoint\b/g, "pt")
    .replace(/\bsaint\b/g, "st");
  keys.add(contract);

  // Try without trailing 's' (buckland beach → bucklands beach handled by adding 's')
  keys.add(base + "s");
  if (base.endsWith("s")) keys.add(base.slice(0, -1));

  return Array.from(keys);
}

function lookupSuburb(suburb: string): { slug: string; district: string; region: string; altDistricts?: string[] } | undefined {
  for (const key of suburbLookupKeys(suburb)) {
    const found = SUBURB_SLUG_MAP[key];
    if (found) return found;
  }
  return undefined;
}

/**
 * Some users type a Local-Board / district name where the slug map expects an
 * actual suburb. "orakei" is the canonical example — it is a district that
 * contains St Heliers, Kohimarama, Mission Bay, etc. Without this resolver the
 * realestate.co.nz JSON API can't find "orakei" as a suburb, the legacy HTML
 * scraper fires (burning ScrapingBee), and the nearby-suburb fallback runs
 * full strict drains sequentially.
 *
 * Returns the list of child suburb names belonging to the typed district, or
 * `null` if the input is not a district name. Built by inverting SUBURB_SLUG_MAP.
 */
let districtIndexCache: Map<string, string[]> | null = null;
function getDistrictIndex(): Map<string, string[]> {
  if (districtIndexCache) return districtIndexCache;
  const idx = new Map<string, string[]>();
  for (const [suburbKey, info] of Object.entries(SUBURB_SLUG_MAP)) {
    const districtKey = info.district.toLowerCase().trim();
    if (!districtKey || districtKey === suburbKey) continue;
    const list = idx.get(districtKey) ?? [];
    if (!list.includes(suburbKey)) list.push(suburbKey);
    idx.set(districtKey, list);
    // Also index with hyphens swapped for spaces — users type "north shore" not "north-shore".
    const spaced = districtKey.replace(/-/g, " ");
    if (spaced !== districtKey) {
      const spacedList = idx.get(spaced) ?? [];
      if (!spacedList.includes(suburbKey)) spacedList.push(suburbKey);
      idx.set(spaced, spacedList);
    }
  }
  districtIndexCache = idx;
  return idx;
}

// Colloquial directional / "central" area terms are Auckland-context by default:
// NZ users saying "central / east / south / west / north" (and the zh
// 中区/东区/南区/西区/北区) almost always mean Auckland. Each maps to the
// realestate.co.nz Auckland district keys it covers; we expand those to their
// child suburbs so the search stays INSIDE Auckland rather than falling back to
// a NZ-wide keyword search (which previously surfaced Te Puke / Tawa for
// "central"). Districts must match keys used in SUBURB_SLUG_MAP.
const AUCKLAND_DIRECTIONAL_DISTRICTS: Record<"central" | "east" | "south" | "west" | "north", string[]> = {
  central: ["auckland-city", "albert-eden", "maungakiekie-tamaki", "orakei"],
  east:    ["howick", "orakei"],
  south:   ["manurewa-papakura", "mangere-otahuhu", "franklin"],
  west:    ["henderson-massey"],
  north:   ["devonport-takapuna", "kaipatiki", "hibiscus-and-bays", "upper-harbour"],
};

const DIRECTIONAL_AREA_ALIASES: Record<string, keyof typeof AUCKLAND_DIRECTIONAL_DISTRICTS> = {
  "central": "central", "central auckland": "central", "central akl": "central",
  "central suburbs": "central", "auckland central area": "central", "central area": "central",
  "中区": "central", "中區": "central", "中央区": "central", "中央區": "central",
  "奥克兰中区": "central", "奧克蘭中區": "central",
  "east": "east", "east auckland": "east", "eastern auckland": "east", "eastern suburbs": "east",
  "东区": "east", "東區": "east", "奥克兰东区": "east", "奧克蘭東區": "east",
  "south": "south", "south auckland": "south", "southern auckland": "south", "southern suburbs": "south",
  "南区": "south", "南區": "south", "奥克兰南区": "south", "奧克蘭南區": "south",
  "west": "west", "west auckland": "west", "western auckland": "west", "western suburbs": "west",
  "西区": "west", "西區": "west", "奥克兰西区": "west", "奧克蘭西區": "west",
  "north": "north", "north auckland": "north", "north shore": "north", "northshore": "north",
  "the shore": "north", "northern suburbs": "north",
  "北区": "north", "北區": "north", "北岸": "north", "奥克兰北区": "north", "奧克蘭北區": "north", "奥克兰北岸": "north",
};

const DIRECTIONAL_FANOUT_CAP = 12;

/** Resolve a directional / central area term to a capped, district-spread list
 *  of Auckland child suburbs. Returns null when the term is not directional. */
function resolveDirectionalAreaToSuburbs(raw: string): string[] | null {
  const dir = DIRECTIONAL_AREA_ALIASES[raw];
  if (!dir) return null;
  const idx = getDistrictIndex();
  const perDistrict = AUCKLAND_DIRECTIONAL_DISTRICTS[dir].map((d) => idx.get(d) ?? []);
  // Round-robin across the direction's districts so the capped list spreads
  // across the whole direction instead of exhausting one district alphabetically.
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < DIRECTIONAL_FANOUT_CAP; i++) {
    let advanced = false;
    for (const list of perDistrict) {
      const s = list[i];
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
        advanced = true;
        if (out.length >= DIRECTIONAL_FANOUT_CAP) break;
      }
    }
    if (!advanced) break;
  }
  return out.length > 0 ? out : null;
}

/** Detect a directional / central area term anywhere in free text (EN + zh) and
 *  return the canonical Auckland direction key. Used as a discovery fallback so
 *  "中区有什么…" / "what's on sale in central" resolves to Auckland even when the
 *  upstream intent parser didn't extract a suburb. Returns null if none present. */
export function detectDirectionalAreaTerm(text: string): "central" | "east" | "south" | "west" | "north" | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  // Multi-word English aliases and all zh aliases are safe as direct substrings.
  for (const [alias, dir] of Object.entries(DIRECTIONAL_AREA_ALIASES)) {
    if ((alias.includes(" ") || /[一-鿿]/.test(alias)) && lower.includes(alias)) {
      return dir;
    }
  }
  // Bare English direction word — require a word boundary so we don't match
  // "east tamaki" (a real suburb) or "north-facing".
  const m = lower.match(/\b(central|east|south|west|north)\b/);
  if (m && DIRECTIONAL_AREA_ALIASES[m[1]]) return DIRECTIONAL_AREA_ALIASES[m[1]];
  return null;
}

export function resolveDistrictToSuburbs(input: string): string[] | null {
  const raw = input?.toLowerCase().trim();
  if (!raw) return null;
  // Directional / central area terms resolve to Auckland districts. Must run
  // before the leaf-suburb short-circuit (these are not leaf suburbs anyway).
  const directional = resolveDirectionalAreaToSuburbs(raw);
  if (directional) return directional;
  // If the input is itself a leaf suburb, do not fan out — let the existing
  // single-suburb path handle it.
  if (SUBURB_SLUG_MAP[raw]) return null;
  const idx = getDistrictIndex();
  const direct = idx.get(raw);
  if (direct && direct.length > 0) return [...direct];
  // Try the same abbreviation expansion as suburbLookupKeys so "mt eden",
  // "mount eden" both still resolve as suburbs (not districts) but variants
  // like "north shore" / "north-shore" do.
  for (const key of [raw.replace(/\s+/g, "-"), raw.replace(/-/g, " ")]) {
    if (key === raw) continue;
    const hit = idx.get(key);
    if (hit && hit.length > 0) return [...hit];
  }
  return null;
}

/** Test-only: reset the cached district index so test mutations to the map take effect. */
export function _resetDistrictIndexCacheForTests(): void {
  districtIndexCache = null;
}

/**
 * Convert a suburb name to a URL slug: lowercase, spaces → hyphens, strip special chars.
 */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildSearchUrl(
  region: string,
  district: string,
  slug: string,
  minPrice?: number,
  maxPrice?: number,
): string {
  const paramObj: Record<string, string> = { sort: "recent" };
  if (minPrice != null && minPrice > 0) paramObj["priceMin"] = String(minPrice);
  if (maxPrice != null && maxPrice > 0) paramObj["priceMax"] = String(maxPrice);
  const params = new URLSearchParams(paramObj);
  return `https://www.realestate.co.nz/residential/sale/${region}/${district}/${slug}?${params}`;
}

/**
 * Build a NZ-wide keyword search URL for suburbs not in the map.
 * Uses realestate.co.nz's search with a raw suburb query string (not slugified)
 * to maximise matching — e.g. "half moon bay" rather than "half-moon-bay".
 */
function buildFallbackSearchUrl(suburb: string, minPrice?: number, maxPrice?: number): string {
  const paramObj: Record<string, string> = {
    q: suburb.toLowerCase().trim(),
    sort: "recent",
  };
  if (minPrice != null && minPrice > 0) paramObj["priceMin"] = String(minPrice);
  if (maxPrice != null && maxPrice > 0) paramObj["priceMax"] = String(maxPrice);
  const params = new URLSearchParams(paramObj);
  return `https://www.realestate.co.nz/residential/sale?${params}`;
}

function suburbToUrls(
  suburb: string,
  minPrice?: number,
  maxPrice?: number,
): { primary: string; altUrls: string[]; suburbMeta: ReturnType<typeof lookupSuburb>; isFallback: boolean } {
  const mapped = lookupSuburb(suburb);

  if (mapped) {
    const primary = buildSearchUrl(mapped.region, mapped.district, mapped.slug, minPrice, maxPrice);
    const altUrls = (mapped.altDistricts ?? []).map((d) =>
      buildSearchUrl(mapped.region, d, mapped.slug, minPrice, maxPrice),
    );
    return { primary, altUrls, suburbMeta: mapped, isFallback: false };
  }

  // Not in map — use dynamic fallback: try constructing a plausible URL from the suburb name
  // and also try the NZ-wide keyword search as a backup.
  const suburbSlug = toSlug(suburb);
  const guessedUrl = `https://www.realestate.co.nz/residential/sale/new-zealand/${suburbSlug}?sort=recent`;
  const fallbackUrl = buildFallbackSearchUrl(suburb, minPrice, maxPrice);
  return { primary: guessedUrl, altUrls: [fallbackUrl], suburbMeta: undefined, isFallback: true };
}

function parseAddressFromOgTitle(title: string): string | null {
  const m = title.match(/^([^-]+)/);
  if (!m) return null;
  const raw = m[1].trim().replace(/,\s*Auckland City$/, "").replace(/,\s*Auckland$/, "").trim();
  if (raw.length < 5) return null;
  return raw;
}

function parseLandAreaFromOgDesc(desc: string): number | null {
  const m = desc.match(/(\d{3,5})m²/i) || desc.match(/(\d{3,5})\s*sqm/i) || desc.match(/land area[^\d]*(\d+)/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ""), 10);
  return isNaN(n) || n < 50 || n > 50000 ? null : n;
}

function parsePriceFromOgDesc(desc: string): number | null {
  const m = desc.match(/\$([0-9,]+(?:\.[0-9]+)?)\s*(?:m|million|k)?/i);
  if (!m) return null;
  let v = parseFloat(m[1].replace(/,/g, ""));
  const suffix = m[0].toLowerCase();
  if (suffix.includes("million") || suffix.endsWith("m")) v *= 1_000_000;
  else if (suffix.endsWith("k")) v *= 1_000;
  else if (v < 100) v *= 1_000_000;
  return v > 50000 ? Math.round(v) : null;
}

function parseAddressFromSlug(slug: string): string {
  const parts = slug.replace(/^\/?\d+\/residential\/sale\//, "").split("/")[0];
  const words = parts.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(" ").replace(/\b(\d+)\s+([A-Z])/g, "$1 $2");
}

async function fetchListingMeta(url: string, fallbackAddress: string): Promise<ListingResult | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-NZ,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!resp.ok) {
      logger.debug({ url, status: resp.status }, "realestate-search: listing page non-200");
      return null;
    }

    const html = await resp.text();

    const decodeHtml = (s: string) =>
      s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const ogTitle = decodeHtml(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? "");
    const ogDesc = decodeHtml(html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? "");
    const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;

    const address = parseAddressFromOgTitle(ogTitle) ?? fallbackAddress;
    const landArea = parseLandAreaFromOgDesc(ogDesc);
    const explicitPrice = parsePriceFromOgDesc(ogDesc);
    const { bedrooms, bathrooms } = extractBedsBaths(`${ogTitle} ${ogDesc}`);

    if (!address || address.length < 5) return null;

    return {
      address,
      price: explicitPrice,
      priceText: explicitPrice ? `$${explicitPrice.toLocaleString()}` : "Price on application",
      landArea,
      photoUrl: ogImage,
      listingUrl: url,
      zone: null,
      bedrooms,
      bathrooms,
    };
  } catch (err) {
    logger.debug({ url, err: (err as Error).message }, "realestate-search: failed to fetch listing meta");
    return null;
  }
}

export async function fetchListingBatch(
  urls: string[],
  _priceMidpoint?: number,
): Promise<ListingResult[]> {
  const results = await Promise.all(
    urls.map((url) => fetchListingMeta(url, parseAddressFromSlug(url))),
  );
  return results.filter((r): r is ListingResult => r !== null);
}

// Common suburb slug aliases for URL matching
const SUBURB_SLUG_ALIASES: Record<string, string[]> = {
  "st-heliers":       ["saint-heliers", "st-heliers"],
  "saint-heliers":    ["saint-heliers", "st-heliers"],
  "st-johns":         ["saint-johns",   "st-johns"],
  "saint-johns":      ["saint-johns",   "st-johns"],
  "mt-eden":          ["mount-eden",    "mt-eden"],
  "mount-eden":       ["mount-eden",    "mt-eden"],
  "mt-albert":        ["mount-albert",  "mt-albert"],
  "mount-albert":     ["mount-albert",  "mt-albert"],
  "mt-roskill":       ["mount-roskill", "mt-roskill"],
  "mount-roskill":    ["mount-roskill", "mt-roskill"],
  "mt-wellington":    ["mount-wellington", "mt-wellington"],
  "mount-wellington": ["mount-wellington", "mt-wellington"],
  "mt-maunganui":     ["mount-maunganui", "mt-maunganui"],
  "mount-maunganui":  ["mount-maunganui", "mt-maunganui"],
  "glen-innes":       ["glen-innes"],
  "point-england":    ["pt-england",    "point-england"],
  "botany-downs":     ["botany-downs",  "botany"],
  "bucklands-beach":  ["bucklands-beach", "buckland-beach"],
  "st-albans":        ["saint-albans",  "st-albans"],
  "saint-albans":     ["saint-albans",  "st-albans"],
  "st-kilda":         ["saint-kilda",   "st-kilda"],
  "saint-kilda":      ["saint-kilda",   "st-kilda"],
};

function urlMatchesSuburb(urlPath: string, suburbSlug: string): boolean {
  const slugPart = urlPath.replace(/^\/\d+\/residential\/sale\//, "").toLowerCase();
  const aliases = SUBURB_SLUG_ALIASES[suburbSlug] ?? [suburbSlug];
  return aliases.some((alias) => slugPart.includes(alias));
}

export interface RealestateSearchResult {
  firstBatch: ListingResult[];
  remainingListings: ListingResult[];
  totalFound: number;
  source: "realestate.co.nz";
  /** Raw API offset to resume the next window from (incremental pagination). */
  nextOffset: number;
  /** Raw source total for the suburb, when known (null otherwise). */
  totalAvailable: number | null;
  /** True once the suburb's source is genuinely drained (no further windows). */
  done: boolean;
}

function extractListingUrlsFromHtml(
  html: string,
  suburbMeta: { slug: string; district: string; region: string; altDistricts?: string[] } | undefined,
  skipUrls: string[],
  seen: Set<string>,
): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/href="(\/\d+\/residential\/sale\/[^"?#]+)"/g)) {
    const fullUrl = `https://www.realestate.co.nz${m[1]}`;
    if (!seen.has(fullUrl) && !skipUrls.includes(fullUrl) && (!suburbMeta || urlMatchesSuburb(m[1], suburbMeta.slug))) {
      seen.add(fullUrl);
      urls.push(fullUrl);
    }
  }
  return urls;
}

async function fetchSearchPageWithPlaywright(searchUrl: string): Promise<string | null> {
  return withBrowserSlot(async () => {
    let browser;
    try {
      browser = await launchBrowser();
      const { context, page } = await newStealthPage(browser);
      const resp = await page.goto(searchUrl, { timeout: 25000, waitUntil: "domcontentloaded" }).catch(() => null);
      // Wait for the SPA to render listing cards (Ember hydrates async).
      await page.waitForSelector('a[href*="/residential/sale/"]', { timeout: 8000 }).catch(() => {});
      // Small extra settle to let lazy lists fill in
      await page.waitForTimeout(1500);
      const html = await page.content().catch(() => "");
      await context.close().catch(() => {});
      logger.info({ searchUrl, status: resp?.status(), len: html.length }, "realestate-search: Playwright fetched search page");
      return html || null;
    } catch (err) {
      logger.warn({ err: (err as Error).message, searchUrl }, "realestate-search: Playwright fetch failed");
      return null;
    } finally {
      await browser?.close().catch(() => {});
    }
  });
}

async function fetchListingUrlsFromPage(
  searchUrl: string,
  suburbMeta: { slug: string; district: string; region: string; altDistricts?: string[] } | undefined,
  skipUrls: string[],
  seen: Set<string>,
): Promise<string[]> {
  const tryHtml = (html: string, label: string): string[] => {
    const urls = extractListingUrlsFromHtml(html, suburbMeta, skipUrls, seen);
    logger.info({ searchUrl, count: urls.length, source: label }, "realestate-search: extracted listing URLs");
    if (urls.length > 0) return urls;

    // Only do an unfiltered scan when we have no suburb meta to enforce relevance.
    // (When suburbMeta is set, picking up arbitrary "featured" carousel listings from
    // unrelated suburbs would mislead the user — better to show nothing and let the
    // route fall through to the nearby-suburb fallback.)
    if (suburbMeta) return [];

    const allUrls: string[] = [];
    for (const m of html.matchAll(/href="(\/\d+\/residential\/sale\/[^"?#]+)"/g)) {
      const fullUrl = `https://www.realestate.co.nz${m[1]}`;
      if (!seen.has(fullUrl) && !skipUrls.includes(fullUrl)) {
        seen.add(fullUrl);
        allUrls.push(fullUrl);
      }
    }
    if (allUrls.length > 0) {
      logger.info({ searchUrl, count: allUrls.length, source: label }, "realestate-search: extracted unfiltered listing URLs (no suburb meta)");
    }
    return allUrls;
  };

  // realestate.co.nz is a JavaScript-rendered Ember.js SPA.
  // 1) Try ScrapingBee with JS rendering (fastest, no local browser cost).
  const beeHtml = await fetchWithScrapingBee(searchUrl, { render_js: true, premium_proxy: false, wait: 4000 }).catch(() => null);
  if (beeHtml) {
    const urls = tryHtml(beeHtml, "scrapingbee");
    if (urls.length > 0) return urls;
  }

  // 2) ScrapingBee unavailable (e.g. monthly limit reached) or returned no listings —
  //    fall back to local headless Playwright which can also execute the SPA.
  logger.info({ searchUrl }, "realestate-search: trying Playwright fallback");
  const pwHtml = await fetchSearchPageWithPlaywright(searchUrl).catch(() => null);
  if (pwHtml) {
    const urls = tryHtml(pwHtml, "playwright");
    if (urls.length > 0) return urls;
  }

  // 3) Last-ditch plain fetch (won't render JS but cheap; harmless if it returns nothing).
  logger.info({ searchUrl }, "realestate-search: Playwright unavailable, falling back to plain fetch");
  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-NZ,en;q=0.9",
        "Referer": "https://www.realestate.co.nz/",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      logger.warn({ status: resp.status, searchUrl }, "realestate-search: search page returned non-200");
      return [];
    }

    const html = await resp.text();
    return extractListingUrlsFromHtml(html, suburbMeta, skipUrls, seen);
  } catch (err) {
    logger.warn({ err: (err as Error).message, searchUrl }, "realestate-search: plain fetch also failed");
    return [];
  }
}

export async function searchRealEstateListings(params: {
  suburb: string;
  minPrice: number;
  maxPrice: number;
  skipUrls?: string[];
  firstBatchSize?: number;
  includeNegotiation?: boolean;
  fetchAllPages?: boolean;
  maxListings?: number;
  startOffset?: number;
  maxPages?: number;
}): Promise<RealestateSearchResult> {
  const {
    suburb,
    minPrice,
    maxPrice,
    skipUrls = [],
    firstBatchSize = 6,
    includeNegotiation = false,
    fetchAllPages = false,
    maxListings,
    startOffset,
    maxPages,
  } = params;
  // ── PRIMARY: Official JSON API ───────────────────────────────────────────
  // Talk to platform.realestate.co.nz/search/v1 — same API the SPA uses.
  // Authoritative suburb resolution, structured data, no JS rendering required.
  try {
    const apiResult = await searchListingsByName({
      suburbName: suburb,
      minPrice,
      maxPrice,
      firstBatchSize,
      includeNegotiation: true, // include negotiation/POA so they're available; analyse.ts can choose
      skipUrls,
      fetchAllPages,
      maxListings,
      startOffset,
      maxPages,
    });
    if (apiResult.suburbResolved && (apiResult.firstBatch.length + apiResult.remainingListings.length) > 0) {
      logger.info(
        { suburb, resolvedTo: apiResult.suburbResolved.title, firstBatch: apiResult.firstBatch.length, remaining: apiResult.remainingListings.length, total: apiResult.totalFound },
        "realestate-search: served from JSON API",
      );
      return {
        firstBatch: apiResult.firstBatch,
        remainingListings: apiResult.remainingListings,
        totalFound: apiResult.totalFound,
        source: "realestate.co.nz",
        nextOffset: apiResult.nextOffset,
        totalAvailable: apiResult.totalAvailable,
        done: apiResult.done,
      };
    }
    // Empty API result with resolved suburb → genuinely no listings; return early
    // rather than hammering the HTML scraper for the same answer.
    if (apiResult.suburbResolved) {
      logger.info({ suburb, resolvedTo: apiResult.suburbResolved.title }, "realestate-search: API returned no listings for resolved suburb");
      return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz", nextOffset: apiResult.nextOffset, totalAvailable: apiResult.totalAvailable, done: true };
    }
    // Suburb couldn't be resolved → fall through to legacy scraper as a long-shot.
    logger.info({ suburb }, "realestate-search: API could not resolve suburb, falling back to scraper");
  } catch (err) {
    logger.warn({ err: (err as Error).message, suburb }, "realestate-search: API path failed, falling back to scraper");
  }

  // ── FALLBACK: Legacy HTML scraping path ──────────────────────────────────
  const { primary: primaryUrl, altUrls, suburbMeta, isFallback } = suburbToUrls(suburb, minPrice, maxPrice);

  logger.info({ suburb, searchUrl: primaryUrl, isFallback }, "realestate-search: fetching search results page");

  const seen = new Set<string>();
  let allListingUrls: string[] = [];

  try {
    // Primary search
    const primaryUrls = await fetchListingUrlsFromPage(primaryUrl, suburbMeta, skipUrls, seen);
    allListingUrls.push(...primaryUrls);
    logger.info({ suburb, count: primaryUrls.length, district: suburbMeta?.district }, "realestate-search: primary search results");

    // Alt districts / fallback URLs — try when primary returned nothing
    if (allListingUrls.length === 0 && altUrls.length > 0) {
      for (const altUrl of altUrls) {
        logger.info({ suburb, altUrl }, "realestate-search: trying alternative URL");
        const altFoundUrls = await fetchListingUrlsFromPage(altUrl, suburbMeta, skipUrls, seen).catch(() => []);
        allListingUrls.push(...altFoundUrls);
        logger.info({ suburb, count: altFoundUrls.length, altUrl }, "realestate-search: alt URL results");
        if (allListingUrls.length > 0) break;
      }
    }

    // Secondary search: no price filters, to catch negotiation/POA listings
    if (includeNegotiation && suburbMeta) {
      const noPriceUrl = buildSearchUrl(suburbMeta.region, suburbMeta.district, suburbMeta.slug);
      const noPriceUrls = await fetchListingUrlsFromPage(noPriceUrl, suburbMeta, skipUrls, seen).catch(() => []);
      allListingUrls.push(...noPriceUrls);
      logger.info({ suburb, count: noPriceUrls.length }, "realestate-search: extracted listing URLs (no-price/negotiation)");
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "realestate-search: failed to fetch search page");
    if (allListingUrls.length === 0) {
      return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz", nextOffset: 0, totalAvailable: 0, done: true };
    }
  }

  if (allListingUrls.length === 0) {
    return { firstBatch: [], remainingListings: [], totalFound: 0, source: "realestate.co.nz", nextOffset: 0, totalAvailable: 0, done: true };
  }

  logger.info({ total: allListingUrls.length }, "realestate-search: fetching all listing meta pages");

  const allResults = await Promise.all(
    allListingUrls.map((url) => fetchListingMeta(url, parseAddressFromSlug(url))),
  );

  const allListings = allResults.filter((r): r is ListingResult => r !== null);
  logger.info({ suburb, fetched: allListings.length, total: allListingUrls.length }, "realestate-search: done");

  // The HTML-scraper fallback is single-shot (no offset pagination), so the
  // returned set is everything it could find — mark it drained.
  return {
    firstBatch: allListings.slice(0, firstBatchSize),
    remainingListings: allListings.slice(firstBatchSize),
    totalFound: allListingUrls.length,
    source: "realestate.co.nz",
    nextOffset: 0,
    totalAvailable: allListingUrls.length,
    done: true,
  };
}
