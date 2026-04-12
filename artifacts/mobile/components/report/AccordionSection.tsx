import React, { useState, useRef } from "react";
import { View, Text, TouchableOpacity, Animated, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type SectionStatus = "good" | "warning" | "risk" | "neutral";

interface Props {
  title: string;
  icon: string;
  status?: SectionStatus;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function statusColor(status: SectionStatus | undefined, colors: any) {
  switch (status) {
    case "good":    return colors.success;
    case "warning": return colors.amber;
    case "risk":    return colors.red;
    default:        return colors.mutedForeground;
  }
}

export function AccordionSection({ title, icon, status, defaultOpen = true, children }: Props) {
  const colors = useColors();
  const [open, setOpen] = useState(defaultOpen);
  const dot = statusColor(status, colors);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setOpen((o) => !o)}
        activeOpacity={0.7}
      >
        {status && status !== "neutral" && (
          <View style={[styles.dot, { backgroundColor: dot }]} />
        )}
        <Text style={styles.icon}>{icon}</Text>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold", flex: 1 }]}>
          {title}
        </Text>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={15} color={colors.mutedForeground} />
      </TouchableOpacity>
      {open && (
        <View style={[styles.body, { borderTopColor: colors.border }]}>
          {children}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(28,25,23,0.04)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 7,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 1,
  },
  icon: {
    fontSize: 15,
  },
  title: {
    fontSize: 14,
  },
  body: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 16,
    paddingTop: 12,
    gap: 0,
  },
});
