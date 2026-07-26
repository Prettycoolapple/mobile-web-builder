import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrowseListingCard } from "@/components/BrowseListingCard";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { BrowseListing, BrowseListingFilters, canonicalBrowseListingKey, dedupeBrowseListings, fetchBrowseListings } from "@/lib/browseListings";
import { isOSChineseLocale, useT } from "@/lib/i18n";

const BROWSE_PAGE_SIZE = 5;
const BROWSE_PREFETCH_LIMIT = 10;

const DEFAULT_BROWSE_FILTERS: BrowseListingFilters = {
  listingType: "for_sale",
  limit: BROWSE_PAGE_SIZE,
  sort: "recommended",
};

function browseFiltersKey(filters: BrowseListingFilters): string {
  const stable = {
    q: filters.q?.trim() ?? "",
    propertyType: filters.propertyType ?? "",
    bedrooms: filters.bedrooms?.trim() ?? "",
    bathrooms: filters.bathrooms?.trim() ?? "",
    sort: filters.sort ?? "recommended",
  };
  return JSON.stringify(stable);
}

export default function BrowseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const { t } = useT();

  const [filters, setFilters] = useState<BrowseListingFilters>(DEFAULT_BROWSE_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<BrowseListingFilters>(DEFAULT_BROWSE_FILTERS);
  const [searchText, setSearchText] = useState("");
  const [listings, setListings] = useState<BrowseListing[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queuedListingsRef = useRef<BrowseListing[]>([]);
  const preloadRef = useRef<{ key: string; listings: BrowseListing[]; nextCursor: string | null } | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const preloadInFlightRef = useRef(false);

  const loadListings = useCallback(async (options?: { refresh?: boolean; append?: boolean; cursor?: string | null; filters?: BrowseListingFilters }) => {
    const activeFilters = {
      ...(options?.filters ?? appliedFilters),
      listingType: "for_sale" as const,
      limit: BROWSE_PREFETCH_LIMIT,
    };
    const activeKey = browseFiltersKey(activeFilters);
    const append = options?.append === true;
    const currentKeys = append
      ? new Set([
          ...listings.map(canonicalBrowseListingKey),
          ...queuedListingsRef.current.map(canonicalBrowseListingKey),
        ])
      : new Set<string>();

    if (append && queuedListingsRef.current.length > 0) {
      const queue = dedupeBrowseListings(queuedListingsRef.current, listings.map(canonicalBrowseListingKey));
      const next = queue.slice(0, BROWSE_PAGE_SIZE);
      queuedListingsRef.current = queue.slice(BROWSE_PAGE_SIZE);
      if (next.length > 0) {
        setListings((prev) => dedupeBrowseListings([...prev, ...next]));
        return;
      }
    }

    const cursor = options?.cursor ?? null;
    if (append && !cursor) return;
    if (append) setLoadingMore(true);
    else if (options?.refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const result = await fetchBrowseListings(getApiHeaders(), {
        ...activeFilters,
        cursor: append ? cursor : null,
        limit: BROWSE_PREFETCH_LIMIT,
        excludeKeys: append ? [...currentKeys] : undefined,
      });
      const unique = dedupeBrowseListings(result.listings, append ? listings.map(canonicalBrowseListingKey) : []);
      const visible = unique.slice(0, BROWSE_PAGE_SIZE);
      queuedListingsRef.current = unique.slice(BROWSE_PAGE_SIZE);
      if (!append) loadedKeyRef.current = activeKey;
      setListings((prev) => append ? dedupeBrowseListings([...prev, ...visible]) : visible);
      setNextCursor(result.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load listings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [appliedFilters, getApiHeaders, listings]);

  const preloadListings = useCallback(async () => {
    if (preloadInFlightRef.current) return;
    preloadInFlightRef.current = true;
    const preloadFilters = { ...DEFAULT_BROWSE_FILTERS, limit: BROWSE_PREFETCH_LIMIT };
    try {
      const result = await fetchBrowseListings(getApiHeaders(), preloadFilters);
      preloadRef.current = {
        key: browseFiltersKey(preloadFilters),
        listings: dedupeBrowseListings(result.listings),
        nextCursor: result.nextCursor,
      };
    } catch {
      // Silent: Browse can still load normally.
    } finally {
      preloadInFlightRef.current = false;
    }
  }, [getApiHeaders]);

  useEffect(() => {
    void preloadListings();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void preloadListings();
    });
    return () => sub.remove();
  }, [preloadListings]);

  useEffect(() => {
    if (loadedKeyRef.current === browseFiltersKey(appliedFilters)) return;
    const defaultKey = browseFiltersKey({ ...DEFAULT_BROWSE_FILTERS, limit: BROWSE_PREFETCH_LIMIT });
    if (browseFiltersKey(appliedFilters) === browseFiltersKey(DEFAULT_BROWSE_FILTERS) && preloadRef.current?.key === defaultKey) {
      const preloaded = preloadRef.current;
      const unique = dedupeBrowseListings(preloaded.listings);
      queuedListingsRef.current = unique.slice(BROWSE_PAGE_SIZE);
      loadedKeyRef.current = browseFiltersKey(DEFAULT_BROWSE_FILTERS);
      setListings(unique.slice(0, BROWSE_PAGE_SIZE));
      setNextCursor(preloaded.nextCursor);
      return;
    }
    void loadListings();
  }, [appliedFilters, loadListings]);

  const submitSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    const next: BrowseListingFilters = {
      listingType: "for_sale",
      limit: BROWSE_PAGE_SIZE,
      sort: "recommended",
      q: trimmed || undefined,
      cursor: null,
    };
    setFilters(next);
    queuedListingsRef.current = [];
    loadedKeyRef.current = null;
    setNextCursor(null);
    setAppliedFilters(next);
    Keyboard.dismiss();
    void loadListings({ filters: next });
  }, [loadListings]);

  const goAskMode = useCallback(() => {
    router.replace("/(tabs)" as never);
  }, [router]);

  const canSearch = searchText.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg, borderBottomColor: colors.accent + "22" }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)" as never))}
          style={styles.headerBtn}
          activeOpacity={0.72}
        >
          <Feather name="arrow-left" size={22} color="rgba(250,249,246,0.86)" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "SpaceGrotesk_700Bold" }]}>
          {isOSChineseLocale() ? "奥房" : "Project Alpha"}
        </Text>
        <TouchableOpacity
          style={[styles.askBtn, { backgroundColor: colors.accent }]}
          onPress={goAskMode}
          activeOpacity={0.78}
        >
          <Feather name="message-circle" size={14} color="#fff" />
          <Text style={[styles.askBtnText, { fontFamily: "DM_Sans_700Bold" }]}>{t("browse.ask_mode")}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.listArea}>
        {loading && listings.length === 0 ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.loading")}</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("browse.loading_hint")}</Text>
          </View>
        ) : error && listings.length === 0 ? (
          <View style={styles.center}>
            <Feather name="alert-circle" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.unavailable")}</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{error}</Text>
            <TouchableOpacity style={[styles.retryBtn, { borderColor: colors.border }]} onPress={() => loadListings()}>
              <Text style={[styles.retryText, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{t("browse.try_again")}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={listings}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <BrowseListingCard
                listing={item}
                onPress={() => router.push({
                  pathname: "/listing/[id]",
                  params: { id: item.id, preview: JSON.stringify(item) },
                } as never)}
              />
            )}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => loadListings({ refresh: true })}
                tintColor={colors.accent}
              />
            }
            onScrollBeginDrag={() => Keyboard.dismiss()}
            onEndReached={() => {
              if ((queuedListingsRef.current.length > 0 || nextCursor) && !loadingMore) {
                void loadListings({ append: true, cursor: nextCursor });
              }
            }}
            onEndReachedThreshold={0.6}
            ListHeaderComponent={
              <Text style={[styles.title, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.title")}</Text>
            }
            ListEmptyComponent={
              <View style={styles.center}>
                <Feather name="search" size={30} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.empty_title")}</Text>
                <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                  {t("browse.empty_body")}
                </Text>
              </View>
            }
            ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 16 }} /> : null}
          />
        )}

        {loading && listings.length > 0 ? (
          <View style={styles.loadingOverlay} pointerEvents="auto">
            <View style={[styles.loadingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>{t("browse.loading")}</Text>
              <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("browse.loading_hint")}</Text>
            </View>
          </View>
        ) : null}
      </View>

      <View style={[styles.bottomBar, {
        backgroundColor: colors.background,
        borderTopColor: colors.border,
        paddingBottom: insets.bottom + 10,
      }]}>
        <View style={[styles.searchWrapper, {
          backgroundColor: colors.card,
          borderColor: canSearch ? colors.accent + "60" : colors.border,
          shadowColor: colors.shadow,
        }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} style={{ marginLeft: 2 }} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
            placeholder={t("browse.location_placeholder")}
            placeholderTextColor={colors.mutedForeground}
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={() => submitSearch(searchText)}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {canSearch ? (
            <TouchableOpacity
              style={[styles.searchBtn, { backgroundColor: colors.accent }]}
              onPress={() => submitSearch(searchText)}
              activeOpacity={0.8}
            >
              <Feather name="arrow-up" size={17} color="#fff" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 8,
  },
  headerBtn: { width: 40, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, letterSpacing: -0.4 },
  askBtn: { minHeight: 34, borderRadius: 18, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 5 },
  askBtnText: { color: "#fff", fontSize: 13 },
  listArea: { flex: 1, position: "relative", paddingHorizontal: 16, paddingTop: 12 },
  list: { gap: 13, paddingTop: 16, paddingBottom: 20 },
  title: { fontSize: 22, lineHeight: 28, paddingTop: 2 },
  center: { flex: 1, minHeight: 260, alignItems: "center", justifyContent: "center", paddingHorizontal: 24, gap: 10 },
  emptyTitle: { fontSize: 17, textAlign: "center" },
  emptyText: { fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryBtn: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  retryText: { fontSize: 13 },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    backgroundColor: "rgba(28, 25, 23, 0.34)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingCard: { width: "100%", maxWidth: 320, borderWidth: 1, borderRadius: 16, padding: 20, alignItems: "center", gap: 8 },
  bottomBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  searchWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 16,
    paddingLeft: 14,
    paddingRight: 7,
    paddingVertical: 7,
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    paddingVertical: 3,
  },
  searchBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
  },
});
