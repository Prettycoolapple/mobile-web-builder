export interface LotResult {
  lots: number;
  min_lot_size: number;
  zone_label: string;
  sqm_per_lot: number;
  gross_area_sqm: number;
  net_area_sqm: number;
  easement_area_sqm: number;
}

export type DesignLedConfidence = "none" | "low" | "medium";

export interface DesignLedYieldRange {
  min: number;
  max: number;
}

export interface SubdivisionPathwayAssessment {
  standardVacantLots: number;
  standardPathViable: boolean;
  standardMinLotSize: number | null;
  designLedEligible: boolean;
  designLedYieldRange: DesignLedYieldRange | null;
  designLedConfidence: DesignLedConfidence;
  designLedReasons: string[];
  designLedBlockers: string[];
  designLedSummary: string | null;
  designLedDetail: string | null;
}

export interface DesignLedAssessmentInput {
  netAreaSqm: number | null;
  zoneCode: string | null;
  zoneLabel?: string | null;
  standardVacantLots: number;
  minLotSqm: number | null;
  typology?: "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown" | null;
  titleConfidence?: "verified" | "inferred" | "unknown" | null;
  landAreaConfidence?: "verified" | "unverified" | null;
  isAlreadySubdividedChild?: boolean | null;
  buildYear?: number | null;
  parcelBbox?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    polygon?: [number, number][];
  } | null;
  overlays?: Array<{ status: string; name?: string | null }> | null;
  slopeClass?: string | null;
}

const ZONE_RULES: Record<string, { min_lot_sqm: number; label: string }> = {
  THAB: { min_lot_sqm: 60,   label: "Terrace Housing & Apartments" },
  MHU:  { min_lot_sqm: 300,  label: "Mixed Housing Urban" },
  MHS:  { min_lot_sqm: 400,  label: "Mixed Housing Suburban" },
  SHZ:  { min_lot_sqm: 600,  label: "Single House Zone" },
  LLRZ: { min_lot_sqm: 4000, label: "Large Lot Residential Zone" },
  CLZ:  { min_lot_sqm: 10000, label: "Countryside Living Zone" },
  LDRZ: { min_lot_sqm: 600,  label: "Low Density Residential Zone" },
  RCSZ: { min_lot_sqm: 2000, label: "Rural and Coastal Settlement Zone" },
  FUZ:  { min_lot_sqm: 600,  label: "Future Urban Zone" },
  MIX:  { min_lot_sqm: 200,  label: "Mixed Use" },
  MUZ:  { min_lot_sqm: 200,  label: "Business - Mixed Use Zone" },
  LSZ:  { min_lot_sqm: 1200, label: "Large Lot" },
  RUR:  { min_lot_sqm: 40000, label: "Rural" },
  CCZ:  { min_lot_sqm: 0,    label: "City Centre Zone" },
  TCZ:  { min_lot_sqm: 0,    label: "Town Centre Zone" },
  MCZ:  { min_lot_sqm: 0,    label: "Metropolitan Centre Zone" },
  LCZ:  { min_lot_sqm: 0,    label: "Local Centre Zone" },
  NCZ:  { min_lot_sqm: 0,    label: "Neighbourhood Centre Zone" },
  GBZ:  { min_lot_sqm: 0,    label: "General Business Zone" },
  BPZ:  { min_lot_sqm: 0,    label: "Business Park Zone" },
  BPIZ: { min_lot_sqm: 0,    label: "Light Industry Zone" },
  HIZ:  { min_lot_sqm: 0,    label: "Heavy Industry Zone" },
};

const UNKNOWN_ZONE = { min_lot_sqm: 0, label: "Unknown zone" };

/**
 * Zones that support the Auckland Unitary Plan "land-use + subdivision joint consent"
 * pathway (i.e. sub-minimum lots permitted when house designs are committed).
 * Business/industrial/commercial zones are omitted — they have their own rules.
 */
const RESIDENTIAL_ZONES_WITH_JOINT_CONSENT = new Set([
  "MHS", "MHU", "THAB", "SHZ", "LDRZ", "LLRZ",
]);

const RURAL_TRANSFER_RIGHT_ZONES = new Set(["CLZ", "LLRZ", "RCSZ", "RUR"]);

const DESIGN_LED_ZONE_RULES: Record<string, { minAreaSqm: number; sqmPerDwelling: number; maxYield: number; label: string }> = {
  MHS: { minAreaSqm: 500, sqmPerDwelling: 150, maxYield: 4, label: "Mixed Housing Suburban" },
  MHU: { minAreaSqm: 450, sqmPerDwelling: 130, maxYield: 6, label: "Mixed Housing Urban" },
  THAB: { minAreaSqm: 300, sqmPerDwelling: 90, maxYield: 8, label: "Terrace Housing & Apartments" },
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function pluralLot(n: number): string {
  return `${n} lot${n === 1 ? "" : "s"}`;
}

function formatYieldRange(range: DesignLedYieldRange): string {
  return range.min === range.max ? `${range.min}` : `${range.min}-${range.max}`;
}

function normaliseZoneCode(zoneCode: string | null | undefined): string | null {
  const z = zoneCode?.toUpperCase().trim();
  if (!z) return null;
  if (z === "MHU-H" || z === "MHU-S") return "MHU";
  return z;
}

function geometryLooksConstrained(bbox: DesignLedAssessmentInput["parcelBbox"]): boolean {
  if (!bbox) return false;
  const latSpan = Math.abs(bbox.maxLat - bbox.minLat);
  const lngSpan = Math.abs(bbox.maxLng - bbox.minLng);
  if (latSpan <= 0 || lngSpan <= 0) return false;
  const ratio = Math.max(latSpan, lngSpan) / Math.max(0.000001, Math.min(latSpan, lngSpan));
  return ratio >= 5;
}

export function assessSubdivisionPathways(input: DesignLedAssessmentInput): SubdivisionPathwayAssessment {
  const zoneCode = normaliseZoneCode(input.zoneCode);
  const minLotSqm = input.minLotSqm && input.minLotSqm > 0 ? input.minLotSqm : null;
  const netAreaSqm = input.netAreaSqm && input.netAreaSqm > 0 ? input.netAreaSqm : null;
  const standardVacantLots = Math.max(1, input.standardVacantLots || 1);
  const standardPathViable = !!minLotSqm && standardVacantLots >= 2;
  const reasons: string[] = [];
  const blockers: string[] = [];

  const base: Omit<SubdivisionPathwayAssessment, "designLedEligible" | "designLedYieldRange" | "designLedConfidence" | "designLedSummary" | "designLedDetail"> = {
    standardVacantLots,
    standardPathViable,
    standardMinLotSize: minLotSqm,
    designLedReasons: reasons,
    designLedBlockers: blockers,
  };

  if (!zoneCode || !minLotSqm) blockers.push("Zoning or minimum lot-size rule is unavailable.");
  const designRule = zoneCode ? DESIGN_LED_ZONE_RULES[zoneCode] : undefined;
  if (!designRule) blockers.push("Design-led upside is currently only modelled for Auckland MHS, MHU, and THAB residential zones.");
  if (netAreaSqm == null) blockers.push("Verified subject land area is required before testing design-led upside.");
  if (input.landAreaConfidence != null && input.landAreaConfidence !== "verified") {
    blockers.push("Land area is not verified.");
  }
  if (input.isAlreadySubdividedChild === true) blockers.push("Already-subdivided child titles are excluded from design-led upside screening.");
  if (input.typology != null && input.typology !== "standalone") {
    blockers.push("The title/typology does not read as a standalone redevelopment site.");
  }
  if (input.titleConfidence != null && input.titleConfidence !== "verified") {
    blockers.push("Freehold-style title confidence is not verified.");
  }
  if (input.buildYear == null) {
    blockers.push("Build year is not confirmed for redevelopment screening.");
  } else if (input.buildYear >= 2000) {
    blockers.push("Modern post-2000 improvements reduce first-pass redevelopment eligibility.");
  }

  const restrictiveOverlays = (input.overlays ?? []).filter((overlay) => overlay.status === "restricted");
  const confidenceDeductions: string[] = [];
  if (restrictiveOverlays.length > 0) {
    confidenceDeductions.push("Restricted overlay(s) may materially constrain the layout.");
  }
  if (input.slopeClass && ["steep", "very_steep"].includes(input.slopeClass)) {
    confidenceDeductions.push("Steep terrain may reduce practical yield.");
  }
  if (geometryLooksConstrained(input.parcelBbox)) {
    confidenceDeductions.push("Parcel geometry appears narrow or elongated, so access and outlook need early testing.");
  }

  if (!designRule || !netAreaSqm || blockers.length > 0) {
    return {
      ...base,
      designLedEligible: false,
      designLedYieldRange: null,
      designLedConfidence: "none",
      designLedSummary: null,
      designLedDetail: null,
    };
  }

  if (netAreaSqm < designRule.minAreaSqm) {
    blockers.push(`Site area is below the ${designRule.minAreaSqm}sqm first-pass design-led threshold for ${designRule.label}.`);
    return {
      ...base,
      designLedEligible: false,
      designLedYieldRange: null,
      designLedConfidence: "none",
      designLedSummary: null,
      designLedDetail: null,
    };
  }

  const estimatedMax = clamp(Math.floor(netAreaSqm / designRule.sqmPerDwelling), 2, designRule.maxYield);
  if (estimatedMax <= standardVacantLots) {
    blockers.push("Indicative design-led yield does not exceed the conservative standard vacant-lot yield.");
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
    min: Math.max(2, Math.min(standardVacantLots + 1, estimatedMax)),
    max: estimatedMax,
  };

  reasons.push(
    `${designRule.label} can be assessed through an integrated land-use and subdivision consent where the building design is tested with the subdivision.`,
    `${Math.round(netAreaSqm)}sqm verified net site area is below/near the standard vacant-lot threshold but large enough to test a compact layout.`,
    "Yield depends on access, outlook, outdoor living space, HIRB, servicing, stormwater, and the final site layout.",
    ...confidenceDeductions,
  );

  const confidence: DesignLedConfidence = confidenceDeductions.length > 0 ? "low" : "medium";
  const yieldText = formatYieldRange(range);
  return {
    ...base,
    designLedEligible: true,
    designLedYieldRange: range,
    designLedConfidence: confidence,
    designLedSummary: `Standard path: ${pluralLot(standardVacantLots)}. Design-led consent may unlock ${yieldText} dwellings/lots to test.`,
    designLedDetail: `The conservative vacant-lot test supports ${pluralLot(standardVacantLots)}. A design-led land-use + subdivision consent may be worth testing for ${yieldText} dwellings/lots, subject to access, outlook, outdoor living space, HIRB, servicing, stormwater, overlays, and site layout. This is an opportunity flag, not an approval prediction.`,
  };
}

function ruralTransferRightNote(zone_code: string | null, lots: number): string | null {
  if (!zone_code || lots < 2 || !RURAL_TRANSFER_RIGHT_ZONES.has(zone_code.toUpperCase())) return null;
  return "Because this is a rural/countryside-style subdivision, creating extra titles may require a transferable rural site right (TDR/TTR) under Auckland Unitary Plan rural subdivision rules. The report includes an indicative allowance for each additional title, but a planner/surveyor must confirm the exact pathway and availability.";
}

export interface SubdivisionPathwayNote {
  /** One-liner used in Property Overview scorecard area */
  headline: string;
  /**
   * Full plain-English note to inject into the Planning section and LLM prompt.
   * Covers what IS and IS NOT possible without a planning expert.
   */
  detail: string;
  /**
   * TRUE  → standard vacant-lot subdivision is possible (land ≥ lots × min_lot)
   * FALSE → standard path fails; only conditional/joint consent may work
   */
  standard_path_viable: boolean;
  standardVacantLots?: number;
  standardPathViable?: boolean;
  standardMinLotSize?: number | null;
  designLedEligible?: boolean;
  designLedYieldRange?: DesignLedYieldRange | null;
  designLedConfidence?: DesignLedConfidence;
  designLedReasons?: string[];
  designLedBlockers?: string[];
  designLedSummary?: string | null;
  designLedDetail?: string | null;
}

/**
 * Produces a deterministic, accurate subdivision pathway note for NZ residential zones.
 * Used both in the LLM prompt (so the AI stops hallucinating lot counts) and as a
 * deterministic callout in the Planning section of the FeasibilityReport UI.
 */
export function buildSubdivisionPathwayNote(
  net_area_sqm: number | null,
  zone_code: string | null,
  lots: number,
  min_lot_sqm: number,
  zone_label: string,
  assessment?: SubdivisionPathwayAssessment | null,
): SubdivisionPathwayNote {
  const pathwayAssessment = assessment ?? assessSubdivisionPathways({
    netAreaSqm: net_area_sqm,
    zoneCode: zone_code,
    zoneLabel: zone_label,
    standardVacantLots: lots,
    minLotSqm: min_lot_sqm,
  });
  const assessmentFields = {
    standardVacantLots: pathwayAssessment.standardVacantLots,
    standardPathViable: pathwayAssessment.standardPathViable,
    standardMinLotSize: pathwayAssessment.standardMinLotSize,
    designLedEligible: pathwayAssessment.designLedEligible,
    designLedYieldRange: pathwayAssessment.designLedYieldRange,
    designLedConfidence: pathwayAssessment.designLedConfidence,
    designLedReasons: pathwayAssessment.designLedReasons,
    designLedBlockers: pathwayAssessment.designLedBlockers,
    designLedSummary: pathwayAssessment.designLedSummary,
    designLedDetail: pathwayAssessment.designLedDetail,
  };

  if (!zone_code || zone_label === UNKNOWN_ZONE.label) {
    return {
      headline: "Zone unavailable - lot yield not estimated automatically.",
      detail: "The zoning layer was not resolved for this parcel, so the report does not infer a multi-lot subdivision yield. Confirm the Auckland Unitary Plan zone before relying on any development scenario.",
      standard_path_viable: false,
      ...assessmentFields,
    };
  }

  if (min_lot_sqm <= 0) {
    return {
      headline: `${zone_label} — no minimum lot size. Multiple lots possible.`,
      detail: `This property is in ${zone_label} where no minimum lot size applies. Lot yield is determined by building coverage and design standards rather than a raw m² threshold.`,
      standard_path_viable: true,
      ...assessmentFields,
    };
  }

  const vacantLotsNeeded = 2;
  const minForTwoVacantLots = vacantLotsNeeded * min_lot_sqm;
  if (net_area_sqm == null || net_area_sqm <= 0) {
    return {
      headline: `${zone_label} - minimum lot size is ${min_lot_sqm}m²/lot (usually ${minForTwoVacantLots}m² for 2 vacant lots). Subject land area unavailable.`,
      detail: `The subject land area is not available for this property, so the report does not compare this specific property against the lot-size threshold or infer extra subdivision yield. In ${zone_label}, standard vacant-lot subdivision generally requires at least ${min_lot_sqm}m² per lot; creating 2 vacant lots usually requires at least ${minForTwoVacantLots}m² before easements, access, infrastructure, and design controls are assessed.`,
      standard_path_viable: false,
      ...assessmentFields,
    };
  }
  const standard_path_viable = net_area_sqm >= minForTwoVacantLots;
  const supportsJointConsent = RESIDENTIAL_ZONES_WITH_JOINT_CONSENT.has(zone_code ?? "");

  if (lots >= vacantLotsNeeded) {
    const transferRightNote = ruralTransferRightNote(zone_code, lots);
    return {
      headline: `${lots} lots feasible under standard vacant-lot rules (${zone_label}, min ${min_lot_sqm}m²/lot).${transferRightNote ? " TDR/TTR transfer-right allowance may apply." : ""}`,
      detail: [
        `The site (${net_area_sqm}m² net) is large enough to create ${lots} independent titles as vacant sections under Auckland Unitary Plan standard rules — each lot would be at least ${min_lot_sqm}m². A surveyor and resource consent are still required.`,
        pathwayAssessment.designLedEligible ? pathwayAssessment.designLedDetail : null,
        transferRightNote,
      ].filter(Boolean).join(" "),
      standard_path_viable: true,
      ...assessmentFields,
    };
  }

  // Standard vacant-lot path fails — explain alternatives
  const paragraphs: string[] = [];

  paragraphs.push(
    `The net site area is ${net_area_sqm}m² and the ${zone_label} requires a minimum of ${min_lot_sqm}m² per lot. ` +
    `To create 2 vacant empty sections you would need at least ${minForTwoVacantLots}m² — ` +
    `${minForTwoVacantLots - net_area_sqm}m² more than this site.`,
  );

  if (supportsJointConsent) {
    paragraphs.push(
      `However, smaller-lot subdivision (below ${min_lot_sqm}m²) may be worth testing in ${zone_label} through a joint Land Use + Subdivision consent. ` +
      `Under this pathway you commit to building designs at the same time as the subdivision. ` +
      `Auckland Council then assesses the quality of the living environment (outdoor space, daylight, infrastructure) ` +
      `rather than the raw land area alone.`,
    );
    paragraphs.push(
      `An alternative is to keep the existing dwelling and carve out one smaller rear or side lot, ` +
      `provided both resulting parcels meet outdoor living, yard, and infrastructure standards. ` +
      `This often works on sites between ${Math.round(min_lot_sqm * 1.5)}m² and ${minForTwoVacantLots - 1}m².`,
    );
    paragraphs.push(
      `A resource consent application is required for either pathway. ` +
      `Engage a planner and surveyor to confirm feasibility before committing.`,
    );
  } else {
    paragraphs.push(
      `Subdivision in ${zone_label} generally requires a minimum lot size of ${min_lot_sqm}m²; ` +
      `joint land-use pathways are more restricted in this zone. Professional planning advice is recommended.`,
    );
  }

  if (pathwayAssessment.designLedEligible && pathwayAssessment.designLedDetail) {
    paragraphs.push(pathwayAssessment.designLedDetail);
  }

  return {
    headline: pathwayAssessment.designLedSummary ??
      `${net_area_sqm}m² site in ${zone_label} — standard path: 1 lot only (need ${minForTwoVacantLots}m² for 2 vacant lots).`,
    detail: paragraphs.join(" "),
    standard_path_viable: false,
    ...assessmentFields,
  };
}

export function calculatePotentialLots(
  land_area_sqm: number,
  zone_code: string | null,
  easement_area_sqm = 0,
): LotResult {
  const grossArea = land_area_sqm;
  const netArea = Math.max(0, land_area_sqm - easement_area_sqm);
  const zone = zone_code ? ZONE_RULES[zone_code] : undefined;

  if (!zone) {
    return {
      lots: 1,
      min_lot_size: UNKNOWN_ZONE.min_lot_sqm,
      zone_label: UNKNOWN_ZONE.label,
      sqm_per_lot: Math.round(netArea || grossArea || 0),
      gross_area_sqm: grossArea,
      net_area_sqm: netArea,
      easement_area_sqm,
    };
  }

  const min = zone.min_lot_sqm;
  const effectiveMin = min === 0 ? 60 : min;

  const roundingTolerance = 0.000001;
  const raw = Math.floor((netArea + roundingTolerance) / effectiveMin);
  const lots = Math.max(1, Math.min(20, raw));
  const sqm_per_lot = Math.round(netArea / lots);

  return {
    lots,
    min_lot_size: min,
    zone_label: zone.label,
    sqm_per_lot,
    gross_area_sqm: grossArea,
    net_area_sqm: netArea,
    easement_area_sqm,
  };
}
