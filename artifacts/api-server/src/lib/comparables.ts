import type { ComparableSale as ScrapedComparable } from "./scrapers/oneroof";
import { formatNZD } from "./utils";

export interface ComparableSale {
  address: string;
  sale_date: string;
  price_nzd: number;
  land_sqm: number;
  floor_sqm: number;
  price_per_sqm: number;
}

export interface ComparablesResult {
  comparables: ComparableSale[];
  avg_sale_price: number;
  avg_price_per_sqm: number;
  data_quality: "live" | "estimated";
}

const SUBURB_ESTIMATES: Record<string, { avg_sale_price: number; avg_price_per_sqm: number }> = {
  // Premium inner west / isthmus
  "remuera":        { avg_sale_price: 2100000, avg_price_per_sqm: 17500 },
  "epsom":          { avg_sale_price: 1850000, avg_price_per_sqm: 15400 },
  "mt eden":        { avg_sale_price: 1750000, avg_price_per_sqm: 14600 },
  "ponsonby":       { avg_sale_price: 1950000, avg_price_per_sqm: 16200 },
  "herne bay":      { avg_sale_price: 2200000, avg_price_per_sqm: 18300 },
  "grey lynn":      { avg_sale_price: 1650000, avg_price_per_sqm: 13800 },
  "parnell":        { avg_sale_price: 1900000, avg_price_per_sqm: 15800 },
  "newmarket":      { avg_sale_price: 1700000, avg_price_per_sqm: 14200 },
  "sandringham":    { avg_sale_price: 1450000, avg_price_per_sqm: 12100 },
  "mt albert":      { avg_sale_price: 1350000, avg_price_per_sqm: 11200 },
  "onehunga":       { avg_sale_price: 1250000, avg_price_per_sqm: 10400 },
  // Eastern bays (premium coastal)
  "st heliers":     { avg_sale_price: 2000000, avg_price_per_sqm: 16600 },
  "mission bay":    { avg_sale_price: 1900000, avg_price_per_sqm: 15800 },
  "kohimarama":     { avg_sale_price: 1850000, avg_price_per_sqm: 15400 },
  "orakei":         { avg_sale_price: 1800000, avg_price_per_sqm: 15000 },
  "glendowie":      { avg_sale_price: 1700000, avg_price_per_sqm: 14200 },
  "st johns":       { avg_sale_price: 1550000, avg_price_per_sqm: 12900 },
  "meadowbank":     { avg_sale_price: 1500000, avg_price_per_sqm: 12500 },
  "glen innes":     { avg_sale_price: 950000,  avg_price_per_sqm: 7900 },
  "tamaki":         { avg_sale_price: 900000,  avg_price_per_sqm: 7500 },
  // South-east / Howick
  "howick":         { avg_sale_price: 1200000, avg_price_per_sqm: 10000 },
  "pakuranga":      { avg_sale_price: 1100000, avg_price_per_sqm: 9200 },
  "botany":         { avg_sale_price: 1150000, avg_price_per_sqm: 9600 },
  "botany downs":   { avg_sale_price: 1150000, avg_price_per_sqm: 9600 },
  "flat bush":      { avg_sale_price: 1050000, avg_price_per_sqm: 8750 },
  "shelly park":    { avg_sale_price: 1350000, avg_price_per_sqm: 11200 },
  // West / South
  "new lynn":       { avg_sale_price: 1100000, avg_price_per_sqm: 9200 },
  "henderson":      { avg_sale_price: 980000,  avg_price_per_sqm: 8200 },
  "titirangi":      { avg_sale_price: 1050000, avg_price_per_sqm: 8750 },
  "manukau":        { avg_sale_price: 950000,  avg_price_per_sqm: 7900 },
  "papakura":       { avg_sale_price: 850000,  avg_price_per_sqm: 7100 },
  "pukekohe":       { avg_sale_price: 780000,  avg_price_per_sqm: 6500 },
  // North Shore
  "north shore":    { avg_sale_price: 1400000, avg_price_per_sqm: 11700 },
  "takapuna":       { avg_sale_price: 1550000, avg_price_per_sqm: 12900 },
  "albany":         { avg_sale_price: 1200000, avg_price_per_sqm: 10000 },
  "devonport":      { avg_sale_price: 1700000, avg_price_per_sqm: 14200 },
  "birkenhead":     { avg_sale_price: 1250000, avg_price_per_sqm: 10400 },
  "milford":        { avg_sale_price: 1500000, avg_price_per_sqm: 12500 },
  "browns bay":     { avg_sale_price: 1200000, avg_price_per_sqm: 10000 },
  // Default fallback
  "default":        { avg_sale_price: 1300000, avg_price_per_sqm: 10800 },
};

const STREET_TEMPLATES: Record<string, string[]> = {
  "remuera":     ["Arney Road", "Victoria Avenue", "Market Road", "Upland Road"],
  "epsom":       ["Gillies Avenue", "Manukau Road", "Ranfurly Road", "Surrey Crescent"],
  "mt eden":     ["Mount Eden Road", "Valley Road", "Grange Road", "Esplanade Road"],
  "ponsonby":    ["Ponsonby Road", "Jervois Road", "Richmond Road", "Herne Bay Road"],
  "grey lynn":   ["Great North Road", "Surrey Crescent", "Pompallier Terrace", "Tuarangi Road"],
  "default":     ["Main Road", "Park Avenue", "Hill Street", "Valley Road"],
};

function randomJitter(base: number, pct: number): number {
  const factor = 1 + (Math.random() * 2 - 1) * pct;
  return Math.round(base * factor / 1000) * 1000;
}

function syntheticComparables(suburb: string, avgPrice: number, avgPsm: number): ComparableSale[] {
  const streets = STREET_TEMPLATES[suburb] ?? STREET_TEMPLATES["default"];
  const now = new Date();
  const comparables: ComparableSale[] = [];

  for (let i = 0; i < 3; i++) {
    const price = randomJitter(avgPrice, 0.08);
    const floor_sqm = Math.round(110 + Math.random() * 35);
    const land_sqm = Math.round(180 + Math.random() * 120);
    const price_per_sqm = Math.round(price / floor_sqm);
    const monthsAgo = Math.round(2 + Math.random() * 10);
    const saleDate = new Date(now);
    saleDate.setMonth(saleDate.getMonth() - monthsAgo);
    const street = streets[i % streets.length];
    const houseNo = Math.floor(10 + Math.random() * 90);

    comparables.push({
      address: `${houseNo} ${street}, ${suburb.replace(/\b\w/g, (c) => c.toUpperCase())}`,
      sale_date: saleDate.toISOString().slice(0, 10),
      price_nzd: price,
      land_sqm,
      floor_sqm,
      price_per_sqm,
    });
  }

  return comparables;
}

export function getComparables(
  suburb: string,
  _zone_code: string | null,
  _lat: number,
  _lng: number,
  existingComparables?: ScrapedComparable[],
): ComparablesResult {
  const suburbKey = suburb.toLowerCase().trim();

  if (existingComparables && existingComparables.length >= 3) {
    const liveSales: ComparableSale[] = existingComparables.map((c) => {
      const landSqm = (c as any).land_area_sqm ?? (c as any).land_sqm ?? 0;
      const floorSqm = (c as any).floor_sqm ?? (Math.round(landSqm * 0.4) || 120);
      const priceNzd = c.price_nzd ?? 0;
      return {
        address: c.address,
        sale_date: c.sale_date ?? new Date().toISOString().slice(0, 10),
        price_nzd: priceNzd,
        land_sqm: landSqm,
        floor_sqm: floorSqm,
        price_per_sqm: priceNzd && floorSqm ? Math.round(priceNzd / floorSqm) : 0,
      };
    });

    const prices = liveSales.map((s) => s.price_nzd).filter((p) => p > 0);
    const avg_sale_price = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
    const psms = liveSales.map((s) => s.price_per_sqm).filter((p) => p > 0);
    const avg_price_per_sqm = psms.length > 0 ? Math.round(psms.reduce((a, b) => a + b, 0) / psms.length) : 0;

    return { comparables: liveSales, avg_sale_price, avg_price_per_sqm, data_quality: "live" };
  }

  const est = SUBURB_ESTIMATES[suburbKey] ?? SUBURB_ESTIMATES["default"];
  const comparables = syntheticComparables(suburbKey in SUBURB_ESTIMATES ? suburbKey : "default", est.avg_sale_price, est.avg_price_per_sqm);

  return {
    comparables,
    avg_sale_price: est.avg_sale_price,
    avg_price_per_sqm: est.avg_price_per_sqm,
    data_quality: "estimated",
  };
}
