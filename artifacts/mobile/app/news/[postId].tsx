import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { getApiBase } from "@/lib/api";
import { useT } from "@/lib/i18n";

type ArticleBlock = { type: "text"; text: string } | { type: "image"; imageId: string; url: string };
interface Article { id: string; title: string; body: string; publishedAt: string; blocks: ArticleBlock[] }
function assetUrl(path: string): string { return `${getApiBase().replace(/\/api$/, "")}${path}`; }

function ArticleImage({ uri, headers }: { uri: string; headers: Record<string, string> }) {
  const [aspectRatio, setAspectRatio] = useState(1.45);
  return <Image
    source={{ uri, headers }}
    style={[styles.image, { aspectRatio }]}
    contentFit="contain"
    transition={180}
    cachePolicy="memory-disk"
    onLoad={(event) => {
      const width = Number(event.source?.width) || 0;
      const height = Number(event.source?.height) || 0;
      if (width > 0 && height > 0) setAspectRatio(Math.min(3, Math.max(0.45, width / height)));
    }}
  />;
}

export default function NewsArticleScreen() {
  const { postId, source } = useLocalSearchParams<{ postId: string; source?: string }>();
  const router = useRouter(); const insets = useSafeAreaInsets(); const colors = useColors(); const { locale, t } = useT();
  const { getApiHeaders, user, newsGuestSessionId } = useAuth();
  const [post, setPost] = useState<Article | null>(null); const [error, setError] = useState(false);
  const sessionId = useRef(`news-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const activeMs = useRef(0); const activeSince = useRef<number | null>(null); const articleLoaded = useRef(false); const entrySource = source === "push" ? "push" : "feed";
  const articleCacheKey = useMemo(() => {
    const viewer = user?.id ? `user_${user.id}` : newsGuestSessionId ? `guest_${newsGuestSessionId}` : null;
    return viewer && postId ? `@devfeasible/news_article/${viewer}/${locale}/${postId}` : null;
  }, [locale, newsGuestSessionId, postId, user?.id]);

  const accrue = useCallback(() => { if (activeSince.current != null) { activeMs.current += Date.now() - activeSince.current; activeSince.current = null; } }, []);
  const heartbeat = useCallback((ended = false) => {
    if (!postId || !articleLoaded.current) return; accrue();
    void fetch(`${getApiBase()}/news/${encodeURIComponent(postId)}/read-sessions/${encodeURIComponent(sessionId.current)}`, {
      method: "PUT", headers: getApiHeaders(), body: JSON.stringify({ activeSeconds: Math.floor(activeMs.current / 1000), entrySource, ended }),
    }).catch(() => undefined);
    if (!ended && AppState.currentState === "active") activeSince.current = Date.now();
  }, [accrue, entrySource, getApiHeaders, postId]);

  useEffect(() => {
    if (!postId) return;
    let cancelled = false;
    setPost(null);
    setError(false);
    articleLoaded.current = false;
    activeMs.current = 0;
    activeSince.current = null;
    sessionId.current = `news-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    async function hydrateAndRefresh() {
      if (articleCacheKey) {
        try {
          const raw = await AsyncStorage.getItem(articleCacheKey);
          const cached = raw ? JSON.parse(raw) as { article?: Article } : null;
          if (!cancelled && cached?.article) {
            setPost(cached.article); setError(false); articleLoaded.current = true;
            if (activeSince.current == null) activeSince.current = Date.now();
          }
        } catch { /* Ignore corrupt cached articles. */ }
      }
      try {
        const response = await fetch(`${getApiBase()}/news/${encodeURIComponent(postId)}`, { headers: getApiHeaders() });
        if (!response.ok) {
          if (response.status === 404) {
            if (articleCacheKey) await AsyncStorage.removeItem(articleCacheKey).catch(() => undefined);
            if (!cancelled) {
              setPost(null);
              setError(true);
              articleLoaded.current = false;
              activeSince.current = null;
            }
            return;
          }
          throw new Error();
        }
        const value = await response.json() as Article;
        if (!cancelled) {
          setPost(value); setError(false); articleLoaded.current = true;
          if (activeSince.current == null) activeSince.current = Date.now();
          if (articleCacheKey) void AsyncStorage.setItem(articleCacheKey, JSON.stringify({ article: value, savedAt: Date.now() })).catch(() => undefined);
        }
      } catch { if (!cancelled && !articleLoaded.current) setError(true); }
    }
    void hydrateAndRefresh();
    return () => { cancelled = true; };
  }, [articleCacheKey, getApiHeaders, postId]);
  useEffect(() => {
    const timer = setInterval(() => heartbeat(false), 5000);
    const app = AppState.addEventListener("change", (state) => { if (state === "active" && articleLoaded.current) activeSince.current = Date.now(); else heartbeat(false); });
    return () => { clearInterval(timer); app.remove(); heartbeat(true); };
  }, [heartbeat]);

  const back = () => router.canGoBack() ? router.back() : router.replace("/news" as never);
  const markdownStyles = { body: { color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 16, lineHeight: 27 }, heading1: { color: colors.foreground, fontFamily: "Fraunces_600SemiBold" }, heading2: { color: colors.foreground, fontFamily: "Fraunces_600SemiBold" }, link: { color: colors.accent } };
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.headerBg }]}><Pressable onPress={back} style={styles.headerButton} accessibilityRole="button" accessibilityLabel={t("common.back")}><Feather name="arrow-left" size={22} color="#FAFAF9" /></Pressable><Text numberOfLines={1} style={styles.headerTitle}>{t("news.article")}</Text><View style={styles.headerButton} /></View>
    {!post && !error ? <View style={styles.center}><ActivityIndicator size="large" color={colors.accent} /></View> : error || !post ? <View style={styles.center}><Text style={[styles.error, { color: colors.foreground }]}>{t("news.load_failed")}</Text><Pressable onPress={back}><Text style={[styles.backText, { color: colors.accent }]}>{t("common.back")}</Text></Pressable></View> :
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 36 }]} showsVerticalScrollIndicator={false}>
        <Text style={[styles.date, { color: colors.accent }]}>{new Date(post.publishedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-NZ", { day: "numeric", month: "long", year: "numeric" })}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>{post.title}</Text><View style={[styles.rule, { backgroundColor: colors.border }]} />
        {post.blocks.map((block, index) => block.type === "text"
          ? <View key={`text-${index}`} style={styles.textBlock}><Markdown style={markdownStyles}>{block.text}</Markdown></View>
          : <ArticleImage key={`${block.imageId}-${index}`} uri={assetUrl(block.url)} headers={getApiHeaders()} />)}
      </ScrollView>}
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { minHeight: 58, paddingHorizontal: 12, paddingBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" }, headerTitle: { flex: 1, textAlign: "center", color: "#FAFAF9", fontFamily: "DM_Sans_700Bold", fontSize: 17 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 28 }, error: { fontFamily: "DM_Sans_600SemiBold", fontSize: 17, textAlign: "center" }, backText: { fontFamily: "DM_Sans_700Bold" },
  content: { paddingHorizontal: 20, paddingTop: 24 }, date: { fontFamily: "DM_Sans_600SemiBold", fontSize: 13, marginBottom: 10 }, title: { fontFamily: "Fraunces_600SemiBold", fontSize: 31, lineHeight: 38 }, rule: { height: StyleSheet.hairlineWidth, marginVertical: 22 },
  textBlock: { marginBottom: 14 }, image: { width: "100%", borderRadius: 12, marginVertical: 12, backgroundColor: "#ddd" },
});
