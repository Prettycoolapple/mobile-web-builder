import { describe, it, expect } from "vitest";
import { hasCacheableCore, RAW_PROPERTY_SCHEMA_VERSION, type PipelineResult } from "../pipeline";
import { cachedRawNeedsRegionalPropertyHistoryRefresh, cachedRawNeedsRegionalZoneRefresh } from "../property-cache-rules";
import { cacheRowFreshness, PIPELINE_VERSION } from "../property-cache-freshness";

// Importing ../pipeline here also loads its entire dependency graph, so this test
// fails fast if the cache-aware refactor introduced a load-time/runtime error.

function baseResult(over: Partial<PipelineResult>): PipelineResult {
  return {
    address_input: "x",
    suburb: "x",
    geocode: null,
    linz_parcel: null,
    linz_title: null,
    zone: null,
    overlays: [],
    contour: null,
    property_history: null,
    asbestos: null,
    asbestos_detail: { risk: "unknown" } as never,
    infrastructure: [],
    hougarden: null,
    oneroof: null,
    homes: null,
    qv: null,
    propertyValue: null,
    realestate_listing: null,
    merged: null,
    lots: null,
    subdivision_pathway: null,
    costs: null,
    comparables: [],
    comparables_quality: "unavailable",
    neighbourhoodContext: null,
    transportContext: null,
    builtEnvironmentContext: null,
    dwellingCondition: null,
    scenarios: [],
    developmentStrategies: [],
    scores: null,
    school_zones_detail: [],
    easements: { retrieval_status: "no_title", burdening: [] } as never,
    failed_sources: [],
    timing_ms: {},
    completed_at: new Date().toISOString(),
    ...over,
  };
}

describe("hasCacheableCore", () => {
  it("is false without geocode", () => {
    expect(hasCacheableCore(baseResult({ geocode: null, raw_property: {} as never }))).toBe(false);
  });

  it("is false without a raw_property bundle", () => {
    expect(hasCacheableCore(baseResult({ geocode: { lat: 1, lng: 1 } as never, raw_property: null }))).toBe(false);
  });

  it("is false when all ScrapingBee-backed scrapers are null (credits depleted)", () => {
    expect(
      hasCacheableCore(
        baseResult({
          geocode: { lat: 1, lng: 1 } as never,
          raw_property: { hougarden: null, oneroof: null, qv: null, homes: null } as never,
          linz_parcel: { parcel_id: "123" } as never,
        }),
      ),
    ).toBe(false);
  });

  it("is true when at least one ScrapingBee scraper returned data", () => {
    expect(
      hasCacheableCore(
        baseResult({
          geocode: { lat: 1, lng: 1 } as never,
          raw_property: { hougarden: { cv_nzd: 500000 }, oneroof: null, qv: null, homes: null } as never,
          linz_parcel: { parcel_id: "123" } as never,
        }),
      ),
    ).toBe(true);
  });

  it("is true when a LINZ parcel id is present (and scraper data exists)", () => {
    expect(
      hasCacheableCore(
        baseResult({
          geocode: { lat: 1, lng: 1 } as never,
          raw_property: { hougarden: { cv_nzd: 1 } } as never,
          linz_parcel: { parcel_id: "123" } as never,
        }),
      ),
    ).toBe(true);
  });

  it("is true when a core fact (CV or land area) is present (and scraper data exists)", () => {
    expect(
      hasCacheableCore(
        baseResult({
          geocode: { lat: 1, lng: 1 } as never,
          raw_property: { oneroof: { cv_nzd: 600000 } } as never,
          merged: { cv_nzd: 600000, land_area_sqm: null } as never,
        }),
      ),
    ).toBe(true);
  });

  it("is false for an empty shell (geocode + bundle but no facts, even with scraper data)", () => {
    expect(
      hasCacheableCore(
        baseResult({
          geocode: { lat: 1, lng: 1 } as never,
          raw_property: { hougarden: { cv_nzd: null } } as never,
          merged: { cv_nzd: null, land_area_sqm: null } as never,
        }),
      ),
    ).toBe(false);
  });

  it("does not cache a configured regional property with unresolved zoning", () => {
    expect(hasCacheableCore(baseResult({
      geocode: { lat: -38.0263534, lng: 176.7097369 } as never,
      linz_parcel: { parcel_id: "onepu-parcel" } as never,
      raw_property: {
        planning_provider: { providerId: "whakatane" },
        zone: { zone_code: "UNKNOWN" },
        hougarden: { cv_nzd: 1_520_000 },
      } as never,
    }))).toBe(false);
  });

  it("caches a complete Whakatane direct-GIS report even when browser scrapers are disabled", () => {
    expect(hasCacheableCore(baseResult({
      geocode: { lat: -38.016582, lng: 176.7156598 } as never,
      linz_parcel: { parcel_id: "braemar-1134" } as never,
      merged: { cv_nzd: 1_310_000, land_area_sqm: 61_829 } as never,
      raw_property: {
        planning_provider: { providerId: "whakatane" },
        zone: { zone_code: "Rural Production Zone" },
        property_history: { cv_nzd: 1_310_000, land_area_sqm: 61_829 },
        hougarden: null,
        oneroof: null,
        qv: null,
        homes: null,
      } as never,
    }))).toBe(true);
  });

  it("exposes a schema version", () => {
    expect(RAW_PROPERTY_SCHEMA_VERSION).toBe(11);
  });
});

describe("regional property-cache completeness", () => {
  it("refreshes stale Whakatane cache bundles missing council CV or land area", () => {
    expect(cachedRawNeedsRegionalPropertyHistoryRefresh({
      planning_provider: { providerId: "whakatane" },
      property_history: { cv_nzd: null, land_area_sqm: 61_829 },
    } as never)).toBe(true);

    expect(cachedRawNeedsRegionalPropertyHistoryRefresh({
      planning_provider: { providerId: "whakatane" },
      property_history: { cv_nzd: 1_310_000, land_area_sqm: 61_829 },
    } as never)).toBe(false);
  });

  it("refreshes Southland cache bundles with unresolved zoning even when provider metadata was not stored", () => {
    expect(cachedRawNeedsRegionalZoneRefresh({
      geocode: {
        lat: -45.8372796,
        lng: 168.5815783,
        formatted: "77 Kruger Street, Balfour 9779, New Zealand",
      },
      zone: { zone_code: "UNKNOWN" },
      property_history: { cv_nzd: 250_000, land_area_sqm: 2_023 },
    } as never)).toBe(true);
  });

  it("refreshes Southland cache bundles that were previously misclassified as unsupported", () => {
    expect(cachedRawNeedsRegionalZoneRefresh({
      planning_provider: { providerId: "unsupported" },
      geocode: {
        lat: -45.8373947,
        lng: 168.5815721,
        formatted: "77 Kruger Street, Balfour 9779, New Zealand",
      },
      zone: { zone_code: "UNKNOWN" },
      property_history: { cv_nzd: null, land_area_sqm: 2_023 },
    } as never)).toBe(true);
  });
});

describe("cacheRowFreshness (90-day TTL)", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  it("treats a recent row as fresh", () => {
    const { fresh, ageDays } = cacheRowFreshness({ pipelineVersion: PIPELINE_VERSION, lastRefreshedAt: daysAgo(5) });
    expect(fresh).toBe(true);
    expect(ageDays).toBe(5);
  });

  it("treats a row older than the TTL as a miss", () => {
    const { fresh, ageDays } = cacheRowFreshness({ pipelineVersion: PIPELINE_VERSION, lastRefreshedAt: daysAgo(120) });
    expect(fresh).toBe(false);
    expect(ageDays).toBe(120);
  });

  it("treats an outdated pipeline version as a miss even when recent", () => {
    const { fresh } = cacheRowFreshness({ pipelineVersion: PIPELINE_VERSION - 1, lastRefreshedAt: daysAgo(1) });
    expect(fresh).toBe(false);
  });
});
