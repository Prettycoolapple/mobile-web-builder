import { describe, expect, it } from "vitest";
import {
  boundsFromParcel,
  expandLinzAerialTileRange,
  fallbackBoundsFromCenter,
  nearbyBoundaryLayer,
  paddedBounds,
  planningLayerStylePreview,
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

  it("pads aerial tile coverage around the selected site extent", () => {
    const sourceBounds = sitePlanMapBounds(boundsFromParcel(parcel)!);
    const range = selectLinzAerialTileRange(sourceBounds, 4);
    const expanded = expandLinzAerialTileRange(range);

    expect(expanded.zoom).toBe(range.zoom);
    expect(expanded.minX).toBeLessThanOrEqual(range.minX);
    expect(expanded.maxX).toBeGreaterThanOrEqual(range.maxX);
    expect(expanded.minY).toBeLessThanOrEqual(range.minY);
    expect(expanded.maxY).toBeGreaterThanOrEqual(range.maxY);
    expect(expanded.widthTiles * expanded.heightTiles).toBeGreaterThanOrEqual(range.widthTiles * range.heightTiles);
    expect(expanded.bounds.minLng).toBeLessThanOrEqual(range.bounds.minLng);
    expect(expanded.bounds.maxLng).toBeGreaterThanOrEqual(range.bounds.maxLng);
    expect(expanded.bounds.minLat).toBeLessThanOrEqual(range.bounds.minLat);
    expect(expanded.bounds.maxLat).toBeGreaterThanOrEqual(range.bounds.maxLat);
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

  it("keeps standard legend colors unique across site-plan layer families", () => {
    const reservedColors = [
      "#F97316",
      "#334155",
      "#0EA5E9",
      "#7C3AED",
      "#2563EB",
      "#475569",
    ];
    const colors = [...reservedColors, ...planningLayerStylePreview().map((layer) => layer.color)];

    expect(new Set(colors).size).toBe(colors.length);
  });

  it("styles notable trees as point markers with a distinct shape", () => {
    const notableTrees = planningLayerStylePreview().find((layer) => layer.name === "Notable Trees");

    expect(notableTrees?.kind).toBe("point");
    expect(notableTrees?.style.markerShape).toBe("triangle");
    expect(notableTrees?.style.fillOpacity).toBeGreaterThan(0.5);
  });
});
