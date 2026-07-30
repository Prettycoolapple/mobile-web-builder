import React, { useEffect, useMemo, useState } from "react";
import {
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
import { ResizeMode, Video } from "expo-av";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

// "launch" is the pre-release "Launching 31 July 2026" notice. Rubin is live, so
// it is HIDDEN rather than removed — the slide, its icon and its copy all stay
// put so it can be restored by adding it back to `steps` below. The funnel now
// ends on the last real slide and opens Rubin from there.
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

function NativeDemoVideo({
  shouldPlay,
  fallbackLabel,
  fallbackColor,
}: {
  shouldPlay: boolean;
  fallbackLabel: string;
  fallbackColor: string;
}) {
  const [playbackFailed, setPlaybackFailed] = useState(false);

  useEffect(() => {
    if (shouldPlay) setPlaybackFailed(false);
  }, [shouldPlay]);

  if (playbackFailed) {
    return (
      <View style={styles.videoFallback}>
        <Feather name="alert-circle" size={20} color={fallbackColor} />
        <Text style={[styles.videoFallbackText, { color: fallbackColor }]}>
          {fallbackLabel}
        </Text>
      </View>
    );
  }

  return (
    <Video
      source={DEMO_VIDEO}
      style={StyleSheet.absoluteFill}
      resizeMode={ResizeMode.COVER}
      shouldPlay={shouldPlay}
      positionMillis={shouldPlay ? 0 : undefined}
      isLooping
      isMuted
      useNativeControls={false}
      onError={() => setPlaybackFailed(true)}
    />
  );
}

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
  // "launch" is deliberately absent — see the StepId note. Re-adding it here is
  // all that is needed to bring the pre-release notice back.
  const steps = useMemo<StepId[]>(
    () =>
      showUpgradeSlide
        ? ["planning", "consultant", "upgrade"]
        : ["planning", "consultant"],
    [showUpgradeSlide],
  );

  useEffect(() => {
    if (visible) {
      setStepIndex(0);
      setShowPaymentConfirmation(false);
    }
  }, [visible]);

  const step = steps[Math.min(stepIndex, steps.length - 1)] ?? "planning";
  // Whichever slide is last — not a named step — so hiding or restoring a slide
  // cannot leave the funnel with no way to finish.
  const isFinal = stepIndex >= steps.length - 1;

  const demoMediaMaxHeight = Math.max(150, Math.min(300, winHeight * 0.3));
  const title = t(`site_plan.ai_modal.${step}.title`);
  const body = t(`site_plan.ai_modal.${step}.body`);
  // Same precedence as handlePrimary: upgrade wins over isFinal, or the payment
  // slide would be labelled with the action that comes after it.
  const primaryLabel =
    step === "upgrade"
      ? t("site_plan.ai_modal.pay_now")
      : isFinal
        ? t("site_plan.ai_modal.run_now")
        : t("site_plan.ai_modal.next");

  const standardFeatures = [
    t("site_plan.ai_modal.upgrade.f1"),
    t("feature.private_search"),
  ];

  const handlePrimary = () => {
    // The upgrade slide is checked BEFORE `isFinal`. With the launch slide
    // hidden, upgrade is the last step for free users, and testing `isFinal`
    // first would skip the payment confirmation entirely.
    if (step === "upgrade") {
      setShowPaymentConfirmation(true);
      return;
    }
    if (isFinal) {
      onComplete();
      return;
    }
    setStepIndex((current) => Math.min(current + 1, steps.length - 1));
  };

  const confirmPaymentInterest = () => {
    setShowPaymentConfirmation(false);
    // Upgrade is the final slide once "launch" is hidden, so confirming payment
    // finishes the funnel rather than advancing to a step that does not exist.
    if (isFinal) {
      onComplete();
      return;
    }
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
                    visible ? (
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
                          objectFit: "cover",
                        },
                      })
                    ) : null
                  ) : (
                    <NativeDemoVideo
                      shouldPlay={visible}
                      fallbackLabel={t("site_plan.ai_modal.planning.video_unavailable")}
                      fallbackColor={colors.mutedForeground}
                    />
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
  videoFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  videoFallbackText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
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
