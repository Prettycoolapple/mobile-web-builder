import React, { useEffect, useMemo, useState } from "react";
import {
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Asset } from "expo-asset";
import { useVideoPlayer, VideoView } from "expo-video";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

type StepId = "planning" | "consultant" | "upgrade" | "launch";

interface Props {
  visible: boolean;
  showUpgradeSlide: boolean;
  onCancel: () => void;
  onComplete: () => void;
}

const STEP_ICONS: Record<StepId, keyof typeof Feather.glyphMap> = {
  planning: "grid",
  consultant: "users",
  upgrade: "lock",
  launch: "calendar",
};

const DEMO_VIDEO = require("../../assets/videos/ai-subdivision.mp4");
const DEMO_POSTER = require("../../assets/videos/ai-subdivision-poster.jpg");
const DEMO_VIDEO_URI = Asset.fromModule(DEMO_VIDEO).uri;
const DEMO_POSTER_URI = Asset.fromModule(DEMO_POSTER).uri;
const DEMO_ASPECT = 1596 / 1270;

export function AiSubdivisionIntroModal({
  visible,
  showUpgradeSlide,
  onCancel,
  onComplete,
}: Props) {
  const colors = useColors();
  const { t } = useT();
  const { height: winHeight } = useWindowDimensions();
  const [stepIndex, setStepIndex] = useState(0);
  const [showPaymentConfirmation, setShowPaymentConfirmation] = useState(false);
  const [demoVideoReady, setDemoVideoReady] = useState(false);
  const steps = useMemo<StepId[]>(
    () =>
      showUpgradeSlide
        ? ["planning", "consultant", "upgrade", "launch"]
        : ["planning", "consultant", "launch"],
    [showUpgradeSlide],
  );

  useEffect(() => {
    if (visible) {
      setStepIndex(0);
      setShowPaymentConfirmation(false);
    }
  }, [visible]);

  const step = steps[Math.min(stepIndex, steps.length - 1)] ?? "planning";
  const isFinal = step === "launch";

  // Mounted (and pre-buffering) as soon as this component renders, regardless of `visible` —
  // the parent keeps this modal mounted permanently, so by the time the user taps the button
  // the player has long since decoded frame 0. We deliberately don't call play() here: play/pause
  // is driven below by whether slide 1 is actually on screen, so the video never runs unseen.
  const demoPlayer = useVideoPlayer(DEMO_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
  });

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = demoPlayer.addListener("statusChange", ({ status }) => {
      if (status === "readyToPlay") setDemoVideoReady(true);
    });
    return () => sub.remove();
  }, [demoPlayer]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (visible && step === "planning") {
      demoPlayer.currentTime = 0;
      demoPlayer.play();
    } else {
      demoPlayer.pause();
    }
  }, [visible, step, demoPlayer]);

  const demoMediaMaxHeight = Math.max(150, Math.min(300, winHeight * 0.3));
  const title = t(`site_plan.ai_modal.${step}.title`);
  const body = t(`site_plan.ai_modal.${step}.body`);
  const primaryLabel = isFinal
    ? t("site_plan.ai_modal.ok")
    : step === "upgrade"
      ? t("site_plan.ai_modal.pay_now")
      : t("site_plan.ai_modal.next");

  const standardFeatures = [
    t("paywall.f1"),
    t("feature.private_search"),
    t("paywall.f2"),
    t("paywall.f3"),
    t("paywall.f4"),
    t("paywall.f5"),
    t("paywall.f6"),
  ];

  const handlePrimary = () => {
    if (isFinal) {
      onComplete();
      return;
    }
    if (step === "upgrade") {
      setShowPaymentConfirmation(true);
      return;
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const confirmPaymentInterest = () => {
    setShowPaymentConfirmation(false);
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={
        showPaymentConfirmation
          ? () => setShowPaymentConfirmation(false)
          : isFinal
            ? () => {}
            : onCancel
      }
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          disabled={isFinal}
          onPress={onCancel}
          accessibilityElementsHidden
        />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <ScrollView
            style={styles.contentScroll}
            contentContainerStyle={styles.contentScrollContainer}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View
              style={[styles.iconWrap, { backgroundColor: `${colors.accent}18` }]}
            >
              <Feather name={STEP_ICONS[step]} size={24} color={colors.accent} />
            </View>

            <View style={styles.copyWrap}>
              <Text style={[styles.title, { color: colors.foreground }]}>
                {title}
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                {body}
              </Text>
              {step === "planning" ? (
                <View
                  style={[
                    styles.demoMediaWrap,
                    {
                      maxWidth: demoMediaMaxHeight * DEMO_ASPECT,
                      backgroundColor: colors.muted,
                    },
                  ]}
                  accessible
                  accessibilityLabel={t("site_plan.ai_modal.planning.demo_alt")}
                >
                  {Platform.OS === "web" ? (
                    React.createElement("video", {
                      src: DEMO_VIDEO_URI,
                      poster: DEMO_POSTER_URI,
                      autoPlay: true,
                      muted: true,
                      loop: true,
                      playsInline: true,
                      preload: "auto",
                      style: {
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      },
                    })
                  ) : (
                    <>
                      <Image
                        source={DEMO_POSTER}
                        style={StyleSheet.absoluteFill}
                        resizeMode="contain"
                      />
                      <VideoView
                        style={[
                          StyleSheet.absoluteFill,
                          { opacity: demoVideoReady ? 1 : 0 },
                        ]}
                        player={demoPlayer}
                        contentFit="contain"
                        nativeControls={false}
                        allowsFullscreen={false}
                        allowsPictureInPicture={false}
                      />
                    </>
                  )}
                </View>
              ) : null}
              {step === "planning" ? (
                <View
                  style={[
                    styles.note,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Feather name="map-pin" size={14} color={colors.accent} />
                  <Text style={[styles.noteText, { color: colors.foreground }]}>
                    {t("site_plan.ai_modal.planning.note")}
                  </Text>
                </View>
              ) : null}
              {step === "upgrade" ? (
                <View style={styles.featuresList}>
                  {standardFeatures.map((feature) => (
                    <View key={feature} style={styles.featureRow}>
                      <Feather name="check" size={15} color={colors.success} />
                      <Text style={[styles.featureText, { color: colors.foreground }]}>
                        {feature}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                step === "upgrade" ? styles.primaryButtonUpgrade : null,
                { backgroundColor: colors.accent },
              ]}
              activeOpacity={0.84}
              onPress={handlePrimary}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
            >
              <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
              {step === "upgrade" ? (
                <Text style={styles.primaryButtonPrice}>
                  {t("site_plan.ai_modal.standard_price")}
                </Text>
              ) : !isFinal ? (
                <Feather name="arrow-right" size={17} color="#FFFFFF" />
              ) : null}
            </TouchableOpacity>
            {!isFinal ? (
              <TouchableOpacity
                style={styles.cancelButton}
                activeOpacity={0.7}
                onPress={onCancel}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.cancelButtonText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("site_plan.ai_modal.cancel")}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {showPaymentConfirmation ? (
            <View style={styles.confirmationOverlay} accessibilityViewIsModal>
              <TouchableOpacity
                style={StyleSheet.absoluteFill}
                activeOpacity={1}
                onPress={() => setShowPaymentConfirmation(false)}
                accessibilityElementsHidden
              />
              <View
                style={[
                  styles.confirmationCard,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View
                  style={[
                    styles.confirmationIcon,
                    { backgroundColor: `${colors.accent}18` },
                  ]}
                >
                  <Feather name="credit-card" size={22} color={colors.accent} />
                </View>
                <Text style={[styles.confirmationTitle, { color: colors.foreground }]}>
                  {t("site_plan.ai_modal.confirm_payment.title")}
                </Text>
                <Text
                  style={[
                    styles.confirmationMessage,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {t("site_plan.ai_modal.confirm_payment.message")}
                </Text>
                <View style={styles.confirmationActions}>
                  <TouchableOpacity
                    style={[styles.confirmationButton, { borderColor: colors.border }]}
                    activeOpacity={0.75}
                    onPress={() => setShowPaymentConfirmation(false)}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.confirmationCancelText,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {t("site_plan.ai_modal.cancel")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.confirmationButton,
                      { backgroundColor: colors.accent, borderColor: colors.accent },
                    ]}
                    activeOpacity={0.84}
                    onPress={confirmPaymentInterest}
                    accessibilityRole="button"
                  >
                    <Text style={styles.confirmationConfirmText}>
                      {t("site_plan.ai_modal.confirm")}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: "rgba(20, 16, 13, 0.58)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 18,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 12,
    maxHeight: "90%",
  },
  contentScroll: {
    width: "100%",
    flexShrink: 1,
  },
  contentScrollContainer: {
    alignItems: "center",
    paddingTop: 4,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  copyWrap: {
    width: "100%",
    alignItems: "center",
  },
  title: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.4,
    textAlign: "center",
  },
  body: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 10,
  },
  demoMediaWrap: {
    alignSelf: "center",
    width: "100%",
    aspectRatio: DEMO_ASPECT,
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 18,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "stretch",
    gap: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    paddingVertical: 11,
    marginTop: 18,
  },
  noteText: {
    flex: 1,
    fontFamily: "DM_Sans_500Medium",
    fontSize: 12,
    lineHeight: 17,
  },
  featuresList: {
    alignSelf: "stretch",
    gap: 10,
    marginTop: 20,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  featureText: {
    flex: 1,
    fontFamily: "DM_Sans_400Regular",
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    width: "100%",
    gap: 4,
    marginTop: 22,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  primaryButtonUpgrade: {
    flexDirection: "column",
    gap: 1,
    paddingVertical: 7,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
  },
  primaryButtonPrice: {
    color: "rgba(255,255,255,0.88)",
    fontFamily: "DM_Sans_500Medium",
    fontSize: 13,
  },
  cancelButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
  },
  confirmationOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    padding: 18,
    backgroundColor: "rgba(20, 16, 13, 0.48)",
  },
  confirmationCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 20,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 16,
  },
  confirmationIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  confirmationTitle: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 20,
    lineHeight: 26,
    textAlign: "center",
  },
  confirmationMessage: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
  confirmationActions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 22,
  },
  confirmationButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  confirmationCancelText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
  },
  confirmationConfirmText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 14,
  },
});
