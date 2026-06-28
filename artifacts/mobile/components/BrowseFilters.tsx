import React, { useMemo } from "react";
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";
import type { BrowseListingFilters } from "@/lib/browseListings";

const PROPERTY_TYPES = ["house", "townhouse", "apartment", "unit", "section", "rural", "other"];
const BEDROOMS = ["1", "2", "3", "4", "5"];
const BATHROOMS = ["1", "2", "3"];
const SALE_METHODS = ["auction", "tender", "asking_price", "deadline_sale", "price_by_negotiation"];
const SORTS: NonNullable<BrowseListingFilters["sort"]>[] = ["recommended", "newest", "price_asc", "price_desc", "land_desc"];

export function BrowseFilters({
  filters,
  onChange,
  onSubmit,
  expanded,
  onExpandedChange,
}: {
  filters: BrowseListingFilters;
  onChange: (next: BrowseListingFilters) => void;
  onSubmit: () => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const colors = useColors();
  const { t } = useT();

  const set = (patch: Partial<BrowseListingFilters>) => onChange({ ...filters, ...patch, cursor: null });
  const toggle = (key: keyof BrowseListingFilters, value: string) => {
    set({ [key]: filters[key] === value ? undefined : value } as Partial<BrowseListingFilters>);
  };
  const clear = () => onChange({ listingType: "for_sale", limit: filters.limit ?? 5, sort: "recommended", cursor: null });
  const close = () => {
    Keyboard.dismiss();
    onExpandedChange(false);
  };
  const submit = () => {
    Keyboard.dismiss();
    onSubmit();
    onExpandedChange(false);
  };
  const activeFilters = useMemo(() => {
    const labels: string[] = [];
    if (filters.q?.trim()) labels.push(filters.q.trim());
    if (filters.propertyType) labels.push(t(`ptype.${filters.propertyType}`));
    if (filters.minPrice || filters.maxPrice) labels.push(`${filters.minPrice || "$0"}-${filters.maxPrice || t("browse.any")}`);
    if (filters.bedrooms) labels.push(t("browse.bedrooms_min", { n: filters.bedrooms }));
    if (filters.bathrooms) labels.push(t("browse.bathrooms_min", { n: filters.bathrooms }));
    if (filters.minLandArea) labels.push(t("browse.land_min", { n: filters.minLandArea }));
    if (filters.minFloorArea) labels.push(t("browse.floor_min", { n: filters.minFloorArea }));
    return labels;
  }, [filters, t]);

  return (
    <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.topRow}>
        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => {
            Keyboard.dismiss();
            onExpandedChange(!expanded);
          }}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={expanded ? t("browse.filters_hide") : t("browse.filters_show")}
        >
          <Feather name="sliders" size={16} color={colors.foreground} />
          <Text style={[styles.panelTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            {t("browse.filters")}
          </Text>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
        </TouchableOpacity>
        {expanded ? (
          <TouchableOpacity
            style={[styles.iconCloseBtn, { borderColor: colors.border }]}
            onPress={close}
            activeOpacity={0.78}
            accessibilityRole="button"
            accessibilityLabel={t("common.close")}
          >
            <Feather name="x" size={16} color={colors.foreground} />
          </TouchableOpacity>
        ) : null}
      </View>

      {activeFilters.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.summaryRow}>
          {activeFilters.map((label) => (
            <View key={label} style={[styles.summaryChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.summaryText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>{label}</Text>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {expanded ? (
        <View style={styles.expanded}>
          <Field
            icon="search"
            value={filters.q ?? ""}
            placeholder={t("browse.location_placeholder")}
            onChangeText={(q) => set({ q })}
            onSubmitEditing={submit}
          />

          <View style={styles.twoCol}>
            <Field value={filters.minPrice ?? ""} placeholder={t("browse.min_price")} keyboardType="number-pad" onChangeText={(minPrice) => set({ minPrice })} />
            <Field value={filters.maxPrice ?? ""} placeholder={t("browse.max_price")} keyboardType="number-pad" onChangeText={(maxPrice) => set({ maxPrice })} />
          </View>

          <Section label={t("browse.property_type")}>
            {PROPERTY_TYPES.map((type) => (
              <Chip key={type} label={t(`ptype.${type}`)} active={filters.propertyType === type} onPress={() => toggle("propertyType", type)} />
            ))}
          </Section>

          <Section label={t("browse.bedrooms")}>
            {BEDROOMS.map((n) => <Chip key={n} label={`${n}+`} active={filters.bedrooms === n} onPress={() => toggle("bedrooms", n)} />)}
          </Section>

          <Section label={t("browse.bathrooms")}>
            {BATHROOMS.map((n) => <Chip key={n} label={`${n}+`} active={filters.bathrooms === n} onPress={() => toggle("bathrooms", n)} />)}
          </Section>

          <View style={styles.twoCol}>
            <Field value={filters.minLandArea ?? ""} placeholder={t("browse.min_land")} keyboardType="number-pad" onChangeText={(minLandArea) => set({ minLandArea })} />
            <Field value={filters.minFloorArea ?? ""} placeholder={t("browse.min_floor")} keyboardType="number-pad" onChangeText={(minFloorArea) => set({ minFloorArea })} />
          </View>

          <Section label={t("browse.sale_method")}>
            {SALE_METHODS.map((method) => (
              <Chip key={method} label={t(`browse.method_${method}`)} active={filters.saleMethod === method} onPress={() => toggle("saleMethod", method)} />
            ))}
          </Section>

          <Section label={t("browse.sort")}>
            {SORTS.map((sort) => (
              <Chip key={sort} label={t(`browse.sort_${sort}`)} active={(filters.sort ?? "recommended") === sort} onPress={() => set({ sort })} />
            ))}
          </Section>

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.clearBtn, { borderColor: colors.border }]} onPress={clear} activeOpacity={0.78}>
              <Text style={[styles.clearText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{t("browse.clear")}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.applyLargeBtn, { backgroundColor: colors.accent }]} onPress={submit} activeOpacity={0.82}>
              <Text style={[styles.applyText, { fontFamily: "DM_Sans_700Bold" }]}>{t("browse.apply")}</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function Field(props: {
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  onSubmitEditing?: () => void;
  keyboardType?: "default" | "number-pad";
  icon?: keyof typeof Feather.glyphMap;
}) {
  const colors = useColors();
  return (
    <View style={[styles.field, { backgroundColor: colors.background, borderColor: colors.border }]}>
      {props.icon ? <Feather name={props.icon} size={14} color={colors.mutedForeground} /> : null}
      <TextInput
        style={[styles.input, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
        value={props.value}
        placeholder={props.placeholder}
        placeholderTextColor={colors.mutedForeground}
        onChangeText={props.onChangeText}
        onSubmitEditing={props.onSubmitEditing}
        returnKeyType="search"
        keyboardType={props.keyboardType ?? "default"}
      />
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold" }]}>{label}</Text>
      <View style={styles.chipWrap}>{children}</View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[
        styles.chip,
        { backgroundColor: colors.background, borderColor: colors.border },
        active && { backgroundColor: colors.accent + "16", borderColor: colors.accent + "70" },
      ]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <Text style={[styles.chipText, { color: active ? colors.accent : colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  expandButton: { flex: 1, minHeight: 36, flexDirection: "row", alignItems: "center", gap: 8 },
  panelTitle: { fontSize: 15 },
  iconCloseBtn: { width: 34, height: 34, borderWidth: 1, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  applyText: { color: "#fff", fontSize: 13 },
  summaryRow: { gap: 8, paddingRight: 6 },
  summaryChip: { maxWidth: 190, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  summaryText: { fontSize: 12 },
  expanded: { gap: 12 },
  field: { flex: 1, minWidth: 0, minHeight: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, fontSize: 14, paddingVertical: 4 },
  twoCol: { flexDirection: "row", gap: 10 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 12, textTransform: "uppercase" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { fontSize: 12 },
  actions: { flexDirection: "row", gap: 10, paddingTop: 2 },
  clearBtn: { flex: 1, minHeight: 40, borderWidth: 1, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  clearText: { fontSize: 13 },
  applyLargeBtn: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
