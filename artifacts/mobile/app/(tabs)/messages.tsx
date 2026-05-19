import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";

import { useColors } from "@/hooks/useColors";
import { useDm, DmThread } from "@/context/DmContext";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/lib/i18n";
import { avatarImageSource } from "@/lib/avatar";

function useTimeAgo() {
  const { t, locale } = useT();
  return useCallback(
    (iso: string | null): string => {
      if (!iso) return "";
      const now = Date.now();
      const then = new Date(iso).getTime();
      const diff = now - then;
      const m = Math.floor(diff / 60000);
      if (m < 1) return t("messages.now");
      if (m < 60) return `${m}m`;
      const h = Math.floor(m / 60);
      if (h < 24) return `${h}h`;
      const d = Math.floor(h / 24);
      if (d < 7) return `${d}d`;
      return new Date(iso).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-NZ", {
        day: "numeric",
        month: "short",
      });
    },
    [t, locale],
  );
}

function useRoleBadge() {
  const { t } = useT();
  return useCallback(
    (role: string): string => {
      if (role === "sales_agent") return t("messages.role_sales_agent");
      if (role === "service_provider") return t("messages.role_service_provider");
      return t("messages.role_user");
    },
    [t],
  );
}

function Avatar({
  name,
  avatarUrl,
  size = 44,
  authHeaders,
}: {
  name: string | null;
  avatarUrl?: string | null;
  size?: number;
  authHeaders: Record<string, string>;
}) {
  const colors = useColors();
  const source = avatarImageSource(avatarUrl ?? null, authHeaders);
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (source) {
    return (
      <Image
        source={source}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: colors.accent + "44",
        }}
        contentFit="cover"
        transition={120}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accent + "22",
        borderWidth: 1.5,
        borderColor: colors.accent + "44",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.38, color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }}>
        {initials}
      </Text>
    </View>
  );
}

function ThreadRow({ thread, myId }: { thread: DmThread; myId: string }) {
  const colors = useColors();
  const router = useRouter();
  const { getApiHeaders } = useAuth();
  const { t } = useT();
  const timeAgo = useTimeAgo();
  const roleBadge = useRoleBadge();
  const other = thread.otherParticipant;
  const name = other?.fullName ?? t("messages.unknown");
  const role = other?.role ?? "general";
  const lastMsg = thread.lastMessage;
  const preview = lastMsg?.imageUrl
    ? t("messages.photo")
    : lastMsg?.body
    ? lastMsg.body.length > 60
      ? lastMsg.body.slice(0, 60) + "…"
      : lastMsg.body
    : t("messages.no_messages_yet");
  const isUnread = (thread.unreadCount || 0) > 0;
  const isMyMsg = lastMsg?.senderId === myId;

  const recCount = other?.recommendationCount ?? 0;
  const recLabel =
    recCount === 1
      ? t("messages.recommendation_one", { n: recCount })
      : t("messages.recommendation_other", { n: recCount });

  return (
    <Pressable
      onPress={() => router.push(`/chat/${thread.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.muted : colors.card },
      ]}
    >
      <TouchableOpacity
        onPress={() => other?.id && router.push(`/profile/${other.id}`)}
        activeOpacity={0.75}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
      >
        <Avatar name={name} avatarUrl={other?.avatarUrl} authHeaders={getApiHeaders()} />
      </TouchableOpacity>
      <View style={styles.rowMid}>
        <View style={styles.rowTop}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.rowName,
                { color: colors.foreground, fontFamily: isUnread ? "DM_Sans_600SemiBold" : "DM_Sans_500Medium" },
              ]}
              numberOfLines={1}
            >
              {name}
            </Text>
            {recCount > 0 && (
              <View style={styles.recRow}>
                <Feather name="thumbs-up" size={10} color={colors.accent} />
                <Text style={[styles.recText, { color: colors.accent }]}>{recLabel}</Text>
              </View>
            )}
          </View>
          <Text style={[styles.rowTime, { color: colors.mutedForeground }]}>
            {timeAgo(thread.lastMessageAt)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <View style={[styles.rolePill, { backgroundColor: colors.accent + "18" }]}>
            <Text style={[styles.rolePillText, { color: colors.accent }]}>{roleBadge(role)}</Text>
          </View>
          <Text
            style={[
              styles.rowPreview,
              {
                color: isUnread ? colors.foreground : colors.mutedForeground,
                fontFamily: isUnread ? "DM_Sans_500Medium" : "DM_Sans_400Regular",
                flex: 1,
              },
            ]}
            numberOfLines={1}
          >
            {isMyMsg && !lastMsg?.imageUrl ? t("messages.you_prefix", { preview }) : preview}
          </Text>
          {isUnread && (
            <View style={[styles.unreadDot, { backgroundColor: colors.accent }]}>
              <Text style={styles.unreadCount}>{thread.unreadCount > 9 ? "9+" : thread.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

function EmptyInbox() {
  const { t } = useT();
  return (
    <View style={styles.empty}>
      <Feather name="inbox" size={48} color="#D1D5DB" />
      <Text style={styles.emptyTitle}>{t("messages.empty_title")}</Text>
    </View>
  );
}

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { threads, fetchThreads, socket } = useDm();
  const { t } = useT();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchThreads();
    setRefreshing(false);
  }, [fetchThreads]);

  useEffect(() => {
    fetchThreads();
  }, []);

  useEffect(() => {
    if (!socket) return;
    const handler = () => { fetchThreads(); };
    socket.on("new_message", handler);
    return () => { socket.off("new_message", handler); };
  }, [socket, fetchThreads]);

  const sorted = [...threads].sort((a, b) => {
    const aTime = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bTime = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    return bTime - aTime;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: "#2C1F16" }]}>
        <Text style={styles.headerTitle}>{t("messages.title")}</Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => <ThreadRow thread={item} myId={user?.id ?? ""} />}
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        )}
        ListEmptyComponent={EmptyInbox}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
  },
  headerTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 22,
    color: "#FAFAF9",
    letterSpacing: -0.4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowMid: { flex: 1, gap: 5 },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  rowName: { fontSize: 15, flex: 1 },
  rowTime: { fontSize: 12, fontFamily: "DM_Sans_400Regular" },
  rowBottom: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  rolePill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  rolePillText: {
    fontFamily: "DM_Sans_500Medium",
    fontSize: 10,
  },
  recRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 1 },
  recText: { fontSize: 10, fontFamily: "DM_Sans_500Medium" },
  rowPreview: { fontSize: 13, lineHeight: 18 },
  unreadDot: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
  },
  unreadCount: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 10,
    color: "#fff",
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 72 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
    paddingTop: 80,
    gap: 0,
  },
  emptyTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 18,
    color: "#1F2937",
    marginTop: 16,
    textAlign: "center",
  },
});
