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
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useSubscription } from "@/lib/revenuecat";
import { avatarImageSource } from "@/lib/avatar";

const FREE_LIMIT = 2;
const STANDARD_LIMIT = 20;

const NZ_LANGUAGES = [
  "English",
  "Te Reo Māori",
  "Mandarin",
  "Hindi",
  "Samoan",
  "Cantonese",
  "Korean",
  "Japanese",
  "Filipino",
  "Tongan",
];

const PLAN_FEATURES = {
  free: [
    "Feasibility reports",
    "Chat & property search",
  ],
  standard: [
    "Feasibility reports",
    "Chat & property search",
    "In-app chat with planners & architects",
  ],
  agent: [
    "Unlimited property listings",
    "Featured in property search",
    "Client feasibility tools",
    "Analytics & performance insights",
    "Priority support",
  ],
  provider: [
    "Get referred in chats & search",
    "Encrypted chats with clients & investors",
    "Feasibility reports",
    "Chat & property search",
  ],
};

const STANDARD_UPGRADE_FEATURES = [
  "More feasibility reports",
  "More chat & property search",
  "In-app chat with planners & architects",
];

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

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, signOut, getApiHeaders, refreshProfile, isSubscriptionIdentityReady } = useAuth();
  const router = useRouter();

  const { purchase, isSubscribed, customerInfoLoaded, isTestPaymentMode, refetchCustomerInfo, getPackageForRole, getPriceForRole } = useSubscription();
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  // Refresh RevenueCat status each time the profile screen mounts so the correct
  // per-user identity is reflected. Skipped in test payment mode where there is
  // no real native RC connection available.
  useEffect(() => {
    if (isTestPaymentMode) return;
    if (!isSubscriptionIdentityReady) return;
    refetchCustomerInfo();
  }, [isTestPaymentMode, isSubscriptionIdentityReady]);

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
  const [editLanguage, setEditLanguage] = useState(user?.languages?.[0] ?? "English");
  const [showLanguagePicker, setShowLanguagePicker] = useState(false);

  useEffect(() => {
    if (!isEditing) {
      const { first, last } = splitName(user?.fullName);
      setEditFirst(first);
      setEditLast(last);
      setEditLanguage(user?.languages?.[0] ?? "English");
    }
  }, [user, isEditing]);

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const isStandard = user?.subscriptionTier === "pro" || user?.subscriptionTier === "standard";
  const planLimit = isStandard ? STANDARD_LIMIT : FREE_LIMIT;
  const usage = user?.reportsUsedThisMonth ?? 0;
  const remaining = planLimit - usage;
  const usagePct = Math.min((usage / planLimit) * 100, 100);
  const showWarning = remaining <= 3 && remaining >= 0;

  const role = user?.role ?? "general";
  const primaryLanguage = user?.languages?.[0] ?? null;

  // Returns true on a confirmed 2xx response so callers can surface failures.
  const syncToBackend = useCallback(async (tier: "pro" | "free"): Promise<boolean> => {
    try {
      const resp = await fetch(`${getApiBase()}/subscription/sync`, {
        method: "POST",
        headers: getApiHeaders(),
        body: JSON.stringify({ tier }),
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
    if (isSubscribed) {
      syncToBackend("pro");
    } else if (customerInfoLoaded) {
      // RC has definitively confirmed no active subscription for THIS user —
      // correct the DB tier if needed.
      syncToBackend("free");
    }
  }, [isSubscribed, customerInfoLoaded, isTestPaymentMode, isSubscriptionIdentityReady, user?.id]);

  const handleUpgrade = useCallback(async () => {
    setUpgradeLoading(true);
    try {
      const pkg = getPackageForRole(role);
      if (!pkg) {
        Alert.alert("Unavailable", "Subscription packages are not available right now. Please try again later.");
        return;
      }
      await purchase(pkg);
      const synced = await syncToBackend("pro");
      if (!synced) {
        Alert.alert(
          "Almost there",
          "Your payment went through but we couldn't update your account. Please pull to refresh in a moment, or contact support if it persists.",
        );
        return;
      }
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
        Alert.alert("Error", "Could not save your profile. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not save your profile. Check your connection.");
    } finally {
      setIsSaving(false);
    }
  }, [editFirst, editLast, editLanguage, getApiHeaders, refreshProfile]);

  const handlePickAvatar = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please allow photo library access to update your profile picture.");
      return;
    }
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
      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        type: asset.mimeType ?? "image/jpeg",
        name: "avatar.jpg",
      } as any);

      const resp = await fetch(`${getApiBase()}/upload/profile-picture`, {
        method: "POST",
        headers: { ...(getApiHeaders() as Record<string, string>) },
        body: formData,
      });
      if (resp.ok) {
        await refreshProfile().catch(() => {});
      } else {
        Alert.alert("Error", "Could not upload photo. Please try again.");
      }
    } catch {
      Alert.alert("Error", "Could not upload photo. Check your connection.");
    } finally {
      setAvatarUploading(false);
    }
  }, [getApiHeaders, refreshProfile]);

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
                      const resp = await fetch(`${getApiBase()}/auth/account`, {
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

  const avatarSource = avatarImageSource(user?.avatarUrl, getApiHeaders());
  const displayInitial = (user?.fullName ?? user?.email ?? "?").slice(0, 1).toUpperCase();

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
                  {user?.fullName ?? "Account"}
                </Text>
                {user?.isVerified && user.role === "service_provider" && (
                  <View style={styles.headerVerifiedBadge}>
                    <Feather name="shield" size={11} color="#52C99A" />
                    <Text style={styles.headerVerifiedText}>verified</Text>
                  </View>
                )}
              </View>
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
        {/* ─── User Details ─── */}
        <SectionHeader title="Your details" />

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
              {avatarUploading ? "Uploading…" : "Change photo"}
            </Text>
          </TouchableOpacity>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          {/* Name & language display / edit */}
          {isEditing ? (
            <View style={styles.editFields}>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>First name</Text>
                <TextInput
                  value={editFirst}
                  onChangeText={setEditFirst}
                  style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.accent, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="First name"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Last name</Text>
                <TextInput
                  value={editLast}
                  onChangeText={setEditLast}
                  style={[styles.fieldInput, { color: colors.foreground, borderColor: colors.accent, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Last name"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
              </View>
              <View style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Language</Text>
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
                  {NZ_LANGUAGES.map((lang) => (
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
                  <Text style={[{ color: colors.mutedForeground, fontFamily: "DM_Sans_500Medium", fontSize: 14 }]}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: isSaving ? colors.accent + "80" : colors.accent }]}
                  onPress={handleSaveProfile}
                  disabled={isSaving}
                  activeOpacity={0.8}
                >
                  {isSaving
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={[{ color: "#fff", fontFamily: "DM_Sans_600SemiBold", fontSize: 14 }]}>Save</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.detailsDisplay}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Name</Text>
                <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  {user?.fullName ?? "—"}
                </Text>
              </View>
              <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Language</Text>
                <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  {primaryLanguage ?? "—"}
                </Text>
              </View>
              {role === "service_provider" && user?.discipline && (
                <View style={[styles.detailRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
                  <Text style={[styles.detailLabel, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Discipline</Text>
                  <Text style={[styles.detailValue, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                    {user.discipline === "architect_designer" ? "Architect / Designer"
                      : user.discipline === "planner" ? "Planner"
                      : user.discipline === "engineer" ? "Engineer"
                      : user.discipline === "quantity_surveyor" ? "Quantity Surveyor"
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
                <Text style={[{ color: colors.accent, fontFamily: "DM_Sans_500Medium", fontSize: 14 }]}>Edit details</Text>
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

        {/* ─── Plan card — sales agent ─── */}
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

        {/* ─── Plan card — service provider ─── */}
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
            <View style={styles.verificationBlock}>
              <View style={styles.verificationRow}>
                {user?.isVerified ? (
                  <>
                    <Feather name="shield" size={13} color="#52C99A" />
                    <Text style={[styles.verificationLabel, { color: "#52C99A", fontFamily: "DM_Sans_500Medium" }]}>
                      Account verified
                    </Text>
                  </>
                ) : (
                  <>
                    <Feather name="clock" size={13} color="rgba(250,249,246,0.4)" />
                    <Text style={[styles.verificationLabel, { color: "rgba(250,249,246,0.5)", fontFamily: "DM_Sans_400Regular" }]}>
                      Verification pending — we'll review your credentials shortly
                    </Text>
                  </>
                )}
              </View>
              {!user?.isVerified && (
                <Text style={[styles.verificationNote, { color: "rgba(250,249,246,0.35)", fontFamily: "DM_Sans_400Regular" }]}>
                  You have full access to Provider Pro features. Your verified badge will display automatically once your account is reviewed.
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

        {/* ─── Upgrade card — general user ─── */}
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
                {STANDARD_UPGRADE_FEATURES.map((f) => (
                  <FeatureRow key={f} text={f} included />
                ))}
              </View>
              <TouchableOpacity
                style={[styles.upgradeBtn, { backgroundColor: upgradeLoading ? colors.accent + "80" : colors.accent }]}
                activeOpacity={0.8}
                onPress={handleUpgrade}
                disabled={upgradeLoading}
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

        {/* ─── Upgrade card — sales agent ─── */}
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
                disabled={upgradeLoading}
              >
                {upgradeLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Activate Agent Pro</Text>
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
                disabled={upgradeLoading}
              >
                {upgradeLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Activate Provider Pro</Text>
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

        {/* ─── Actions ─── */}
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
