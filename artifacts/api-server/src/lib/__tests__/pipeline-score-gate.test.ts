import { describe, expect, it } from "vitest";
import { developmentScoreUnavailableReason } from "../pipeline";
import { estimateCosts, type CostBreakdown } from "../cost-estimator";
import { regionalCostProfileForProvider } from "../regional-cost-profiles";
import { calculateBearBaseBullScenarios } from "../roi-calculator";
import { scoreProperty } from "../scoring";
import type { MergedPropertyData } from "../scrapers/merge";
import type { ROIScenario } from "../roi-calculator";

function merged(overrides: Partial<MergedPropertyData> = {}): MergedPropertyData {
  return {
    typology: "standalone",
    typologyConfidence: "verified",
    titleConfidence: "verified",
    subdivisionRejectReason: null,
    land_area_sqm: 650,
    cv_nzd: 1_200_000,
    contour: "gentle",
    build_year: 1960,
    build_year_range: null,
    zone_code: "MHS",
    ...overrides,
  } as MergedPropertyData;
}

function costs(overrides: Partial<CostBreakdown> = {}): CostBreakdown {
  return {
    cv_unavailable: false,
    ...overrides,
  } as CostBreakdown;
}

const scenarios = [{}] as ROIScenario[];

describe("developmentScoreUnavailableReason", () => {
  it("suppresses development scores for unit/apartment typology", () => {
    expect(
      developmentScoreUnavailableReason(
        merged({ typology: "unit_apartment", subdivisionRejectReason: "unit_or_crosslease_signal" }),
        costs(),
        scenarios,
      ),
    ).toBe("unit_or_apartment_typology");
  });

  it("suppresses development scores when the site cannot be modelled as developable land", () => {
    expect(developmentScoreUnavailableReason(merged({ land_area_sqm: null }), costs(), scenarios)).toBe("missing_land_area_sqm");
    expect(developmentScoreUnavailableReason(merged({ land_area_sqm: 0 }), costs(), scenarios)).toBe("missing_land_area_sqm");
    expect(developmentScoreUnavailableReason(merged({ zone_code: null }), costs(), scenarios)).toBe("missing_zone");
  });

  it("allows scores when required development inputs are present", () => {
    expect(developmentScoreUnavailableReason(merged(), costs(), scenarios)).toBeNull();
  });

  it("keeps incomplete valuation, build-year, and contour data as caveats rather than suppressing all scores", () => {
    expect(developmentScoreUnavailableReason(merged({ cv_nzd: null }), costs({ cv_unavailable: true }), scenarios)).toBeNull();
    expect(developmentScoreUnavailableReason(merged({ contour: null }), costs(), scenarios)).toBeNull();
    expect(developmentScoreUnavailableReason(merged({ build_year: null, build_year_range: null }), costs(), scenarios)).toBeNull();
  });

  it("keeps title and typology uncertainty as score caveats rather than suppressing all scores", () => {
    expect(developmentScoreUnavailableReason(merged({ titleConfidence: "unknown" }), costs(), scenarios)).toBeNull();
    expect(developmentScoreUnavailableReason(merged({ typology: "unknown", typologyConfidence: "unknown" }), costs(), scenarios)).toBeNull();
  });

  it("does not suppress all development scores when ROI market evidence is missing", () => {
    expect(developmentScoreUnavailableReason(merged(), costs(), [])).toBeNull();
  });

  it("produces Whakatane costs, ROI scenarios, and development scores from the CV fallback", () => {
    const property = merged({
      cv_nzd: 1_520_000,
      land_area_sqm: 42_320,
      floor_area_sqm: 270,
      build_year: 2009,
      bedrooms: 4,
      bathrooms: 2,
      zone_code: "General Rural Zone",
      zone_description: "General Rural Zone - Whakatane District Plan Zone",
      contour: null,
      overlays: [],
      infrastructure: [],
      estate_type: "freehold",
    });
    const actualCosts = estimateCosts(property, 1, {
      sqm_per_lot: 42_320,
      cost_profile: regionalCostProfileForProvider("whakatane"),
    });
    const actualScenarios = calculateBearBaseBullScenarios(
      actualCosts,
      0,
      1_520_000,
      1,
      42_320,
      "stable",
    );
    const actualScores = scoreProperty(property, actualCosts, actualScenarios, 1);

    expect(actualCosts.total_high).toBeGreaterThan(actualCosts.total_low);
    expect(actualScenarios.length).toBeGreaterThan(0);
    expect(actualScores).toMatchObject({
      ease: expect.any(Number),
      cost: expect.any(Number),
      roi: expect.any(Number),
    });
    expect(developmentScoreUnavailableReason(property, actualCosts, actualScenarios)).toBeNull();
  });
});
