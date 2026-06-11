import { describe, expect, it } from "vitest";
import { parseNZDollar, parseArea, parseYear, extractBuildYearFromListingText } from "../scraper-parsers";

/**
 * Fixtures for the numeric field parsers used by the OneRoof scraper.
 * Modelled on `bed-bath-extractor.test.ts` — every fixture is grounded in a
 * shape we've actually seen on a live listing source so a regex tweak can't
 * silently turn "$1.25m" into null or pull "4000m²" out of a section listing.
 *
 * Sources sampled:
 *   - OneRoof card innerText        (oneroof.ts: searchOneRoofPlaywright / Bee)
 *   - realestate.co.nz og:description (used downstream of realestate-search.ts
 *     for price + land area in the same blob)
 *   - homes.co.nz / generic marketing copy reused on card surfaces
 */

interface PriceCase {
  source: "oneroof" | "realestate-search-og" | "homes-card";
  text: string;
  expected: number | null;
  note?: string;
}

const priceCases: PriceCase[] = [
  // OneRoof card price tokens — searchOneRoofPlaywright passes priceM[1] in.
  { source: "oneroof", text: "1,250,000", expected: 1_250_000, note: "comma-separated full dollars" },
  { source: "oneroof", text: "950,000", expected: 950_000 },
  { source: "oneroof", text: "1.25m", expected: 1_250_000, note: "lowercase m suffix" },
  { source: "oneroof", text: "2.09M", expected: 2_090_000, note: "uppercase M suffix" },
  { source: "oneroof", text: "950k", expected: 950_000, note: "k suffix" },
  { source: "oneroof", text: "1M", expected: 1_000_000, note: "no decimal with suffix" },
  // ScrapingBee path strips text differently — make sure $/space tolerated.
  { source: "oneroof", text: "$1,999,999", expected: 1_999_999, note: "leading $ tolerated (clean step strips it)" },
  { source: "oneroof", text: "  $2.09M  ", expected: 2_090_000, note: "surrounding whitespace" },
  // realestate.co.nz og:description embeds the price inline.
  {
    source: "realestate-search-og",
    text: "$2,090,000",
    expected: 2_090_000,
    note: "asking-price form from 22 Morrow Avenue listing",
  },
  // Marketing-copy edge cases.
  { source: "homes-card", text: "1.5m", expected: 1_500_000, note: "decimal with m" },
  { source: "homes-card", text: "0.95m", expected: 950_000, note: "sub-million decimal" },
  // Missing / unusable inputs must return null, never 0 or NaN.
  { source: "homes-card", text: "Price on application", expected: null, note: "non-numeric label" },
  { source: "homes-card", text: "", expected: null, note: "empty string" },
  { source: "homes-card", text: "$0", expected: null, note: "zero filtered (v <= 0 guard)" },
  { source: "oneroof", text: "Auction", expected: null, note: "auction with no number" },
];

interface AreaCase {
  source: "oneroof" | "realestate-search-og" | "homes-card";
  text: string;
  expected: number | null;
  note?: string;
}

const areaCases: AreaCase[] = [
  // OneRoof extractDataFromText feeds parseArea fragments that retain the "m"
  // unit char (the captured group from the surrounding regex stops before it,
  // but the parser itself still requires a literal "m" to anchor the number).
  { source: "oneroof", text: "572m", expected: 572, note: "bare integer m² capture" },
  { source: "oneroof", text: "1,250m", expected: 1_250, note: "comma-separated land area" },
  { source: "oneroof", text: "120.5m", expected: 121, note: "decimal floor area is rounded" },
  { source: "oneroof", text: "600 m", expected: 600, note: "whitespace between digit and unit" },
  // realestate.co.nz og:description embeds land area inline ("572m²").
  {
    source: "realestate-search-og",
    text: "572m",
    expected: 572,
    note: "from '572m² land area' on 22 Morrow Avenue listing",
  },
  // homes.co.nz card text reuses the same shape.
  { source: "homes-card", text: "4000m", expected: 4000, note: "vacant section size" },
  { source: "homes-card", text: "600m²", expected: 600, note: "real m² character with superscript" },
  // Missing / unusable inputs.
  { source: "homes-card", text: "", expected: null, note: "empty string" },
  { source: "homes-card", text: "Land area not specified", expected: null, note: "no digit" },
  { source: "homes-card", text: "0m", expected: null, note: "zero filtered (v <= 0 guard)" },
];

interface YearCase {
  source: "oneroof" | "realestate-search-og" | "homes-card";
  text: string;
  expected: number | null;
  note?: string;
}

const currentYear = new Date().getFullYear();

const yearCases: YearCase[] = [
  // OneRoof "Built: YYYY" / "CV YYYY" patterns.
  { source: "oneroof", text: "1998", expected: 1998, note: "typical build year" },
  { source: "oneroof", text: "Built 2024", expected: 2024, note: "label-prefixed year" },
  { source: "oneroof", text: "Last sold in 2019", expected: 2019 },
  { source: "oneroof", text: "as at 2023", expected: 2023, note: "CV year suffix" },
  // realestate.co.nz / homes — 1900s + 2000s both supported.
  { source: "realestate-search-og", text: "circa 1925", expected: 1925, note: "early 20th-century villa" },
  { source: "homes-card", text: `built ${currentYear}`, expected: currentYear, note: "current year accepted" },
  { source: "homes-card", text: `due for completion ${currentYear + 1}`, expected: currentYear + 1, note: "next year accepted" },
  // Out-of-range / missing.
  { source: "homes-card", text: "1799", expected: null, note: "below 1800 lower bound" },
  { source: "homes-card", text: "no year listed", expected: null, note: "no 4-digit number" },
  { source: "homes-card", text: "Built in '99", expected: null, note: "two-digit year not matched" },
];

describe("parseNZDollar", () => {
  for (const c of priceCases) {
    const label = `[${c.source}] ${c.note ?? c.text.slice(0, 40)}`;
    it(label, () => {
      expect(parseNZDollar(c.text)).toBe(c.expected);
    });
  }
});

describe("parseArea", () => {
  for (const c of areaCases) {
    const label = `[${c.source}] ${c.note ?? c.text.slice(0, 40)}`;
    it(label, () => {
      expect(parseArea(c.text)).toBe(c.expected);
    });
  }
});

describe("parseYear", () => {
  for (const c of yearCases) {
    const label = `[${c.source}] ${c.note ?? c.text.slice(0, 40)}`;
    it(label, () => {
      expect(parseYear(c.text)).toBe(c.expected);
    });
  }
});

describe("extractBuildYearFromListingText", () => {
  it("prefers Year built over noisy other years in blob", () => {
    const blob = `Some text 2019 auction. Year built: 2016\nFloor 120m`;
    expect(extractBuildYearFromListingText(blob)).toBe(2016);
  });
  it("matches Built in YYYY", () => {
    expect(extractBuildYearFromListingText("Quality home. Built in 2014 near schools.")).toBe(2014);
  });
  it("matches new-build marketing copy: completed YYYY", () => {
    expect(extractBuildYearFromListingText("Completed 2025 and never lived in.")).toBe(2025);
    expect(extractBuildYearFromListingText("Completed in 2024 to a high spec.")).toBe(2024);
  });
  it("matches 'YYYY build' and 'new build YYYY'", () => {
    expect(extractBuildYearFromListingText("A 2024 build with Master Build guarantee.")).toBe(2024);
    expect(extractBuildYearFromListingText("Stunning new build 2025 in a quiet cul-de-sac.")).toBe(2025);
  });
  it("does not invent a build year from renovation copy", () => {
    expect(extractBuildYearFromListingText("Brand new kitchen and bathroom throughout.")).toBeNull();
  });
});
