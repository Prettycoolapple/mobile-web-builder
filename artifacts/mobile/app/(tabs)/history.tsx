import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
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
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";
import { useColors } from "@/hooks/useColors";
import { useChat, ChatMessage, FeasibilityReport, FeasibilityReportGroup } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { useFocusEffect, useRouter } from "expo-router";
import { getApiBase } from "@/lib/api";
import { useT, getCurrentLocale } from "@/lib/i18n";
import { translateReportViaApi } from "@/lib/translateReport";

type SearchSummary = {
  id: string;
  address: string;
  created_at: string;
  composite_score: number | null;
  zone: string | null;
  kind?: "report" | "combined_listing_group" | "conversation";
  package_count?: number;
  /** Set when this row is a locally-saved conversation that can be resumed in place. */
  sessionId?: string;
  /** Icon hint based on conversation type (report / discover search / plain chat). */
  icon?: "file-text" | "search" | "message-circle";
  /** Server search-history id this conversation maps to, if any (for deletion). */
  serverHistoryId?: string;
};

function useFormatDate() {
  const { t, locale } = useT();
  return (dateStr: string): string => {
    try {
      const d = new Date(dateStr);
      const now = new Date();
      const diffMs = now.getTime() - d.getTime();
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffDays === 0) return t("history.today");
      if (diffDays === 1) return t("history.yesterday");
      if (diffDays < 7) return t("history.days_ago", { n: diffDays });
      return d.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-NZ", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return dateStr;
    }
  };
}

function ScoreDot({ score }: { score: number }) {
  const colors = useColors();
  const color = score >= 4 ? colors.success : score >= 3 ? colors.accent : colors.amber;
  return (
    <View style={[styles.scoreDot, { backgroundColor: color + "20", borderColor: color + "40" }]}>
      <Text style={[styles.scoreDotText, { color, fontFamily: "DM_Sans_700Bold" }]}>
        {formatCompositeScoreForDisplay(score)}
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
  const formatDate = useFormatDate();
  return (
    <TouchableOpacity
      onPress={onTap}
      onLongPress={onDelete}
      activeOpacity={0.7}
      style={[styles.item, { backgroundColor: colors.card, borderColor: colors.border }]}
      disabled={isOpening}
    >
      <View style={[styles.itemIcon, { backgroundColor: colors.accent + "15" }]}>
        <Feather name={item.icon ?? "file-text"} size={17} color={colors.accent} />
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

function reportAddress(report: FeasibilityReport): string {
  const direct = typeof report.address === "string" ? report.address.trim() : "";
  if (direct) return direct;
  const overview = report.propertyOverview?.address;
  return typeof overview === "string" ? overview.trim() : "";
}

function reportZone(report: FeasibilityReport): string | null {
  return report.propertyOverview?.zone ?? report.planning?.zone ?? report.zone_label ?? null;
}

function withGroupHistoryMetadata(group: FeasibilityReportGroup, id: string, createdAt: string): FeasibilityReportGroup {
  return {
    ...group,
    historyId: group.historyId ?? id,
    historyCreatedAt: group.historyCreatedAt ?? createdAt,
    reports: group.reports.map((report) => ({
      ...report,
      historyId: report.historyId ?? id,
      historyCreatedAt: report.historyCreatedAt ?? createdAt,
    })),
  };
}

export default function HistoryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions, openHistoryReport, openHistoryReportGroup, switchSession, deleteSession, startNewChat, searchHistoryTick } = useChat();
  const { getApiHeaders } = useAuth();
  const router = useRouter();
  const { t } = useT();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [searches, setSearches] = useState<SearchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  // One row per locally-saved conversation (session). Every conversation is
  // resumable — not just feasibility reports but also discover/search threads
  // ("what's subdividable in St Heliers" → property cards) and plain chats.
  // A report still surfaces its composite score + zone for quick scanning.
  const localConversations = useMemo<SearchSummary[]>(() => {
    const rows: SearchSummary[] = [];
    const seenServerIds = new Set<string>();
    for (const session of sessions) {
      // Skip placeholder sessions with no real content yet.
      const hasContent = session.messages.some(
        (m) =>
          m.type !== "loading" &&
          (m.content.trim().length > 0 ||
            m.type === "report" ||
            m.type === "report_group" ||
            m.type === "search"),
      );
      if (!hasContent) continue;

      // Find the conversation's most recent report / report group, and whether
      // it contains a discover (search) result, to drive label + icon.
      let latestReport: ChatMessage | null = null;
      let latestGroup: ChatMessage | null = null;
      let hasSearch = false;
      for (const m of session.messages) {
        if (m.type === "report" && m.report) latestReport = m;
        else if (m.type === "report_group" && m.reportGroup) latestGroup = m;
        else if (m.type === "search") hasSearch = true;
      }

      let address: string;
      let composite: number | null = null;
      let zone: string | null = null;
      let kind: SearchSummary["kind"] = "conversation";
      let icon: SearchSummary["icon"] = "message-circle";
      let packageCount: number | undefined;
      let serverHistoryId: string | undefined;

      if (latestGroup?.reportGroup) {
        const g = latestGroup.reportGroup;
        const scores = g.reports.map((r) => r.scores?.composite).filter((n): n is number => typeof n === "number");
        address = `${g.packageAddress} · ${g.reports.length}-property package`;
        composite = scores.length ? scores.reduce((sum, n) => sum + n, 0) / scores.length : null;
        zone = `${g.reports.length} reports`;
        kind = "combined_listing_group";
        icon = "file-text";
        packageCount = g.reports.length;
        serverHistoryId = g.historyId ?? undefined;
      } else if (latestReport?.report) {
        address = reportAddress(latestReport.report) || session.title;
        // Suppress the score when land area is unknown — it would be unreliable,
        // matching the report view which hides the score and prompts to contact the agent.
        const hasLandArea = !!String(latestReport.report.propertyOverview?.landArea ?? "").trim();
        composite = hasLandArea && typeof latestReport.report.scores?.composite === "number"
          ? latestReport.report.scores.composite
          : null;
        zone = reportZone(latestReport.report);
        kind = "report";
        icon = "file-text";
        serverHistoryId = latestReport.report.historyId ?? undefined;
      } else {
        address = session.title;
        kind = "conversation";
        icon = hasSearch ? "search" : "message-circle";
      }

      // Collapse repeated "open from history" re-views of the same server
      // report (each tap currently spawns a fresh session) into one row.
      if (serverHistoryId) {
        if (seenServerIds.has(serverHistoryId)) continue;
        seenServerIds.add(serverHistoryId);
      }

      rows.push({
        id: `session:${session.id}`,
        sessionId: session.id,
        address,
        created_at: new Date(session.updatedAt || session.createdAt).toISOString(),
        composite_score: composite,
        zone,
        kind,
        icon,
        package_count: packageCount,
        serverHistoryId,
      });
    }
    return rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [sessions]);

  // Server search-history ids already represented by a local conversation, so we
  // don't show a duplicate server row for a report the user already has locally.
  const coveredServerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of localConversations) {
      if (row.serverHistoryId) ids.add(row.serverHistoryId);
    }
    return ids;
  }, [localConversations]);

  const visibleSearches = useMemo(() => {
    const serverOnly = searches.filter((s) => !coveredServerIds.has(s.id));
    return [...localConversations, ...serverOnly].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }, [localConversations, searches, coveredServerIds]);

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

  useFocusEffect(
    useCallback(() => {
      const isRefresh = hasLoadedRef.current;
      hasLoadedRef.current = true;
      load(isRefresh);
    }, [load]),
  );

  useEffect(() => {
    if (searchHistoryTick === 0) return;
    load(true);
  }, [searchHistoryTick, load]);

  const handleTap = useCallback(async (item: SearchSummary) => {
    // Locally-saved conversation → resume the exact thread in place, preserving
    // every message (discover results, "show more", chat, reports) so the user
    // picks up right where they left off.
    if (item.sessionId) {
      switchSession(item.sessionId);
      router.push("/");
      return;
    }
    setOpeningId(item.id);
    try {
      const resp = await fetch(`${getApiBase()}/searches/${item.id}`, {
        headers: getApiHeaders(),
      });
      if (!resp.ok) {
        Alert.alert(t("common.error"), t("history.error_load"));
        return;
      }
      const data = await resp.json() as {
        search: { result_json: FeasibilityReport | FeasibilityReportGroup; address: string };
      };
      const resultJson = data.search.result_json;
      const address = data.search.address ?? item.address;
      if ((resultJson as FeasibilityReportGroup)?.kind === "combined_listing_group") {
        openHistoryReportGroup(address, withGroupHistoryMetadata(resultJson as FeasibilityReportGroup, item.id, item.created_at));
        router.push("/");
        return;
      }
      let report = resultJson as FeasibilityReport;
      if (getCurrentLocale() === "zh") {
        const zhReport = await translateReportViaApi(report, getApiHeaders());
        if (zhReport) report = zhReport;
      }
      openHistoryReport(address, report);
      router.push("/");
    } catch {
      Alert.alert(t("common.error"), t("history.error_load"));
    } finally {
      setOpeningId(null);
    }
  }, [getApiHeaders, openHistoryReport, openHistoryReportGroup, switchSession, router, t]);

  const handleDelete = useCallback((item: SearchSummary) => {
    Alert.alert(
      t("history.delete_title"),
      t("history.delete_msg"),
      [
        { text: t("history.cancel"), style: "cancel" },
        {
          text: t("history.delete"),
          style: "destructive",
          onPress: async () => {
            // Local conversation → drop the saved session, plus its server-side
            // report copy (if any) so it doesn't reappear on the next refresh.
            if (item.sessionId) {
              deleteSession(item.sessionId);
              if (item.serverHistoryId) {
                const serverId = item.serverHistoryId;
                setSearches((prev) => prev.filter((s) => s.id !== serverId));
                fetch(`${getApiBase()}/searches/${serverId}`, {
                  method: "DELETE",
                  headers: getApiHeaders(),
                }).catch(() => {});
              }
              return;
            }
            try {
              await fetch(`${getApiBase()}/searches/${item.id}`, {
                method: "DELETE",
                headers: getApiHeaders(),
              });
              setSearches((prev) => prev.filter((s) => s.id !== item.id));
            } catch {
              Alert.alert(t("common.error"), t("history.error_delete"));
            }
          },
        },
      ],
    );
  }, [getApiHeaders, deleteSession, t]);

  const handleNew = () => {
    startNewChat();
    router.push("/");
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]}>
            {t("history.title")}
          </Text>
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: colors.accent }]}
            onPress={handleNew}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={15} color="#fff" />
            <Text style={[styles.newBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("history.new")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : visibleSearches.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="clock" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
            {t("history.empty_title")}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("history.empty_text")}
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: colors.accent }]}
            onPress={handleNew}
            activeOpacity={0.8}
          >
            <Text style={[styles.emptyBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("history.empty_btn")}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={visibleSearches}
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
              {t("history.hint")}
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
