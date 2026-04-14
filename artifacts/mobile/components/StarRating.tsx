import React, { useId } from "react";
import Svg, { Polygon, Defs, ClipPath, Rect, G } from "react-native-svg";

function starPoints(cx: number, cy: number, outerR: number, innerR: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (i * Math.PI) / 5 - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(" ");
}

interface StarRatingProps {
  score: number;
  maxStars?: number;
  size?: number;
  gap?: number;
  color?: string;
  emptyColor?: string;
}

export function StarRating({
  score,
  maxStars = 3,
  size = 14,
  gap = 3,
  color = "#F59E0B",
  emptyColor = "rgba(0,0,0,0.18)",
}: StarRatingProps) {
  const uid = useId().replace(/:/g, "");
  const mapped = (score / 5) * maxStars;
  const rounded = Math.round(mapped * 2) / 2;
  const clamped = Math.min(maxStars, Math.max(0, rounded));

  const totalWidth = maxStars * size + (maxStars - 1) * gap;
  const outerR = size / 2;
  const innerR = outerR * 0.42;
  const cy = size / 2;

  return (
    <Svg width={totalWidth} height={size}>
      <Defs>
        {Array.from({ length: maxStars }, (_, i) => {
          const fillPct = Math.min(1, Math.max(0, clamped - i));
          const clipX = i * (size + gap);
          return (
            <ClipPath key={i} id={`${uid}s${i}`}>
              <Rect x={clipX} y={0} width={size * fillPct} height={size} />
            </ClipPath>
          );
        })}
      </Defs>
      {Array.from({ length: maxStars }, (_, i) => {
        const cx = i * (size + gap) + size / 2;
        const pts = starPoints(cx, cy, outerR, innerR);
        const fillPct = Math.min(1, Math.max(0, clamped - i));
        return (
          <G key={i}>
            <Polygon points={pts} fill={emptyColor} />
            {fillPct > 0 && (
              <Polygon points={pts} fill={color} clipPath={`url(#${uid}s${i})`} />
            )}
          </G>
        );
      })}
    </Svg>
  );
}
