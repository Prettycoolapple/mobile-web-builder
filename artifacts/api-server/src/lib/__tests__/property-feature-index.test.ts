import { describe, it, expect } from "vitest";
import { deriveFeatureRow } from "../property-feature-row";
import type { RawPropertyData } from "../pipeline";

function raw(overrides: Partial<RawPropertyData>): RawPropertyData {
  return {
    contour: null,
    infrastructure: [],
    derived_scores: null,
    linz_title: null,
    ...overrides,
  } as unknown as RawPropertyData;
}

const ID = { addressKey: "k", suburb: "west harbour", pipelineVersion: 3, lastRefreshedAt: new Date("2026-06-01") };

describe("deriveFeatureRow", () => {
  it("flattens a flat, fully-serviced, 4-lot AUP property", () => {
    const row = deriveFeatureRow(
      raw({
        contour: { slope_degrees: 2, classification: "flat" } as RawPropertyData["contour"],
        infrastructure: [
          { name: "Stormwater", location: "on-parcel", risk: "low" },
          { name: "Wastewater", location: "on-parcel", risk: "moderate" },
          { name: "Water Supply", location: "on-parcel", risk: "low" },
        ] as RawPropertyData["infrastructure"],
        derived_scores: {
          scoringVersion: 4,
          zone: "MHS",
          landArea: 1800,
          potentialLots: 4,
          standardVacantLots: 4,
          minLotSize: 400,
          roiPercentBest: 6.5,
          scores: { composite: 4.2, roi: 3.5 },
        } as RawPropertyData["derived_scores"],
        linz_title: { estate_type: "Fee Simple" } as RawPropertyData["linz_title"],
      }),
      ID,
    );
    expect(row).toMatchObject({
      slopeDegrees: 2,
      contourClass: "flat",
      stormOnParcel: true,
      sewerOnParcel: true,
      waterOnParcel: true,
      allServicesOnParcel: true,
      maxInfraRisk: "moderate", // worst of low/moderate/low
      landAreaSqm: 1800,
      zoneCode: "MHS",
      potentialLots: 4,
      standardVacantLots: 4,
      aupCovered: true,
      estateType: "Fee Simple",
      scoreComposite: 4.2,
      scoreRoi: 3.5,
      scoringVersion: 4,
      pipelineVersion: 3,
      roiPercentBest: 6.5, // persisted ROI % powers "return over X%" search
    });
    // cv is still filled by the value-lookup phase, not extraction.
    expect(row.cvNzd).toBeNull();
  });

  it("treats boundary services as NOT on-parcel and a non-AUP zone as uncovered", () => {
    const row = deriveFeatureRow(
      raw({
        contour: { slope_degrees: 22, classification: "steep" } as RawPropertyData["contour"],
        infrastructure: [
          { name: "Stormwater", location: "boundary", risk: "high" },
        ] as RawPropertyData["infrastructure"],
        derived_scores: {
          scoringVersion: 4,
          zone: "RESIDENTIAL", // not an AUP code
          potentialLots: 1,
        } as RawPropertyData["derived_scores"],
      }),
      ID,
    );
    expect(row.stormOnParcel).toBe(false);
    expect(row.allServicesOnParcel).toBe(false);
    expect(row.maxInfraRisk).toBe("high");
    expect(row.contourClass).toBe("steep");
    expect(row.aupCovered).toBe(false);
    expect(row.potentialLots).toBe(1);
  });

  it("survives a bare cache row with no measured data", () => {
    const row = deriveFeatureRow(raw({}), ID);
    expect(row.slopeDegrees).toBeNull();
    expect(row.contourClass).toBeNull();
    expect(row.allServicesOnParcel).toBe(false);
    expect(row.potentialLots).toBeNull();
    expect(row.zoneCode).toBeNull();
    expect(row.aupCovered).toBe(false);
    expect(row.scoringVersion).toBeNull();
    expect(row.estateType).toBeNull();
  });
});
