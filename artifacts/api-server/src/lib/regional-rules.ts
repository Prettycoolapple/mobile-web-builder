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
  standardMinimumLotSqm: number | null;
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
const WAIPA_MDRZ_SUBDIVISION_SOURCE =
  "https://www.waipadc.govt.nz/our-services/planning-and-resource-consents/planning-updates/new-rules-for-building-homes-in-cambridge-kihikihi-and-te-awamutu/medium-density-subdivision-guide";
const CHRISTCHURCH_CHAPTER8_SOURCE =
  "https://ccc.govt.nz/assets/Documents/The-Council/Plans-Strategies-Policies-Bylaws/Plans/district-plan/Print-Chapters/Chapter-8.pdf";
const QLDC_SUBDIVISION_SOURCE =
  "https://www.qldc.govt.nz/media/ez5gvf4t/pdp-chapter-27-subdivision-and-development-28-mar-2024.pdf";
const WAIRARAPA_COMBINED_DISTRICT_PLAN_SOURCE =
  "https://www.mstn.govt.nz/council/plans-and-strategies/plans/wairarapa-combined-district-plan";
const MPDC_DISTRICT_PLAN_SOURCE = "https://www.mpdc.govt.nz/district-plan";
const PNCC_SUBDIVISION_SOURCE =
  "https://www.pncc.govt.nz/Rates-Building-Property/Property-housing/Subdivisions/Before-you-start";
const MDC_SUBDIVISION_SOURCE =
  "https://www.mdc.govt.nz/__data/assets/pdf_file/0020/173117/SUB-Subdivision-2.pdf";
const WELLINGTON_DISTRICT_PLAN_SOURCE =
  "https://www.huttcity.govt.nz/council/district-plan";
const DUNEDIN_GR1_VARIATION2_SOURCE =
  "https://www.dunedin.govt.nz/__data/assets/pdf_file/0012/873498/V2-Rule-Changes-in-General-Res1-and-Township-Settlement-Zones-updated.pdf";
const DUNEDIN_GR2_VARIATION2_SOURCE =
  "https://www.dunedin.govt.nz/__data/assets/pdf_file/0011/873497/V2-General-Residential-2-Rezoning-updated.pdf";
const WESTERN_BAY_SUBDIVISION_SOURCE =
  "https://www.westernbay.govt.nz/property-rates-and-building/district-plan-and-resource-consents/district-plan";
const NAPIER_DISTRICT_PLAN_SOURCE = "https://eplan.napier.govt.nz/eplan2025";
const TAURANGA_CITY_PLAN_SOURCE =
  "https://www.tauranga.govt.nz/council/strategies-and-plans/tauranga-city-plan/how-to-use-the-city-plan";
const KAPITI_RURAL_LIFESTYLE_SOURCE =
  "https://www.kapiticoast.govt.nz/media/o0rhtal1/rurallifestylezone_218_20-aug-2025.pdf";
const SELWYN_LLRZ_SUBDIVISION_SOURCE =
  "https://www.selwyn.govt.nz/property-And-building/planning/strategies-and-plans/selwyn-district-plan/selwyn-district-plan-review/variation-to-proposed-selwyn-district-plan/variation-1-mdrs2/variationhearings/quick-links-to-notified-hearing-topics/variation-rezone-prebbleton/s42a-report/Appendix-3-Selwyn-Residential-Capacity-and-Demand-Model-IPI.pdf";
const TAUPO_RURAL_LIFESTYLE_SOURCE =
  "https://www.taupodc.govt.nz/council/consultation/zclosed-consultations/2024/taupo-district-plan-changes-38-43/plan-change-42-general-rural-and-rural-lifestyle-environments";

const INTERIM_COMPARABLE_ROI_PROVIDERS = new Set<PlanningProviderMetadata["providerId"]>([
  "hamilton",
  "waipa",
  "nelson",
  "qldc",
  "whangarei",
  "wairarapa",
  "kapiti",
  "selwyn",
  "matamata-piako",
  "manawatu",
  "taupo",
  "rotorua",
  "whakatane",
  "western-bay",
  "tauranga",
  "napier",
  "southland",
]);

const REGIONAL_RULE_PACKS: RegionalRulePackEntry[] = [
  {
    providerId: "taupo",
    regionalZoneCode: "TDC_RLE",
    zonePattern: /\brural lifestyle (?:environment|zone)\b/i,
    zoneLabel: "Taupō Rural Lifestyle Environment",
    standardMinimumLotSqm: 20_000,
    requiredShapeText: "Each proposed allotment must provide suitable access and building platforms and demonstrate adequate on-site or network servicing and stormwater management.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Operative Taupō District Plan Change 42 Rural Lifestyle subdivision provisions",
    sourceUrl: TAUPO_RURAL_LIFESTYLE_SOURCE,
    caveats: [
      "The 2ha threshold supports a first-pass yield only. Where Rural Lifestyle land adjoins the General Rural Environment, lots from 2ha to under 4ha require discretionary consent; 4ha or larger lots follow the controlled pathway.",
      "Land Use Capability Class 3 soils, geothermal controls, natural hazards, contaminated land, access and natural-value overlays can change activity status or reduce real yield.",
      "Rural properties generally self-service. A mapped council pipe near or within a parcel does not establish a legal lateral, network capacity, approval or a right to connect.",
      "Existing dwellings, easements, shape and suitable building platforms have not been survey-designed in this first-pass lot count.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "selwyn",
    regionalZoneCode: "SDC_LLRZ",
    zonePattern: /\b(?:llrz|large lot residential zone)\b/i,
    zoneLabel: "Selwyn Large Lot Residential Zone",
    standardMinimumLotSqm: 5_000,
    requiredShapeText: "Each proposed allotment must satisfy the Selwyn Large Lot Residential Zone subdivision, access, servicing and site-shape standards.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Partially Operative Selwyn District Plan Large Lot Residential Zone subdivision standard",
    sourceUrl: SELWYN_LLRZ_SUBDIVISION_SOURCE,
    caveats: [
      "The district residential-capacity evidence models the Large Lot Residential Zone at a 5,000sqm plan-enabled lot size; confirm the current ePlan rule and any site-specific consent notice before relying on yield.",
      "A gross site smaller than 5,000sqm does not support an additional standard vacant allotment in this first-pass model.",
      "Access, existing buildings, easements, Plains Flood Management and airport bird-strike controls can further constrain development.",
      "Mapped public water, wastewater and stormwater assets do not confirm a private lateral, legal connection right or available network capacity.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "kapiti",
    regionalZoneCode: "KCDC_RLZ",
    zonePattern: /\b(?:rlz|rural lifestyle zone|rural\s*-\s*residential)\b/i,
    zoneLabel: "Kāpiti Coast Rural Lifestyle Zone",
    // SUB-RUR-R51 requires a minimum average allotment area of 1ha and a
    // minimum individual allotment area of 4,000sqm. The first-pass yield must
    // therefore divide by the controlling 1ha average, not the smaller floor.
    standardMinimumLotSqm: 10_000,
    requiredShapeText: "Each allotment must satisfy the Rural Lifestyle Zone subdivision standards, including a minimum individual area of 4,000sqm and the applicable access, building-area and hazard requirements.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Kāpiti Coast District Plan SUB-RUR-R51 Rural Lifestyle subdivision standards",
    sourceUrl: KAPITI_RURAL_LIFESTYLE_SOURCE,
    caveats: [
      "The restricted-discretionary pathway requires at least 1 hectare average allotment area across the subdivision and at least 4,000sqm for every individual allotment.",
      "This is a gross first-pass yield only. Access, shape, servicing, consent notices, existing buildings and the 1ha average can reduce the practical number of lots.",
      "Flood, ponding, overflow-path, coastal-environment, tsunami, airport-surface and wind controls require site-specific planning and engineering review at Otaihanga.",
      "Nearby public assets do not prove that the property has private laterals or that network capacity is available for extra allotments.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "manawatu",
    regionalZoneCode: "PNCC_RESIDENTIAL_500",
    zonePattern: /^residential\b.*\bpalmerston north city district plan zone\b.*\bpncc 500sqm residential locality\b/i,
    zoneLabel: "Palmerston North Residential Zone (Ashhurst, Bunnythorpe or Longburn)",
    standardMinimumLotSqm: 500,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "PNCC District Plan Section 7 residential subdivision requirements",
    sourceUrl: PNCC_SUBDIVISION_SOURCE,
    caveats: [
      "The 500sqm controlled-activity minimum applies in Ashhurst, Bunnythorpe, Longburn village and the Napier Road Extension Area; confirm the mapped sub-area before relying on yield.",
      "Access, shape, existing buildings, hazards and three-waters capacity remain site-specific consent and engineering checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "manawatu",
    regionalZoneCode: "PNCC_RESIDENTIAL",
    zonePattern: /^residential\b.*\bpalmerston north city district plan zone\b/i,
    excludedZonePattern: /\bpncc 500sqm residential locality\b/i,
    zoneLabel: "Palmerston North Residential Zone",
    standardMinimumLotSqm: 350,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "PNCC District Plan Section 7 residential subdivision requirements",
    sourceUrl: PNCC_SUBDIVISION_SOURCE,
    caveats: [
      "The 350sqm controlled-activity minimum applies in the Palmerston North urban area; a two-lot site generally needs about 750sqm including driveway allowance.",
      "Napier Road Extension, Ashhurst, Bunnythorpe and Longburn use a 500sqm minimum and are excluded from this rule where the locality can be identified automatically.",
      "Access, shape, existing buildings, hazards and three-waters capacity remain site-specific consent and engineering checks.",
    ],
    conditionalMinimums: [
      {
        overlayPattern: /\bnapier road residential extension area\b/i,
        minimumLotSqm: 500,
        caveat: "PNCC Section 7 applies a 500sqm controlled-activity minimum in the mapped Napier Road Residential Extension Area.",
      },
      {
        overlayPattern: /\baokautere development area\b/i,
        minimumLotSqm: 600,
        caveat: "PNCC Section 7 requires at least 400sqm of contiguous developable land per Aokautere lot and at least 600sqm average lot area; the yield screen conservatively uses 600sqm.",
      },
      {
        overlayPattern: /\bparklands area\b/i,
        minimumLotSqm: 1_300,
        caveat: "PNCC Section 7 requires 1300sqm of contiguous developable land per lot in the Aokautere Parklands Area.",
      },
    ],
    roiEnabled: true,
  },
  {
    providerId: "manawatu",
    regionalZoneCode: "MDC_RESIDENTIAL",
    zonePattern: /^residential\b.*\bmanawatu district plan zone\b/i,
    zoneLabel: "Manawatu District General Residential Zone",
    standardMinimumLotSqm: 500,
    requiredShapeText: "Each new site must be capable of containing an 18m diameter circle.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Manawatu District Plan SUB-ST1 to SUB-ST10",
    sourceUrl: MDC_SUBDIVISION_SOURCE,
    caveats: [
      "The existing General Residential Zone greenfield minimum is 500sqm net site area; mapped Growth Precinct density areas use different standards.",
      "Lots under 5,000sqm must connect to reticulated wastewater, and subdivision must address stormwater neutrality, access, shape and applicable structure plans.",
      "Infill below the standard minimum is design-led and is not included in the automatic vacant-lot yield.",
    ],
    blockedOverlayPatterns: [
      {
        pattern: /\bdeferred residential overlay\b/i,
        caveat: "Deferred Residential land is blocked from automatic yield and ROI until the required infrastructure/staging trigger is satisfied.",
      },
      {
        pattern: /\bmdc growth precinct\b/i,
        caveat: "Mapped Manawatu growth precincts use precinct-specific density and structure-plan standards, so the generic 500sqm yield and ROI are blocked until the applicable precinct rule is modelled.",
      },
    ],
    roiEnabled: true,
  },
  {
    providerId: "tauranga",
    regionalZoneCode: "TCC_MDRZ",
    zonePattern: /\b(?:mdrz|medium density residential zone)\b/i,
    zoneLabel: "Tauranga Medium Density Residential Zone",
    // The operative MDRZ has no generic minimum allotment area. Keeping this
    // null prevents the engine inventing a vacant-lot minimum; feasibility is
    // assessed through the verified design-led/concurrent pathway below.
    standardMinimumLotSqm: null,
    requiredShapeText: "A vacant allotment must accommodate the applicable 8m by 15m shape factor and all access, servicing and built-form controls.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Operative Tauranga City Plan Chapters 12 and 14 (Plan Change 33)",
    sourceUrl: TAURANGA_CITY_PLAN_SOURCE,
    caveats: [
      "The operative Medium Density Residential Zone has no generic minimum allotment area, so no minimum-lot division is inferred automatically.",
      "Up to three dwellings per site can be permitted only where the MDRZ built-form, outdoor-space, outlook, access, servicing and other applicable standards are met.",
      "Subdivision around approved or concurrently assessed dwellings remains design-led and requires council consent; mapped viewshaft, airport, liquefaction and other controls can reduce practical yield.",
      "A nearby public main does not prove that a private service connection exists or that network capacity is available for additional dwellings.",
    ],
    alternativePathway: {
      label: "Tauranga MDRZ integrated land-use and subdivision pathway",
      sourceLabel: "Operative Tauranga City Plan Chapters 12 and 14 (Plan Change 33)",
      sourceUrl: TAURANGA_CITY_PLAN_SOURCE,
      minNetAreaSqm: 300,
      sqmPerDwelling: 200,
      maxYield: 3,
      confidence: "low",
      reason: "The operative MDRZ permits up to three dwellings per site when all applicable performance standards are met, while subdivision is assessed against the resulting compliant layout rather than a generic minimum allotment area.",
      detail: "The displayed maximum is a conservative design-led opportunity flag, not a minimum-site-area calculation or consent prediction. Confirm the 8m by 15m shape factor, access, outdoor space, outlook, infrastructure capacity, airport/viewshaft controls and natural hazards through a concurrent design and consent assessment.",
    },
    roiEnabled: true,
  },
  {
    providerId: "napier",
    regionalZoneCode: "NCC_MEDIUM_DENSITY_RESIDENTIAL",
    zonePattern: /\bmedium density residential zone\b/i,
    zoneLabel: "Napier Medium Density Residential Zone",
    standardMinimumLotSqm: 350,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Napier Operative District Plan 2025 SUB-S1 vacant allotment standard",
    sourceUrl: NAPIER_DISTRICT_PLAN_SOURCE,
    caveats: [
      "The 350sqm standard applies to newly created vacant residential allotments. Existing-unit subdivisions or concurrent land-use and subdivision applications can follow different design-led pathways.",
      "The automatic yield is a gross first-pass screen only; access, existing dwelling placement, infrastructure capacity, overland flow, liquefaction and other mapped controls can reduce practical yield.",
      "A nearby public main does not prove that an existing private service connection is present or has capacity for additional dwellings.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "western-bay",
    regionalZoneCode: "WBOP_PUKEHINA_RESIDENTIAL",
    zonePattern: /\bresidential\b.*\bpukehina\b|\bpukehina\b.*\bresidential\b/i,
    zoneLabel: "Pukehina Residential Zone",
    standardMinimumLotSqm: 800,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Western Bay of Plenty Operative District Plan Rule 13.4.2 - other residential areas",
    sourceUrl: WESTERN_BAY_SUBDIVISION_SOURCE,
    caveats: [
      "Pukehina is an unsewered 'all other residential area'; the operative first-pass minimum is 800sqm and Rules 12.4.6 and 12.4.7 also apply.",
      "There is no current public wastewater scheme for Pukehina, so on-site wastewater capacity and regional-council requirements are critical feasibility constraints.",
      "Access, shape, coastal and natural-hazard controls, potable water and stormwater servicing still require site-specific confirmation.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "western-bay",
    regionalZoneCode: "WBOP_RESIDENTIAL",
    zonePattern: /\bresidential\b.*\b(?:waihi beach|athenree|katikati)\b|\b(?:waihi beach|athenree|katikati)\b.*\bresidential\b/i,
    excludedZonePattern: /\brural|medium density\b/i,
    zoneLabel: "Residential Zone",
    standardMinimumLotSqm: 350,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Western Bay of Plenty Operative District Plan - Residential subdivision",
    sourceUrl: WESTERN_BAY_SUBDIVISION_SOURCE,
    caveats: [
      "The 350sqm minimum is the first-pass standard for Waihi Beach, including Athenree; frontage, access, shape, natural-hazard and three-waters servicing controls still require site-specific confirmation.",
      "A 2,000sqm minimum can apply to specified Athenree Structure Plan sites adjoining the harbour or esplanade reserve; the automated yield must not be relied on where that site-specific control applies.",
      "All subdivision requires council approval and may require resource consent, engineering approval and infrastructure capacity confirmation.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "waipa",
    regionalZoneCode: "WDC_MDRZ",
    zonePattern: /\bmedium density residential\b|\bmdrz\b/i,
    zoneLabel: "Medium Density Residential Zone",
    standardMinimumLotSqm: 500,
    requiredShapeText: "Vacant lots require a 13m diameter circle or 8m by 15m rectangle, plus at least 10m frontage.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "Waipa District Plan PC26 Rules 15.4.1.1 and 15.4.2",
    sourceUrl: WAIPA_MDRZ_SUBDIVISION_SOURCE,
    caveats: [
      "All subdivision in Waipa District requires resource consent.",
      "The 500sqm minimum applies to new vacant lots; the vacant-lot standards also include a 1000sqm maximum, frontage, shape and vehicle-crossing controls.",
      "The mapped infrastructure and stormwater qualifying matters require site-specific capacity, servicing and stormwater assessment.",
      "Three or more dwellings require an Infrastructure Capacity Assessment under Rule 15.4.2.19A.",
    ],
    alternativePathway: {
      label: "Subdivision around existing or concurrently consented dwellings",
      sourceLabel: "Waipa PC26 Rules 15.4.1.1(l) and 15.4.2",
      sourceUrl: WAIPA_MDRZ_SUBDIVISION_SOURCE,
      minNetAreaSqm: 500,
      sqmPerDwelling: 250,
      maxYield: 3,
      confidence: "low",
      reason:
        "PC26 removes minimum lot area, frontage and shape requirements where every proposed lot contains an existing dwelling or a dwelling in a concurrent land-use application and no vacant lot is created.",
      detail:
        "This is a controlled-activity pathway only when access, servicing, hazards and built-form compliance are demonstrated. The displayed yield is conservative and is not a consent outcome.",
    },
    roiEnabled: true,
  },
  // Matamata-Piako District Plan Zones has no zone-name attribute — the zone
  // fetch (regional-arcgis.ts CONFIGS["matamata-piako"]) resolves zone_code to
  // a static per-layer code (e.g. "MPDC_RESIDENTIAL"), so these patterns match
  // that exact code rather than free-text zone names, avoiding any ambiguity
  // between e.g. "MPDC_RESIDENTIAL" and "MPDC_RURAL_RESIDENTIAL".
  {
    providerId: "matamata-piako",
    regionalZoneCode: "MPDC_RESIDENTIAL",
    zonePattern: /\bMPDC_RESIDENTIAL\b/,
    zoneLabel: "Residential Zone",
    standardMinimumLotSqm: 500,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Matamata-Piako District Plan (Residential Zone, net site area)",
    sourceUrl: MPDC_DISTRICT_PLAN_SOURCE,
    caveats: [
      "500sqm net site area is the operative Residential Zone minimum; confirm frontage, shape, servicing and any qualifying-matter overlays before relying on this yield.",
      "All subdivision in Matamata-Piako District requires resource consent.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "matamata-piako",
    regionalZoneCode: "MPDC_RURAL_RESIDENTIAL",
    zonePattern: /\bMPDC_RURAL_RESIDENTIAL(_2)?\b/,
    zoneLabel: "Rural Residential Zone",
    standardMinimumLotSqm: 2_500,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Matamata-Piako District Plan (Rural Residential Zone, indicative)",
    sourceUrl: MPDC_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum only (based on the district's bonus-lot and boundary-relocation minimum of 2,500sqm); Rural Residential and Rural Residential 2 zones may carry different standard minimums that must be confirmed against the operative rules with legal effect.",
      "All subdivision in Matamata-Piako District requires resource consent.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "matamata-piako",
    regionalZoneCode: "MPDC_RURAL",
    zonePattern: /\bMPDC_RURAL\b/,
    zoneLabel: "Rural Zone",
    standardMinimumLotSqm: 200_000,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Matamata-Piako District Plan Change 42 (Rural Zone land-quality subdivision)",
    sourceUrl: MPDC_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Plan Change 42 uses a land-quality approach: 20ha (200,000sqm) minimum on general-quality soils, 40ha (400,000sqm) on high-quality soils, plus a small-lot/balance-lot pathway for older titles. The lower figure is used here as an indicative starting point only — confirm soil classification and the applicable rule against the operative plan.",
      "All subdivision in Matamata-Piako District requires resource consent.",
    ],
    roiEnabled: true,
  },
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
    zonePattern: /\b(lower density suburban|low density residential|low density suburban|suburban residential)\b/i,
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
    providerId: "qldc",
    regionalZoneCode: "QLDC_LLRZ",
    zonePattern: /\b(large lot residential|large lot suburban residential)\b/i,
    zoneLabel: "Large Lot Residential Zone",
    standardMinimumLotSqm: 2_000,
    requiredShapeText: "Every site can contain a square of at least 25m by 25m.",
    requiredBuildingAreaSqm: null,
    sourceLabel: "QLDC PDP Chapter 27 Rule 27.6.1",
    sourceUrl: QLDC_SUBDIVISION_SOURCE,
    caveats: [
      "QLDC Large Lot Residential splits into sub-zones: the model uses the 2000sqm Large Lot Residential B minimum; Large Lot Residential A can require 4000sqm per lot.",
      "Chapter 27 also requires minimum dimensions, access, servicing/infrastructure and location-specific checks.",
    ],
    roiEnabled: true,
  },
  // ── Wellington region residential zones ────────────────────────────────────
  // These packs are shared across the region's councils (Wellington City, Hutt
  // City, Upper Hutt, Porirua, Kāpiti Coast), matched on the standardised
  // National Planning Standards residential zone names each council's district
  // plan returns. Minimum-lot figures are indicative first-pass standards for
  // MDRS-enabled residential land and MUST be confirmed against the specific
  // council's operative district plan before being relied on. ROI is enabled so
  // the report can model yield + returns using the (Auckland-seeded) Wellington
  // cost profile, which is tunable per region in regional-cost-profiles.ts.
  {
    providerId: "wairarapa",
    regionalZoneCode: "WRP_RESIDENTIAL",
    zonePattern: /\bresidential\b/i,
    zoneLabel: "Residential Zone",
    standardMinimumLotSqm: 400,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Wairarapa Combined District Plan (Residential, indicative)",
    sourceUrl: WAIRARAPA_COMBINED_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum only; confirm the exact minimum net site area against the provisions with legal effect in the operative and proposed Wairarapa Combined District Plans.",
      "Access, shape, servicing capacity, hazards, management areas, heritage and other performance standards still require site-specific consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "wellington",
    regionalZoneCode: "WLG_HDRZ",
    zonePattern: /\bhigh density residential\b/i,
    zoneLabel: "High Density Residential Zone",
    standardMinimumLotSqm: 200,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Wellington region district plan (High Density Residential, indicative)",
    sourceUrl: WELLINGTON_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum for MDRS-enabled High Density Residential land; confirm the exact minimum net site area and dimension controls in the relevant council's district plan.",
      "Access, shape, hazards (fault, flood, ground-shaking), heritage, infrastructure and other performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "wellington",
    regionalZoneCode: "WLG_MDRZ",
    zonePattern: /\bmedium density residential\b|\bmedium density\b/i,
    zoneLabel: "Medium Density Residential Zone",
    standardMinimumLotSqm: 250,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Wellington region district plan (Medium Density Residential, indicative)",
    sourceUrl: WELLINGTON_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum for MDRS-enabled Medium Density Residential land; confirm the exact minimum net site area in the relevant council's district plan.",
      "Access, shape, hazards, heritage, infrastructure and other performance standards still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "wellington",
    regionalZoneCode: "WLG_HILLRZ",
    zonePattern: /\bhill residential\b/i,
    zoneLabel: "Hill Residential Zone",
    standardMinimumLotSqm: 400,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Wellington region district plan (Hill Residential, indicative)",
    sourceUrl: WELLINGTON_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum for Hill Residential land; confirm the exact minimum net site area in the relevant council's district plan.",
      "Hill/slope stability, earthworks, access and hazard (fault, flood, ground-shaking) controls materially affect real yield and cost.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "wellington",
    regionalZoneCode: "WLG_LLRZ",
    zonePattern: /\b(large lot residential|rural residential|rural lifestyle)\b/i,
    zoneLabel: "Large Lot / Rural Residential Zone",
    standardMinimumLotSqm: 1_400,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Wellington region district plan (Large Lot / Rural Residential, indicative)",
    sourceUrl: WELLINGTON_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum for Large Lot / Rural Residential land; these zones often require materially larger minimum sites — confirm the exact minimum in the relevant council's district plan.",
      "Servicing (reticulated water/wastewater vs on-site), access, hazards and rural amenity controls still require consent checks.",
    ],
    roiEnabled: true,
  },
  {
    providerId: "wellington",
    regionalZoneCode: "WLG_GRZ",
    zonePattern: /\b(general residential|outer residential|inner residential|suburban residential|medium density suburban)\b/i,
    zoneLabel: "General Residential Zone",
    standardMinimumLotSqm: 350,
    requiredShapeText: null,
    requiredBuildingAreaSqm: null,
    sourceLabel: "Wellington region district plan (General Residential, indicative)",
    sourceUrl: WELLINGTON_DISTRICT_PLAN_SOURCE,
    caveats: [
      "Indicative first-pass minimum for MDRS-enabled General Residential land; confirm the exact minimum net site area in the relevant council's district plan.",
      "Access, shape, hazards (fault, flood, ground-shaking), heritage, infrastructure and other performance standards still require consent checks.",
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
): { effectiveMinimumLotSqm: number | null; caveats: string[]; blocked: boolean } {
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
    effectiveMinimum = Math.max(effectiveMinimum ?? 0, condition.minimumLotSqm);
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
  effectiveMinLotSqm: number | null,
  caveats: string[],
): string {
  if (effectiveMinLotSqm == null) {
    return `${provider.providerName} ${rule.zoneLabel} has no generic minimum allotment area. The design-led/concurrent pathway is modelled from ${rule.sourceLabel}. ${caveats.join(" ")} ROI may be shown only when title, land area, CV/acquisition value and comparables are also available.`;
  }
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
      subdivisionRules: application.effectiveMinimumLotSqm == null ? "not_modelled" : "standard_yield_modelled",
      modellingStatus: rulePack.roiEnabled && !application.blocked ? "roi_enabled" : "standard_yield_enabled",
      automaticYieldClaimsAllowed: !application.blocked && application.effectiveMinimumLotSqm != null,
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

  const interimComparableRoi = INTERIM_COMPARABLE_ROI_PROVIDERS.has(provider.providerId);
  return {
    subdivisionRules: "not_modelled",
    modellingStatus: interimComparableRoi ? "roi_enabled" : "facts_only",
    automaticYieldClaimsAllowed: false,
    automaticRoiAllowed: interimComparableRoi,
    regionalZoneCode: null,
    regionalZoneLabel: null,
    verifiedMinimumLotSqm: null,
    sourceLabel: null,
    sourceUrl: null,
    caveats: [],
    note: interimComparableRoi
      ? `${provider.providerName} zone facts are available. Interim ROI uses nearby comparable-sales GDV and the provider cost profile, but local subdivision/minimum-lot rules are not modelled yet, so the report must not infer multi-lot yield automatically for this zone.`
      : `${provider.providerName} zone facts are available, but local subdivision/minimum-lot rules are not modelled yet. The report should not infer multi-lot yield or ROI automatically for this region.`,
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
    : ruleStatus.automaticRoiAllowed && ruleStatus.sourceLabel
      ? `${provider.providerName} selected (${provider.coverageStatus} coverage). No generic minimum allotment area applies; design-led/concurrent pathway model enabled from ${ruleStatus.sourceLabel}.`
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
  if (application.blocked || application.effectiveMinimumLotSqm == null) return null;
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
  standardMinimumLotSqm: number | null;
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
