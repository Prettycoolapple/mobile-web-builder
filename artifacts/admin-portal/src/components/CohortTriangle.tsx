import { formatBucketLabel, formatPercent } from "@/lib/format";

interface Cohort {
  cohortWeek: string;
  size: number;
  retainedByWeekOffset: number[];
}

interface Props {
  cohorts: Cohort[];
  weeks: number;
}

function shadeFor(rate: number): string {
  if (rate <= 0) return "hsl(0 0% 96%)";
  const lightness = 92 - rate * 54;
  return `hsl(140 70% ${lightness.toFixed(0)}%)`;
}

export default function CohortTriangle({ cohorts, weeks }: Props) {
  if (cohorts.length === 0) {
    return <div className="empty">No cohort data yet. Once users sign up and log in, weekly retention will appear here.</div>;
  }

  const cols = Math.min(weeks + 1, 13);

  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="cohort">
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Cohort</th>
              <th>Size</th>
              {Array.from({ length: cols }).map((_, i) => (
                <th key={i}>W{i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohorts.map((c) => {
              const cohortStart = new Date(c.cohortWeek).getTime();
              const weeksSince = Math.floor((Date.now() - cohortStart) / (7 * 86400_000));
              return (
                <tr key={c.cohortWeek}>
                  <td className="label">{formatBucketLabel(c.cohortWeek, "week")}</td>
                  <td className="label" style={{ textAlign: "right" }}>{c.size}</td>
                  {Array.from({ length: cols }).map((_, i) => {
                    if (i > weeksSince) {
                      return (
                        <td key={i} className="empty-cell">
                          —
                        </td>
                      );
                    }
                    const rate = c.retainedByWeekOffset[i] ?? 0;
                    return (
                      <td
                        key={i}
                        style={{
                          background: shadeFor(rate),
                          color: rate > 0.55 ? "#fff" : "var(--ink)",
                          fontWeight: i === 0 ? 700 : 500,
                        }}
                        title={`${formatPercent(rate)} retained at week ${i}`}
                      >
                        {rate > 0 ? formatPercent(rate) : "0%"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="cohort-legend">
        <span>0%</span>
        <div className="gradient" />
        <span>100%</span>
      </div>
    </>
  );
}
