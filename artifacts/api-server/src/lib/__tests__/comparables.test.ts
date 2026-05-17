import { describe, expect, it } from "vitest";
import { getComparables } from "../comparables";

describe("getComparables", () => {
  it("does not create synthetic fallback sales when fetched comparables are missing", () => {
    const result = getComparables("Mellons Bay", "SHZ", -36.89, 174.92);

    expect(result).toEqual({
      comparables: [],
      avg_sale_price: 0,
      avg_price_per_sqm: 0,
      data_quality: "unavailable",
    });
  });

  it("uses only real fetched sales and does not invent floor area for price-per-square-metre", () => {
    const result = getComparables("Mellons Bay", "SHZ", -36.89, 174.92, [
      {
        address: "12 Sample Street, Mellons Bay",
        sale_date: "2025-02-14",
        price_nzd: 1_650_000,
        bedrooms: null,
        land_area_sqm: 612,
      },
      {
        address: "69 Main Road, Default",
        sale_date: "2025-03-01",
        price_nzd: 1_200_000,
        bedrooms: null,
        land_area_sqm: 500,
      },
    ]);

    // "Default" is rejected as placeholder; a single OneRoof row is < 3 so quality is estimated.
    expect(result.data_quality).toBe("estimated");
    expect(result.avg_sale_price).toBe(1_650_000);
    expect(result.avg_price_per_sqm).toBe(0);
    expect(result.comparables).toEqual([
      {
        address: "12 Sample Street, Mellons Bay",
        sale_date: "2025-02-14",
        price_nzd: 1_650_000,
        land_sqm: 612,
        floor_sqm: 0,
        price_per_sqm: 0,
        cv_nzd: null,
        build_year: null,
        typology: "standalone",
        source: "oneroof_sold",
      },
    ]);
  });

  it("marks data_quality live when three or more OneRoof sales pass validation", () => {
    const rows = [1, 2, 3].map((i) => ({
      address: `${10 + i} Test Road, Mellons Bay`,
      sale_date: "2025-01-0" + i,
      price_nzd: 1_000_000 + i * 50_000,
      bedrooms: null,
      land_area_sqm: 500,
    }));
    const result = getComparables("Mellons Bay", "SHZ", -36.89, 174.92, rows);
    expect(result.data_quality).toBe("live");
    expect(result.comparables.length).toBe(3);
  });
});
