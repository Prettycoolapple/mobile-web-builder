import { useState } from "react";
import type { FeasibilityReport } from "@/state/chat-model";
import { formatArea, formatRange, formatScore, scoreColor } from "@/lib/format";
import { ScoreRing } from "./ScoreRing";
import { SectionCard, KeyValue, type SectionStatus } from "./SectionCard";
import { ReportSectionsB } from "./ReportSectionsB";

/**
 * Full-fidelity feasibility report. Part A (this file) renders the header,
 * scorecard and the site / planning / cost / risk backbone; Part B
 * (ReportSectionsB) renders the market & financial analytics. Every section is a
 * self-contained accordion so the future whitelabel PDF editor can re-render the
 * same components into a print layout.
 */
export function ReportView({ report }: { report: FeasibilityReport }) {
  const ov = report.propertyOverview;
  const scores = report.scores ?? { ease: 0, cost: 0, roi: 0, composite: 0 };
  const photo = report.photoUrl ?? report.photoUrls?.[0];
  const [imgFailed, setImgFailed] = useState(false);
  const planning = report.planning;

  return (
    <div className="report">
      {photo && !imgFailed && (
        <div style={{ width: "100%", aspectRatio: "16 / 7", background: "#1c1917", overflow: "hidden" }}>
          <img
            src={photo}
            alt={report.address}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setImgFailed(true)}
          />
        </div>
      )}

      <div className="report-head">
        <p className="addr">{report.address}</p>
        <div className="sub">
          {[ov?.zone, ov?.titleType, report.dataFreshness ? `Data as at ${new Date(report.dataFreshness.acquiredAt).toLocaleDateString()}` : null]
            .filter(Boolean)
            .join("  ·  ")}
        </div>
      </div>

      {/* Scorecard */}
      <div className="report-scorecard">
        <ScoreRing composite={scores.composite} />
        <div className="score-bars">
          <ScoreBar label="Ease" value={scores.ease} />
          <ScoreBar label="Cost" value={scores.cost} />
          <ScoreBar label="ROI" value={scores.roi} />
        </div>
      </div>

      {report.redevelopmentWarning?.suspected && (
        <div style={{ padding: "0 20px", marginTop: 12 }}>
          <div className="report-note danger">{report.redevelopmentWarning.message}</div>
        </div>
      )}

      <div className="report-sections">
        {/* ── Overview ───────────────────────────────────────────────── */}
        {ov && (
          <SectionCard title="Property overview" icon="📍" defaultOpen>
            <KeyValue
              rows={[
                ["Capital value", ov.cv || "—"],
                ["Land area", ov.landArea || formatArea(undefined) || "—"],
                ["Floor area", ov.floorArea || "—"],
                ["Bedrooms", typeof ov.bedrooms === "number" && ov.bedrooms > 0 ? String(ov.bedrooms) : "—"],
                ["Bathrooms", typeof ov.bathrooms === "number" && ov.bathrooms > 0 ? String(ov.bathrooms) : "—"],
                ["Build year", ov.buildYear || "—"],
                ["Property type", ov.propertyType || "—"],
                ["Site status", ov.siteStatusLabel || labelSiteStatus(ov.siteStatus)],
                ["Title type", ov.titleType || "—"],
                ["Zone", ov.zone || "—"],
                [
                  "Standard lots",
                  planning?.potentialLots != null ? String(planning.standardVacantLots ?? planning.potentialLots) : "—",
                ],
                [
                  "Design-led upside",
                  planning?.designLedEligible && planning.designLedYieldRange
                    ? `${planning.designLedYieldRange.min}–${planning.designLedYieldRange.max} units`
                    : "—",
                ],
                ["Listing price", ov.isOnMarket && ov.listingPrice ? ov.listingPrice : "—"],
              ]}
            />
          </SectionCard>
        )}

        {/* ── Title insight (cross-lease etc.) ───────────────────────── */}
        {report.titleInsight?.isCrossLease && (
          <SectionCard title="Land title" icon="📜" status="warning">
            {report.titleInsight.opportunity && <p style={{ marginTop: 0 }}>{report.titleInsight.opportunity}</p>}
            {report.titleInsight.risks?.length > 0 && (
              <ul className="report-list">
                {report.titleInsight.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </SectionCard>
        )}

        {/* ── School zones ───────────────────────────────────────────── */}
        {report.schoolZones && report.schoolZones.length > 0 && (
          <SectionCard title="School zones" icon="🎓">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {report.schoolZones.map((z, i) => (
                <div key={i}>
                  <div style={{ fontWeight: 700 }}>{z.orgName ?? z.sourceLabel}</div>
                  <div className="pcard-meta">
                    {[capitalize(z.level), z.yearLevels, z.enrolmentScheme, z.roll ? `${z.roll} roll` : null]
                      .filter(Boolean)
                      .map((b) => (
                        <span key={String(b)}>{b}</span>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {/* ── Planning & subdivision ─────────────────────────────────── */}
        {planning && (planning.overlays || planning.subdivisionSummary || planning.potentialLots != null) && (
          <SectionCard
            title="Planning & subdivision"
            icon="🏛"
            status={overlayStatus(planning.overlays)}
            defaultOpen
          >
            <KeyValue
              rows={[
                ["Zone", planning.zone || ov?.zone || "—"],
                ["Minimum lot size", planning.minLotSize || (planning.standardMinLotSize ? `${planning.standardMinLotSize} m²` : "—")],
                ["Standard pathway lots", planning.standardVacantLots != null ? String(planning.standardVacantLots) : "—"],
                [
                  "Design-led yield",
                  planning.designLedEligible && planning.designLedYieldRange
                    ? `${planning.designLedYieldRange.min}–${planning.designLedYieldRange.max} units (${planning.designLedConfidence ?? "low"} confidence)`
                    : "—",
                ],
                ["Net developable area", planning.netAreaSqm ? `${Math.round(planning.netAreaSqm)} m²` : "—"],
              ]}
            />
            {planning.subdivisionSummary && <div className="report-note">{planning.subdivisionSummary}</div>}
            {planning.subdivisionPathwayNote && <div className="report-note">{planning.subdivisionPathwayNote}</div>}
            {planning.designLedSummary && <div className="report-note">{planning.designLedSummary}</div>}

            {planning.overlays && planning.overlays.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {planning.overlays.map((o, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span className={`status-dot ${overlayDot(o.status)}`} style={{ marginTop: 6 }} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{o.name}</div>
                      {o.detail && <div style={{ color: "var(--muted)" }}>{o.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {planning.easements && planning.easements.length > 0 && (
              <>
                <div style={{ marginTop: 14, fontWeight: 700, fontSize: 12.5, color: "var(--muted)" }}>Easements</div>
                <ul className="report-list">
                  {planning.easements.map((e, i) => (
                    <li key={i}>
                      {e.description}
                      {e.severity ? ` (${e.severity})` : ""}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {planning.easement_summary && <div className="report-note">{planning.easement_summary}</div>}

            {report.overlay_map_image_base64 && (
              <img
                src={
                  report.overlay_map_image_base64.startsWith("data:")
                    ? report.overlay_map_image_base64
                    : `data:image/png;base64,${report.overlay_map_image_base64}`
                }
                alt="Planning overlay map"
                style={{ width: "100%", borderRadius: 10, marginTop: 12, border: "1px solid var(--line)" }}
              />
            )}
          </SectionCard>
        )}

        {/* ── Asbestos & demolition ──────────────────────────────────── */}
        {report.asbestos && (
          <SectionCard title="Asbestos & demolition" icon="⚠" status={asbestosStatus(report.asbestos.riskLevel)}>
            <KeyValue
              rows={[
                ["Build year", report.asbestos.buildYear || ov?.buildYear || "—"],
                ["Risk level", capitalize(report.asbestos.riskLevel)],
                ["WorkSafe notification", report.asbestos.worksafe_required ? "Likely required" : "Not flagged"],
                ["Estimated demolition", formatRange(report.asbestos.demoCostLow, report.asbestos.demoCostHigh)],
              ]}
            />
            {report.asbestos.notes && <div className="report-note warn">{report.asbestos.notes}</div>}
            {report.asbestos.worksafeNote && <div className="report-note">{report.asbestos.worksafeNote}</div>}
          </SectionCard>
        )}

        {/* ── Terrain & contour ──────────────────────────────────────── */}
        {report.terrain && (
          <SectionCard title="Terrain & contour" icon="⛰" status={terrainStatus(report.terrain.classification)}>
            <KeyValue
              rows={[
                ["Classification", report.terrain.classification ? capitalize(report.terrain.classification.replace("_", " ")) : "—"],
                ["Slope", report.terrain.slope || (report.terrain.slope_degrees != null ? `${report.terrain.slope_degrees}°` : "—")],
                [
                  "Retaining estimate",
                  formatRange(report.terrain.retainingCostLow, report.terrain.retainingCostHigh),
                ],
                [
                  "Est. retaining area",
                  report.terrain.retaining_area_sqm_estimate ? `${Math.round(report.terrain.retaining_area_sqm_estimate)} m²` : "—",
                ],
              ]}
            />
          </SectionCard>
        )}

        {/* ── Infrastructure & services ──────────────────────────────── */}
        {report.infrastructure && report.infrastructure.length > 0 && (
          <SectionCard title="Infrastructure & services" icon="🔧" status={infraStatus(report.infrastructure)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {report.infrastructure.map((svc, i) => {
                const low = svc.estimatedCostLow ?? svc.estimated_cost_low;
                const high = svc.estimatedCostHigh ?? svc.estimated_cost_high;
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>
                        <span className={`status-dot ${svc.risk === "low" ? "clear" : svc.risk === "moderate" ? "moderate" : "restricted"}`} style={{ display: "inline-block", marginRight: 6 }} />
                        {svc.name}
                      </div>
                      <div style={{ color: "var(--muted)" }}>
                        {svc.location.replace("-", " ")}
                        {svc.distance_metres != null ? ` · ${svc.distance_metres}m` : ""}
                      </div>
                      {svc.note && <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{svc.note}</div>}
                    </div>
                    <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>{formatRange(low, high)}</div>
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

        {/* ── Development cost ───────────────────────────────────────── */}
        {report.costItems && report.costItems.length > 0 && (
          <SectionCard title="Development cost estimate" icon="💰" status="neutral" defaultOpen>
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {report.costItems.map((ci, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span className="k" style={{ color: "var(--ink)" }}>{ci.label}</span>
                  <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{formatRange(ci.low, ci.high)}</span>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                fontWeight: 800,
              }}
            >
              <span>Total{report.total_excludes_land ? " (excl. land)" : ""}</span>
              <span>{formatRange(report.totalCostLow, report.totalCostHigh)}</span>
            </div>
            {typeof report.cost_per_unit_avg === "number" && report.cost_per_unit_avg > 0 && (
              <div style={{ marginTop: 6, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                <span>Average cost per unit</span>
                <span>{formatRange(report.cost_per_unit_avg, report.cost_per_unit_avg)}</span>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Part B: market & financial analytics ───────────────────── */}
        <ReportSectionsB report={report} />

        {/* ── Risk assessment ────────────────────────────────────────── */}
        {report.riskSummary && report.riskSummary.length > 0 && (
          <SectionCard title="Risk assessment" icon="🔍">
            <ul className="report-list">
              {report.riskSummary.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </SectionCard>
        )}
      </div>

      {report.disclaimer && (
        <div style={{ padding: "14px 20px", color: "var(--muted)", fontSize: 11.5, lineHeight: 1.5, borderTop: "1px solid var(--line)" }}>
          {report.disclaimer}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value / 5)) * 100;
  return (
    <div className="score-bar">
      <div className="top">
        <span>{label}</span>
        <span>{formatScore(value)} / 5</span>
      </div>
      <div className="track">
        <div className="fill" style={{ width: `${pct}%`, background: scoreColor(value) }} />
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function labelSiteStatus(status?: "vacant_land" | "has_dwelling" | "unknown"): string {
  if (status === "vacant_land") return "Vacant land";
  if (status === "has_dwelling") return "Has dwelling";
  return "—";
}

function overlayStatus(overlays?: { status: string }[]): SectionStatus {
  if (!overlays || overlays.length === 0) return "neutral";
  if (overlays.some((o) => o.status === "restricted")) return "restricted";
  if (overlays.some((o) => o.status === "moderate")) return "moderate";
  return "clear";
}

function overlayDot(status: string): string {
  if (status === "restricted") return "restricted";
  if (status === "moderate") return "moderate";
  if (status === "clear") return "clear";
  return "";
}

function asbestosStatus(risk: string): SectionStatus {
  if (risk === "high") return "restricted";
  if (risk === "moderate") return "moderate";
  if (risk === "low") return "clear";
  return "neutral";
}

function terrainStatus(c: string | null): SectionStatus {
  if (!c) return "neutral";
  if (c === "steep" || c === "very_steep") return "restricted";
  if (c === "moderate") return "moderate";
  return "clear";
}

function infraStatus(infra: { risk: string }[]): SectionStatus {
  if (infra.some((s) => s.risk === "high")) return "restricted";
  if (infra.some((s) => s.risk === "moderate")) return "moderate";
  return "clear";
}
