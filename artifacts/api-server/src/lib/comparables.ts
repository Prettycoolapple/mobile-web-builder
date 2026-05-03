import type { ComparableSale as ScrapedComparable } from "./scrapers/oneroof";

export interface ComparableSale {
  address: string;
  sale_date: string | null;
  price_nzd: number;
  land_sqm: number;
  floor_sqm: number;
  price_per_sqm: number;
  /** Auckland Council rateable CV — null if enrichment unavailable */
  cv_nzd: number | null;
  /** Build year from AC GIS or scraper — null if unavailable */
  build_year: number | null;
}

export interface ComparablesResult {
  comparables: ComparableSale[];
  avg_sale_price: number;
  avg_price_per_sqm: number;
  data_quality: "live" | "estimated" | "unavailable";
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasRealAddress(address: string): boolean {
  const trimmed = address.trim();
  if (trimmed.length < 6) return false;
  if (/unknown address|default/i.test(trimmed)) return false;
  return /\d/.test(trimmed) && /[a-z]/i.test(trimmed);
}

/** Normalised key for de-duplication across OneRoof + realestate listing sources. */
export function addressKeyForDedupe(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 48);
}

function mapScrapedToComparable(c: ScrapedComparable): ComparableSale {
  const landSqm = finiteNumber(c.land_area_sqm);
  const floorSqm = finiteNumber(c.floor_sqm);
  const priceNzd = finiteNumber(c.price_nzd);
  const addr = typeof c.address === "string" ? c.address.trim() : "";
  return {
    address: addr,
    sale_date: c.sale_date ?? null,
    price_nzd: priceNzd,
    land_sqm: landSqm,
    floor_sqm: floorSqm,
    price_per_sqm: priceNzd > 0 && floorSqm > 0 ? Math.round(priceNzd / floorSqm) : 0,
    cv_nzd: null,
    build_year: null,
  };
}

/**
 * Merges OneRoof scraped “nearby sales” (when present) with optional
 * realestate.co.nz **active listing** prices for the same suburb, de-duped by
 * address. Listing asks are `estimated` quality; 3+ OneRoof records alone are `live`.
 */
export function getComparables(
  _suburb: string,
  _zone_code: string | null,
  _lat: number,
  _lng: number,
  oneroofComparables?: ScrapedComparable[],
  supplementComparables?: ScrapedComparable[],
): ComparablesResult {
  const oneroof = oneroofComparables ?? [];
  const supplement = supplementComparables ?? [];

  const oneroofPassing = oneroof
    .map(mapScrapedToComparable)
    .filter((sale) => sale.price_nzd > 100_000 && hasRealAddress(sale.address));
  const oneroofSufficient = oneroofPassing.length >= 3;

  const seen = new Set<string>();
  const merged: ScrapedComparable[] = [];
  for (const c of [...oneroof, ...supplement]) {
    const addr = typeof c.address === "string" ? c.address.trim() : "";
    if (!addr) continue;
    const k = addressKeyForDedupe(addr);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(c);
  }

  const liveSales: ComparableSale[] = merged
    .map(mapScrapedToComparable)
    .filter((sale) => sale.price_nzd > 100_000 && hasRealAddress(sale.address))
    .slice(0, 8);

  if (liveSales.length > 0) {
    const prices = liveSales.map((s) => s.price_nzd);
    const avg_sale_price = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
    const psms = liveSales.map((s) => s.price_per_sqm).filter((p) => p > 0);
    const avg_price_per_sqm = psms.length > 0 ? Math.round(psms.reduce((a, b) => a + b, 0) / psms.length) : 0;

    const data_quality: ComparablesResult["data_quality"] = oneroofSufficient
      ? "live"
      : "estimated";
    return { comparables: liveSales, avg_sale_price, avg_price_per_sqm, data_quality };
  }

  return {
    comparables: [],
    avg_sale_price: 0,
    avg_price_per_sqm: 0,
    data_quality: "unavailable",
  };
}
