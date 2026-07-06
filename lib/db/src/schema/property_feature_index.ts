import {
  pgTable,
  text,
  integer,
  bigint,
  doublePrecision,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";

/**
 * Queryable, structured projection of the MEASURED facts inside each
 * property_cache row's raw_data JSONB blob — one row per analysed property,
 * keyed by the same address_key. This is the index that powers "reverse
 * engineering" criteria search ("flat land with services on the parcel that
 * splits into 4 lots") without cracking open the JSONB on every query.
 *
 * It is a strict PROJECTION: property_cache stays the source of truth. Every
 * column is extracted from raw_data by deriveFeatureRow() (see
 * lib/property-feature-index.ts) and refreshed at the exact points the cache is
 * written. A row may momentarily lag the cache (best-effort writes) and is
 * re-derived on the next analysis/rescan, so treat it as a SEARCH ACCELERATOR,
 * never an authority — the full report always re-reads raw_data.
 *
 * Derived/financial numbers (lots, scores, ROI) carry `scoring_version` so a
 * query can exclude rows scored under an old formula — mirroring listByScore()
 * in lib/property-cache.ts. Terrain/infrastructure columns come from RAW
 * measured data (contour, infrastructure) and are scoring-version independent.
 */
export const propertyFeatureIndex = pgTable(
  "property_feature_index",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()`),
    /** Links 1:1 to property_cache.address_key (normaliseAddressKey output). */
    addressKey: text("address_key").notNull(),
    canonicalParcelId: text("canonical_parcel_id"),
    suburb: text("suburb"),
    /** Geocoded display address, denormalised from property_cache for cards. */
    formattedAddress: text("formatted_address"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Coarse region label when known (e.g. "auckland"); null until derived. */
    region: text("region"),
    /** True when this property's zone/lot/ROI modelling is trustworthy —
     * region-agnostic: mirrors whether `derived_scores.zone` is non-null, which
     * the pipeline (regional-rules.ts) already sets for ANY region with a
     * working rule pack (Auckland, or any other region once modelled), and
     * nulls for regions not yet supported. Column name predates multi-region
     * support; kept to avoid a migration. Informational only — search no
     * longer filters on it, since a null zone/lots/ROI already fails the
     * numeric predicates naturally. */
    aupCovered: boolean("aup_covered").notNull().default(false),

    // Terrain — raw_data.contour (measured; scoring-version independent)
    slopeDegrees: doublePrecision("slope_degrees"),
    contourClass: text("contour_class"), // flat|subtle|gentle|moderate|steep|very_steep

    // Infrastructure — raw_data.infrastructure[] flattened to on-parcel booleans
    stormOnParcel: boolean("storm_on_parcel").notNull().default(false),
    sewerOnParcel: boolean("sewer_on_parcel").notNull().default(false),
    waterOnParcel: boolean("water_on_parcel").notNull().default(false),
    allServicesOnParcel: boolean("all_services_on_parcel").notNull().default(false),
    maxInfraRisk: text("max_infra_risk"), // low|moderate|high

    // Subdivision — raw_data.derived_scores (scoring-version gated)
    landAreaSqm: doublePrecision("land_area_sqm"),
    zoneCode: text("zone_code"),
    potentialLots: integer("potential_lots"),
    standardVacantLots: integer("standard_vacant_lots"),
    minLotSizeSqm: doublePrecision("min_lot_size_sqm"),

    // Valuation / tenure
    cvNzd: bigint("cv_nzd", { mode: "number" }),
    estateType: text("estate_type"), // raw_data.linz_title.estate_type (e.g. "Fee Simple")

    // Scores — raw_data.derived_scores.scores (0.5–5 sub-scores) + real ROI %
    scoreComposite: doublePrecision("score_composite"),
    scoreRoi: doublePrecision("score_roi"), // 0.5–5 sub-score, NOT a percentage
    roiPercentBest: doublePrecision("roi_percent_best"), // real % — null until SCORING_VERSION persists it

    dwellingCondition: text("dwelling_condition"),
    recentImprovement: boolean("recent_improvement"),
    conditionConfidence: text("condition_confidence"),
    conditionCostPenalty: doublePrecision("condition_cost_penalty"),

    // Provenance / drift control
    scoringVersion: integer("scoring_version"),
    pipelineVersion: integer("pipeline_version"),
    lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
    indexedAt: timestamp("indexed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    addressKeyUnique: uniqueIndex("property_feature_index_address_key_unique").on(table.addressKey),
    parcelIdx: index("property_feature_index_parcel_idx").on(table.canonicalParcelId),
    suburbLotsIdx: index("property_feature_index_suburb_lots_idx").on(table.suburb, table.potentialLots),
    suburbSlopeIdx: index("property_feature_index_suburb_slope_idx").on(table.suburb, table.slopeDegrees),
    suburbScoreIdx: index("property_feature_index_suburb_score_idx").on(table.suburb, table.scoreComposite),
  }),
);

export const insertPropertyFeatureIndexSchema = createInsertSchema(propertyFeatureIndex).omit({
  id: true,
  indexedAt: true,
});

export type PropertyFeatureIndexRow = typeof propertyFeatureIndex.$inferSelect;
export type InsertPropertyFeatureIndex = z.infer<typeof insertPropertyFeatureIndexSchema>;
