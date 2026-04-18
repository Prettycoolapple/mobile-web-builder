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
import { GroundupLogo } from "@/components/GroundupLogo";

const HERO_VIDEO = require("../../assets/videos/welcome-hero.mp4");
const HERO_POSTER = require("../../assets/videos/welcome-hero-poster.jpg");
const HERO_VIDEO_URI = Asset.fromModule(HERO_VIDEO).uri;
const HERO_POSTER_URI = Asset.fromModule(HERO_POSTER).uri;

const PHI = 1.6180339887;

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

  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Golden ratio: place slogan baseline at 1/phi from the top (≈ 61.8% down).
  const goldenY = screenHeight / PHI;

  return (
    <View style={styles.container}>
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
          <Image
            source={HERO_POSTER}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
          <VideoView
            style={[
              StyleSheet.absoluteFill,
              { opacity: videoReady ? 1 : 0 },
            ]}
            player={player}
            contentFit="cover"
            nativeControls={false}
            allowsFullscreen={false}
            allowsPictureInPicture={false}
          />
        </>
      )}

      {/* Cinematic dark gradient for legibility */}
      <LinearGradient
        colors={[
          "rgba(0,0,0,0.55)",
          "rgba(0,0,0,0.15)",
          "rgba(0,0,0,0.35)",
          "rgba(0,0,0,0.85)",
        ]}
        locations={[0, 0.35, 0.65, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Logo + wordmark — top, anchored just below safe area */}
      <Animated.View
        style={[
          styles.brandBlock,
          {
            top: insets.top + 28,
            opacity: fade,
            transform: [{ translateY: lift }],
          },
        ]}
      >
        <GroundupLogo size={56} color="#F5E9D7" accentColor="#E0B973" />
        <Text style={styles.wordmark}>
          ground<Text style={styles.wordmarkUp}>UP</Text>
        </Text>
      </Animated.View>

      {/* Slogan at the golden ratio line */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.slogan,
          {
            top: goldenY,
            opacity: fade,
            transform: [{ translateY: lift }],
          },
        ]}
      >
        <View style={styles.sloganRule} />
        <Text style={styles.sloganText}>Residential property development</Text>
      </Animated.View>

      {/* Minimal CTAs at bottom */}
      <Animated.View
        style={[
          styles.ctaBlock,
          { paddingBottom: insets.bottom + 24, opacity: fade },
        ]}
      >
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push("/(auth)/signup")}
          activeOpacity={0.85}
        >
          <Text style={styles.primaryBtnText}>Get started</Text>
        </TouchableOpacity>

        <Pressable
          onPress={() => router.push("/(auth)/login")}
          hitSlop={12}
          style={({ pressed }) => [
            styles.signinWrap,
            { opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <Text style={styles.signinText}>Sign in</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  brandBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 14,
  },
  wordmark: {
    fontFamily: "Fraunces_500Medium",
    fontSize: 36,
    letterSpacing: -1.2,
    color: "#FBF6EC",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  wordmarkUp: {
    fontFamily: "Fraunces_700Bold",
    color: "#E8C887",
    letterSpacing: -0.6,
  },
  slogan: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 14,
  },
  sloganRule: {
    width: 36,
    height: 1,
    backgroundColor: "rgba(232,200,135,0.85)",
  },
  sloganText: {
    fontFamily: "Fraunces_400Regular",
    fontSize: 18,
    letterSpacing: 0.4,
    color: "#FBF6EC",
    textAlign: "center",
    paddingHorizontal: 32,
    textShadowColor: "rgba(0,0,0,0.55)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  ctaBlock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    gap: 14,
    alignItems: "center",
  },
  primaryBtn: {
    width: "100%",
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(251,246,236,0.96)",
  },
  primaryBtnText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
    color: "#1C1917",
    letterSpacing: 0.2,
  },
  signinWrap: {
    paddingVertical: 8,
  },
  signinText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    color: "#FBF6EC",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
