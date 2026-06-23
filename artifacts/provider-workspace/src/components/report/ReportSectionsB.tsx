import type {
  ComparableSale,
  DevelopmentStrategyScenario,
  FeasibilityReport,
  ROIScenario,
} from "@/state/chat-model";
import { formatMoney, formatPercent, formatRange } from "@/lib/format";
import { SectionCard, KeyValue, type SectionStatus } from "./SectionCard";

/**
 * Report Part B — market & financial analytics: market access (neighbourhood +
 * transport), built environment, development strategy scenarios, ROI scenarios,
 * and comparable sales. Rendered inside ReportView between the cost backbone and
 * the risk summary.
 */
export function ReportSectionsB({ report }: { report: FeasibilityReport }) {
  const strategies = report.developmentStrategies ?? [];
  const hasStrategies = strategies.length > 0;
  const roi = report.roiScenarios ?? [];
  const comparables = (report.comparableSales ?? []).filter((c) => (c.price ?? c.price_nzd ?? 0) > 0);
  const hasLiveComparables = report.comparables_quality === "live" && comparables.length > 0;

  return (
    <>
      {/* ── Market access context ──────────────────────────────────── */}
      {(report.neighbourhoodContext || report.transportContext) && (
        <SectionCard title="Market access & context" icon="🚉" status="neutral">
          <MarketAccessPanel report={report} />
        </SectionCard>
      )}

      {/* ── Built environment ──────────────────────────────────────── */}
      {report.builtEnvironmentContext && report.builtEnvironmentContext.assessedProperties > 0 && (
        <SectionCard title="Built environment" icon="🏢" status="neutral">
          <BuiltEnvironmentPanel ctx={report.builtEnvironmentContext} />
        </SectionCard>
      )}

      {/* ── Development strategy scenarios ─────────────────────────── */}
      {hasStrategies && (
        <SectionCard
          title="Development strategy scenarios"
          icon="🧭"
          status={strategyStatus(strategies)}
          defaultOpen
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {strategies.map((s) => (
              <StrategyCard
                key={s.id}
                strategy={s}
                recommended={report.recommendedDevelopmentStrategy === s.id}
              />
            ))}
          </div>
          {hasLiveComparables && <ComparablesTable comparables={comparables} />}
        </SectionCard>
      )}

      {/* ── ROI scenarios (when no strategy breakdown) ─────────────── */}
      {!hasStrategies && roi.length > 0 && (
        <SectionCard title="ROI scenarios" icon="📈" status={roiStatus(report.scores?.roi)} defaultOpen>
          {(report.cv_unavailable || roi[0]?.cv_unavailable) && (
            <div className="report-note warn">
              Council valuation unavailable — ROI figures are directional estimates.
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {roi.map((sc, i) => (
              <ROIScenarioCard key={i} scenario={sc} />
            ))}
          </div>
          {hasLiveComparables && <ComparablesTable comparables={comparables} />}
        </SectionCard>
      )}
    </>
  );
}

function MarketAccessPanel({ report }: { report: FeasibilityReport }) {
  const nb = report.neighbourhoodContext;
  const tr = report.transportContext;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {tr && (
        <div>
          <SubHeading>Transport</SubHeading>
          <KeyValue
            rows={[
              ["Public transport", capitalize(tr.publicTransport.accessTier)],
              [
                "Nearest stop",
                tr.publicTransport.nearestStop
                  ? `${tr.publicTransport.nearestStop.name} · ${tr.publicTransport.nearestStop.distanceM}m`
                  : "—",
              ],
              [
                "City commute",
                tr.cityCommute.centreName
                  ? `${tr.cityCommute.centreName}${tr.cityCommute.distanceKm != null ? ` · ${tr.cityCommute.distanceKm}km` : ""}${tr.cityCommute.durationMinutes != null ? ` · ${tr.cityCommute.durationMinutes}min` : ""}`
                  : "—",
              ],
            ]}
          />
          {tr.roiInfluence.reasons.length > 0 && (
            <ul className="report-list">
              {tr.roiInfluence.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {nb && (
        <div>
          <SubHeading>Neighbourhood</SubHeading>
          <KeyValue
            rows={[
              ["Assessed lots", String(nb.assessedLots)],
              ["Radius", `${nb.radiusM}m`],
              ["Public housing signal", capitalize(nb.publicHousingSignal.level)],
              [
                "Market adjustment",
                nb.marketAdjustment.applied ? `×${nb.marketAdjustment.gdvMultiplier.toFixed(2)}` : "None applied",
              ],
            ]}
          />
          {visibleMarketReasons(nb.reasons).length > 0 && (
            <ul className="report-list">
              {visibleMarketReasons(nb.reasons).map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BuiltEnvironmentPanel({ ctx }: { ctx: NonNullable<FeasibilityReport["builtEnvironmentContext"]> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <KeyValue
        rows={[
          ["Assessed properties", String(ctx.assessedProperties)],
          ["Radius", `${ctx.radiusM}m`],
          ["Modern share", formatPercent(ctx.modernShare * 100)],
          ["Post-2000 share", formatPercent(ctx.post2000Share * 100)],
          ["Median build year", ctx.medianBuildYear != null ? String(ctx.medianBuildYear) : "—"],
          ["Subject build year", ctx.subjectBuildYear != null ? String(ctx.subjectBuildYear) : ctx.subjectBuildYearRange || "—"],
        ]}
      />
      {ctx.reasons.length > 0 && (
        <ul className="report-list">
          {ctx.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {ctx.nearbyExamples.length > 0 && (
        <div className="pill-list">
          {ctx.nearbyExamples.slice(0, 6).map((ex, i) => (
            <span key={i} className="pill">
              {ex.buildYear ?? ex.buildYearRange ?? "?"}
              {ex.distanceM != null ? ` · ${ex.distanceM}m` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StrategyCard({ strategy, recommended }: { strategy: DevelopmentStrategyScenario; recommended: boolean }) {
  const best = strategy.roiScenarios.find((s) => s.isBest) ?? strategy.roiScenarios[0];
  return (
    <div
      style={{
        border: `1px solid ${recommended ? "var(--accent)" : "var(--line)"}`,
        borderRadius: 12,
        padding: 14,
        background: recommended ? "var(--accent-soft)" : "var(--surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <strong>{strategy.title}</strong>
        <span className={`pill`} style={recommendationStyle(strategy.recommendation)}>
          {recommendationLabel(strategy.recommendation)}
        </span>
        {recommended && strategy.recommendation !== "recommended" && (
          <span className="pill" style={{ background: "var(--accent)", color: "#fff" }}>Recommended</span>
        )}
      </div>
      {strategy.rationale && <p style={{ margin: "0 0 10px", lineHeight: 1.5 }}>{strategy.rationale}</p>}
      <KeyValue
        rows={[
          ["Total cost", formatRange(strategy.totalCostLow, strategy.totalCostHigh)],
          ["Cost per unit", formatMoney(strategy.costPerUnitAvg)],
          ["Confidence", formatPercent(strategy.confidence * 100)],
          ...(best
            ? ([
                ["Best-case GDV", formatMoney(best.gdv)],
                ["Gross profit", formatMoney(best.grossProfit ?? best.gross_profit)],
                ["ROI", formatPercent(best.roi ?? best.roi_percent)],
              ] as Array<[string, string]>)
            : []),
        ]}
      />
      {best?.cases && best.cases.length > 0 && <ROICaseRow scenario={best} />}
      {strategy.assumptions?.length > 0 && (
        <ul className="report-list">
          {strategy.assumptions.map((a, i) => (
            <li key={i} style={{ color: "var(--muted)" }}>
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ROIScenarioCard({ scenario }: { scenario: ROIScenario }) {
  return (
    <div
      style={{
        border: `1px solid ${scenario.isBest ? "var(--accent)" : "var(--line)"}`,
        borderRadius: 12,
        padding: 14,
        background: scenario.isBest ? "var(--accent-soft)" : "var(--surface)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <strong>
          {scenario.lots ? `${scenario.lots} lots` : "Scenario"} · {scenario.years}yr
        </strong>
        {scenario.isBest && <span className="pill" style={{ background: "var(--accent)", color: "#fff" }}>Best</span>}
      </div>
      <KeyValue
        rows={[
          ["GDV", formatMoney(scenario.gdv)],
          ["Total cost", formatMoney(scenario.totalCost ?? scenario.total_cost_mid)],
          ["Gross profit", formatMoney(scenario.grossProfit ?? scenario.gross_profit)],
          ["ROI", formatPercent(scenario.roi ?? scenario.roi_percent)],
          ["Annualised ROI", formatPercent(scenario.annualisedRoi ?? scenario.annualised_roi_percent)],
        ]}
      />
      {scenario.cases && scenario.cases.length > 0 && <ROICaseRow scenario={scenario} />}
    </div>
  );
}

function ROICaseRow({ scenario }: { scenario: ROIScenario }) {
  if (!scenario.cases || scenario.cases.length === 0) return null;
  return (
    <div className="score-row" style={{ marginTop: 10 }}>
      {scenario.cases.map((c) => (
        <div key={c.case} className="score-pill" style={{ textAlign: "left", padding: "8px 10px" }}>
          <span className="label">{c.label || c.case}</span>
          <span className="val" style={{ fontSize: 13, color: c.viable ? "var(--green)" : "var(--red)" }}>
            {formatPercent(c.roi_percent)}
          </span>
          <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{formatMoney(c.gross_profit)}</span>
        </div>
      ))}
    </div>
  );
}

function ComparablesTable({ comparables }: { comparables: ComparableSale[] }) {
  return (
    <div style={{ marginTop: 14 }}>
      <SubHeading>Comparable sales</SubHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {comparables.slice(0, 8).map((c, i) => {
          const price = c.price ?? c.price_nzd;
          const land = c.land_sqm ?? c.size;
          return (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{c.address}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>
                  {[
                    c.saleDate ?? c.sale_date,
                    land ? `${Math.round(land)}m²` : null,
                    c.distanceM != null ? `${c.distanceM}m away` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatMoney(price)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function shouldHideMarketReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return normalized.includes("linz title-owner data was unavailable") && normalized.includes("no public-housing conclusion");
}

function visibleMarketReasons(items: string[]): string[] {
  return items.filter((item) => item.trim().length > 0 && !shouldHideMarketReason(item));
}

function strategyStatus(strategies: DevelopmentStrategyScenario[]): SectionStatus {
  if (strategies.some((s) => s.recommendation === "recommended")) return "clear";
  if (strategies.some((s) => s.recommendation === "viable")) return "moderate";
  return "neutral";
}

function roiStatus(roi?: number): SectionStatus {
  if (typeof roi !== "number") return "neutral";
  if (roi >= 4) return "clear";
  if (roi >= 2.5) return "moderate";
  return "restricted";
}

function recommendationLabel(r: DevelopmentStrategyScenario["recommendation"]): string {
  if (r === "recommended") return "Recommended";
  if (r === "viable") return "Viable";
  return "Not recommended";
}

function recommendationStyle(r: DevelopmentStrategyScenario["recommendation"]): React.CSSProperties {
  if (r === "recommended") return { background: "var(--forest-soft)", color: "var(--forest)" };
  if (r === "viable") return { background: "#fbf0dd", color: "#9a6a16" };
  return { background: "#fbe7e7", color: "#8a2d2d" };
}
