import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useChat, FeasibilityReport } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "expo-router";

type SearchSummary = {
  id: string;
  address: string;
  created_at: string;
  composite_score: number | null;
  zone: string | null;
};

function getApiBase(): string {
  if (process.env["EXPO_PUBLIC_DOMAIN"]) {
    return `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`;
  }
  return "/api";
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function ScoreDot({ score }: { score: number }) {
  const colors = useColors();
  const color = score >= 4 ? colors.success : score >= 3 ? colors.accent : colors.amber;
  return (
    <View style={[styles.scoreDot, { backgroundColor: color + "20", borderColor: color + "40" }]}>
      <Text style={[styles.scoreDotText, { color, fontFamily: "DM_Sans_700Bold" }]}>
        {score.toFixed(1)}
      </Text>
    </View>
  );
}

interface HistoryItemProps {
  item: SearchSummary;
  onTap: () => void;
  onDelete: () => void;
  isOpening: boolean;
}

function HistoryItem({ item, onTap, onDelete, isOpening }: HistoryItemProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onTap}
      onLongPress={onDelete}
      activeOpacity={0.7}
      style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border }]}
      disabled={isOpening}
    >
      <View style={[styles.itemIcon, { backgroundColor: colors.accent + "15" }]}>
        <Feather name="file-text" size={17} color={colors.accent} />
      </View>

      <View style={styles.itemContent}>
        <Text
          style={[styles.itemAddress, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}
          numberOfLines={1}
        >
          {item.address}
        </Text>
        <View style={styles.itemMeta}>
          <Feather name="calendar" size={11} color={colors.mutedForeground} />
          <Text style={[styles.itemMetaText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {formatDate(item.created_at)}
          </Text>
          {item.zone ? (
            <>
              <Text style={[styles.metaDot, { color: colors.mutedForeground }]}>·</Text>
              <View style={[styles.zoneChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.zoneText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
                  {item.zone}
                </Text>
              </View>
            </>
          ) : null}
        </View>
      </View>

      <View style={styles.itemRight}>
        {item.composite_score != null && <ScoreDot score={item.composite_score} />}
        {isOpening ? (
          <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 4 }} />
        ) : (
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { openHistoryReport, startNewChat } = useChat();
  const { getApiHeaders } = useAuth();
  const router = useRouter();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [searches, setSearches] = useState<SearchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const resp = await fetch(`${getApiBase()}/searches`, {
        headers: getApiHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json() as { searches: SearchSummary[] };
        setSearches(data.searches ?? []);
      }
    } catch {
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getApiHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTap = useCallback(async (item: SearchSummary) => {
    setOpeningId(item.id);
    try {
      const resp = await fetch(`${getApiBase()}/searches/${item.id}`, {
        headers: getApiHeaders(),
      });
      if (!resp.ok) {
        Alert.alert("Error", "Could not load this report. Please try again.");
        return;
      }
      const data = await resp.json() as {
        search: { result_json: FeasibilityReport; address: string };
      };
      const report = data.search.result_json;
      const address = data.search.address ?? item.address;
      openHistoryReport(address, report);
      router.push("/(tabs)/");
    } catch {
      Alert.alert("Error", "Could not load this report. Please try again.");
    } finally {
      setOpeningId(null);
    }
  }, [getApiHeaders, openHistoryReport, router]);

  const handleDelete = useCallback((item: SearchSummary) => {
    Alert.alert(
      "Delete report",
      "Remove this analysis from your history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await fetch(`${getApiBase()}/searches/${item.id}`, {
                method: "DELETE",
                headers: getApiHeaders(),
              });
              setSearches((prev) => prev.filter((s) => s.id !== item.id));
            } catch {
              Alert.alert("Error", "Could not delete this report. Please try again.");
            }
          },
        },
      ],
    );
  }, [getApiHeaders]);

  const handleNew = () => {
    startNewChat();
    router.push("/(tabs)/");
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

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : searches.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="clock" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
            No analyses yet
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Your property analyses will appear here. Tap any to reopen and continue the conversation.
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
          data={searches}
          keyExtractor={(s) => s.id}
          renderItem={({ item }) => (
            <HistoryItem
              item={item}
              onTap={() => handleTap(item)}
              onDelete={() => handleDelete(item)}
              isOpening={openingId === item.id}
            />
          )}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Tap to reopen · Long-press to delete
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 16,
    gap: 0,
  },
  hint: {
    fontSize: 12,
    textAlign: "center",
    marginBottom: 12,
    marginTop: 4,
  },
  item: {
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
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  itemContent: {
    flex: 1,
    gap: 4,
  },
  itemAddress: {
    fontSize: 14,
    lineHeight: 20,
  },
  itemMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  itemMetaText: {
    fontSize: 12,
  },
  metaDot: {
    fontSize: 12,
  },
  zoneChip: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  zoneText: {
    fontSize: 11,
  },
  itemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  scoreDot: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  scoreDotText: {
    fontSize: 12,
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
    maxWidth: 280,
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
