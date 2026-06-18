import { describe, it, expect } from "vitest";
import { hasCacheableCore, RAW_PROPERTY_SCHEMA_VERSION, type PipelineResult } from "../pipeline";
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

  it("exposes a schema version", () => {
    expect(RAW_PROPERTY_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
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
