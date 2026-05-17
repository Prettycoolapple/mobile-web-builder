import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

const STEP_KEYS = [
  "search.step_linz",
  "search.step_planning",
  "search.step_terrain",
  "search.step_costs",
  "search.step_report",
] as const;

/** Wall-clock estimate for feasibility analysis; bar and step labels stay aligned to this. */
const ESTIMATED_MAX_MS = 5 * 60 * 1000;
const BAR_MAX_FRACTION = 0.92;

interface Props {
  retryLabel?: string;
}

export function AnalysisProgress({ retryLabel }: Props) {
  const colors = useColors();
  const { t } = useT();
  const steps = useMemo(() => STEP_KEYS.map((k) => t(k)), [t]);
  const [stepIndex, setStepIndex] = useState(0);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  const stepDurationMs = Math.max(8000, Math.floor(ESTIMATED_MAX_MS / steps.length));

  useEffect(() => {
    barWidth.setValue(0);
    const anim = Animated.timing(barWidth, {
      toValue: BAR_MAX_FRACTION,
      duration: ESTIMATED_MAX_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [barWidth, steps.length]);

  useEffect(() => {
    setStepIndex(0);
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }, stepDurationMs);
    return () => clearInterval(interval);
  }, [steps.length, stepDurationMs]);

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(dotAnim, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const dotOpacity = dotAnim.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.header}>
        <Animated.View style={[styles.dot, { backgroundColor: colors.accent, opacity: dotOpacity }]} />
        <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
          {t("search.analysing_property")}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: colors.accent,
              width: barWidth.interpolate({
                inputRange: [0, BAR_MAX_FRACTION],
                outputRange: ["0%", `${BAR_MAX_FRACTION * 100}%`],
              }),
            },
          ]}
        />
      </View>

      <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
        {t("search.analysis_up_to_five_min")}
      </Text>

      <Text
        key={retryLabel ?? stepIndex}
        style={[styles.step, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}
      >
        {retryLabel ?? steps[stepIndex]}
      </Text>

      {!retryLabel && (
        <View style={styles.stepDots}>
          {steps.map((_, i) => (
            <View
              key={i}
              style={[
                styles.stepDot,
                { backgroundColor: i <= stepIndex ? colors.accent : colors.border },
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    marginHorizontal: 12,
    marginVertical: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: 14,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
  },
  track: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: 2,
  },
  step: {
    fontSize: 12,
    lineHeight: 18,
  },
  stepDots: {
    flexDirection: "row",
    gap: 5,
  },
  stepDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
});
