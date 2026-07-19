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

  it.each([
    { address: "1134 Braemar Road", cv: 1_310_000, landArea: 61_829 },
    { address: "1140 Braemar Road", cv: 630_000, landArea: 3_435 },
  ])("produces Braemar ROI and scores without comparable sales for $address", ({ cv, landArea }) => {
    const property = merged({
      cv_nzd: cv,
      land_area_sqm: landArea,
      zone_code: "Rural Production Zone",
      zone_description: "Rural Production Zone - Whakatane District Plan Zone",
      contour: null,
      overlays: [],
      infrastructure: [],
      estate_type: "freehold",
    });
    const costProfile = regionalCostProfileForProvider("whakatane");
    const actualCosts = estimateCosts(property, 1, {
      sqm_per_lot: landArea,
      cost_profile: costProfile,
    });
    const actualScenarios = calculateBearBaseBullScenarios(actualCosts, 0, cv, 1, landArea, "stable");
    const actualScores = scoreProperty(property, actualCosts, actualScenarios, 1);

    expect(costProfile).toMatchObject({
      id: "whakatane-default",
      source: "auckland_default_pending_regional_rates",
    });
    expect(actualScenarios.length).toBeGreaterThan(0);
    expect(actualScores).toMatchObject({ ease: expect.any(Number), cost: expect.any(Number), roi: expect.any(Number) });
    expect(developmentScoreUnavailableReason(property, actualCosts, actualScenarios)).toBeNull();
  });

  it("produces Southland ROI and development scores from the exact council CV fallback", () => {
    const property = merged({
      cv_nzd: 250_000,
      land_area_sqm: 2_023,
      floor_area_sqm: 94,
      build_year: 1950,
      bedrooms: 3,
      bathrooms: 1,
      zone_code: "General Residential Zone (GRZ)",
      zone_description: "General Residential Zone (GRZ) - Southland General Residential Zone",
      contour: "flat",
      overlays: [],
      infrastructure: [],
      estate_type: "freehold",
    });
    const costProfile = regionalCostProfileForProvider("southland");
    const actualCosts = estimateCosts(property, 1, {
      sqm_per_lot: 2_023,
      cost_profile: costProfile,
    });
    const actualScenarios = calculateBearBaseBullScenarios(actualCosts, 0, 250_000, 1, 2_023, "stable");
    const actualScores = scoreProperty(property, actualCosts, actualScenarios, 1);

    expect(costProfile).toMatchObject({
      id: "southland-default",
      source: "auckland_default_pending_regional_rates",
    });
    expect(actualScenarios.length).toBeGreaterThan(0);
    expect(actualScores).toMatchObject({ ease: expect.any(Number), cost: expect.any(Number), roi: expect.any(Number) });
    expect(developmentScoreUnavailableReason(property, actualCosts, actualScenarios)).toBeNull();
  });

  it("produces Athenree ROI plus development, ease, cost, and ROI scores", () => {
    const property = merged({
      cv_nzd: 710_000,
      land_area_sqm: 1_012,
      floor_area_sqm: 98,
      build_year: 1968,
      bedrooms: 3,
      bathrooms: 1,
      zone_code: "Residential",
      zone_description: "Residential - Western Bay District Plan Zone",
      contour: "flat",
      overlays: [
        { name: "Tsunami / 1 in 2500 Year Wave", status: "moderate", detail: "Yellow" },
        { name: "Liquefaction Vulnerability", status: "moderate", detail: "Possible" },
      ],
      infrastructure: [
        { name: "Water Supply", location: "boundary", risk: "low", distance_metres: 0, estimated_cost_low: 0, estimated_cost_high: 0, note: "Mapped public connection" },
        { name: "Wastewater", location: "boundary", risk: "low", distance_metres: 0, estimated_cost_low: 0, estimated_cost_high: 0, note: "Mapped public connection" },
        { name: "Stormwater", location: "boundary", risk: "low", distance_metres: 0, estimated_cost_low: 0, estimated_cost_high: 0, note: "Mapped public connection" },
      ],
      estate_type: "Fee Simple",
    });
    const costProfile = regionalCostProfileForProvider("western-bay");
    const actualCosts = estimateCosts(property, 2, { sqm_per_lot: 506, cost_profile: costProfile });
    const actualScenarios = calculateBearBaseBullScenarios(actualCosts, 0, 710_000, 2, 506, "stable");
    const actualScores = scoreProperty(property, actualCosts, actualScenarios, 2);

    expect(costProfile).toMatchObject({ id: "western-bay-default", source: "auckland_default_pending_regional_rates" });
    expect(actualCosts.total_high).toBeGreaterThan(actualCosts.total_low);
    expect(actualScenarios.length).toBe(3);
    expect(actualScores).toMatchObject({
      composite: expect.any(Number),
      ease: expect.any(Number),
      cost: expect.any(Number),
      roi: expect.any(Number),
    });
    expect(developmentScoreUnavailableReason(property, actualCosts, actualScenarios)).toBeNull();
  });

  it("produces Manawatu costs, ROI, and all development scores with mapped public services", () => {
    const property = merged({
      cv_nzd: 650_000,
      land_area_sqm: 800,
      floor_area_sqm: 120,
      build_year: 1975,
      bedrooms: 3,
      bathrooms: 1,
      zone_code: "Residential",
      zone_description: "Residential - Palmerston North City District Plan Zone",
      contour: "flat",
      overlays: [],
      infrastructure: [
        { name: "Water Supply", location: "boundary", risk: "low", distance_metres: 0, estimated_cost_low: 0, estimated_cost_high: 0, note: "Mapped public connection" },
        { name: "Wastewater", location: "boundary", risk: "low", distance_metres: 0, estimated_cost_low: 0, estimated_cost_high: 0, note: "Mapped public connection" },
        { name: "Stormwater", location: "boundary", risk: "low", distance_metres: 0, estimated_cost_low: 0, estimated_cost_high: 0, note: "Mapped public connection" },
      ],
      estate_type: "Fee Simple",
    });
    const profile = regionalCostProfileForProvider("manawatu");
    const actualCosts = estimateCosts(property, 2, { sqm_per_lot: 400, cost_profile: profile });
    const actualScenarios = calculateBearBaseBullScenarios(actualCosts, 0, 650_000, 2, 400, "stable");
    const actualScores = scoreProperty(property, actualCosts, actualScenarios, 2);

    expect(profile).toMatchObject({ id: "manawatu-default", source: "auckland_default_pending_regional_rates" });
    expect(actualScenarios).toHaveLength(3);
    expect(actualScores).toMatchObject({
      composite: expect.any(Number),
      ease: expect.any(Number),
      cost: expect.any(Number),
      roi: expect.any(Number),
    });
    expect(developmentScoreUnavailableReason(property, actualCosts, actualScenarios)).toBeNull();
  });

  it("produces Pukehina costs, ROI, and all development scores with the Western Bay profile", () => {
    const property = merged({
      cv_nzd: 1_020_000,
      land_area_sqm: 819,
      floor_area_sqm: 110,
      zone_code: "WBOP_PUKEHINA_RESIDENTIAL",
      zone_description: "Residential - Pukehina",
      contour: "flat",
      overlays: [{ name: "Liquefaction Vulnerability", status: "moderate", detail: "Possible" }],
      infrastructure: [{
        name: "Wastewater", location: "unknown", risk: "high", distance_metres: null,
        estimated_cost_low: 20_000, estimated_cost_high: 120_000, note: "No public wastewater scheme",
      }],
      estate_type: "Fee Simple",
    });
    const profile = regionalCostProfileForProvider("western-bay");
    const actualCosts = estimateCosts(property, 1, { sqm_per_lot: 819, cost_profile: profile });
    const actualScenarios = calculateBearBaseBullScenarios(actualCosts, 0, 1_020_000, 1, 819, "stable");
    const actualScores = scoreProperty(property, actualCosts, actualScenarios, 1);
    expect(actualScenarios).toHaveLength(3);
    expect(actualScores).toMatchObject({ composite: expect.any(Number), ease: expect.any(Number), cost: expect.any(Number), roi: expect.any(Number) });
    expect(developmentScoreUnavailableReason(property, actualCosts, actualScenarios)).toBeNull();
  });
});
