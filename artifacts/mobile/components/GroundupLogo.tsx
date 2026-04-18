import React, { useId } from "react";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Circle,
  G,
} from "react-native-svg";

type Props = {
  size?: number;
  /** Primary color of the swoosh / smile arrow. */
  color?: string;
  /** Secondary gradient color. Defaults to a warm amber. */
  accentColor?: string;
  /** Render inside a rounded plate (icon mode). */
  plate?: boolean;
  plateColor?: string;
};

/**
 * Project Alpha — Smile Mark.
 *
 * An Amazon-style swoosh: a confident curved smile that lifts at the right
 * into an arrowhead, signalling growth and momentum. Designed to read at any
 * size from a 16px favicon to a 1024px app icon.
 *
 * (Filename retained to keep existing import sites working.)
 */
export function GroundupLogo({
  size = 48,
  color = "#D97757",
  accentColor,
  plate = false,
  plateColor = "#1C1917",
}: Props) {
  const accent = accentColor ?? "#E8A84B";
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const gradId = `pa-grad-${safeId}`;

  // ── Geometry on a 100×100 canvas ─────────────────────────────────────────
  // The smile is a single thick stroke from the lower-left up to the
  // lower-right, where it terminates in an upward-pointing arrowhead.
  // We model it as a filled shape (stroke + arrow as one Path) so it can
  // carry a gradient and remain crisp at any scale.
  //
  // Anchor points:
  //   start  ≈ (18, 50)
  //   peak   ≈ (50, 78)   (lowest point of the smile)
  //   tip    ≈ (84, 48)   (where the arrow points)
  //
  // We construct two cubic curves (top edge and bottom edge of the smile)
  // and wrap them around the arrowhead.
  const smilePath = [
    // Move to upper-left start of the stroke
    "M 16 46",
    // Top edge of smile: curve down to the right side, ending just before
    // the arrowhead base.
    "C 28 76, 60 86, 78 56",
    // Step out to the arrowhead's outer (upper) tip.
    "L 72 52",
    // Outer arrow flare → arrow tip.
    "L 92 44",
    "L 80 64",
    "L 76 58",
    // Bottom edge of smile: curve back to the starting point.
    "C 60 78, 32 70, 22 50",
    "Z",
  ].join(" ");

  const Mark = (
    <G>
      <Path d={smilePath} fill={`url(#${gradId})`} />
    </G>
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0" x2="1" y2="0.4">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={accent} stopOpacity="1" />
        </LinearGradient>
      </Defs>

      {plate ? (
        <>
          <Circle cx="50" cy="50" r="48" fill={plateColor} />
          {Mark}
        </>
      ) : (
        Mark
      )}
    </Svg>
  );
}

/**
 * SmileSwoosh — the swoosh-only mark stretched horizontally.
 *
 * Used underneath the "project alpha" wordmark on the welcome screen so the
 * arrow visually spans from "p" to the trailing "a", in the spirit of
 * Amazon's a-to-z smile.
 */
export function SmileSwoosh({
  width = 240,
  color = "#D97757",
  accentColor,
}: {
  width?: number;
  color?: string;
  accentColor?: string;
}) {
  const accent = accentColor ?? "#E8A84B";
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const gradId = `pa-swoosh-${safeId}`;

  // Horizontal swoosh on a 200×40 viewBox.
  // Smile dips in the middle and lifts into an arrowhead at the right.
  const path = [
    "M 6 10",
    "C 40 36, 130 38, 168 16",
    "L 158 8",
    "L 196 4",
    "L 178 36",
    "L 168 28",
    "C 130 48, 36 46, 4 18",
    "Z",
  ].join(" ");

  const height = (width * 40) / 200;

  return (
    <Svg width={width} height={height} viewBox="0 0 200 40">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="0.5" x2="1" y2="0.5">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={accent} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <Path d={path} fill={`url(#${gradId})`} />
    </Svg>
  );
}
