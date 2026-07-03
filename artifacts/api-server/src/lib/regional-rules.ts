import type { Overlay, ZoneResult } from "./auckland-council";
import type {
  DesignLedAssessmentInput,
  DesignLedConfidence,
  DesignLedYieldRange,
  LotResult,
  SubdivisionPathwayAssessment,
} from "./lot-calculator";
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
  excludedZonePattern?: RegExp;
  blockedOverlayPatterns?: Array<{
    pattern: RegExp;
    caveat: string;
  }>;
  conditionalMinimums?: Array<{
    overlayPattern: RegExp;
    minimumLotSqm: number;
    caveat: string;
  }>;
  alternativePathway?: RegionalAlternativePathwayRule;
  roiEnabled: boolean;
}

interface RegionalAlternativePathwayRule {
  label: string;
  sourceLabel: string;
  sourceUrl: string;
  minNetAreaSqm: number;
  sqmPerDwelling: number;
  maxYield: number;
  confidence: DesignLedConfidence;
  reason: string;
  detail: string;
  blockedOverlayPattern?: RegExp;
  blockedOverlayCaveat?: string;
  extraBlocker?: (input: RegionalSubdivisionPathwayInput) => string | null;
}

export interface RegionalLotAssessment {
  lotResult: LotResult;
  rule: RegionalRulePackEntry;
  effectiveMinimumLotSqm: number;
  sourceLabel: string;
  sourceUrl: string;
  caveats: string[];
}

type RegionalPathwayOverlay = {
  status: string;
  name?: string | null;
  detail?: string | null;
};

export interface RegionalSubdivisionPathwayInput extends Omit<DesignLedAssessmentInput, "overlays"> {
  provider: Pick<PlanningProviderMetadata, "providerId" | "providerName"> | null | undefined;
  zone: ZoneResult | null | undefined;
  overlays?: RegionalPathwayOverlay[] | null;
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
      "Concurrent land-use plus subdivision is modelled separately as a design-led pathway, not as a standard vacant-lot yield.",
    ],
    blockedOverlayPatterns: [
      {
        pattern: /\bhistoric heritage area\b/i,
        caveat: "Hamilton Chapter 23 excludes General Residential land within a Historic Heritage Area from this 300sqm vacant-lot standard.",
      },
    ],
    conditionalMinimums: [
      {
        overlayPattern: /\bwaikato expressway\b/i,
        minimumLotSqm: 1_000,
        caveat: "Hamilton Chapter 23 identifies a 1000sqm minimum for General Residential vacant lots adjoining the Waikato Expressway outside the Rototuna North East Residential Precinct.",
      },
    ],
    alternativePathway: {
      label: "Concurrent land-use and subdivision pathway",
      sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.1(f)",
      sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
      minNetAreaSqm: 450,
      sqmPerDwelling: 180,
      maxYield: 3,
      confidence: "low",
      reason:
        "Hamilton Chapter 23 allows subdivision design standards to be set aside where a fee-simple subdivision is accompanied by a concurrent land-use application for residential units and the subdivision matches the proposed layout.",
      detail:
        "This is a concurrent land-use plus subdivision opportunity. The lot count is capped conservatively and still depends on a buildable layout, access, private-way width, outdoor space, HIRB, services and stormwater.",
    },
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
    alternativePathway: {
      label: "Rotokauri North concurrent land-use pathway",
      sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.1(f)",
      sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
      minNetAreaSqm: 420,
      sqmPerDwelling: 160,
      maxYield: 3,
      confidence: "low",
      reason:
        "Hamilton's concurrent land-use pathway can support subdivision around an approved residential-unit layout, but Rotokauri North remains subject to local structure-plan and access controls.",
      detail:
        "This is a conservative Rotokauri North design-led flag. Confirm the structure-plan layout, rear-lane/access controls, services and residential design before relying on the yield.",
    },
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
      "Concurrent land-use plus subdivision is modelled separately as a design-led pathway, not as a standard vacant-lot yield.",
    ],
    excludedZonePattern: /\b(ruakura|te awa lakes|peacocke)\b/i,
    alternativePathway: {
      label: "Concurrent land-use and subdivision pathway",
      sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.1(f)",
      sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
      minNetAreaSqm: 450,
      sqmPerDwelling: 150,
      maxYield: 3,
      confidence: "low",
      reason:
        "Hamilton Chapter 23 can allow subdivision around a concurrently assessed residential-unit layout rather than the 1200sqm vacant-lot standard.",
      detail:
        "This is a conservative concurrent-consent flag for medium-density land. It excludes Ruakura, Te Awa Lakes and Peacocke precincts until those precinct rule packs are mapped.",
    },
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
      "Concurrent land-use plus subdivision is modelled separately as a design-led pathway, not as a standard vacant-lot yield.",
    ],
    alternativePathway: {
      label: "Concurrent land-use and subdivision pathway",
      sourceLabel: "Hamilton PC12 Chapter 23 Rule 23.7.1(f)",
      sourceUrl: HAMILTON_PC12_SUBDIVISION_SOURCE,
      minNetAreaSqm: 450,
      sqmPerDwelling: 140,
      maxYield: 3,
      confidence: "low",
      reason:
        "Hamilton Chapter 23 can allow subdivision around a concurrently assessed residential-unit layout rather than the 1200sqm vacant-lot standard.",
      detail:
        "This is a conservative high-density concurrent-consent flag. Access, rear-boundary, block layout, services and built-form standards still drive the real yield.",
    },
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
    alternativePathway: {
      label: "Comprehensive residential development pathway",
      sourceLabel: "Christchurch District Plan Chapter 8 objectives and Rule 8.6.1",
      sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
      minNetAreaSqm: 300,
      sqmPerDwelling: 120,
      maxYield: 3,
      confidence: "low",
      reason:
        "Christchurch Chapter 8 supports integrated subdivision and comprehensive development, while HRZ/MRZ land also sits within the MDRS intensification setting.",
      detail:
        "This is a compact-layout opportunity flag for HRZ/MRZ land. The final lot/unit count depends on a compliant residential design, qualifying matters, access, outdoor space, sunlight, stormwater, hazards and infrastructure.",
      blockedOverlayPattern: /\bqualifying matter\b/i,
      blockedOverlayCaveat:
        "A mapped qualifying matter is present, so the report keeps the conservative vacant-lot rule instead of applying a design-led uplift.",
    },
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
    alternativePathway: {
      label: "Comprehensive residential development pathway",
      sourceLabel: "Christchurch District Plan Chapter 8 objectives and Rule 8.6.1",
      sourceUrl: CHRISTCHURCH_CHAPTER8_SOURCE,
      minNetAreaSqm: 300,
      sqmPerDwelling: 130,
      maxYield: 3,
      confidence: "low",
      reason:
        "Christchurch Chapter 8 supports integrated subdivision and comprehensive development, while HRZ/MRZ land also sits within the MDRS intensification setting.",
      detail:
        "This is a compact-layout opportunity flag for HRZ/MRZ land. The final lot/unit count depends on a compliant residential design, qualifying matters, access, outdoor space, sunlight, stormwater, hazards and infrastructure.",
      blockedOverlayPattern: /\bqualifying matter\b/i,
      blockedOverlayCaveat:
        "A mapped qualifying matter is present, so the report keeps the conservative vacant-lot rule instead of applying a design-led uplift.",
    },
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
    alternativePathway: {
      label: "Medium Density unit-title pathway",
      sourceLabel: "Whangarei District Plan SUB-R6",
      sourceUrl: WHANGAREI_SUBDIVISION_SOURCE,
      minNetAreaSqm: 300,
      sqmPerDwelling: 120,
      maxYield: 4,
      confidence: "low",
      reason:
        "Whangarei SUB-R6 provides a separate unit-title pathway with a 50sqm minimum unit-title site, but the actual unit count depends on the approved building design.",
      detail:
        "This is a conservative unit-title opportunity flag for Medium Density Residential land. It does not use the 50sqm legal minimum directly for ROI; it caps the first-pass yield and requires a verified building layout.",
    },
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
    alternativePathway: {
      label: "Approved residential-unit subdivision pathway",
      sourceLabel: "QLDC PDP Chapter 27 Rule 27.7.34",
      sourceUrl: QLDC_SUBDIVISION_SOURCE,
      minNetAreaSqm: 500,
      sqmPerDwelling: 250,
      maxYield: 3,
      confidence: "low",
      reason:
        "QLDC Rule 27.7.34 can disapply the minimum allotment size in Lower Density/Suburban Residential land when a certificate of compliance or resource consent exists for the residential units.",
      detail:
        "This is a design-led opportunity flag only. It assumes a residential-unit design can be consented and tied to the new lots; it is not applied inside the Queenstown Airport Air Noise Boundary or Outer Control Boundary.",
      blockedOverlayPattern: /\b(air noise boundary|outer control boundary)\b/i,
      blockedOverlayCaveat:
        "QLDC Rule 27.7.34 does not apply within the Queenstown Airport Air Noise Boundary or Outer Control Boundary.",
    },
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
      "Existing-house, duplex and multi-unit subdivision exemptions are modelled separately as a design-led pathway, not as a standard vacant-lot yield.",
      "Pre-1940 demolition, stormwater/open-watercourse, access, servicing and other 2GP performance standards still require consent checks.",
    ],
    blockedOverlayPatterns: [
      {
        pattern: /\bno dcc reticulated wastewater\b/i,
        caveat: "Dunedin Variation 2 GR1 minimum-site-size rules do not apply within a no DCC reticulated wastewater mapped area.",
      },
    ],
    alternativePathway: {
      label: "Existing-house or duplex fee-simple pathway",
      sourceLabel: "Dunedin 2GP Variation 2 GR1 subdivision exemption",
      sourceUrl: DUNEDIN_GR1_VARIATION2_SOURCE,
      minNetAreaSqm: 500,
      sqmPerDwelling: 250,
      maxYield: 2,
      confidence: "low",
      reason:
        "Dunedin Variation 2 enables duplexes, multi-unit developments and existing dwellings to be subdivided fee-simple without complying with the minimum site size where performance standards are met.",
      detail:
        "This is a two-unit/duplex or existing-dwelling subdivision opportunity flag. Confirm setbacks, outdoor living, access, solid-waste collection, stormwater and any pre-1940 demolition/heritage rule before relying on it.",
      extraBlocker: (input) =>
        input.buildYear != null && input.buildYear <= 1940
          ? "Dunedin Variation 2 requires resource consent and a heritage assessment for full demolition of buildings built on or before 1 January 1940."
          : null,
    },
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
      "Existing-house, duplex and multi-unit subdivision exemptions are modelled separately as a design-led pathway, not as a standard vacant-lot yield.",
      "Variation 2 mapped-area, pre-1940 demolition, landscaping, solid-waste, stormwater/open-watercourse, access and servicing checks may alter consent requirements.",
    ],
    alternativePathway: {
      label: "Existing-house, duplex or multi-unit fee-simple pathway",
      sourceLabel: "Dunedin 2GP Variation 2 GR2 subdivision exemption",
      sourceUrl: DUNEDIN_GR2_VARIATION2_SOURCE,
      minNetAreaSqm: 500,
      sqmPerDwelling: 250,
      maxYield: 3,
      confidence: "low",
      reason:
        "Dunedin Variation 2 enables duplexes, multi-unit developments and existing dwellings to be subdivided fee-simple without complying with the minimum site size where performance standards are met.",
      detail:
        "This is a compact GR2 subdivision opportunity flag. Confirm habitable-room density, landscaping, solid-waste collection, stormwater/open-watercourse setbacks, access, services and any pre-1940 demolition/heritage rule before relying on it.",
      extraBlocker: (input) =>
        input.buildYear != null && input.buildYear <= 1940
          ? "Dunedin Variation 2 requires resource consent and a heritage assessment for full demolition of buildings built on or before 1 January 1940."
          : null,
    },
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
    (entry) =>
      entry.providerId === provider.providerId &&
      entry.zonePattern.test(text) &&
      !entry.excludedZonePattern?.test(text),
  ) ?? null;
}

function overlayText(overlays: Array<{ name?: string | null; detail?: string | null }> | null | undefined): string {
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
): { effectiveMinimumLotSqm: number; caveats: string[]; blocked: boolean } {
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
  const blockingCaveats: string[] = [];
  for (const blocker of rule.blockedOverlayPatterns ?? []) {
    if (!blocker.pattern.test(text)) continue;
    blockingCaveats.push(blocker.caveat);
  }
  for (const condition of rule.conditionalMinimums ?? []) {
    if (!condition.overlayPattern.test(text)) continue;
    effectiveMinimum = Math.max(effectiveMinimum, condition.minimumLotSqm);
    conditionalCaveats.push(condition.caveat);
  }

  return {
    effectiveMinimumLotSqm: effectiveMinimum,
    caveats: [...rule.caveats, ...conditionalCaveats, ...blockingCaveats],
    blocked: blockingCaveats.length > 0,
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
      modellingStatus: rulePack.roiEnabled && !application.blocked ? "roi_enabled" : "standard_yield_enabled",
      automaticYieldClaimsAllowed: !application.blocked,
      automaticRoiAllowed: rulePack.roiEnabled && !application.blocked,
      regionalZoneCode: rulePack.regionalZoneCode,
      regionalZoneLabel: rulePack.zoneLabel,
      verifiedMinimumLotSqm: application.blocked ? null : application.effectiveMinimumLotSqm,
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
  if (application.blocked) return null;
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

function baseRegionalSubdivisionAssessment(
  input: RegionalSubdivisionPathwayInput,
): Omit<SubdivisionPathwayAssessment, "designLedEligible" | "designLedYieldRange" | "designLedConfidence" | "designLedSummary" | "designLedDetail"> {
  const minLotSqm = input.minLotSqm && input.minLotSqm > 0 ? input.minLotSqm : null;
  const standardVacantLots = Math.max(1, input.standardVacantLots || 1);
  return {
    standardVacantLots,
    standardPathViable: !!minLotSqm && standardVacantLots >= 2,
    standardMinLotSize: minLotSqm,
    designLedReasons: [],
    designLedBlockers: [],
  };
}

function noRegionalDesignLed(
  input: RegionalSubdivisionPathwayInput,
  blocker?: string | null,
): SubdivisionPathwayAssessment {
  const base = baseRegionalSubdivisionAssessment(input);
  if (blocker) base.designLedBlockers.push(blocker);
  return {
    ...base,
    designLedEligible: false,
    designLedYieldRange: null,
    designLedConfidence: "none",
    designLedSummary: null,
    designLedDetail: null,
  };
}

function regionalGeometryLooksConstrained(bbox: DesignLedAssessmentInput["parcelBbox"]): boolean {
  if (!bbox) return false;
  const latSpan = Math.abs(bbox.maxLat - bbox.minLat);
  const lngSpan = Math.abs(bbox.maxLng - bbox.minLng);
  if (latSpan <= 0 || lngSpan <= 0) return false;
  const ratio = Math.max(latSpan, lngSpan) / Math.max(0.000001, Math.min(latSpan, lngSpan));
  return ratio >= 5;
}

export function assessRegionalSubdivisionPathways(
  input: RegionalSubdivisionPathwayInput,
): SubdivisionPathwayAssessment | null {
  if (!input.provider || input.provider.providerId === "auckland-legacy") return null;
  const rule = findRegionalRulePack(input.provider, input.zone);
  if (!rule) return null;
  const alternative = rule.alternativePathway;
  if (!alternative) {
    return noRegionalDesignLed(input, "No verified regional design-led or concurrent subdivision pathway is modelled for this zone yet.");
  }

  const base = baseRegionalSubdivisionAssessment(input);
  const blockers = base.designLedBlockers;
  const reasons = base.designLedReasons;
  const netAreaSqm = input.netAreaSqm && input.netAreaSqm > 0 ? input.netAreaSqm : null;
  const overlaysText = overlayText(input.overlays);

  if (netAreaSqm == null) blockers.push("Verified subject land area is required before testing the regional design-led pathway.");
  if (input.landAreaConfidence != null && input.landAreaConfidence !== "verified") blockers.push("Land area is not verified.");
  if (input.isAlreadySubdividedChild === true) blockers.push("Already-subdivided child titles are excluded from design-led upside screening.");
  if (input.typology != null && input.typology !== "standalone") blockers.push("The title/typology does not read as a standalone redevelopment site.");
  if (input.titleConfidence != null && input.titleConfidence !== "verified") blockers.push("Freehold-style title confidence is not verified.");
  if (input.buildYear != null && input.buildYear >= 2000) blockers.push("Modern post-2000 improvements reduce first-pass redevelopment eligibility.");
  if (alternative.blockedOverlayPattern?.test(overlaysText)) {
    blockers.push(alternative.blockedOverlayCaveat ?? "A mapped overlay blocks this regional design-led pathway.");
  }
  const extraBlocker = alternative.extraBlocker?.(input);
  if (extraBlocker) blockers.push(extraBlocker);
  if (netAreaSqm != null && netAreaSqm < alternative.minNetAreaSqm) {
    blockers.push(`Site area is below the ${alternative.minNetAreaSqm}sqm first-pass threshold for ${alternative.label}.`);
  }

  const confidenceDeductions: string[] = [];
  const restrictedOverlays = (input.overlays ?? []).filter((overlay) => overlay.status === "restricted");
  if (restrictedOverlays.length > 0) confidenceDeductions.push("Restricted overlay(s) may materially constrain the layout.");
  if (input.slopeClass && ["steep", "very_steep"].includes(input.slopeClass)) {
    confidenceDeductions.push("Steep terrain may reduce practical yield.");
  }
  if (regionalGeometryLooksConstrained(input.parcelBbox)) {
    confidenceDeductions.push("Parcel geometry appears narrow or elongated, so access and outlook need early testing.");
  }

  if (netAreaSqm == null || blockers.length > 0) {
    return {
      ...base,
      designLedEligible: false,
      designLedYieldRange: null,
      designLedConfidence: "none",
      designLedSummary: null,
      designLedDetail: null,
    };
  }

  const estimatedMax = Math.max(1, Math.min(alternative.maxYield, Math.floor(netAreaSqm / alternative.sqmPerDwelling)));
  if (estimatedMax <= base.standardVacantLots) {
    blockers.push("Indicative regional design-led yield does not exceed the standard vacant-lot yield.");
    return {
      ...base,
      designLedEligible: false,
      designLedYieldRange: null,
      designLedConfidence: "none",
      designLedSummary: null,
      designLedDetail: null,
    };
  }

  const range: DesignLedYieldRange = {
    min: Math.max(2, Math.min(base.standardVacantLots + 1, estimatedMax)),
    max: estimatedMax,
  };
  const confidence: DesignLedConfidence = confidenceDeductions.length > 0 ? "low" : alternative.confidence;
  const yieldText = range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
  reasons.push(
    alternative.reason,
    `${Math.round(netAreaSqm)}sqm verified net site area is large enough to test ${yieldText} lots/units under ${alternative.label}.`,
    alternative.detail,
    ...confidenceDeductions,
  );

  return {
    ...base,
    designLedEligible: true,
    designLedYieldRange: range,
    designLedConfidence: confidence,
    designLedSummary: `Standard path: ${base.standardVacantLots} lot${base.standardVacantLots === 1 ? "" : "s"}. ${alternative.label} may unlock ${yieldText} lots/units.`,
    designLedDetail: `${alternative.label}: ${alternative.detail} Source: ${alternative.sourceLabel}. This is an opportunity flag, not an approval prediction.`,
  };
}

export function regionalRulePackEntries(): Array<{
  providerId: string;
  regionalZoneCode: string;
  zoneLabel: string;
  standardMinimumLotSqm: number;
  sourceLabel: string;
  alternativePathwayLabel: string | null;
  roiEnabled: boolean;
}> {
  return REGIONAL_RULE_PACKS.map((entry) => ({
    providerId: entry.providerId,
    regionalZoneCode: entry.regionalZoneCode,
    zoneLabel: entry.zoneLabel,
    standardMinimumLotSqm: entry.standardMinimumLotSqm,
    sourceLabel: entry.sourceLabel,
    alternativePathwayLabel: entry.alternativePathway?.label ?? null,
    roiEnabled: entry.roiEnabled,
  }));
}
