import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { avatarImageSource } from "@/lib/avatar";

function getApiBase(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "/api";
}

type UserRole = "general" | "sales_agent" | "service_provider";

interface PublicProfile {
  id: string;
  fullName: string | null;
  role: UserRole;
  avatarUrl: string | null;
  isVerified: boolean;
  createdAt: string;
  recommendationCount: number;
  hasRecommended: boolean;
  roleData: Record<string, unknown> | null;
}

function roleColor(role: UserRole, colors: ReturnType<typeof useColors>): string {
  if (role === "sales_agent") return colors.accent;
  if (role === "service_provider") return "#5B8EAD";
  return colors.mutedForeground;
}

function disciplineLabel(value: string | null | undefined): string {
  const map: Record<string, string> = {
    architect_designer: "Architect / Designer",
    planner: "Planner",
    engineer: "Engineer",
    quantity_surveyor: "Quantity Surveyor",
    other: "Other",
  };
  return value ? (map[value] ?? value) : "Service Provider";
}

function profileSubtitle(profile: PublicProfile): string {
  if (profile.role === "sales_agent") return "Sales Agent";
  if (profile.role === "service_provider") {
    const rd = profile.roleData;
    if (!rd) return "Service Provider";
    if (rd.discipline === "other" && rd.otherDiscipline) return rd.otherDiscipline as string;
    return disciplineLabel(rd.discipline as string | null);
  }
  return "Member";
}

function Avatar({
  name,
  role,
  avatarUrl,
  size = 72,
  colors,
}: {
  name: string | null;
  role: UserRole;
  avatarUrl?: string | null;
  size?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const { getApiHeaders } = useAuth();
  const initials = (name ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const color = roleColor(role, colors);
  const source = avatarImageSource(avatarUrl, getApiHeaders());

  if (source) {
    return (
      <Image
        source={source}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: color + "55",
        }}
      />
    );
  }

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + "22",
        borderWidth: 2,
        borderColor: color + "55",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: size * 0.36, color, fontFamily: "DM_Sans_700Bold" }}>
        {initials}
      </Text>
    </View>
  );
}

function InfoRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string | null | undefined;
  colors: ReturnType<typeof useColors>;
}) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Feather name={icon} size={15} color={colors.mutedForeground} style={styles.infoIcon} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    </View>
  );
}

export default function UserProfileScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colors = useColors();
  const { token, user } = useAuth();

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!token || !userId) return;
    try {
      const resp = await fetch(`${getApiBase()}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Profile not found");
      const data = (await resp.json()) as PublicProfile;
      setProfile(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [token, userId]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleRecommend = async () => {
    if (!profile || !token || recommending) return;
    setRecommending(true);
    try {
      const resp = await fetch(`${getApiBase()}/users/${userId}/recommend`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Failed");
      const data = (await resp.json()) as { hasRecommended: boolean; recommendationCount: number };
      setProfile((prev) =>
        prev
          ? { ...prev, hasRecommended: data.hasRecommended, recommendationCount: data.recommendationCount }
          : prev,
      );
    } catch {
    } finally {
      setRecommending(false);
    }
  };

  const isSelf = user?.id === userId;
  const accentColor = profile ? roleColor(profile.role, colors) : colors.accent;
  const memberYear = profile ? new Date(profile.createdAt).getFullYear() : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
            paddingTop: insets.top + 4,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Profile</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error || !profile ? (
        <View style={styles.center}>
          <Feather name="user-x" size={40} color={colors.mutedForeground} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            {error ?? "Profile not found"}
          </Text>
          <TouchableOpacity
            onPress={() => { setLoading(true); setError(null); fetchProfile(); }}
            style={[styles.retryBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.retryText, { color: colors.foreground }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Avatar
              name={profile.fullName}
              role={profile.role}
              avatarUrl={profile.avatarUrl}
              size={72}
              colors={colors}
            />

            <View style={{ marginTop: 14, alignItems: "center", gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[styles.name, { color: colors.foreground }]}>
                  {profile.fullName ?? "Anonymous"}
                </Text>
                {profile.isVerified && profile.role === "service_provider" && (
                  <Feather name="check-circle" size={20} color={accentColor} />
                )}
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={[
                    styles.roleBadge,
                    { backgroundColor: accentColor + "18", borderColor: accentColor + "44" },
                  ]}
                >
                  <Text style={[styles.roleBadgeText, { color: accentColor }]}>
                    {profileSubtitle(profile)}
                  </Text>
                </View>
                {profile.isVerified && profile.role === "service_provider" && (
                  <View style={[styles.verifiedBadge, { backgroundColor: accentColor + "15", borderColor: accentColor + "40" }]}>
                    <Feather name="shield" size={11} color={accentColor} />
                    <Text style={[styles.verifiedText, { color: accentColor }]}>Verified</Text>
                  </View>
                )}
              </View>
            </View>

            {!isSelf && (
              <TouchableOpacity
                style={[
                  styles.thumbBtn,
                  {
                    backgroundColor: profile.hasRecommended ? "transparent" : colors.accent,
                    borderColor: colors.accent,
                    borderWidth: profile.hasRecommended ? 1.5 : 0,
                  },
                ]}
                onPress={handleRecommend}
                disabled={recommending}
                activeOpacity={0.8}
              >
                {recommending ? (
                  <ActivityIndicator
                    size="small"
                    color={profile.hasRecommended ? colors.accent : "#fff"}
                  />
                ) : (
                  <Feather
                    name="thumbs-up"
                    size={17}
                    color={profile.hasRecommended ? colors.accent : "#fff"}
                  />
                )}
                <Text
                  style={[
                    styles.thumbCount,
                    { color: profile.hasRecommended ? colors.accent : "#fff" },
                  ]}
                >
                  {profile.recommendationCount}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {!isSelf && (
            <TouchableOpacity
              style={[styles.messageBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() =>
                router.push({
                  pathname: "/chat/contacts",
                  params: { preselect: profile.id },
                })
              }
              activeOpacity={0.8}
            >
              <Feather name="message-circle" size={16} color={colors.foreground} />
              <Text style={[styles.messageBtnText, { color: colors.foreground }]}>Message</Text>
            </TouchableOpacity>
          )}

          {profile.role === "sales_agent" && profile.roleData && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Agent Details</Text>
              <InfoRow icon="briefcase" label="Agency" value={profile.roleData.agencyName as string} colors={colors} />
              <InfoRow icon="award" label="REAA Licence" value={profile.roleData.reaaLicenceNumber as string} colors={colors} />
              <InfoRow
                icon="clock"
                label="Experience"
                value={profile.roleData.yearsExperience ? `${profile.roleData.yearsExperience} years` : null}
                colors={colors}
              />
              <InfoRow
                icon="map-pin"
                label="Regions"
                value={(profile.roleData.regionsCovered as string[] | null)?.join(", ")}
                colors={colors}
              />
              <InfoRow
                icon="home"
                label="Property types"
                value={(profile.roleData.propertyTypes as string[] | null)?.join(", ")}
                colors={colors}
              />
              <InfoRow
                icon="map-pin"
                label="Address"
                value={
                  [profile.roleData.addressSuburb, profile.roleData.addressCity]
                    .filter(Boolean)
                    .join(", ") || null
                }
                colors={colors}
              />
              <InfoRow icon="globe" label="Website" value={profile.roleData.websiteUrl as string} colors={colors} />
              <InfoRow icon="message-circle" label="Primary language" value={profile.roleData.primaryLanguage as string} colors={colors} />
              <InfoRow icon="message-circle" label="Secondary language" value={profile.roleData.secondaryLanguage as string} colors={colors} />
              {memberYear && (
                <InfoRow icon="calendar" label="Member since" value={`${memberYear}`} colors={colors} />
              )}
              {profile.roleData.bio ? (
                <View style={styles.bioRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>About</Text>
                  <Text style={[styles.bioText, { color: colors.foreground }]}>
                    {profile.roleData.bio as string}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {profile.role === "service_provider" && profile.roleData && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Provider Details</Text>
              <InfoRow icon="briefcase" label="Company" value={profile.roleData.companyName as string} colors={colors} />
              <InfoRow
                icon="tool"
                label="Discipline"
                value={
                  profile.roleData.discipline === "other" && profile.roleData.otherDiscipline
                    ? (profile.roleData.otherDiscipline as string)
                    : disciplineLabel(profile.roleData.discipline as string)
                }
                colors={colors}
              />
              <InfoRow
                icon="map-pin"
                label="Address"
                value={
                  [profile.roleData.addressStreet, profile.roleData.addressSuburb, profile.roleData.addressCity]
                    .filter(Boolean)
                    .join(", ") || null
                }
                colors={colors}
              />
              <InfoRow icon="hash" label="NZ Business Number" value={profile.roleData.nzCompanyRegisterNumber as string} colors={colors} />
              <InfoRow icon="phone" label="Contact" value={profile.roleData.contactNumber as string} colors={colors} />
              <InfoRow icon="message-circle" label="Primary language" value={profile.roleData.primaryLanguage as string} colors={colors} />
              <InfoRow icon="message-circle" label="Secondary language" value={profile.roleData.secondaryLanguage as string} colors={colors} />
              {memberYear && (
                <InfoRow icon="calendar" label="Member since" value={`${memberYear}`} colors={colors} />
              )}
              {profile.roleData.bio ? (
                <View style={styles.bioRow}>
                  <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>About</Text>
                  <Text style={[styles.bioText, { color: colors.foreground }]}>
                    {profile.roleData.bio as string}
                  </Text>
                </View>
              ) : null}
            </View>
          )}

          {profile.role === "general" && memberYear && (
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Member Details</Text>
              <InfoRow icon="calendar" label="Member since" value={`${memberYear}`} colors={colors} />
            </View>
          )}

          {profile.recommendationCount > 0 && (
            <View
              style={[
                styles.trustBanner,
                { backgroundColor: accentColor + "12", borderColor: accentColor + "30" },
              ]}
            >
              <Feather name="shield" size={16} color={accentColor} />
              <Text style={[styles.trustText, { color: colors.foreground }]}>
                Trusted by{" "}
                <Text style={{ fontFamily: "DM_Sans_700Bold", color: accentColor }}>
                  {profile.recommendationCount}
                </Text>{" "}
                {profile.recommendationCount === 1 ? "person" : "people"} in the Groundup community
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 38, height: 38, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "DM_Sans_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 15, fontFamily: "DM_Sans_400Regular", textAlign: "center" },
  retryBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  retryText: { fontSize: 14, fontFamily: "DM_Sans_500Medium" },
  content: { padding: 16, gap: 12 },
  heroCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 0,
  },
  name: { fontSize: 22, fontFamily: "DM_Sans_700Bold" },
  roleBadge: {
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  roleBadgeText: { fontSize: 12, fontFamily: "DM_Sans_600SemiBold" },
  thumbBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 24,
    minWidth: 80,
  },
  thumbCount: {
    fontSize: 15,
    fontFamily: "DM_Sans_700Bold",
  },
  messageBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  messageBtnText: { fontSize: 14, fontFamily: "DM_Sans_500Medium" },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 18,
    gap: 4,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "DM_Sans_600SemiBold",
    letterSpacing: 0.3,
    marginBottom: 10,
    textTransform: "uppercase",
    opacity: 0.6,
  },
  infoRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 8, gap: 12 },
  infoIcon: { marginTop: 2 },
  infoLabel: { fontSize: 11, fontFamily: "DM_Sans_400Regular", marginBottom: 1 },
  infoValue: { fontSize: 14, fontFamily: "DM_Sans_500Medium", lineHeight: 20 },
  bioRow: { paddingVertical: 8, gap: 4 },
  bioText: { fontSize: 14, fontFamily: "DM_Sans_400Regular", lineHeight: 21 },
  trustBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  trustText: { flex: 1, fontSize: 13, fontFamily: "DM_Sans_400Regular", lineHeight: 19 },
  verifiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
  verifiedText: { fontSize: 11, fontFamily: "DM_Sans_600SemiBold" },
});
