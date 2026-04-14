import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
} from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { Feather } from "@expo/vector-icons";
import { StarRating } from "@/components/StarRating";
import { useColors } from "@/hooks/useColors";
import {
  FeasibilityReport as Report,
  ROIScenario,
  ROICaseResult,
  CostItem,
  InfrastructureService,
  ComparableSale,
  AsbestosInfo,
  PlanningOverlay,
  EasementEntry,
} from "@/context/ChatContext";

interface Props {
  report: Report;
  onFollowUp: (question: string) => void;
}

function formatNZD(n: number | string | undefined | null): string {
  const num = n == null ? NaN : Number(n);
  if (isNaN(num)) return "—";
  if (num >= 1_000_000) return `$${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `$${Math.round(num / 1_000).toLocaleString()}k`;
  return `$${Math.round(num).toLocaleString()}`;
}

function safeNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function capitalize(s: string | undefined): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function scoreColor(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 4) return colors.success;
  if (score >= 2.5) return colors.amber;
  return colors.red;
}

function getAsbestosRisk(a: AsbestosInfo): "low" | "high" | "unknown" | "moderate" {
  return (a.risk || a.riskLevel || "unknown") as any;
}

function getInfraLabel(loc: string): string {
  switch (loc) {
    case "on-parcel":  return "On parcel";
    case "boundary":   return "At boundary";
    case "neighbour":  return "Neighbour land ⚠";
    case "public-land":return "Public road";
    case "unknown":    return "Unknown";
    default:           return "Unknown";
  }
}

function hasOverlay(report: Report, keyword: string): boolean {
  const overlays = report.planning?.overlays ?? [];
  return overlays.some(
    (o) =>
      o.name.toLowerCase().includes(keyword.toLowerCase()) &&
      (o.status === "restricted" || o.status === "moderate")
  );
}

function overlayStatus(report: Report): "good" | "warning" | "risk" | "neutral" {
  const overlays = report.planning?.overlays ?? [];
  if (overlays.some((o) => o.status === "restricted")) return "risk";
  if (overlays.some((o) => o.status === "moderate")) return "warning";
  return "good";
}

function contourStatus(terrain: Report["terrain"]): "good" | "warning" | "risk" | "neutral" {
  if (!terrain || terrain.classification === null) return "neutral";
  if (terrain.classification === "steep") return "risk";
  if (terrain.classification === "moderate") return "warning";
  return "good";
}

function infraStatus(infra: Report["infrastructure"]): "good" | "warning" | "risk" | "neutral" {
  if (!infra || infra.length === 0) return "neutral";
  if (infra.some((s) => s.location === "neighbour")) return "warning";
  return "good";
}

function roiStatus(score: number): "good" | "warning" | "risk" | "neutral" {
  if (score >= 4) return "good";
  if (score >= 2.5) return "warning";
  return "risk";
}

function getScenarioRoi(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.roi_percent ?? s.roi);
}

function getScenarioAnnualisedRoi(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.annualised_roi_percent ?? s.annualisedRoi);
}

function getScenarioProfit(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.gross_profit ?? s.grossProfit);
}

function getScenarioTotalCost(s: ROIScenario | undefined): number {
  if (!s) return 0;
  return safeNum(s.total_cost_mid ?? s.totalCost);
}

function getSaleDate(c: ComparableSale): string {
  return c.sale_date ?? c.saleDate ?? "—";
}

function getSalePrice(c: ComparableSale): number {
  return safeNum(c.price_nzd ?? c.price);
}

function getSaleSize(c: ComparableSale): number {
  return safeNum(c.floor_sqm ?? c.land_sqm ?? c.size);
}

function getSalePsm(c: ComparableSale): number {
  return safeNum(c.price_per_sqm ?? c.pricePerSqm);
}

function getScenarioBest(scenarios: ROIScenario[]): ROIScenario | undefined {
  return (
    scenarios.find((s) => s.isBest || s.viable) ??
    scenarios.reduce((best, s) => getScenarioRoi(s) > getScenarioRoi(best) ? s : best, scenarios[0])
  );
}

function getCostLow(item: CostItem): number { return safeNum(item.low); }
function getCostHigh(item: CostItem): number { return safeNum(item.high); }

function SectionCard({
  title,
  icon,
  status,
  defaultOpen = true,
  children,
  colors,
}: {
  title: string;
  icon: string;
  status?: "good" | "warning" | "risk" | "neutral";
  defaultOpen?: boolean;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const dotColor =
    status === "good" ? colors.success
    : status === "warning" ? colors.amber
    : status === "risk" ? colors.red
    : null;

  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity style={styles.sectionHeader} onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        {dotColor && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
        <Text style={styles.sectionIcon}>{icon}</Text>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", flex: 1 }]}>
          {title}
        </Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
      </TouchableOpacity>
      {open && <View style={[styles.sectionBody, { borderTopColor: colors.border }]}>{children}</View>}
    </View>
  );
}

function InfoRow({ label, value, valueColor, colors }: {
  label: string; value: string; valueColor?: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor || colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{value}</Text>
    </View>
  );
}

function ScoreStarBlock({
  score, label, colors,
}: {
  score: number; label: string;
  colors: ReturnType<typeof useColors>;
}) {
  const color = scoreColor(score, colors);
  return (
    <View style={{ flex: 1, alignItems: "center", gap: 6 }}>
      <StarRating score={score} maxStars={3} size={16} gap={4} color={color} emptyColor="rgba(250,250,249,0.18)" />
      <Text style={{ color: "rgba(250,250,249,0.55)", fontFamily: "DM_Sans_400Regular", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label}
      </Text>
    </View>
  );
}

function ScoreSummaryRow({ report, colors }: { report: Report; colors: ReturnType<typeof useColors> }) {
  const raw = report.scores ?? {};
  const ease = safeNum(raw.ease);
  const cost = safeNum(raw.cost);
  const roi = safeNum(raw.roi);
  const composite = safeNum(raw.composite);
  const { ease_reasons, cost_reasons, roi_reasons } = raw;
  const overallColor = scoreColor(composite, colors);
  const overallDisplay = composite > 0 ? String(Math.round(composite)) : "—";

  return (
    <View style={[styles.scoresSection, { backgroundColor: (colors as any).scoreCardBg }]}>
      {/* Overall score badge — top right */}
      <View style={styles.overallRow}>
        <Text style={[styles.overallLabel, { color: "rgba(250,250,249,0.45)" }]}>OVERALL</Text>
        <View style={[styles.overallBadge, { backgroundColor: overallColor + "25", borderColor: overallColor + "55" }]}>
          <Text style={[styles.overallNumber, { color: overallColor }]}>{overallDisplay}</Text>
          <Text style={[styles.overallSubLabel, { color: overallColor + "99" }]}>/ 5</Text>
        </View>
      </View>

      {/* Sub-scores: Ease · Cost · ROI */}
      <View style={[styles.scoresRow, { borderTopColor: "rgba(250,250,249,0.1)" }]}>
        <ScoreStarBlock score={ease} label="Ease" colors={colors} />
        <View style={[styles.scoreDivider, { backgroundColor: "rgba(250,250,249,0.1)" }]} />
        <ScoreStarBlock score={cost} label="Cost" colors={colors} />
        <View style={[styles.scoreDivider, { backgroundColor: "rgba(250,250,249,0.1)" }]} />
        <ScoreStarBlock score={roi} label="ROI" colors={colors} />
      </View>

      {/* Reasons */}
      {(ease_reasons || cost_reasons || roi_reasons) && (
        <View style={[styles.reasonsRow, { borderTopColor: "rgba(250,250,249,0.1)" }]}>
          {ease_reasons && ease_reasons.length > 0 && (
            <View style={styles.reasonBlock}>
              <Text style={[styles.reasonTitle, { color: "rgba(250,250,249,0.45)" }]}>EASE</Text>
              {ease_reasons.slice(0, 2).map((r, i) => (
                <Text key={i} style={[styles.reasonText, { color: "rgba(250,250,249,0.75)" }]}>· {r}</Text>
              ))}
            </View>
          )}
          {roi_reasons && roi_reasons.length > 0 && (
            <View style={styles.reasonBlock}>
              <Text style={[styles.reasonTitle, { color: "rgba(250,250,249,0.45)" }]}>ROI</Text>
              {roi_reasons.slice(0, 2).map((r, i) => (
                <Text key={i} style={[styles.reasonText, { color: "rgba(250,250,249,0.75)" }]}>· {r}</Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function OverlayChecklist({ overlays, colors }: { overlays: PlanningOverlay[]; colors: ReturnType<typeof useColors> }) {
  if (!overlays || overlays.length === 0) {
    return <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>No overlays recorded.</Text>;
  }
  return (
    <View style={{ gap: 8 }}>
      {overlays.map((o, i) => {
        const indicator = o.status === "restricted" ? "🔴" : o.status === "moderate" ? "🟡" : "🟢";
        const textColor = o.status === "restricted" ? colors.red : o.status === "moderate" ? colors.amber : colors.success;
        return (
          <View key={i} style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
            <Text style={{ fontSize: 15 }}>{indicator}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ color: textColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{o.name}</Text>
              {o.detail && <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>{o.detail}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function easementIcon(type: EasementEntry["type"]): string {
  switch (type) {
    case "right_of_way": return "🚗";
    case "drainage":     return "💧";
    case "power":        return "⚡";
    case "services":     return "🔧";
    case "covenant":     return "📜";
    case "encroachment": return "🏗";
    default:             return "⚠️";
  }
}

function EasementList({
  easements, appurtenant, summary, lotImpact, grossArea, netArea, easementArea, dataStatus, colors,
}: {
  easements?: EasementEntry[];
  appurtenant?: { type: string; description: string }[];
  summary?: string;
  lotImpact?: string | null;
  grossArea?: number;
  netArea?: number;
  easementArea?: number;
  dataStatus?: "retrieved" | "no_memorials" | "api_error" | "no_title";
  colors: ReturnType<typeof useColors>;
}) {
  const hasBurdening = easements && easements.length > 0;
  const hasAppurtenant = appurtenant && appurtenant.length > 0;

  if (!hasBurdening && !hasAppurtenant) {
    const isUnconfirmed = !dataStatus || dataStatus === "api_error" || dataStatus === "no_title";
    return (
      <View style={{ gap: 8 }}>
        <View style={[{
          flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1,
          backgroundColor: isUnconfirmed ? colors.amber + "12" : colors.muted,
          borderColor: isUnconfirmed ? colors.amber + "40" : colors.border,
        }]}>
          <Feather name={isUnconfirmed ? "alert-circle" : "check-circle"} size={14} color={isUnconfirmed ? colors.amber : colors.success} style={{ marginTop: 1 }} />
          <Text style={{ color: isUnconfirmed ? colors.amber : colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13, flex: 1, lineHeight: 18 }}>
            {isUnconfirmed
              ? "Title data was inconclusive — a solicitor title search is required to confirm whether any easements or rights of way are registered on this title."
              : dataStatus === "no_memorials"
                ? "No recorded easements found in title records — title appears clean, but verify with a solicitor before subdivision."
                : "No easements or rights of way detected on this title."}
          </Text>
        </View>
        {summary && (
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17 }}>
            {summary}
          </Text>
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: 10 }}>
      {/* Area impact banner when easements reduce subdivisable area */}
      {easementArea != null && easementArea > 0 && grossArea != null && netArea != null && (
        <View style={[{ backgroundColor: colors.amber + "18", borderColor: colors.amber + "35", borderWidth: 1, borderRadius: 10, padding: 10, gap: 4 }]}>
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>AREA REDUCTION DUE TO EASEMENTS</Text>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 2 }}>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              Gross: <Text style={{ fontFamily: "DM_Sans_600SemiBold" }}>{grossArea.toLocaleString()}m²</Text>
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              Easement: <Text style={{ fontFamily: "DM_Sans_600SemiBold", color: colors.red }}>−{easementArea.toLocaleString()}m²</Text>
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              Net: <Text style={{ fontFamily: "DM_Sans_600SemiBold", color: colors.success }}>{netArea.toLocaleString()}m²</Text>
            </Text>
          </View>
        </View>
      )}

      {/* Lot impact note */}
      {lotImpact && (
        <View style={[{ backgroundColor: colors.red + "10", borderColor: colors.red + "30", borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: "row", gap: 8, alignItems: "flex-start" }]}>
          <Feather name="alert-triangle" size={13} color={colors.red} style={{ marginTop: 1 }} />
          <Text style={{ color: colors.red, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>{lotImpact}</Text>
        </View>
      )}

      {/* Burdening easements */}
      {hasBurdening && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Burdening This Property
          </Text>
          {easements!.map((e, i) => {
            const sevColor = e.severity === "significant" ? colors.red : e.severity === "moderate" ? colors.amber : colors.mutedForeground;
            return (
              <View key={i} style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
                <Text style={{ fontSize: 15 }}>{easementIcon(e.type)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: sevColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{e.description}</Text>
                  {e.estimated_area_sqm != null && (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, marginTop: 2 }}>
                      Est. {e.estimated_area_sqm}m² affected
                      {e.estimated_width_m != null ? ` (~${e.estimated_width_m}m wide)` : ""}
                    </Text>
                  )}
                </View>
                <View style={[{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: sevColor + "20" }]}>
                  <Text style={{ color: sevColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 10, textTransform: "uppercase" }}>{e.severity ?? "?"}</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {/* Appurtenant easements */}
      {hasAppurtenant && (
        <View style={{ gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
            Benefiting This Property
          </Text>
          {appurtenant!.map((e, i) => (
            <View key={i} style={[styles.overlayRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
              <Text style={{ fontSize: 15 }}>✅</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.success, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{e.description}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {summary && null}
    </View>
  );
}

function AsbestosPanel({ asbestos, colors }: { asbestos: AsbestosInfo; colors: ReturnType<typeof useColors> }) {
  const risk = getAsbestosRisk(asbestos);
  const riskColor = risk === "high" ? colors.red : risk === "moderate" ? colors.amber : risk === "unknown" ? colors.amber : colors.success;
  const buildYearNum = asbestos.buildYear ? parseInt(String(asbestos.buildYear), 10) : null;
  const riskLabel =
    risk === "high"
      ? `HIGH — Built ${buildYearNum ?? "1940–1990"} (likely contains ACM)`
      : risk === "low"
        ? buildYearNum && buildYearNum <= 1940
          ? "LOW — Built 1940 or earlier (minimal ACM risk)"
          : "LOW — Post-1990 build (minimal ACM risk)"
        : "UNKNOWN — Survey required";

  const demoCostLow = asbestos.demoCostLow ?? 0;
  const demoCostHigh = asbestos.demoCostHigh ?? 0;
  const isVacant = demoCostLow === 0 && demoCostHigh === 0;

  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.riskBanner, { backgroundColor: riskColor + "15", borderColor: riskColor + "30", borderRadius: 10 }]}>
        <Text style={{ fontSize: 18 }}>{risk === "high" ? "⚠️" : risk === "low" ? "✅" : "❓"}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: riskColor, fontFamily: "DM_Sans_700Bold", fontSize: 13 }}>Asbestos Risk: {riskLabel}</Text>
          {asbestos.buildYear && (
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>
              Build year: {asbestos.buildYear}
            </Text>
          )}
        </View>
      </View>
      {isVacant ? (
        <View style={[styles.warningBox, { backgroundColor: colors.success + "12", borderColor: colors.success + "30" }]}>
          <Feather name="check-circle" size={13} color={colors.success} />
          <Text style={{ color: colors.success, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            No demolition required — vacant land or no existing dwelling detected.
          </Text>
        </View>
      ) : (
        <InfoRow
          label="Demo cost estimate"
          value={`${formatNZD(demoCostLow)} – ${formatNZD(demoCostHigh)}`}
          colors={colors}
        />
      )}
      {asbestos.notes && (
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20 }}>
          {asbestos.notes}
        </Text>
      )}
      {asbestos.worksafeNote && !asbestos.notes && (
        <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20 }}>
          {asbestos.worksafeNote}
        </Text>
      )}
      {(asbestos.worksafe_required || asbestos.flagged) && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
          <Feather name="alert-triangle" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_500Medium", fontSize: 13, flex: 1, lineHeight: 18 }}>
            WorkSafe NZ requirements apply. A licensed asbestos removalist must be engaged before demolition.
          </Text>
        </View>
      )}
    </View>
  );
}

function ContourCard({ terrain, colors }: { report: Report; terrain: NonNullable<Report["terrain"]>; colors: ReturnType<typeof useColors> }) {
  const cls = terrain.classification;
  if (!cls) {
    return (
      <View style={{ gap: 8 }}>
        <View style={[styles.warningBox, { backgroundColor: colors.mutedForeground + "12", borderColor: colors.mutedForeground + "30" }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            Terrain data could not be retrieved automatically. Inspect on-site or obtain a contour survey.
          </Text>
        </View>
      </View>
    );
  }

  const steepness = cls === "steep" ? 40 : cls === "moderate" ? 22 : cls === "gentle" ? 10 : 3;
  const W = 120, H = 70;
  const slopeY = H - (steepness / 45) * H;
  const terrainColor = cls === "steep" ? colors.red : cls === "moderate" ? colors.amber : colors.success;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <Svg width={W} height={H}>
          <Polygon
            points={`0,${H} ${W},${slopeY} ${W},${H}`}
            fill={terrainColor + "30"}
            stroke={terrainColor}
            strokeWidth={2}
          />
        </Svg>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: terrainColor, fontFamily: "DM_Sans_700Bold", fontSize: 15 }}>
            {capitalize(cls)}
          </Text>
          {terrain.slope_degrees != null && (
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
              ~{terrain.slope_degrees}° slope
            </Text>
          )}
          {terrain.slope && (
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 18 }}>
              {terrain.slope}
            </Text>
          )}
        </View>
      </View>
      {((terrain.retainingCostLow ?? 0) > 0 || (terrain.retainingCostHigh ?? 0) > 0) && (
        <InfoRow
          label="Retaining wall cost"
          value={`${formatNZD(terrain.retainingCostLow)} – ${formatNZD(terrain.retainingCostHigh)}`}
          valueColor={terrainColor}
          colors={colors}
        />
      )}
      {(cls === "steep" || cls === "moderate") && (
        <View style={[styles.warningBox, { backgroundColor: terrainColor + "12", borderColor: terrainColor + "30" }]}>
          <Feather name="alert-triangle" size={13} color={terrainColor} />
          <Text style={{ color: terrainColor, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            {cls === "steep"
              ? "Steep terrain significantly increases foundation and retaining costs. Single dwelling: $50k–$150k. Subdivision (multiple lots): $200k–$500k+. Engage a geotechnical engineer for site-specific assessment."
              : "Moderate slope — retaining walls and cut-and-fill earthworks will add cost. Engineering assessment recommended."}
          </Text>
        </View>
      )}
    </View>
  );
}

function InfrastructureTable({ infrastructure, colors }: { infrastructure: InfrastructureService[]; colors: ReturnType<typeof useColors> }) {
  const hasNeighbour = infrastructure.some((s) => s.location === "neighbour");
  const hasUnknown = infrastructure.some((s) => s.location === "unknown");

  return (
    <View style={{ gap: 0 }}>
      {infrastructure.map((svc, i) => {
        const locLabel = getInfraLabel(svc.location);
        const isUnknown = svc.location === "unknown";
        const locColor =
          svc.location === "on-parcel" ? colors.success
          : svc.location === "boundary" ? "#3B82F6"
          : svc.location === "neighbour" ? colors.amber
          : isUnknown ? colors.mutedForeground
          : colors.mutedForeground;
        const riskAssessment = svc.location === "neighbour" ? "Easement may be required"
          : isUnknown ? "Location unverified"
          : "Standard connection";
        const costLow = svc.estimatedCostLow ?? svc.estimated_cost_low;
        const costHigh = svc.estimatedCostHigh ?? svc.estimated_cost_high;

        return (
          <View
            key={i}
            style={[
              styles.infraRow,
              i < infrastructure.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
          >
            <View style={{ flex: 2 }}>
              <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>{svc.name}</Text>
              {svc.note && (
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, marginTop: 2 }}>{svc.note}</Text>
              )}
            </View>
            <View style={{ flex: 2, alignItems: "flex-start" }}>
              <View style={[styles.locationChip, { backgroundColor: locColor + "18", borderColor: locColor + "40" }]}>
                <Text style={{ color: locColor, fontFamily: "DM_Sans_600SemiBold", fontSize: 11 }}>{locLabel}</Text>
              </View>
            </View>
            <View style={{ flex: 2, alignItems: "flex-end" }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, textAlign: "right" }}>
                {riskAssessment}
              </Text>
              {costLow != null && costHigh != null && (
                <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_500Medium", fontSize: 12, marginTop: 2 }}>
                  {formatNZD(costLow)}–{formatNZD(costHigh)}
                </Text>
              )}
            </View>
          </View>
        );
      })}
      {hasNeighbour && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30", marginTop: 10 }]}>
          <Feather name="alert-triangle" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            One or more services are located on neighbouring property. A registered easement or private agreement will be required before building consent can be granted.
          </Text>
        </View>
      )}
      {hasUnknown && (
        <View style={[styles.warningBox, { backgroundColor: colors.mutedForeground + "12", borderColor: colors.mutedForeground + "30", marginTop: 10 }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
            Infrastructure location could not be determined automatically. Verify service locations at geomapspublic.aucklandcouncil.govt.nz or engage a civil engineer.
          </Text>
        </View>
      )}
    </View>
  );
}

const COST_COLORS = ["#3B82F6", "#EF4444", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#F97316", "#6B7280"];

function CostBreakdownChart({ costItems, totalCostLow, totalCostHigh, costPerUnitAvg, colors }: {
  costItems: CostItem[];
  totalCostLow?: number;
  totalCostHigh?: number;
  costPerUnitAvg?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const totalMid = costItems.reduce((s, i) => s + (getCostLow(i) + getCostHigh(i)) / 2, 0);

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.costBar, { backgroundColor: colors.muted }]}>
        {costItems.map((item, idx) => {
          const mid = (getCostLow(item) + getCostHigh(item)) / 2;
          const pct = totalMid > 0 ? (mid / totalMid) * 100 : 0;
          return (
            <View
              key={item.label}
              style={[styles.costBarSegment, { width: `${pct}%`, backgroundColor: COST_COLORS[idx % COST_COLORS.length] }]}
            />
          );
        })}
      </View>
      <View style={styles.costLegend}>
        {costItems.map((item, idx) => (
          <View key={item.label} style={styles.costLegendItem}>
            <View style={[styles.costLegendDot, { backgroundColor: COST_COLORS[idx % COST_COLORS.length] }]} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11 }}>{item.label}</Text>
          </View>
        ))}
      </View>
      <View style={{ gap: 0 }}>
        {costItems.map((item, i) => (
          <View
            key={item.label}
            style={[styles.infoRow, { borderBottomColor: colors.border, borderBottomWidth: i < costItems.length - 1 ? StyleSheet.hairlineWidth : 0 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
              <View style={[styles.costLegendDot, { backgroundColor: COST_COLORS[i % COST_COLORS.length] }]} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>{item.label}</Text>
            </View>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
              {formatNZD(getCostLow(item))} – {formatNZD(getCostHigh(item))}
            </Text>
          </View>
        ))}
        <View style={[styles.totalRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
          <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 14 }}>TOTAL</Text>
          <Text style={{ color: colors.accent, fontFamily: "DM_Sans_700Bold", fontSize: 14 }}>
            {formatNZD(totalCostLow ?? totalMid * 0.9)} – {formatNZD(totalCostHigh ?? totalMid * 1.1)}
          </Text>
        </View>
      </View>
      {costPerUnitAvg != null && (
        <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>
          Per unit average: {formatNZD(costPerUnitAvg)}
        </Text>
      )}
    </View>
  );
}

const CASE_CONFIGS: Record<"bear" | "base" | "bull", {
  label: string; emoji: string; color: string; bgKey: string; description: string;
}> = {
  bear: { label: "Bear", emoji: "🔻", color: "#EF4444", bgKey: "#EF444415", description: "−20% pricing" },
  base: { label: "Base", emoji: "📊", color: "#F59E0B", bgKey: "#F59E0B12", description: "Realistic" },
  bull: { label: "Bull", emoji: "📈", color: "#10B981", bgKey: "#10B98115", description: "+20% pricing" },
};

function InterestRateBanner({ outlook, colors }: {
  outlook?: "falling" | "stable" | "rising";
  colors: ReturnType<typeof useColors>;
}) {
  if (!outlook) return null;
  const configs = {
    falling: { text: "RBNZ OCR: FALLING 📉 — Bull case activated (rates cutting = property upside)", color: "#10B981", bg: "#10B98115" },
    stable:  { text: "RBNZ OCR: STABLE — Bear & Base cases shown (no rate cuts imminent)", color: "#F59E0B", bg: "#F59E0B12" },
    rising:  { text: "RBNZ OCR: RISING 📈 — Caution: rising rates compress margins", color: "#EF4444", bg: "#EF444415" },
  };
  const c = configs[outlook];
  return (
    <View style={{ backgroundColor: c.bg, borderRadius: 8, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: c.color + "40" }}>
      <Text style={{ color: c.color, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>{c.text}</Text>
    </View>
  );
}

function ROIScenarioCards({ scenarios, interestRateOutlook, comparablesQuality, colors }: {
  scenarios: ROIScenario[];
  interestRateOutlook?: "falling" | "stable" | "rising";
  comparablesQuality?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const outlook = interestRateOutlook ?? scenarios[0]?.interest_rate_outlook ?? "stable";
  const hasBull = outlook === "falling";

  const availableCases = (["bear", "base", ...(hasBull ? ["bull"] : [])] as Array<"bear" | "base" | "bull">);
  const [selectedCase, setSelectedCase] = useState<"bear" | "base" | "bull">("base");

  const scenario2yr = scenarios.find((s) => s.years === 2) ?? scenarios[0];
  const totalCostMid = safeNum(scenario2yr?.total_cost_mid ?? scenario2yr?.totalCost);

  const gdvPerLot = safeNum(scenario2yr?.gdv_per_lot);
  const sqmPerLot = safeNum(scenario2yr?.sqm_per_lot);
  const lots = safeNum(scenario2yr?.lots ?? 1, 1);

  return (
    <View style={{ gap: 10 }}>
      <InterestRateBanner outlook={outlook} colors={colors} />

      {gdvPerLot > 0 && sqmPerLot > 0 && (
        <View style={{ backgroundColor: colors.muted + "40", borderRadius: 8, padding: 10, gap: 4 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
            {lots} lot{lots > 1 ? "s" : ""} × {sqmPerLot}m² each · ~{formatNZD(gdvPerLot)} per lot (comparable-adjusted)
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
            Total development cost: {formatNZD(totalCostMid)}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 6 }}>
        {availableCases.map((c) => {
          const cfg = CASE_CONFIGS[c];
          const active = selectedCase === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => setSelectedCase(c)}
              style={{
                flex: 1, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 8,
                backgroundColor: active ? cfg.color + "20" : colors.card,
                borderWidth: active ? 2 : 1,
                borderColor: active ? cfg.color : colors.border,
                alignItems: "center", gap: 2,
              }}
            >
              <Text style={{ fontSize: 16 }}>{cfg.emoji}</Text>
              <Text style={{ color: active ? cfg.color : colors.mutedForeground, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
                {cfg.label}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 10 }}>
                {cfg.description}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 10, paddingBottom: 4 }}>
          {scenarios.map((s, i) => {
            const caseData: ROICaseResult | undefined = (s.cases ?? []).find((c) => c.case === selectedCase);
            const cfg = CASE_CONFIGS[selectedCase];

            const roi = caseData ? caseData.roi_percent : getScenarioRoi(s);
            const annualised = caseData ? caseData.annualised_roi_percent : getScenarioAnnualisedRoi(s);
            const profit = caseData ? caseData.gross_profit : getScenarioProfit(s);
            const gdv = caseData ? caseData.gdv : s.gdv;
            const viable = caseData ? caseData.viable : (s.viable !== false);
            const totalCost = getScenarioTotalCost(s);

            return (
              <View
                key={i}
                style={[
                  styles.roiCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: viable ? cfg.color + "60" : colors.red,
                    borderWidth: 1.5,
                  },
                ]}
              >
                {!viable && (
                  <View style={[styles.bestBadge, { backgroundColor: colors.red }]}>
                    <Text style={{ color: "#fff", fontFamily: "DM_Sans_700Bold", fontSize: 9 }}>RISK</Text>
                  </View>
                )}
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
                  {s.years}-Year exit
                </Text>
                <Text style={{ color: viable ? cfg.color : colors.red, fontFamily: "DM_Sans_700Bold", fontSize: 26, letterSpacing: -0.5, marginTop: 4 }}>
                  {isNaN(roi) ? "—" : roi.toFixed(1)}%
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, marginBottom: 8 }}>
                  ROI · {isNaN(annualised) ? "—" : annualised.toFixed(1)}% p.a.
                </Text>
                <View style={[styles.roiDivider, { backgroundColor: colors.border }]} />
                <View style={{ gap: 4, marginTop: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>GDV</Text>
                    <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>{formatNZD(gdv)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>Cost</Text>
                    <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", fontSize: 12 }}>{formatNZD(totalCost)}</Text>
                  </View>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>Profit</Text>
                    <Text style={{ color: profit >= 0 ? colors.success : colors.red, fontFamily: "DM_Sans_700Bold", fontSize: 12 }}>
                      {profit >= 0 ? "+" : ""}{formatNZD(Math.abs(profit))}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {comparablesQuality === "estimated" && (
        <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, fontStyle: "italic" }}>
          Comparable prices are suburb averages — live sale data will improve accuracy.
        </Text>
      )}
    </View>
  );
}

function ComparableSalesTable({ comparables, quality, colors }: {
  comparables: ComparableSale[];
  quality?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const prices = comparables.map(getSalePrice).filter((p) => p > 0);
  const avgPrice = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const psms = comparables.map(getSalePsm).filter((p) => p > 0);
  const avgPsm = psms.length > 0 ? psms.reduce((a, b) => a + b, 0) / psms.length : 0;

  return (
    <View style={{ gap: 10 }}>
      {quality === "estimated" && (
        <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
          <Feather name="info" size={13} color={colors.amber} />
          <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1 }}>
            Comparable data estimated from suburb averages. Live data will load once web scraping is active.
          </Text>
        </View>
      )}
      <View style={{ gap: 0 }}>
        <View style={[styles.tableHeader, { borderBottomColor: colors.border }]}>
          <Text style={[styles.tableHeaderCell, { color: colors.mutedForeground, flex: 3 }]}>Address</Text>
          <Text style={[styles.tableHeaderCell, { color: colors.mutedForeground, flex: 2, textAlign: "right" }]}>Price</Text>
          <Text style={[styles.tableHeaderCell, { color: colors.mutedForeground, flex: 2, textAlign: "right" }]}>$/m²</Text>
        </View>
        {comparables.map((c, i) => (
          <View
            key={i}
            style={[
              styles.tableRow,
              i < comparables.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
            ]}
          >
            <View style={{ flex: 3 }}>
              <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_500Medium", fontSize: 12 }} numberOfLines={1}>
                {c.address}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11 }}>
                {getSaleDate(c)}
              </Text>
            </View>
            <Text style={{ color: colors.success, fontFamily: "DM_Sans_700Bold", fontSize: 12, flex: 2, textAlign: "right" }}>
              {formatNZD(getSalePrice(c))}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 2, textAlign: "right" }}>
              ${Math.round(getSalePsm(c)).toLocaleString()}
            </Text>
          </View>
        ))}
        {avgPrice > 0 && (
          <View style={[styles.tableRow, { backgroundColor: colors.muted, borderRadius: 8 }]}>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_700Bold", fontSize: 12, flex: 3 }}>Average</Text>
            <Text style={{ color: colors.success, fontFamily: "DM_Sans_700Bold", fontSize: 12, flex: 2, textAlign: "right" }}>{formatNZD(avgPrice)}</Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold", fontSize: 12, flex: 2, textAlign: "right" }}>${Math.round(avgPsm).toLocaleString()}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function RiskSummaryPanel({ riskSummary, colors }: { riskSummary: string[]; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
        Generated by Gemini AI based on all available data
      </Text>
      <View style={{ gap: 8 }}>
        {riskSummary.map((r, i) => (
          <View key={i} style={{ flexDirection: "row", gap: 8, alignItems: "flex-start" }}>
            <Text style={{ fontSize: 14, marginTop: 1 }}>⚠️</Text>
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20, flex: 1 }}>{r}</Text>
          </View>
        ))}
      </View>
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: 11, fontStyle: "italic", lineHeight: 16, marginTop: 4 }}>
        These estimates are indicative only and based on available public data. Engage a licensed quantity surveyor, resource management consultant, and solicitor before making any development decision. Figures in NZD.
      </Text>
    </View>
  );
}

function FollowUpChips({ report, onChipClick, colors }: {
  report: Report;
  onChipClick: (msg: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  const zone = report.zone_label || report.planning?.zone || report.propertyOverview?.zone || "this zone";
  const lots = report.potential_lots || report.planning?.potentialLots || 0;

  const chips: string[] = [
    "What are the main development risks here?",
    "What building typology suits this zone?",
  ];

  const asbestosRisk = report.asbestos ? getAsbestosRisk(report.asbestos) : "unknown";
  if (report.asbestos && asbestosRisk === "high") {
    chips.push("What does the asbestos removal process involve?");
  }
  if (hasOverlay(report, "flood")) {
    chips.push("How does the flooding overlay affect consent?");
  }
  if (hasOverlay(report, "heritage")) {
    chips.push("What can I still build with a heritage overlay?");
  }
  if (safeNum(report.scores?.roi) < 2.5) {
    chips.push("How could the ROI be improved on this site?");
  }
  if (lots >= 3) {
    chips.push(`What are the consent steps for ${lots} lots?`);
  }
  chips.push("Find similar properties nearby with better scores");
  chips.push(`Explain the ${zone} rules in plain English`);

  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Ask a follow-up
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: "row", gap: 8, paddingBottom: 4 }}>
          {chips.map((chip, i) => (
            <TouchableOpacity
              key={i}
              style={[styles.chip, { backgroundColor: "#F0FDF4", borderColor: "#10B981" }]}
              onPress={() => onChipClick(chip)}
              activeOpacity={0.7}
            >
              <Text style={{ color: "#065F46", fontFamily: "DM_Sans_400Regular", fontSize: 13 }}>{chip}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export function FeasibilityReportCard({ report, onFollowUp }: Props) {
  const colors = useColors();

  const planningSection = overlayStatus(report);
  const asbestosStatus: "good" | "warning" | "risk" | "neutral" = report.asbestos
    ? (getAsbestosRisk(report.asbestos) === "high" ? "risk" : "good")
    : "neutral";

  return (
    <View style={styles.container}>
      <View style={[styles.reportHeader, { backgroundColor: colors.headerBg }]}>
        {report.photoUrl && (
          <View style={styles.reportPhotoWrapper}>
            <Image
              source={{ uri: report.photoUrl }}
              style={styles.reportPhoto}
              resizeMode="cover"
            />
            <View style={styles.reportPhotoOverlay} />
          </View>
        )}

        <View style={[styles.reportHeaderTop, report.photoUrl ? { paddingTop: 12 } : undefined]}>
          <View style={[styles.reportIcon, { backgroundColor: colors.accent }]}>
            <Feather name="map-pin" size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.address, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
              {report.address}
            </Text>
            <View style={styles.headerMeta}>
              {(report.zone_label || report.propertyOverview?.zone) && (
                <View style={[styles.zoneBadge, { backgroundColor: "rgba(250,250,249,0.15)" }]}>
                  <Text style={{ color: "rgba(250,250,249,0.85)", fontFamily: "DM_Sans_500Medium", fontSize: 11 }}>
                    {(report.zone_label || report.propertyOverview?.zone || "").split("–")[0].trim().split(" ").slice(0, 3).join(" ")}
                  </Text>
                </View>
              )}
              {report.propertyOverview?.cv && (
                <Text style={{ color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
                  CV {report.propertyOverview.cv}
                </Text>
              )}
              {report.propertyOverview?.landArea && (
                <Text style={{ color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
                  · {report.propertyOverview.landArea}
                </Text>
              )}
              {(report.potential_lots || report.planning?.potentialLots) && (
                <Text style={{ color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular", fontSize: 12 }}>
                  · {report.potential_lots || report.planning?.potentialLots} lots
                </Text>
              )}
            </View>
          </View>
        </View>

        {report.overlay_map_image_base64 && (
          <View style={styles.overlayMapWrapper}>
            <Image
              source={{ uri: `data:image/png;base64,${report.overlay_map_image_base64}` }}
              style={styles.overlayMapImage}
              resizeMode="cover"
            />
            <View style={styles.overlayMapFooter}>
              <View style={styles.overlayMapLabelRow}>
                <Feather name="layers" size={11} color="rgba(250,249,246,0.7)" />
                <Text style={styles.overlayMapLabel}>Planning overlay map (via Hougarden)</Text>
              </View>
            </View>
          </View>
        )}

        <ScoreSummaryRow report={report} colors={colors} />
      </View>

      {(report.cv_unavailable || (report.missing_critical_fields && report.missing_critical_fields.length > 0)) && (
        <View style={[styles.warningBox, { backgroundColor: "#FEF08A20", borderColor: "#CA8A0450", borderRadius: 12, padding: 12 }]}>
          <Feather name="alert-triangle" size={14} color="#CA8A04" />
          <View style={{ flex: 1 }}>
            <Text style={{ color: "#92400E", fontFamily: "DM_Sans_600SemiBold", fontSize: 13 }}>
              Some property data could not be retrieved automatically
            </Text>
            <Text style={{ color: "#92400E", fontFamily: "DM_Sans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 3 }}>
              CV and land area affect ROI accuracy — verify manually at aucklandcouncil.govt.nz
            </Text>
          </View>
        </View>
      )}

      {report.propertyOverview && (
        <SectionCard title="Property overview" icon="📍" defaultOpen={false} colors={colors}>
          <InfoRow
            label="Capital Value"
            value={report.propertyOverview.cv || "Unavailable"}
            valueColor={!report.propertyOverview.cv ? colors.amber : undefined}
            colors={colors}
          />
          <InfoRow
            label="Land Area"
            value={report.propertyOverview.landArea || "Unavailable"}
            valueColor={!report.propertyOverview.landArea ? colors.amber : undefined}
            colors={colors}
          />
          {report.propertyOverview.floorArea && (
            <View>
              <InfoRow label="Floor Area" value={report.propertyOverview.floorArea} colors={colors} />
            </View>
          )}
          <InfoRow label="Build Year" value={report.propertyOverview.buildYear || "N/A"} colors={colors} />
          <InfoRow label="Zone" value={report.propertyOverview.zone || "N/A"} colors={colors} />
          {report.planning?.potentialLots != null && (
            <InfoRow label="Potential Lots" value={String(report.planning.potentialLots)} valueColor={colors.success} colors={colors} />
          )}
          {report.propertyOverview.isOnMarket && report.propertyOverview.listingPrice && (
            <InfoRow label="Listing Price" value={report.propertyOverview.listingPrice} valueColor={colors.success} colors={colors} />
          )}
        </SectionCard>
      )}

      {report.planning?.overlays && (
        <SectionCard title="Planning & overlays" icon="🏛" status={planningSection} colors={colors}>
          {report.planning.subdivisionSummary && (
            <Text style={{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 20, marginBottom: 10 }}>
              {report.planning.subdivisionSummary}
            </Text>
          )}
          <OverlayChecklist overlays={report.planning.overlays} colors={colors} />
        </SectionCard>
      )}

      {report.planning && (
        <SectionCard
          title="Easements & Rights of Way"
          icon="⚖️"
          status={
            (report.planning.easements && report.planning.easements.length > 0)
              ? (report.planning.easements.some((e) => e.severity === "significant") ? "risk" : "warning")
              : (report.planning.easement_data_status === "api_error" || report.planning.easement_data_status === "no_title")
                ? "warning"
                : "neutral"
          }
          colors={colors}
        >
          <EasementList
            easements={report.planning.easements}
            appurtenant={report.planning.appurtenant_easements}
            summary={report.planning.easement_summary}
            lotImpact={report.planning.lot_impact_note}
            grossArea={report.planning.grossAreaSqm}
            netArea={report.planning.netAreaSqm}
            easementArea={report.planning.easementAreaSqm}
            dataStatus={report.planning.easement_data_status}
            colors={colors}
          />
        </SectionCard>
      )}

      {report.asbestos && (
        <SectionCard title="Asbestos & demolition" icon="⚠" status={asbestosStatus as any} colors={colors}>
          <AsbestosPanel asbestos={report.asbestos} colors={colors} />
        </SectionCard>
      )}

      {report.terrain && (
        <SectionCard title="Terrain & contour" icon="⛰" status={contourStatus(report.terrain)} colors={colors}>
          <ContourCard report={report} terrain={report.terrain} colors={colors} />
        </SectionCard>
      )}

      {report.infrastructure && report.infrastructure.length > 0 && (
        <SectionCard title="Infrastructure & services" icon="🔧" status={infraStatus(report.infrastructure)} colors={colors}>
          <InfrastructureTable infrastructure={report.infrastructure} colors={colors} />
        </SectionCard>
      )}

      {report.costItems && report.costItems.length > 0 && (
        <SectionCard title="Development cost estimate" icon="💰" status="neutral" colors={colors}>
          <CostBreakdownChart
            costItems={report.costItems}
            totalCostLow={report.totalCostLow}
            totalCostHigh={report.totalCostHigh}
            costPerUnitAvg={report.cost_per_unit_avg}
            colors={colors}
          />
        </SectionCard>
      )}

      {report.roiScenarios && report.roiScenarios.length > 0 && (
        <SectionCard title="ROI scenarios" icon="📈" status={roiStatus(safeNum(report.scores?.roi))} colors={colors}>
          {(report.cv_unavailable || report.roiScenarios[0]?.cv_unavailable) && (
            <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30", marginBottom: 10 }]}>
              <Feather name="alert-triangle" size={13} color={colors.amber} />
              <Text style={{ color: colors.amber, fontFamily: "DM_Sans_400Regular", fontSize: 12, flex: 1, lineHeight: 17 }}>
                Cannot calculate accurate ROI — CV data unavailable. Land cost is excluded from these totals. Verify CV at aucklandcouncil.govt.nz before relying on these figures.
              </Text>
            </View>
          )}
          <ROIScenarioCards
            scenarios={report.roiScenarios}
            interestRateOutlook={report.interest_rate_outlook ?? report.roiScenarios[0]?.interest_rate_outlook}
            comparablesQuality={report.comparables_quality}
            colors={colors}
          />
        </SectionCard>
      )}

      {report.comparableSales && report.comparableSales.length > 0 && (
        <SectionCard title="Comparable sales" icon="🏘" status="neutral" defaultOpen={false} colors={colors}>
          <ComparableSalesTable
            comparables={report.comparableSales}
            quality={report.comparables_quality}
            colors={colors}
          />
        </SectionCard>
      )}

      {report.riskSummary && report.riskSummary.length > 0 && (
        <SectionCard title="AI risk assessment" icon="🤖" status="neutral" colors={colors}>
          <RiskSummaryPanel riskSummary={report.riskSummary} colors={colors} />
        </SectionCard>
      )}

      <FollowUpChips report={report} onChipClick={onFollowUp} colors={colors} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  reportHeader: { borderRadius: 16, overflow: "hidden" },
  reportHeaderTop: { flexDirection: "row", gap: 12, padding: 16, alignItems: "flex-start" },
  reportPhotoWrapper: { width: "100%", height: 180, position: "relative" },
  reportPhoto: { width: "100%", height: 180 },
  reportPhotoOverlay: { position: "absolute", bottom: 0, left: 0, right: 0, height: 80, backgroundColor: "transparent" },
  reportIcon: { width: 32, height: 32, borderRadius: 8, justifyContent: "center", alignItems: "center", flexShrink: 0, marginTop: 2 },
  address: { fontSize: 16, lineHeight: 22, letterSpacing: -0.2 },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" },
  zoneBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },
  scoresSection: { paddingBottom: 16 },
  overallRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", paddingHorizontal: 18, paddingTop: 16, paddingBottom: 10, gap: 8 },
  overallLabel: { fontFamily: "DM_Sans_400Regular", fontSize: 10, textTransform: "uppercase", letterSpacing: 1.2 },
  overallBadge: { flexDirection: "row", alignItems: "baseline", gap: 3, borderRadius: 16, borderWidth: 1.5, paddingHorizontal: 16, paddingVertical: 8 },
  overallNumber: { fontFamily: "DM_Sans_700Bold", fontSize: 44, lineHeight: 48 },
  overallSubLabel: { fontFamily: "DM_Sans_500Medium", fontSize: 16, lineHeight: 22, marginBottom: 2 },
  scoresRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 14, paddingHorizontal: 12 },
  scoreDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  reasonsRow: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, paddingHorizontal: 16, gap: 16 },
  reasonBlock: { flex: 1, gap: 3 },
  reasonTitle: { fontFamily: "DM_Sans_600SemiBold", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7 },
  reasonText: { fontFamily: "DM_Sans_400Regular", fontSize: 11, lineHeight: 16 },
  sectionCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden", shadowColor: "rgba(28,25,23,0.04)", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 1, shadowRadius: 4, elevation: 1 },
  sectionHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  sectionIcon: { fontSize: 15 },
  sectionTitle: { fontSize: 14 },
  sectionBody: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  infoLabel: { fontSize: 13, flex: 1 },
  infoValue: { fontSize: 13, textAlign: "right", flex: 1 },
  overlayRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10 },
  riskBanner: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderWidth: 1 },
  warningBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  infraRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, gap: 6 },
  locationChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 100, borderWidth: 1 },
  costBar: { height: 14, flexDirection: "row", borderRadius: 7, overflow: "hidden" },
  costBarSegment: { height: 14 },
  costLegend: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  costLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  costLegendDot: { width: 8, height: 8, borderRadius: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", padding: 12, marginTop: 6 },
  roiCard: { width: 168, borderRadius: 14, padding: 14, position: "relative" },
  bestBadge: { position: "absolute", top: 10, right: 10, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  roiDivider: { height: 1, marginVertical: 2 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  tableHeader: { flexDirection: "row", paddingBottom: 6, borderBottomWidth: 1 },
  tableHeaderCell: { fontFamily: "DM_Sans_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3 },
  tableRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, gap: 4 },
  overlayMapWrapper: { width: "100%", height: 200 },
  overlayMapImage: { width: "100%", height: 200 },
  overlayMapFooter: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "rgba(0,0,0,0.45)" },
  overlayMapLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  overlayMapLabel: { color: "rgba(250,249,246,0.85)", fontFamily: "DM_Sans_500Medium", fontSize: 11 },
  overlayMapSource: { color: "rgba(250,249,246,0.45)", fontFamily: "DM_Sans_400Regular", fontSize: 10 },
});
