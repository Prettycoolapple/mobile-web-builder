import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useColors } from "@/hooks/useColors";

interface ScoreBadgeProps {
  score: number;
  label: string;
  size?: number;
}

function getScoreColor(score: number, colors: ReturnType<typeof useColors>): string {
  if (score >= 4) return colors.success;
  if (score >= 2.5) return colors.amber;
  return colors.red;
}

export function ScoreBadge({ score, label, size = 72 }: ScoreBadgeProps) {
  const colors = useColors();
  const animatedValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: score / 5,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [score, animatedValue]);

  const scoreColor = getScoreColor(score, colors);
  const fontSize = size * 0.27;
  const labelFontSize = size * 0.17;

  return (
    <View style={[styles.container, { width: size + 16, alignItems: "center" }]}>
      <View
        style={[
          styles.badge,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: scoreColor + "60",
            backgroundColor: scoreColor + "10",
          },
        ]}
      >
        <Text style={[styles.score, { fontSize, color: scoreColor, fontFamily: "DM_Sans_700Bold" }]}>
          {score.toFixed(1)}
        </Text>
        <Text style={[styles.outOf, { fontSize: fontSize * 0.5, color: colors.mutedForeground }]}>
          /5
        </Text>
      </View>
      <Text
        style={[
          styles.label,
          { fontSize: labelFontSize, color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 6,
  },
  badge: {
    borderWidth: 2,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
  },
  score: {
    letterSpacing: -0.5,
  },
  outOf: {
    marginTop: 4,
    opacity: 0.7,
  },
  label: {
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
});
