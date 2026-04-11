import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  Alert,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useChat } from "@/context/ChatContext";

const PLAN_FEATURES = {
  free: [
    "3 feasibility reports/month",
    "AI chat follow-ups",
    "Basic property analysis",
    "Discovery search",
  ],
  pro: [
    "Unlimited feasibility reports",
    "PDF export",
    "Priority AI analysis",
    "Full comparable sales data",
    "Advanced ROI modelling",
    "Email report sharing",
  ],
};

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
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { sessions } = useChat();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const isPro = user?.subscriptionTier === "pro";
  const freeLimit = 3;
  const usage = user?.reportsUsedThisMonth ?? 0;
  const usagePct = isPro ? 100 : Math.min((usage / freeLimit) * 100, 100);

  const reportCount = sessions.filter((s) =>
    s.messages.some((m) => m.type === "report")
  ).length;

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
            <View style={[styles.freeBadge, { borderColor: isPro ? colors.accent + "80" : "rgba(250,250,249,0.2)", backgroundColor: isPro ? colors.accent + "20" : "transparent" }]}>
              <Text style={[styles.freeBadgeText, { color: isPro ? colors.accent : "rgba(250,250,249,0.6)", fontFamily: "DM_Sans_500Medium" }]}>
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
        </View>

        <SectionHeader title="Upgrade" />

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
            style={[styles.upgradeBtn, { backgroundColor: colors.accent }]}
            activeOpacity={0.8}
          >
            <Text style={[styles.upgradeBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>
              Upgrade to Pro
            </Text>
            <Feather name="arrow-right" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        <SectionHeader title="Free plan includes" />

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {PLAN_FEATURES.free.map((f) => (
            <FeatureRow key={f} text={f} included />
          ))}
        </View>

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
              {reportCount}
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
            DevFeasible NZ is an AI-powered real estate development feasibility tool designed for New Zealand property markets. Powered by Gemini AI with deep NZ-specific knowledge.
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
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  headerContent: {
    paddingTop: 10,
  },
  headerTitle: {
    fontSize: 20,
    letterSpacing: -0.3,
  },
  headerEmail: {
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    padding: 16,
    gap: 8,
  },
  sectionHeader: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1,
    paddingHorizontal: 4,
    marginTop: 12,
    marginBottom: 4,
  },
  planCard: {
    borderRadius: 16,
    padding: 20,
    gap: 18,
    marginBottom: 4,
  },
  planTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  planLabel: {
    fontSize: 12,
    marginBottom: 3,
    letterSpacing: 0.2,
  },
  planName: {
    fontSize: 26,
    letterSpacing: -0.5,
  },
  freeBadge: {
    borderWidth: 1,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  freeBadgeText: {
    fontSize: 12,
  },
  usageSection: {
    gap: 8,
  },
  usageRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  usageLabel: {
    fontSize: 13,
  },
  usageCount: {
    fontSize: 13,
  },
  usageTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 3,
  },
  limitNote: {
    fontSize: 12,
    marginTop: 2,
  },
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
  proTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  proTitle: {
    fontSize: 20,
    letterSpacing: -0.3,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 3,
    marginTop: 3,
  },
  price: {
    fontSize: 30,
    letterSpacing: -1,
  },
  pricePer: {
    fontSize: 13,
  },
  proBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  proBadgeText: {
    fontSize: 11,
    color: "#fff",
    letterSpacing: 0.5,
  },
  featuresList: {
    gap: 10,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureText: {
    fontSize: 14,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 2,
  },
  upgradeBtnText: {
    fontSize: 15,
    color: "#fff",
  },
  section: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  statsCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
    gap: 4,
  },
  statNum: {
    fontSize: 30,
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 44,
  },
  aboutText: {
    fontSize: 14,
    lineHeight: 22,
  },
  disclaimerBox: {
    padding: 12,
    marginTop: 4,
  },
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
  signOutText: {
    fontSize: 15,
  },
  disclaimerText: {
    fontSize: 12,
    lineHeight: 18,
  },
});
