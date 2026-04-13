import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
  ActivityIndicator,
  Linking,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat, FeasibilityReport } from "@/context/ChatContext";
import { getSubscriptionStatus, restorePurchases, purchasePro } from "@/lib/revenuecat";

const PLAN_FEATURES = {
  free: [
    "3 feasibility reports/month",
    "AI chat follow-ups",
    "Basic property analysis",
    "Discovery search",
  ],
  pro: [
    "Unlimited feasibility reports",
    "Full data pipeline — live property data",
    "AI risk assessments & ROI modelling",
    "Full comparable sales data",
    "PDF export (coming soon)",
    "Email report sharing",
  ],
};

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

function FeatureRow({ text, included }: { text: string; included: boolean }) {
  const colors = useColors();
  return (
    <View style={styles.featureRow}>
      <Feather
        name={included ? "check" : "minus"}
        size={15}
        color={included ? colors.success : colors.mutedForeground}
      />
      <Text style={[styles.featureText, {
        color: included ? colors.foreground : colors.mutedForeground,
        fontFamily: "DM_Sans_400Regular",
      }]}>
        {text}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return (
    <Text style={[styles.sectionHeader, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
      {title}
    </Text>
  );
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
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
  onTap: (item: SearchSummary) => void;
  onDelete: (item: SearchSummary) => void;
  isLast: boolean;
}

function HistoryItem({ item, onTap, onDelete, isLast }: HistoryItemProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => onTap(item)}
      onLongPress={() => onDelete(item)}
      activeOpacity={0.7}
      style={[
        styles.historyItem,
        { borderBottomColor: colors.border, borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth },
      ]}
    >
      <View style={styles.historyItemMain}>
        <Text style={[styles.historyAddress, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
          {item.address}
        </Text>
        <View style={styles.historyMeta}>
          <Feather name="calendar" size={11} color={colors.mutedForeground} />
          <Text style={[styles.historyMetaText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {formatDate(item.created_at)}
          </Text>
          {item.zone && (
            <>
              <Text style={[styles.historyMetaDot, { color: colors.mutedForeground }]}>·</Text>
              <View style={[styles.zoneChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Text style={[styles.zoneChipText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
                  {item.zone}
                </Text>
              </View>
            </>
          )}
        </View>
      </View>
      <View style={styles.historyItemRight}>
        {item.composite_score != null && <ScoreDot score={item.composite_score} />}
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut, getApiHeaders, refreshProfile } = useAuth();
  const router = useRouter();
  const { sessions, openHistoryReport } = useChat();

  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [historySearches, setHistorySearches] = useState<SearchSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const isPro = user?.subscriptionTier === "pro";
  const freeLimit = 3;
  const usage = user?.reportsUsedThisMonth ?? 0;
  const usagePct = isPro ? 100 : Math.min((usage / freeLimit) * 100, 100);

  const reportCount = sessions.filter((s) =>
    s.messages.some((m) => m.type === "report")
  ).length;

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const resp = await fetch(`${getApiBase()}/searches`, {
        headers: getApiHeaders(),
      });
      if (resp.ok) {
        const data = await resp.json() as { searches: SearchSummary[] };
        setHistorySearches(data.searches ?? []);
      }
    } catch {
      // silent fail
    } finally {
      setHistoryLoading(false);
    }
  }, [getApiHeaders]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const syncToBackend = useCallback(async (tier: "pro" | "free") => {
    try {
      await fetch(`${getApiBase()}/subscription/sync`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ tier }),
      });
      await refreshProfile().catch(() => {});
    } catch {
    }
  }, [getApiHeaders, refreshProfile]);

  useEffect(() => {
    async function checkRevenueCat() {
      const isPro = await getSubscriptionStatus();
      if (isPro) {
        await syncToBackend("pro");
      }
    }
    checkRevenueCat();
  }, []);

  const handleUpgrade = useCallback(async () => {
    setUpgradeLoading(true);
    try {
      const success = await purchasePro();
      if (success) {
        await syncToBackend("pro");
        Alert.alert("Welcome to Pro!", "You now have unlimited feasibility reports.");
      }
    } catch (err: any) {
      Alert.alert("Purchase failed", err?.message ?? "Something went wrong. Please try again.");
    } finally {
      setUpgradeLoading(false);
    }
  }, [syncToBackend]);

  const handleRestore = useCallback(async () => {
    setRestoreLoading(true);
    try {
      const success = await restorePurchases();
      if (success) {
        await syncToBackend("pro");
        Alert.alert("Purchases restored", "Your Pro subscription is active.");
      } else {
        Alert.alert("No purchases found", "No active Pro subscription was found.");
      }
    } catch {
      Alert.alert("Restore failed", "Could not restore purchases. Please try again.");
    } finally {
      setRestoreLoading(false);
    }
  }, [syncToBackend]);

  const handleManageSubscription = useCallback(() => {
    if (Platform.OS === "ios") {
      Linking.openURL("https://apps.apple.com/account/subscriptions");
    } else {
      Linking.openURL("https://play.google.com/store/account/subscriptions");
    }
  }, []);

  const handleHistoryTap = useCallback(async (item: SearchSummary) => {
    setOpeningId(item.id);
    try {
      const resp = await fetch(`${getApiBase()}/searches/${item.id}`, {
        headers: getApiHeaders(),
      });
      if (!resp.ok) {
        Alert.alert("Error", "Could not load this report. Please try again.");
        return;
      }
      const data = await resp.json() as { search: { result_json: FeasibilityReport; address: string } };
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

  const handleHistoryDelete = useCallback((item: SearchSummary) => {
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
              setHistorySearches((prev) => prev.filter((s) => s.id !== item.id));
            } catch {
              Alert.alert("Error", "Could not delete this report. Please try again.");
            }
          },
        },
      ],
    );
  }, [getApiHeaders]);

  const handleSignOut = () => {
    Alert.alert("Sign out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out", style: "destructive", onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]}>
            Account
          </Text>
          {user?.email && (
            <Text style={[styles.headerEmail, { color: "rgba(250,249,246,0.5)", fontFamily: "DM_Sans_400Regular" }]}>
              {user.fullName ? `${user.fullName} · ` : ""}{user.email}
            </Text>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
          <View style={styles.planTop}>
            <View>
              <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                Current plan
              </Text>
              <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                {isPro ? "Pro" : "Free"}
              </Text>
            </View>
            <View style={[styles.planBadge, {
              borderColor: isPro ? colors.accent + "80" : "rgba(250,250,249,0.2)",
              backgroundColor: isPro ? colors.accent + "20" : "transparent",
            }]}>
              <Text style={[styles.planBadgeText, {
                color: isPro ? colors.accent : "rgba(250,250,249,0.6)",
                fontFamily: "DM_Sans_500Medium",
              }]}>
                {isPro ? "Pro" : "Free tier"}
              </Text>
            </View>
          </View>

          <View style={styles.usageSection}>
            <View style={styles.usageRow}>
              <Text style={[styles.usageLabel, { color: "rgba(250,250,249,0.6)", fontFamily: "DM_Sans_400Regular" }]}>
                Monthly reports used
              </Text>
              <Text style={[styles.usageCount, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                {isPro ? `${usage} / ∞` : `${usage}/${freeLimit}`}
              </Text>
            </View>
            {!isPro && (
              <>
                <View style={[styles.usageTrack, { backgroundColor: "rgba(250,250,249,0.12)" }]}>
                  <View
                    style={[styles.usageFill, {
                      width: `${usagePct}%`,
                      backgroundColor: usage >= freeLimit ? colors.red : colors.accent,
                    }]}
                  />
                </View>
                {usage >= freeLimit && (
                  <Text style={[styles.limitNote, { color: colors.amber, fontFamily: "DM_Sans_500Medium" }]}>
                    Monthly limit reached — upgrade to continue
                  </Text>
                )}
              </>
            )}
          </View>

          {isPro && (
            <View style={styles.proActions}>
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: "rgba(250,250,249,0.2)" }]}
                onPress={handleManageSubscription}
                activeOpacity={0.7}
              >
                <Feather name="credit-card" size={14} color="rgba(250,250,249,0.6)" />
                <Text style={[styles.actionBtnText, { color: "rgba(250,250,249,0.6)", fontFamily: "DM_Sans_400Regular" }]}>
                  Manage subscription
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, { borderColor: "rgba(250,250,249,0.2)" }]}
                onPress={handleRestore}
                activeOpacity={0.7}
                disabled={restoreLoading}
              >
                {restoreLoading
                  ? <ActivityIndicator size="small" color="rgba(250,250,249,0.6)" />
                  : <Feather name="refresh-cw" size={14} color="rgba(250,250,249,0.6)" />
                }
                <Text style={[styles.actionBtnText, { color: "rgba(250,250,249,0.6)", fontFamily: "DM_Sans_400Regular" }]}>
                  Restore purchases
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {!isPro && (
          <>
            <SectionHeader title="Upgrade to Pro" />

            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    Pro Plan
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>$49</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      /mo NZD
                    </Text>
                  </View>
                </View>
                <View style={[styles.proBadge, { backgroundColor: colors.accent }]}>
                  <Text style={[styles.proBadgeText, { fontFamily: "DM_Sans_700Bold" }]}>PRO</Text>
                </View>
              </View>

              <View style={styles.featuresList}>
                {PLAN_FEATURES.pro.map((f) => (
                  <FeatureRow key={f} text={f} included />
                ))}
              </View>

              <TouchableOpacity
                style={[styles.upgradeBtn, { backgroundColor: upgradeLoading ? colors.accent + "80" : colors.accent }]}
                activeOpacity={0.8}
                onPress={handleUpgrade}
                disabled={upgradeLoading || restoreLoading}
              >
                {upgradeLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                      Upgrade to Pro
                    </Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleRestore}
                activeOpacity={0.7}
                disabled={upgradeLoading || restoreLoading}
                style={styles.restoreLink}
              >
                {restoreLoading
                  ? <ActivityIndicator size="small" color={colors.mutedForeground} />
                  : <Text style={[styles.restoreLinkText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      Restore purchases
                    </Text>
                }
              </TouchableOpacity>
            </View>
          </>
        )}

        <SectionHeader title={isPro ? "Pro plan includes" : "Free plan includes"} />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(isPro ? PLAN_FEATURES.pro : PLAN_FEATURES.free).map((f) => (
            <FeatureRow key={f} text={f} included />
          ))}
        </View>

        <SectionHeader title="Analysis history" />

        <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {historyLoading ? (
            <View style={styles.historyEmpty}>
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <Text style={[styles.historyEmptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                Loading history…
              </Text>
            </View>
          ) : historySearches.length === 0 ? (
            <View style={styles.historyEmpty}>
              <Feather name="clock" size={20} color={colors.mutedForeground} />
              <Text style={[styles.historyEmptyText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                No analysis history yet.{"\n"}Run a feasibility check to save your first report.
              </Text>
            </View>
          ) : (
            historySearches.map((item, i) => (
              <View key={item.id} style={openingId === item.id ? { opacity: 0.5 } : undefined}>
                <HistoryItem
                  item={item}
                  onTap={handleHistoryTap}
                  onDelete={handleHistoryDelete}
                  isLast={i === historySearches.length - 1}
                />
              </View>
            ))
          )}
        </View>

        {historySearches.length > 0 && (
          <Text style={[styles.historyHint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Tap to reopen · Long-press to delete
          </Text>
        )}

        <SectionHeader title="Your stats" />

        <View style={[styles.statsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
              {sessions.length}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Sessions
            </Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
              {historySearches.length > 0 ? historySearches.length : reportCount}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Reports
            </Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
              {sessions.reduce((acc, s) => acc + s.messages.length, 0)}
            </Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Messages
            </Text>
          </View>
        </View>

        <SectionHeader title="About" />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.aboutText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Lecorb is an AI-powered real estate development feasibility tool designed for the New Zealand property market. Powered by Gemini AI with deep NZ-specific knowledge.
          </Text>
          <View style={[styles.disclaimerBox, { backgroundColor: colors.muted, borderRadius: 8 }]}>
            <Text style={[styles.disclaimerText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              All cost estimates are indicative only. Always engage qualified professionals before making development decisions.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.signOutBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={handleSignOut}
          activeOpacity={0.7}
        >
          <Feather name="log-out" size={18} color={colors.danger} />
          <Text style={[styles.signOutText, { color: colors.danger, fontFamily: "DM_Sans_500Medium" }]}>
            Sign out
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerContent: { paddingTop: 10 },
  headerTitle: { fontSize: 20, letterSpacing: -0.3 },
  headerEmail: { fontSize: 13, marginTop: 2 },
  content: { padding: 16, gap: 8 },
  sectionHeader: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 4,
    marginTop: 12,
    marginBottom: 4,
  },
  planCard: { borderRadius: 16, padding: 20, gap: 18, marginBottom: 4 },
  planTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  planLabel: { fontSize: 12, marginBottom: 3, letterSpacing: 0.2 },
  planName: { fontSize: 26, letterSpacing: -0.5 },
  planBadge: { borderWidth: 1, borderRadius: 100, paddingHorizontal: 10, paddingVertical: 4 },
  planBadgeText: { fontSize: 12 },
  usageSection: { gap: 8 },
  usageRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  usageLabel: { fontSize: 13 },
  usageCount: { fontSize: 13 },
  usageTrack: { height: 5, borderRadius: 3, overflow: "hidden" },
  usageFill: { height: "100%", borderRadius: 3 },
  limitNote: { fontSize: 12, marginTop: 2 },
  proActions: { gap: 8 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  actionBtnText: { fontSize: 13 },
  proCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 18,
    gap: 16,
    shadowColor: "rgba(217,119,87,0.1)",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 3,
  },
  proTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  proTitle: { fontSize: 20, letterSpacing: -0.3 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 3 },
  price: { fontSize: 30, letterSpacing: -1 },
  pricePer: { fontSize: 13 },
  proBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 100 },
  proBadgeText: { fontSize: 11, color: "#fff", letterSpacing: 0.5 },
  featuresList: { gap: 10 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  featureText: { fontSize: 14 },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 2,
    minHeight: 50,
  },
  upgradeBtnText: { fontSize: 15, color: "#fff" },
  restoreLink: { alignItems: "center", paddingVertical: 6 },
  restoreLinkText: { fontSize: 13 },
  section: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
  historyCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  historyEmpty: {
    padding: 24,
    alignItems: "center",
    gap: 10,
  },
  historyEmptyText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  historyItemMain: {
    flex: 1,
    gap: 4,
  },
  historyAddress: {
    fontSize: 14,
    lineHeight: 20,
  },
  historyMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexWrap: "wrap",
  },
  historyMetaText: {
    fontSize: 11,
    lineHeight: 16,
  },
  historyMetaDot: {
    fontSize: 11,
  },
  zoneChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  zoneChipText: {
    fontSize: 10,
  },
  historyItemRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scoreDot: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  scoreDotText: {
    fontSize: 12,
  },
  historyHint: {
    fontSize: 11,
    textAlign: "center",
    marginTop: 2,
    marginBottom: 4,
  },
  statsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: { alignItems: "center", flex: 1, gap: 4 },
  statNum: { fontSize: 30, letterSpacing: -1 },
  statLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 },
  statDivider: { width: 1, height: 44 },
  aboutText: { fontSize: 14, lineHeight: 22 },
  disclaimerBox: { padding: 12, marginTop: 4 },
  disclaimerText: { fontSize: 12, lineHeight: 18 },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  signOutText: { fontSize: 15 },
});
