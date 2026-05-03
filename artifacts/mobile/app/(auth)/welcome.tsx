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
import { AlphaTail } from "@/components/GroundupLogo";
import { useT, isOSChineseLocale } from "@/lib/i18n";

const HERO_VIDEO = require("../../assets/videos/welcome-hero.mp4");
const HERO_POSTER = require("../../assets/videos/welcome-hero-poster.jpg");
const HERO_VIDEO_URI = Asset.fromModule(HERO_VIDEO).uri;
const HERO_POSTER_URI = Asset.fromModule(HERO_POSTER).uri;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const brandZh = isOSChineseLocale();

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
  }, []);

  // Full-bleed scrim covers the entire screen including safe-area regions.
  const bleed = {
    position: "absolute" as const,
    top: -insets.top,
    bottom: -insets.bottom,
    left: -insets.left,
    right: -insets.right,
  };

  // Hero video is rendered 30% larger than the visible viewport and centered,
  // guaranteeing full-bleed coverage on every phone size and aspect ratio.
  const totalH = screenHeight + insets.top + insets.bottom;
  const totalW = screenWidth + insets.left + insets.right;
  const heroScale = 1.3;
  const heroW = totalW * heroScale;
  const heroH = totalH * heroScale;
  const heroBleed = {
    position: "absolute" as const,
    width: heroW,
    height: heroH,
    top: -insets.top - (heroH - totalH) / 2,
    left: -insets.left - (heroW - totalW) / 2,
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
            top: heroBleed.top,
            left: heroBleed.left,
            width: heroBleed.width,
            height: heroBleed.height,
            objectFit: "cover",
          },
        })
      ) : (
        <>
          <Image source={HERO_POSTER} style={heroBleed} resizeMode="cover" />
          <VideoView
            style={[heroBleed, { opacity: videoReady ? 1 : 0 }]}
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

      {/* ── Brand block: wordmark with calligraphic "a" tail ── */}
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
          {/* Tail flourish sits BEHIND the text — English wordmark only */}
          {!brandZh && (
            <View pointerEvents="none" style={styles.tailWrap}>
              <AlphaTail width={300} color="#D97757" accentColor="#F1D9A8" />
            </View>
          )}
          {brandZh ? (
            <Text style={styles.wordmarkZh}>阿尔房</Text>
          ) : (
            <Text style={styles.wordmark}>
              <Text style={styles.wordmarkProject}>project</Text>
              <Text style={styles.wordmarkAlpha}> alpha</Text>
            </Text>
          )}
        </View>

        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowDot} />
          <Text style={styles.eyebrow}>{t("welcome.eyebrow")}</Text>
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
          {t("welcome.headline_a")}{" "}
          <Text style={styles.headlineEm}>{t("welcome.headline_b")}</Text>
        </Text>
        <View style={styles.headlineRule} />
        <Text style={styles.subhead}>
          {t("welcome.subhead")}
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
          <Text style={styles.primaryBtnText}>{t("welcome.cta_primary")}</Text>
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
          <Text style={styles.secondaryBtnText}>{t("welcome.cta_secondary")}</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 80,
  },
  wordmark: {
    fontSize: 46,
    lineHeight: 52,
    letterSpacing: -1.4,
    color: "#FBF6EC",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  wordmarkZh: {
    fontSize: 46,
    lineHeight: 52,
    letterSpacing: 2,
    color: "#F1D9A8",
    fontFamily: "DM_Sans_700Bold",
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  /**
   * "project" — clean sans-serif so the j renders cleanly without an unusual
   * curl/descender from the serif font.
   */
  wordmarkProject: {
    fontFamily: "DM_Sans_700Bold",
    color: "#FBF6EC",
    letterSpacing: -1.6,
  },
  /**
   * "alpha" — serif accent in cream, paired with the flourish behind it.
   */
  wordmarkAlpha: {
    fontFamily: "Fraunces_600SemiBold",
    color: "#F1D9A8",
    letterSpacing: -0.8,
  },
  /**
   * Tail flourish positioned absolutely behind the wordmark, centered.
   * Slightly nudged down so the curve passes under the baseline of the text.
   */
  tailWrap: {
    position: "absolute",
    top: 26,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.9,
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
