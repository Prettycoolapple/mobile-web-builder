import { describe, expect, it } from "vitest";
import { detectVeoliaServiceZone } from "../veolia-service-zone";
import { buildVeoliaRiskBullets, buildRiskBackfillCandidates, type RiskBackfillContext } from "../report-risk-backfill";

describe("detectVeoliaServiceZone", () => {
  it("flags a Takanini property as inside the Papakura franchise", () => {
    // Takanini (~ -37.050, 174.905).
    const z = detectVeoliaServiceZone(-37.050, 174.905);
    expect(z.inServiceZone).toBe(true);
    expect(z.network).toBe("papakura");
  });

  it("flags central Papakura and Drury as inside", () => {
    expect(detectVeoliaServiceZone(-37.066, 174.945).inServiceZone).toBe(true); // Papakura
    expect(detectVeoliaServiceZone(-37.100, 174.945).inServiceZone).toBe(true); // Drury
  });

  it("does not flag central Auckland or Manurewa", () => {
    expect(detectVeoliaServiceZone(-36.848, 174.763).inServiceZone).toBe(false); // CBD
    expect(detectVeoliaServiceZone(-37.005, 174.900).inServiceZone).toBe(false); // Manurewa (north of border)
  });

  it("handles missing coordinates safely", () => {
    expect(detectVeoliaServiceZone(null, null).inServiceZone).toBe(false);
    expect(detectVeoliaServiceZone(undefined, 174.9).inServiceZone).toBe(false);
    expect(detectVeoliaServiceZone(NaN, NaN).inServiceZone).toBe(false);
  });
});

describe("buildVeoliaRiskBullets", () => {
  it("returns two bullets (constraint + mitigation) when in zone", () => {
    const en = buildVeoliaRiskBullets(true, false);
    expect(en).toHaveLength(2);
    expect(en[0]).toMatch(/Veolia/);
    expect(en[1]).toMatch(/resource consent does NOT guarantee/i);
  });

  it("returns Chinese bullets when isZh", () => {
    const zh = buildVeoliaRiskBullets(true, true);
    expect(zh).toHaveLength(2);
    expect(zh[0]).toMatch(/Veolia/);
    expect(/[一-鿿]/.test(zh[0]!)).toBe(true);
  });

  it("returns nothing when out of zone", () => {
    expect(buildVeoliaRiskBullets(false, false)).toHaveLength(0);
    expect(buildVeoliaRiskBullets(undefined, false)).toHaveLength(0);
  });
});

describe("buildRiskBackfillCandidates — Veolia", () => {
  const baseCtx: RiskBackfillContext = {
    isZh: false,
    zoneCode: "MHS",
    zoneLabel: "Mixed Housing Suburban",
    potentialLots: 2,
    netAreaSqm: 700,
    minLotSqm: 400,
    overlays: [],
    contour: "flat",
    infrastructure: [],
    estateType: "Fee Simple",
  };

  it("includes a Veolia candidate when the flag is set", () => {
    const withZone = buildRiskBackfillCandidates({ ...baseCtx, veoliaServiceZone: true });
    expect(withZone.some((c) => /Veolia/.test(c))).toBe(true);
  });

  it("omits the Veolia candidate when the flag is unset", () => {
    const noZone = buildRiskBackfillCandidates({ ...baseCtx, veoliaServiceZone: false });
    expect(noZone.some((c) => /Veolia/.test(c))).toBe(false);
  });
});
