import { describe, expect, it } from "vitest";
import {
  buildBuiltEnvironmentContext,
  builtEnvironmentScoreAdjustment,
  generateNearbyAddressCandidates,
  type ParcelBuildAssessment,
} from "../built-environment-context";
import { selectNearestResidentialParcels } from "../neighbourhood-context";
import type { LinzParcelNearby } from "../linz";

function parcel(overrides: Partial<LinzParcelNearby> = {}): LinzParcelNearby {
  return {
    parcel_id: overrides.parcel_id ?? "p1",
    appellation: overrides.appellation ?? "Lot 1 DP 12345",
    area_sqm: overrides.area_sqm ?? 450,
    title_no: overrides.title_no ?? "NA1/1",
    legal_description: overrides.legal_description ?? overrides.appellation ?? "Lot 1 DP 12345",
    topology_type: overrides.topology_type ?? "Primary",
    bbox: overrides.bbox ?? null,
    distance_m: overrides.distance_m ?? 20,
  };
}

function assessment(
  id: string,
  representativeYear: number | null,
  overrides: Partial<ParcelBuildAssessment> = {},
): ParcelBuildAssessment {
  return {
    parcel: parcel({ parcel_id: id, distance_m: 10 + Number(id.replace(/\D/g, "") || 0) }),
    address: `${id} Test Street`,
    distanceM: 10 + Number(id.replace(/\D/g, "") || 0),
    buildYear: representativeYear,
    buildYearRange: null,
    representativeYear,
    ...overrides,
  };
}

describe("built environment context", () => {
  it("generates nearby same-street candidate addresses around the subject", () => {
    const candidates = generateNearbyAddressCandidates("8 Hampton Drive, St Heliers", 8);

    expect(candidates).toEqual([
      "10 Hampton Drive, St Heliers",
      "6 Hampton Drive, St Heliers",
      "9 Hampton Drive, St Heliers",
      "7 Hampton Drive, St Heliers",
      "12 Hampton Drive, St Heliers",
      "4 Hampton Drive, St Heliers",
      "11 Hampton Drive, St Heliers",
      "5 Hampton Drive, St Heliers",
    ]);
    expect(candidates).not.toContain("8 Hampton Drive, St Heliers");
  });

  it("uses the shared neighbour parcel filter for subject, roads, reserves, tiny parcels, duplicates, and radius caps", () => {
    const selected = selectNearestResidentialParcels([
      parcel({ parcel_id: "subject", distance_m: 0 }),
      parcel({ parcel_id: "road", appellation: "Legal Road", distance_m: 5 }),
      parcel({ parcel_id: "reserve", appellation: "Local Purpose Reserve", distance_m: 6 }),
      parcel({ parcel_id: "access", appellation: "Access Way", distance_m: 7 }),
      parcel({ parcel_id: "tiny", area_sqm: 20, distance_m: 8 }),
      parcel({ parcel_id: "duplicate", distance_m: 9 }),
      parcel({ parcel_id: "duplicate", distance_m: 10 }),
      parcel({ parcel_id: "outside", distance_m: 101 }),
      parcel({ parcel_id: "n2", distance_m: 12 }),
      parcel({ parcel_id: "n1", distance_m: 11 }),
    ], "subject", 30, 100);

    expect(selected.map((p) => p.parcel_id)).toEqual(["duplicate", "n1", "n2"]);
  });

  it("classifies an old subject among many modern or new neighbours as the last missing piece", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1955,
      assessments: [
        assessment("n1", 2022),
        assessment("n2", 2020),
        assessment("n3", 2018),
        assessment("n4", 2015),
        assessment("n5", 2008),
        assessment("n6", 2002),
        assessment("n7", 1985),
        assessment("n8", 1975),
      ],
    });

    expect(context.signal).toBe("last_missing_piece");
    expect(context.confidence).toBe("high");
    expect(context.renewedShare).toBe(0.75);
    expect(context.statusCounts).toMatchObject({ old: 2, modern: 4, new: 2 });
    expect(context.nearbyStatus[0]).toMatchObject({ status: "new" });
  });

  it("classifies an old subject with some nearby renewal as mixed renewal", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYearRange: "1950s",
      assessments: [
        assessment("n1", 2022),
        assessment("n2", 1998),
        assessment("n3", 2004),
        assessment("n4", 1988),
        assessment("n5", 1982),
        assessment("n6", 1975),
        assessment("n7", 1968),
      ],
    });

    expect(context.signal).toBe("mixed_renewal");
    expect(context.renewedShare).toBe(0.43);
    expect(context.subjectBuildYearRange).toBe("1950s");
  });

  it("classifies mostly old neighbours as an older environment", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1950,
      assessments: [
        assessment("n1", 1975),
        assessment("n2", 1972),
        assessment("n3", 1964),
        assessment("n4", 1958),
        assessment("n5", 1955),
        assessment("n6", 1948),
        assessment("n7", 1992),
        assessment("n8", 2004),
      ],
    });

    expect(context.signal).toBe("older_environment");
    expect(context.oldCount).toBe(6);
    expect(builtEnvironmentScoreAdjustment(context).roiDelta).toBe(-0.25);
  });

  it("stays score-neutral when fewer than three nearby build years are known", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1950,
      assessments: [
        assessment("n1", 2022),
        assessment("n2", 1955),
        assessment("n3", null),
        assessment("n4", null),
      ],
    });

    expect(context.signal).toBe("insufficient_data");
    expect(context.confidence).toBe("unknown");
    expect(builtEnvironmentScoreAdjustment(context)).toEqual({ roiDelta: 0, reason: null });
  });

  it("preserves decade data as an approximate range in examples", () => {
    const context = buildBuiltEnvironmentContext({
      radiusM: 100,
      subjectBuildYear: 1950,
      assessments: [
        assessment("n1", 1955, { buildYear: null, buildYearRange: "1950s" }),
        assessment("n2", 2022),
        assessment("n3", 2018),
      ],
    });

    expect(context.nearbyExamples[0]).toMatchObject({ buildYear: null, buildYearRange: "1950s" });
  });
});
