import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { useColors } from "@/hooks/useColors";

interface Option {
  label: string;
  value: string;
}

interface MultiSelectChipsProps {
  options: Option[];
  selected: string[];
  onChange: (selected: string[]) => void;
  singleSelect?: boolean;
}

export function MultiSelectChips({ options, selected, onChange, singleSelect }: MultiSelectChipsProps) {
  const colors = useColors();

  const toggle = (value: string) => {
    if (singleSelect) {
      onChange([value]);
      return;
    }
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <View style={styles.wrap}>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => toggle(opt.value)}
            activeOpacity={0.7}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.accent : colors.card,
                borderColor: active ? colors.accent : colors.border,
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                {
                  color: active ? "#fff" : colors.foreground,
                  fontFamily: active ? "DM_Sans_600SemiBold" : "DM_Sans_400Regular",
                },
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
});
