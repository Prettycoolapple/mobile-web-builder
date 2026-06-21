/**
 * Detects unit/apartment-style addresses that prefix a parent street address,
 * e.g. "3F/31 Scanlan Street" or "Unit 3F, 31 Scanlan Street".
 *
 * These are single subject properties. They must not be expanded as packaged
 * listings just because they contain two numbers before the street name.
 */
export function looksLikeUnitOrApartmentAddress(address: string | null | undefined): boolean {
  const value = address?.trim();
  if (!value) return false;

  if (/^(?:unit|apt|apartment|flat|suite|level|lvl)\s+[a-z0-9-]+\s*\/\s*\d+[a-z]?\b/i.test(value)) return true;
  if (/^[a-z]?\d+[a-z]?\s*\/\s*\d+[a-z]?\b/i.test(value)) return true;

  return /^(?:unit|apt|apartment|flat|suite|level|lvl)\s+[a-z0-9-]+\s*,?\s+\d+[a-z]?\b/i.test(value);
}
