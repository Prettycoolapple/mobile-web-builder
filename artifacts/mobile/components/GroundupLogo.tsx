import React, { useId } from "react";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Rect,
  G,
} from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  accentColor?: string;
  /**
   * Color used for the small doorway notch. Defaults to a deep brown so it
   * reads correctly on both light and dark backgrounds.
   */
  doorColor?: string;
  /**
   * Render the mark inside a rounded square plate (icon-style).
   * Useful for app-icon previews or avatar contexts.
   */
  plate?: boolean;
  plateColor?: string;
};

/**
 * groundUP — Foundation Mark.
 *
 * A pitched-roof house rising from three stratified ground layers.
 * Reads instantly as "residential, built from the ground up" and works
 * at every size from 16px favicons to 1024px app icons.
 */
export function GroundupLogo({
  size = 48,
  color = "#D97757",
  accentColor,
  doorColor = "#2C1F16",
  plate = false,
  plateColor = "#1C1917",
}: Props) {
  const accent = accentColor ?? "#E8A84B";
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const roofGrad = `gu-roof-${safeId}`;
  const strataGrad = `gu-strata-${safeId}`;

  // Geometry on a 100x100 canvas, with generous padding so the mark stays
  // crisp inside any container (including a rounded-square plate).
  // House: pentagon with pitched roof.
  // Roof peak (cx, 18) -> eaves (28, 44)/(72, 44) -> base (28, 60)/(72, 60).
  const housePath =
    "M 50 16 " +
    "L 74 42 " +
    "L 74 60 " +
    "L 26 60 " +
    "L 26 42 Z";

  // A small doorway notch cut from the bottom of the house, hinting at
  // a residential entrance without becoming literal at small sizes.
  const doorPath =
    "M 44 60 " +
    "L 44 52 " +
    "Q 50 49 56 52 " +
    "L 56 60 Z";

  // Three stratified ground layers, progressively wider and more transparent
  // at the bottom — like a building section through soil.
  // Slightly thicker bars + higher minimum opacity so the bottom stratum
  // remains visible at small sizes (e.g. 28px tab/header use).
  const strata = [
    { y: 65, w: 54, h: 5, op: 1.0 },
    { y: 74, w: 66, h: 5, op: 0.78 },
    { y: 83, w: 76, h: 5, op: 0.55 },
  ];

  const Mark = (
    <G>
      {/* House — terracotta gradient pentagon */}
      <Path d={housePath} fill={`url(#${roofGrad})`} />
      {/* Door — deep brown so it reads on any background */}
      <Path d={doorPath} fill={plate ? plateColor : doorColor} opacity={0.95} />

      {/* Stratified ground beneath the house */}
      {strata.map((s, i) => (
        <Rect
          key={i}
          x={50 - s.w / 2}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={2.5}
          ry={2.5}
          fill={`url(#${strataGrad})`}
          opacity={s.op}
        />
      ))}
    </G>
  );

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={roofGrad} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={accent} stopOpacity="1" />
          <Stop offset="1" stopColor={color} stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={strataGrad} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="0.95" />
          <Stop offset="1" stopColor={accent} stopOpacity="0.95" />
        </LinearGradient>
      </Defs>

      {plate ? (
        <>
          <Rect
            x="2"
            y="2"
            width="96"
            height="96"
            rx="22"
            ry="22"
            fill={plateColor}
          />
          {Mark}
        </>
      ) : (
        Mark
      )}
    </Svg>
  );
}
