import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface OverlayChipProps {
  name: string;
  status: "clear" | "moderate" | "restricted";
  detail?: string;
}

export function OverlayChip({ name, status, detail }: OverlayChipProps) {
  const colors = useColors();

  const config = {
    clear: { color: colors.success, icon: "check-circle" as const, label: "Clear" },
    moderate: { color: colors.amber, icon: "alert-circle" as const, label: "Moderate" },
    restricted: { color: colors.red, icon: "x-circle" as const, label: "Restricted" },
  }[status];

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <View style={[styles.chip, { backgroundColor: config.color + "15", borderColor: config.color + "35" }]}>
          <Feather name={config.icon} size={13} color={config.color} />
          <Text style={[styles.statusText, { color: config.color, fontFamily: "DM_Sans_600SemiBold" }]}>
            {config.label}
          </Text>
        </View>
        <Text style={[styles.name, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
          {name}
        </Text>
      </View>
      {detail && (
        <Text style={[styles.detail, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          {detail}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    paddingVertical: 8,
    gap: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: 1,
  },
  statusText: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  name: {
    fontSize: 13,
    flex: 1,
  },
  detail: {
    fontSize: 12,
    lineHeight: 17,
    paddingLeft: 2,
  },
});
