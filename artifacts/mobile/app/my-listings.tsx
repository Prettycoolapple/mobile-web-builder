import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Modal,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { getApiBase as resolveApiBase } from "@/lib/api";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";

type Listing = {
  id: string;
  address: string;
  addressSuburb?: string | null;
  addressCity?: string | null;
  listingType: "for_sale" | "for_rent";
  propertyType: string;
  status: "draft" | "active" | "sold" | "withdrawn";
  bedrooms?: number | null;
  bathrooms?: number | null;
  garages?: number | null;
  landAreaSqm?: number | null;
  floorAreaSqm?: number | null;
  priceDisplay?: string | null;
  priceNzd?: number | null;
  imageUrls: string[];
  features: string[];
  description?: string | null;
  createdAt: string;
};

export default function MyListingsScreen() {
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const { t } = useT();

  const STATUS_LABELS: Record<string, string> = {
    active: t("listing.status.active"),
    sold: t("listing.status.sold"),
    withdrawn: t("listing.status.withdrawn"),
    draft: t("listing.status.draft"),
  };

  const STATUS_OPTIONS: { key: Listing["status"]; label: string }[] = [
    { key: "active", label: t("listing.status.active") },
    { key: "sold", label: t("listing.status.sold") },
    { key: "withdrawn", label: t("listing.status.withdrawn") },
  ];

  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusModalId, setStatusModalId] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const getApiBase = useCallback(() => resolveApiBase(), []);

  const fetchListings = useCallback(async () => {
    try {
      const resp = await fetch(`${getApiBase()}/listings/my`, {
        headers: getApiHeaders(),
      });
      if (!resp.ok) return;
      const data = (await resp.json()) as { listings: Listing[] };
      setListings(data.listings ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getApiBase, getApiHeaders]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchListings();
  }, [fetchListings]);

  const handleDelete = useCallback(
    (id: string, address: string) => {
      Alert.alert(
        t("listing.delete_title"),
        t("listing.delete_msg", { address }),
        [
          { text: t("common.cancel"), style: "cancel" },
          {
            text: t("common.delete"),
            style: "destructive",
            onPress: async () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              try {
                const resp = await fetch(`${getApiBase()}/listings/${id}`, {
                  method: "DELETE",
                  headers: getApiHeaders(),
                });
                if (resp.ok) {
                  setListings((prev) => prev.filter((l) => l.id !== id));
                } else {
                  Alert.alert(t("common.error"), t("listing.delete_error"));
                }
              } catch {
                Alert.alert(t("common.error"), t("common.try_again_later"));
              }
            },
          },
        ]
      );
    },
    [getApiBase, getApiHeaders, t]
  );

  const handleStatusChange = useCallback(
    async (id: string, newStatus: Listing["status"]) => {
      setUpdatingStatus(true);
      try {
        const resp = await fetch(`${getApiBase()}/listings/${id}`, {
          method: "PATCH",
          headers: { ...getApiHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (resp.ok) {
          setListings((prev) =>
            prev.map((l) => (l.id === id ? { ...l, status: newStatus } : l))
          );
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch {
        Alert.alert(t("common.error"), t("listing.update_status_error"));
      } finally {
        setUpdatingStatus(false);
        setStatusModalId(null);
      }
    },
    [getApiBase, getApiHeaders, t]
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return colors.success;
      case "sold": return colors.accent;
      case "withdrawn": return colors.mutedForeground;
      default: return colors.warning;
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: Listing }) => {
      const coverImage = item.imageUrls?.[0];
      const statusColor = getStatusColor(item.status);

      return (
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, shadowColor: colors.shadow }]}>
          {/* Cover image */}
          {coverImage ? (
            <Image source={{ uri: coverImage.startsWith("/api/") ? `${getApiBase().replace("/api", "")}${coverImage}` : coverImage }} style={styles.coverImage} />
          ) : (
            <View style={[styles.coverPlaceholder, { backgroundColor: colors.muted }]}>
              <Feather name="home" size={32} color={colors.mutedForeground} />
              <Text style={[styles.coverPlaceholderText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("listing.no_photos")}</Text>
            </View>
          )}

          <View style={styles.cardBody}>
            {/* Address + status row */}
            <View style={styles.cardTopRow}>
              <Text style={[styles.cardAddress, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={1}>
                {item.address}
              </Text>
              <TouchableOpacity
                style={[styles.statusBadge, { backgroundColor: statusColor + "20", borderColor: statusColor + "50" }]}
                onPress={() => setStatusModalId(item.id)}
                activeOpacity={0.75}
              >
                <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                <Text style={[styles.statusText, { color: statusColor, fontFamily: "DM_Sans_500Medium" }]}>
                  {STATUS_LABELS[item.status]}
                </Text>
                <Feather name="chevron-down" size={11} color={statusColor} />
              </TouchableOpacity>
            </View>

            {/* Listing type + property type */}
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {item.listingType === "for_sale" ? t("listing.for_sale") : t("listing.for_rent")} · {item.propertyType.charAt(0).toUpperCase() + item.propertyType.slice(1)}
            </Text>

            {/* Price */}
            {item.priceDisplay && (
              <Text style={[styles.cardPrice, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
                {item.priceDisplay}
              </Text>
            )}

            {/* Stats row */}
            <View style={styles.statsRow}>
              {(item.bedrooms ?? 0) > 0 && (
                <View style={styles.statItem}>
                  <Feather name="home" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.statText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("listing.stat_bd", { n: item.bedrooms ?? 0 })}</Text>
                </View>
              )}
              {(item.bathrooms ?? 0) > 0 && (
                <View style={styles.statItem}>
                  <Feather name="droplet" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.statText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("listing.stat_ba", { n: item.bathrooms ?? 0 })}</Text>
                </View>
              )}
              {(item.garages ?? 0) > 0 && (
                <View style={styles.statItem}>
                  <Feather name="truck" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.statText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("listing.stat_gar", { n: item.garages ?? 0 })}</Text>
                </View>
              )}
              {item.landAreaSqm && (
                <View style={styles.statItem}>
                  <Feather name="maximize-2" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.statText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{item.landAreaSqm.toLocaleString()}m²</Text>
                </View>
              )}
            </View>

            {/* Action buttons */}
            <View style={[styles.actionRow, { borderTopColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.accent + "14" }]}
                onPress={() => router.push({ pathname: "/add-listing", params: { id: item.id } })}
                activeOpacity={0.8}
              >
                <Feather name="edit-2" size={14} color={colors.accent} />
                <Text style={[styles.actionBtnText, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]}>{t("listing.edit")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: colors.destructive + "12" }]}
                onPress={() => handleDelete(item.id, item.address)}
                activeOpacity={0.8}
              >
                <Feather name="trash-2" size={14} color={colors.destructive} />
                <Text style={[styles.actionBtnText, { color: colors.destructive, fontFamily: "DM_Sans_500Medium" }]}>{t("listing.delete")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [colors, router, handleDelete, getApiBase, t]
  );

  const keyExtractor = useCallback((item: Listing) => item.id, []);

  const activeStatusListing = listings.find((l) => l.id === statusModalId);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg, borderBottomColor: colors.accent + "22" }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color="rgba(250,249,246,0.8)" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { fontFamily: "DM_Sans_700Bold", color: "#FAFAF9" }]}>{t("listing.my_title")}</Text>
        <TouchableOpacity
          style={[styles.headerAddBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.push("/add-listing")}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={16} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : listings.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIconCircle, { backgroundColor: colors.accent + "18" }]}>
            <Feather name="home" size={36} color={colors.accent} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("listing.empty_title")}</Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("listing.empty_subtitle")}
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
            onPress={() => router.push("/add-listing")}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={16} color="#fff" />
            <Text style={[styles.emptyBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("listing.empty_cta")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={listings}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            <Text style={[styles.listCount, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {listings.length === 1
                ? t("listing.count_one", { n: listings.length })
                : t("listing.count_other", { n: listings.length })}
            </Text>
          }
        />
      )}

      {/* Status Change Modal */}
      <Modal
        visible={statusModalId !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setStatusModalId(null)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setStatusModalId(null)}>
          <View style={[styles.statusSheet, { backgroundColor: colors.card, shadowColor: colors.shadow }]}>
            <Text style={[styles.statusSheetTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
              {t("listing.update_status_title")}
            </Text>
            <Text style={[styles.statusSheetSubtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
              {activeStatusListing?.address}
            </Text>
            {STATUS_OPTIONS.map((opt) => {
              const active = activeStatusListing?.status === opt.key;
              const c = getStatusColor(opt.key);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.statusOption,
                    { borderColor: active ? c : colors.border, backgroundColor: active ? c + "12" : colors.background },
                  ]}
                  onPress={() => {
                    if (statusModalId) handleStatusChange(statusModalId, opt.key);
                  }}
                  activeOpacity={0.8}
                  disabled={updatingStatus}
                >
                  <View style={[styles.statusDot, { backgroundColor: c, width: 10, height: 10 }]} />
                  <Text style={[styles.statusOptionText, { color: active ? c : colors.foreground, fontFamily: active ? "DM_Sans_600SemiBold" : "DM_Sans_400Regular" }]}>
                    {opt.label}
                  </Text>
                  {active && <Feather name="check" size={15} color={c} style={{ marginLeft: "auto" }} />}
                  {updatingStatus && active && <ActivityIndicator size="small" color={c} style={{ marginLeft: "auto" }} />}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={[styles.statusCancelBtn, { borderColor: colors.border }]} onPress={() => setStatusModalId(null)}>
              <Text style={[styles.statusCancelText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { padding: 4, marginRight: 8 },
  headerTitle: { fontSize: 17, flex: 1, textAlign: "center", color: "#FAFAF9" },
  headerAddBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },

  centered: { flex: 1, alignItems: "center", justifyContent: "center" },

  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  emptyTitle: { fontSize: 20 },
  emptySubtitle: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  emptyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  emptyBtnText: { fontSize: 15, color: "#fff" },

  listContent: { padding: 16, gap: 14 },
  listCount: { fontSize: 12, marginBottom: 4 },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  coverImage: { width: "100%", height: 180 },
  coverPlaceholder: {
    width: "100%",
    height: 160,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  coverPlaceholderText: { fontSize: 13 },

  cardBody: { padding: 14 },
  cardTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 4,
  },
  cardAddress: { fontSize: 15, flex: 1 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11 },
  cardSubtitle: { fontSize: 13, marginBottom: 4 },
  cardPrice: { fontSize: 17, marginBottom: 8 },

  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { fontSize: 13 },

  actionRow: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 10,
    paddingVertical: 10,
  },
  actionBtnText: { fontSize: 14 },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  statusSheet: {
    width: "100%",
    borderRadius: 20,
    padding: 20,
    gap: 10,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
  },
  statusSheetTitle: { fontSize: 16, marginBottom: 2 },
  statusSheetSubtitle: { fontSize: 13, marginBottom: 4 },
  statusOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  statusOptionText: { fontSize: 15 },
  statusCancelBtn: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 13,
    alignItems: "center",
  },
  statusCancelText: { fontSize: 15 },
});
