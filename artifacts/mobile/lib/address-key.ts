/**
 * Canonical, cross-source address key used for watchlist matching.
 *
 * Mirror of the server-side `normaliseAddressKey`
 * (artifacts/api-server/src/lib/address-key.ts) so the client and server collapse
 * the same NZ address variations — street-type abbreviations (rd/road, st/street,
 * ave/avenue, hwy/highway, …), diacritics, postcodes, and country/city noise —
 * down to one lowercase alphanumeric key. Two inputs that refer to the same
 * property generally produce the same key (e.g. "66A Marine Pde" and
 * "66A Marine Parade, Auckland 2014"). Keep the two impls in sync.
 */
export function normaliseAddressKey(address: string | null | undefined): string {
  if (!address?.trim()) return "";
  return address
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(new zealand|nz|auckland city|auckland)\b/g, "")
    .replace(/\b\d{4}\b/g, "")
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
