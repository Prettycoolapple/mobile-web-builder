import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useNews } from "@/context/NewsContext";
import { useColors } from "@/hooks/useColors";
import { getApiBase } from "@/lib/api";
import { useT } from "@/lib/i18n";

interface FeedPost {
  id: string; title: string; excerpt: string; publishedAt: string; publishedSequence: number;
  heroImageUrl: string | null; imageCount: number;
}

function assetUrl(path: string): string {
  return `${getApiBase().replace(/\/api$/, "")}${path}`;
}

export default function NewsFeedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { t, locale } = useT();
  const { getApiHeaders, user, newsGuestSessionId } = useAuth();
  const { refreshUnread } = useNews();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const postsRef = useRef<FeedPost[]>([]);
  const hydratedCacheKeyRef = useRef<string | null>(null);
  const imageHeaders = getApiHeaders();
  const cacheKey = useMemo(() => {
    const viewer = user?.id ? `user_${user.id}` : newsGuestSessionId ? `guest_${newsGuestSessionId}` : null;
    return viewer ? `@devfeasible/news_feed/${viewer}/${locale}` : null;
  }, [locale, newsGuestSessionId, user?.id]);

  const load = useCallback(async (refresh = false, background = false) => {
    if (refresh) setRefreshing(true); else if (!background && postsRef.current.length === 0) setLoading(true);
    try {
      const response = await fetch(`${getApiBase()}/news?limit=50`, { headers: getApiHeaders() });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `News request failed (${response.status})`);
      }
      const data = await response.json() as { posts?: FeedPost[] };
      const nextPosts = data.posts ?? [];
      postsRef.current = nextPosts; setPosts(nextPosts); setError(null); void refreshUnread();
      if (cacheKey) void AsyncStorage.setItem(cacheKey, JSON.stringify({ posts: nextPosts, savedAt: Date.now() })).catch(() => undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "News could not be loaded"); }
    finally { setLoading(false); setRefreshing(false); }
  }, [cacheKey, getApiHeaders, refreshUnread]);

  useFocusEffect(useCallback(() => {
    let active = true;
    async function hydrateAndRefresh() {
      // An empty feed is still a valid cached result. Remembering that prevents
      // the full-page spinner from returning on every focus for new accounts.
      let hasCachedResult = Boolean(cacheKey && hydratedCacheKeyRef.current === cacheKey) || postsRef.current.length > 0;
      if (cacheKey && hydratedCacheKeyRef.current !== cacheKey) {
        hydratedCacheKeyRef.current = cacheKey;
        postsRef.current = []; setPosts([]); setLoading(true);
        try {
          const raw = await AsyncStorage.getItem(cacheKey);
          const cached = raw ? JSON.parse(raw) as { posts?: FeedPost[] } : null;
          if (active && Array.isArray(cached?.posts)) {
            postsRef.current = cached.posts; setPosts(cached.posts); setLoading(false); hasCachedResult = true;
          }
        } catch { /* A corrupt cache falls through to the network. */ }
      }
      if (active) void load(false, hasCachedResult);
    }
    void hydrateAndRefresh();
    return () => { active = false; };
  }, [cacheKey, load]));
  const featured = posts.slice(0, Math.min(2, posts.length));
  const remaining = posts.slice(featured.length);
  const open = (id: string) => router.push({ pathname: "/news/[postId]", params: { postId: id, source: "feed" } } as never);
  const date = (value: string) => new Date(value).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-NZ", { day: "numeric", month: "short" });

  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)" as never)} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t("common.back")}><Feather name="arrow-left" size={22} color="#FAFAF9" /></Pressable>
      <Text style={styles.headerTitle}>{t("news.title")}</Text><View style={styles.headerButton} />
    </View>
    {loading && posts.length === 0 ? <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View> : error && posts.length === 0 ? <View style={styles.center}><Feather name="wifi-off" size={30} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t("news.load_failed")}</Text><Text style={[styles.errorDetail, { color: colors.mutedForeground }]}>{error}</Text><Pressable onPress={() => void load()}><Text style={[styles.retry, { color: colors.accent }]}>{t("common.retry")}</Text></Pressable></View> :
      <FlatList
        data={remaining}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={featured.length ? <View style={styles.featuredRow}>{featured.map((post, index) => <Pressable key={post.id} onPress={() => open(post.id)} style={({ pressed }) => [styles.featuredCard, featured.length === 1 ? styles.featuredSingle : index === 0 ? styles.featuredPrimary : styles.featuredSecondary, { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]}>
          {post.heroImageUrl ? <Image source={{ uri: assetUrl(post.heroImageUrl), headers: imageHeaders }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" transition={180} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent + "22" }]} />}
          <View style={styles.featuredShade} /><View style={styles.featuredText}><Text style={styles.featuredDate}>{date(post.publishedAt)}</Text><Text numberOfLines={featured.length === 1 ? 3 : 4} style={styles.featuredTitle}>{post.title}</Text></View>
        </Pressable>)}</View> : null}
        renderItem={({ item }) => <Pressable onPress={() => open(item.id)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
          <View style={styles.rowText}><Text style={[styles.rowDate, { color: colors.accent }]}>{date(item.publishedAt)}</Text><Text numberOfLines={3} style={[styles.rowTitle, { color: colors.foreground }]}>{item.title}</Text><Text numberOfLines={2} style={[styles.excerpt, { color: colors.mutedForeground }]}>{item.excerpt}</Text></View>
          {item.heroImageUrl && <Image source={{ uri: assetUrl(item.heroImageUrl), headers: imageHeaders }} style={styles.thumbnail} contentFit="cover" cachePolicy="memory-disk" transition={150} />}
        </Pressable>}
        ListEmptyComponent={<View style={styles.center}><Feather name="bell" size={32} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t("news.empty")}</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>{t("news.empty_body")}</Text></View>}
      />}
  </View>;
}

const width = Dimensions.get("window").width;
const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#FAFAF9", fontFamily: "SpaceGrotesk_700Bold", fontSize: 17, letterSpacing: -0.4 },
  center: { flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  emptyTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 18, textAlign: "center" },
  emptyBody: { fontFamily: "DM_Sans_400Regular", fontSize: 14, textAlign: "center" }, retry: { fontFamily: "DM_Sans_700Bold", fontSize: 15 },
  errorDetail: { fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 18, textAlign: "center" },
  featuredRow: { flexDirection: "row", gap: 3, paddingBottom: 14 },
  featuredCard: { height: Math.min(255, width * 0.62), overflow: "hidden", position: "relative" },
  featuredPrimary: { flex: 1.65 }, featuredSecondary: { flex: 1 }, featuredSingle: { flex: 1, marginHorizontal: 12, borderRadius: 14 },
  featuredShade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.28)" },
  featuredText: { position: "absolute", left: 14, right: 12, bottom: 14 },
  featuredDate: { color: "rgba(255,255,255,0.82)", fontFamily: "DM_Sans_500Medium", fontSize: 12, marginBottom: 5 },
  featuredTitle: { color: "#fff", fontFamily: "DM_Sans_700Bold", fontSize: 18, lineHeight: 23, textShadowColor: "rgba(0,0,0,.35)", textShadowRadius: 3 },
  row: { minHeight: 142, paddingVertical: 16, paddingHorizontal: 18, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: 14 },
  rowText: { flex: 1 }, rowDate: { fontFamily: "DM_Sans_600SemiBold", fontSize: 12, marginBottom: 6 },
  rowTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 17, lineHeight: 22 }, excerpt: { fontFamily: "DM_Sans_400Regular", fontSize: 13, lineHeight: 18, marginTop: 6 },
  thumbnail: { width: 112, height: 105, borderRadius: 10 },
});
