import React, { useEffect, useRef } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface Props {
  score: number;
  label: string;
  size?: number;
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ScoreRing({ score, label, size = 88 }: Props) {
  const colors = useColors();
  const STROKE = 7;
  const R = (size - STROKE) / 2;
  const CIRC = 2 * Math.PI * R;
  const progress = useRef(new Animated.Value(0)).current;

  const color =
    score >= 4 ? colors.success
    : score >= 2.5 ? colors.amber
    : colors.red;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: score / 5,
      duration: 900,
      useNativeDriver: false,
    }).start();
  }, [score]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [CIRC, 0],
  });

  return (
    <View style={styles.wrapper}>
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke={colors.border}
          strokeWidth={STROKE}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={CIRC}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </Svg>
      <View style={[StyleSheet.absoluteFillObject, styles.center]}>
        <Text style={[styles.score, { color, fontFamily: "DM_Sans_700Bold", fontSize: size * 0.24 }]}>
          {score.toFixed(1)}
        </Text>
        <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular", fontSize: size * 0.14 }]}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  score: {
    letterSpacing: -0.5,
    lineHeight: undefined,
  },
  label: {
    marginTop: 1,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
});
