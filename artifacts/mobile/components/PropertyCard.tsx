import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { PropertyCandidate } from "@/context/ChatContext";

interface Props {
  candidate: PropertyCandidate;
  onAnalyse: (address: string) => void;
}

function MiniScore({ score, label }: { score: number; label: string }) {
  const colors = useColors();
  const color = score >= 4 ? colors.emerald : score >= 2.5 ? colors.amber : colors.red;
  return (
    <View style={styles.miniScore}>
      <View style={[styles.miniDot, { backgroundColor: color }]} />
      <Text style={[styles.miniLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {label}
      </Text>
      <Text style={[styles.miniValue, { color, fontFamily: "Inter_700Bold" }]}>
        {score.toFixed(1)}
      </Text>
    </View>
  );
}

export function PropertyCard({ candidate, onAnalyse }: Props) {
  const colors = useColors();

  const compositeColor =
    candidate.scores.composite >= 4
      ? colors.emerald
      : candidate.scores.composite >= 2.5
        ? colors.amber
        : colors.red;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.top}>
        <View style={styles.addressRow}>
          <View style={[styles.scorePill, { backgroundColor: compositeColor }]}>
            <Text style={[styles.scorePillText, { fontFamily: "Inter_700Bold" }]}>
              {candidate.scores.composite.toFixed(1)}
            </Text>
          </View>
          <Text style={[styles.address, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={2}>
            {candidate.address}
          </Text>
        </View>

        <View style={styles.metaRow}>
          {candidate.price > 0 && (
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Price
              </Text>
              <Text style={[styles.metaValue, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>
                ${(candidate.price / 1_000_000).toFixed(2)}M
              </Text>
            </View>
          )}
          {candidate.landArea && (
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Land
              </Text>
              <Text style={[styles.metaValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {candidate.landArea}m²
              </Text>
            </View>
          )}
          {candidate.zone && (
            <View style={styles.metaItem}>
              <Text style={[styles.metaLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Zone
              </Text>
              <Text style={[styles.metaValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {candidate.zone}
              </Text>
            </View>
          )}
        </View>

        <View style={[styles.scoresRow, { borderTopColor: colors.border }]}>
          <MiniScore score={candidate.scores.ease} label="Ease" />
          <MiniScore score={candidate.scores.cost} label="Cost" />
          <MiniScore score={candidate.scores.roi} label="ROI" />
        </View>

        {candidate.briefSummary && (
          <Text style={[styles.summary, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={3}>
            {candidate.briefSummary}
          </Text>
        )}
      </View>

      <TouchableOpacity
        style={[styles.analyseBtn, { backgroundColor: colors.navy }]}
        onPress={() => onAnalyse(candidate.address)}
        activeOpacity={0.85}
      >
        <Text style={[styles.analyseBtnText, { fontFamily: "Inter_600SemiBold" }]}>
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  top: {
    padding: 14,
    gap: 10,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  scorePill: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  scorePillText: {
    fontSize: 15,
    color: "#fff",
  },
  address: {
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    gap: 16,
  },
  metaItem: {
    gap: 1,
  },
  metaLabel: {
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 13,
  },
  scoresRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderTopWidth: 1,
    paddingTop: 8,
  },
  miniScore: {
    alignItems: "center",
    gap: 3,
    flexDirection: "row",
  },
  miniDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  miniLabel: {
    fontSize: 11,
  },
  miniValue: {
    fontSize: 13,
  },
  summary: {
    fontSize: 12,
    lineHeight: 18,
  },
  analyseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  analyseBtnText: {
    color: "#fff",
    fontSize: 13,
  },
});
