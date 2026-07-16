/**
 * Canonical, cross-source address key used for dedup/lookup.
 *
 * Collapses the common ways the same NZ address gets typed differently —
 * street-type abbreviations (rd/road, st/street, ave/avenue, hwy/highway, …),
 * diacritics, postcodes, and country/city noise — down to a single lowercase
 * alphanumeric key. Two inputs that refer to the same property generally produce
 * the same key (e.g. "66A Marine Pde" and "66A Marine Parade, Auckland 2014").
 *
 * Originally defined inline in routes/analyse.ts for discovery dedup; promoted
 * here so the analyse route and the global property cache share one impl.
 */
export function normaliseAddressKey(address: string | null | undefined): string {
  if (!address?.trim()) return "";
  return address
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    // NZ postcodes are four digits at the end of an address. Do not remove a
    // four-digit street number (for example 1134/1140 Braemar Road), otherwise
    // neighbouring properties collapse onto the same global cache row.
    .replace(/\b\d{4}\b(?=\s*[,;]?\s*$)/g, "")
    .replace(/\b(street|st)\b/g, "street")
    .replace(/\b(road|rd)\b/g, "road")
    .replace(/\b(avenue|ave)\b/g, "avenue")
    .replace(/\b(crescent|cres)\b/g, "crescent")
    .replace(/\b(place|pl)\b/g, "place")
    .replace(/\b(drive|dr)\b/g, "drive")
    .replace(/\b(lane|ln)\b/g, "lane")
    .replace(/\b(terrace|tce)\b/g, "terrace")
    .replace(/\b(parade|pde)\b/g, "parade")
    .replace(/\b(boulevard|blvd)\b/g, "boulevard")
    .replace(/\b(highway|hwy)\b/g, "highway")
    .replace(/[^a-z0-9]+/g, "");
}

/** @deprecated Use {@link normaliseAddressKey}. Kept as an alias for the
 * original discovery call sites. */
export const normaliseDiscoveryAddressKey = normaliseAddressKey;
