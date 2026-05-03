import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

type Rating = "up" | "down";

interface Props {
  sessionRating?: Rating;
  onRate: (rating: Rating) => void;
}

export function ResponseRatingBar({ sessionRating, onRate }: Props) {
  const colors = useColors();
  const { t } = useT();

  if (sessionRating) {
    return (
      <View
        style={[
          styles.wrap,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
          {t("search.rating_thanks")}
        </Text>
      </View>
    );
  }

  const handle = (rating: Rating) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRate(rating);
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
        {t("search.rating_prompt")}
      </Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.background }]}
          onPress={() => handle("down")}
          accessibilityRole="button"
          accessibilityLabel={t("search.rating_down_a11y")}
          activeOpacity={0.75}
        >
          <Feather name="thumbs-down" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, { borderColor: colors.accent + "55", backgroundColor: colors.accent + "14" }]}
          onPress={() => handle("up")}
          accessibilityRole="button"
          accessibilityLabel={t("search.rating_up_a11y")}
          activeOpacity={0.75}
        >
          <Feather name="thumbs-up" size={18} color={colors.accent} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
});
