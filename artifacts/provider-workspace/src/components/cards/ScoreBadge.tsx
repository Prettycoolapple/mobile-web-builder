import { formatComposite, scoreColor } from "@/lib/format";

/** Compact composite-score chip shown on scored property cards. */
export function ScoreBadge({ composite, loading }: { composite: number; loading?: boolean }) {
  if (loading) {
    return (
      <div className="score-badge" style={{ background: "var(--surface-sunken)" }} aria-label="Scoring">
        <span className="ws-dots" style={{ transform: "scale(0.7)" }}>
          <span />
          <span />
          <span />
        </span>
      </div>
    );
  }
  return (
    <div className="score-badge" style={{ background: scoreColor(composite) }} aria-label={`Composite score ${formatComposite(composite)} out of 5`}>
      <span className="num">{formatComposite(composite)}</span>
      <span className="of">/5</span>
    </div>
  );
}
