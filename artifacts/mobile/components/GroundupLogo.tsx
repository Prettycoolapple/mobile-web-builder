import React, { useId } from "react";
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  G,
} from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  accentColor?: string;
};

/**
 * Groundup mark.
 *
 * A six-petal looped knot (visually inspired by ChatGPT's flower) with a tiny
 * pitched-roof house cut out of the centre — hinting that Groundup is for
 * residential property, built from the ground up.
 */
export function GroundupLogo({
  size = 48,
  color = "#D97757",
  accentColor,
}: Props) {
  const accent = accentColor ?? color;
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const gradId = `gu-grad-${safeId}`;

  // Build the petal as a rounded "lozenge" pointing up from the centre.
  // We then rotate it 6 times (every 60°) around the centre to form the flower.
  const cx = 50;
  const cy = 50;
  const petalLength = 38; // distance from centre to outer tip
  const petalWidth = 22; // half-width at the widest point
  const innerRadius = 6; // gap at the centre so the cutout shows through

  const petalPath =
    `M ${cx} ${cy - innerRadius}` +
    ` C ${cx + petalWidth} ${cy - innerRadius - 2}, ${cx + petalWidth} ${cy - petalLength + 4}, ${cx} ${cy - petalLength}` +
    ` C ${cx - petalWidth} ${cy - petalLength + 4}, ${cx - petalWidth} ${cy - innerRadius - 2}, ${cx} ${cy - innerRadius} Z`;

  const rotations = [0, 60, 120, 180, 240, 300];

  // House cutout: pitched roof + body, centred on (cx, cy).
  // Drawn slightly offset so the roof peak sits a touch above geometric centre.
  const houseTop = cy - 9;
  const houseBottom = cy + 9;
  const houseLeft = cx - 9;
  const houseRight = cx + 9;
  const eaveY = cy - 1;
  const housePath =
    `M ${cx} ${houseTop}` +
    ` L ${houseRight} ${eaveY}` +
    ` L ${houseRight} ${houseBottom}` +
    ` L ${houseLeft} ${houseBottom}` +
    ` L ${houseLeft} ${eaveY} Z`;

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={accent} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      <G>
        {rotations.map((deg) => (
          <Path
            key={deg}
            d={petalPath}
            fill={`url(#${gradId})`}
            transform={`rotate(${deg} ${cx} ${cy})`}
          />
        ))}
        {/* House silhouette centred on the flower — a hint of "residential" */}
        <Path d={housePath} fill="#FFFFFF" opacity={0.96} />
        {/* A tiny window / chimney accent inside the house */}
        <Path
          d={`M ${cx - 2} ${cy + 1} L ${cx + 2} ${cy + 1} L ${cx + 2} ${cy + 6} L ${cx - 2} ${cy + 6} Z`}
          fill={accent}
          opacity={0.85}
        />
      </G>
    </Svg>
  );
}
