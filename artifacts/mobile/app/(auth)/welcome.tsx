import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
  Image,
  Pressable,
  Platform,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { Asset } from "expo-asset";
import { StatusBar } from "expo-status-bar";
import { SmileSwoosh } from "@/components/GroundupLogo";

const HERO_VIDEO = require("../../assets/videos/welcome-hero.mp4");
const HERO_POSTER = require("../../assets/videos/welcome-hero-poster.jpg");
const HERO_VIDEO_URI = Asset.fromModule(HERO_VIDEO).uri;
const HERO_POSTER_URI = Asset.fromModule(HERO_POSTER).uri;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height: screenHeight } = useWindowDimensions();

  const [videoReady, setVideoReady] = useState(false);

  const player = useVideoPlayer(HERO_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = player.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") setVideoReady(true);
    });
    return () => sub.remove();
  }, [player]);

  // Staggered entrance animations
  const fadeBrand = useRef(new Animated.Value(0)).current;
  const fadeHead = useRef(new Animated.Value(0)).current;
  const fadeCta = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(16)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(lift, {
        toValue: 0,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeBrand, {
        toValue: 1,
        duration: 650,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeHead, {
        toValue: 1,
        duration: 700,
        delay: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeCta, {
        toValue: 1,
        duration: 700,
        delay: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();

    // Subtle ambient glow loop behind the logo
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ).start();
  }, []);

  const glowScale = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.06],
  });
  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.34],
  });

  // Bleed beyond safe-area so the visuals fill edge-to-edge.
  const bleed = {
    position: "absolute" as const,
    top: -insets.top,
    bottom: -insets.bottom,
    left: -insets.left,
    right: -insets.right,
  };

  // Headline anchored ~52% down — gives the logo room to breathe.
  const headlineTop = screenHeight * 0.5;

  return (
    <View style={styles.container}>
      <StatusBar style="light" translucent backgroundColor="transparent" />

      {Platform.OS === "web" ? (
        React.createElement("video", {
          src: HERO_VIDEO_URI,
          poster: HERO_POSTER_URI,
          autoPlay: true,
          muted: true,
          loop: true,
          playsInline: true,
          preload: "auto",
          style: {
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          },
        })
      ) : (
        <>
          <Image source={HERO_POSTER} style={bleed} resizeMode="cover" />
          <VideoView
            style={[bleed, { opacity: videoReady ? 1 : 0 }]}
            player={player}
            contentFit="cover"
            nativeControls={false}
            allowsFullscreen={false}
            allowsPictureInPicture={false}
          />
        </>
      )}

      {/* Cinematic legibility scrim — darker top & bottom, softer middle */}
      <LinearGradient
        colors={[
          "rgba(15,10,7,0.78)",
          "rgba(15,10,7,0.18)",
          "rgba(15,10,7,0.45)",
          "rgba(15,10,7,0.92)",
        ]}
        locations={[0, 0.32, 0.62, 1]}
        style={bleed}
      />

      {/* Subtle warm vignette tint */}
      <LinearGradient
        colors={["rgba(217,119,87,0.10)", "rgba(0,0,0,0)", "rgba(217,119,87,0.08)"]}
        locations={[0, 0.5, 1]}
        style={bleed}
      />

      {/* ── Brand block: Amazon-style wordmark with smile swoosh ── */}
      <Animated.View
        style={[
          styles.brandBlock,
          {
            top: insets.top + 72,
            opacity: fadeBrand,
            transform: [{ translateY: lift }],
          },
        ]}
      >
        <View style={styles.wordmarkWrap}>
          <Animated.View
            pointerEvents="none"
            style={[
              styles.logoGlow,
              { opacity: glowOpacity, transform: [{ scale: glowScale }] },
            ]}
          />
          <Text style={styles.wordmark}>
            project<Text style={styles.wordmarkAlpha}> alpha</Text>
          </Text>
          <View style={styles.swooshWrap}>
            <SmileSwoosh width={232} color="#D97757" accentColor="#E8C887" />
          </View>
        </View>

        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowDot} />
          <Text style={styles.eyebrow}>NEW ZEALAND · RESIDENTIAL</Text>
          <View style={styles.eyebrowDot} />
        </View>
      </Animated.View>

      {/* ── Headline block ── */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.headlineBlock,
          {
            top: headlineTop,
            opacity: fadeHead,
            transform: [{ translateY: lift }],
          },
        ]}
      >
        <Text style={styles.headline}>
          Build it,{" "}
          <Text style={styles.headlineEm}>ground up.</Text>
        </Text>
        <View style={styles.headlineRule} />
        <Text style={styles.subhead}>
          Instant feasibility for any New Zealand site.
        </Text>
      </Animated.View>

      {/* ── CTAs ── */}
      <Animated.View
        style={[
          styles.ctaBlock,
          { paddingBottom: insets.bottom + 28, opacity: fadeCta },
        ]}
      >
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push("/(auth)/signup")}
          activeOpacity={0.88}
        >
          <Text style={styles.primaryBtnText}>Get started</Text>
          <Text style={styles.primaryBtnArrow}>→</Text>
        </TouchableOpacity>

        <Pressable
          onPress={() => router.push("/(auth)/login")}
          hitSlop={12}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { opacity: pressed ? 0.55 : 1 },
          ]}
        >
          <Text style={styles.secondaryBtnText}>I already have an account</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0F0A07",
  },

  // Brand
  brandBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 22,
  },
  wordmarkWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  logoGlow: {
    position: "absolute",
    width: 260,
    height: 160,
    borderRadius: 130,
    backgroundColor: "#D97757",
    shadowColor: "#D97757",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 50,
  },
  wordmark: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.6,
    color: "#FBF6EC",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  wordmarkAlpha: {
    fontFamily: "DM_Sans_700Bold",
    color: "#FBF6EC",
    letterSpacing: -1.6,
  },
  swooshWrap: {
    marginTop: 6,
    alignItems: "center",
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  eyebrowDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(232,200,135,0.85)",
  },
  eyebrow: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 11,
    letterSpacing: 2.4,
    color: "rgba(251,246,236,0.78)",
  },

  // Headline
  headlineBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: 28,
    gap: 18,
  },
  headline: {
    fontFamily: "Fraunces_400Regular",
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: "#FBF6EC",
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  headlineEm: {
    fontFamily: "Fraunces_600SemiBold",
    fontStyle: "italic",
    color: "#F1D9A8",
  },
  headlineRule: {
    width: 28,
    height: 1,
    backgroundColor: "rgba(232,200,135,0.7)",
  },
  subhead: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.2,
    color: "rgba(251,246,236,0.82)",
    textAlign: "center",
    paddingHorizontal: 16,
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },

  // CTAs
  ctaBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    gap: 6,
    alignItems: "center",
  },
  primaryBtn: {
    width: "100%",
    height: 56,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#FBF6EC",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryBtnText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
    color: "#1C1917",
    letterSpacing: 0.2,
  },
  primaryBtnArrow: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 18,
    color: "#1C1917",
    marginTop: -2,
  },
  secondaryBtn: {
    height: 48,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 13.5,
    color: "rgba(251,246,236,0.92)",
    letterSpacing: 0.4,
    textDecorationLine: "underline",
    textDecorationColor: "rgba(232,200,135,0.5)",
  },
});
