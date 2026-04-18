import { logger } from "../logger";
import type { LinzParcel } from "../linz";
import type { Overlay, ZoneResult } from "../auckland-council";
import type { InfrastructureItem } from "../infrastructure";
import type { HougardenData } from "./hougarden";
import type { OneRoofData, ComparableSale } from "./oneroof";
import type { QVData } from "./qv";
import type { HomesData } from "./homes";
import type { PropertyHistory } from "../property-data";

export interface MergedPropertyData {
  cv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  zone_code: string | null;
  zone_description: string | null;
  min_lot_size_sqm: number | null;
  overlays: Overlay[];
  school_zones: { primary: string | null; intermediate: string | null; secondary: string | null };
  last_sale_price: number | null;
  last_sale_date: string | null;
  listing_active: boolean;
  listing_price: number | null;
  main_photo_url: string | null;
  overlay_map_image_base64: string | null;
  comparables: ComparableSale[];
  data_sources: Record<string, string>;
  /**
   * Human-readable notes describing each material disagreement that the merge
   * had to resolve (e.g. live OneRoof listing overriding council floor area).
   * Surfaced into the property_overview_snapshot so the report UI and the
   * follow-up chat can stay consistent about *why* a value was chosen.
   */
  discrepancies: string[];
  contour: "flat" | "gentle" | "moderate" | "steep" | null;
  contour_slope_degrees: number | null;
  contour_source: string | null;
  contour_text: string | null;
  asbestos_risk: "low" | "high" | "unknown";
  infrastructure: InfrastructureItem[];
  missing_critical_fields: string[];
}

// ─── Simple "first non-null" helper ──────────────────────────────────────────
function first<T>(label: string, sources: Record<string, string>, ...candidates: Array<[string, T | null | undefined]>): T | null {
  for (const [src, val] of candidates) {
    if (val != null && val !== undefined) {
      sources[label] = src;
      return val;
    }
  }
  return null;
}

// ─── Smart CV merge: pick the value with the most recent valuation year ───────
// All NZ scrapers pull from the same Auckland Council ratings database. If
// sources differ it is because one cached an older valuation year. The most
// recent year is always the ground truth.
function bestCV(
  sources: Record<string, string>,
  candidates: Array<{ src: string; cv_nzd: number | null | undefined; cv_year: number | null | undefined }>,
): { cv_nzd: number | null; cv_year: number | null } {
  let bestNzd: number | null = null;
  let bestYear: number | null = null;
  let bestSrc: string | null = null;

  for (const c of candidates) {
    if (c.cv_nzd == null) continue;
    const year = c.cv_year ?? null;
    if (bestNzd === null) {
      // First valid value — take it
      bestNzd = c.cv_nzd; bestYear = year; bestSrc = c.src;
    } else if (year != null && (bestYear == null || year > bestYear)) {
      // More recent valuation year — upgrade
      bestNzd = c.cv_nzd; bestYear = year; bestSrc = c.src;
    }
  }

  if (bestSrc) sources["cv_nzd"] = bestSrc;
  return { cv_nzd: bestNzd, cv_year: bestYear };
}

// ─── Smart build-year merge: majority consensus with conflict detection ────────
// Scrapers all derive from AC records but may parse "year of last renovation"
// vs "original construction". We group values within ±3 years and pick the
// largest agreement group. On conflict we take the earliest value — original
// construction is always what matters for development feasibility.
function consensusBuildYear(
  sources: Record<string, string>,
  candidates: Array<{ src: string; build_year: number | null | undefined }>,
): number | null {
  const valid = candidates.filter((c): c is { src: string; build_year: number } => c.build_year != null);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    sources["build_year"] = valid[0].src;
    return valid[0].build_year;
  }

  // Group values that are within ±3 years of each other
  const groups: Array<{ key: number; members: Array<{ src: string; build_year: number }> }> = [];
  for (const item of valid) {
    const existing = groups.find((g) => Math.abs(item.build_year - g.key) <= 3);
    if (existing) {
      existing.members.push(item);
    } else {
      groups.push({ key: item.build_year, members: [item] });
    }
  }

  // Sort groups: largest first, then earliest year (original construction)
  groups.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    return a.key - b.key; // earlier year wins tiebreak
  });

  const winner = groups[0];
  const avgYear = Math.round(
    winner.members.reduce((sum, m) => sum + m.build_year, 0) / winner.members.length,
  );

  if (groups.length > 1) {
    logger.warn(
      { agreed: winner.members.map((m) => `${m.src}:${m.build_year}`), rejected: groups.slice(1).flatMap((g) => g.members.map((m) => `${m.src}:${m.build_year}`)) },
      "Build year conflict between sources — using majority/earliest group",
    );
  }

  sources["build_year"] = winner.members.length > 1
    ? `consensus(${winner.members.map((m) => m.src).join(",")})`
    : winner.members[0].src;

  return avgYear;
}

// ─── Smart floor-area merge: median of credible values ───────────────────────
// Scrapers may include/exclude garage (20-40m² diff). Median filters outliers.
// Values outside [40, 2000] m² are treated as parse errors and excluded.
function medianFloorArea(
  sources: Record<string, string>,
  candidates: Array<{ src: string; floor_area_sqm: number | null | undefined }>,
): number | null {
  const valid = candidates.filter(
    (c): c is { src: string; floor_area_sqm: number } =>
      c.floor_area_sqm != null && c.floor_area_sqm >= 40 && c.floor_area_sqm <= 2000,
  );

  if (valid.length === 0) return null;

  const sorted = [...valid].sort((a, b) => a.floor_area_sqm - b.floor_area_sqm);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1].floor_area_sqm + sorted[mid].floor_area_sqm) / 2)
    : sorted[mid].floor_area_sqm;

  // Log if sources differ significantly (>20%)
  if (valid.length > 1) {
    const max = sorted[sorted.length - 1].floor_area_sqm;
    const min = sorted[0].floor_area_sqm;
    if ((max - min) / min > 0.2) {
      logger.warn(
        { values: valid.map((v) => `${v.src}:${v.floor_area_sqm}`), median },
        "Floor area varies >20% across sources — using median",
      );
    }
  }

  sources["floor_area_sqm"] = valid.length > 1
    ? `median(${valid.map((v) => v.src).join(",")})`
    : valid[0].src;

  return median;
}

export function mergePropertyData(
  linz: LinzParcel | null,
  hougarden: HougardenData | null,
  oneroof: OneRoofData | null,
  councilZone: ZoneResult | null,
  councilOverlays: Overlay[],
  extra?: {
    contour: "flat" | "gentle" | "moderate" | "steep" | null;
    contour_slope_degrees?: number | null;
    contour_source?: string | null;
    contour_text?: string | null;
    asbestos_risk: "low" | "high" | "unknown";
    infrastructure: InfrastructureItem[];
    property_history?: PropertyHistory | null;
    qv?: QVData | null;
    homes?: HomesData | null;
  },
): MergedPropertyData {
  const sources: Record<string, string> = {};
  const ph = extra?.property_history ?? null;
  const qv = extra?.qv ?? null;
  const homes = extra?.homes ?? null;

  // Land area: LINZ is the authoritative cadastral measurement — always wins.
  const land_area_sqm = first("land_area_sqm", sources,
    ["linz", linz?.area_sqm],
    ["auckland_council_gis", ph?.land_area_sqm],
    ["hougarden", hougarden?.land_area_sqm],
    ["oneroof", oneroof?.land_area_sqm],
    ["qv", qv?.land_area_sqm],
    ["homes", homes?.land_area_sqm],
  );

  // CV: pick the valuation with the most recent year, not just the first non-null.
  const { cv_nzd, cv_year } = bestCV(sources, [
    { src: "oneroof",            cv_nzd: oneroof?.cv_nzd,  cv_year: oneroof?.cv_year },
    { src: "hougarden",          cv_nzd: hougarden?.cv_nzd, cv_year: undefined },
    { src: "auckland_council_gis", cv_nzd: ph?.cv_nzd,     cv_year: ph?.cv_year },
    { src: "qv",                 cv_nzd: qv?.cv_nzd,       cv_year: qv?.cv_year },
    { src: "homes",              cv_nzd: homes?.cv_nzd,    cv_year: undefined },
  ]);

  // Build year: consensus across all sources.
  const build_year = consensusBuildYear(sources, [
    { src: "oneroof",            build_year: oneroof?.build_year },
    { src: "hougarden",          build_year: hougarden?.build_year },
    { src: "auckland_council_gis", build_year: ph?.build_year },
    { src: "qv",                 build_year: qv?.build_year },
    { src: "homes",              build_year: homes?.build_year },
  ]);

  // Floor area: median of credible values.
  let floor_area_sqm = medianFloorArea(sources, [
    { src: "oneroof",            floor_area_sqm: oneroof?.floor_area_sqm },
    { src: "hougarden",          floor_area_sqm: hougarden?.floor_area_sqm },
    { src: "auckland_council_gis", floor_area_sqm: ph?.floor_area_sqm },
    { src: "qv",                 floor_area_sqm: qv?.floor_area_sqm },
    { src: "homes",              floor_area_sqm: homes?.floor_area_sqm },
  ]);

  let bedrooms = first("bedrooms", sources,
    ["oneroof", oneroof?.bedrooms],
    ["homes",   homes?.bedrooms],
  );
  let bathrooms = first("bathrooms", sources,
    ["oneroof", oneroof?.bathrooms],
    ["homes",   homes?.bathrooms],
  );

  // Track human-readable discrepancy notes for everything the live-listing
  // reconciliation rewrites. Surfaced via MergedPropertyData.discrepancies so
  // the report UI and the follow-up chat can stay aligned on *why* a value
  // was chosen.
  const discrepancies: string[] = [];

  // Live-listing reconciliation:
  // When OneRoof shows the property is *currently listed for sale*, the listing
  // data is being actively maintained by the agent and reflects the property
  // *as it is today* (post-renovation, post-subdivision, post-extension).
  // Council/QV records can lag by years. If the active-listing values
  // materially disagree with the consensus, prefer the listing.
  let live_land_area_sqm: number | null = null;
  let live_build_year: number | null = null;
  if (oneroof?.listing_active) {
    if (oneroof.floor_area_sqm != null && floor_area_sqm != null) {
      const delta = Math.abs(oneroof.floor_area_sqm - floor_area_sqm) / floor_area_sqm;
      if (delta > 0.15) {
        logger.info(
          { previous: floor_area_sqm, listing: oneroof.floor_area_sqm, delta },
          "Merge: live OneRoof listing overrides floor area (>15% disagreement)",
        );
        discrepancies.push(
          `Floor area: live OneRoof listing reports ${oneroof.floor_area_sqm}m² vs council/QV consensus ${floor_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the live listing as the most current measurement.`,
        );
        floor_area_sqm = oneroof.floor_area_sqm;
        sources["floor_area_sqm"] = "oneroof (live listing)";
      }
    } else if (oneroof.floor_area_sqm != null && floor_area_sqm == null) {
      floor_area_sqm = oneroof.floor_area_sqm;
      sources["floor_area_sqm"] = "oneroof (live listing)";
    }
    if (oneroof.bedrooms != null && bedrooms != null && oneroof.bedrooms !== bedrooms) {
      logger.info(
        { previous: bedrooms, listing: oneroof.bedrooms },
        "Merge: live OneRoof listing overrides bedroom count",
      );
      discrepancies.push(
        `Bedrooms: live OneRoof listing reports ${oneroof.bedrooms} vs council/QV record ${bedrooms}. Using the live listing.`,
      );
      bedrooms = oneroof.bedrooms;
      sources["bedrooms"] = "oneroof (live listing)";
    } else if (oneroof.bedrooms != null && bedrooms == null) {
      bedrooms = oneroof.bedrooms;
      sources["bedrooms"] = "oneroof (live listing)";
    }
    if (oneroof.bathrooms != null && bathrooms != null && oneroof.bathrooms !== bathrooms) {
      logger.info(
        { previous: bathrooms, listing: oneroof.bathrooms },
        "Merge: live OneRoof listing overrides bathroom count",
      );
      discrepancies.push(
        `Bathrooms: live OneRoof listing reports ${oneroof.bathrooms} vs council/QV record ${bathrooms}. Using the live listing.`,
      );
      bathrooms = oneroof.bathrooms;
      sources["bathrooms"] = "oneroof (live listing)";
    } else if (oneroof.bathrooms != null && bathrooms == null) {
      bathrooms = oneroof.bathrooms;
      sources["bathrooms"] = "oneroof (live listing)";
    }
    // Land area: LINZ is cadastral truth, but if the live listing materially
    // disagrees (>10%) it usually means the parcel was subdivided after the
    // last LINZ refresh and the listing reflects the new title size.
    if (oneroof.land_area_sqm != null && land_area_sqm != null) {
      const delta = Math.abs(oneroof.land_area_sqm - land_area_sqm) / land_area_sqm;
      if (delta > 0.1) {
        logger.info(
          { previous: land_area_sqm, listing: oneroof.land_area_sqm, delta },
          "Merge: live OneRoof listing overrides land area (>10% disagreement — likely post-subdivision)",
        );
        discrepancies.push(
          `Land area: live OneRoof listing reports ${oneroof.land_area_sqm}m² vs LINZ cadastre ${land_area_sqm}m² (${(delta * 100).toFixed(0)}% difference — usually a recent subdivision). Using the live listing.`,
        );
        live_land_area_sqm = oneroof.land_area_sqm;
        sources["land_area_sqm"] = "oneroof (live listing)";
      }
    }
    // Build year: a brand-new build on market is often missing from council
    // records for 6–18 months. Trust the live listing's build year when it is
    // newer (renovation/replacement dwelling).
    if (oneroof.build_year != null && build_year != null && oneroof.build_year > build_year + 3) {
      logger.info(
        { previous: build_year, listing: oneroof.build_year },
        "Merge: live OneRoof listing overrides build year (newer build)",
      );
      discrepancies.push(
        `Build year: live OneRoof listing reports ${oneroof.build_year} vs council/QV consensus ${build_year}. Using the live listing (likely a newer build or replacement dwelling).`,
      );
      live_build_year = oneroof.build_year;
      sources["build_year"] = "oneroof (live listing)";
    } else if (oneroof.build_year != null && build_year == null) {
      live_build_year = oneroof.build_year;
      sources["build_year"] = "oneroof (live listing)";
    }
  }
  const final_land_area_sqm = live_land_area_sqm ?? land_area_sqm;
  const final_build_year = live_build_year ?? build_year;

  let overlays: Overlay[] = [];
  if (hougarden && hougarden.overlays.length > 0) {
    overlays = hougarden.overlays;
    sources["overlays"] = "hougarden";
  } else if (councilOverlays.length > 0) {
    overlays = councilOverlays;
    sources["overlays"] = "auckland_council_gis";
  }

  let zone_code: string | null = null;
  let zone_description: string | null = null;
  let min_lot_size_sqm: number | null = null;
  if (hougarden?.zone_code) {
    zone_code = hougarden.zone_code;
    zone_description = hougarden.zone_description;
    sources["zone"] = "hougarden";
  } else if (councilZone?.zone_code && councilZone.zone_code !== "UNKNOWN") {
    zone_code = councilZone.zone_code;
    zone_description = councilZone.zone_description;
    min_lot_size_sqm = councilZone.min_lot_size_sqm;
    sources["zone"] = "auckland_council_gis";
  }

  if (!min_lot_size_sqm && zone_code) {
    const LOT_SIZES: Record<string, number> = {
      THAB: 0, MHU: 300, MHS: 400, SHZ: 600, LLRZ: 4000, RCSZ: 2000, LDRZ: 600, FUZ: 0,
      BPZ: 0, CCZ: 0, GBZ: 0, BPIZ: 0, LCZ: 0, MCZ: 0, MUZ: 0, NCZ: 0, TCZ: 0,
    };
    min_lot_size_sqm = LOT_SIZES[zone_code] ?? null;
  }

  const last_sale_price = first("last_sale_price", sources, ["oneroof", oneroof?.last_sale_price]);
  const last_sale_date  = first("last_sale_date",  sources, ["oneroof", oneroof?.last_sale_date]);
  // Listing price: when OneRoof confirms the property is currently on market,
  // its asking price is the freshest figure; prefer it unconditionally.
  const listing_price = oneroof?.listing_active && oneroof.listing_price != null
    ? (sources["listing_price"] = "oneroof (live listing)", oneroof.listing_price)
    : first("listing_price", sources, ["oneroof", oneroof?.listing_price]);

  const school_zones          = hougarden?.school_zones ?? { primary: null, intermediate: null, secondary: null };
  const main_photo_url        = oneroof?.main_photo_url ?? null;
  const overlay_map_image_base64 = hougarden?.overlay_map_image_base64 ?? null;

  const comparables: ComparableSale[] = oneroof?.comparables ?? [];
  sources["comparables"] = comparables.length >= 3 ? "oneroof" : "oneroof (limited)";

  const missing_critical_fields: string[] = [];
  if (cv_nzd === null)                                                          missing_critical_fields.push("cv_nzd");
  if (final_land_area_sqm === null)                                             missing_critical_fields.push("land_area_sqm");
  if (extra?.contour === null || extra?.contour === undefined)                  missing_critical_fields.push("contour");

  logger.info({ sources, missing_critical_fields, cv_nzd, cv_year, land_area_sqm: final_land_area_sqm, build_year: final_build_year, floor_area_sqm, discrepancies }, "Merge: data sources selected");

  return {
    cv_nzd,
    cv_year,
    land_area_sqm: final_land_area_sqm,
    floor_area_sqm,
    build_year: final_build_year,
    bedrooms,
    bathrooms,
    zone_code,
    zone_description,
    min_lot_size_sqm,
    overlays,
    school_zones,
    last_sale_price,
    last_sale_date,
    listing_active: oneroof?.listing_active ?? false,
    listing_price,
    main_photo_url,
    overlay_map_image_base64,
    comparables,
    data_sources: sources,
    discrepancies,
    contour: extra?.contour ?? null,
    contour_slope_degrees: extra?.contour_slope_degrees ?? null,
    contour_source: extra?.contour_source ?? null,
    contour_text: extra?.contour_text ?? null,
    asbestos_risk: extra?.asbestos_risk ?? "unknown",
    infrastructure: extra?.infrastructure ?? [],
    missing_critical_fields,
  };
}
