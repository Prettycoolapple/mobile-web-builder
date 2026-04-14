import { logger } from "./logger";
import type { LinzMemorial } from "./linz";

export type EasementType =
  | "right_of_way"
  | "drainage"
  | "power"
  | "services"
  | "covenant"
  | "encroachment"
  | "other";

export type EasementBurden = "burdening" | "appurtenant" | "unknown";

export interface ParsedEasement {
  type: EasementType;
  burden: EasementBurden;
  description: string;
  raw_text: string;
  estimated_width_m: number | null;
  estimated_area_sqm: number | null;
  severity: "minor" | "moderate" | "significant";
}

export interface EasementAnalysis {
  source: "linz_memorials" | "none";
  has_burdening_encumbrances: boolean;
  burdening: ParsedEasement[];
  appurtenant: ParsedEasement[];
  total_burdening_area_sqm: number;
  access_row_burdening: boolean;
  drainage_burdening: boolean;
  power_burdening: boolean;
  building_covenant: boolean;
  lot_impact_note: string | null;
  summary: string;
}

const EMPTY: EasementAnalysis = {
  source: "none",
  has_burdening_encumbrances: false,
  burdening: [],
  appurtenant: [],
  total_burdening_area_sqm: 0,
  access_row_burdening: false,
  drainage_burdening: false,
  power_burdening: false,
  building_covenant: false,
  lot_impact_note: null,
  summary: "No LINZ title memorials retrieved — check title manually for easements or ROW.",
};

function detectType(text: string): EasementType {
  const t = text.toLowerCase();
  if (/right of way|row\b|access/.test(t)) return "right_of_way";
  if (/drainage|sewerage|sewer|stormwater/.test(t)) return "drainage";
  if (/electric|power line|transmission|high voltage/.test(t)) return "power";
  if (/pipe|gas|water|telecommunications|fibre|cable/.test(t)) return "services";
  if (/covenant|restrict/.test(t)) return "covenant";
  if (/encroach/.test(t)) return "encroachment";
  return "other";
}

function detectBurden(text: string): EasementBurden {
  const t = text.toLowerCase();
  // Explicit burdening indicators
  if (/burdening\b|servient tenement|over\s+(this|the within|part of this)/.test(t)) return "burdening";
  if (/subject to\s+an?\s+easement/.test(t)) return "burdening";
  // Appurtenant / dominant indicators (this property benefits)
  if (/appurtenant|dominant tenement|as beneficiary|in favour of (this|the (above|within))/.test(t)) return "appurtenant";
  // ROW "over" another parcel — this property has access rights
  if (/right of way.*over (lot|part|dp|section)\s+[\d]/.test(t) && !/burdening/.test(t)) return "appurtenant";
  // Default: if the text says "easement" with no clear direction assume burdening (conservative)
  if (/easement|right of way/.test(t)) return "burdening";
  return "unknown";
}

function extractWidth(text: string): number | null {
  // "3 metres wide", "4 metres in width", "3m wide", "width of 4.5 metres"
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:metres?|m)\s+(?:wide|in\s+width)/i,
    /width\s+of\s+(\d+(?:\.\d+)?)\s*(?:metres?|m)/i,
    /(\d+(?:\.\d+)?)\s*(?:metre|m)\s+strip/i,
    /(\d+(?:\.\d+)?)\s*m\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const w = parseFloat(m[1]);
      if (w > 0 && w < 100) return w;
    }
  }
  return null;
}

function defaultWidth(type: EasementType): number {
  switch (type) {
    case "right_of_way": return 3.5;  // standard NZ shared-access driveway
    case "drainage":     return 1.5;
    case "power":        return 4.0;
    case "services":     return 1.5;
    default:             return 2.0;
  }
}

function estimateArea(width: number, land_area_sqm: number): number {
  // Assume corridor runs the full depth of the property.
  // Typical Auckland suburban depth: sqrt(land_area) gives a rough dimension.
  const depth = Math.sqrt(land_area_sqm);
  return Math.round(width * depth);
}

function classify(e: ParsedEasement): "minor" | "moderate" | "significant" {
  if (e.burden !== "burdening") return "minor";
  if (e.type === "covenant") return "moderate";
  if (e.type === "right_of_way") return "significant";
  if (e.estimated_area_sqm && e.estimated_area_sqm > 50) return "moderate";
  return "minor";
}

export function parseEasements(
  memorials: LinzMemorial[],
  land_area_sqm: number,
): EasementAnalysis {
  if (!memorials || memorials.length === 0) return EMPTY;

  const burdening: ParsedEasement[] = [];
  const appurtenant: ParsedEasement[] = [];

  for (const mem of memorials) {
    const text = mem.memorial_text;
    if (!text) continue;

    // Skip standard non-easement memorials (mortgages, caveats, etc.)
    const skip = /mortgage|caveat|lease|lis pendens|charging order|rates|notice of.*claim/i;
    if (skip.test(text) && !/easement|right of way|covenant/i.test(text)) continue;

    const type = detectType(text);
    const burden = detectBurden(text);
    if (burden === "unknown" && type === "other") continue; // skip unresolvable unknowns

    const width = extractWidth(text) ?? (burden === "burdening" ? defaultWidth(type) : null);
    const area = (burden === "burdening" && width)
      ? estimateArea(width, land_area_sqm)
      : null;

    const entry: ParsedEasement = {
      type,
      burden,
      description: buildDescription(type, burden, width),
      raw_text: text.length > 300 ? text.slice(0, 297) + "…" : text,
      estimated_width_m: width,
      estimated_area_sqm: area,
      severity: "minor",
    };
    entry.severity = classify(entry);

    if (burden === "burdening" || burden === "unknown") {
      burdening.push(entry);
    } else {
      appurtenant.push(entry);
    }
  }

  const totalBurdeningArea = burdening.reduce(
    (sum, e) => sum + (e.estimated_area_sqm ?? 0), 0,
  );

  const accessROW = burdening.some((e) => e.type === "right_of_way");
  const drainage  = burdening.some((e) => e.type === "drainage");
  const power     = burdening.some((e) => e.type === "power");
  const covenant  = burdening.some((e) => e.type === "covenant");

  const appROW    = appurtenant.some((e) => e.type === "right_of_way");

  // Lot impact note
  let lotImpact: string | null = null;
  if (accessROW) {
    lotImpact = `ROW burdening this title reduces the net subdividable area by ~${totalBurdeningArea}m² and may constrain building footprints near the ROW corridor. Confirm location with surveyor.`;
  } else if (totalBurdeningArea > 30) {
    lotImpact = `Service/drainage easements reduce net buildable area by ~${totalBurdeningArea}m². Building is restricted within the easement corridor.`;
  }

  const summary = buildSummary(burdening, appurtenant, appROW, accessROW, totalBurdeningArea);

  logger.info({
    burdening_count: burdening.length,
    appurtenant_count: appurtenant.length,
    total_area: totalBurdeningArea,
    access_row: accessROW,
  }, "Easements parsed");

  return {
    source: "linz_memorials",
    has_burdening_encumbrances: burdening.length > 0,
    burdening,
    appurtenant,
    total_burdening_area_sqm: totalBurdeningArea,
    access_row_burdening: accessROW,
    drainage_burdening: drainage,
    power_burdening: power,
    building_covenant: covenant,
    lot_impact_note: lotImpact,
    summary,
  };
}

function buildDescription(type: EasementType, burden: EasementBurden, width: number | null): string {
  const burdenLabel = burden === "burdening" ? "burdening this land" : "appurtenant (benefits this property)";
  const widthStr = width ? ` (~${width}m wide)` : "";
  switch (type) {
    case "right_of_way":   return `Access Right of Way${widthStr} ${burdenLabel}`;
    case "drainage":       return `Drainage/sewerage easement${widthStr} ${burdenLabel}`;
    case "power":          return `Electrical/power line easement${widthStr} ${burdenLabel}`;
    case "services":       return `Services easement${widthStr} ${burdenLabel}`;
    case "covenant":       return `Building/use covenant ${burdenLabel}`;
    case "encroachment":   return `Encroachment notice ${burdenLabel}`;
    default:               return `Other encumbrance ${burdenLabel}`;
  }
}

function buildSummary(
  burdening: ParsedEasement[],
  appurtenant: ParsedEasement[],
  appROW: boolean,
  accessROW: boolean,
  totalArea: number,
): string {
  if (burdening.length === 0 && appurtenant.length === 0) {
    return "No easements or rights of way found on this title from LINZ memorials.";
  }
  const parts: string[] = [];
  if (accessROW) {
    parts.push(`⚠ This title has an ACCESS RIGHT OF WAY burdening it — reduces net subdividable area by ~${totalArea}m² and limits building near the ROW corridor.`);
  }
  if (burdening.some((e) => e.type === "drainage")) {
    parts.push("Drainage/sewerage easement burdening this property — no building within corridor.");
  }
  if (burdening.some((e) => e.type === "power")) {
    parts.push("Power line easement burdening this property — significant building restrictions within corridor.");
  }
  if (burdening.some((e) => e.type === "covenant")) {
    parts.push("Building covenant — may restrict development type or density.");
  }
  if (appROW) {
    parts.push("This property has RIGHT OF WAY access rights over a neighbouring parcel (appurtenant) — good for rear-lot subdivision access.");
  }
  if (parts.length === 0 && burdening.length > 0) {
    parts.push(`${burdening.length} encumbrance(s) on this title — verify with solicitor.`);
  }
  return parts.join(" ");
}
