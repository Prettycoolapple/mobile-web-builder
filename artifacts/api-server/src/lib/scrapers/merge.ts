import { logger } from "../logger";
import type { LinzParcel } from "../linz";
import type { Overlay, ZoneResult } from "../auckland-council";
import type { InfrastructureItem } from "../infrastructure";
import type { HougardenData } from "./hougarden";
import type { OneRoofData, ComparableSale } from "./oneroof";

export interface MergedPropertyData {
  cv_nzd: number | null;
  cv_year: number | null;
  land_area_sqm: number | null;
  floor_area_sqm: number | null;
  build_year: number | null;
  bedrooms: number | null;
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
  contour: "flat" | "gentle" | "moderate" | "steep" | null;
  asbestos_risk: "low" | "high" | "unknown";
  infrastructure: InfrastructureItem[];
}

function first<T>(label: string, sources: Record<string, string>, ...candidates: Array<[string, T | null | undefined]>): T | null {
  for (const [src, val] of candidates) {
    if (val != null && val !== undefined) {
      sources[label] = src;
      return val;
    }
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
    asbestos_risk: "low" | "high" | "unknown";
    infrastructure: InfrastructureItem[];
  },
): MergedPropertyData {
  const sources: Record<string, string> = {};

  const land_area_sqm = first("land_area_sqm", sources,
    ["linz", linz?.area_sqm],
    ["hougarden", hougarden?.land_area_sqm],
    ["oneroof", oneroof?.land_area_sqm],
  );

  const cv_nzd = first("cv_nzd", sources,
    ["oneroof", oneroof?.cv_nzd],
    ["hougarden", hougarden?.cv_nzd],
  );

  const cv_year = first("cv_year", sources,
    ["oneroof", oneroof?.cv_year],
  );

  const build_year = first("build_year", sources,
    ["oneroof", oneroof?.build_year],
    ["hougarden", hougarden?.build_year],
  );

  const floor_area_sqm = first("floor_area_sqm", sources,
    ["oneroof", oneroof?.floor_area_sqm],
    ["hougarden", hougarden?.floor_area_sqm],
  );

  const bedrooms = first("bedrooms", sources,
    ["oneroof", oneroof?.bedrooms],
  );

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

  const last_sale_price = first("last_sale_price", sources,
    ["oneroof", oneroof?.last_sale_price],
  );
  const last_sale_date = first("last_sale_date", sources,
    ["oneroof", oneroof?.last_sale_date],
  );
  const listing_price = first("listing_price", sources,
    ["oneroof", oneroof?.listing_price],
  );

  const school_zones = hougarden?.school_zones ?? { primary: null, intermediate: null, secondary: null };
  const main_photo_url = oneroof?.main_photo_url ?? null;
  const overlay_map_image_base64 = hougarden?.overlay_map_image_base64 ?? null;

  const comparables: ComparableSale[] = oneroof?.comparables ?? [];
  if (comparables.length < 3) {
    sources["comparables"] = "oneroof (limited)";
  } else {
    sources["comparables"] = "oneroof";
  }

  logger.debug({ sources }, "Merge: data sources selected");

  return {
    cv_nzd,
    cv_year,
    land_area_sqm,
    floor_area_sqm,
    build_year,
    bedrooms,
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
    contour: extra?.contour ?? null,
    asbestos_risk: extra?.asbestos_risk ?? "unknown",
    infrastructure: extra?.infrastructure ?? [],
  };
}
