import { describe, expect, it } from "vitest";
import { estimateCosts } from "../cost-estimator";
import type { MergedPropertyData } from "../scrapers/merge";

function minimal(overrides: Partial<MergedPropertyData> = {}): MergedPropertyData {
  return {
    cv_nzd: 1_000_000,
    cv_year: 2024,
    land_area_sqm: 500,
    floor_area_sqm: null,
    build_year: null,
    build_year_range: null,
    bedrooms: null,
    bathrooms: null,
    zone_code: "SHZ",
    zone_description: null,
    min_lot_size_sqm: 600,
    overlays: [],
    school_zones: { primary: null, intermediate: null, secondary: null },
    last_sale_price: null,
    last_sale_date: null,
    listing_active: false,
    listing_price: null,
    main_photo_url: null,
    photo_urls: [],
    overlay_map_image_base64: null,
    comparables: [],
    data_sources: {},
    discrepancies: [],
    contour: "flat",
    contour_slope_degrees: null,
    contour_source: null,
    contour_text: null,
    asbestos_risk: "unknown",
    infrastructure: [],
    missing_critical_fields: [],
    estate_type: null,
    ...overrides,
  };
}

describe("estimateCosts — existing dwelling / demolition", () => {
  it("infers a dwelling when floor area exists but build year is unknown (non-vacant demolition budget)", () => {
    const c = estimateCosts(minimal({ floor_area_sqm: 140, build_year: null }), 1);
    expect(c.demo_vacant).toBe(false);
    expect(c.has_existing_dwelling).toBe(true);
    expect(c.demo_low).toBeGreaterThan(0);
  });

  it("infers a dwelling from bedrooms alone", () => {
    const c = estimateCosts(minimal({ build_year: null, floor_area_sqm: null, bedrooms: 3 }), 1);
    expect(c.demo_vacant).toBe(false);
    expect(c.demo_low).toBeGreaterThan(0);
  });

  it("treats as vacant only when there are no structure signals (demo $0)", () => {
    const c = estimateCosts(
      minimal({
        build_year: null,
        floor_area_sqm: null,
        bedrooms: null,
        bathrooms: null,
        last_sale_price: null,
        listing_price: null,
      }),
      1,
    );
    expect(c.demo_vacant).toBe(true);
    expect(c.demo_low).toBe(0);
  });

  it("scales construction and consent costs by the final dwelling count", () => {
    const property = minimal({
      cv_nzd: 1_770_000,
      land_area_sqm: 825,
      floor_area_sqm: 220,
      zone_code: "MHS",
      min_lot_size_sqm: 400,
      contour: "flat",
    });

    const oneDwelling = estimateCosts(property, 1, { sqm_per_lot: 412 });
    const twoDwellings = estimateCosts(property, 2, { sqm_per_lot: 412 });

    expect(oneDwelling.construction_low).toBe(541_000);
    expect(oneDwelling.construction_high).toBe(704_000);
    expect(twoDwellings.units).toBe(2);
    expect(twoDwellings.construction_low).toBe(1_081_000);
    expect(twoDwellings.construction_high).toBe(oneDwelling.construction_high * 2);
    expect(twoDwellings.consents_low).toBe(141_000);
    expect(twoDwellings.consents_high).toBe(225_000);
    expect(twoDwellings.total_low).toBeGreaterThan(oneDwelling.total_low);
  });
});
