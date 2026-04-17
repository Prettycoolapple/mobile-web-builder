import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Svg, { Defs, RadialGradient, Stop, Circle } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { GroundupLogo } from "@/components/GroundupLogo";

const BRAND = "Groundup";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

function GlowBackdrop({ color }: { color: string }) {
  return (
    <Svg
      width={SCREEN_W}
      height={SCREEN_H}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id="glow1" cx="50%" cy="35%" r="60%">
          <Stop offset="0" stopColor={color} stopOpacity="0.35" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="glow2" cx="80%" cy="80%" r="55%">
          <Stop offset="0" stopColor={color} stopOpacity="0.18" />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx={SCREEN_W / 2} cy={SCREEN_H * 0.35} r={SCREEN_W * 0.7} fill="url(#glow1)" />
      <Circle cx={SCREEN_W * 0.8} cy={SCREEN_H * 0.8} r={SCREEN_W * 0.6} fill="url(#glow2)" />
    </Svg>
  );
}

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoTranslateY = useRef(new Animated.Value(20)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(12)).current;
  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const ctaTranslateY = useRef(new Animated.Value(24)).current;

  const letters = useRef(
    BRAND.split("").map(() => ({
      opacity: new Animated.Value(0),
      translateY: new Animated.Value(18),
    })),
  ).current;

  useEffect(() => {
    const intro = Animated.parallel([
      Animated.timing(logoOpacity, {
        toValue: 1,
        duration: 600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(logoScale, {
        toValue: 1,
        friction: 6,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(logoTranslateY, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    intro.start();

    const letterAnims = letters.map((l, i) =>
      Animated.parallel([
        Animated.timing(l.opacity, {
          toValue: 1,
          duration: 420,
          delay: 350 + i * 70,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(l.translateY, {
          toValue: 0,
          duration: 520,
          delay: 350 + i * 70,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    );

    const letterStagger = Animated.stagger(0, letterAnims);
    letterStagger.start();

    const tagline = Animated.parallel([
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 500,
        delay: 350 + letters.length * 70 + 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(taglineTranslateY, {
        toValue: 0,
        duration: 500,
        delay: 350 + letters.length * 70 + 120,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    tagline.start();

    const cta = Animated.parallel([
      Animated.timing(ctaOpacity, {
        toValue: 1,
        duration: 500,
        delay: 350 + letters.length * 70 + 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(ctaTranslateY, {
        toValue: 0,
        duration: 500,
        delay: 350 + letters.length * 70 + 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);
    cta.start();

    return () => {
      intro.stop();
      letterStagger.stop();
      tagline.stop();
      cta.stop();
    };
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <GlowBackdrop color={colors.accent} />

      <View style={[styles.content, { paddingTop: insets.top + 80, paddingBottom: insets.bottom + 32 }]}>
        <View style={styles.heroBlock}>
          <Animated.View
            style={{
              opacity: logoOpacity,
              transform: [{ scale: logoScale }, { translateY: logoTranslateY }],
              marginBottom: 28,
            }}
          >
            <GroundupLogo size={108} color={colors.accent} accentColor={colors.accent} />
          </Animated.View>

          <View style={styles.brandRow}>
            {letters.map((l, i) => (
              <Animated.Text
                key={i}
                style={[
                  styles.brandLetter,
                  {
                    color: colors.foreground,
                    fontFamily: "DM_Sans_700Bold",
                    opacity: l.opacity,
                    transform: [{ translateY: l.translateY }],
                  },
                ]}
              >
                {BRAND[i]}
              </Animated.Text>
            ))}
          </View>

          <Animated.Text
            style={[
              styles.tagline,
              {
                color: colors.mutedForeground,
                fontFamily: "DM_Sans_400Regular",
                opacity: taglineOpacity,
                transform: [{ translateY: taglineTranslateY }],
              },
            ]}
          >
            Property development intelligence,{"\n"}built from the ground up.
          </Animated.Text>
        </View>

        <Animated.View
          style={{
            opacity: ctaOpacity,
            transform: [{ translateY: ctaTranslateY }],
            gap: 12,
          }}
        >
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.push("/(auth)/signup")}
            activeOpacity={0.85}
          >
            <Text style={[styles.primaryBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
              Get started
            </Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            onPress={() => router.push("/(auth)/login")}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.secondaryBtnText,
                { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" },
              ]}
            >
              I already have an account
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: "space-between",
  },
  heroBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: {
    fontSize: 44,
    letterSpacing: -1,
    lineHeight: 52,
  },
  tagline: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 16,
    maxWidth: 320,
  },
  primaryBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 10,
  },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  secondaryBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 15 },
});
