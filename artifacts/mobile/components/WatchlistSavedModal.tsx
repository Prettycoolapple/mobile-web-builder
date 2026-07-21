import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function WatchlistSavedModal({ visible, onClose }: Props) {
  const colors = useColors();
  const { t } = useT();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay} accessibilityViewIsModal>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={[styles.iconWrap, { backgroundColor: `${colors.accent}18` }]}>
            <Ionicons name="heart" size={27} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("watchlist.saved_popup.title")}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {t("watchlist.saved_popup.body")}
          </Text>

          <TouchableOpacity
            style={[styles.okButton, { backgroundColor: colors.accent }]}
            activeOpacity={0.84}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={t("watchlist.saved_popup.ok")}
          >
            <Text style={[styles.okButtonText, { color: colors.accentForeground }]}>
              {t("watchlist.saved_popup.ok")}
            </Text>
          </TouchableOpacity>
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
    padding: 24,
    backgroundColor: "rgba(20, 16, 13, 0.58)",
  },
  card: {
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 20,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 12,
  },
  iconWrap: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
    marginBottom: 18,
  },
  title: {
    fontFamily: "DM_Sans_700Bold",
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  body: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 9,
  },
  okButton: {
    width: "100%",
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    marginTop: 24,
    paddingHorizontal: 18,
  },
  okButtonText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 16,
  },
});
