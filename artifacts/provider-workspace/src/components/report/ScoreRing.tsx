import { formatComposite } from "@/lib/format";

/** SVG donut for the composite score, used in the report scorecard header. */
export function ScoreRing({ composite, size = 96 }: { composite: number; size?: number }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, composite / 5));
  const color = composite >= 4 ? "#52C99A" : composite >= 2.5 ? "#E8A84B" : "#E8807F";

  return (
    <div className="score-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dashoffset 0.7s ease" }}
        />
      </svg>
      <div className="center">
        <span className="num">{formatComposite(composite)}</span>
        <span className="of">/ 5</span>
      </div>
    </div>
  );
}
