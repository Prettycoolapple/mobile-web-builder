import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/lib/i18n";
import { getApiBase } from "@/lib/api";
import { ExploreCard, ExploreProperty } from "@/components/ExploreCard";

interface ExploreResponse {
  properties: ExploreProperty[];
  nextOffset: number;
  exhausted: boolean;
}

interface ExplorePhotoResponse {
  photos: Array<{
    address: string;
    photoUrl: string | null;
  }>;
}

function addressKey(address: string): string {
  return address.trim().toLowerCase();
}

export default function ExploreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const { getApiHeaders, user } = useAuth();

  const [properties, setProperties] = useState<ExploreProperty[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [exhausted, setExhausted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [prefetchedPage, setPrefetchedPage] = useState<ExploreResponse | null>(null);
  const photoCacheRef = useRef<Record<string, string | null>>({});

  const fetchPage = useCallback(
    async (offset: number) => {
      const resp = await fetch(`${getApiBase()}/explore?offset=${offset}`, {
        headers: getApiHeaders(),
      });
      if (!resp.ok) throw new Error(`explore failed: ${resp.status}`);
      return (await resp.json()) as ExploreResponse;
    },
    [getApiHeaders],
  );

  const applyPhotoCache = useCallback((items: ExploreProperty[]): ExploreProperty[] => (
    items.map((item) => {
      const key = addressKey(item.address);
      if (!Object.prototype.hasOwnProperty.call(photoCacheRef.current, key)) return item;
      return { ...item, photoUrl: photoCacheRef.current[key] };
    })
  ), []);

  const fetchPhotosForProperties = useCallback(
    async (items: ExploreProperty[]) => {
      const addresses = Array.from(new Set(
        items
          .map((item) => item.address.trim())
          .filter((address) => address && !Object.prototype.hasOwnProperty.call(photoCacheRef.current, addressKey(address))),
      )).slice(0, 10);
      if (addresses.length === 0) return;

      const resp = await fetch(`${getApiBase()}/explore/photos`, {
        method: "POST",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ addresses }),
      });
      if (!resp.ok) return;
      const data = await resp.json() as ExplorePhotoResponse;
      for (const item of data.photos ?? []) {
        photoCacheRef.current[addressKey(item.address)] = item.photoUrl ?? null;
      }
      setProperties((prev) => applyPhotoCache(prev));
      setPrefetchedPage((prev) => prev ? { ...prev, properties: applyPhotoCache(prev.properties) } : prev);
    },
    [applyPhotoCache, getApiHeaders],
  );

  const prefetchNextPage = useCallback(
    async (offset: number, currentProperties: ExploreProperty[]) => {
      const data = await fetchPage(offset);
      setPrefetchedPage({ ...data, properties: applyPhotoCache(data.properties) });
      void fetchPhotosForProperties([...currentProperties.slice(-5), ...data.properties]);
      return data;
    },
    [applyPhotoCache, fetchPage, fetchPhotosForProperties],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(false);
        const data = await fetchPage(0);
        if (cancelled) return;
        setProperties(applyPhotoCache(data.properties));
        setNextOffset(data.nextOffset);
        setExhausted(data.exhausted);
        setPrefetchedPage(null);
        if (!data.exhausted) {
          prefetchNextPage(data.nextOffset, data.properties).catch(() => {});
        } else {
          void fetchPhotosForProperties(data.properties);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyPhotoCache, fetchPage, fetchPhotosForProperties, prefetchNextPage]);

  const handleAnalyse = useCallback(
    (address: string) => {
      if (!user) {
        router.push("/(auth)/login" as never);
        return;
      }
      router.replace({ pathname: "/(tabs)", params: { analyseAddress: address } });
    },
    [user, router],
  );

  const handleShowMore = useCallback(async () => {
    if (loadingMore) return;
    // Cache exhausted → hand off to the home chat, which asks for a suburb and
    // runs the existing subdivision-intent screening on the reply.
    if (exhausted) {
      router.replace({ pathname: "/(tabs)", params: { exploreAskSuburb: String(Date.now()) } });
      return;
    }
    try {
      setLoadingMore(true);
      const data = prefetchedPage ?? await fetchPage(nextOffset);
      const nextProperties = applyPhotoCache(data.properties);
      const combined = [...properties, ...nextProperties];
      setProperties(combined);
      setNextOffset(data.nextOffset);
      setExhausted(data.exhausted);
      setPrefetchedPage(null);
      void fetchPhotosForProperties(combined.slice(-10));
      if (!data.exhausted) {
        prefetchNextPage(data.nextOffset, combined).catch(() => {});
      }
    } catch {
      // keep current list; the footer button stays available to retry
    } finally {
      setLoadingMore(false);
    }
  }, [applyPhotoCache, exhausted, fetchPage, fetchPhotosForProperties, loadingMore, nextOffset, prefetchedPage, prefetchNextPage, properties, router]);

  const renderFooter = () => {
    if (properties.length === 0) return null;
    return (
      <TouchableOpacity
        style={[styles.showMoreBtn, { borderColor: colors.accent }]}
        onPress={handleShowMore}
        activeOpacity={0.8}
        disabled={loadingMore}
      >
        {loadingMore ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Text style={[styles.showMoreText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
            {exhausted ? t("explore.by_suburb") : t("explore.show_more")}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg, borderBottomColor: colors.accent + "22" }]}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.push("/(tabs)"))}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={22} color="rgba(250,249,246,0.85)" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "SpaceGrotesk_700Bold" }]}>
            {t("explore.title")}
          </Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("explore.load_failed")}
          </Text>
        </View>
      ) : properties.length === 0 ? (
        <View style={styles.centerFill}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("explore.empty")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={properties}
          keyExtractor={(item, index) => `${item.address}-${index}`}
          renderItem={({ item }) => <ExploreCard property={item} onAnalyse={handleAnalyse} />}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 24 }]}
          ListHeaderComponent={
            <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("explore.subtitle")}
            </Text>
          }
          ListFooterComponent={renderFooter}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, height: 32, justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, letterSpacing: -0.4 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  listContent: { padding: 16 },
  subtitle: { fontSize: 13, marginBottom: 14, lineHeight: 18 },
  showMoreBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  showMoreText: { fontSize: 14 },
});
