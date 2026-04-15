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
  Image,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat, FeasibilityReport } from "@/context/ChatContext";
import { useSubscription } from "@/lib/revenuecat";

const FREE_LIMIT = 2;
const STANDARD_LIMIT = 20;

const PLAN_FEATURES = {
  free: [
    "2 feasibility reports/month",
    "Chat & property discovery",
  ],
  standard: [
    "More feasibility reports/month",
    "Chat & property discovery",
    "Access to architect/designer & other disciplines",
    "AI live translation messages & calls",
  ],
  agent: [
    "Unlimited property listings",
    "Featured in property search",
    "Client feasibility tools",
    "Analytics & performance insights",
    "Priority support",
  ],
  provider: [
    "Lecorb recommends you when a user's need fits your expertise",
    "Get insights into your potential clients",
    "AI powered live translation across languages",
    "Access to feasibility reports",
  ],
};

const AGENT_PLAN_PRICE = "$99.00";
const PROVIDER_PLAN_PRICE = "$149.00";

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

  const { purchase, restore, isPurchasing, isRestoring, isSubscribed, getPackageForRole, getPriceForRole } = useSubscription();
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [historySearches, setHistorySearches] = useState<SearchSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const isStandard = user?.subscriptionTier === "pro" || user?.subscriptionTier === "standard";
  const planLimit = isStandard ? STANDARD_LIMIT : FREE_LIMIT;
  const usage = user?.reportsUsedThisMonth ?? 0;
  const remaining = planLimit - usage;
  const usagePct = Math.min((usage / planLimit) * 100, 100);
  const showWarning = remaining <= 3 && remaining >= 0;

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
    if (isSubscribed) {
      syncToBackend("pro");
    }
  }, [isSubscribed]);

  const role = user?.role ?? "general";

  const handleUpgrade = useCallback(async () => {
    setUpgradeLoading(true);
    try {
      const pkg = getPackageForRole(role);
      if (!pkg) {
        Alert.alert("Unavailable", "Subscription packages are not available right now. Please try again later.");
        return;
      }
      await purchase(pkg);
      await syncToBackend("pro");
      if (role === "sales_agent") {
        Alert.alert("Agent Pro activated!", "You now have full access to your Agent Pro plan.");
      } else if (role === "service_provider") {
        Alert.alert("Provider Pro activated!", "Your profile is now visible to developers.");
      } else {
        Alert.alert("Welcome to Standard!", `You now have ${STANDARD_LIMIT} reports per month.`);
      }
    } catch (err: unknown) {
      const userCancelled = (err as { userCancelled?: boolean })?.userCancelled;
      if (!userCancelled) {
        const message = (err as { message?: string })?.message;
        Alert.alert("Purchase failed", message ?? "Something went wrong. Please try again.");
      }
    } finally {
      setUpgradeLoading(false);
    }
  }, [syncToBackend, role, purchase, getPackageForRole]);

  const handleRestore = useCallback(async () => {
    setRestoreLoading(true);
    try {
      const info = await restore();
      const isActive = info?.entitlements?.active?.["Pro"] !== undefined;
      if (isActive) {
        await syncToBackend("pro");
        Alert.alert("Purchases restored", "Your subscription is now active.");
      } else {
        Alert.alert("No purchases found", "No active subscription was found.");
      }
    } catch {
      Alert.alert("Restore failed", "Could not restore purchases. Please try again.");
    } finally {
      setRestoreLoading(false);
    }
  }, [syncToBackend, restore]);

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

  const handleDeleteAccount = () => {
    Alert.alert(
      "Delete account",
      "This will permanently delete your account and all your reports. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete my account",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Are you sure?",
              `All data for ${user?.email ?? "your account"} will be permanently removed.`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Yes, delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      const resp = await fetch(`${getApiBase()}/account`, {
                        method: "DELETE",
                        headers: getApiHeaders(),
                      });
                      if (resp.ok) {
                        await signOut();
                        router.replace("/(auth)/login");
                      } else {
                        Alert.alert("Error", "Could not delete your account. Please try again or contact support.");
                      }
                    } catch {
                      Alert.alert("Error", "Could not delete your account. Please check your connection.");
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.headerContent}>
          <View style={styles.headerRow}>
            {user?.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatarInitials, { backgroundColor: "rgba(250,249,246,0.15)" }]}>
                <Text style={[styles.headerAvatarText, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {(user?.fullName ?? user?.email ?? "?").slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.headerTextGroup}>
              <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]}>
                {user?.fullName ?? "Account"}
              </Text>
              {user?.email && (
                <Text style={[styles.headerEmail, { color: "rgba(250,249,246,0.5)", fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
                  {user.email}
                </Text>
              )}
            </View>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Plan card — general users */}
        {role === "general" && (
          <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
            <View style={styles.planTop}>
              <View>
                <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                  Current plan
                </Text>
                <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {isStandard ? "Standard" : "Free"}
                </Text>
              </View>
              <View style={[styles.planBadge, {
                borderColor: isStandard ? colors.accent + "80" : "rgba(250,250,249,0.2)",
                backgroundColor: isStandard ? colors.accent + "20" : "transparent",
              }]}>
                <Text style={[styles.planBadgeText, {
                  color: isStandard ? colors.accent : "rgba(250,250,249,0.6)",
                  fontFamily: "DM_Sans_500Medium",
                }]}>
                  {isStandard ? "Standard" : "Free tier"}
                </Text>
              </View>
            </View>

            <View style={styles.usageSection}>
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: "rgba(250,250,249,0.6)", fontFamily: "DM_Sans_400Regular" }]}>
                  Reports used this month
                </Text>
                <Text style={[styles.usageCount, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {usage}/{planLimit}
                </Text>
              </View>
              <View style={[styles.usageTrack, { backgroundColor: "rgba(250,250,249,0.12)" }]}>
                <View
                  style={[styles.usageFill, {
                    width: `${usagePct}%`,
                    backgroundColor: usage >= planLimit ? colors.red : showWarning ? colors.amber : colors.accent,
                  }]}
                />
              </View>
              {usage >= planLimit && (
                <Text style={[styles.limitNote, { color: colors.red, fontFamily: "DM_Sans_500Medium" }]}>
                  Monthly limit reached — {isStandard ? "resets on the 1st" : "upgrade to continue"}
                </Text>
              )}
              {showWarning && usage < planLimit && (
                <Text style={[styles.limitNote, { color: colors.amber, fontFamily: "DM_Sans_500Medium" }]}>
                  {remaining} report{remaining !== 1 ? "s" : ""} remaining this month
                </Text>
              )}
            </View>

            {isStandard && (
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
              </View>
            )}
          </View>
        )}

        {/* Plan card — sales agent */}
        {role === "sales_agent" && (
          <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
            <View style={styles.planTop}>
              <View>
                <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                  Current plan
                </Text>
                <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {isStandard ? "Agent Pro" : "Not subscribed"}
                </Text>
              </View>
              <View style={[styles.planBadge, {
                borderColor: isStandard ? colors.accent + "80" : "rgba(250,250,249,0.2)",
                backgroundColor: isStandard ? colors.accent + "20" : "transparent",
              }]}>
                <Text style={[styles.planBadgeText, {
                  color: isStandard ? colors.accent : "rgba(250,250,249,0.6)",
                  fontFamily: "DM_Sans_500Medium",
                }]}>
                  {isStandard ? "Active" : "Inactive"}
                </Text>
              </View>
            </View>
            {isStandard && (
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
              </View>
            )}
          </View>
        )}

        {/* Plan card — service provider */}
        {role === "service_provider" && (
          <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
            <View style={styles.planTop}>
              <View>
                <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                  Current plan
                </Text>
                <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {isStandard ? "Provider Pro" : "Not subscribed"}
                </Text>
              </View>
              <View style={[styles.planBadge, {
                borderColor: isStandard ? colors.accent + "80" : "rgba(250,250,249,0.2)",
                backgroundColor: isStandard ? colors.accent + "20" : "transparent",
              }]}>
                <Text style={[styles.planBadgeText, {
                  color: isStandard ? colors.accent : "rgba(250,250,249,0.6)",
                  fontFamily: "DM_Sans_500Medium",
                }]}>
                  {isStandard ? "Active" : "Inactive"}
                </Text>
              </View>
            </View>
            {isStandard && (
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
              </View>
            )}
          </View>
        )}

        {/* Upgrade card — general user only */}
        {role === "general" && !isStandard && (
          <>
            <SectionHeader title="Upgrade to Standard" />

            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    Standard Plan
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>$24.99</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      /mo NZD
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.featuresList}>
                {PLAN_FEATURES.standard.map((f) => (
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
                      Upgrade to Standard
                    </Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

            </View>
          </>
        )}

        {/* Activate plan card — sales agent */}
        {role === "sales_agent" && !isStandard && (
          <>
            <SectionHeader title="Activate Agent Pro" />

            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    Agent Pro Plan
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{getPriceForRole("sales_agent")}</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      /mo NZD
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.featuresList}>
                {PLAN_FEATURES.agent.map((f) => (
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
                      Activate Agent Pro
                    </Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

            </View>
          </>
        )}

        {/* Activate plan card — service provider */}
        {role === "service_provider" && !isStandard && (
          <>
            <SectionHeader title="Activate Provider Pro" />

            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    Provider Pro Plan
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{getPriceForRole("service_provider")}</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      /mo NZD
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.featuresList}>
                {PLAN_FEATURES.provider.map((f) => (
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
                      Activate Provider Pro
                    </Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

            </View>
          </>
        )}

        {/* Plan features summary */}
        <SectionHeader title={
          role === "sales_agent"
            ? (isStandard ? "Agent Pro includes" : "Agent Pro features")
            : role === "service_provider"
            ? (isStandard ? "Provider Pro includes" : "Provider Pro features")
            : (isStandard ? "Standard plan includes" : "Free plan includes")
        } />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(role === "sales_agent"
            ? PLAN_FEATURES.agent
            : role === "service_provider"
            ? PLAN_FEATURES.provider
            : isStandard ? PLAN_FEATURES.standard : PLAN_FEATURES.free
          ).map((f) => (
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

        {/* Actions */}
        <View style={[styles.actionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <Feather name="log-out" size={17} color={colors.danger} />
            <Text style={[styles.actionRowText, { color: colors.danger, fontFamily: "DM_Sans_500Medium" }]}>
              Sign out
            </Text>
            <Feather name="chevron-right" size={16} color={colors.danger + "80"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
          >
            <Feather name="trash-2" size={17} color={colors.mutedForeground} />
            <Text style={[styles.actionRowText, { color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium" }]}>
              Delete account
            </Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground + "60"} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerContent: { paddingTop: 10 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  headerAvatar: { width: 48, height: 48, borderRadius: 24 },
  headerAvatarInitials: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  headerAvatarText: { fontSize: 20, letterSpacing: -0.5 },
  headerTextGroup: { flex: 1 },
  headerTitle: { fontSize: 18, letterSpacing: -0.3 },
  headerEmail: { fontSize: 13, marginTop: 1 },
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
  proActions: { flexDirection: "row", gap: 8 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  actionBtnText: { fontSize: 12, flex: 1 },
  proCard: { borderRadius: 16, padding: 18, gap: 14, borderWidth: 1.5 },
  proTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  proTitle: { fontSize: 18, letterSpacing: -0.3 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 4 },
  price: { fontSize: 28, letterSpacing: -0.5 },
  pricePer: { fontSize: 14 },
  proBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  proBadgeText: { fontSize: 11, color: "#fff", letterSpacing: 0.5 },
  featuresList: { gap: 8 },
  featureRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  featureText: { fontSize: 14 },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 50,
  },
  upgradeBtnText: { fontSize: 15, color: "#fff" },
  restoreLink: { alignItems: "center", paddingVertical: 4 },
  restoreLinkText: { fontSize: 13 },
  section: { borderRadius: 14, padding: 16, gap: 10, borderWidth: 1 },
  historyCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  historyItem: { paddingVertical: 13, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 10 },
  historyItemMain: { flex: 1, gap: 4 },
  historyAddress: { fontSize: 14 },
  historyMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  historyMetaText: { fontSize: 12 },
  historyMetaDot: { fontSize: 12 },
  zoneChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  zoneChipText: { fontSize: 11 },
  historyItemRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  scoreDot: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  scoreDotText: { fontSize: 12 },
  historyEmpty: { padding: 28, alignItems: "center", gap: 10 },
  historyEmptyText: { fontSize: 13, textAlign: "center", lineHeight: 20 },
  historyHint: { fontSize: 11, textAlign: "center", paddingHorizontal: 4 },
  statsCard: { borderRadius: 14, borderWidth: 1, flexDirection: "row", overflow: "hidden" },
  statItem: { flex: 1, alignItems: "center", paddingVertical: 18, gap: 3 },
  statNum: { fontSize: 24, letterSpacing: -0.5 },
  statLabel: { fontSize: 12 },
  statDivider: { width: StyleSheet.hairlineWidth },
  actionsCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 4,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  actionRowText: {
    flex: 1,
    fontSize: 15,
  },
});
