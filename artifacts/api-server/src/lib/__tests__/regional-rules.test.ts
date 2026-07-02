import { describe, expect, it } from "vitest";
import {
  regionalPlanningRuleStatus,
  regionalZoneDescriptionWithRuleStatus,
} from "../regional-rules";

describe("regional planning rule status", () => {
  it("allows automatic yield only for the Auckland legacy provider", () => {
    expect(regionalPlanningRuleStatus(null)).toMatchObject({
      subdivisionRules: "auckland_legacy",
      automaticYieldClaimsAllowed: true,
      verifiedMinimumLotSqm: null,
      note: null,
    });
    expect(regionalPlanningRuleStatus({
      providerId: "auckland-legacy",
      providerName: "Auckland Council legacy GIS",
    })).toMatchObject({
      subdivisionRules: "auckland_legacy",
      automaticYieldClaimsAllowed: true,
    });
  });

  it("blocks automatic yield claims for regional providers until local rules are modelled", () => {
    expect(regionalPlanningRuleStatus({
      providerId: "qldc",
      providerName: "Queenstown Lakes District Council planning provider",
    })).toMatchObject({
      subdivisionRules: "not_modelled",
      automaticYieldClaimsAllowed: false,
      verifiedMinimumLotSqm: null,
    });
  });

  it("exposes verified minimum-lot guidance without enabling automatic regional yield", () => {
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
      subdivisionRules: "verified_guidance",
      automaticYieldClaimsAllowed: false,
      verifiedMinimumLotSqm: 400,
      sourceLabel: "Whangarei District Plan SUB-R5",
    });
    expect(status.note).toContain("Automated yield/ROI modelling remains disabled");
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

    expect(description).toContain("Minimum-lot guidance: 300sqm");
    expect(description).toContain("automated yield modelling is not enabled");
  });
});
