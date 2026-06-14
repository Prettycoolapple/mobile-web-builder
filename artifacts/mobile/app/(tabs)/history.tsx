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
  Image,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather, Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatCompositeScoreForDisplay } from "@/lib/compositeScoreDisplay";
import { useColors } from "@/hooks/useColors";
import { useChat, ChatMessage, FeasibilityReport, FeasibilityReportGroup, PropertyCandidate, SelectedListingContext } from "@/context/ChatContext";
import { useAuth } from "@/context/AuthContext";
import { useWatchlist, WatchlistItem } from "@/context/WatchlistContext";
import { confirmRemoveFromWatchlist } from "@/lib/watchlist-confirm";
import { useFocusEffect, useRouter } from "expo-router";
import { getApiBase } from "@/lib/api";
import { useT, getCurrentLocale } from "@/lib/i18n";
import { translateReportViaApi } from "@/lib/translateReport";
import { shareCandidate } from "@/lib/propertyShares";

// Mirrors the queue key in app/(tabs)/index.tsx — writing an analyse action here
// and navigating home lets the Search tab pick it up on focus and run it.
const PENDING_ANALYSE_ACTION_KEY = "@devfeasible/pending-guest-analyse-action";

/** Render a stored watchlist row as a PropertyCandidate (prefer the snapshot). */
function watchItemToCandidate(item: WatchlistItem): PropertyCandidate {
  const snap = item.snapshot;
  if (snap && typeof snap === "object" && typeof (snap as PropertyCandidate).address === "string") {
    return snap as PropertyCandidate;
  }
  return {
    address: item.address,
    price: 0,
    scores: { ease: 0, cost: 0, roi: 0, composite: item.compositeScore ?? 0 },
    scoresLoading: false,
    photoUrl: item.photoUrl ?? undefined,
    listingUrl: item.listingUrl ?? undefined,
    priceDisplay: item.priceDisplay ?? undefined,
    propertyType: item.propertyType ?? undefined,
    zone: item.zone ?? undefined,
    bedrooms: item.bedrooms ?? undefined,
    bathrooms: item.bathrooms ?? undefined,
    landArea: item.landAreaSqm ?? undefined,
  };
}

function selectedListingContextFromCandidate(candidate: PropertyCandidate): SelectedListingContext {
  return {
    address: candidate.address,
    listingUrl: candidate.listingUrl ?? null,
    photoUrl: candidate.photoUrl ?? null,
    photoUrls: candidate.photoUrls?.length ? candidate.photoUrls : candidate.photoUrl ? [candidate.photoUrl] : [],
    price: candidate.price > 0 ? candidate.price : null,
    landArea: candidate.landArea ?? null,
    floorArea: candidate.floorArea ?? null,
    bedrooms: candidate.bedrooms ?? null,
    bathrooms: candidate.bathrooms ?? null,
    bedroomsApprox: candidate.bedroomsApprox ?? null,
    bathroomsApprox: candidate.bathroomsApprox ?? null,
    landAreaApprox: candidate.landAreaApprox ?? null,
    floorAreaApprox: candidate.floorAreaApprox ?? null,
    priceApprox: candidate.priceApprox ?? null,
    propertyType: candidate.propertyType ?? null,
    listingTitle: candidate.listingTitle ?? null,
    source: candidate.source ?? null,
    isCombinedListing: candidate.isCombinedListing ?? null,
    packageAddress: candidate.packageAddress ?? null,
    childAddresses: candidate.childAddresses ?? null,
    aggregateFactsExcluded: candidate.aggregateFactsExcluded ?? null,
  };
}

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

interface WatchlistPropertyCardProps {
  candidate: PropertyCandidate;
  onShare: () => void;
  onAnalyse: (
    address: string,
    photoUrl?: string | null,
    listingUrl?: string | null,
    selectedListingContext?: SelectedListingContext | null,
    analysisKey?: string,
  ) => void;
}

function WatchlistPropertyCard({ candidate, onShare, onAnalyse }: WatchlistPropertyCardProps) {
  const colors = useColors();
  const { t } = useT();
  const { toggle } = useWatchlist();
  const analysisKey = (candidate.listingUrl || candidate.address).trim();
  const photoUrl = candidate.photoUrl ?? candidate.photoUrls?.[0] ?? null;

  const handleAnalyse = () => {
    onAnalyse(
      candidate.address,
      photoUrl,
      candidate.listingUrl ?? null,
      selectedListingContextFromCandidate(candidate),
      analysisKey,
    );
  };

  // Every card here is already saved, so the heart is always lit and the tap
  // path is removal-only: confirm, then toggle off. The list is derived from the
  // watchlist context, so the optimistic toggle drops this card immediately.
  const handleRemove = async () => {
    if (!(await confirmRemoveFromWatchlist(t))) return;
    await toggle(candidate);
  };

  const heartButton = (
    <TouchableOpacity
      style={[styles.watchHeartBtn, { backgroundColor: "rgba(255,255,255,0.92)", borderColor: colors.border }]}
      onPress={handleRemove}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={t("watchlist.remove")}
    >
      <Ionicons name="heart" size={16} color="#ef4444" />
    </TouchableOpacity>
  );

  return (
    <View style={[styles.watchCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {photoUrl ? (
        <View style={styles.watchPhotoWrap}>
          <Image source={{ uri: photoUrl }} style={styles.watchPhoto} resizeMode="cover" />
          <TouchableOpacity
            style={[styles.watchShareBtn, { backgroundColor: "rgba(255,255,255,0.92)", borderColor: colors.border }]}
            onPress={onShare}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Share property"
          >
            <Feather name="log-out" size={15} color={colors.foreground} />
          </TouchableOpacity>
          {heartButton}
        </View>
      ) : (
        <View style={[styles.watchPhotoPlaceholder, { backgroundColor: colors.muted }]}>
          <Feather name="home" size={30} color={colors.mutedForeground} />
          <TouchableOpacity
            style={[styles.watchShareBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={onShare}
            activeOpacity={0.82}
            accessibilityRole="button"
            accessibilityLabel="Share property"
          >
            <Feather name="log-out" size={15} color={colors.foreground} />
          </TouchableOpacity>
          {heartButton}
        </View>
      )}

      <View style={styles.watchBody}>
        <Text style={[styles.watchAddress, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]} numberOfLines={2}>
          {candidate.address}
        </Text>
        <View style={styles.watchTagRow}>
          {candidate.price > 0 ? <WatchTag text={`${candidate.priceApprox ? "~" : ""}$${(candidate.price / 1_000_000).toFixed(2)}M`} /> : null}
          {candidate.landArea != null && candidate.landArea > 0 ? <WatchTag text={`${candidate.landAreaApprox ? "~" : ""}${candidate.landArea}m²`} /> : null}
          {typeof candidate.floorArea === "number" && candidate.floorArea > 0 ? <WatchTag text={`${candidate.floorAreaApprox ? "~" : ""}${candidate.floorArea}m² floor`} /> : null}
          {typeof candidate.bedrooms === "number" && candidate.bedrooms > 0 ? <WatchTag icon="moon" text={`${candidate.bedroomsApprox ? "~" : ""}${candidate.bedrooms} bd`} /> : null}
          {typeof candidate.bathrooms === "number" && candidate.bathrooms > 0 ? <WatchTag icon="droplet" text={`${candidate.bathroomsApprox ? "~" : ""}${candidate.bathrooms} ba`} /> : null}
          {!!candidate.zone?.trim() ? <WatchTag text={candidate.zone} /> : null}
          {!!candidate.propertyType?.trim() ? <WatchTag text={candidate.propertyType} /> : null}
        </View>
      </View>

      <TouchableOpacity style={[styles.watchAnalyseBtn, { backgroundColor: colors.accent }]} onPress={handleAnalyse} activeOpacity={0.82}>
        <Text style={[styles.watchAnalyseText, { fontFamily: "DM_Sans_600SemiBold" }]}>
          {t("search.full_analysis")}
        </Text>
        <Feather name="arrow-right" size={15} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

function WatchTag({ text, icon }: { text: string; icon?: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[styles.watchTag, { backgroundColor: colors.muted }]}>
      {icon ? <Feather name={icon} size={10} color={colors.foreground} /> : null}
      <Text style={[styles.watchTagText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
        {text}
      </Text>
    </View>
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
  const { items: watchItems, loading: watchLoading, refresh: refreshWatch } = useWatchlist();
  const router = useRouter();
  const { t } = useT();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const [tab, setTab] = useState<"history" | "watchlist">("history");
  const [searches, setSearches] = useState<SearchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const hasLoadedRef = useRef(false);

  // Tapping "Analyse" on a watchlist card queues the action and sends the user
  // to the Search tab, which runs it on focus.
  const handleWatchAnalyse = useCallback(
    async (
      address: string,
      photoUrl?: string | null,
      listingUrl?: string | null,
      selectedListingContext?: SelectedListingContext | null,
      analysisKey?: string,
    ) => {
      const action = {
        type: "analyse" as const,
        address,
        selectedPhotoUrl: photoUrl ?? null,
        selectedListingUrl: listingUrl ?? null,
        selectedListingContext: selectedListingContext ?? null,
        analysisKey,
      };
      await AsyncStorage.setItem(PENDING_ANALYSE_ACTION_KEY, JSON.stringify(action)).catch(() => {});
      router.push("/");
    },
    [router],
  );

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
      void refreshWatch();
    }, [load, refreshWatch]),
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

      <View style={[styles.segmentWrap, { backgroundColor: colors.muted }]}>
        {(["history", "watchlist"] as const).map((seg) => {
          const active = tab === seg;
          return (
            <TouchableOpacity
              key={seg}
              style={[styles.segment, active && { backgroundColor: colors.accent }]}
              onPress={() => setTab(seg)}
              activeOpacity={0.8}
            >
              <Feather
                name={seg === "history" ? "clock" : "heart"}
                size={13}
                color={active ? "#fff" : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.segmentText,
                  { color: active ? "#fff" : colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold" },
                ]}
              >
                {seg === "history" ? t("history.tab_history") : t("history.tab_watchlist")}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === "history" && (loading ? (
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
      ))}

      {tab === "watchlist" && (watchLoading && watchItems.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : watchItems.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.muted }]}>
            <Feather name="heart" size={28} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
            {t("watchlist.empty_title")}
          </Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("watchlist.empty_text")}
          </Text>
        </View>
      ) : (
        <FlatList
          data={watchItems}
          keyExtractor={(it) => it.propertyKey}
          renderItem={({ item }) => {
            const candidate = watchItemToCandidate(item);
            return (
              <WatchlistPropertyCard
                candidate={candidate}
                onShare={() => { void shareCandidate(candidate, getApiHeaders()).catch(() => {}); }}
                onAnalyse={handleWatchAnalyse}
              />
            );
          }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomInset + 24 }]}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          refreshControl={
            <RefreshControl
              refreshing={watchLoading}
              onRefresh={() => { void refreshWatch(); }}
              tintColor={colors.accent}
            />
          }
        />
      ))}
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
  segmentWrap: {
    flexDirection: "row",
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 36,
    borderRadius: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  segmentText: {
    fontSize: 13,
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
  watchCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "rgba(28,25,23,0.06)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  watchPhotoWrap: {
    position: "relative",
    height: 150,
  },
  watchPhoto: {
    width: "100%",
    height: 150,
  },
  watchPhotoPlaceholder: {
    height: 120,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  watchShareBtn: {
    position: "absolute",
    top: 10,
    left: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  watchHeartBtn: {
    position: "absolute",
    top: 10,
    left: 52,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  watchBody: {
    padding: 14,
    gap: 10,
  },
  watchAddress: {
    fontSize: 15,
    lineHeight: 21,
  },
  watchTagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  watchTag: {
    maxWidth: "100%",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  watchTagText: {
    flexShrink: 1,
    fontSize: 12,
  },
  watchAnalyseBtn: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  watchAnalyseText: {
    color: "#fff",
    fontSize: 15,
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
