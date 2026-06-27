import { describe, expect, it } from "vitest";
import {
  boundsFromParcel,
  fallbackBoundsFromCenter,
  paddedBounds,
  selectLinzAerialTileRange,
} from "../site-plan";
import type { LinzParcel } from "../linz";

const parcel: LinzParcel = {
  parcel_id: "12345",
  appellation: "Lot 1 DP 12345",
  area_sqm: 620,
  title_no: "NA1/1",
  legal_description: "Lot 1 DP 12345",
  topology_type: "Primary",
  bbox: {
    minLng: 174.856,
    maxLng: 174.858,
    minLat: -36.852,
    maxLat: -36.85,
    polygon: [
      [174.856, -36.852],
      [174.858, -36.852],
      [174.858, -36.85],
      [174.856, -36.85],
      [174.856, -36.852],
    ],
  },
};

describe("site plan bounds", () => {
  it("extracts bounds from a LINZ parcel", () => {
    expect(boundsFromParcel(parcel)).toEqual({
      minLng: 174.856,
      maxLng: 174.858,
      minLat: -36.852,
      maxLat: -36.85,
    });
  });

  it("pads tiny sites to a useful map extent", () => {
    const bounds = fallbackBoundsFromCenter(-36.851, 174.857, 2);
    const padded = paddedBounds(bounds, 0, 150);

    expect((padded.maxLat - padded.minLat) * 111_320).toBeGreaterThanOrEqual(149);
    expect(padded.minLng).toBeLessThan(bounds.minLng);
    expect(padded.maxLng).toBeGreaterThan(bounds.maxLng);
  });

  it("chooses an aerial tile range under the configured tile budget", () => {
    const sourceBounds = paddedBounds(boundsFromParcel(parcel)!, 45, 150);
    const range = selectLinzAerialTileRange(sourceBounds, 4);

    expect(range.widthTiles * range.heightTiles).toBeLessThanOrEqual(4);
    expect(range.bounds.minLng).toBeLessThanOrEqual(sourceBounds.minLng);
    expect(range.bounds.maxLng).toBeGreaterThanOrEqual(sourceBounds.maxLng);
    expect(range.bounds.minLat).toBeLessThanOrEqual(sourceBounds.minLat);
    expect(range.bounds.maxLat).toBeGreaterThanOrEqual(sourceBounds.maxLat);
  });
});
