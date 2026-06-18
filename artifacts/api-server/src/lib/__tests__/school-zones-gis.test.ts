import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyInstitutionType, fetchSchoolZonesByPoint } from "../school-zones-gis";

describe("classifyInstitutionType", () => {
  it("maps MoE institution types to level + year range", () => {
    expect(classifyInstitutionType("Contributing")).toEqual({ level: "primary", yearLevels: "Years 1–6" });
    expect(classifyInstitutionType("Full Primary")).toEqual({ level: "primary", yearLevels: "Years 1–8" });
    expect(classifyInstitutionType("Intermediate")).toEqual({ level: "intermediate", yearLevels: "Years 7–8" });
    expect(classifyInstitutionType("Secondary (Year 9-15)")).toEqual({ level: "secondary", yearLevels: "Years 9–13" });
    expect(classifyInstitutionType("Secondary (Year 7-15)")).toEqual({ level: "secondary", yearLevels: "Years 7–13" });
    expect(classifyInstitutionType("Composite (Year 1-15)")).toEqual({ level: "composite", yearLevels: "Years 1–13" });
    expect(classifyInstitutionType("")).toEqual({ level: "other", yearLevels: null });
  });
});

describe("fetchSchoolZonesByPoint", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Captured from the live FeatureServer for 7 Limmer Place, Browns Bay.
  const limmerPlaceResponse = {
    features: [
      { attributes: { School_ID: 1481, School_name: "Sherwood School (Auckland)", Institution_type: "Contributing", Effective_date: 1614556800000 } },
      { attributes: { School_ID: 1478, School_name: "Torbay School", Institution_type: "Contributing", Effective_date: 1614556800000 } },
      { attributes: { School_ID: 1466, School_name: "Northcross Intermediate", Institution_type: "Intermediate", Effective_date: 1614556800000 } },
      { attributes: { School_ID: 78, School_name: "Long Bay College", Institution_type: "Secondary (Year 9-15)", Effective_date: 1614556800000 } },
    ],
  };

  it("returns the schools whose zone contains the point, ordered by level", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(limmerPlaceResponse), { status: 200 })));

    const hits = await fetchSchoolZonesByPoint(-36.7111087, 174.7353836);
    expect(hits.map((h) => h.schoolName)).toEqual([
      "Sherwood School (Auckland)",
      "Torbay School",
      "Northcross Intermediate",
      "Long Bay College",
    ]);
    expect(hits.map((h) => h.level)).toEqual(["primary", "primary", "intermediate", "secondary"]);
    expect(hits[3]!.yearLevels).toBe("Years 9–13");
    expect(hits[0]!.schoolId).toBe(1481);
  });

  it("fails soft to an empty array on HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect(await fetchSchoolZonesByPoint(-36.71, 174.73)).toEqual([]);
  });

  it("fails soft to an empty array on an ArcGIS error payload", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: 400 } }), { status: 200 })));
    expect(await fetchSchoolZonesByPoint(-36.71, 174.73)).toEqual([]);
  });

  it("returns empty for invalid coordinates without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(await fetchSchoolZonesByPoint(Number.NaN, 174.73)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
