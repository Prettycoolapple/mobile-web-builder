import { describe, expect, it } from "vitest";

describe("applyOverviewSnapshot", () => {
  it("clears model-generated property facts when the merged pipeline bundle is unavailable", async () => {
    process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
    const { applyOverviewSnapshot } = await import("../analyse");
    const parsed: Record<string, unknown> = {
      propertyOverview: {
        address: "model address",
        cv: "$1,200,000",
        landArea: "20,000m²",
        floorArea: "180m²",
        buildYear: "1965",
        bedrooms: 4,
        bathrooms: 2,
        zone: "Example Zone",
        titleType: "Freehold",
      },
    };

    applyOverviewSnapshot(parsed, null, "1140 Braemar Road, Rotomā");

    expect(parsed.propertyOverview).toMatchObject({
      address: "1140 Braemar Road, Rotomā",
      cv: null,
      landArea: null,
      floorArea: null,
      buildYear: null,
      bedrooms: null,
      bathrooms: null,
      zone: null,
      titleType: null,
    });
    expect(parsed.property_overview_snapshot).toMatchObject({
      address: "1140 Braemar Road, Rotomā",
      cv_nzd: null,
      land_area_sqm: null,
      floor_area_sqm: null,
      build_year: null,
    });
  }, 20_000);

  it("renders the verified Stainton dwelling facts and freehold title", async () => {
    process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
    const { applyOverviewSnapshot } = await import("../analyse");
    const parsed: Record<string, unknown> = { propertyOverview: {} };

    applyOverviewSnapshot(parsed, {
      cv_nzd: 880_000,
      cv_year: 2024,
      land_area_sqm: 1_067,
      floor_area_sqm: 103,
      build_year: 1962,
      build_year_range: null,
      property_type: "RESIDENTIAL",
      bedrooms: 3,
      bathrooms: 1,
      zone_code: "MHS",
      zone_description: "Mixed Housing Suburban",
      estate_type: "Fee Simple",
      titleResolutionSource: "lrs",
      typology: "standalone",
      typologyConfidence: "verified",
      titleConfidence: "verified",
      subdivisionEligible: true,
      subdivisionRejectReason: null,
      listing_price: null,
      listing_active: false,
      data_sources: {},
      discrepancies: [],
      overlays: [],
      infrastructure: [],
    } as any, "14 Stainton Place, Otara, Auckland");

    expect(parsed.propertyOverview).toMatchObject({
      cv: "$880,000",
      landArea: "1067m²",
      floorArea: "103m²",
      buildYear: "1962",
      propertyType: "RESIDENTIAL",
      siteStatus: "has_dwelling",
      bedrooms: 3,
      bathrooms: 1,
      zone: "Mixed Housing Suburban",
      titleType: "Freehold",
    });
  }, 20_000);
});
