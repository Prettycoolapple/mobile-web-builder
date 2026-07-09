import { beforeEach, describe, expect, it, vi } from "vitest";
import * as aucklandCouncil from "../auckland-council";
import { fetchInfrastructure } from "../infrastructure";
import { fetchPropertyHistory } from "../property-data";
import { fetchRegionalPlanningOverlays, fetchRegionalPlanningZone } from "../regional-arcgis";
import { fetchRegionalInfrastructure } from "../regional-infrastructure";
import {
  fetchInfrastructureForReport,
  fetchPlanningOverlaysForReport,
  fetchPlanningZoneForReport,
  fetchPropertyHistoryForReport,
  fetchTerrainForReport,
} from "../regional-planning-fetchers";

vi.mock("../auckland-council", () => ({
  fetchUnitaryPlanZone: vi.fn(),
  fetchOverlays: vi.fn(),
  fetchOverlaysWithConsensus: vi.fn(),
  fetchContour: vi.fn(),
}));

vi.mock("../infrastructure", () => ({
  fetchInfrastructure: vi.fn(),
}));

vi.mock("../property-data", () => ({
  fetchPropertyHistory: vi.fn(),
}));

vi.mock("../regional-arcgis", () => ({
  fetchRegionalPlanningZone: vi.fn(),
  fetchRegionalPlanningOverlays: vi.fn(),
}));

vi.mock("../regional-infrastructure", () => ({
  fetchRegionalInfrastructure: vi.fn(),
}));

const FLAG = "ENABLE_REGIONAL_PLANNING_PROVIDERS";
const mockedZone = vi.mocked(aucklandCouncil.fetchUnitaryPlanZone);
const mockedOverlays = vi.mocked(aucklandCouncil.fetchOverlays);
const mockedConsensusOverlays = vi.mocked(aucklandCouncil.fetchOverlaysWithConsensus);
const mockedContour = vi.mocked(aucklandCouncil.fetchContour);
const mockedInfrastructure = vi.mocked(fetchInfrastructure);
const mockedPropertyHistory = vi.mocked(fetchPropertyHistory);
const mockedRegionalZone = vi.mocked(fetchRegionalPlanningZone);
const mockedRegionalOverlays = vi.mocked(fetchRegionalPlanningOverlays);
const mockedRegionalInfrastructure = vi.mocked(fetchRegionalInfrastructure);

describe("regional planning report fetchers", () => {
  beforeEach(() => {
    delete process.env[FLAG];
    vi.clearAllMocks();
    mockedZone.mockResolvedValue({
      zone_code: "MHS",
      zone_description: "Residential - Mixed Housing Suburban Zone",
      min_lot_size_sqm: 300,
      raw_zone: "Residential - Mixed Housing Suburban Zone",
    });
    mockedOverlays.mockResolvedValue([{ name: "Historic Heritage", type: "overlay" } as any]);
    mockedConsensusOverlays.mockResolvedValue([{ name: "Special Character", type: "overlay" } as any]);
    mockedContour.mockResolvedValue({ slope_degrees: 3, classification: "flat" } as any);
    mockedInfrastructure.mockResolvedValue([{ type: "wastewater", distance_m: 12 } as any]);
    mockedPropertyHistory.mockResolvedValue({
      cv_nzd: 1_000_000,
      cv_year: 2021,
      build_year: 1980,
      floor_area_sqm: 130,
      land_area_sqm: 600,
      property_type: "House",
      sources_confirmed: ["auckland council"],
      sources_estimated: [],
    });
    mockedRegionalZone.mockResolvedValue({
      zone_code: "Hamilton-Central-City",
      zone_description: "Central City Zone - Hamilton District Plan Zoning",
      min_lot_size_sqm: null,
      raw_zone: "{}",
    });
    mockedRegionalOverlays.mockResolvedValue([
      { name: "Hamilton Flood Hazard", status: "moderate", detail: "Flood hazard applies." },
    ]);
    mockedRegionalInfrastructure.mockResolvedValue([
      {
        name: "Wastewater",
        location: "boundary",
        distance_metres: 10,
        estimated_cost_low: 5000,
        estimated_cost_high: 20000,
        risk: "low",
        note: "Regional wastewater service near boundary",
      },
    ]);
  });

  it("delegates to the legacy Auckland modules when the router flag is explicitly off", async () => {
    process.env[FLAG] = "false";

    await expect(fetchPlanningZoneForReport(-37.787, 175.279, "Hamilton")).resolves.toMatchObject({ zone_code: "MHS" });
    await expect(fetchPlanningOverlaysForReport(-37.787, 175.279, null, { address: "Hamilton", consensus: true }))
      .resolves.toEqual([{ name: "Special Character", type: "overlay" }]);
    await expect(fetchInfrastructureForReport(-37.787, 175.279, null, null, undefined, "Hamilton"))
      .resolves.toEqual([{ type: "wastewater", distance_m: 12 }]);
    await expect(fetchPropertyHistoryForReport("Hamilton", -37.787, 175.279, 700))
      .resolves.toMatchObject({ cv_nzd: 1_000_000 });

    expect(mockedZone).toHaveBeenCalledOnce();
    expect(mockedConsensusOverlays).toHaveBeenCalledOnce();
    expect(mockedInfrastructure).toHaveBeenCalledOnce();
    expect(mockedPropertyHistory).toHaveBeenCalledOnce();
  });

  it("keeps Auckland on legacy behaviour when the router flag is on", async () => {
    process.env[FLAG] = "true";

    await fetchPlanningZoneForReport(-36.85, 174.76, "Auckland");
    await fetchPlanningOverlaysForReport(-36.85, 174.76, null, { address: "Auckland" });
    await fetchInfrastructureForReport(-36.85, 174.76, null, null, undefined, "Auckland");
    await fetchPropertyHistoryForReport("Auckland", -36.85, 174.76, 600);

    expect(mockedZone).toHaveBeenCalledOnce();
    expect(mockedOverlays).toHaveBeenCalledOnce();
    expect(mockedInfrastructure).toHaveBeenCalledOnce();
    expect(mockedPropertyHistory).toHaveBeenCalledOnce();
  });

  it("returns partial non-Auckland planning data without calling Auckland planning or service layers", async () => {
    await expect(fetchPlanningZoneForReport(-37.787, 175.279, "Hamilton")).resolves.toMatchObject({
      zone_code: "Hamilton-Central-City",
      min_lot_size_sqm: null,
    });
    await expect(fetchPlanningOverlaysForReport(-37.787, 175.279, null, { address: "Hamilton", consensus: true }))
      .resolves.toEqual([{ name: "Hamilton Flood Hazard", status: "moderate", detail: "Flood hazard applies." }]);
    await expect(fetchInfrastructureForReport(-37.787, 175.279, null, null, undefined, "Hamilton"))
      .resolves.toEqual([
        {
          name: "Wastewater",
          location: "boundary",
          distance_metres: 10,
          estimated_cost_low: 5000,
          estimated_cost_high: 20000,
          risk: "low",
          note: "Regional wastewater service near boundary",
        },
      ]);
    await expect(fetchPropertyHistoryForReport("Hamilton", -37.787, 175.279, 700)).resolves.toMatchObject({
      cv_nzd: null,
      land_area_sqm: 700,
      sources_confirmed: ["land_area_sqm (from LINZ parcel)"],
    });

    expect(mockedZone).not.toHaveBeenCalled();
    expect(mockedConsensusOverlays).not.toHaveBeenCalled();
    expect(mockedInfrastructure).not.toHaveBeenCalled();
    expect(mockedPropertyHistory).not.toHaveBeenCalled();
    expect(mockedRegionalZone).toHaveBeenCalledOnce();
    expect(mockedRegionalOverlays).toHaveBeenCalledOnce();
    expect(mockedRegionalInfrastructure).toHaveBeenCalledOnce();
  });

  it("passes parcel geometry through to regional zone lookups", async () => {
    const parcelBbox = {
      minLng: 173.22,
      maxLng: 173.23,
      minLat: -41.31,
      maxLat: -41.3,
      polygon: [
        [173.22, -41.31],
        [173.23, -41.31],
        [173.23, -41.3],
        [173.22, -41.3],
      ] as [number, number][],
    };

    await fetchPlanningZoneForReport(-41.306, 173.222, "17 Quiet Woman Way, Monaco, Nelson", parcelBbox);

    expect(mockedRegionalZone).toHaveBeenCalledWith(
      expect.objectContaining({ providerId: "nelson" }),
      -41.306,
      173.222,
      parcelBbox,
    );
  });

  it("keeps terrain available for non-Auckland reports", async () => {
    process.env[FLAG] = "true";

    await expect(fetchTerrainForReport(-37.787, 175.279, null, undefined, "Hamilton"))
      .resolves.toMatchObject({ slope_degrees: 3 });

    expect(mockedContour).toHaveBeenCalledOnce();
  });
});
