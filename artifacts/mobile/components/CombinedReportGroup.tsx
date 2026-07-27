import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { FeasibilityReportGroup } from "@/context/ChatContext";
import { useT } from "@/lib/i18n";
import { FeasibilityReportCard } from "./FeasibilityReport";

export function CombinedReportGroupCard({
  group,
  onFollowUp,
  onFastTrackLodgement,
  onAnalyseProperty,
}: {
  group: FeasibilityReportGroup;
  onFollowUp: (question: string, displayText?: string) => void;
  onFastTrackLodgement?: (report: FeasibilityReportGroup["reports"][number]) => void;
  onAnalyseProperty?: (address: string) => void;
}) {
  const colors = useColors();
  const { t } = useT();

  return (
    <View style={styles.container}>
      <View style={[styles.banner, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.bannerIcon, { backgroundColor: colors.accent + "18" }]}>
          <Feather name="git-branch" size={16} color={colors.accent} />
        </View>
        <View style={styles.bannerText}>
          <Text style={[styles.bannerTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            {t("combined_report.title")}
          </Text>
          <Text style={[styles.bannerBody, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {group.warnings?.[0] || t("combined_report.banner")}
          </Text>
        </View>
      </View>

      {group.reports.map((report, index) => {
        const total = group.reports.length;
        const address = report.address || `Property ${index + 1}`;
        // Stable accent palette so each property keeps the same colour throughout the card.
        const palette = [colors.accent, "#3B82F6", "#10B981", "#F97316"];
        const tint = palette[index % palette.length];
        return (
          <View key={`${address}-${index}`} style={styles.reportWrap}>
            <View style={[styles.childHeader, { backgroundColor: tint + "14", borderColor: tint + "55" }]}>
              <View style={[styles.childHeaderBadge, { backgroundColor: tint }]}>
                <Text style={[styles.childHeaderBadgeText, { fontFamily: "DM_Sans_700Bold" }]}>
                  {index + 1}
                </Text>
              </View>
              <View style={styles.childHeaderText}>
                <Text style={[styles.childHeaderTitle, { color: tint, fontFamily: "DM_Sans_600SemiBold" }]}>
                  {t("combined_report.property_header", { n: index + 1, total })}
                </Text>
                <Text
                  style={[styles.childHeaderAddress, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}
                  numberOfLines={2}
                >
                  {address}
                </Text>
                <Text style={[styles.childHeaderNote, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  {t("combined_report.scoped_note")}
                </Text>
              </View>
            </View>
            <FeasibilityReportCard report={report} onFollowUp={onFollowUp} onFastTrackLodgement={onFastTrackLodgement} onAnalyseProperty={onAnalyseProperty} />
          </View>
        );
      })}

      <View style={[styles.comparison, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.comparisonTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
          {t("combined_report.comparison")}
        </Text>
        <Text style={[styles.comparisonSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          {t("combined_report.comparison_subtitle")}
        </Text>
        <Text style={[styles.summary, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}>
          {group.comparison.summary}
        </Text>
        <ComparisonList title={t("combined_report.subdivision")} rows={group.comparison.subdivisionView} />
        <ComparisonList title={t("combined_report.investment")} rows={group.comparison.investmentView} />
        <ComparisonList title={t("combined_report.risks")} rows={group.comparison.risks} />
        <View style={[styles.nextStep, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}>
          <Feather name="arrow-right-circle" size={15} color={colors.accent} />
          <Text style={[styles.nextStepText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
            {group.comparison.recommendedNextStep}
          </Text>
        </View>
      </View>
    </View>
  );
}

function ComparisonList({ title, rows }: { title: string; rows: string[] }) {
  const colors = useColors();
  if (!rows.length) return null;
  return (
    <View style={styles.listBlock}>
      <Text style={[styles.listTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{title}</Text>
      {rows.map((row, index) => (
        <View key={`${title}-${index}`} style={styles.listRow}>
          <View style={[styles.bullet, { backgroundColor: colors.accent }]} />
          <Text style={[styles.listText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {row}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  banner: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    gap: 10,
  },
  bannerIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  bannerText: {
    flex: 1,
    gap: 3,
  },
  bannerTitle: {
    fontSize: 14,
  },
  bannerBody: {
    fontSize: 12,
    lineHeight: 17,
  },
  reportWrap: {
    gap: 8,
  },
  childHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  childHeaderBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  childHeaderBadgeText: {
    color: "#ffffff",
    fontSize: 13,
  },
  childHeaderText: {
    flex: 1,
    gap: 2,
  },
  childHeaderTitle: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  childHeaderAddress: {
    fontSize: 14,
    lineHeight: 18,
  },
  childHeaderNote: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  comparison: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  comparisonTitle: {
    fontSize: 16,
  },
  comparisonSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: -6,
  },
  summary: {
    fontSize: 13,
    lineHeight: 19,
  },
  listBlock: {
    gap: 7,
  },
  listTitle: {
    fontSize: 13,
  },
  listRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 3,
    marginTop: 7,
  },
  listText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  nextStep: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  nextStepText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
});
