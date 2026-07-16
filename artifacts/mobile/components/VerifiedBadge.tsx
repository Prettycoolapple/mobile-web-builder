import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

const SATELLITE_ANGLES_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * X/Meta-style verified seal: a scalloped blue badge with a white checkmark,
 * built from overlapping circles (center + 8 satellites) rather than a fixed
 * path, so it stays a clean solid shape at any size. Used everywhere a
 * verified provider or sales agent is indicated.
 */
export function VerifiedBadge({
  size = 14,
  color = "#1D9BF0",
}: {
  size?: number;
  color?: string;
}) {
  const cx = 12;
  const cy = 12;
  const orbitRadius = 7.6;
  const satelliteRadius = 5.3;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={cx} cy={cy} r={8.2} fill={color} />
      {SATELLITE_ANGLES_DEG.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        return (
          <Circle
            key={deg}
            cx={cx + orbitRadius * Math.cos(rad)}
            cy={cy + orbitRadius * Math.sin(rad)}
            r={satelliteRadius}
            fill={color}
          />
        );
      })}
      <Path
        d="M8.4 12.3l2.4 2.4 4.8-5.4"
        stroke="#fff"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
