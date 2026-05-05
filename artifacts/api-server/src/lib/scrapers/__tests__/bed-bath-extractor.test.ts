import { describe, expect, it } from "vitest";
import { extractBedsBaths } from "../bed-bath-extractor";

/**
 * Vitest port of the fixtures originally defined in
 * `scripts/verify-bed-bath-extraction.ts`. Each case is grounded in a real
 * listing source consumed by the scraper pipeline:
 *   - realestate.co.nz og:description (realestate-search.ts)
 *   - OneRoof card innerText (oneroof.ts Playwright + ScrapingBee paths)
 *   - homes.co.nz / generic marketing copy reused in card surfaces
 *
 * Adding a new live source? Drop a verbatim sample string in here so a future
 * regex tweak can't silently regress it.
 */

interface Case {
  source: "oneroof" | "realestate-search-og" | "homes-card";
  text: string;
  expected: { bedrooms: number | null; bathrooms: number | null };
  note?: string;
}

const realEstateOgCases: Case[] = [
  {
    source: "realestate-search-og",
    text: "House for sale at 78/32 Edwin Street, Mount Eden, Auckland City, Auckland 1024, with 3 beds, 1 bath. Auction.",
    expected: { bedrooms: 3, bathrooms: 1 },
    note: "real Mount Eden listing 43028474",
  },
  {
    source: "realestate-search-og",
    text: "Unit for sale at 3/872B Dominion Road, Mount Eden, Auckland City, Auckland with 1 bed, 1 bath. Auction.",
    expected: { bedrooms: 1, bathrooms: 1 },
    note: "singular bed/bath form",
  },
  {
    source: "realestate-search-og",
    text: "Apartment for sale at 7 Emily Place, Auckland Central with 1 bed, 1 bath. Negotiation.",
    expected: { bedrooms: 1, bathrooms: 1 },
    note: "apartment edge case — must not show 0 bd",
  },
  {
    source: "realestate-search-og",
    text: "Apartment for sale at 70 Daldy Street, Auckland Central with 3 beds, 2 baths. $1,999,999.",
    expected: { bedrooms: 3, bathrooms: 2 },
  },
  {
    source: "realestate-search-og",
    text: "House for sale at 22 Morrow Avenue, Bucklands Beach, with 4 beds, 3 baths, 572m² land area. Asking Price $2,090,000.",
    expected: { bedrooms: 4, bathrooms: 3 },
    note: "long og:description with land area in same string",
  },
  {
    source: "realestate-search-og",
    text: "House for sale at 66A Marine Parade with 6 beds, 3 living areas, 5 baths. Price by negotiation.",
    expected: { bedrooms: 6, bathrooms: 5 },
    note: "living areas count must never be parsed as bathrooms",
  },
];

const cardCases: Case[] = [
  {
    source: "oneroof",
    text: "$1,250,000\n26 Marlborough Street\nMount Eden\n3 Beds  1 Bath  120m²",
    expected: { bedrooms: 3, bathrooms: 1 },
    note: "typical OneRoof card innerText",
  },
  {
    source: "oneroof",
    text: "Auction\n753 Mount Eden Road\nMount Eden\n3 br / 2 ba",
    expected: { bedrooms: 3, bathrooms: 2 },
    note: "abbreviated br/ba form",
  },
  {
    source: "homes-card",
    text: "Sun-drenched 3-Bedroom 2-Bathroom standalone in Remuera",
    expected: { bedrooms: 3, bathrooms: 2 },
    note: "regression: previously parsed 2 bd because 'Bedroom 2-Bathroom' bled across",
  },
  {
    source: "homes-card",
    text: "Charming villa - 4-bedroom, 2-bathroom",
    expected: { bedrooms: 4, bathrooms: 2 },
    note: "hyphenated marketing copy",
  },
  {
    source: "homes-card",
    text: "This 4 bedroom, 2.5 bathroom home sits on 600m²",
    expected: { bedrooms: 4, bathrooms: 2 },
    note: "fractional bath truncated for display, must not capture the '5'",
  },
  {
    source: "oneroof",
    text: "Bedrooms: 3, Bathrooms: 2, Garages: 1",
    expected: { bedrooms: 3, bathrooms: 2 },
    note: "label-then-number form with explicit ':' separator",
  },
  {
    source: "homes-card",
    text: "3 Beds | 2 Baths | 1 Garage",
    expected: { bedrooms: 3, bathrooms: 2 },
  },
];

const edgeCases: Case[] = [
  {
    source: "realestate-search-og",
    text: "Studio apartment in Auckland Central with city views.",
    expected: { bedrooms: null, bathrooms: null },
    note: "studio — no number; must NOT display 0 bd / 0 ba",
  },
  {
    source: "realestate-search-og",
    text: "Vacant section, 4000m² land area in Pukekohe. No dwelling.",
    expected: { bedrooms: null, bathrooms: null },
    note: "section listing — must not pick up '4000' as beds",
  },
  {
    source: "homes-card",
    text: "0 bed, 0 bath",
    expected: { bedrooms: null, bathrooms: null },
    note: "explicit zeroes filtered out (PropertyCard guard is belt-and-braces)",
  },
];

function runCase(c: Case) {
  const got = extractBedsBaths(c.text);
  expect(got.bedrooms, `bedrooms for "${c.text.slice(0, 80)}"`).toBe(c.expected.bedrooms);
  expect(got.bathrooms, `bathrooms for "${c.text.slice(0, 80)}"`).toBe(c.expected.bathrooms);
}

describe("extractBedsBaths", () => {
  describe("realestate.co.nz og:description fixtures", () => {
    for (const c of realEstateOgCases) {
      it(c.note ?? c.text.slice(0, 60), () => runCase(c));
    }
  });

  describe("OneRoof / homes-style card text", () => {
    for (const c of cardCases) {
      it(c.note ?? c.text.slice(0, 60), () => runCase(c));
    }
  });

  describe("missing / zero / non-residential edge cases", () => {
    for (const c of edgeCases) {
      it(c.note ?? c.text.slice(0, 60), () => runCase(c));
    }
  });

  it("label + space + number (no colon): Bedrooms 3 Bathrooms 2", () => {
    expect(extractBedsBaths("Bedrooms 3 Bathrooms 2")).toEqual({
      bedrooms: 3,
      bathrooms: 2,
    });
  });
});
