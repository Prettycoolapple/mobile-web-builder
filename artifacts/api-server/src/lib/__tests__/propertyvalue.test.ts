import { afterEach, describe, expect, it, vi } from "vitest";
import { scrapePropertyValue } from "../scrapers/propertyvalue";

describe("PropertyValue address resolution", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries an ASCII locality variant when the geocoder supplies a macron", async () => {
    const requested: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/suggestions")) {
        const query = new URL(url).searchParams.get("q") ?? "";
        return new Response(JSON.stringify({
          suggestions: query.toLowerCase().includes("rotoma")
            ? [{ propertyId: 5764004, suggestion: "2926A State Highway 30, Rotoma, Whakatane, 3192", suggestionType: "address" }]
            : [],
        }), { status: 200 });
      }
      if (url.endsWith("/ratingValuation")) {
        return new Response(JSON.stringify({ capitalValue: 1_520_000, valuationDate: "2025-08-01" }), { status: 200 });
      }
      return new Response(JSON.stringify({
        propertyId: 5764004,
        core: { beds: 4, baths: 2, landArea: 42_320 },
        additional: { floorArea: 270, yearBuilt: 2009 },
        address: { fullAddress: "2926A State Highway 30, Rotoma, Whakatane, 3192" },
      }), { status: 200 });
    }));

    const result = await scrapePropertyValue("2926A State Highway 30, Rotomā, New Zealand");

    expect(requested.some((url) => new URL(url).searchParams.get("q")?.includes("Rotoma"))).toBe(true);
    expect(result).toMatchObject({
      property_id: 5764004,
      build_year: 2009,
      floor_area_sqm: 270,
      land_area_sqm: 42_320,
      bedrooms: 4,
      bathrooms: 2,
    });
  });
});
