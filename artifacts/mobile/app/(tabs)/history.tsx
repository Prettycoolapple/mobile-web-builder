import React from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useChat, Session } from "@/context/ChatContext";
import { useRouter } from "expo-router";

function SessionItem({ session, onPress, onDelete }: { session: Session; onPress: () => void; onDelete: () => void }) {
  const colors = useColors();
  const date = new Date(session.updatedAt);
  const dateStr = date.toLocaleDateString("en-NZ", { day: "numeric", month: "short" });
  const timeStr = date.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });
  const hasReport = session.messages.some((m) => m.type === "report");

  return (
    <TouchableOpacity
      style={[styles.sessionItem, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.sessionIconWrapper, {
        backgroundColor: hasReport ? colors.accent + "15" : colors.muted,
      }]}>
        <Feather
          name={hasReport ? "file-text" : "message-circle"}
          size={17}
          color={hasReport ? colors.accent : colors.mutedForeground}
        />
      </View>

      <View style={styles.sessionContent}>
        <Text style={[styles.sessionTitle, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
          {session.title}
        </Text>
        <Text style={[styles.sessionMeta, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          {session.messages.length} messages · {dateStr}, {timeStr}
        </Text>
      </View>

      <TouchableOpacity
        onPress={onDelete}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[styles.deleteBtn, { backgroundColor: colors.muted }]}
      >
        <Feather name="trash-2" size={14} color={colors.mutedForeground} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, switchSession, deleteSession, startNewChat } = useChat();
  const router = useRouter();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const realSessions = sessions.filter(
    (s) => s.messages.some((m) => m.type !== "loading" && m.content.length > 0),
  );

  const handleSelect = (id: string) => {
    switchSession(id);
    router.push("/(tabs)");
  };

  const handleNew = () => {
    startNewChat();
    router.push("/(tabs)");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]}>
            History
          </Text>
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: colors.accent }]}
            onPress={handleNew}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={15} color="#fff" />
            <Text style={[styles.newBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>New Search</Text>
          </TouchableOpacity>
        </View>
      </View>

      {realSessions.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="clock" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
            No conversations yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Your property analyses and chat sessions will appear here.
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
            onPress={handleNew}
            activeOpacity={0.8}
          >
            <Text style={[styles.emptyBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Start analysing</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={realSessions}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SessionItem
              session={item}
              onPress={() => handleSelect(item.id)}
              onDelete={() => deleteSession(item.id)}
            />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
  },
  headerTitle: {
    fontSize: 20,
    letterSpacing: -0.3,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  newBtnText: {
    fontSize: 13,
    color: "#fff",
  },
  list: {
    padding: 16,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    shadowColor: "rgba(28,25,23,0.05)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 3,
    elevation: 1,
  },
  sessionIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  sessionContent: {
    flex: 1,
    gap: 3,
  },
  sessionTitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  sessionMeta: {
    fontSize: 12,
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 16,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    maxWidth: 260,
  },
  emptyBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 100,
    marginTop: 4,
  },
  emptyBtnText: {
    fontSize: 14,
    color: "#fff",
  },
});
