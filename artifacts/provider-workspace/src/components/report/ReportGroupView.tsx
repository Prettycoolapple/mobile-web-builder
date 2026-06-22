import type { FeasibilityReportGroup } from "@/state/chat-model";
import { ReportView } from "./ReportView";

/** Combined-listing package: each child report + a cross-property comparison. */
export function ReportGroupView({ group }: { group: FeasibilityReportGroup }) {
  const palette = ["var(--accent)", "#3B82F6", "#10B981", "#F97316"];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="report-note">
        <strong>Combined listing package.</strong>{" "}
        {group.warnings?.[0] ?? "Each property is analysed independently; aggregate figures are not combined."}
      </div>

      {group.reports.map((report, i) => {
        const tint = palette[i % palette.length];
        return (
          <div key={`${report.address}-${i}`}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: 10,
                background: "var(--surface-sunken)",
                marginBottom: 8,
              }}
            >
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: tint,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {i + 1}
              </span>
              <div style={{ fontWeight: 700 }}>
                Property {i + 1} of {group.reports.length} · {report.address}
              </div>
            </div>
            <ReportView report={report} />
          </div>
        );
      })}

      <div className="report" style={{ padding: 18 }}>
        <h3 style={{ margin: "0 0 4px" }}>Side-by-side comparison</h3>
        <p style={{ marginTop: 0, lineHeight: 1.5 }}>{group.comparison.summary}</p>
        <ComparisonList title="Subdivision" rows={group.comparison.subdivisionView} />
        <ComparisonList title="Investment" rows={group.comparison.investmentView} />
        <ComparisonList title="Risks" rows={group.comparison.risks} />
        {group.comparison.recommendedNextStep && (
          <div className="report-note" style={{ background: "var(--accent-soft)", color: "var(--accent-strong)" }}>
            → {group.comparison.recommendedNextStep}
          </div>
        )}
      </div>
    </div>
  );
}

function ComparisonList({ title, rows }: { title: string; rows: string[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {title}
      </div>
      <ul className="report-list">
        {rows.map((r, i) => (
          <li key={i}>{r}</li>
        ))}
      </ul>
    </div>
  );
}
