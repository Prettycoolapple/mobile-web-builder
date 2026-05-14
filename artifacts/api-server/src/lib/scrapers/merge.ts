import { logger } from "../logger";
import type { LinzParcel } from "../linz";
import type { Overlay, ZoneResult } from "../auckland-council";
import type { InfrastructureItem } from "../infrastructure";
import type { HougardenData } from "./hougarden";
import type { OneRoofData, ComparableSale, ListingResult } from "./oneroof";
import type { QVData } from "./qv";
import type { HomesData } from "./homes";
import type { PropertyValueData } from "./propertyvalue";
import type { PropertyHistory } from "../property-data";

export interface MergedPropertyData {
  cv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  build_year_range: string | null;
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
  photo_urls: string[];
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
  /** LINZ title estate description when resolved (e.g. Fee Simple / cross lease). */
  estate_type: string | null;
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

// ─── Smart build-year merge: precision-aware with conflict detection ───────────
// Some sources expose only a built decade (e.g. "2010s") and our scraper stores
// that as the decade start (2010). Prefer a nearby exact year (e.g. 2016) over
// a rounded decade value so users see the actual build year where available.
function resolveBuildYear(
  sources: Record<string, string>,
  candidates: Array<{ src: string; build_year: number | null | undefined }>,
): { build_year: number | null; note: string | null } {
  const valid = candidates.filter((c): c is { src: string; build_year: number } => c.build_year != null);
  if (valid.length === 0) return { build_year: null, note: null };
  if (valid.length === 1) {
    sources["build_year"] = valid[0].src;
    return { build_year: valid[0].build_year, note: null };
  }

  const exact = valid.filter((c) => c.build_year % 10 !== 0);
  const decade = valid.filter((c) => c.build_year % 10 === 0);

  if (exact.length > 0) {
    const exactGroups: Array<{ key: number; members: typeof exact }> = [];
    for (const item of exact) {
      const existing = exactGroups.find((g) => Math.abs(item.build_year - g.key) <= 3);
      if (existing) {
        existing.members.push(item);
      } else {
        exactGroups.push({ key: item.build_year, members: [item] });
      }
    }
    exactGroups.sort((a, b) => {
      if (b.members.length !== a.members.length) return b.members.length - a.members.length;
      const aHasOr = a.members.some((m) => m.src === "oneroof");
      const bHasOr = b.members.some((m) => m.src === "oneroof");
      if (aHasOr !== bHasOr) return aHasOr ? -1 : 1;
      // Prefer newer year on tie — records often lag replacements; property pages update sooner
      return b.key - a.key;
    });

    const winner = exactGroups[0];
    const year = Math.round(winner.members.reduce((sum, m) => sum + m.build_year, 0) / winner.members.length);
    sources["build_year"] = winner.members.length > 1
      ? `exact-consensus(${winner.members.map((m) => m.src).join(",")})`
      : winner.members[0].src;

    const nearbyDecade = decade.find((d) => Math.abs(d.build_year - year) <= 9);
    if (nearbyDecade) {
      return {
        build_year: year,
        note: `Build year: exact source ${sources["build_year"]} reports ${year}; rounded decade value ${nearbyDecade.build_year} from ${nearbyDecade.src} was ignored.`,
      };
    }

    if (exactGroups.length > 1 || decade.length > 0) {
      logger.warn(
        { selected: `${sources["build_year"]}:${year}`, rejected: valid.filter((v) => Math.abs(v.build_year - year) > 3).map((v) => `${v.src}:${v.build_year}`) },
        "Build year conflict between sources — using exact-year source",
      );
    }
    return { build_year: year, note: null };
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

  // Sort groups: largest first, then prefer OneRoof / newer year on tie
  groups.sort((a, b) => {
    if (b.members.length !== a.members.length) return b.members.length - a.members.length;
    const aHasOr = a.members.some((m) => m.src === "oneroof");
    const bHasOr = b.members.some((m) => m.src === "oneroof");
    if (aHasOr !== bHasOr) return aHasOr ? -1 : 1;
    return b.key - a.key; // newer year on tie (see exact-group rationale)
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

  return { build_year: avgYear, note: null };
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

  if (sorted.length === 2) {
    const [lo, hi] = sorted;
    if ((hi.floor_area_sqm - lo.floor_area_sqm) / lo.floor_area_sqm > 0.2) {
      const stable = sorted.find((v) => v.src !== "realestate.co.nz") ?? lo;
      logger.warn(
        { values: valid.map((v) => `${v.src}:${v.floor_area_sqm}`), selected: `${stable.src}:${stable.floor_area_sqm}` },
        "Floor area has one uncorroborated listing outlier - using stable source",
      );
      sources["floor_area_sqm"] = `${stable.src} (preferred over uncorroborated listing outlier)`;
      return stable.floor_area_sqm;
    }
  }

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

function areaClose(a: number, b: number, tolerancePct: number): boolean {
  const pct = Math.abs(a - b) / Math.max(a, b);
  return pct <= tolerancePct;
}

function corroboratingAreaSource(
  target: number,
  candidates: Array<{ src: string; value: number | null | undefined }>,
  tolerancePct: number,
): { src: string; value: number } | null {
  for (const candidate of candidates) {
    if (candidate.value == null) continue;
    if (areaClose(candidate.value, target, tolerancePct)) {
      return { src: candidate.src, value: candidate.value };
    }
  }
  return null;
}

function shouldUseLiveAreaOverride(
  current: number | null,
  liveValue: number | null | undefined,
  liveApprox: boolean | undefined,
  corroborators: Array<{ src: string; value: number | null | undefined }>,
  tolerancePct: number,
): { use: boolean; corroborator: { src: string; value: number } | null } {
  if (liveValue == null) return { use: false, corroborator: null };
  if (liveApprox) return { use: false, corroborator: null };
  if (current == null) return { use: true, corroborator: null };
  if (areaClose(current, liveValue, tolerancePct)) return { use: false, corroborator: null };
  const corroborator = corroboratingAreaSource(liveValue, corroborators, tolerancePct);
  return { use: !!corroborator, corroborator };
}

function inferLifestyleZone(
  propertyValue: PropertyValueData | null,
  landAreaSqm: number | null,
): { code: string; description: string; minLotSizeSqm: number } | null {
  const typeText = [
    propertyValue?.property_type,
    propertyValue?.property_sub_type,
  ].filter(Boolean).join(" ").toLowerCase();
  const area = landAreaSqm ?? propertyValue?.land_area_sqm ?? null;

  if (area != null && area >= 8000 && /\blifestyle\b/.test(typeText)) {
    return {
      code: "CLZ",
      description: "Countryside Living Zone",
      minLotSizeSqm: 10000,
    };
  }

  return null;
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
    propertyValue?: PropertyValueData | null;
    /** Active address-matched listing from realestate.co.nz. */
    realestate_listing?: ListingResult | null;
    /** Active listing images from realestate.co.nz when OneRoof has none. */
    realestate_photo_urls?: string[] | null;
  },
): MergedPropertyData {
  const sources: Record<string, string> = {};
  const ph = extra?.property_history ?? null;
  const qv = extra?.qv ?? null;
  const homes = extra?.homes ?? null;
  const propertyValue = extra?.propertyValue ?? null;
  const realestateListing = extra?.realestate_listing ?? null;

  // Land area: LINZ is the authoritative cadastral measurement — always wins.
  const land_area_sqm = first("land_area_sqm", sources,
    ["linz", linz?.area_sqm],
    ["auckland_council_gis", ph?.land_area_sqm],
    ["propertyvalue", propertyValue?.land_area_sqm],
    ["qv", qv?.land_area_sqm],
    ["homes", homes?.land_area_sqm],
    ["hougarden", hougarden?.land_area_sqm],
    ["oneroof", oneroof?.land_area_sqm],
    ["realestate.co.nz", realestateListing?.landArea],
  );

  // CV: pick the valuation with the most recent year, not just the first non-null.
  const { cv_nzd, cv_year } = bestCV(sources, [
    { src: "propertyvalue",      cv_nzd: propertyValue?.cv_nzd, cv_year: propertyValue?.cv_year },
    { src: "oneroof",            cv_nzd: oneroof?.cv_nzd,  cv_year: oneroof?.cv_year },
    { src: "hougarden",          cv_nzd: hougarden?.cv_nzd, cv_year: undefined },
    { src: "auckland_council_gis", cv_nzd: ph?.cv_nzd,     cv_year: ph?.cv_year },
    { src: "qv",                 cv_nzd: qv?.cv_nzd,       cv_year: qv?.cv_year },
    { src: "homes",              cv_nzd: homes?.cv_nzd,    cv_year: undefined },
  ]);

  // Build year: prefer exact source years over rounded decade values.
  const buildYearResult = resolveBuildYear(sources, [
    { src: "propertyvalue",      build_year: propertyValue?.build_year },
    { src: "oneroof",            build_year: oneroof?.build_year },
    { src: "hougarden",          build_year: hougarden?.build_year },
    { src: "auckland_council_gis", build_year: ph?.build_year },
    { src: "qv",                 build_year: qv?.build_year },
    { src: "homes",              build_year: homes?.build_year },
  ]);
  let build_year = buildYearResult.build_year;
  // When we have a range but no exact year, extract the end year as a fallback
  // (e.g. "2010-2019" → 2019). NZ council decades use the end year as the
  // registered completion year (same data CoreLogic/PropertyValue exposes as exact).
  const rawRange = build_year == null ? (propertyValue?.build_year_range ?? qv?.build_year_range ?? null) : null;
  if (build_year == null && rawRange) {
    const rangeEndM = rawRange.match(/\d{4}[–\-](\d{4})/);
    if (rangeEndM) {
      const endY = parseInt(rangeEndM[1], 10);
      if (endY >= 1800 && endY <= new Date().getFullYear() + 1) {
        build_year = endY;
        sources["build_year"] = "qv (range-end)";
      }
    }
  }
  const build_year_range = build_year == null ? rawRange : null;

  // Floor area: median of credible values.
  let floor_area_sqm = medianFloorArea(sources, [
    { src: "propertyvalue",      floor_area_sqm: propertyValue?.floor_area_sqm },
    { src: "oneroof",            floor_area_sqm: oneroof?.floor_area_sqm },
    { src: "realestate.co.nz",   floor_area_sqm: realestateListing?.floorArea },
    { src: "hougarden",          floor_area_sqm: hougarden?.floor_area_sqm },
    { src: "auckland_council_gis", floor_area_sqm: ph?.floor_area_sqm },
    { src: "qv",                 floor_area_sqm: qv?.floor_area_sqm },
    { src: "homes",              floor_area_sqm: homes?.floor_area_sqm },
  ]);

  let bedrooms = first("bedrooms", sources,
    ["oneroof", oneroof?.bedrooms],
    ["realestate.co.nz", realestateListing?.bedrooms],
    ["propertyvalue", propertyValue?.bedrooms],
    ["homes",   homes?.bedrooms],
    ["qv",      qv?.bedrooms],
  );
  let bathrooms = first("bathrooms", sources,
    ["oneroof", oneroof?.bathrooms],
    ["realestate.co.nz", realestateListing?.bathrooms],
    ["propertyvalue", propertyValue?.bathrooms],
    ["homes",   homes?.bathrooms],
    ["qv",      qv?.bathrooms],
  );

  // Track human-readable discrepancy notes for everything the live-listing
  // reconciliation rewrites. Surfaced via MergedPropertyData.discrepancies so
  // the report UI and the follow-up chat can stay aligned on *why* a value
  // was chosen.
  const discrepancies: string[] = [];
  if (buildYearResult.note) discrepancies.push(buildYearResult.note);

  // Live-listing reconciliation:
  // When OneRoof shows the property is *currently listed for sale*, the listing
  // data is being actively maintained by the agent and reflects the property
  // *as it is today* (post-renovation, post-subdivision, post-extension).
  // Council/QV records can lag by years. If the active-listing values
  // materially disagree with the consensus, prefer the listing.
  let live_land_area_sqm: number | null = null;
  if (oneroof?.listing_active) {
    if (oneroof.floor_area_sqm != null && floor_area_sqm != null) {
      const delta = Math.abs(oneroof.floor_area_sqm - floor_area_sqm) / floor_area_sqm;
      const override = shouldUseLiveAreaOverride(
        floor_area_sqm,
        oneroof.floor_area_sqm,
        false,
        [
          { src: "realestate.co.nz", value: realestateListing?.floorArea },
          { src: "propertyvalue", value: propertyValue?.floor_area_sqm },
          { src: "auckland_council_gis", value: ph?.floor_area_sqm },
          { src: "qv", value: qv?.floor_area_sqm },
          { src: "homes", value: homes?.floor_area_sqm },
          { src: "hougarden", value: hougarden?.floor_area_sqm },
        ],
        0.15,
      );
      if (delta > 0.15 && override.use) {
        logger.info(
          { previous: floor_area_sqm, listing: oneroof.floor_area_sqm, delta },
          "Merge: live OneRoof listing overrides floor area (>15% disagreement)",
        );
        discrepancies.push(
          `Floor area: live OneRoof listing reports ${oneroof.floor_area_sqm}m² vs council/QV consensus ${floor_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the live listing as the most current measurement.`,
        );
        floor_area_sqm = oneroof.floor_area_sqm;
        sources["floor_area_sqm"] = "oneroof (live listing)";
      } else if (delta > 0.15) {
        logger.warn(
          { current: floor_area_sqm, listing: oneroof.floor_area_sqm, delta },
          "Merge: ignored uncorroborated OneRoof floor-area outlier",
        );
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
      const override = shouldUseLiveAreaOverride(
        land_area_sqm,
        oneroof.land_area_sqm,
        false,
        [
          { src: "realestate.co.nz", value: realestateListing?.landArea },
          { src: "propertyvalue", value: propertyValue?.land_area_sqm },
          { src: "auckland_council_gis", value: ph?.land_area_sqm },
          { src: "qv", value: qv?.land_area_sqm },
          { src: "homes", value: homes?.land_area_sqm },
          { src: "hougarden", value: hougarden?.land_area_sqm },
        ],
        0.1,
      );
      if (delta > 0.1 && override.use) {
        logger.info(
          { previous: land_area_sqm, listing: oneroof.land_area_sqm, delta },
          "Merge: live OneRoof listing overrides land area (>10% disagreement — likely post-subdivision)",
        );
        discrepancies.push(
          `Land area: live OneRoof listing reports ${oneroof.land_area_sqm}m² vs LINZ cadastre ${land_area_sqm}m² (${(delta * 100).toFixed(0)}% difference — usually a recent subdivision). Using the live listing.`,
        );
        live_land_area_sqm = oneroof.land_area_sqm;
        sources["land_area_sqm"] = "oneroof (live listing)";
      } else if (delta > 0.1) {
        logger.warn(
          { cadastral: land_area_sqm, listing: oneroof.land_area_sqm, delta },
          "Merge: ignored uncorroborated OneRoof land-area outlier",
        );
      }
    }
  }

  // realestate.co.nz active-listing reconciliation:
  // In production the browser scrapers are often disabled, but the
  // realestate.co.nz JSON API still gives us structured active listing data.
  // Treat an address-matched active listing as fresher than static valuation
  // records for bed/bath/floor counts.
  if (realestateListing) {
    if (realestateListing.floorArea != null && floor_area_sqm != null) {
      const delta = Math.abs(realestateListing.floorArea - floor_area_sqm) / floor_area_sqm;
      const override = shouldUseLiveAreaOverride(
        floor_area_sqm,
        realestateListing.floorArea,
        realestateListing.floorAreaApprox,
        [
          { src: "oneroof", value: oneroof?.floor_area_sqm },
          { src: "propertyvalue", value: propertyValue?.floor_area_sqm },
          { src: "auckland_council_gis", value: ph?.floor_area_sqm },
          { src: "qv", value: qv?.floor_area_sqm },
          { src: "homes", value: homes?.floor_area_sqm },
          { src: "hougarden", value: hougarden?.floor_area_sqm },
        ],
        0.15,
      );
      if (delta > 0.15 && override.use) {
        logger.info(
          { previous: floor_area_sqm, listing: realestateListing.floorArea, delta },
          "Merge: active realestate.co.nz listing overrides floor area (>15% disagreement)",
        );
        discrepancies.push(
          `Floor area: active realestate.co.nz listing reports ${realestateListing.floorArea}m² vs council/QV consensus ${floor_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the active listing.`,
        );
        floor_area_sqm = realestateListing.floorArea;
        sources["floor_area_sqm"] = "realestate.co.nz (active listing)";
      } else if (delta > 0.15) {
        logger.warn(
          { current: floor_area_sqm, listing: realestateListing.floorArea, delta, approximate: realestateListing.floorAreaApprox },
          "Merge: ignored uncorroborated realestate.co.nz floor-area outlier",
        );
      }
    } else if (realestateListing.floorArea != null && floor_area_sqm == null) {
      floor_area_sqm = realestateListing.floorArea;
      sources["floor_area_sqm"] = "realestate.co.nz (active listing)";
    }

    if (realestateListing.bedrooms != null && bedrooms != null && realestateListing.bedrooms !== bedrooms) {
      logger.info(
        { previous: bedrooms, listing: realestateListing.bedrooms },
        "Merge: active realestate.co.nz listing overrides bedroom count",
      );
      discrepancies.push(
        `Bedrooms: active realestate.co.nz listing reports ${realestateListing.bedrooms} vs council/QV record ${bedrooms}. Using the active listing.`,
      );
      bedrooms = realestateListing.bedrooms;
      sources["bedrooms"] = "realestate.co.nz (active listing)";
    } else if (realestateListing.bedrooms != null && bedrooms == null) {
      bedrooms = realestateListing.bedrooms;
      sources["bedrooms"] = "realestate.co.nz (active listing)";
    }

    if (realestateListing.bathrooms != null && bathrooms != null && realestateListing.bathrooms !== bathrooms) {
      logger.info(
        { previous: bathrooms, listing: realestateListing.bathrooms },
        "Merge: active realestate.co.nz listing overrides bathroom count",
      );
      discrepancies.push(
        `Bathrooms: active realestate.co.nz listing reports ${realestateListing.bathrooms} vs council/QV record ${bathrooms}. Using the active listing.`,
      );
      bathrooms = realestateListing.bathrooms;
      sources["bathrooms"] = "realestate.co.nz (active listing)";
    } else if (realestateListing.bathrooms != null && bathrooms == null) {
      bathrooms = realestateListing.bathrooms;
      sources["bathrooms"] = "realestate.co.nz (active listing)";
    }

    if (realestateListing.landArea != null && land_area_sqm != null) {
      const delta = Math.abs(realestateListing.landArea - land_area_sqm) / land_area_sqm;
      const override = shouldUseLiveAreaOverride(
        land_area_sqm,
        realestateListing.landArea,
        realestateListing.landAreaApprox,
        [
          { src: "oneroof", value: oneroof?.land_area_sqm },
          { src: "propertyvalue", value: propertyValue?.land_area_sqm },
          { src: "auckland_council_gis", value: ph?.land_area_sqm },
          { src: "qv", value: qv?.land_area_sqm },
          { src: "homes", value: homes?.land_area_sqm },
          { src: "hougarden", value: hougarden?.land_area_sqm },
        ],
        0.1,
      );
      if (delta > 0.1 && override.use) {
        logger.info(
          { previous: land_area_sqm, listing: realestateListing.landArea, delta },
          "Merge: active realestate.co.nz listing overrides land area (>10% disagreement)",
        );
        discrepancies.push(
          `Land area: active realestate.co.nz listing reports ${realestateListing.landArea}m² vs LINZ cadastre ${land_area_sqm}m² (${(delta * 100).toFixed(0)}% difference). Using the active listing.`,
        );
        live_land_area_sqm = realestateListing.landArea;
        sources["land_area_sqm"] = "realestate.co.nz (active listing)";
      } else if (delta > 0.1) {
        logger.warn(
          { cadastral: land_area_sqm, listing: realestateListing.landArea, delta, approximate: realestateListing.landAreaApprox },
          "Merge: ignored uncorroborated realestate.co.nz land-area outlier",
        );
      }
    }
  }
  const final_land_area_sqm = live_land_area_sqm ?? land_area_sqm;

  // OneRoof property page often shows the year agents use in marketing; prefer it when it
  // resolves ambiguity (newer build, or exact year vs a rounded decade elsewhere). Not gated
  // on listing_active — the same HTML is used for sold/inactive property pages.
  if (oneroof?.build_year != null) {
    const orY = oneroof.build_year;
    if (build_year == null) {
      build_year = orY;
      sources["build_year"] = "oneroof";
    } else if (orY % 10 !== 0 && build_year % 10 === 0 && Math.abs(orY - build_year) <= 9) {
      logger.info({ consensusDecade: build_year, oneroofExact: orY }, "Merge: OneRoof exact build year over decade from other source(s)");
      discrepancies.push(
        `Build year: OneRoof reports ${orY} (exact year) vs rounded decade ${build_year} from other records. Using OneRoof.`,
      );
      build_year = orY;
      sources["build_year"] = "oneroof (exact vs decade)";
    } else if (orY > build_year + 3) {
      logger.info({ previous: build_year, oneroof: orY }, "Merge: OneRoof reports newer build year (replacement / record lag)");
      discrepancies.push(
        `Build year: OneRoof reports ${orY} vs other sources ${build_year}. Using OneRoof (likely newer dwelling or records not yet updated).`,
      );
      build_year = orY;
      sources["build_year"] = "oneroof (newer year)";
    }
  }

  const final_build_year = build_year;
  let final_build_year_range = build_year_range;
  const buildYearSource = sources["build_year"] ?? "";
  if (!final_build_year_range && buildYearSource.includes("propertyvalue") && propertyValue?.build_year_range) {
    final_build_year_range = propertyValue.build_year_range;
  } else if (!final_build_year_range && buildYearSource.includes("qv") && qv?.build_year_range) {
    final_build_year_range = qv.build_year_range;
  }

  // Auckland Council GIS is the authoritative overlay source. Hougarden text can
  // mention nearby/generic overlay names and has caused false report risks such
  // as volcanic viewshafts on sites where the AUP maps show none.
  const overlays: Overlay[] = councilOverlays;
  sources["overlays"] = "auckland_council_gis";

  let zone_code: string | null = null;
  let zone_description: string | null = null;
  let min_lot_size_sqm: number | null = null;
  const inferredLifestyleZone = inferLifestyleZone(propertyValue, final_land_area_sqm);
  if (hougarden?.zone_code) {
    zone_code = hougarden.zone_code;
    zone_description = hougarden.zone_description;
    sources["zone"] = "hougarden";
  } else if (councilZone?.zone_code && councilZone.zone_code !== "UNKNOWN") {
    zone_code = councilZone.zone_code;
    zone_description = councilZone.zone_description;
    min_lot_size_sqm = councilZone.min_lot_size_sqm;
    sources["zone"] = "auckland_council_gis";
  } else if (inferredLifestyleZone) {
    zone_code = inferredLifestyleZone.code;
    zone_description = inferredLifestyleZone.description;
    min_lot_size_sqm = inferredLifestyleZone.minLotSizeSqm;
    sources["zone"] = "propertyvalue (lifestyle land inferred)";
  }

  if (!min_lot_size_sqm && zone_code) {
    const LOT_SIZES: Record<string, number> = {
      THAB: 0, MHU: 300, MHS: 400, SHZ: 600, LLRZ: 4000, RCSZ: 2000, LDRZ: 600, FUZ: 0,
      CLZ: 10000, RUR: 40000, LSZ: 1200,
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
    : realestateListing?.price != null
      ? (sources["listing_price"] = "realestate.co.nz (active listing)", realestateListing.price)
      : first("listing_price", sources, ["oneroof", oneroof?.listing_price]);

  const school_zones          = hougarden?.school_zones ?? { primary: null, intermediate: null, secondary: null };
  // Listing hero photos: OneRoof first, then realestate.co.nz address-matched fallbacks.
  const photo_urls = Array.from(new Set([
    ...(oneroof?.photo_urls ?? []),
    ...(oneroof?.main_photo_url ? [oneroof.main_photo_url] : []),
    ...(realestateListing?.photoUrls ?? []),
    ...(realestateListing?.photoUrl ? [realestateListing.photoUrl] : []),
    ...(extra?.realestate_photo_urls ?? []),
    ...(propertyValue?.photo_urls ?? []),
  ].filter(Boolean))).slice(0, 12);
  const main_photo_url        = photo_urls[0] ?? null;
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
    build_year_range: final_build_year_range,
    bedrooms,
    bathrooms,
    zone_code,
    zone_description,
    min_lot_size_sqm,
    overlays,
    school_zones,
    last_sale_price,
    last_sale_date,
    listing_active: (oneroof?.listing_active ?? false) || !!realestateListing,
    listing_price,
    main_photo_url,
    photo_urls,
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
    estate_type: null,
  };
}
