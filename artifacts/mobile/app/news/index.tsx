import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
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
  const { getApiHeaders } = useAuth();
  const { refreshUnread } = useNews();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const imageHeaders = getApiHeaders();

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    try {
      const response = await fetch(`${getApiBase()}/news?limit=50`, { headers: getApiHeaders() });
      if (!response.ok) throw new Error("load failed");
      const data = await response.json() as { posts?: FeedPost[] };
      setPosts(data.posts ?? []); setError(false); void refreshUnread();
    } catch { setError(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, [getApiHeaders, refreshUnread]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  const featured = posts.slice(0, Math.min(2, posts.length));
  const remaining = posts.slice(featured.length);
  const open = (id: string) => router.push({ pathname: "/news/[postId]", params: { postId: id, source: "feed" } } as never);
  const date = (value: string) => new Date(value).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-NZ", { day: "numeric", month: "short" });

  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}>
      <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)" as never)} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t("common.back")}><Feather name="arrow-left" size={22} color="#FAFAF9" /></Pressable>
      <Text style={styles.headerTitle}>{t("news.title")}</Text><View style={styles.headerButton} />
    </View>
    {loading && posts.length === 0 ? <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View> : error && posts.length === 0 ? <View style={styles.center}><Feather name="wifi-off" size={30} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t("news.load_failed")}</Text><Pressable onPress={() => void load()}><Text style={[styles.retry, { color: colors.accent }]}>{t("common.retry")}</Text></Pressable></View> :
      <FlatList
        data={remaining}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.accent} />}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={featured.length ? <View style={styles.featuredRow}>{featured.map((post, index) => <Pressable key={post.id} onPress={() => open(post.id)} style={({ pressed }) => [styles.featuredCard, featured.length === 1 ? styles.featuredSingle : index === 0 ? styles.featuredPrimary : styles.featuredSecondary, { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 }]}>
          {post.heroImageUrl ? <Image source={{ uri: assetUrl(post.heroImageUrl), headers: imageHeaders }} style={StyleSheet.absoluteFill} contentFit="cover" transition={180} /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.accent + "22" }]} />}
          <View style={styles.featuredShade} /><View style={styles.featuredText}><Text style={styles.featuredDate}>{date(post.publishedAt)}</Text><Text numberOfLines={featured.length === 1 ? 3 : 4} style={styles.featuredTitle}>{post.title}</Text></View>
        </Pressable>)}</View> : null}
        renderItem={({ item }) => <Pressable onPress={() => open(item.id)} style={({ pressed }) => [styles.row, { borderBottomColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
          <View style={styles.rowText}><Text style={[styles.rowDate, { color: colors.accent }]}>{date(item.publishedAt)}</Text><Text numberOfLines={3} style={[styles.rowTitle, { color: colors.foreground }]}>{item.title}</Text><Text numberOfLines={2} style={[styles.excerpt, { color: colors.mutedForeground }]}>{item.excerpt}</Text></View>
          {item.heroImageUrl && <Image source={{ uri: assetUrl(item.heroImageUrl), headers: imageHeaders }} style={styles.thumbnail} contentFit="cover" transition={150} />}
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
  headerTitle: { color: "#FAFAF9", fontFamily: "SpaceGrotesk_700Bold", fontSize: 21 },
  center: { flex: 1, minHeight: 320, alignItems: "center", justifyContent: "center", padding: 28, gap: 10 },
  emptyTitle: { fontFamily: "DM_Sans_700Bold", fontSize: 18, textAlign: "center" },
  emptyBody: { fontFamily: "DM_Sans_400Regular", fontSize: 14, textAlign: "center" }, retry: { fontFamily: "DM_Sans_700Bold", fontSize: 15 },
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
