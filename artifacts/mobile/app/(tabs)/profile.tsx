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
  TextInput,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { hasServiceProviderAccess, useAuth } from "@/context/AuthContext";
import { useSubscription, getSubscriptionSyncBody } from "@/lib/revenuecat";
import { avatarImageSource, getAvatarInitials } from "@/lib/avatar";
import { getApiBase } from "@/lib/api";
import { WORLD_LANGUAGES } from "@/lib/languages";
import { useT } from "@/lib/i18n";
import { NewsBellButton } from "@/components/NewsBellButton";
import { STANDARD_REPORT_LIMIT, resolveReportLimit } from "@/lib/quotas";

type PlanFeatureItem = { text: string; included: boolean };

function buildPlanFeatures(t: (k: string) => string) {
  return {
    free: [t("feature.feasibility_reports"), t("feature.chat_search")],
    standard: [
      t("paywall.f1"),
      t("feature.private_search"),
      t("paywall.f2"),
      t("paywall.f3"),
      t("paywall.f4"),
      t("paywall.f5"),
      t("paywall.f6"),
    ],
    agent: [
      t("feature.unlimited_listings"),
      t("feature.featured_search"),
      t("feature.private_search"),
      t("feature.client_tools"),
      t("feature.analytics"),
      t("feature.priority_support"),
    ],
    provider: [
      { text: t("provider_welcome.feature_investors"), included: true },
      { text: t("provider_welcome.feature_search_reports"), included: true },
      { text: t("feature.private_search"), included: true },
      { text: t("provider_welcome.feature_encrypted_chat"), included: true },
      { text: t("feature.provider_live_translation_soon"), included: false },
      { text: t("feature.provider_automation_tools_soon"), included: false },
    ] satisfies PlanFeatureItem[],
  };
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

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut, getApiHeaders, refreshProfile, uploadProfilePicture, isSubscriptionIdentityReady } = useAuth();
  const router = useRouter();
  const { t } = useT();
  const PLAN_FEATURES = buildPlanFeatures(t);

  const { purchase, isSubscribed, customerInfoLoaded, isTestPaymentMode, refetchCustomerInfo, refetchOfferings, refetchStoreProducts, offeringsLoading, purchaseReadyForRole, getFreshPackageForRole, getPriceForRole } = useSubscription();
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  // Refresh RevenueCat status each time the profile screen mounts so the correct
  // per-user identity is reflected. Skipped in test payment mode where there is
  // no real native RC connection available.
  useEffect(() => {
    if (isTestPaymentMode) return;
    if (!isSubscriptionIdentityReady) return;
    refetchCustomerInfo();
    void refetchOfferings();
    void refetchStoreProducts();
  }, [isTestPaymentMode, isSubscriptionIdentityReady, refetchCustomerInfo, refetchOfferings, refetchStoreProducts]);

  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const splitName = (fullName: string | null | undefined) => {
    if (!fullName) return { first: "", last: "" };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: "" };
    return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
  };

  const { first: initFirst, last: initLast } = splitName(user?.fullName);
  const [editFirst, setEditFirst] = useState(initFirst);
  const [editLast, setEditLast] = useState(initLast);
  const [editLanguage, setEditLanguage] = useState(user?.languages?.[0] ?? "");
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      const { first, last } = splitName(user?.fullName);
      setEditFirst(first);
      setEditLast(last);
      setEditLanguage(user?.languages?.[0] ?? "");
    }
  }, [user, isEditing]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const specialStatus = user?.specialStatus ?? null;
  const isFriendsFamily = specialStatus === "friends_family";
  const isSupercharge = specialStatus === "supercharge";
  const hasSpecialStatus = isFriendsFamily || isSupercharge;
  const providerHasAccess = hasServiceProviderAccess(user);
  const agentUnlimited = user?.role === "sales_agent" && user?.agentAiUnlimited === true;
  const isStandard = user?.subscriptionTier === "pro" || user?.subscriptionTier === "standard" || providerHasAccess || agentUnlimited;
  const planLimit = resolveReportLimit(user?.subscriptionTier, user?.role, specialStatus, providerHasAccess, agentUnlimited);
  const usage = user?.reportsUsedThisMonth ?? 0;
  const remaining = planLimit - usage;
  const usagePct = planLimit > 0 ? Math.min((usage / planLimit) * 100, 100) : 100;
  const showWarning = remaining <= 3 && remaining >= 0;

  // Formatted expiry date for Supercharge (e.g. "11/23/2026")
  const superchargeExpiryLabel = (() => {
    if (!isSupercharge || !user?.specialStatusExpiresAt) return null;
    const d = new Date(user.specialStatusExpiresAt);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString();
  })();

  const role = user?.role ?? "general";
  const primaryLanguage = user?.languages?.[0] ?? null;

  // Returns true on a confirmed 2xx response so callers can surface failures.
  const syncToBackend = useCallback(async (tier: "pro" | "free"): Promise<boolean> => {
    try {
      const body = await getSubscriptionSyncBody(tier);
      const resp = await fetch(`${getApiBase()}/subscription/sync`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify(body),
      });
      await refreshProfile().catch(() => {});
      return resp.ok;
    } catch {
      return false;
    }
  }, [getApiHeaders, refreshProfile]);

  useEffect(() => {
    // In test payment mode there is no real RC subscription to read from, so
    // we trust the DB tier and never try to overwrite it from RC.
    if (isTestPaymentMode) return;
    // Never act on stale RC data from a previous identity.
    if (!isSubscriptionIdentityReady) return;
    if (!user?.id) return;
    if (user.role === "service_provider" && (user.providerAccessKind === "stripe" || user.providerAccessKind === "trial")) return;
    if (isSubscribed) {
      syncToBackend("pro");
    } else if (customerInfoLoaded) {
      // RC has definitively confirmed no active subscription for THIS user —
      // correct the DB tier if needed.
      syncToBackend("free");
    }
  }, [
    isSubscribed,
    customerInfoLoaded,
    isTestPaymentMode,
    isSubscriptionIdentityReady,
    user?.id,
    user?.role,
    user?.providerAccessKind,
    syncToBackend,
  ]);

  const handleUpgrade = useCallback(async () => {
    setUpgradeLoading(true);
    try {
      const pkg = await getFreshPackageForRole(role);
      if (!pkg) {
        Alert.alert(t("profile.unavailable"), t("profile.sub_unavailable"));
        return;
      }
      await purchase(pkg);
      await refetchCustomerInfo();
      const synced = await syncToBackend("pro");
      if (!synced) {
        Alert.alert(t("profile.almost_there"), t("profile.payment_no_account"));
        return;
      }
      if (role === "sales_agent") {
        Alert.alert(t("profile.agent_activated_title"), t("profile.agent_activated_msg"));
      } else if (role === "service_provider") {
        Alert.alert(t("profile.provider_activated_title"), t("profile.provider_activated_msg"));
      } else {
        Alert.alert(t("profile.welcome_standard"), t("profile.welcome_standard_msg", { n: STANDARD_REPORT_LIMIT }));
      }
    } catch (err: unknown) {
      const userCancelled = (err as { userCancelled?: boolean })?.userCancelled;
      if (!userCancelled) {
        const message = (err as { message?: string })?.message;
        Alert.alert(t("profile.purchase_failed"), message ?? t("profile.purchase_failed_msg"));
      }
    } finally {
      setUpgradeLoading(false);
    }
  }, [syncToBackend, role, purchase, getFreshPackageForRole, refetchCustomerInfo, t]);

  const handleManageSubscription = useCallback(() => {
    if (Platform.OS === "ios") {
      Linking.openURL("https://apps.apple.com/account/subscriptions");
    } else {
      Linking.openURL("https://play.google.com/store/account/subscriptions");
    }
  }, []);

  const handleSaveProfile = useCallback(async () => {
    setIsSaving(true);
    try {
      const fullName = [editFirst.trim(), editLast.trim()].filter(Boolean).join(" ");
      const languages = editLanguage ? [editLanguage] : [];
      const resp = await fetch(`${getApiBase()}/auth/profile`, {
        method: "PATCH",
        headers: { ...getApiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, languages }),
      });
      if (resp.ok) {
        await refreshProfile().catch(() => {});
        setIsEditing(false);
      } else {
        Alert.alert(t("profile.error"), t("profile.error_save"));
      }
    } catch {
      Alert.alert(t("profile.error"), t("profile.error_save_conn"));
    } finally {
      setIsSaving(false);
    }
  }, [editFirst, editLast, editLanguage, getApiHeaders, refreshProfile]);

  const handlePickAvatar = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    setAvatarUploading(true);
    try {
      const mime = asset.mimeType ?? "image/jpeg";
      const ext = mime.split("/")[1]?.split(";")[0] || "jpg";
      await uploadProfilePicture(asset.uri, mime, `avatar.${ext}`);
      await refreshProfile().catch(() => {});
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : t("profile.error_upload_conn");
      Alert.alert(t("profile.error"), message);
    } finally {
      setAvatarUploading(false);
    }
  }, [refreshProfile, uploadProfilePicture]);

  const handleSignOut = () => {
    Alert.alert(t("profile.sign_out"), t("profile.sign_out_q"), [
      { text: t("profile.cancel"), style: "cancel" },
      {
        text: t("profile.sign_out"), style: "destructive", onPress: async () => {
          await signOut();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      t("profile.delete_account"),
      t("profile.delete_q"),
      [
        { text: t("profile.cancel"), style: "cancel" },
        {
          text: t("profile.delete_account_btn"),
          style: "destructive",
          onPress: () => {
            Alert.alert(
              t("profile.delete_account"),
              t("profile.delete_warn", { target: user?.email ?? "" }),
              [
                { text: t("profile.cancel"), style: "cancel" },
                {
                  text: t("profile.delete_confirm"),
                  style: "destructive",
                  onPress: async () => {
                    try {
                      const resp = await fetch(`${getApiBase()}/auth/account`, {
                        method: "DELETE",
                        headers: getApiHeaders(),
                      });
                      if (resp.ok) {
                        await signOut();
                        router.replace("/(auth)/login");
                      } else {
                        Alert.alert(t("profile.error"), t("profile.error_delete"));
                      }
                    } catch {
                      Alert.alert(t("profile.error"), t("profile.error_delete_conn"));
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

  const avatarSource = avatarImageSource(user?.avatarUrl, getApiHeaders());
  const displayInitial = getAvatarInitials(user?.fullName, user?.email);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.headerBg }]}>
        <View style={styles.headerContent}>
          <View style={styles.headerRow}>
            {avatarSource ? (
              <Image source={avatarSource} style={styles.headerAvatar} />
            ) : (
              <View style={[styles.headerAvatarInitials, { backgroundColor: "rgba(250,249,246,0.15)" }]}>
                <Text style={[styles.headerAvatarText, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {displayInitial}
                </Text>
              </View>
            )}
            <View style={styles.headerTextGroup}>
              <View style={styles.headerNameRow}>
                <Text style={[styles.headerTitle, { color: colors.headerText, fontFamily: "DM_Sans_600SemiBold" }]}>
                  {user?.fullName ?? t("profile.account")}
                </Text>
                {user?.isVerified && user.role === "service_provider" && (
                  <View style={styles.headerVerifiedBadge}>
                    <VerifiedBadge size={11} />
                    <Text style={styles.headerVerifiedText}>{t("profile.verified")}</Text>
                  </View>
                )}
              </View>
              {user?.email && (
                <Text style={[styles.headerEmail, { color: "rgba(250,249,246,0.5)", fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
                  {user.email}
                </Text>
              )}
            </View>
            <View style={{ marginLeft: "auto" }}><NewsBellButton /></View>
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 48 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ─── User Details ─── */}
        <SectionHeader title={t("profile.your_details")} />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {/* Avatar row */}
          <TouchableOpacity onPress={handlePickAvatar} disabled={avatarUploading} style={styles.avatarRow} activeOpacity={0.8}>
            <View style={styles.avatarWrap}>
              {avatarSource ? (
                <Image source={avatarSource} style={styles.avatar} />
              ) : (
                <View style={[styles.avatarPlaceholder, { backgroundColor: colors.accent + "30", borderColor: colors.accent + "50" }]}>
                  <Text style={[styles.avatarInitial, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
                    {displayInitial}
                  </Text>
                </View>
              )}
              <View style={[styles.cameraOverlay, { backgroundColor: colors.accent }]}>
                {avatarUploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Feather name="camera" size={12} color="#fff" />
                }
              </View>
            </View>
            <Text style={[styles.avatarLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {avatarUploading ? t("profile.uploading") : t("profile.change_photo")}
            </Text>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Name & language display / edit */}
          {isEditing ? (
            <View style={styles.editFields}>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.first_name")}</Text>
                <TextInput
                  value={editFirst}
                  onChangeText={setEditFirst}
                  style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.accent, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder={t("profile.first_name")}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.last_name")}</Text>
                <TextInput
                  value={editLast}
                  onChangeText={setEditLast}
                  style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.accent, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder={t("profile.last_name")}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.language")}</Text>
                <TouchableOpacity
                  style={[styles.fieldInput, styles.langBtn, { borderColor: colors.accent }]}
                  onPress={() => setShowLanguagePicker((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Text style={[{ color: colors.foreground, fontFamily: "DM_Sans_400Regular", fontSize: 14 }]}>
                    {editLanguage || "Select…"}
                  </Text>
                  <Feather name="chevron-down" size={14} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              {showLanguagePicker && (
                <View style={[styles.languageList, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {WORLD_LANGUAGES.map((lang) => (
                    <TouchableOpacity
                      key={lang}
                      style={[styles.languageItem, { borderBottomColor: colors.border }]}
                      onPress={() => { setEditLanguage(lang); setShowLanguagePicker(false); }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.languageItemText, {
                        color: lang === editLanguage ? colors.accent : colors.foreground,
                        fontFamily: lang === editLanguage ? "DM_Sans_600SemiBold" : "DM_Sans_400Regular",
                      }]}>
                        {lang}
                      </Text>
                      {lang === editLanguage && <Feather name="check" size={14} color={colors.accent} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.editActions}>
                <TouchableOpacity
                  style={[styles.cancelBtn, { borderColor: colors.border }]}
                  onPress={() => { setIsEditing(false); setShowLanguagePicker(false); }}
                  activeOpacity={0.7}
                >
                  <Text style={[{ color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium", fontSize: 14 }]}>{t("profile.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: isSaving ? colors.accent + "80" : colors.accent }]}
                  onPress={handleSaveProfile}
                  disabled={isSaving}
                  activeOpacity={0.8}
                >
                  {isSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={[{ color: "#fff", fontFamily: "DM_Sans_600SemiBold", fontSize: 14 }]}>{t("profile.save")}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.detailsDisplay}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.name")}</Text>
                <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  {user?.fullName ?? "—"}
                </Text>
              </View>
              <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.language")}</Text>
                <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  {primaryLanguage ?? "—"}
                </Text>
              </View>
              {user?.phoneNumber && (
                <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.contact")}</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {user.phoneNumber}
                  </Text>
                </View>
              )}
              {user?.agencyName && (
                <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.agency")}</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {user.agencyName}
                  </Text>
                </View>
              )}
              {role === "service_provider" && user?.discipline && (
                <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("profile.discipline")}</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {user.discipline === "architect_designer" ? "Architect / Designer"
                      : user.discipline === "planner" ? "Planner"
                      : user.discipline === "engineer" ? "Engineer"
                      : user.discipline === "quantity_surveyor" ? "Land Surveyor"
                      : user.discipline === "other" ? "Other"
                      : user.discipline}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.editBtn, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
                onPress={() => setIsEditing(true)}
                activeOpacity={0.7}
              >
                <Feather name="edit-2" size={14} color={colors.accent} />
                <Text style={[{ color: colors.accent, fontFamily: "DM_Sans_500Medium", fontSize: 14 }]}>{t("profile.edit_details")}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ─── Plan card — general users ─── */}
        {role === "general" && (
          <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
            <View style={styles.planTop}>
              <View>
                <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                  {t("profile.current_plan")}
                </Text>
                <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {isFriendsFamily
                    ? t("profile.friendsFamily")
                    : isSupercharge
                    ? t("profile.supercharge")
                    : isStandard
                    ? t("profile.standard")
                    : t("profile.free")}
                </Text>
                {isSupercharge && superchargeExpiryLabel && (
                  <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular", marginTop: 4 }]}>
                    {t("profile.expiresOn", { date: superchargeExpiryLabel })}
                  </Text>
                )}
              </View>
              <View style={[styles.planBadge, {
                borderColor: hasSpecialStatus || isStandard ? colors.accent + "80" : "rgba(250,250,249,0.2)",
                backgroundColor: hasSpecialStatus || isStandard ? colors.accent + "20" : "transparent",
              }]}>
                <Text style={[styles.planBadgeText, {
                  color: hasSpecialStatus || isStandard ? colors.accent : "rgba(250,250,249,0.6)",
                  fontFamily: "DM_Sans_500Medium",
                }]}>
                  {isFriendsFamily
                    ? t("profile.friendsFamily")
                    : isSupercharge
                    ? t("profile.supercharge")
                    : isStandard
                    ? t("profile.standard")
                    : t("profile.free_tier")}
                </Text>
              </View>
            </View>

            <View style={styles.usageSection}>
              <View style={styles.usageRow}>
                <Text style={[styles.usageLabel, { color: "rgba(250,250,249,0.6)", fontFamily: "DM_Sans_400Regular" }]}>
                  {t("profile.reports_used")}
                </Text>
                <Text style={[styles.usageCount, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {agentUnlimited ? `${usage}/Unlimited` : `${usage}/${planLimit}`}
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
                  {isStandard ? t("profile.limit_reached_standard") : t("profile.limit_reached_free")}
                </Text>
              )}
              {showWarning && usage < planLimit && (
                <Text style={[styles.limitNote, { color: colors.amber, fontFamily: "DM_Sans_500Medium" }]}>
                  {remaining === 1 ? t("profile.remaining_one", { n: remaining }) : t("profile.remaining_other", { n: remaining })}
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
                    {t("profile.manage_sub")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ─── Plan card — sales agent ─── */}
        {role === "sales_agent" && (
          <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
            <View style={styles.planTop}>
              <View>
                <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                  {t("profile.current_plan")}
                </Text>
                <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {isStandard ? t("profile.agent_pro") : t("profile.not_subscribed")}
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
                  {isStandard ? t("profile.active") : t("profile.inactive")}
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
                    {t("profile.manage_sub")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ─── Plan card — service provider ─── */}
        {role === "service_provider" && (
          <View style={[styles.planCard, { backgroundColor: colors.headerBg }]}>
            <View style={styles.planTop}>
              <View>
                <Text style={[styles.planLabel, { color: "rgba(250,250,249,0.45)", fontFamily: "DM_Sans_400Regular" }]}>
                  {t("profile.current_plan")}
                </Text>
                <Text style={[styles.planName, { color: colors.headerText, fontFamily: "DM_Sans_700Bold" }]}>
                  {isStandard ? t("profile.provider_pro") : t("profile.not_subscribed")}
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
                  {isStandard ? t("profile.active") : t("profile.inactive")}
                </Text>
              </View>
            </View>
            <View style={styles.verificationBlock}>
              <View style={styles.verificationRow}>
                {user?.isVerified ? (
                  <>
                    <VerifiedBadge size={13} />
                    <Text style={[styles.verificationLabel, { color: "#52C99A", fontFamily: "DM_Sans_500Medium" }]}>
                      {t("profile.account_verified")}
                    </Text>
                  </>
                ) : (
                  <>
                    <Feather name="clock" size={13} color="rgba(250,249,246,0.4)" />
                    <Text style={[styles.verificationLabel, { color: "rgba(250,249,246,0.5)", fontFamily: "DM_Sans_400Regular" }]}>
                      {t("profile.verification_pending")}
                    </Text>
                  </>
                )}
              </View>
              {!user?.isVerified && (
                <Text style={[styles.verificationNote, { color: "rgba(250,249,246,0.35)", fontFamily: "DM_Sans_400Regular" }]}>
                  {t("profile.provider_pro_verification_note")}
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
                    {t("profile.manage_sub")}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ─── Upgrade card — general user ─── */}
        {role === "general" && !isStandard && !hasSpecialStatus && (
          <>
            <SectionHeader title={t("profile.upgrade_to_standard")} />
            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    {t("profile.standard_plan")}
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{getPriceForRole("general")}</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      {t("profile.per_month_nzd")}
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
                disabled={upgradeLoading || (!isTestPaymentMode && offeringsLoading)}
              >
                {upgradeLoading || (!isTestPaymentMode && offeringsLoading) ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                      {t("profile.upgrade_btn")}
                    </Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ─── Upgrade card — sales agent ─── */}
        {role === "sales_agent" && !isStandard && !hasSpecialStatus && (
          <>
            <SectionHeader title={t("profile.activate_agent_pro")} />
            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    {t("profile.agent_pro_features")}
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{getPriceForRole("sales_agent")}</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      {t("profile.per_month_nzd")}
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
                disabled={upgradeLoading || (!isTestPaymentMode && offeringsLoading)}
              >
                {upgradeLoading || (!isTestPaymentMode && offeringsLoading) ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("profile.activate_agent_pro")}</Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ─── Upgrade card — service provider ─── */}
        {role === "service_provider" && !isStandard && (
          <>
            <SectionHeader title={t("profile.activate_provider_pro")} />
            <View style={[styles.proCard, { backgroundColor: colors.card, borderColor: colors.accent + "35" }]}>
              <View style={styles.proTop}>
                <View>
                  <Text style={[styles.proTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                    {t("profile.provider_pro_plan")}
                  </Text>
                  <View style={styles.priceRow}>
                    <Text style={[styles.price, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>{getPriceForRole("service_provider")}</Text>
                    <Text style={[styles.pricePer, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      {t("profile.per_month_nzd")}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.featuresList}>
                {PLAN_FEATURES.provider.map((f) => (
                  <FeatureRow key={f.text} text={f.text} included={f.included} />
                ))}
              </View>
              <TouchableOpacity
                style={[styles.upgradeBtn, { backgroundColor: upgradeLoading ? colors.accent + "80" : colors.accent }]}
                activeOpacity={0.8}
                onPress={handleUpgrade}
                disabled={upgradeLoading || (!isTestPaymentMode && offeringsLoading)}
              >
                {upgradeLoading || (!isTestPaymentMode && offeringsLoading) ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("profile.activate_provider_pro")}</Text>
                    <Feather name="arrow-right" size={16} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ─── Plan features summary ─── */}
        <SectionHeader title={
          role === "sales_agent"
            ? (isStandard ? t("profile.agent_pro_includes") : t("profile.agent_pro_features"))
            : role === "service_provider"
            ? (isStandard ? t("profile.provider_pro_includes") : t("profile.provider_pro_features"))
            : (isStandard ? t("profile.standard_includes") : t("profile.free_includes"))
        } />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {(role === "sales_agent"
            ? PLAN_FEATURES.agent
            : role === "service_provider"
            ? PLAN_FEATURES.provider
            : isStandard ? PLAN_FEATURES.standard : PLAN_FEATURES.free
          ).map((f) => {
            const item = typeof f === "string" ? { text: f, included: true } : f;
            return <FeatureRow key={item.text} text={item.text} included={item.included} />;
          })}
        </View>

        {/* ─── Actions ─── */}
        <View style={[styles.actionsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={() => router.push("/support" as any)}
            activeOpacity={0.7}
          >
            <Feather name="message-circle" size={17} color={colors.foreground} />
            <Text style={[styles.actionRowText, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
              {t("profile.contact_support")}
            </Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground + "60"} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionRow, { borderBottomColor: colors.border }]}
            onPress={handleSignOut}
            activeOpacity={0.7}
          >
            <Feather name="log-out" size={17} color={colors.danger} />
            <Text style={[styles.actionRowText, { color: colors.danger, fontFamily: "DM_Sans_500Medium" }]}>
              {t("profile.sign_out")}
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
              {t("profile.delete_account")}
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
  headerNameRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  headerVerifiedBadge: { flexDirection: "row", alignItems: "center", gap: 3 },
  headerVerifiedText: { fontSize: 11, color: "rgba(250,249,246,0.5)", fontFamily: "DM_Sans_400Regular" },
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
  section: { borderRadius: 14, padding: 16, gap: 10, borderWidth: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatarWrap: { position: "relative" },
  avatar: { width: 60, height: 60, borderRadius: 30 },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { fontSize: 24, letterSpacing: -0.5 },
  cameraOverlay: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: { fontSize: 14 },
  detailsDisplay: { gap: 0 },
  detailRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  detailLabel: { fontSize: 13, width: 70, flexShrink: 0 },
  detailValue: { flex: 1, fontSize: 14 },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 12 },
  editFields: { gap: 12 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  fieldLabel: { fontSize: 13, width: 70, flexShrink: 0 },
  fieldInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  langBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  languageList: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: "hidden",
    marginTop: -4,
  },
  languageItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  languageItemText: { fontSize: 14 },
  editActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
  },
  saveBtn: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
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
  verificationBlock: { gap: 6, marginTop: 4 },
  verificationRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  verificationLabel: { fontSize: 13, flex: 1 },
  verificationNote: { fontSize: 11, lineHeight: 15, paddingLeft: 19 },
  proCard: { borderRadius: 16, padding: 18, gap: 14, borderWidth: 1.5 },
  proTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  proTitle: { fontSize: 18, letterSpacing: -0.3 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 3, marginTop: 4 },
  price: { fontSize: 28, letterSpacing: -0.5 },
  pricePer: { fontSize: 14 },
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
  actionsCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 12,
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
