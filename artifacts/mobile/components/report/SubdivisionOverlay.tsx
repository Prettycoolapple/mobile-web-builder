import React from "react";
import { G, Polygon, Text as SvgText } from "react-native-svg";

import {
  pointsString,
  projectCoordinate,
  ringCentroid,
  type Coordinate,
  type SitePlanBounds,
} from "@/components/report/mapProjection";
import type { SubdivisionPolygon, SubdivisionScenario } from "@/lib/subdivision";

/**
 * Draws a solved subdivision on top of the site plan: proposed lot boundaries,
 * the building footprint the solver seated on each, and a per-lot label.
 *
 * Rendered into the same viewBox as the site plan's own layers, using the shared
 * projection, so lots sit exactly on the parcel they subdivide.
 */

/** Violet matches the AI Subdivision button, marking this as generated geometry. */
const LOT_STROKE = "#7C3AED";
const LOT_FILL = "#A78BFA";
/** Warm fill for buildings so footprints separate from lot lines at a glance. */
const FOOTPRINT_STROKE = "#C2410C";
const FOOTPRINT_FILL = "#FB923C";

function outerRing(polygon: SubdivisionPolygon | null): Coordinate[] | null {
  const ring = polygon?.coordinates?.[0];
  if (!ring || ring.length < 3) return null;
  return ring.filter((c): c is Coordinate => Array.isArray(c) && c.length >= 2);
}

export function renderSubdivisionOverlay(
  scenario: SubdivisionScenario,
  bounds: SitePlanBounds,
  width: number,
  height: number,
): React.ReactNode {
  // Scale label text with the canvas so it stays readable regardless of the
  // rendered image size; the canvas is laid out at native pixel resolution.
  const labelSize = Math.max(11, Math.round(Math.min(width, height) * 0.026));

  return (
    <G key={`subdivision-${scenario.id}`}>
      {scenario.lots.map((lot, index) => {
        const lotRing = outerRing(lot.boundary);
        if (!lotRing) return null;
        const footprintRing = outerRing(lot.footprint);
        const projected = lotRing.map((c) => projectCoordinate(c, bounds, width, height));
        const centroid = ringCentroid(projected);

        return (
          <G key={`${scenario.id}-${lot.id}-${index}`}>
            <Polygon
              points={pointsString(lotRing, bounds, width, height)}
              fill={LOT_FILL}
              fillOpacity={0.22}
              stroke={LOT_STROKE}
              strokeWidth={3}
              strokeLinejoin="round"
            />
            {footprintRing ? (
              <Polygon
                points={pointsString(footprintRing, bounds, width, height)}
                fill={FOOTPRINT_FILL}
                fillOpacity={0.72}
                stroke={FOOTPRINT_STROKE}
                strokeWidth={2}
                strokeLinejoin="round"
              />
            ) : null}
            {centroid ? (
              <SvgText
                x={centroid[0]}
                y={centroid[1]}
                fontSize={labelSize}
                fontWeight="bold"
                fill="#FFFFFF"
                stroke="#4C1D95"
                strokeWidth={0.9}
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {lot.id}
              </SvgText>
            ) : null}
            {centroid ? (
              <SvgText
                x={centroid[0]}
                y={centroid[1] + labelSize * 1.05}
                fontSize={labelSize * 0.78}
                fill="#FFFFFF"
                stroke="#4C1D95"
                strokeWidth={0.7}
                textAnchor="middle"
                alignmentBaseline="middle"
              >
                {`${lot.areaM2} m²`}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </G>
  );
}
