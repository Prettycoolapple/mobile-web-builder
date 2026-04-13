import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { useColors } from "@/hooks/useColors";

const STEPS = [
  "Fetching property details from LINZ...",
  "Checking Auckland Council planning overlays...",
  "Analysing contour and infrastructure...",
  "Calculating development costs and ROI...",
  "Generating your feasibility report...",
];

const STEP_DURATION_MS = 4000;

interface Props {
  retryLabel?: string;
}

export function AnalysisProgress({ retryLabel }: Props) {
  const colors = useColors();
  const [stepIndex, setStepIndex] = useState(0);
  const dotAnim = useRef(new Animated.Value(0)).current;
  const barWidth = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const totalDuration = STEPS.length * STEP_DURATION_MS;
    Animated.timing(barWidth, {
      toValue: 1,
      duration: totalDuration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setStepIndex((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, STEP_DURATION_MS);
    return () => clearInterval(interval);
  }, []);

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
          {retryLabel ? "Retrying analysis" : "Analysing property"}
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: colors.accent,
              width: barWidth.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
            },
          ]}
        />
      </View>

      <Text
        key={retryLabel ?? stepIndex}
        style={[styles.step, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}
      >
        {retryLabel ?? STEPS[stepIndex]}
      </Text>

      {!retryLabel && (
        <View style={styles.stepDots}>
          {STEPS.map((_, i) => (
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
