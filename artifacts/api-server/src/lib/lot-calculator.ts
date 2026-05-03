export interface LotResult {
  lots: number;
  min_lot_size: number;
  zone_label: string;
  sqm_per_lot: number;
  gross_area_sqm: number;
  net_area_sqm: number;
  easement_area_sqm: number;
}

const ZONE_RULES: Record<string, { min_lot_sqm: number; label: string }> = {
  THAB: { min_lot_sqm: 60,   label: "Terrace Housing & Apartments" },
  MHU:  { min_lot_sqm: 150,  label: "Mixed Housing Urban" },
  MHS:  { min_lot_sqm: 400,  label: "Mixed Housing Suburban" },
  SHZ:  { min_lot_sqm: 600,  label: "Single House Zone" },
  LLRZ: { min_lot_sqm: 4000, label: "Large Lot Residential Zone" },
  LDRZ: { min_lot_sqm: 600,  label: "Low Density Residential Zone" },
  RCSZ: { min_lot_sqm: 2000, label: "Rural and Coastal Settlement Zone" },
  FUZ:  { min_lot_sqm: 600,  label: "Future Urban Zone" },
  MIX:  { min_lot_sqm: 200,  label: "Mixed Use" },
  MUZ:  { min_lot_sqm: 200,  label: "Business - Mixed Use Zone" },
  LSZ:  { min_lot_sqm: 1200, label: "Large Lot" },
  RUR:  { min_lot_sqm: 4000, label: "Rural" },
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

const DEFAULT_ZONE = { min_lot_sqm: 400, label: "Mixed Housing Suburban (default)" };

/**
 * Zones that support the Auckland Unitary Plan "land-use + subdivision joint consent"
 * pathway (i.e. sub-minimum lots permitted when house designs are committed).
 * Business/industrial/commercial zones are omitted — they have their own rules.
 */
const RESIDENTIAL_ZONES_WITH_JOINT_CONSENT = new Set([
  "MHS", "MHU", "THAB", "SHZ", "LDRZ", "LLRZ",
]);

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
}

/**
 * Produces a deterministic, accurate subdivision pathway note for NZ residential zones.
 * Used both in the LLM prompt (so the AI stops hallucinating lot counts) and as a
 * deterministic callout in the Planning section of the FeasibilityReport UI.
 */
export function buildSubdivisionPathwayNote(
  net_area_sqm: number,
  zone_code: string | null,
  lots: number,
  min_lot_sqm: number,
  zone_label: string,
): SubdivisionPathwayNote {
  if (min_lot_sqm <= 0) {
    return {
      headline: `${zone_label} — no minimum lot size. Multiple lots possible.`,
      detail: `This property is in ${zone_label} where no minimum lot size applies. Lot yield is determined by building coverage and design standards rather than a raw m² threshold.`,
      standard_path_viable: true,
    };
  }

  const vacantLotsNeeded = 2;
  const minForTwoVacantLots = vacantLotsNeeded * min_lot_sqm;
  const standard_path_viable = net_area_sqm >= minForTwoVacantLots;
  const supportsJointConsent = RESIDENTIAL_ZONES_WITH_JOINT_CONSENT.has(zone_code ?? "");

  if (lots >= vacantLotsNeeded) {
    return {
      headline: `${lots} lots feasible under standard vacant-lot rules (${zone_label}, min ${min_lot_sqm}m²/lot).`,
      detail: `The site (${net_area_sqm}m² net) is large enough to create ${lots} independent titles as vacant sections under Auckland Unitary Plan standard rules — each lot would be at least ${min_lot_sqm}m². A surveyor and resource consent are still required.`,
      standard_path_viable: true,
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
      `However, subdivision into smaller lots (below ${min_lot_sqm}m²) IS PERMITTED in ${zone_label} through a joint Land Use + Subdivision consent. ` +
      `Under this pathway you commit to building designs at the same time as the subdivision. ` +
      `Auckland Council then assesses the quality of the living environment (outdoor space, daylight, infrastructure) ` +
      `rather than the raw land area. Sites of 250–${min_lot_sqm - 50}m² per lot are commonly approved this way.`,
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

  return {
    headline: `${net_area_sqm}m² site in ${zone_label} — standard path: 1 lot only (need ${minForTwoVacantLots}m² for 2 vacant lots).`,
    detail: paragraphs.join(" "),
    standard_path_viable: false,
  };
}

export function calculatePotentialLots(
  land_area_sqm: number,
  zone_code: string | null,
  easement_area_sqm = 0,
): LotResult {
  const zone = zone_code ? (ZONE_RULES[zone_code] ?? DEFAULT_ZONE) : DEFAULT_ZONE;
  const min = zone.min_lot_sqm;
  const effectiveMin = min === 0 ? 60 : min;

  const grossArea = land_area_sqm;
  const netArea = Math.max(0, land_area_sqm - easement_area_sqm);

  const raw = Math.floor(netArea / effectiveMin);
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
