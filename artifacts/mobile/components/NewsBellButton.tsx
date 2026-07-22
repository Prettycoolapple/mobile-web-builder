import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useNews } from "@/context/NewsContext";
import { useT } from "@/lib/i18n";

export function NewsBellButton({ color = "rgba(250,249,246,0.88)" }: { color?: string }) {
  const router = useRouter();
  const { hasUnread, markCurrentNewsSeen } = useNews();
  const { t } = useT();
  return <Pressable
    style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    accessibilityRole="button"
    accessibilityLabel={t("news.open")}
    onPress={() => {
      void markCurrentNewsSeen();
      router.push("/news" as never);
    }}
    hitSlop={8}
  >
    <Feather name="bell" size={21} color={color} />
    {hasUnread && <View testID="news-unread-dot" style={styles.dot} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 38, height: 38, alignItems: "center", justifyContent: "center", position: "relative", borderRadius: 19 },
  pressed: { opacity: 0.65 },
  dot: { position: "absolute", right: 7, top: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: "#EF4444", borderWidth: 1.5, borderColor: "#2C1F16" },
});
