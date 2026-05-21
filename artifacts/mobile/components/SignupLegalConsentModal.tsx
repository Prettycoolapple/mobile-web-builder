import React from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

const PRIVACY_URL = "https://www.projectalpha.app/privacy/";
const TERMS_URL = "https://www.projectalpha.app/terms/";
const LINK_BLUE = "#2563EB";

interface Props {
  visible: boolean;
  accepted: boolean;
  loading?: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  onCancel: () => void;
  onComplete: () => void;
}

export function SignupLegalConsentModal({
  visible,
  accepted,
  loading = false,
  onAcceptedChange,
  onCancel,
  onComplete,
}: Props) {
  const colors = useColors();
  const { t } = useT();
  const canComplete = accepted && !loading;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={loading ? undefined : onCancel}
    >
      <View style={styles.root}>
        <Pressable
          style={styles.backdrop}
          onPress={loading ? undefined : onCancel}
        />
        <View style={styles.center} pointerEvents="box-none">
          <View style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t("signup.legal.title")}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {t("signup.legal.body_prefix")}{" "}
              <Text
                style={styles.link}
                onPress={() => void Linking.openURL(PRIVACY_URL)}
              >
                {t("signup.legal.privacy")}
              </Text>
              {" "}
              {t("signup.legal.body_middle")}{" "}
              <Text
                style={styles.link}
                onPress={() => void Linking.openURL(TERMS_URL)}
              >
                {t("signup.legal.terms")}
              </Text>
              {t("signup.legal.body_suffix")}
            </Text>

            <TouchableOpacity
              style={[styles.checkboxRow, { borderColor: colors.border, backgroundColor: colors.background }]}
              activeOpacity={0.78}
              onPress={() => onAcceptedChange(!accepted)}
              disabled={loading}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    borderColor: accepted ? colors.accent : colors.border,
                    backgroundColor: accepted ? colors.accent : "transparent",
                  },
                ]}
              >
                {accepted ? <Feather name="check" size={15} color="#fff" /> : null}
              </View>
              <Text style={[styles.checkboxText, { color: colors.foreground }]}>
                {t("signup.legal.checkbox")}
              </Text>
            </TouchableOpacity>

            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.cancelBtn, { borderColor: colors.border }]}
                onPress={onCancel}
                disabled={loading}
              >
                <Text style={[styles.cancelText, { color: colors.foreground }]}>
                  {t("common.cancel")}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.completeBtn,
                  { backgroundColor: canComplete ? colors.accent : colors.muted },
                ]}
                onPress={onComplete}
                disabled={!canComplete}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.completeText}>{t("signup.legal.complete")}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    borderRadius: 16,
    padding: 20,
    gap: 16,
  },
  title: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 20,
    lineHeight: 26,
  },
  body: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    lineHeight: 21,
  },
  link: {
    color: LINK_BLUE,
    fontFamily: "DM_Sans_600SemiBold",
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxText: {
    flex: 1,
    fontFamily: "DM_Sans_500Medium",
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
  },
  completeBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  completeText: {
    color: "#fff",
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
  },
});
