import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Modal, TextInput, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

type Rating = "up" | "down";

interface Props {
  sessionRating?: Rating;
  onRate: (rating: Rating, reason?: string) => void;
}

export function ResponseRatingBar({ sessionRating, onRate }: Props) {
  const colors = useColors();
  const { t } = useT();
  const [downModalOpen, setDownModalOpen] = useState(false);
  const [reasonText, setReasonText] = useState("");

  if (sessionRating) {
    return (
      <View
        style={[
          styles.wrap,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
          {t("search.rating_thanks")}
        </Text>
      </View>
    );
  }

  const handleUp = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onRate("up");
  };

  const openDownModal = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setReasonText("");
    setDownModalOpen(true);
  };

  const closeDownModal = () => {
    setDownModalOpen(false);
    setReasonText("");
  };

  const submitDownReason = () => {
    const trimmed = reasonText.trim();
    if (!trimmed) return;
    onRate("down", trimmed);
    setDownModalOpen(false);
    setReasonText("");
  };

  const canSubmit = reasonText.trim().length > 0;

  return (
    <>
      <View
        style={[
          styles.wrap,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
          {t("search.rating_prompt")}
        </Text>
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.background }]}
            onPress={openDownModal}
            accessibilityRole="button"
            accessibilityLabel={t("search.rating_down_a11y")}
            activeOpacity={0.75}
          >
            <Feather name="thumbs-down" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { borderColor: colors.accent + "55", backgroundColor: colors.accent + "14" }]}
            onPress={handleUp}
            accessibilityRole="button"
            accessibilityLabel={t("search.rating_up_a11y")}
            activeOpacity={0.75}
          >
            <Feather name="thumbs-up" size={18} color={colors.accent} />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={downModalOpen}
        animationType="fade"
        transparent
        onRequestClose={closeDownModal}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={closeDownModal} />
          <View style={styles.modalCenter} pointerEvents="box-none">
            <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                {t("feedback.down_reason.title")}
              </Text>
              <TextInput
                value={reasonText}
                onChangeText={setReasonText}
                placeholder={t("feedback.down_reason.placeholder")}
                placeholderTextColor={colors.mutedForeground}
                multiline
                numberOfLines={3}
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                    fontFamily: "DM_Sans_400Regular",
                  },
                ]}
                autoFocus
              />
              <Text style={[styles.helper, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("feedback.down_reason.required")}
              </Text>
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={closeDownModal}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.cancelText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {t("feedback.down_reason.cancel")}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    { backgroundColor: canSubmit ? colors.accent : colors.border, opacity: canSubmit ? 1 : 0.6 },
                  ]}
                  onPress={submitDownReason}
                  disabled={!canSubmit}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.submitText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                    {t("feedback.down_reason.submit")}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
  },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  modalRoot: {
    flex: 1,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    lineHeight: 22,
  },
  input: {
    minHeight: 84,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  helper: {
    fontSize: 12,
    lineHeight: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cancelText: {
    fontSize: 14,
  },
  submitBtn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },
  submitText: {
    fontSize: 14,
    color: "#fff",
  },
});
