import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { PropertyCandidate } from "@/context/ChatContext";

interface Props {
  candidate: PropertyCandidate;
  onAnalyse: (address: string) => void;
}

function ScorePip({ score, label }: { score: number; label: string }) {
  const colors = useColors();
  const color = score >= 4 ? colors.success : score >= 2.5 ? colors.amber : colors.red;
  return (
    <View style={styles.pip}>
      <Text style={[styles.pipValue, { color, fontFamily: "DM_Sans_700Bold" }]}>
        {score.toFixed(1)}
      </Text>
      <Text style={[styles.pipLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
        {label}
      </Text>
    </View>
  );
}

export function PropertyCard({ candidate, onAnalyse }: Props) {
  const colors = useColors();

  const compositeColor =
    candidate.scores.composite >= 4
      ? colors.success
      : candidate.scores.composite >= 2.5
        ? colors.amber
        : colors.red;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.body}>
        <View style={styles.topRow}>
          <View style={[styles.scoreCircle, { backgroundColor: compositeColor + "15", borderColor: compositeColor + "40" }]}>
            <Text style={[styles.scoreCircleText, { color: compositeColor, fontFamily: "DM_Sans_700Bold" }]}>
              {candidate.scores.composite.toFixed(1)}
            </Text>
          </View>
          <View style={styles.addressBlock}>
            <Text style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
              {candidate.address}
            </Text>
            <View style={styles.tagRow}>
              {candidate.price > 0 && (
                <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    ${(candidate.price / 1_000_000).toFixed(2)}M
                  </Text>
                </View>
              )}
              {candidate.landArea && (
                <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {candidate.landArea}m²
                  </Text>
                </View>
              )}
              {candidate.zone && (
                <View style={[styles.tag, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.tagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {candidate.zone}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {candidate.briefSummary && (
          <Text style={[styles.summary, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={2}>
            {candidate.briefSummary}
          </Text>
        )}

        <View style={[styles.scoresRow, { borderTopColor: colors.border }]}>
          <ScorePip score={candidate.scores.ease} label="Ease" />
          <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
          <ScorePip score={candidate.scores.cost} label="Cost" />
          <View style={[styles.scoreDivider, { backgroundColor: colors.border }]} />
          <ScorePip score={candidate.scores.roi} label="ROI" />
        </View>
      </View>

      <TouchableOpacity
        style={[styles.analyseBtn, { backgroundColor: colors.accent }]}
        onPress={() => onAnalyse(candidate.address)}
        activeOpacity={0.8}
      >
        <Text style={[styles.analyseBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
          Full Analysis
        </Text>
        <Feather name="arrow-right" size={14} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(28,25,23,0.06)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  body: {
    padding: 16,
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  scoreCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  scoreCircleText: {
    fontSize: 16,
  },
  addressBlock: {
    flex: 1,
    gap: 6,
  },
  address: {
    fontSize: 14,
    lineHeight: 20,
  },
  tagRow: {
    flexDirection: "row",
    gap: 5,
    flexWrap: "wrap",
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
  },
  tagText: {
    fontSize: 11,
  },
  summary: {
    fontSize: 13,
    lineHeight: 19,
  },
  scoresRow: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 12,
    justifyContent: "space-around",
    alignItems: "center",
  },
  pip: {
    alignItems: "center",
    flex: 1,
    gap: 2,
  },
  pipValue: {
    fontSize: 17,
    letterSpacing: -0.3,
  },
  pipLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  scoreDivider: {
    width: 1,
    height: 28,
  },
  analyseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
  },
  analyseBtnText: {
    color: "#fff",
    fontSize: 14,
  },
});
