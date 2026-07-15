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
});
