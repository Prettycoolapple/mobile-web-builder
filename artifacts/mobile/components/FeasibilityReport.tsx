import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
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
        <Text style={[styles.sectionIcon]}>{icon}</Text>
        <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          {title}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </View>
  );
}

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {label}
      </Text>
      <Text style={[styles.infoValue, { color: valueColor || colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
        {value}
      </Text>
    </View>
  );
}

function CostBar({ items, total }: { items: CostItem[]; total: number }) {
  const colors = useColors();
  const barColors = [
    colors.navy, colors.emerald, "#6366F1", colors.amber, "#EC4899", "#8B5CF6", "#06B6D4",
  ];

  return (
    <View style={styles.costBarContainer}>
      <View style={styles.costBar}>
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
            <Text style={[styles.costLegendLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
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
          backgroundColor: isBest ? colors.emerald : colors.card,
          borderColor: isBest ? colors.emerald : colors.border,
        },
      ]}
    >
      {isBest && (
        <View style={[styles.bestBadge, { backgroundColor: colors.card }]}>
          <Text style={[styles.bestBadgeText, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>
            BEST
          </Text>
        </View>
      )}
      <Text style={[styles.roiYears, { color: isBest ? "#fff" : colors.foreground, fontFamily: "Inter_700Bold" }]}>
        {scenario.years}yr
      </Text>
      <Text style={[styles.roiPercent, { color: isBest ? "#fff" : colors.emerald, fontFamily: "Inter_700Bold" }]}>
        {scenario.annualisedRoi.toFixed(1)}%
      </Text>
      <Text style={[styles.roiLabel, { color: isBest ? "rgba(255,255,255,0.8)" : colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        p.a. ROI
      </Text>
      <View style={[styles.roiDivider, { backgroundColor: isBest ? "rgba(255,255,255,0.3)" : colors.border }]} />
      <Text style={[styles.roiGdv, { color: isBest ? "rgba(255,255,255,0.9)" : colors.foreground, fontFamily: "Inter_500Medium" }]}>
        GDV {formatNZD(scenario.gdv)}
      </Text>
      <Text style={[styles.roiProfit, { color: isBest ? "rgba(255,255,255,0.9)" : colors.emerald, fontFamily: "Inter_600SemiBold" }]}>
        Profit {formatNZD(scenario.grossProfit)}
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
      ? colors.emerald
      : report.scores.composite >= 2.5
        ? colors.amber
        : colors.red;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.navy }]}>
        <Text style={[styles.address, { fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
          {report.address}
        </Text>
        {report.propertyOverview && (
          <View style={styles.headerMeta}>
            {report.propertyOverview.zone && (
              <View style={[styles.zoneBadge, { backgroundColor: colors.emerald + "30", borderColor: colors.emerald }]}>
                <Text style={[styles.zoneBadgeText, { color: colors.emerald, fontFamily: "Inter_600SemiBold" }]}>
                  {report.propertyOverview.zone.split(" ")[0]}
                </Text>
              </View>
            )}
            {report.propertyOverview.cv && (
              <Text style={[styles.cvText, { color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" }]}>
                CV {report.propertyOverview.cv}
              </Text>
            )}
            {report.propertyOverview.landArea && (
              <Text style={[styles.cvText, { color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" }]}>
                {report.propertyOverview.landArea}
              </Text>
            )}
          </View>
        )}
      </View>

      <View style={[styles.scoresRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ScoreBadge score={report.scores.ease} label="Ease" size={68} />
        <View style={styles.compositeContainer}>
          <Text style={[styles.compositeScore, { color: compositeColor, fontFamily: "Inter_700Bold" }]}>
            {report.scores.composite.toFixed(1)}
          </Text>
          <Text style={[styles.compositeLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Overall
          </Text>
        </View>
        <ScoreBadge score={report.scores.cost} label="Cost" size={68} />
        <ScoreBadge score={report.scores.roi} label="ROI" size={68} />
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
              valueColor={colors.emerald}
            />
          )}
        </SectionCard>
      )}

      {report.planning && (
        <SectionCard title="Planning & Overlays" icon="🏗️">
          {report.planning.subdivisionSummary && (
            <Text style={[styles.planningText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
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
                      borderBottomWidth: 1,
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
                  : colors.emerald
            }
          />
          {report.asbestos.demoCostLow && report.asbestos.demoCostHigh && (
            <InfoRow
              label="Demo Cost Est."
              value={`${formatNZD(report.asbestos.demoCostLow)} – ${formatNZD(report.asbestos.demoCostHigh)}`}
            />
          )}
          {report.asbestos.flagged && report.asbestos.worksafeNote && (
            <View style={[styles.warningBox, { backgroundColor: colors.amber + "18", borderColor: colors.amber + "40" }]}>
              <Text style={[styles.warningText, { color: colors.amber, fontFamily: "Inter_500Medium" }]}>
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
                  : colors.emerald
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
                { borderBottomColor: colors.border },
                i < report.infrastructure!.length - 1 && { borderBottomWidth: 1 },
              ]}
            >
              <View style={styles.infraLeft}>
                <Text style={[styles.infraName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {service.name}
                </Text>
                <Text style={[styles.infraLocation, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {service.location === "on-parcel" ? "On parcel" : service.location === "boundary" ? "At boundary" : "Off parcel"}
                </Text>
                {service.note && (
                  <Text style={[styles.infraNote, { color: colors.amber, fontFamily: "Inter_400Regular" }]}>
                    {service.note}
                  </Text>
                )}
              </View>
              <View style={styles.infraRight}>
                <View style={[styles.riskBadge, {
                  backgroundColor:
                    service.risk === "high" ? colors.red + "20" :
                    service.risk === "moderate" ? colors.amber + "20" : colors.emerald + "20",
                  borderColor:
                    service.risk === "high" ? colors.red :
                    service.risk === "moderate" ? colors.amber : colors.emerald,
                }]}>
                  <Text style={[styles.riskText, {
                    color:
                      service.risk === "high" ? colors.red :
                      service.risk === "moderate" ? colors.amber : colors.emerald,
                    fontFamily: "Inter_600SemiBold",
                  }]}>
                    {service.risk.toUpperCase()}
                  </Text>
                </View>
                {service.estimatedCostLow !== undefined && service.estimatedCostHigh !== undefined && (
                  <Text style={[styles.infraCost, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                    {formatNZD(service.estimatedCostLow)}–{formatNZD(service.estimatedCostHigh)}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </SectionCard>
      )}

      {report.costItems && report.costItems.length > 0 && (
        <SectionCard title="Development Cost Estimate" icon="💰">
          <CostBar
            items={report.costItems}
            total={(report.totalCostLow || 0 + (report.totalCostHigh || 0)) / 2 || report.costItems.reduce((s, i) => s + (i.low + i.high) / 2, 0)}
          />
          {report.costItems.map((item, i) => (
            <View key={i} style={[styles.costRow, { borderBottomColor: colors.border }, i < report.costItems!.length - 1 && { borderBottomWidth: 1 }]}>
              <Text style={[styles.costLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {item.label}
              </Text>
              <Text style={[styles.costValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {formatNZD(item.low)} – {formatNZD(item.high)}
              </Text>
            </View>
          ))}
          {report.totalCostLow !== undefined && report.totalCostHigh !== undefined && (
            <View style={[styles.totalRow, { backgroundColor: colors.navy + "10", borderRadius: 8, borderColor: colors.navy + "30", borderWidth: 1 }]}>
              <Text style={[styles.totalLabel, { color: colors.navy, fontFamily: "Inter_700Bold" }]}>
                TOTAL ESTIMATE
              </Text>
              <Text style={[styles.totalValue, { color: colors.navy, fontFamily: "Inter_700Bold" }]}>
                {formatNZD(report.totalCostLow)} – {formatNZD(report.totalCostHigh)}
              </Text>
            </View>
          )}
          <Text style={[styles.disclaimer, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {report.disclaimer || "These are indicative estimates only. Engage a quantity surveyor for accurate figures."}
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
        <SectionCard title="Comparable Sales" icon="🔍">
          {report.avgPricePerSqm && (
            <InfoRow
              label="Avg $/m² (used for GDV)"
              value={`$${Math.round(report.avgPricePerSqm).toLocaleString()}/m²`}
              valueColor={colors.emerald}
            />
          )}
          {report.comparableSales.map((sale, i) => (
            <View key={i} style={[styles.saleRow, { borderBottomColor: colors.border }, i < report.comparableSales!.length - 1 && { borderBottomWidth: 1 }]}>
              <Text style={[styles.saleAddress, { color: colors.foreground, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                {sale.address}
              </Text>
              <View style={styles.saleMeta}>
                <Text style={[styles.saleDate, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {sale.saleDate}
                </Text>
                <Text style={[styles.salePrice, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>
                  {formatNZD(sale.price)}
                </Text>
                <Text style={[styles.saleSqm, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
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
            <View key={i} style={styles.riskItem}>
              <View style={[styles.riskDot, { backgroundColor: colors.amber }]} />
              <Text style={[styles.riskText2, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {risk}
              </Text>
            </View>
          ))}
        </SectionCard>
      )}

      <View style={[styles.followUpsContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.followUpsTitle, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          Ask a follow-up question
        </Text>
        <View style={styles.followUpsGrid}>
          {FOLLOW_UPS.map((q) => (
            <TouchableOpacity
              key={q}
              style={[styles.followUpChip, { backgroundColor: colors.navy + "10", borderColor: colors.navy + "30" }]}
              onPress={() => onFollowUp(q)}
              activeOpacity={0.7}
            >
              <Text style={[styles.followUpText, { color: colors.navy, fontFamily: "Inter_500Medium" }]}>
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
  header: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  address: {
    fontSize: 17,
    color: "#fff",
    letterSpacing: -0.3,
  },
  headerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  zoneBadge: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
  },
  zoneBadgeText: {
    fontSize: 11,
    letterSpacing: 0.5,
  },
  cvText: {
    fontSize: 12,
  },
  scoresRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
    paddingHorizontal: 8,
  },
  compositeContainer: {
    alignItems: "center",
  },
  compositeScore: {
    fontSize: 36,
    letterSpacing: -1,
  },
  compositeLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  sectionIcon: {
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 14,
    flex: 1,
  },
  sectionBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
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
    marginBottom: 8,
  },
  overlaysContainer: {
    borderTopWidth: 1,
    marginTop: 4,
    paddingTop: 4,
  },
  overlayItem: {
    paddingVertical: 2,
  },
  warningBox: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginTop: 8,
  },
  warningText: {
    fontSize: 12,
    lineHeight: 18,
  },
  infraRow: {
    flexDirection: "row",
    paddingVertical: 10,
    gap: 8,
  },
  infraLeft: {
    flex: 1,
    gap: 2,
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
    gap: 4,
  },
  riskBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 100,
    borderWidth: 1,
  },
  riskText: {
    fontSize: 10,
    letterSpacing: 0.5,
  },
  infraCost: {
    fontSize: 11,
  },
  costBarContainer: {
    gap: 8,
    marginBottom: 12,
  },
  costBar: {
    height: 10,
    borderRadius: 5,
    overflow: "hidden",
    flexDirection: "row",
    backgroundColor: "#E2E8F0",
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
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  costLegendLabel: {
    fontSize: 10,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
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
    fontSize: 12,
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 15,
  },
  disclaimer: {
    fontSize: 11,
    fontStyle: "italic",
    lineHeight: 16,
    marginTop: 8,
    opacity: 0.7,
  },
  roiScroll: {
    marginHorizontal: -4,
  },
  roiRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  roiCard: {
    width: 130,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    alignItems: "center",
    gap: 2,
    position: "relative",
  },
  bestBadge: {
    position: "absolute",
    top: -8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 100,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  bestBadgeText: {
    fontSize: 9,
    letterSpacing: 1,
  },
  roiYears: {
    fontSize: 24,
    marginTop: 8,
  },
  roiPercent: {
    fontSize: 28,
    letterSpacing: -0.5,
  },
  roiLabel: {
    fontSize: 11,
  },
  roiDivider: {
    height: 1,
    width: "80%",
    marginVertical: 8,
  },
  roiGdv: {
    fontSize: 11,
  },
  roiProfit: {
    fontSize: 13,
  },
  saleRow: {
    paddingVertical: 8,
    gap: 3,
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
    paddingVertical: 5,
    alignItems: "flex-start",
  },
  riskDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 6,
    flexShrink: 0,
  },
  riskText2: {
    fontSize: 13,
    lineHeight: 20,
    flex: 1,
  },
  followUpsContainer: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  followUpsTitle: {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  followUpsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  followUpChip: {
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  followUpText: {
    fontSize: 12,
  },
});
