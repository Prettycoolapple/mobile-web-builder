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
