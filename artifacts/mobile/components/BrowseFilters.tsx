import React from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { BrowseListingFilters } from "@/lib/browseListings";

const PROPERTY_TYPES = ["house", "townhouse", "apartment", "section"];

export function BrowseFilters({
  filters,
  onChange,
  onSubmit,
}: {
  filters: BrowseListingFilters;
  onChange: (next: BrowseListingFilters) => void;
  onSubmit: () => void;
}) {
  const colors = useColors();

  const set = (patch: BrowseListingFilters) => onChange({ ...filters, ...patch, cursor: null });
  const toggle = (key: keyof BrowseListingFilters, value: string) => {
    set({ [key]: filters[key] === value ? undefined : value } as BrowseListingFilters);
  };

  return (
    <View style={styles.wrap}>
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={15} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
          placeholder="Search suburb, city, or address"
          placeholderTextColor={colors.mutedForeground}
          value={filters.q ?? ""}
          onChangeText={(q) => set({ q })}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
        />
        <TouchableOpacity style={[styles.searchBtn, { backgroundColor: colors.accent }]} onPress={onSubmit} activeOpacity={0.8}>
          <Feather name="arrow-right" size={15} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Chip label="For sale" active={filters.listingType === "for_sale"} onPress={() => toggle("listingType", "for_sale")} />
        <Chip label="For rent" active={filters.listingType === "for_rent"} onPress={() => toggle("listingType", "for_rent")} />
        {PROPERTY_TYPES.map((type) => (
          <Chip
            key={type}
            label={type.charAt(0).toUpperCase() + type.slice(1)}
            active={filters.propertyType === type}
            onPress={() => toggle("propertyType", type)}
          />
        ))}
        <Chip label="2+ bed" active={filters.bedrooms === "2"} onPress={() => toggle("bedrooms", "2")} />
        <Chip label="3+ bed" active={filters.bedrooms === "3"} onPress={() => toggle("bedrooms", "3")} />
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        { backgroundColor: colors.card, borderColor: colors.border },
        active && { backgroundColor: colors.accent + "16", borderColor: colors.accent + "66" },
      ]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <Text style={[styles.chipText, { color: active ? colors.accent : colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 14,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 4 },
  searchBtn: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  chipRow: { gap: 8, paddingRight: 18 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12 },
});
