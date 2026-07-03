import type { Overlay, ZoneResult } from "./auckland-council";
import type { LotResult } from "./lot-calculator";
import type { PlanningProviderMetadata } from "./regional-planning";

export type RegionalSubdivisionRules = "auckland_legacy" | "standard_yield_modelled" | "not_modelled";
export type RegionalModellingStatus = "facts_only" | "standard_yield_enabled" | "roi_enabled";

export interface RegionalPlanningRuleStatus {
  subdivisionRules: RegionalSubdivisionRules;
  modellingStatus: RegionalModellingStatus;
  automaticYieldClaimsAllowed: boolean;
  automaticRoiAllowed: boolean;
  regionalZoneCode: string | null;
  regionalZoneLabel: string | null;
  verifiedMinimumLotSqm: number | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  caveats: string[];
  note: string | null;
}

interface RegionalRulePackEntry {
  providerId: PlanningProviderMetadata["providerId"];
  regionalZoneCode: string;
  zonePattern: RegExp;
  zoneLabel: string;
  standardMinimumLotSqm: number;
  largeParentThresholdSqm?: number;
  largeParentMinimumLotSqm?: number;
  largeParentAverageLotSqm?: number;
  requiredShapeText: string | null;
  requiredBuildingAreaSqm: number | null;
  sourceLabel: string;
  sourceUrl: string;
  caveats: string[];
  conditionalMinimums?: Array<{
    overlayPattern: RegExp;
    minimumLotSqm: number;
    caveat: string;
  }>;
  roiEnabled: boolean;
}

export interface RegionalLotAssessment {
  lotResult: LotResult;
  rule: RegionalRulePackEntry;
  effectiveMinimumLotSqm: number;
  sourceLabel: string;
  sourceUrl: string;
  caveats: string[];
}

export interface RegionalLotAssessmentInput {
  provider: Pick<PlanningProviderMetadata, "providerId" | "providerName"> | null | undefined;
  zone: ZoneResult | null | undefined;
  landAreaSqm: number | null | undefined;
  easementAreaSqm?: number | null;
  overlays?: Overlay[] | null;
}

const WHANGAREI_SUBDIVISION_SOURCE = "https://eplan.wdc.govt.nz/plan/?chapter=subdivision";
const HAMILTON_PC12_SUBDIVISION_SOURCE =
  "https://hamilton.govt.nz/assets/Uploads/Documents/Content-Documents/Property-Rates-and-Building/PC12-Growing-Up/IHP-recommendation/Clean-Change-Version/Chapters/PC12-Chapter-23-Subdivision-IPI-Recommendations-Clean-Version-November-2024.pdf";
const CHRISTCHURCH_CHAPTER8_SOURCE =
  "https://ccc.govt.nz/assets/Documents/The-Council/Plans-Strategies-Policies-Bylaws/Plans/district-plan/Print-Chapters/Chapter-8.pdf";
const QLDC_SUBDIVISION_SOURCE =
  "https://www.qldc.govt.nz/media/ez5gvf4t/pdp-chapter-27-subdivision-and-development-28-mar-2024.pdf";
const DUNEDIN_GR1_VARIATION2_SOURCE =
  "https://www.dunedin.govt.nz/__data/assets/pdf_file/0012/873498/V2-Rule-Changes-in-General-Res1-and-Township-Settlement-Zones-updated.pdf";
const DUNEDIN_GR2_VARIATION2_SOURCE =
  "https://www.dunedin.govt.nz/__data/assets/pdf_file/0011/873497/V2-General-Residential-2-Rezoning-updated.pdf";

const REGIONAL_RULE_PACKS: RegionalRulePackEntry[] = [
  {
    providerId: "hamilton",
    regionalZoneCode: "HCC_GRZ",
    zonePattern: /\bgeneral residential\b/i,
    zoneLabel: "General Residential Zone",
    standardMinimumLotSqm: 300,
    requiredShapeText: "Every vacant lot can contain a 12.5m diameter circle.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.2",
    sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
    caveats: [
      "Rule 23.7.2 has special cases for Historic Heritage Areas and General Residential land adjoining the Waikato Expressway.",
      "Rules 23.7.3 and 25.14 also require frontage, access, private-way, block layout and vehicle-crossing checks.",
      "Concurrent land-use plus subdivision pathways are not used in this first-pass vacant-lot model.",
    ],
    conditionalMinimums: [
      {
        overlayPattern: /\bwaikato expressway\b/i,
        minimumLotSqm: 1_000,
        caveat: "Hamilton Chapter 23 identifies a 1000sqm minimum for General Residential vacant lots adjoining the Waikato Expressway outside the Rototuna North East Residential Precinct.",
      },
    ],
    roiEnabled: true,
  },
  {
    providerId: "hamilton",
    regionalZoneCode: "HCC_RN_MDRZ",
    zonePattern: /\brotokauri north\b.*\b(residential|medium[- ]density)\b|\b(residential|medium[- ]density)\b.*\brotokauri north\b/i,
    zoneLabel: "Rotokauri North Residential Precinct",
    standardMinimumLotSqm: 280,
    requiredShapeText: "Rotokauri North vacant-lot standards include frontage, depth, access and block-layout controls.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.2",
    sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
    caveats: [
      "The 280sqm standard applies to vacant lots in the Rotokauri North Residential Precinct.",
      "Rules 23.7.4 and local structure-plan controls still require frontage, access, private-way, rear-lane and block-layout checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "hamilton",
    regionalZoneCode: "HCC_MDRZ",
    zonePattern: /\bmedium[- ]density residential\b|\bmedium density\b/i,
    zoneLabel: "Medium Density Residential Zone",
    standardMinimumLotSqm: 1_200,
    requiredShapeText: "Every standard vacant lot can contain a rectangle of at least 15m by 20m.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.2",
    sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
    caveats: [
      "The 1200sqm standard excludes Rotokauri North, Ruakura, Te Awa Lakes and Peacocke residential precinct rules.",
      "Rules 23.7.4 and 25.14 also require frontage, lot depth, access, private-way, block layout and vehicle-crossing checks.",
      "Concurrent land-use plus subdivision pathways are not used in this first-pass vacant-lot model.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "hamilton",
    regionalZoneCode: "HCC_HDRZ",
    zonePattern: /\bhigh[- ]density residential\b|\bhigh density\b/i,
    zoneLabel: "High Density Residential Zone",
    standardMinimumLotSqm: 1_200,
    requiredShapeText: "Every vacant lot can contain a rectangle of at least 15m by 20m.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.2",
    sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
    caveats: [
      "Rules 23.7.5 and 25.14 also require frontage, rear-boundary, access, private-way, block layout and vehicle-crossing checks.",
      "Concurrent land-use plus subdivision pathways are not used in this first-pass vacant-lot model.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_HRZ",
    zonePattern: /\b(hrz|high density residential)\b/i,
    zoneLabel: "High Density Residential Zone",
    standardMinimumLotSqm: 200,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 applies minimum net site area and dimension controls, including a 300sqm exception where a qualifying matter area applies.",
      "Access, shape, hazards, water-body setbacks, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
      "Residential New Neighbourhood density and comprehensive development pathways are not used in this first-pass vacant-lot model.",
    ],
    conditionalMinimums: [
      {
        overlayPattern: /\bqualifying matter\b/i,
        minimumLotSqm: 300,
        caveat: "Christchurch Rule 8.6.1 uses a 300sqm minimum for HRZ/MRZ subdivision where a qualifying matter area applies.",
      },
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_MRZ",
    zonePattern: /\b(mrz|rmd|medium density residential|residential medium density)\b/i,
    zoneLabel: "Medium Density Residential Zone",
    standardMinimumLotSqm: 200,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 applies minimum net site area and dimension controls, including a 300sqm exception where a qualifying matter area applies.",
      "Access, shape, hazards, water-body setbacks, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
      "Residential New Neighbourhood density and comprehensive development pathways are not used in this first-pass vacant-lot model.",
    ],
    conditionalMinimums: [
      {
        overlayPattern: /\bqualifying matter\b/i,
        minimumLotSqm: 300,
        caveat: "Christchurch Rule 8.6.1 uses a 300sqm minimum for HRZ/MRZ subdivision where a qualifying matter area applies.",
      },
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_RSDT",
    zonePattern: /\b(rsdt|residential suburban density transition)\b/i,
    zoneLabel: "Residential Suburban Density Transition Zone",
    standardMinimumLotSqm: 330,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 minimum net site area and dimensions are only the first-pass vacant-lot screen.",
      "Access, shape, hazards, water-body setbacks, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_RS",
    zonePattern: /\b(rs|residential suburban)\b/i,
    zoneLabel: "Residential Suburban Zone",
    standardMinimumLotSqm: 450,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 minimum net site area and dimensions are only the first-pass vacant-lot screen.",
      "Access, shape, hazards, water-body setbacks, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_RBP",
    zonePattern: /\b(rbp|residential banks peninsula)\b/i,
    zoneLabel: "Residential Banks Peninsula Zone",
    standardMinimumLotSqm: 450,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 minimum net site area and dimensions are only the first-pass vacant-lot screen.",
      "Access, shape, hazards, water-body setbacks, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_RH",
    zonePattern: /\b(rh|residential hills)\b/i,
    zoneLabel: "Residential Hills Zone",
    standardMinimumLotSqm: 650,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 minimum net site area and dimensions are only the first-pass vacant-lot screen.",
      "Access, shape, hazards, water-body setbacks, slope stability, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "christchurch",
    regionalZoneCode: "CCC_RLL",
    zonePattern: /\b(rll|residential large lot)\b/i,
    zoneLabel: "Residential Large Lot Zone",
    standardMinimumLotSqm: 1_500,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Christchurch District Plan Chapter 8 Rule 8.6.1",
    sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
    caveats: [
      "Rule 8.6.1 minimum net site area and dimensions are only the first-pass vacant-lot screen.",
      "Access, shape, hazards, water-body setbacks, infrastructure, heritage and other Chapter 8 performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "whangarei",
    regionalZoneCode: "WDC_GRZ",
    zonePattern: /\bgeneral residential\b/i,
    zoneLabel: "General Residential Zone",
    standardMinimumLotSqm: 400,
    largeParentThresholdSqm: 10_000,
    largeParentMinimumLotSqm: 320,
    largeParentAverageLotSqm: 400,
    requiredShapeText: "Every site can contain a rectangle of at least 8m by 15m.",
    requiredBuildingAreaSqm: 100,
    sourceLabel: "Whangarei District Plan SUB-R5",
    sourceUrl: WHANGAREI_SUBDIVISION_SOURCE,
    caveats: [
      "SUB-R5 also requires frontage/shape, building-area and other district-plan checks.",
      "For parent sites of at least 1ha, the plan allows at least 320sqm per site while requiring an average of at least 400sqm.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "whangarei",
    regionalZoneCode: "WDC_MRZ",
    zonePattern: /\bmedium density residential\b/i,
    zoneLabel: "Medium Density Residential Zone",
    standardMinimumLotSqm: 300,
    largeParentThresholdSqm: 10_000,
    largeParentMinimumLotSqm: 240,
    requiredShapeText: "Every site can contain a rectangle of at least 8m by 15m.",
    requiredBuildingAreaSqm: 100,
    sourceLabel: "Whangarei District Plan SUB-R6",
    sourceUrl: WHANGAREI_SUBDIVISION_SOURCE,
    caveats: [
      "SUB-R6 also requires shape/building-area and other district-plan checks.",
      "Unit-title subdivision has separate 50sqm minimum-site wording and is not used for this standard vacant-lot yield model.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "whangarei",
    regionalZoneCode: "WDC_LDRZ",
    zonePattern: /\blow density residential\b/i,
    zoneLabel: "Low Density Residential Zone",
    standardMinimumLotSqm: 2_000,
    requiredShapeText: "Every site can contain a circle with a diameter of 16m, or a square of at least 14m by 14m.",
    requiredBuildingAreaSqm: 100,
    sourceLabel: "Whangarei District Plan SUB-R4",
    sourceUrl: WHANGAREI_SUBDIVISION_SOURCE,
    caveats: [
      "SUB-R4 also requires a compliant building area, shape and other district-plan checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "qldc",
    regionalZoneCode: "QLDC_HDRZ",
    zonePattern: /\b(high density residential|residential high density)\b/i,
    zoneLabel: "High Density Residential Zone",
    standardMinimumLotSqm: 450,
    requiredShapeText: "Every site can contain a square of at least 15m by 15m.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "QLDC PDP Chapter 27 Rule 27.6.1",
    sourceUrl: QLDC_SUBDIVISION_SOURCE,
    caveats: [
      "Chapter 27 also requires minimum dimensions, access, servicing/infrastructure and location-specific checks.",
      "Infill, unit-title, structure-plan and protected-item subdivision rules are not reduced to this first-pass vacant-lot model.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "qldc",
    regionalZoneCode: "QLDC_MDRZ",
    zonePattern: /\b(medium density residential|residential medium density)\b/i,
    zoneLabel: "Medium Density Residential Zone",
    standardMinimumLotSqm: 250,
    requiredShapeText: "Every site can contain a square of at least 12m by 12m.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "QLDC PDP Chapter 27 Rule 27.6.1",
    sourceUrl: QLDC_SUBDIVISION_SOURCE,
    caveats: [
      "Chapter 27 also requires minimum dimensions, access, servicing/infrastructure and location-specific checks.",
      "Infill, unit-title, structure-plan and protected-item subdivision rules are not reduced to this first-pass vacant-lot model.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "qldc",
    regionalZoneCode: "QLDC_LDSRZ",
    zonePattern: /\b(lower density suburban|suburban residential)\b/i,
    zoneLabel: "Lower Density/Suburban Residential Zone",
    standardMinimumLotSqm: 450,
    requiredShapeText: "Every site can contain a square of at least 15m by 15m.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "QLDC PDP Chapter 27 Rule 27.6.1",
    sourceUrl: QLDC_SUBDIVISION_SOURCE,
    caveats: [
      "Chapter 27 also requires minimum dimensions, access, servicing/infrastructure and location-specific checks.",
      "Rule 27.7.34 can allow smaller Lower Density Suburban lots only where residential-unit approvals are already in place; this first-pass vacant-lot model does not use that exception.",
    ],
    conditionalMinimums: [
      {
        overlayPattern: /\b(air noise boundary|outer control boundary)\b/i,
        minimumLotSqm: 600,
        caveat: "QLDC Chapter 27 sets a 600sqm minimum for Lower Density Suburban Residential land within the Queenstown Airport Air Noise Boundary or Outer Control Boundary.",
      },
      {
        overlayPattern: /\blake hawea south\b.*\barea b\b|\barea b\b.*\blake hawea south\b/i,
        minimumLotSqm: 800,
        caveat: "QLDC Chapter 27 sets an 800sqm minimum for Lower Density Suburban Residential land at Lake Hawea South Area B.",
      },
    ],
    roiEnabled: true,
  },
  {
    providerId: "dunedin",
    regionalZoneCode: "DCC_GR1",
    zonePattern: /(^|\s)(r1|gr1)\b|\bgeneral residential 1\b/i,
    zoneLabel: "General Residential 1 Zone",
    standardMinimumLotSqm: 400,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Dunedin 2GP Variation 2 GR1 minimum site size",
    sourceUrl: DUNEDIN_GR1_VARIATION2_SOURCE,
    caveats: [
      "Variation 2 applies the 400sqm fee-simple minimum to General Residential 1 land except within a no DCC reticulated wastewater mapped area.",
      "Existing-house, duplex and multi-unit subdivision exemptions are not used in this first-pass vacant-lot model.",
      "Pre-1940 demolition, stormwater/open-watercourse, access, servicing and other 2GP performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "dunedin",
    regionalZoneCode: "DCC_GR2",
    zonePattern: /(^|\s)(r2|gr2)\b|\bgeneral residential 2\b/i,
    zoneLabel: "General Residential 2 Zone",
    standardMinimumLotSqm: 400,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Dunedin 2GP Variation 2 GR2 conservative minimum site size",
    sourceUrl: DUNEDIN_GR2_VARIATION2_SOURCE,
    caveats: [
      "General Residential 2 fee-simple subdivision is 300sqm in the standard case, or 400sqm where a wastewater constraint mapped area applies except in Mosgiel; this model uses 400sqm until wastewater-constraint mapping is verified.",
      "Existing-house, duplex and multi-unit subdivision exemptions are not used in this first-pass vacant-lot model.",
      "Variation 2 mapped-area, pre-1940 demolition, landscaping, solid-waste, stormwater/open-watercourse, access and servicing checks may alter consent requirements.",
    ],
    roiEnabled: true,
  },
];

function zoneText(zone: ZoneResult | null | undefined): string {
  return [zone?.zone_code, zone?.zone_description, zone?.raw_zone]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ");
}

function findRegionalRulePack(
  provider: Pick<PlanningProviderMetadata, "providerId">,
  zone: ZoneResult | null | undefined,
): RegionalRulePackEntry | null {
  const text = zoneText(zone);
  if (!text) return null;
  return REGIONAL_RULE_PACKS.find(
    (entry) => entry.providerId === provider.providerId && entry.zonePattern.test(text),
  ) ?? null;
}

function overlayText(overlays: Overlay[] | null | undefined): string {
  return (overlays ?? [])
    .map((overlay) => `${overlay.name ?? ""} ${overlay.detail ?? ""}`)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function resolveRuleApplication(
  rule: RegionalRulePackEntry,
  netAreaSqm: number | null | undefined,
  overlays?: Overlay[] | null,
): { effectiveMinimumLotSqm: number; caveats: string[] } {
  let effectiveMinimum = rule.standardMinimumLotSqm;
  if (
    netAreaSqm != null &&
    Number.isFinite(netAreaSqm) &&
    rule.largeParentThresholdSqm != null &&
    netAreaSqm >= rule.largeParentThresholdSqm
  ) {
    effectiveMinimum = rule.largeParentAverageLotSqm ?? rule.largeParentMinimumLotSqm ?? rule.standardMinimumLotSqm;
  }

  const text = overlayText(overlays);
  const conditionalCaveats: string[] = [];
  for (const condition of rule.conditionalMinimums ?? []) {
    if (!condition.overlayPattern.test(text)) continue;
    effectiveMinimum = Math.max(effectiveMinimum, condition.minimumLotSqm);
    conditionalCaveats.push(condition.caveat);
  }

  return {
    effectiveMinimumLotSqm: effectiveMinimum,
    caveats: [...rule.caveats, ...conditionalCaveats],
  };
}

function ruleNote(
  provider: Pick<PlanningProviderMetadata, "providerName">,
  rule: RegionalRulePackEntry,
  effectiveMinLotSqm: number,
  caveats: string[],
): string {
  return `${provider.providerName} ${rule.zoneLabel} standard vacant-lot rule is modelled from ${rule.sourceLabel}: ${effectiveMinLotSqm}sqm per vacant site for this first-pass yield. ${caveats.join(" ")} ROI may be shown only when title, land area, CV/acquisition value and comparables are also available.`;
}

export function regionalPlanningRuleStatus(
  provider: Pick<PlanningProviderMetadata, "providerId" | "providerName"> | null | undefined,
  zone?: ZoneResult | null,
  landAreaSqm?: number | null,
  overlays?: Overlay[] | null,
): RegionalPlanningRuleStatus {
  if (!provider || provider.providerId === "auckland-legacy") {
    return {
      subdivisionRules: "auckland_legacy",
      modellingStatus: "roi_enabled",
      automaticYieldClaimsAllowed: true,
      automaticRoiAllowed: true,
      regionalZoneCode: null,
      regionalZoneLabel: null,
      verifiedMinimumLotSqm: null,
      sourceLabel: null,
      sourceUrl: null,
      caveats: [],
      note: null,
    };
  }

  const rulePack = findRegionalRulePack(provider, zone);
  if (rulePack) {
    const application = resolveRuleApplication(rulePack, landAreaSqm, overlays);
    return {
      subdivisionRules: "standard_yield_modelled",
      modellingStatus: rulePack.roiEnabled ? "roi_enabled" : "standard_yield_enabled",
      automaticYieldClaimsAllowed: true,
      automaticRoiAllowed: rulePack.roiEnabled,
      regionalZoneCode: rulePack.regionalZoneCode,
      regionalZoneLabel: rulePack.zoneLabel,
      verifiedMinimumLotSqm: application.effectiveMinimumLotSqm,
      sourceLabel: rulePack.sourceLabel,
      sourceUrl: rulePack.sourceUrl,
      caveats: application.caveats,
      note: ruleNote(provider, rulePack, application.effectiveMinimumLotSqm, application.caveats),
    };
  }

  return {
    subdivisionRules: "not_modelled",
    modellingStatus: "facts_only",
    automaticYieldClaimsAllowed: false,
    automaticRoiAllowed: false,
    regionalZoneCode: null,
    regionalZoneLabel: null,
    verifiedMinimumLotSqm: null,
    sourceLabel: null,
    sourceUrl: null,
    caveats: [],
    note: `${provider.providerName} zone facts are available, but local subdivision/minimum-lot rules are not modelled yet. The report should not infer multi-lot yield or ROI automatically for this region.`,
  };
}

export function regionalZoneDescriptionWithRuleStatus(
  zone: ZoneResult | null | undefined,
  provider: Pick<PlanningProviderMetadata, "providerId" | "providerName" | "coverageStatus"> | null | undefined,
  landAreaSqm?: number | null,
  overlays?: Overlay[] | null,
): string | null {
  const base = zone?.zone_description?.trim() || null;
  if (!provider || provider.providerId === "auckland-legacy") return base;

  const ruleStatus = regionalPlanningRuleStatus(provider, zone, landAreaSqm, overlays);
  const suffix = ruleStatus.subdivisionRules === "standard_yield_modelled" && ruleStatus.verifiedMinimumLotSqm
    ? `${provider.providerName} selected (${provider.coverageStatus} coverage). Standard vacant-lot rule pack enabled: ${ruleStatus.verifiedMinimumLotSqm}sqm per vacant site from ${ruleStatus.sourceLabel}.`
    : `${provider.providerName} selected (${provider.coverageStatus} coverage). Local subdivision/minimum-lot rules are not modelled yet.`;
  return base ? `${base} - ${suffix}` : suffix;
}

export function calculateRegionalPotentialLots(input: RegionalLotAssessmentInput): RegionalLotAssessment | null {
  if (!input.provider || input.provider.providerId === "auckland-legacy") return null;
  const rule = findRegionalRulePack(input.provider, input.zone);
  if (!rule || !rule.roiEnabled) return null;

  const grossArea = Math.max(0, input.landAreaSqm ?? 0);
  const easementArea = Math.max(0, input.easementAreaSqm ?? 0);
  const netArea = Math.max(0, grossArea - easementArea);
  const application = resolveRuleApplication(rule, netArea, input.overlays);
  const minLotSqm = application.effectiveMinimumLotSqm;
  const rawLots = Math.floor((netArea + 0.000001) / minLotSqm);
  const lots = Math.max(1, Math.min(20, rawLots));

  return {
    lotResult: {
      lots,
      min_lot_size: minLotSqm,
      zone_label: rule.zoneLabel,
      sqm_per_lot: Math.round((netArea || grossArea || 0) / lots),
      gross_area_sqm: grossArea,
      net_area_sqm: netArea,
      easement_area_sqm: easementArea,
    },
    rule,
    effectiveMinimumLotSqm: minLotSqm,
    sourceLabel: rule.sourceLabel,
    sourceUrl: rule.sourceUrl,
    caveats: application.caveats,
  };
}

export function regionalRulePackEntries(): Array<{
  providerId: string;
  regionalZoneCode: string;
  zoneLabel: string;
  standardMinimumLotSqm: number;
  sourceLabel: string;
  roiEnabled: boolean;
}> {
  return REGIONAL_RULE_PACKS.map((entry) => ({
    providerId: entry.providerId,
    regionalZoneCode: entry.regionalZoneCode,
    zoneLabel: entry.zoneLabel,
    standardMinimumLotSqm: entry.standardMinimumLotSqm,
    sourceLabel: entry.sourceLabel,
    roiEnabled: entry.roiEnabled,
  }));
}
