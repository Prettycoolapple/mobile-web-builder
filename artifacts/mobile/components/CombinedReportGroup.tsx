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
}: {
  group: FeasibilityReportGroup;
  onFollowUp: (question: string) => void;
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

      {group.reports.map((report, index) => (
        <View key={`${report.address || index}-${index}`} style={styles.reportWrap}>
          <Text style={[styles.childLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold" }]}>
            {t("combined_report.property_label", { n: index + 1 })}
          </Text>
          <FeasibilityReportCard report={report} onFollowUp={onFollowUp} />
        </View>
      ))}

      <View style={[styles.comparison, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.comparisonTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
          {t("combined_report.comparison")}
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
    gap: 6,
  },
  childLabel: {
    fontSize: 12,
    paddingHorizontal: 4,
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
