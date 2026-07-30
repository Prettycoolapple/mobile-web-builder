import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { profiles } from "./profiles";

/**
 * Every distinct subdivision layout Rubin has ever generated — the training
 * corpus.
 *
 * Append-only and deduped. A layout is identified by its **geometry alone**
 * (`fingerprint`, a SHA-256 the server computes over the canonicalised rings),
 * so two users who independently generate the same arrangement on the same site
 * land on one row rather than two near-identical ones. The point is a corpus of
 * *options* — the genuinely different ways a given site can be cut up — not a
 * log of runs. Who produced each layout, and how often, lives in
 * `rubin_layout_generations`.
 *
 * Nothing here is ever updated or deleted in the normal course of things: a
 * layout that stops being someone's current one is still a real answer to a
 * real site.
 *
 * ## Site keys
 *
 * Two of them, following `site_plan_layer_cache`'s pattern:
 *
 * - `site_key` — `parcel:{parcelId}` when the cadastral lookup returned an id,
 *   otherwise the geo key. This is the dedup scope.
 * - `geo_key` — `{lat4}:{lng4}`, on **every** row, because the app's Rubin
 *   screen knows the coordinates it opened long before it knows a parcel id.
 *   Without it, a save that resolved a parcel id could never be found again by
 *   a client that only has coordinates.
 */
export const rubinLayouts = pgTable(
  "rubin_layouts",
  {
    id: text("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    /** `parcel:{parcelId}` when known, else the geo key. Dedup scope. */
    siteKey: text("site_key").notNull(),
    /** `{lat4}:{lng4}` — always present, for coordinate-only lookups. */
    geoKey: text("geo_key").notNull(),
    /** SHA-256 of `canonical`, computed server-side. Never trusted from a client. */
    fingerprint: text("fingerprint").notNull(),
    /** The geometry-only canonical string the fingerprint was taken over. */
    canonical: text("canonical").notNull(),
    /** The full SerializedLayout (NZTM), stored verbatim. */
    layout: jsonb("layout").notNull(),
    parcelId: text("parcel_id"),
    address: text("address"),
    zone: text("zone"),
    typology: text("typology"),
    intensity: text("intensity"),
    solverVersion: text("solver_version"),
    lotCount: integer("lot_count"),
    /**
     * Phase 2: the site as the solver saw it (parcel ring, zone rules, services
     * and contours summary), so an exported training pair carries its inputs and
     * not just its output.
     */
    siteContext: jsonb("site_context"),
    /** First user to produce this layout. Attribution for the rest is in the generations table. */
    createdBy: text("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    // The dedup constraint the save transaction's ON CONFLICT targets.
    uniqueIndex("rubin_layouts_site_fingerprint_unique").on(t.siteKey, t.fingerprint),
    index("rubin_layouts_site_key_idx").on(t.siteKey),
    index("rubin_layouts_geo_key_idx").on(t.geoKey),
  ],
);

export type RubinLayout = typeof rubinLayouts.$inferSelect;
export type InsertRubinLayout = typeof rubinLayouts.$inferInsert;
