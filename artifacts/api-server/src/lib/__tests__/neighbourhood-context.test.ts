import { describe, expect, it } from "vitest";
import {
  isPublicHousingOwner,
  isTerraceLikeParcel,
  marketAdjustmentFromSignals,
  normaliseOwnerName,
  selectNearestResidentialParcels,
} from "../neighbourhood-context";
import type { LinzParcelNearby, LinzTitle } from "../linz";

function parcel(overrides: Partial<LinzParcelNearby> = {}): LinzParcelNearby {
  return {
    parcel_id: overrides.parcel_id ?? "p1",
    appellation: overrides.appellation ?? "Lot 1 DP 12345",
    area_sqm: overrides.area_sqm ?? 450,
    title_no: overrides.title_no ?? "NA1/1",
    legal_description: overrides.legal_description ?? overrides.appellation ?? "Lot 1 DP 12345",
    topology_type: overrides.topology_type ?? "Primary",
    bbox: null,
    distance_m: overrides.distance_m ?? 20,
  };
}

describe("neighbourhood context classifiers", () => {
  it("normalises public housing owner variants", () => {
    expect(normaliseOwnerName("Kāinga Ora - Homes and Communities")).toContain("KAINGA ORA");
    expect(isPublicHousingOwner("Kāinga Ora - Homes and Communities")).toBe(true);
    expect(isPublicHousingOwner("Housing New Zealand Limited")).toBe(true);
    expect(isPublicHousingOwner("New Zealand Housing Corporation")).toBe(true);
    expect(isPublicHousingOwner("A private family trust")).toBe(false);
  });

  it("selects nearest residential parcels and excludes subject, road, access, and tiny parcels", () => {
    const selected = selectNearestResidentialParcels([
      parcel({ parcel_id: "subject", distance_m: 0 }),
      parcel({ parcel_id: "road", appellation: "Legal Road", distance_m: 5 }),
      parcel({ parcel_id: "access", appellation: "Access Way", distance_m: 7 }),
      parcel({ parcel_id: "tiny", area_sqm: 20, distance_m: 8 }),
      parcel({ parcel_id: "n2", distance_m: 12 }),
      parcel({ parcel_id: "n1", distance_m: 10 }),
    ], "subject");

    expect(selected.map((p) => p.parcel_id)).toEqual(["n1", "n2"]);
  });

  it("does not classify terrace housing from zoning alone", () => {
    const title: LinzTitle = { title_no: "NA1/1", owners: [], estate_type: "Fee Simple", issue_date: null };
    expect(isTerraceLikeParcel(parcel({ area_sqm: 520, appellation: "Lot 1 DP 12345" }), title)).toBe(false);
    expect(isTerraceLikeParcel(parcel({ area_sqm: 145, appellation: "Lot 12 DP 12345" }), title)).toBe(true);
    expect(isTerraceLikeParcel(parcel({ area_sqm: 520 }), { ...title, estate_type: "Unit Title" })).toBe(true);
  });

  it("caps public-housing GDV adjustments and skips low-confidence signals", () => {
    expect(marketAdjustmentFromSignals({ level: "moderate", count: 3, assessedLots: 7, confidence: "low" }).gdvMultiplier).toBe(1);
    expect(marketAdjustmentFromSignals({ level: "moderate", count: 3, assessedLots: 7, confidence: "medium" }).gdvMultiplier).toBe(0.97);
    expect(marketAdjustmentFromSignals({ level: "high", count: 4, assessedLots: 7, confidence: "high" }).gdvMultiplier).toBe(0.93);
    expect(marketAdjustmentFromSignals({ level: "high", count: 4, assessedLots: 7, confidence: "high" }).gdvMultiplier).toBeGreaterThanOrEqual(0.9);
  });
});
