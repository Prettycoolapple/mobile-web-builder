import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
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
        name={included ? "check-circle" : "circle"}
        size={16}
        color={included ? colors.emerald : colors.mutedForeground}
      />
      <Text style={[styles.featureText, { color: included ? colors.foreground : colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {text}
      </Text>
    </View>
  );
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { sessions } = useChat();

  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const bottomInset = Platform.OS === "web" ? 34 : insets.bottom;

  const reportCount = sessions.filter((s) =>
    s.messages.some((m) => m.type === "report")
  ).length;

  const freeLimit = 3;
  const usage = Math.min(reportCount, freeLimit);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topInset, backgroundColor: colors.navy, borderBottomColor: "rgba(255,255,255,0.1)" }]}>
        <View style={styles.headerContent}>
          <Text style={[styles.headerTitle, { fontFamily: "Inter_700Bold" }]}>Profile</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.planCard, { backgroundColor: colors.navy }]}>
          <View style={styles.planTop}>
            <View>
              <Text style={[styles.planLabel, { color: "rgba(255,255,255,0.6)", fontFamily: "Inter_400Regular" }]}>
                Current Plan
              </Text>
              <Text style={[styles.planName, { fontFamily: "Inter_700Bold" }]}>Free Tier</Text>
            </View>
            <View style={[styles.planBadge, { backgroundColor: colors.emerald + "30", borderColor: colors.emerald }]}>
              <Text style={[styles.planBadgeText, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>FREE</Text>
            </View>
          </View>

          <View style={styles.usageContainer}>
            <View style={styles.usageHeader}>
              <Text style={[styles.usageLabel, { color: "rgba(255,255,255,0.7)", fontFamily: "Inter_400Regular" }]}>
                Monthly reports
              </Text>
              <Text style={[styles.usageCount, { color: "#fff", fontFamily: "Inter_700Bold" }]}>
                {usage}/{freeLimit}
              </Text>
            </View>
            <View style={[styles.usageBar, { backgroundColor: "rgba(255,255,255,0.15)" }]}>
              <View
                style={[
                  styles.usageFill,
                  {
                    width: `${(usage / freeLimit) * 100}%`,
                    backgroundColor: usage >= freeLimit ? colors.red : colors.emerald,
                  },
                ]}
              />
            </View>
            {usage >= freeLimit && (
              <Text style={[styles.limitWarning, { color: colors.amber, fontFamily: "Inter_500Medium" }]}>
                Monthly limit reached. Upgrade to continue.
              </Text>
            )}
          </View>
        </View>

        <View style={[styles.upgradeCard, { backgroundColor: colors.card, borderColor: colors.emerald + "40", borderWidth: 1.5 }]}>
          <View style={styles.upgradeTop}>
            <View>
              <Text style={[styles.upgradeTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Pro Plan
              </Text>
              <View style={styles.priceRow}>
                <Text style={[styles.price, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>$49</Text>
                <Text style={[styles.pricePeriod, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  /month NZD
                </Text>
              </View>
            </View>
            <View style={[styles.proBadge, { backgroundColor: colors.emerald }]}>
              <Text style={[styles.proBadgeText, { fontFamily: "Inter_700Bold" }]}>PRO</Text>
            </View>
          </View>

          <View style={styles.featuresContainer}>
            {PLAN_FEATURES.pro.map((f) => (
              <FeatureRow key={f} text={f} included />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.upgradeBtn, { backgroundColor: colors.emerald }]}
            activeOpacity={0.85}
          >
            <Text style={[styles.upgradeBtnText, { fontFamily: "Inter_700Bold" }]}>
              Upgrade to Pro
            </Text>
            <Feather name="arrow-right" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            Free Plan Includes
          </Text>
          {PLAN_FEATURES.free.map((f) => (
            <FeatureRow key={f} text={f} included />
          ))}
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            Your Stats
          </Text>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>
                {sessions.length}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Sessions
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>
                {reportCount}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Reports
              </Text>
            </View>
            <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statNumber, { color: colors.emerald, fontFamily: "Inter_700Bold" }]}>
                {sessions.reduce((acc, s) => acc + s.messages.length, 0)}
              </Text>
              <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                Messages
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            About
          </Text>
          <Text style={[styles.aboutText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            DevFeasible NZ is an AI-powered real estate development feasibility tool designed specifically for New Zealand property markets. All analysis is powered by Claude AI with NZ-specific knowledge.
          </Text>
          <Text style={[styles.aboutText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            All cost estimates are indicative only. Always engage qualified professionals for development decisions.
          </Text>
        </View>
      </ScrollView>
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
    paddingTop: 8,
  },
  headerTitle: {
    fontSize: 22,
    color: "#fff",
    letterSpacing: -0.5,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  planCard: {
    borderRadius: 16,
    padding: 18,
    gap: 16,
  },
  planTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  planLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  planName: {
    fontSize: 22,
    color: "#fff",
    letterSpacing: -0.5,
  },
  planBadge: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  planBadgeText: {
    fontSize: 11,
    letterSpacing: 1,
  },
  usageContainer: {
    gap: 8,
  },
  usageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  usageLabel: {
    fontSize: 13,
  },
  usageCount: {
    fontSize: 13,
  },
  usageBar: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: 3,
  },
  limitWarning: {
    fontSize: 12,
  },
  upgradeCard: {
    borderRadius: 16,
    padding: 18,
    gap: 16,
  },
  upgradeTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  upgradeTitle: {
    fontSize: 20,
    letterSpacing: -0.3,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
    marginTop: 2,
  },
  price: {
    fontSize: 28,
    letterSpacing: -1,
  },
  pricePeriod: {
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
    letterSpacing: 1,
  },
  featuresContainer: {
    gap: 8,
  },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  featureText: {
    fontSize: 13,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
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
  sectionTitle: {
    fontSize: 15,
    marginBottom: 2,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  statItem: {
    alignItems: "center",
    flex: 1,
  },
  statNumber: {
    fontSize: 28,
    letterSpacing: -1,
  },
  statLabel: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 40,
  },
  aboutText: {
    fontSize: 13,
    lineHeight: 20,
  },
});
