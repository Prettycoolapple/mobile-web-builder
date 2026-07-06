import type { RawPropertyData } from "./pipeline";
import type { InfrastructureItem } from "./infrastructure";
import type { InsertPropertyFeatureIndex } from "@workspace/db";

/**
 * Pure extraction: flatten a cached raw_data bundle into a property_feature_index
 * row. Deliberately db-free (only type-only imports touch @workspace/db) so it is
 * unit-testable in isolation; the I/O layer lives in property-feature-index.ts.
 */

/** Identity/provenance fields that live on the cache row, not inside raw_data. */
export interface FeatureRowIdentity {
  addressKey: string;
  canonicalParcelId?: string | null;
  suburb?: string | null;
  formattedAddress?: string | null;
  lat?: number | null;
  lng?: number | null;
  pipelineVersion?: number | null;
  lastRefreshedAt?: Date | null;
}

const RISK_RANK = { low: 0, moderate: 1, high: 2 } as const;

/** True when a measured service of `name` was found ON the parcel itself. */
function serviceOnParcel(items: InfrastructureItem[], name: string): boolean {
  return items.some((it) => it?.name === name && it?.location === "on-parcel");
}

function worstInfraRisk(items: InfrastructureItem[]): "low" | "moderate" | "high" | null {
  let worst: "low" | "moderate" | "high" | null = null;
  for (const it of items) {
    const r = it?.risk;
    if (r !== "low" && r !== "moderate" && r !== "high") continue;
    if (worst === null || RISK_RANK[r] > RISK_RANK[worst]) worst = r;
  }
  return worst;
}

/**
 * Flatten a cached raw_data bundle into an index row. Pure and unit-testable.
 * Terrain/infrastructure come from RAW measured data; lots/scores come from
 * derived_scores (carrying scoringVersion for drift control). Fields we don't
 * yet persist (cv, real ROI %) are left null and filled by later phases.
 */
export function deriveFeatureRow(raw: RawPropertyData, id: FeatureRowIdentity): InsertPropertyFeatureIndex {
  const ds = raw.derived_scores ?? null;
  const condition = ds?.dwellingCondition ?? null;
  const infra = (raw.infrastructure ?? []) as InfrastructureItem[];
  const storm = serviceOnParcel(infra, "Stormwater");
  const sewer = serviceOnParcel(infra, "Wastewater");
  const water = serviceOnParcel(infra, "Water Supply");
  const zone = ds?.zone ?? null;

  return {
    addressKey: id.addressKey,
    canonicalParcelId: id.canonicalParcelId ?? null,
    suburb: id.suburb ?? null,
    formattedAddress: id.formattedAddress ?? null,
    lat: id.lat ?? null,
    lng: id.lng ?? null,
    // Provenance from the regional planning provider (e.g. "Waikato",
    // "Northland") when the pipeline resolved one; matching still runs on
    // leaf-suburb names so coverage isn't limited to coded providers.
    region: raw.planning_provider?.region ?? null,
    // Region-agnostic modelling gate: the pipeline (regional-rules.ts) already
    // nulls out `derived_scores.zone` whenever the property's region/zone isn't
    // properly modelled for automatic yield claims (regardless of WHICH region
    // — Auckland, or any region with its own rule pack e.g. Hamilton/Whangarei).
    // So a present zone already means the lot count here is trustworthy; no
    // Auckland-specific check is needed, and none should be reintroduced.
    aupCovered: zone != null,

    slopeDegrees: raw.contour?.slope_degrees ?? null,
    contourClass: raw.contour?.classification ?? null,

    stormOnParcel: storm,
    sewerOnParcel: sewer,
    waterOnParcel: water,
    allServicesOnParcel: storm && sewer && water,
    maxInfraRisk: worstInfraRisk(infra),

    landAreaSqm: ds?.landArea ?? null,
    zoneCode: zone,
    potentialLots: ds?.potentialLots ?? null,
    standardVacantLots: ds?.standardVacantLots ?? null,
    minLotSizeSqm: ds?.minLotSize ?? null,

    cvNzd: null, // filled by the single-property value-lookup phase
    estateType: raw.linz_title?.estate_type ?? null,

    scoreComposite: ds?.scores?.composite ?? null,
    scoreRoi: ds?.scores?.roi ?? null,
    roiPercentBest: ds?.roiPercentBest ?? null,
    dwellingCondition: condition?.condition ?? null,
    recentImprovement: condition?.recentImprovement ?? null,
    conditionConfidence: condition?.confidence ?? null,
    conditionCostPenalty: condition?.costPenalty ?? null,

    scoringVersion: ds?.scoringVersion ?? null,
    pipelineVersion: id.pipelineVersion ?? null,
    lastRefreshedAt: id.lastRefreshedAt ?? new Date(),
  };
}
