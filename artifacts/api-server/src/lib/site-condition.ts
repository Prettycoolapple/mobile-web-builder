export type SiteStatus = "vacant_land" | "has_dwelling" | "unknown";

export interface SiteConditionInput {
  build_year?: number | null;
  floor_area_sqm?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  property_type?: string | null;
  listing_title?: string | null;
  listing_url?: string | null;
  typology?: string | null;
  typologyConfidence?: string | null;
}

export interface SiteCondition {
  siteStatus: SiteStatus;
  hasExistingDwelling: boolean;
  evidence: string[];
}

function finitePositive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function compactText(values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function hasVacantLandTextSignal(text: string): boolean {
  return /\b(vacant\s+land|bare\s+land|land\s*only|residential\s+section|lifestyle\s+section|freehold\s+section|building\s+site|section)\b/i.test(text) ||
    /\/section(?:\/|$|\?)/i.test(text) ||
    /\bbuild\s+your\s+(?:dream\s+)?home\b/i.test(text);
}

function hasDwellingTypeTextSignal(text: string): boolean {
  return /\b(house|home|dwelling|villa|bungalow|unit|apartment|town\s*house|townhouse|terrace|duplex|flat)\b/i.test(text);
}

export function classifySiteCondition(data: SiteConditionInput): SiteCondition {
  const evidence: string[] = [];
  const text = compactText([data.property_type, data.listing_title, data.listing_url]);
  const floor = finitePositive(data.floor_area_sqm);
  const bedrooms = finitePositive(data.bedrooms);
  const bathrooms = finitePositive(data.bathrooms);
  const hasPhysicalDwellingSignal =
    data.build_year != null ||
    (floor != null && floor >= 30) ||
    bedrooms != null ||
    bathrooms != null;

  if (data.build_year != null) evidence.push(`build year ${data.build_year}`);
  if (floor != null && floor >= 30) evidence.push(`floor area ${Math.round(floor)}sqm`);
  if (bedrooms != null) evidence.push(`${bedrooms} bedroom${bedrooms === 1 ? "" : "s"}`);
  if (bathrooms != null) evidence.push(`${bathrooms} bathroom${bathrooms === 1 ? "" : "s"}`);

  if (hasPhysicalDwellingSignal) {
    return { siteStatus: "has_dwelling", hasExistingDwelling: true, evidence };
  }

  if (hasVacantLandTextSignal(text)) {
    evidence.push(`land-only signal ${data.property_type ?? data.listing_title ?? data.listing_url ?? "listing"}`);
    return { siteStatus: "vacant_land", hasExistingDwelling: false, evidence };
  }

  if (hasDwellingTypeTextSignal(text)) {
    evidence.push(`dwelling type ${data.property_type ?? data.listing_title ?? "listing"}`);
    return { siteStatus: "has_dwelling", hasExistingDwelling: true, evidence };
  }

  if (
    data.typology &&
    data.typology !== "unknown" &&
    data.typologyConfidence &&
    data.typologyConfidence !== "unknown"
  ) {
    evidence.push(`typology ${data.typology}`);
    return { siteStatus: "has_dwelling", hasExistingDwelling: true, evidence };
  }

  return { siteStatus: "unknown", hasExistingDwelling: false, evidence };
}

export function siteStatusLabel(status: SiteStatus): string {
  if (status === "vacant_land") return "Vacant land / section";
  if (status === "has_dwelling") return "Existing dwelling detected";
  return "Site condition unknown";
}
