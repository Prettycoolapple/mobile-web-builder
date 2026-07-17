import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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

export function AiSubdivisionIntroModal({
  visible,
  showUpgradeSlide,
  onCancel,
  onComplete,
}: Props) {
  const colors = useColors();
  const { t } = useT();
  const [stepIndex, setStepIndex] = useState(0);
  const steps = useMemo<StepId[]>(
    () =>
      showUpgradeSlide
        ? ["planning", "consultant", "upgrade", "launch"]
        : ["planning", "consultant", "launch"],
    [showUpgradeSlide],
  );

  useEffect(() => {
    if (visible) setStepIndex(0);
  }, [visible]);

  const step = steps[Math.min(stepIndex, steps.length - 1)] ?? "planning";
  const isFinal = step === "launch";
  const title = t(`site_plan.ai_modal.${step}.title`);
  const body = t(`site_plan.ai_modal.${step}.body`);
  const primaryLabel = isFinal
    ? t("site_plan.ai_modal.ok")
    : step === "upgrade"
      ? t("site_plan.ai_modal.upgrade")
      : t("site_plan.ai_modal.next");

  const handlePrimary = () => {
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
      onRequestClose={isFinal ? () => {} : onCancel}
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
          <View
            style={styles.progressRow}
            accessibilityLabel={t("site_plan.ai_modal.progress", {
              current: stepIndex + 1,
              total: steps.length,
            })}
          >
            {steps.map((item, index) => (
              <View
                key={item}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor:
                      index <= stepIndex ? colors.accent : colors.border,
                  },
                ]}
              />
            ))}
          </View>

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
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              activeOpacity={0.84}
              onPress={handlePrimary}
              accessibilityRole="button"
              accessibilityLabel={primaryLabel}
            >
              <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
              {!isFinal ? (
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
  },
  progressRow: {
    flexDirection: "row",
    gap: 7,
    marginBottom: 24,
  },
  progressDot: {
    width: 24,
    height: 4,
    borderRadius: 2,
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
  primaryButtonText: {
    color: "#FFFFFF",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
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
});
