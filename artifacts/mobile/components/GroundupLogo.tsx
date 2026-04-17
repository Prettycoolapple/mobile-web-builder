import React, { useId } from "react";
import Svg, { Defs, LinearGradient, Stop, Path, Rect, G } from "react-native-svg";

type Props = {
  size?: number;
  color?: string;
  accentColor?: string;
  rounded?: boolean;
};

export function GroundupLogo({
  size = 48,
  color = "#D97757",
  accentColor,
  rounded = true,
}: Props) {
  const accent = accentColor ?? color;
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9-_]/g, "");
  const gradId = `gu-grad-${safeId}`;
  const padding = size * 0.18;
  const inner = size - padding * 2;
  const baseY = size - padding;
  const barWidth = inner * 0.18;
  const gap = (inner - barWidth * 3) / 2;
  const x1 = padding;
  const x2 = padding + barWidth + gap;
  const x3 = padding + (barWidth + gap) * 2;
  const h1 = inner * 0.35;
  const h2 = inner * 0.6;
  const h3 = inner * 0.85;
  const radius = barWidth / 2;
  const arrowSize = size * 0.18;
  const arrowCx = x3 + barWidth / 2;
  const arrowCy = baseY - h3 - arrowSize * 0.55;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <LinearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
          <Stop offset="0" stopColor={color} stopOpacity="1" />
          <Stop offset="1" stopColor={accent} stopOpacity="1" />
        </LinearGradient>
      </Defs>
      {rounded && (
        <Rect
          x={0}
          y={0}
          width={size}
          height={size}
          rx={size * 0.22}
          ry={size * 0.22}
          fill={`url(#${gradId})`}
          opacity={0.12}
        />
      )}
      <G>
        <Rect
          x={x1}
          y={baseY - h1}
          width={barWidth}
          height={h1}
          rx={radius}
          ry={radius}
          fill={`url(#${gradId})`}
          opacity={0.7}
        />
        <Rect
          x={x2}
          y={baseY - h2}
          width={barWidth}
          height={h2}
          rx={radius}
          ry={radius}
          fill={`url(#${gradId})`}
          opacity={0.85}
        />
        <Rect
          x={x3}
          y={baseY - h3}
          width={barWidth}
          height={h3}
          rx={radius}
          ry={radius}
          fill={`url(#${gradId})`}
        />
        <Path
          d={`M ${arrowCx} ${arrowCy - arrowSize * 0.5}
              L ${arrowCx + arrowSize * 0.45} ${arrowCy + arrowSize * 0.15}
              L ${arrowCx + arrowSize * 0.18} ${arrowCy + arrowSize * 0.15}
              L ${arrowCx + arrowSize * 0.18} ${arrowCy + arrowSize * 0.5}
              L ${arrowCx - arrowSize * 0.18} ${arrowCy + arrowSize * 0.5}
              L ${arrowCx - arrowSize * 0.18} ${arrowCy + arrowSize * 0.15}
              L ${arrowCx - arrowSize * 0.45} ${arrowCy + arrowSize * 0.15} Z`}
          fill={accent}
        />
        <Rect
          x={padding * 0.4}
          y={baseY + size * 0.02}
          width={size - padding * 0.8}
          height={size * 0.04}
          rx={size * 0.02}
          ry={size * 0.02}
          fill={color}
          opacity={0.55}
        />
      </G>
    </Svg>
  );
}
