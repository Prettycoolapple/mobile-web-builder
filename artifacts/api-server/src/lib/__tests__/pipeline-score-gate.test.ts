import { describe, expect, it } from "vitest";
import { developmentScoreUnavailableReason } from "../pipeline";
import type { CostBreakdown } from "../cost-estimator";
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

  it("suppresses development scores when core property facts are missing", () => {
    expect(developmentScoreUnavailableReason(merged({ cv_nzd: null }), costs({ cv_unavailable: true }), scenarios)).toBe("missing_cv_nzd");
    expect(developmentScoreUnavailableReason(merged({ land_area_sqm: null }), costs(), scenarios)).toBe("missing_land_area_sqm");
    expect(developmentScoreUnavailableReason(merged({ build_year: null, build_year_range: null }), costs(), scenarios)).toBe("missing_build_year_or_decade");
    expect(developmentScoreUnavailableReason(merged({ titleConfidence: "unknown" }), costs(), scenarios)).toBe("unverified_title");
    expect(developmentScoreUnavailableReason(merged({ typology: "unknown", typologyConfidence: "unknown" }), costs(), scenarios)).toBe("unverified_typology");
  });

  it("allows scores when required development inputs are present", () => {
    expect(developmentScoreUnavailableReason(merged(), costs(), scenarios)).toBeNull();
  });

  it("does not suppress all development scores when ROI market evidence is missing", () => {
    expect(developmentScoreUnavailableReason(merged(), costs(), [])).toBeNull();
  });
});
