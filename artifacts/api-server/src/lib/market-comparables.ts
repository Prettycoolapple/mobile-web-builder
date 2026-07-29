import type { ComparableSale } from "./comparables";

export type ComparableTypology = "standalone" | "terrace_townhouse" | "unit_apartment" | "unknown";
export type ComparableSource = "oneroof_sold" | "realestate_active_listing" | "licensed_provider" | "unknown";

export interface ComparableSelectionResult {
  comparables: ComparableSale[];
  typologyMatched: boolean;
  targetTypology: ComparableTypology;
}

function addressSuggestsUnit(address: string): boolean {
  return /\b(unit|flat|apt|apartment)\b/i.test(address) || /\b\d+\s*\/\s*\d+\b/.test(address);
}

export function inferComparableTypology(input: {
  address?: string | null;
  land_sqm?: number | null;
  floor_sqm?: number | null;
  bedrooms?: number | null;
  rawType?: string | null;
}): ComparableTypology {
  const text = [input.address, input.rawType].filter(Boolean).join(" ").toLowerCase();
  if (/\b(apartment|apt)\b/.test(text)) return "unit_apartment";
  if (/\b(terrace|townhouse|attached dwelling)\b/.test(text)) return "terrace_townhouse";
  if (addressSuggestsUnit(input.address ?? "")) {
    if ((input.land_sqm ?? 0) > 0 && (input.land_sqm ?? 0) <= 320) return "terrace_townhouse";
    return "unit_apartment";
  }
  if (input.land_sqm != null && input.land_sqm > 0) {
    if (input.land_sqm <= 260) return "terrace_townhouse";
    if (input.land_sqm >= 450) return "standalone";
  }
  if (input.floor_sqm != null && input.floor_sqm > 0 && input.floor_sqm <= 165 && (input.bedrooms ?? 0) <= 4) {
    return "terrace_townhouse";
  }
  return "unknown";
}

export function targetExitTypology(lots: number, sqmPerLot: number): ComparableTypology {
  if (lots >= 3 && sqmPerLot > 0 && sqmPerLot <= 320) return "terrace_townhouse";
  if (lots >= 4) return "terrace_townhouse";
  return "standalone";
}

export function isImprovedDwellingComparable(c: ComparableSale): boolean {
  if (c.propertyImprovement === "improved_dwelling") return true;
  if (c.propertyImprovement === "vacant_land") return false;
  return (c.floor_sqm ?? 0) >= 50
    || (c.bedrooms ?? 0) > 0
    || (c.build_year != null && c.build_year >= 1800);
}

function scoreComparable(c: ComparableSale, target: ComparableTypology, subjectLandSqm: number | null): number {
  let score = 50;
  if (c.typology === target) score += 35;
  else if (c.typology === "unknown") score += 5;
  else score -= 15;

  if (c.source === "oneroof_sold") score += 12;
  else if (c.source === "realestate_active_listing") score += 6;

  if (typeof c.distanceM === "number") {
    if (c.distanceM <= 500) score += 12;
    else if (c.distanceM <= 1500) score += 8;
    else if (c.distanceM <= 3000) score += 3;
  }

  if (subjectLandSqm && c.land_sqm > 0) {
    const delta = Math.abs(c.land_sqm - subjectLandSqm) / subjectLandSqm;
    if (delta <= 0.25) score += 10;
    else if (delta <= 0.5) score += 5;
    else score -= 5;
  }

  if (c.build_year && c.build_year >= 2000) score += 3;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function selectComparableSalesForExit(params: {
  comparables: ComparableSale[];
  lots: number;
  sqmPerLot: number;
  subjectLandSqm?: number | null;
  maxSelect?: number;
  /** For a vacant-site new-build exit, exclude section/land-only transactions. */
  requireImprovedDwelling?: boolean;
}): ComparableSelectionResult {
  const targetTypology = targetExitTypology(params.lots, params.sqmPerLot);
  const maxSelect = params.maxSelect ?? 3;
  const eligibleComparables = params.requireImprovedDwelling
    ? params.comparables.filter(isImprovedDwellingComparable)
    : params.comparables;
  const withScores = eligibleComparables.map((c) => {
    const typology = c.typology ?? inferComparableTypology({
      address: c.address,
      land_sqm: c.land_sqm,
      floor_sqm: c.floor_sqm,
      bedrooms: c.bedrooms,
    });
    const relevanceScore = scoreComparable({ ...c, typology }, targetTypology, params.subjectLandSqm ?? null);
    return {
      ...c,
      typology,
      relevanceScore,
      selectionReason: typology === targetTypology
        ? "Matched the expected exit-product typology for this development scenario."
        : c.selectionReason,
    };
  });

  if (targetTypology === "terrace_townhouse") {
    const matched = withScores
      .filter((c) => c.typology === "terrace_townhouse")
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));
    if (matched.length >= 3) {
      return {
        comparables: matched.slice(0, maxSelect),
        typologyMatched: true,
        targetTypology,
      };
    }
  }

  return {
    comparables: withScores
      .sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0))
      .slice(0, maxSelect),
    typologyMatched: false,
    targetTypology,
  };
}
