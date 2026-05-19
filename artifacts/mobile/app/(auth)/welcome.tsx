import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Asset } from "expo-asset";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isOSChineseLocale, useT } from "@/lib/i18n";

const HERO_VIDEO = require("../../assets/videos/welcome-hero.mp4");
const HERO_POSTER = require("../../assets/videos/welcome-hero-poster.jpg");
const HERO_VIDEO_URI = Asset.fromModule(HERO_VIDEO).uri;
const HERO_POSTER_URI = Asset.fromModule(HERO_POSTER).uri;

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const isZhOS = isOSChineseLocale();
  const { height, width } = useWindowDimensions();
  const compact = height < 740;
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
  const lift = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 850,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: 0,
        duration: 850,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, lift]);

  const bleed = {
    position: "absolute" as const,
    top: -insets.top,
    right: -insets.right,
    bottom: -insets.bottom,
    left: -insets.left,
  };

  const totalHeight = height + insets.top + insets.bottom;
  const totalWidth = width + insets.left + insets.right;
  const mediaWidth = totalWidth * 1.12;
  const mediaHeight = totalHeight * 1.12;
  const mediaStyle = {
    position: "absolute" as const,
    width: mediaWidth,
    height: mediaHeight,
    top: -insets.top - (mediaHeight - totalHeight) / 2,
    left: -insets.left - (mediaWidth - totalWidth) / 2,
  };

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
            top: mediaStyle.top,
            left: mediaStyle.left,
            width: mediaStyle.width,
            height: mediaStyle.height,
            objectFit: "cover",
          },
        })
      ) : (
        <>
          <Image source={HERO_POSTER} style={mediaStyle} resizeMode="cover" />
          <VideoView
            style={[mediaStyle, { opacity: videoReady ? 1 : 0 }]}
            player={player}
            contentFit="cover"
            nativeControls={false}
            allowsFullscreen={false}
            allowsPictureInPicture={false}
          />
        </>
      )}

      <LinearGradient
        colors={[
          "rgba(5,5,5,0.62)",
          "rgba(5,5,5,0.25)",
          "rgba(5,5,5,0.42)",
          "rgba(5,5,5,0.88)",
        ]}
        locations={[0, 0.26, 0.58, 1]}
        style={bleed}
      />
      <LinearGradient
        colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0)", "rgba(0,0,0,0.5)"]}
        start={{ x: 0, y: 0.15 }}
        end={{ x: 1, y: 0.7 }}
        style={bleed}
      />

      <Animated.View
        style={[
          styles.content,
          compact && styles.contentCompact,
          {
            paddingTop: insets.top + (compact ? 34 : 58),
            paddingBottom: insets.bottom + (compact ? 14 : 22),
            opacity: fade,
            transform: [{ translateY: lift }],
          },
        ]}
      >
        <View style={[styles.heroBlock, compact && styles.heroBlockCompact]}>
          <Text
            style={[
              styles.headline,
              isZhOS && styles.headlineZh,
              compact && styles.headlineCompact,
              compact && isZhOS && styles.headlineZhCompact,
            ]}
          >
            {isZhOS ? "\u5965\u623F" : "Project\nAlpha"}
          </Text>
          <Text style={[styles.stay, compact && styles.stayCompact]}>{t("welcome.stay_word")}</Text>
          <Text style={[styles.description, compact && styles.descriptionCompact]}>
            {t("welcome.description")}
          </Text>
        </View>

        <View style={[styles.bottomBlock, compact && styles.bottomBlockCompact]}>
          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.88}
            onPress={() => router.push("/(auth)/signup")}
          >
            <Text style={styles.primaryButtonText}>{t("welcome.cta_primary")}</Text>
            <Text style={styles.primaryButtonArrow}>{">"}</Text>
          </TouchableOpacity>

          <Pressable
            onPress={() => router.push("/(auth)/login")}
            hitSlop={10}
            style={({ pressed }) => [styles.loginLink, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={styles.loginText}>{t("welcome.cta_secondary")}</Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#050505",
  },
  content: {
    flex: 1,
    paddingHorizontal: 30,
    justifyContent: "flex-end",
    gap: 112,
  },
  contentCompact: {
    paddingHorizontal: 24,
    gap: 72,
  },
  heroBlock: {
    gap: 14,
  },
  heroBlockCompact: {
    gap: 10,
  },
  headline: {
    fontFamily: "Fraunces_700Bold",
    fontSize: 66,
    lineHeight: 72,
    color: "#FFFFFF",
    letterSpacing: 0,
    textShadowColor: "rgba(0,0,0,0.48)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  headlineCompact: {
    fontSize: 54,
    lineHeight: 60,
  },
  headlineZh: {
    fontFamily: Platform.select({
      ios: "PingFang SC",
      android: "sans-serif-condensed",
      default: "sans-serif",
    }),
    fontWeight: "800",
    fontSize: 76,
    lineHeight: 92,
    paddingTop: 6,
  },
  headlineZhCompact: {
    fontSize: 66,
    lineHeight: 80,
    paddingTop: 5,
  },
  stay: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 25,
    lineHeight: 32,
    color: "rgba(255,255,255,0.84)",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
    maxWidth: 335,
  },
  stayCompact: {
    fontSize: 22,
    lineHeight: 29,
  },
  description: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 16,
    lineHeight: 23,
    color: "rgba(255,255,255,0.78)",
    textShadowColor: "rgba(0,0,0,0.45)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 7,
    maxWidth: 340,
  },
  descriptionCompact: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 315,
  },
  bottomBlock: {
    gap: 18,
  },
  bottomBlockCompact: {
    gap: 12,
  },
  primaryButton: {
    height: 64,
    borderRadius: 13,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#D97757",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.22)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  primaryButtonText: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 19,
    lineHeight: 24,
    color: "#FFFFFF",
  },
  primaryButtonArrow: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_500Medium",
    fontSize: 42,
    lineHeight: 42,
    marginTop: -2,
  },
  loginLink: {
    alignSelf: "center",
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  loginText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
    color: "rgba(255,255,255,0.88)",
    textDecorationLine: "underline",
  },
});
