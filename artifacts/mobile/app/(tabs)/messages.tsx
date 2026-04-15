import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  Platform,
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

import { useColors } from "@/hooks/useColors";
import { useDm, DmThread } from "@/context/DmContext";
import { useAuth } from "@/context/AuthContext";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
}

function roleBadge(role: string): string {
  if (role === "sales_agent") return "Sales Agent";
  if (role === "service_provider") return "Service Provider";
  return "User";
}

function Avatar({ name, size = 44 }: { name: string | null; size?: number }) {
  const colors = useColors();
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
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
  const other = thread.otherParticipant;
  const name = other?.fullName ?? "Unknown";
  const role = other?.role ?? "general";
  const lastMsg = thread.lastMessage;
  const preview = lastMsg?.imageUrl
    ? "📷 Photo"
    : lastMsg?.body
    ? lastMsg.body.length > 60
      ? lastMsg.body.slice(0, 60) + "…"
      : lastMsg.body
    : "No messages yet";
  const isUnread = (thread.unreadCount || 0) > 0;
  const isMyMsg = lastMsg?.senderId === myId;

  return (
    <Pressable
      onPress={() => router.push(`/chat/${thread.id}`)}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.muted : colors.card },
      ]}
    >
      <Avatar name={name} />
      <View style={styles.rowMid}>
        <View style={styles.rowTop}>
          <Text
            style={[
              styles.rowName,
              { color: colors.foreground, fontFamily: isUnread ? "DM_Sans_600SemiBold" : "DM_Sans_500Medium" },
            ]}
            numberOfLines={1}
          >
            {name}
          </Text>
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
            {isMyMsg && !lastMsg?.imageUrl ? `You: ${preview}` : preview}
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

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { threads, fetchThreads, socket, setUnreadCount, setThreads } = useDm();
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
    const handler = () => {
      fetchThreads();
    };
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
        <Text style={styles.headerTitle}>Messages</Text>
        <TouchableOpacity
          style={[styles.composeBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.push("/chat/contacts")}
          activeOpacity={0.8}
        >
          <Feather name="edit" size={16} color="#fff" />
        </TouchableOpacity>
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
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Feather name="message-square" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Connect with agents and service providers
            </Text>
            <TouchableOpacity
              style={[styles.newMsgBtn, { backgroundColor: colors.accent }]}
              onPress={() => router.push("/chat/contacts")}
              activeOpacity={0.8}
            >
              <Feather name="edit" size={16} color="#fff" />
              <Text style={styles.newMsgBtnText}>New Message</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  composeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
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
    gap: 12,
    paddingHorizontal: 32,
    paddingTop: 80,
  },
  emptyTitle: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 20,
    letterSpacing: -0.3,
    textAlign: "center",
    marginTop: 8,
  },
  emptySubtitle: {
    fontFamily: "DM_Sans_400Regular",
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  newMsgBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  newMsgBtnText: {
    fontFamily: "DM_Sans_600SemiBold",
    fontSize: 15,
    color: "#fff",
  },
});
