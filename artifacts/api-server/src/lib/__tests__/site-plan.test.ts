import { describe, expect, it } from "vitest";
import {
  boundsFromParcel,
  fallbackBoundsFromCenter,
  nearbyBoundaryLayer,
  paddedBounds,
  selectLinzAerialTileRange,
  sitePlanMapBounds,
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

const nearbyParcel: LinzParcel = {
  ...parcel,
  parcel_id: "67890",
  appellation: "Lot 2 DP 12345",
  bbox: {
    minLng: 174.858,
    maxLng: 174.86,
    minLat: -36.852,
    maxLat: -36.85,
    polygon: [
      [174.858, -36.852],
      [174.86, -36.852],
      [174.86, -36.85],
      [174.858, -36.85],
      [174.858, -36.852],
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
    const sourceBounds = sitePlanMapBounds(boundsFromParcel(parcel)!);
    const range = selectLinzAerialTileRange(sourceBounds, 4);

    expect(range.widthTiles * range.heightTiles).toBeLessThanOrEqual(4);
    expect(range.bounds.minLng).toBeLessThanOrEqual(sourceBounds.minLng);
    expect(range.bounds.maxLng).toBeGreaterThanOrEqual(sourceBounds.maxLng);
    expect(range.bounds.minLat).toBeLessThanOrEqual(sourceBounds.minLat);
    expect(range.bounds.maxLat).toBeGreaterThanOrEqual(sourceBounds.maxLat);
  });

  it("expands the site plan to show neighbourhood context", () => {
    const tinySite = fallbackBoundsFromCenter(-36.851, 174.857, 2);
    const oldDefault = paddedBounds(tinySite, 45, 150);
    const context = sitePlanMapBounds(tinySite);
    const oldLatSpan = oldDefault.maxLat - oldDefault.minLat;
    const oldLngSpan = oldDefault.maxLng - oldDefault.minLng;

    expect(context.maxLat - context.minLat).toBeGreaterThanOrEqual(oldLatSpan * 1.75);
    expect(context.maxLng - context.minLng).toBeGreaterThanOrEqual(oldLngSpan * 1.75);
  });

  it("builds plain nearby parcel outlines without duplicating the selected parcel", () => {
    const layer = nearbyBoundaryLayer([parcel, nearbyParcel], parcel);

    expect(layer.id).toBe("nearby-boundaries");
    expect(layer.available).toBe(true);
    expect(layer.defaultVisible).toBe(true);
    expect(layer.style.fillOpacity).toBe(0);
    expect(layer.style.strokeWidth).toBeLessThan(2);
    expect(layer.geojson.features).toHaveLength(1);
    expect(layer.geojson.features[0]?.properties.parcelId).toBe(nearbyParcel.parcel_id);
  });
});
