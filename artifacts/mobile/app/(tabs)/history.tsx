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
  const dateStr = date.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "2-digit" });
  const timeStr = date.toLocaleTimeString("en-NZ", { hour: "2-digit", minute: "2-digit" });

  return (
    <TouchableOpacity
      style={[styles.sessionItem, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.sessionIcon, { backgroundColor: colors.emerald + "20" }]}>
        <Feather name="file-text" size={18} color={colors.emerald} />
      </View>
      <View style={styles.sessionContent}>
        <Text style={[styles.sessionTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={2}>
          {session.title}
        </Text>
        <Text style={[styles.sessionMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {session.messages.length} messages · {dateStr} {timeStr}
        </Text>
      </View>
      <TouchableOpacity onPress={onDelete} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
        <Feather name="trash-2" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, switchSession, deleteSession, createSession } = useChat();
  const router = useRouter();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const handleSelect = (id: string) => {
    switchSession(id);
    router.push("/(tabs)");
  };

  const handleNew = () => {
    createSession();
    router.push("/(tabs)");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.navy, borderBottomColor: "rgba(255,255,255,0.1)" }]}>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { fontFamily: "Inter_700Bold" }]}>History</Text>
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: colors.emerald }]}
            onPress={handleNew}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={16} color="#fff" />
            <Text style={[styles.newBtnText, { fontFamily: "Inter_600SemiBold" }]}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {sessions.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="inbox" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            No analyses yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Start by analysing a property or searching for development opportunities.
          </Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <SessionItem
              session={item}
              onPress={() => handleSelect(item.id)}
              onDelete={() => deleteSession(item.id)}
            />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset + 16 }]}
          showsVerticalScrollIndicator={false}
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
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  headerContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 8,
  },
  headerTitle: {
    fontSize: 22,
    color: "#fff",
    letterSpacing: -0.5,
  },
  newBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
    gap: 10,
  },
  sessionItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    marginBottom: 10,
  },
  sessionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
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
    fontSize: 11,
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    textAlign: "center",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
});
