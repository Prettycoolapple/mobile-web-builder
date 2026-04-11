import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { FeasibilityReport as Report, ROIScenario, CostItem } from "@/context/ChatContext";
import { ScoreBadge } from "./ScoreBadge";
import { OverlayChip } from "./OverlayChip";

interface Props {
  report: Report;
  onFollowUp: (question: string) => void;
}

function formatNZD(amount: number): string {
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${Math.round(amount / 1_000)}k`;
  }
  return `$${amount.toLocaleString()}`;
}

function SectionCard({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => setOpen(!open)}
        activeOpacity={0.7}
      >
        <Text style={styles.sectionIcon}>{icon}</Text>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
          {title}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={15}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>
      {open && <View style={[styles.sectionBody, { borderTopColor: colors.border }]}>{children}</View>}
    </View>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
        {label}
      </Text>
      <Text style={[styles.infoValue, { color: valueColor || colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
        {value}
      </Text>
    </View>
  );
}

function CostBar({ items, total }: { items: CostItem[]; total: number }) {
  const colors = useColors();
  const barColors = [
    colors.accent, colors.success, "#7C6AF7", colors.amber, "#E46899", "#9B72E8", "#3BB8CF",
  ];

  return (
    <View style={styles.costBarContainer}>
      <View style={[styles.costBar, { backgroundColor: colors.muted }]}>
        {items.map((item, idx) => {
          const pct = ((item.low + item.high) / 2 / total) * 100;
          return (
            <View
              key={item.label}
              style={[styles.costBarSegment, { width: `${pct}%`, backgroundColor: barColors[idx % barColors.length] }]}
            />
          );
        })}
      </View>
      <View style={styles.costLegend}>
        {items.map((item, idx) => (
          <View key={item.label} style={styles.costLegendItem}>
            <View style={[styles.costLegendDot, { backgroundColor: barColors[idx % barColors.length] }]} />
            <Text style={[styles.costLegendLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ROICard({ scenario }: { scenario: ROIScenario }) {
  const colors = useColors();
  const isBest = scenario.isBest;

  return (
    <View
      style={[
        styles.roiCard,
        {
          backgroundColor: isBest ? colors.accent : colors.card,
          borderColor: isBest ? colors.accent : colors.border,
        },
      ]}
    >
      {isBest && (
        <View style={[styles.bestBadge, { backgroundColor: "rgba(255,255,255,0.25)" }]}>
          <Text style={[styles.bestBadgeText, { fontFamily: "DM_Sans_700Bold" }]}>
            BEST
          </Text>
        </View>
      )}
      <Text style={[styles.roiYears, {
        color: isBest ? "rgba(255,255,255,0.7)" : colors.mutedForeground,
        fontFamily: "DM_Sans_400Regular",
      }]}>
        {scenario.years} years
      </Text>
      <Text style={[styles.roiPercent, {
        color: isBest ? "#fff" : colors.accent,
        fontFamily: "DM_Sans_700Bold",
      }]}>
        {scenario.annualisedRoi.toFixed(1)}%
      </Text>
      <Text style={[styles.roiLabel, {
        color: isBest ? "rgba(255,255,255,0.6)" : colors.mutedForeground,
        fontFamily: "DM_Sans_400Regular",
      }]}>
        p.a. return
      </Text>
      <View style={[styles.roiDivider, { backgroundColor: isBest ? "rgba(255,255,255,0.2)" : colors.border }]} />
      <Text style={[styles.roiGdv, {
        color: isBest ? "rgba(255,255,255,0.8)" : colors.mutedForeground,
        fontFamily: "DM_Sans_400Regular",
      }]}>
        GDV {formatNZD(scenario.gdv)}
      </Text>
      <Text style={[styles.roiProfit, {
        color: isBest ? "#fff" : colors.foreground,
        fontFamily: "DM_Sans_600SemiBold",
      }]}>
        {formatNZD(scenario.grossProfit)} profit
      </Text>
    </View>
  );
}

const FOLLOW_UPS = [
  "What are the main risks?",
  "What building typology suits this zone?",
  "Tell me more about the flood overlay",
  "Show me the 3yr ROI in detail",
];

export function FeasibilityReportCard({ report, onFollowUp }: Props) {
  const colors = useColors();

  const compositeColor =
    report.scores.composite >= 4
      ? colors.success
      : report.scores.composite >= 2.5
        ? colors.amber
        : colors.red;

  return (
    <View style={styles.container}>
      <View style={[styles.reportHeader, { backgroundColor: colors.headerBg }]}>
        <View style={[styles.reportHeaderTop]}>
          <View style={[styles.reportIcon, { backgroundColor: colors.accent }]}>
            <Feather name="map-pin" size={14} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.address, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
              {report.address}
            </Text>
            {report.propertyOverview && (
              <View style={styles.headerMeta}>
                {report.propertyOverview.zone && (
                  <View style={[styles.zoneBadge, { backgroundColor: "rgba(250,250,249,0.15)" }]}>
                    <Text style={[styles.zoneBadgeText, { color: "rgba(250,250,249,0.85)", fontFamily: "DM_Sans_500Medium" }]}>
                      {report.propertyOverview.zone.split(" ")[0]}
                    </Text>
                  </View>
                )}
                {report.propertyOverview.cv && (
                  <Text style={[styles.headerMetaText, { color: colors.headerSubtext }]}>
                    CV {report.propertyOverview.cv}
                  </Text>
                )}
                {report.propertyOverview.landArea && (
                  <Text style={[styles.headerMetaText, { color: colors.headerSubtext }]}>
                    · {report.propertyOverview.landArea}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        <View style={[styles.scoresRow, { borderTopColor: "rgba(250,250,249,0.1)" }]}>
          <ScoreBadge score={report.scores.ease} label="Ease" size={64} />
          <View style={styles.compositeContainer}>
            <Text style={[styles.compositeScore, { color: compositeColor, fontFamily: "DM_Sans_700Bold" }]}>
              {report.scores.composite.toFixed(1)}
            </Text>
            <Text style={[styles.compositeLabel, { color: colors.headerSubtext, fontFamily: "DM_Sans_400Regular" }]}>
              Overall
            </Text>
          </View>
          <ScoreBadge score={report.scores.cost} label="Cost" size={64} />
          <ScoreBadge score={report.scores.roi} label="ROI" size={64} />
        </View>
      </View>

      {report.propertyOverview && (
        <SectionCard title="Property Overview" icon="📍">
          <InfoRow label="Capital Value" value={report.propertyOverview.cv || "N/A"} />
          <InfoRow label="Land Area" value={report.propertyOverview.landArea || "N/A"} />
          {report.propertyOverview.floorArea && (
            <InfoRow label="Floor Area" value={report.propertyOverview.floorArea} />
          )}
          <InfoRow label="Build Year" value={report.propertyOverview.buildYear || "N/A"} />
          <InfoRow label="Zone" value={report.propertyOverview.zone || "N/A"} />
          {report.propertyOverview.isOnMarket && report.propertyOverview.listingPrice && (
            <InfoRow
              label="Listing Price"
              value={report.propertyOverview.listingPrice}
              valueColor={colors.success}
            />
          )}
        </SectionCard>
      )}

      {report.planning && (
        <SectionCard title="Planning & Overlays" icon="🏗️">
          {report.planning.subdivisionSummary && (
            <Text style={[styles.planningText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
              {report.planning.subdivisionSummary}
            </Text>
          )}
          {report.planning.overlays && report.planning.overlays.length > 0 && (
            <View style={[styles.overlaysContainer, { borderTopColor: colors.border }]}>
              {report.planning.overlays.map((overlay, i) => (
                <View
                  key={i}
                  style={[
                    styles.overlayItem,
                    i < report.planning!.overlays!.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <OverlayChip
                    name={overlay.name}
                    status={overlay.status}
                    detail={overlay.detail}
                  />
                </View>
              ))}
            </View>
          )}
        </SectionCard>
      )}

      {report.asbestos && (
        <SectionCard title="Asbestos & Demolition" icon="⚠️">
          <InfoRow
            label="Risk Level"
            value={report.asbestos.riskLevel.charAt(0).toUpperCase() + report.asbestos.riskLevel.slice(1)}
            valueColor={
              report.asbestos.riskLevel === "high"
                ? colors.red
                : report.asbestos.riskLevel === "moderate"
                  ? colors.amber
                  : colors.success
            }
          />
          {report.asbestos.demoCostLow && report.asbestos.demoCostHigh && (
            <InfoRow
              label="Demo Cost Est."
              value={`${formatNZD(report.asbestos.demoCostLow)} – ${formatNZD(report.asbestos.demoCostHigh)}`}
            />
          )}
          {report.asbestos.flagged && report.asbestos.worksafeNote && (
            <View style={[styles.warningBox, { backgroundColor: colors.amber + "12", borderColor: colors.amber + "30" }]}>
              <Feather name="alert-triangle" size={14} color={colors.amber} />
              <Text style={[styles.warningText, { color: colors.amber, fontFamily: "DM_Sans_500Medium" }]}>
                {report.asbestos.worksafeNote}
              </Text>
            </View>
          )}
        </SectionCard>
      )}

      {report.terrain && (
        <SectionCard title="Terrain & Contour" icon="📐">
          <InfoRow
            label="Classification"
            value={report.terrain.classification.charAt(0).toUpperCase() + report.terrain.classification.slice(1)}
            valueColor={
              report.terrain.classification === "steep"
                ? colors.red
                : report.terrain.classification === "moderate"
                  ? colors.amber
                  : colors.success
            }
          />
          {report.terrain.slope && <InfoRow label="Slope" value={report.terrain.slope} />}
          {report.terrain.retainingCostLow !== undefined && report.terrain.retainingCostHigh !== undefined && (
            <InfoRow
              label="Retaining Cost"
              value={
                report.terrain.retainingCostLow === 0
                  ? "No additional cost"
                  : `${formatNZD(report.terrain.retainingCostLow)} – ${formatNZD(report.terrain.retainingCostHigh)}`
              }
            />
          )}
        </SectionCard>
      )}

      {report.infrastructure && report.infrastructure.length > 0 && (
        <SectionCard title="Infrastructure" icon="🔧">
          {report.infrastructure.map((service, i) => (
            <View
              key={i}
              style={[
                styles.infraRow,
                i < report.infrastructure!.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: colors.border,
                },
              ]}
            >
              <View style={styles.infraLeft}>
                <Text style={[styles.infraName, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                  {service.name}
                </Text>
                <Text style={[styles.infraLocation, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  {service.location === "on-parcel" ? "On parcel" : service.location === "boundary" ? "At boundary" : "Off parcel"}
                </Text>
                {service.note && (
                  <Text style={[styles.infraNote, { color: colors.amber, fontFamily: "DM_Sans_400Regular" }]}>
                    {service.note}
                  </Text>
                )}
              </View>
              <View style={styles.infraRight}>
                <View style={[styles.riskBadge, {
                  backgroundColor:
                    service.risk === "high" ? colors.red + "15" :
                    service.risk === "moderate" ? colors.amber + "15" : colors.success + "15",
                  borderColor:
                    service.risk === "high" ? colors.red + "40" :
                    service.risk === "moderate" ? colors.amber + "40" : colors.success + "40",
                }]}>
                  <Text style={[styles.riskText, {
                    color:
                      service.risk === "high" ? colors.red :
                      service.risk === "moderate" ? colors.amber : colors.success,
                    fontFamily: "DM_Sans_600SemiBold",
                  }]}>
                    {service.risk.charAt(0).toUpperCase() + service.risk.slice(1)}
                  </Text>
                </View>
                {service.estimatedCostLow !== undefined && service.estimatedCostHigh !== undefined && (
                  <Text style={[styles.infraCost, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {formatNZD(service.estimatedCostLow)}–{formatNZD(service.estimatedCostHigh)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </SectionCard>
      )}

      {report.costItems && report.costItems.length > 0 && (
        <SectionCard title="Cost Estimate" icon="💰">
          <CostBar
            items={report.costItems}
            total={(report.totalCostLow || 0 + (report.totalCostHigh || 0)) / 2 || report.costItems.reduce((s, i) => s + (i.low + i.high) / 2, 0)}
          />
          {report.costItems.map((item, i) => (
            <View key={i} style={[styles.costRow, i < report.costItems!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
              <Text style={[styles.costLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {item.label}
              </Text>
              <Text style={[styles.costValue, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                {formatNZD(item.low)} – {formatNZD(item.high)}
              </Text>
            </View>
          ))}
          {report.totalCostLow !== undefined && report.totalCostHigh !== undefined && (
            <View style={[styles.totalRow, { backgroundColor: colors.muted, borderRadius: 10 }]}>
              <Text style={[styles.totalLabel, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                Total Estimate
              </Text>
              <Text style={[styles.totalValue, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
                {formatNZD(report.totalCostLow)} – {formatNZD(report.totalCostHigh)}
              </Text>
            </View>
          )}
          <Text style={[styles.disclaimer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {report.disclaimer || "Indicative estimates only. Engage a quantity surveyor for accurate figures."}
          </Text>
        </SectionCard>
      )}

      {report.roiScenarios && report.roiScenarios.length > 0 && (
        <SectionCard title="ROI Scenarios" icon="📈">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.roiScroll}>
            <View style={styles.roiRow}>
              {report.roiScenarios.map((scenario) => (
                <ROICard key={scenario.years} scenario={scenario} />
              ))}
            </View>
          </ScrollView>
        </SectionCard>
      )}

      {report.comparableSales && report.comparableSales.length > 0 && (
        <SectionCard title="Comparable Sales" icon="🔍" defaultOpen={false}>
          {report.avgPricePerSqm && (
            <InfoRow
              label="Avg $/m² (GDV basis)"
              value={`$${Math.round(report.avgPricePerSqm).toLocaleString()}/m²`}
              valueColor={colors.success}
            />
          )}
          {report.comparableSales.map((sale, i) => (
            <View key={i} style={[styles.saleRow, i < report.comparableSales!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}>
              <Text style={[styles.saleAddress, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
                {sale.address}
              </Text>
              <View style={styles.saleMeta}>
                <Text style={[styles.saleDate, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  {sale.saleDate}
                </Text>
                <Text style={[styles.salePrice, { color: colors.success, fontFamily: "DM_Sans_700Bold" }]}>
                  {formatNZD(sale.price)}
                </Text>
                <Text style={[styles.saleSqm, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  ${Math.round(sale.pricePerSqm).toLocaleString()}/m²
                </Text>
              </View>
            </View>
          ))}
        </SectionCard>
      )}

      {report.riskSummary && report.riskSummary.length > 0 && (
        <SectionCard title="AI Risk Summary" icon="💬">
          {report.riskSummary.map((risk, i) => (
            <View key={i} style={[styles.riskItem, { borderBottomColor: colors.border }, i < report.riskSummary!.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <View style={[styles.riskDot, { backgroundColor: colors.amber }]} />
              <Text style={[styles.riskItemText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
                {risk}
              </Text>
            </View>
          ))}
        </SectionCard>
      )}

      <View style={[styles.followUpsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.followUpsTitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
          Ask a follow-up
        </Text>
        <View style={styles.followUpsGrid}>
          {FOLLOW_UPS.map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.followUpChip, { backgroundColor: colors.muted, borderColor: colors.border }]}
              onPress={() => onFollowUp(q)}
              activeOpacity={0.7}
            >
              <Text style={[styles.followUpText, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
                {q}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 8,
  },
  reportHeader: {
    borderRadius: 16,
    overflow: "hidden",
  },
  reportHeaderTop: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    alignItems: "flex-start",
  },
  reportIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  address: {
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 5,
    flexWrap: "wrap",
  },
  zoneBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  zoneBadgeText: {
    fontSize: 11,
  },
  headerMetaText: {
    fontSize: 12,
    fontFamily: "DM_Sans_400Regular",
  },
  scoresRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  compositeContainer: {
    alignItems: "center",
    gap: 2,
  },
  compositeScore: {
    fontSize: 36,
    letterSpacing: -1,
  },
  compositeLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(28,25,23,0.04)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 8,
  },
  sectionIcon: {
    fontSize: 15,
  },
  sectionTitle: {
    fontSize: 14,
    flex: 1,
  },
  sectionBody: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 4,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    fontSize: 13,
    flex: 1,
  },
  infoValue: {
    fontSize: 13,
    textAlign: "right",
    flex: 1,
  },
  planningText: {
    fontSize: 13,
    lineHeight: 20,
    paddingTop: 8,
    paddingBottom: 4,
  },
  overlaysContainer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  overlayItem: {
    paddingHorizontal: 0,
  },
  warningBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: 8,
  },
  warningText: {
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  infraRow: {
    flexDirection: "row",
    paddingVertical: 12,
    gap: 10,
  },
  infraLeft: {
    flex: 1,
    gap: 3,
  },
  infraName: {
    fontSize: 13,
  },
  infraLocation: {
    fontSize: 12,
  },
  infraNote: {
    fontSize: 11,
    marginTop: 2,
  },
  infraRight: {
    alignItems: "flex-end",
    gap: 5,
    justifyContent: "center",
  },
  riskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: 1,
  },
  riskText: {
    fontSize: 11,
  },
  infraCost: {
    fontSize: 12,
  },
  costBarContainer: {
    gap: 10,
    marginTop: 8,
    marginBottom: 12,
  },
  costBar: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    flexDirection: "row",
  },
  costBarSegment: {
    height: "100%",
  },
  costLegend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  costLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  costLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  costLegendLabel: {
    fontSize: 10,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
  },
  costLabel: {
    fontSize: 13,
    flex: 1,
  },
  costValue: {
    fontSize: 13,
    textAlign: "right",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 13,
  },
  totalValue: {
    fontSize: 15,
  },
  disclaimer: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    fontStyle: "italic",
  },
  roiScroll: {
    marginTop: 4,
  },
  roiRow: {
    flexDirection: "row",
    gap: 10,
    paddingBottom: 4,
  },
  roiCard: {
    width: 150,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 3,
    shadowColor: "rgba(28,25,23,0.05)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 2,
  },
  bestBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 100,
    marginBottom: 6,
  },
  bestBadgeText: {
    fontSize: 9,
    color: "#fff",
    letterSpacing: 0.8,
  },
  roiYears: {
    fontSize: 11,
    marginBottom: 2,
  },
  roiPercent: {
    fontSize: 30,
    letterSpacing: -1,
  },
  roiLabel: {
    fontSize: 11,
    marginBottom: 8,
  },
  roiDivider: {
    height: 1,
    marginVertical: 6,
  },
  roiGdv: {
    fontSize: 11,
  },
  roiProfit: {
    fontSize: 13,
  },
  saleRow: {
    paddingVertical: 10,
    gap: 4,
  },
  saleAddress: {
    fontSize: 13,
  },
  saleMeta: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  saleDate: {
    fontSize: 11,
    flex: 1,
  },
  salePrice: {
    fontSize: 13,
  },
  saleSqm: {
    fontSize: 11,
  },
  riskItem: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    alignItems: "flex-start",
  },
  riskDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    flexShrink: 0,
  },
  riskItemText: {
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  followUpsContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    shadowColor: "rgba(28,25,23,0.04)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 1,
  },
  followUpsTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  followUpsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  followUpChip: {
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  followUpText: {
    fontSize: 13,
  },
});
