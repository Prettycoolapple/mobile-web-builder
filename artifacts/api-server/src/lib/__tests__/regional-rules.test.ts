import { describe, expect, it } from "vitest";
import {
  assessRegionalSubdivisionPathways,
  calculateRegionalPotentialLots,
  regionalRulePackEntries,
  regionalPlanningRuleStatus,
  regionalZoneDescriptionWithRuleStatus,
} from "../regional-rules";

describe("regional planning rule status", () => {
  it("allows automatic yield only for the Auckland legacy provider", () => {
    expect(regionalPlanningRuleStatus(null)).toMatchObject({
      subdivisionRules: "auckland_legacy",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: true,
      automaticRoiAllowed: true,
      verifiedMinimumLotSqm: null,
      note: null,
    });
    expect(regionalPlanningRuleStatus({
      providerId: "auckland-legacy",
      providerName: "Auckland Council legacy GIS",
    })).toMatchObject({
      subdivisionRules: "auckland_legacy",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: true,
    });
  });

  it("keeps unsupported regional providers facts-only until local rules are modelled", () => {
    expect(regionalPlanningRuleStatus({
      providerId: "christchurch",
      providerName: "Christchurch City Council planning provider",
    })).toMatchObject({
      subdivisionRules: "not_modelled",
      modellingStatus: "facts_only",
      automaticYieldClaimsAllowed: false,
      automaticRoiAllowed: false,
      verifiedMinimumLotSqm: null,
    });
  });

  it("allows interim comparable-sales ROI for non-modelled QLDC zones without inferring yield", () => {
    const status = regionalPlanningRuleStatus(
      {
        providerId: "qldc",
        providerName: "Queenstown Lakes District Council planning provider",
      },
      {
        zone_code: "Rural - Stage 1 and 2",
        zone_description: "Rural - Stage 1 and 2 - QLDC Proposed District Plan Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      1_200,
    );

    expect(status).toMatchObject({
      subdivisionRules: "not_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: false,
      automaticRoiAllowed: true,
      verifiedMinimumLotSqm: null,
    });
    expect(status.note).toContain("local subdivision/minimum-lot rules are not modelled yet");
  });

  it("allows interim comparable-sales ROI for Nelson without inferring yield", () => {
    expect(regionalPlanningRuleStatus(
      {
        providerId: "nelson",
        providerName: "Nelson City Council planning provider",
      },
      {
        zone_code: "Residential - Lower Density",
        zone_description: "Residential - Lower Density - Nelson Planning Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
    )).toMatchObject({
      subdivisionRules: "not_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: false,
      automaticRoiAllowed: true,
      verifiedMinimumLotSqm: null,
    });
  });

  it("allows interim comparable-sales ROI for non-modelled Whangarei zones without inferring yield", () => {
    expect(regionalPlanningRuleStatus(
      {
        providerId: "whangarei",
        providerName: "Whangarei District Council planning provider",
      },
      {
        zone_code: "Rural Production Zone",
        zone_description: "Rural Production Zone - Whangarei Rural Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
    )).toMatchObject({
      subdivisionRules: "not_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: false,
      automaticRoiAllowed: true,
      verifiedMinimumLotSqm: null,
    });
  });

  it("enables standard vacant-lot yield and ROI for verified Whangarei rule-pack zones", () => {
    const status = regionalPlanningRuleStatus(
      {
        providerId: "whangarei",
        providerName: "Whangarei District Council planning provider",
      },
      {
        zone_code: "General Residential Zone",
        zone_description: "General Residential Zone - Whangarei Residential Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
    );

    expect(status).toMatchObject({
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: true,
      automaticRoiAllowed: true,
      regionalZoneCode: "WDC_GRZ",
      verifiedMinimumLotSqm: 400,
      sourceLabel: "Whangarei District Plan SUB-R5",
    });
    expect(status.note).toContain("standard vacant-lot rule is modelled");
  });

  it("enables Hamilton General Residential vacant-lot yield from PC12 Chapter 23", () => {
    const provider = {
      providerId: "hamilton" as const,
      providerName: "Hamilton City Council planning provider",
    };
    const zone = {
      zone_code: "General Residential Zone",
      zone_description: "General Residential Zone - Hamilton District Plan Zoning",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };

    expect(regionalPlanningRuleStatus(provider, zone, 900)).toMatchObject({
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: "roi_enabled",
      regionalZoneCode: "HCC_GRZ",
      verifiedMinimumLotSqm: 300,
      sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.2",
    });
    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 900,
    })?.lotResult).toMatchObject({
      lots: 3,
      min_lot_size: 300,
      zone_label: "General Residential Zone",
    });
  });

  it("applies Hamilton's Waikato Expressway General Residential minimum when detected", () => {
    const provider = {
      providerId: "hamilton" as const,
      providerName: "Hamilton City Council planning provider",
    };
    const zone = {
      zone_code: "General Residential Zone",
      zone_description: "General Residential Zone - Hamilton District Plan Zoning",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const overlays = [{
      name: "Designation",
      status: "control" as const,
      detail: "Designation applies - Waikato Expressway - transport corridor.",
    }];

    expect(regionalPlanningRuleStatus(provider, zone, 2_100, overlays).verifiedMinimumLotSqm).toBe(1_000);
    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 2_100,
      overlays,
    })?.lotResult.lots).toBe(2);
  });

  it("uses the Hamilton Rotokauri North residential precinct vacant-lot standard", () => {
    const result = calculateRegionalPotentialLots({
      provider: {
        providerId: "hamilton",
        providerName: "Hamilton City Council planning provider",
      },
      zone: {
        zone_code: "Rotokauri North Medium-Density Residential Zone",
        zone_description: "Rotokauri North Residential Precinct - Hamilton District Plan Zoning",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      landAreaSqm: 840,
    });

    expect(result?.lotResult).toMatchObject({
      lots: 3,
      min_lot_size: 280,
      zone_label: "Rotokauri North Residential Precinct",
    });
  });

  it("flags Hamilton concurrent land-use subdivision where it can exceed vacant-lot yield", () => {
    const provider = {
      providerId: "hamilton" as const,
      providerName: "Hamilton City Council planning provider",
    };
    const zone = {
      zone_code: "General Residential Zone",
      zone_description: "General Residential Zone - Hamilton District Plan Zoning",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const lotResult = calculateRegionalPotentialLots({ provider, zone, landAreaSqm: 540 })!.lotResult;

    const assessment = assessRegionalSubdivisionPathways({
      provider,
      zone,
      netAreaSqm: lotResult.net_area_sqm,
      zoneCode: "HCC_GRZ",
      zoneLabel: lotResult.zone_label,
      standardVacantLots: lotResult.lots,
      minLotSqm: lotResult.min_lot_size,
      typology: "standalone",
      titleConfidence: "verified",
      landAreaConfidence: "verified",
      buildYear: 1965,
    });

    expect(assessment).toMatchObject({
      designLedEligible: true,
      designLedYieldRange: { min: 2, max: 3 },
      designLedConfidence: "low",
    });
    expect(assessment?.designLedDetail).toContain("Concurrent land-use and subdivision pathway");
  });

  it("does not apply Hamilton MDRZ rule packs to excluded structure-plan precincts", () => {
    expect(regionalPlanningRuleStatus(
      {
        providerId: "hamilton",
        providerName: "Hamilton City Council planning provider",
      },
      {
        zone_code: "Medium Density Residential Zone",
        zone_description: "Ruakura Residential Precinct - Medium Density Residential Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      1_200,
    )).toMatchObject({
      subdivisionRules: "not_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: false,
      automaticRoiAllowed: true,
    });
  });

  it("allows Hamilton Transport Corridor zones to keep zoning and interim ROI without yield claims", () => {
    const status = regionalPlanningRuleStatus(
      {
        providerId: "hamilton",
        providerName: "Hamilton City Council planning provider",
      },
      {
        zone_code: "Transport Corridor Zone",
        zone_description: "Transport Corridor Zone - Hamilton District Plan Zoning",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      2_920,
    );

    expect(status).toMatchObject({
      subdivisionRules: "not_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: false,
      automaticRoiAllowed: true,
      verifiedMinimumLotSqm: null,
    });
    expect(status.note).toContain("Interim ROI uses nearby comparable-sales GDV");
  });

  it("enables Christchurch Medium Density yield from Chapter 8", () => {
    const provider = {
      providerId: "christchurch" as const,
      providerName: "Christchurch City Council planning provider",
    };
    const zone = {
      zone_code: "MRZ",
      zone_description: "Medium density residential zone - Operative - Christchurch District Plan Zone",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };

    expect(regionalPlanningRuleStatus(provider, zone, 800)).toMatchObject({
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: "roi_enabled",
      regionalZoneCode: "CCC_MRZ",
      verifiedMinimumLotSqm: 200,
      sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    });
    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 800,
    })?.lotResult).toMatchObject({
      lots: 4,
      min_lot_size: 200,
      zone_label: "Medium Density Residential Zone",
    });
  });

  it("applies the Christchurch HRZ/MRZ qualifying-matter minimum when detected", () => {
    const provider = {
      providerId: "christchurch" as const,
      providerName: "Christchurch City Council planning provider",
    };
    const zone = {
      zone_code: "HRZ",
      zone_description: "High density residential zone - Christchurch District Plan Zone",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const overlays = [{
      name: "Residential Density / Qualifying Matter",
      status: "moderate" as const,
      detail: "Residential Density / Qualifying Matter applies - qualifying matter area.",
    }];

    expect(regionalPlanningRuleStatus(provider, zone, 900, overlays).verifiedMinimumLotSqm).toBe(300);
    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 900,
      overlays,
    })?.lotResult).toMatchObject({
      lots: 3,
      min_lot_size: 300,
    });
  });

  it("uses Christchurch suburban residential table values", () => {
    const provider = {
      providerId: "christchurch" as const,
      providerName: "Christchurch City Council planning provider",
    };

    expect(calculateRegionalPotentialLots({
      provider,
      zone: {
        zone_code: "RS",
        zone_description: "Residential Suburban - Christchurch District Plan Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      landAreaSqm: 900,
    })?.lotResult).toMatchObject({
      lots: 2,
      min_lot_size: 450,
      zone_label: "Residential Suburban Zone",
    });
    expect(calculateRegionalPotentialLots({
      provider,
      zone: {
        zone_code: "RSDT",
        zone_description: "Residential Suburban Density Transition - Christchurch District Plan Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      landAreaSqm: 990,
    })?.lotResult).toMatchObject({
      lots: 3,
      min_lot_size: 330,
      zone_label: "Residential Suburban Density Transition Zone",
    });
  });

  it("flags Christchurch comprehensive development only when qualifying matters do not block it", () => {
    const provider = {
      providerId: "christchurch" as const,
      providerName: "Christchurch City Council planning provider",
    };
    const zone = {
      zone_code: "MRZ",
      zone_description: "Medium density residential zone - Operative - Christchurch District Plan Zone",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const lotResult = calculateRegionalPotentialLots({ provider, zone, landAreaSqm: 390 })!.lotResult;
    const baseInput = {
      provider,
      zone,
      netAreaSqm: lotResult.net_area_sqm,
      zoneCode: "CCC_MRZ",
      zoneLabel: lotResult.zone_label,
      standardVacantLots: lotResult.lots,
      minLotSqm: lotResult.min_lot_size,
      typology: "standalone" as const,
      titleConfidence: "verified" as const,
      landAreaConfidence: "verified" as const,
      buildYear: 1970,
    };

    expect(assessRegionalSubdivisionPathways(baseInput)).toMatchObject({
      designLedEligible: true,
      designLedYieldRange: { min: 2, max: 3 },
    });
    expect(assessRegionalSubdivisionPathways({
      ...baseInput,
      overlays: [{
        name: "Residential Density / Qualifying Matter",
        status: "moderate",
        detail: "Residential Density / Qualifying Matter applies - qualifying matter area.",
      }],
    })).toMatchObject({
      designLedEligible: false,
      designLedYieldRange: null,
    });
  });

  it("calculates Whangarei standard vacant-lot capacity from the local rule pack", () => {
    const result = calculateRegionalPotentialLots({
      provider: {
        providerId: "whangarei",
        providerName: "Whangarei District Council planning provider",
      },
      zone: {
        zone_code: "Medium Density Residential Zone",
        zone_description: "Medium Density Residential Zone - Whangarei Residential Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      landAreaSqm: 960,
      easementAreaSqm: 0,
    });

    expect(result?.lotResult).toMatchObject({
      lots: 3,
      min_lot_size: 300,
      zone_label: "Medium Density Residential Zone",
      sqm_per_lot: 320,
    });
    expect(result?.sourceLabel).toBe("Whangarei District Plan SUB-R6");
  });

  it("flags Whangarei Medium Density unit-title opportunity without using the 50sqm minimum directly", () => {
    const provider = {
      providerId: "whangarei" as const,
      providerName: "Whangarei District Council planning provider",
    };
    const zone = {
      zone_code: "Medium Density Residential Zone",
      zone_description: "Medium Density Residential Zone - Whangarei Residential Zone",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const lotResult = calculateRegionalPotentialLots({ provider, zone, landAreaSqm: 720 })!.lotResult;
    const assessment = assessRegionalSubdivisionPathways({
      provider,
      zone,
      netAreaSqm: lotResult.net_area_sqm,
      zoneCode: "WDC_MRZ",
      zoneLabel: lotResult.zone_label,
      standardVacantLots: lotResult.lots,
      minLotSqm: lotResult.min_lot_size,
      typology: "standalone",
      titleConfidence: "verified",
      landAreaConfidence: "verified",
      buildYear: 1980,
    });

    expect(assessment).toMatchObject({
      designLedEligible: true,
      designLedYieldRange: { min: 3, max: 4 },
    });
    expect(assessment?.designLedDetail).toContain("unit-title opportunity");
  });

  it("uses Whangarei large-parent-site thresholds where the rule provides them", () => {
    const result = calculateRegionalPotentialLots({
      provider: {
        providerId: "whangarei",
        providerName: "Whangarei District Council planning provider",
      },
      zone: {
        zone_code: "Medium Density Residential Zone",
        zone_description: "Medium Density Residential Zone - Whangarei Residential Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      landAreaSqm: 12_000,
    });

    expect(result?.lotResult.min_lot_size).toBe(240);
    expect(result?.lotResult.lots).toBe(20);
  });

  it("enables QLDC Medium Density vacant-lot yield and ROI from Chapter 27", () => {
    const provider = {
      providerId: "qldc" as const,
      providerName: "Queenstown Lakes District Council planning provider",
    };
    const zone = {
      zone_code: "18",
      zone_description: "Medium Density Residential - Stage 1 and 2 - QLDC Proposed District Plan Zone - code 18",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };

    expect(regionalPlanningRuleStatus(provider, zone, 1_000)).toMatchObject({
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: true,
      automaticRoiAllowed: true,
      regionalZoneCode: "QLDC_MDRZ",
      verifiedMinimumLotSqm: 250,
      sourceLabel: "QLDC PDP Chapter 27 Rule 27.6.1",
    });

    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 1_000,
    })?.lotResult).toMatchObject({
      lots: 4,
      min_lot_size: 250,
      zone_label: "Medium Density Residential Zone",
      sqm_per_lot: 250,
    });
  });

  it("applies the QLDC Lower Density airport-noise minimum when the overlay is present", () => {
    const provider = {
      providerId: "qldc" as const,
      providerName: "Queenstown Lakes District Council planning provider",
    };
    const zone = {
      zone_code: "17",
      zone_description: "Suburban Residential - QLDC Proposed District Plan Zone - code 17",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const overlays = [{
      name: "Overlay Polygon",
      status: "moderate" as const,
      detail: "Overlay Polygon applies - Air Noise Boundary - Queenstown Airport Air Noise Boundary (Ldn65). Confirm implications in the local district plan.",
    }];

    const status = regionalPlanningRuleStatus(provider, zone, 1_200, overlays);
    expect(status).toMatchObject({
      regionalZoneCode: "QLDC_LDSRZ",
      verifiedMinimumLotSqm: 600,
    });
    expect(status.note).toContain("600sqm minimum");
    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 1_200,
      overlays,
    })?.lotResult.lots).toBe(2);
  });

  it("blocks the QLDC approved-unit pathway inside airport noise overlays", () => {
    const provider = {
      providerId: "qldc" as const,
      providerName: "Queenstown Lakes District Council planning provider",
    };
    const zone = {
      zone_code: "17",
      zone_description: "Suburban Residential - QLDC Proposed District Plan Zone - code 17",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const lotResult = calculateRegionalPotentialLots({ provider, zone, landAreaSqm: 900 })!.lotResult;
    const baseInput = {
      provider,
      zone,
      netAreaSqm: lotResult.net_area_sqm,
      zoneCode: "QLDC_LDSRZ",
      zoneLabel: lotResult.zone_label,
      standardVacantLots: lotResult.lots,
      minLotSqm: lotResult.min_lot_size,
      typology: "standalone" as const,
      titleConfidence: "verified" as const,
      landAreaConfidence: "verified" as const,
      buildYear: 1988,
    };

    expect(assessRegionalSubdivisionPathways(baseInput)).toMatchObject({
      designLedEligible: true,
      designLedYieldRange: { min: 3, max: 3 },
    });
    expect(assessRegionalSubdivisionPathways({
      ...baseInput,
      overlays: [{
        name: "Overlay Polygon",
        status: "moderate",
        detail: "Air Noise Boundary - Queenstown Airport Air Noise Boundary.",
      }],
    })).toMatchObject({
      designLedEligible: false,
      designLedYieldRange: null,
    });
  });

  it("enables Dunedin GR1 yield from the Variation 2 minimum site size", () => {
    const provider = {
      providerId: "dunedin" as const,
      providerName: "Dunedin City Council planning provider",
    };
    const zone = {
      zone_code: "R1",
      zone_description: "R1 - YES - Dunedin - Dunedin District Plan Zone",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };

    expect(regionalPlanningRuleStatus(provider, zone, 1_200)).toMatchObject({
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: "roi_enabled",
      regionalZoneCode: "DCC_GR1",
      verifiedMinimumLotSqm: 400,
    });
    expect(calculateRegionalPotentialLots({
      provider,
      zone,
      landAreaSqm: 1_200,
    })?.lotResult).toMatchObject({
      lots: 3,
      min_lot_size: 400,
      zone_label: "General Residential 1 Zone",
    });
  });

  it("uses a conservative Dunedin GR2 minimum until wastewater constraints are mapped", () => {
    const result = calculateRegionalPotentialLots({
      provider: {
        providerId: "dunedin",
        providerName: "Dunedin City Council planning provider",
      },
      zone: {
        zone_code: "R2",
        zone_description: "R2 - YES - Mosgiel - Dunedin District Plan Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      landAreaSqm: 900,
    });

    expect(result?.lotResult).toMatchObject({
      lots: 2,
      min_lot_size: 400,
      zone_label: "General Residential 2 Zone",
      sqm_per_lot: 450,
    });
    expect(result?.caveats.join(" ")).toContain("uses 400sqm until wastewater-constraint mapping is verified");
  });

  it("flags Dunedin existing-house/duplex subdivision but blocks pre-1940 demolition risk", () => {
    const provider = {
      providerId: "dunedin" as const,
      providerName: "Dunedin City Council planning provider",
    };
    const zone = {
      zone_code: "R1",
      zone_description: "R1 - YES - Dunedin - Dunedin District Plan Zone",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    };
    const lotResult = calculateRegionalPotentialLots({ provider, zone, landAreaSqm: 650 })!.lotResult;
    const baseInput = {
      provider,
      zone,
      netAreaSqm: lotResult.net_area_sqm,
      zoneCode: "DCC_GR1",
      zoneLabel: lotResult.zone_label,
      standardVacantLots: lotResult.lots,
      minLotSqm: lotResult.min_lot_size,
      typology: "standalone" as const,
      titleConfidence: "verified" as const,
      landAreaConfidence: "verified" as const,
    };

    expect(assessRegionalSubdivisionPathways({ ...baseInput, buildYear: 1960 })).toMatchObject({
      designLedEligible: true,
      designLedYieldRange: { min: 2, max: 2 },
    });
    const blocked = assessRegionalSubdivisionPathways({ ...baseInput, buildYear: 1935 });
    expect(blocked).toMatchObject({
      designLedEligible: false,
      designLedYieldRange: null,
    });
    expect(blocked?.designLedBlockers.join(" ")).toContain("1 January 1940");
  });

  it("preserves the official regional zone description while adding the rules status", () => {
    const description = regionalZoneDescriptionWithRuleStatus(
      {
        zone_code: "21",
        zone_description: "Queenstown Town Centre - QLDC Proposed District Plan Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      {
        providerId: "qldc",
        providerName: "Queenstown Lakes District Council planning provider",
        coverageStatus: "partial",
      },
    );

    expect(description).toContain("Queenstown Town Centre");
    expect(description).toContain("Local subdivision/minimum-lot rules are not modelled yet");
  });

  it("adds verified regional minimum-lot guidance to the zone description when available", () => {
    const description = regionalZoneDescriptionWithRuleStatus(
      {
        zone_code: "Medium Density Residential Zone",
        zone_description: "Medium Density Residential Zone - Whangarei Residential Zone",
        min_lot_size_sqm: null,
        raw_zone: "{}",
      },
      {
        providerId: "whangarei",
        providerName: "Whangarei District Council planning provider",
        coverageStatus: "partial",
      },
    );

    expect(description).toContain("Standard vacant-lot rule pack enabled: 300sqm");
    expect(description).toContain("Whangarei District Plan SUB-R6");
  });

  it("exposes the current rule-pack entries for diagnostics", () => {
    const entries = regionalRulePackEntries();
    expect(entries).toContainEqual(expect.objectContaining({
      providerId: "hamilton",
      regionalZoneCode: "HCC_GRZ",
      standardMinimumLotSqm: 300,
      alternativePathwayLabel: "Concurrent land-use and subdivision pathway",
      roiEnabled: true,
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      providerId: "christchurch",
      regionalZoneCode: "CCC_MRZ",
      standardMinimumLotSqm: 200,
      roiEnabled: true,
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      providerId: "whangarei",
      regionalZoneCode: "WDC_GRZ",
      standardMinimumLotSqm: 400,
      roiEnabled: true,
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      providerId: "qldc",
      regionalZoneCode: "QLDC_MDRZ",
      standardMinimumLotSqm: 250,
      roiEnabled: true,
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      providerId: "dunedin",
      regionalZoneCode: "DCC_GR1",
      standardMinimumLotSqm: 400,
      roiEnabled: true,
    }));
  });

  it("allows interim ROI for unmodelled Rotorua and Whakatane zones without yield claims", () => {
    for (const [providerId, zoneCode] of [
      ["rotorua", "RESZ1"],
      ["whakatane", "General Rural Zone"],
    ] as const) {
      expect(regionalPlanningRuleStatus(
        { providerId, providerName: `${providerId} planning provider` },
        { zone_code: zoneCode, zone_description: zoneCode, min_lot_size_sqm: null, raw_zone: "{}" },
        1_000,
      )).toMatchObject({
        modellingStatus: "roi_enabled",
        automaticRoiAllowed: true,
        automaticYieldClaimsAllowed: false,
      });
    }
  });

  it("matches QLDC Low Density Residential to the Lower Density/Suburban pack", () => {
    expect(regionalPlanningRuleStatus(
      { providerId: "qldc", providerName: "Queenstown Lakes District Council planning provider" },
      { zone_code: "Low Density Residential", zone_description: "Low Density Residential Zone", min_lot_size_sqm: null, raw_zone: "{}" },
      900,
    )).toMatchObject({
      modellingStatus: "roi_enabled",
      automaticRoiAllowed: true,
      regionalZoneCode: "QLDC_LDSRZ",
      verifiedMinimumLotSqm: 450,
    });
  });

  it("enables ROI for the QLDC Large Lot Residential zone", () => {
    expect(regionalPlanningRuleStatus(
      { providerId: "qldc", providerName: "Queenstown Lakes District Council planning provider" },
      { zone_code: "Large Lot Residential", zone_description: "Large Lot Residential Zone", min_lot_size_sqm: null, raw_zone: "{}" },
      6_000,
    )).toMatchObject({
      modellingStatus: "roi_enabled",
      automaticRoiAllowed: true,
      regionalZoneCode: "QLDC_LLRZ",
      verifiedMinimumLotSqm: 2_000,
    });
  });

  it("enables ROI + dev scoring for Wellington-region residential zones", () => {
    const wellington = { providerId: "wellington" as const, providerName: "Wellington region planning provider" };
    // Hutt City Kelson-style Hill Residential (the screenshot property).
    expect(regionalPlanningRuleStatus(
      wellington,
      { zone_code: "Hill Residential", zone_description: "Hill Residential Activity Area", min_lot_size_sqm: null, raw_zone: "{}" },
      900,
    )).toMatchObject({
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: "roi_enabled",
      automaticRoiAllowed: true,
      regionalZoneCode: "WLG_HILLRZ",
      verifiedMinimumLotSqm: 400,
    });
    // Standardised National Planning Standards names used across the region.
    expect(regionalPlanningRuleStatus(
      wellington,
      { zone_code: "General Residential", zone_description: "General Residential Zone", min_lot_size_sqm: null, raw_zone: "{}" },
      800,
    )).toMatchObject({ regionalZoneCode: "WLG_GRZ", automaticRoiAllowed: true, verifiedMinimumLotSqm: 350 });
    expect(regionalPlanningRuleStatus(
      wellington,
      { zone_code: "High Density Residential", zone_description: "High Density Residential Zone", min_lot_size_sqm: null, raw_zone: "{}" },
      800,
    )).toMatchObject({ regionalZoneCode: "WLG_HDRZ", automaticRoiAllowed: true, verifiedMinimumLotSqm: 200 });
    expect(regionalPlanningRuleStatus(
      wellington,
      { zone_code: "Medium Density Residential", zone_description: "Medium Density Residential Zone", min_lot_size_sqm: null, raw_zone: "{}" },
      800,
    )).toMatchObject({ regionalZoneCode: "WLG_MDRZ", automaticRoiAllowed: true, verifiedMinimumLotSqm: 250 });
  });
});
