import React, { useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather, FontAwesome } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

interface Props {
  visible: boolean;
  onSubmit: (rating: number) => void;
  onDismiss: () => void;
}

export function AppRatingPrompt({ visible, onSubmit, onDismiss }: Props) {
  const colors = useColors();
  const { t } = useT();
  const [rating, setRating] = useState(0);

  const handlePick = (value: number) => {
    setRating(value);
    void Haptics.selectionAsync();
  };

  const handleSubmit = () => {
    if (rating <= 0) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSubmit(rating);
    setRating(0);
  };

  const handleDismiss = () => {
    setRating(0);
    onDismiss();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={handleDismiss}>
      <Pressable style={styles.backdrop} onPress={handleDismiss}>
        <Pressable
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={[styles.iconWrap, { backgroundColor: colors.accent + "18" }]}>
            <Feather name="star" size={22} color={colors.accent} />
          </View>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Fraunces_600SemiBold" }]}>
            {t("app_rating.title")}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("app_rating.body")}
          </Text>

          <View style={styles.stars}>
            {[1, 2, 3, 4, 5].map((value) => (
              <TouchableOpacity
                key={value}
                activeOpacity={0.75}
                onPress={() => handlePick(value)}
                accessibilityRole="button"
                accessibilityLabel={t("app_rating.star_a11y", { n: value })}
                style={styles.starButton}
              >
                <FontAwesome
                  name={value <= rating ? "star" : "star-o"}
                  size={34}
                  color={value <= rating ? colors.amber : colors.border}
                />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.75}
              onPress={handleDismiss}
              style={[styles.secondaryBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
            >
              <Text style={[styles.secondaryText, { color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold" }]}>
                {t("app_rating.not_now")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={rating > 0 ? 0.75 : 1}
              onPress={handleSubmit}
              disabled={rating <= 0}
              style={[
                styles.primaryBtn,
                { backgroundColor: rating > 0 ? colors.accent : colors.muted },
              ]}
            >
              <Text
                style={[
                  styles.primaryText,
                  { color: rating > 0 ? colors.accentForeground : colors.mutedForeground, fontFamily: "DM_Sans_700Bold" },
                ]}
              >
                {t("app_rating.submit")}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    padding: 22,
    alignItems: "center",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    textAlign: "center",
    marginBottom: 8,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  stars: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    marginBottom: 22,
  },
  starButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
  },
  secondaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  primaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryText: {
    fontSize: 14,
  },
  primaryText: {
    fontSize: 14,
  },
});
