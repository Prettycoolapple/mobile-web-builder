/**
 * Auckland Unitary Plan business zones are not part of Project Alpha's
 * standard residential vacant-lot subdivision model.
 *
 * Some of these zones permit residential or mixed-use development, but the
 * applicable pathway is building/design-led and must be assessed against the
 * business-zone activity and subdivision standards. A raw land-area division
 * must therefore never be presented as a residential lot yield.
 */
export const AUCKLAND_BUSINESS_ZONE_CODES = new Set([
  "BPZ",
  "CCZ",
  "GBZ",
  "HIZ",
  "BPIZ",
  "BMU",
  "LCZ",
  "MCZ",
  "MUZ",
  "MIX",
  "NCZ",
  "TCZ",
]);

export function isAucklandBusinessZone(zoneCode: string | null | undefined): boolean {
  const normalized = zoneCode?.trim().toUpperCase();
  return !!normalized && AUCKLAND_BUSINESS_ZONE_CODES.has(normalized);
}
