import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeLightScore } from "../light-score";
import { geocodeAddress } from "../geocode";
import { fetchContour, fetchOverlays, fetchUnitaryPlanZone } from "../auckland-council";
import { fetchLINZParcel } from "../linz";

vi.mock("../geocode", () => ({ geocodeAddress: vi.fn() }));
vi.mock("../auckland-council", () => ({
  fetchUnitaryPlanZone: vi.fn(),
  fetchOverlays: vi.fn(),
  fetchContour: vi.fn(),
}));
vi.mock("../linz", () => ({ fetchLINZParcel: vi.fn() }));

const mockedGeocode = vi.mocked(geocodeAddress);
const mockedZone = vi.mocked(fetchUnitaryPlanZone);
const mockedOverlays = vi.mocked(fetchOverlays);
const mockedContour = vi.mocked(fetchContour);
const mockedLinz = vi.mocked(fetchLINZParcel);

describe("light card scoring", () => {
  beforeEach(() => {
    mockedGeocode.mockResolvedValue({
      lat: -36.85,
      lng: 174.86,
      formatted: "166A St Heliers Bay Road, Saint Heliers, Auckland 1071, New Zealand",
      suburb: "saint heliers",
    });
    mockedZone.mockResolvedValue({ zone_code: "MHU", zone_description: "Mixed Housing Urban", min_lot_size_sqm: 150 } as any);
    mockedOverlays.mockResolvedValue([]);
    mockedContour.mockResolvedValue(null as any);
    mockedLinz.mockResolvedValue({
      parcel_id: "parent",
      appellation: null,
      area_sqm: 1007,
      survey_area_sqm: 1007,
      calc_area_sqm: 1007,
      title_no: null,
      legal_description: null,
      topology_type: null,
      bbox: null,
    });
  });

  it("does not overwrite verified listing land area with a larger LINZ parent parcel", async () => {
    const result = await computeLightScore({
      address: "166A St Heliers Bay Road, Saint Heliers, Auckland City, Auckland",
      listingUrl: "https://www.realestate.co.nz/example",
      price: 1_400_000,
      landArea: 503,
      landAreaConfidence: "verified",
      isAlreadySubdividedChild: true,
      zone: "MHU",
    });

    expect(result.landArea).toBe(503);
    expect(result.potentialLots).toBe(3);
  });
});
