import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { StarRating } from "@/components/StarRating";
import { useT } from "@/lib/i18n";
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";

/** Card-grade headline data returned by GET /explore (no photos/report prose). */
export interface ExploreProperty {
  address: string;
  suburb: string | null;
  composite: number | null;
  ease: number | null;
  cost: number | null;
  roi: number | null;
  zone: string | null;
  landArea: number | null;
  potentialLots: number | null;
}

function scoreColor(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 4) return colors.success;
  if (score >= 2.5) return colors.amber;
  return colors.red;
}

function Pip({ score, label }: { score: number; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.pip}>
      <StarRating score={score} maxStars={3} size={13} gap={2} color={scoreColor(score, colors)} emptyColor={colors.border} />
      <Text style={[styles.pipLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{label}</Text>
    </View>
  );
}

export function ExploreCard({ property, onAnalyse }: { property: ExploreProperty; onAnalyse: (address: string) => void }) {
  const colors = useColors();
  const { t } = useT();
  const composite = typeof property.composite === "number" && property.composite > 0 ? property.composite : 0;
  const c = scoreColor(composite, colors);

  const chips: string[] = [];
  if (property.zone) chips.push(property.zone);
  if (typeof property.landArea === "number" && property.landArea > 0) chips.push(`${Math.round(property.landArea)} m²`);
  if (typeof property.potentialLots === "number" && property.potentialLots >= 2) {
    chips.push(t("explore.lots", { count: property.potentialLots }));
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.topRow}>
        <View style={styles.addressBlock}>
          <Text style={[styles.address, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
            {property.address}
          </Text>
          {property.suburb ? (
            <Text style={[styles.suburb, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
              {property.suburb}
            </Text>
          ) : null}
        </View>
        {composite > 0 ? (
          <View style={[styles.badge, { borderColor: c + "88", backgroundColor: c + "22" }]}>
            <Text style={[styles.badgeNum, { color: c, fontFamily: "DM_Sans_700Bold" }]}>
              {formatCompositeScoreForDisplay(composite)}
            </Text>
            <Text style={[styles.badgeOutOf, { color: c, fontFamily: "DM_Sans_500Medium" }]}>/5</Text>
          </View>
        ) : null}
      </View>

      {chips.length > 0 ? (
        <View style={styles.chipRow}>
          {chips.map((chip, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: colors.muted }]}>
              <Text style={[styles.chipText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>{chip}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={[styles.scoresRow, { borderTopColor: colors.border }]}>
        <Pip score={property.ease ?? 0} label={t("explore.score_ease")} />
        <Pip score={property.cost ?? 0} label={t("explore.score_cost")} />
        <Pip score={property.roi ?? 0} label={t("explore.score_roi")} />
      </View>

      <TouchableOpacity
        style={[styles.analyseBtn, { backgroundColor: colors.accent }]}
        onPress={() => onAnalyse(property.address)}
        activeOpacity={0.85}
      >
        <Feather name="bar-chart-2" size={15} color="#fff" />
        <Text style={[styles.analyseText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("explore.full_analysis")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  addressBlock: { flex: 1 },
  address: { fontSize: 15, lineHeight: 20 },
  suburb: { fontSize: 13, marginTop: 2 },
  badge: {
    flexDirection: "row",
    alignItems: "baseline",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeNum: { fontSize: 16 },
  badgeOutOf: { fontSize: 11, marginLeft: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  chipText: { fontSize: 12 },
  scoresRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 12,
  },
  pip: { alignItems: "center", gap: 4, flex: 1 },
  pipLabel: { fontSize: 11 },
  analyseBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 12,
    paddingVertical: 11,
  },
  analyseText: { color: "#fff", fontSize: 14 },
});
