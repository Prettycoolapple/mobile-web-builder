import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

const FEATURES = [
  { icon: "target" as const, title: "Qualified Developer Leads", desc: "Connect with active property developers seeking your services" },
  { icon: "trending-up" as const, title: "Project Pipeline Insights", desc: "Identify upcoming developments in your area before they go to market" },
  { icon: "award" as const, title: "Business Profile Listing", desc: "Showcase your company on the Lecorb platform to thousands of users" },
  { icon: "phone" as const, title: "Direct Introductions", desc: "Receive warm introductions to developers matched to your discipline" },
];

export default function WelcomeProviderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  const firstName = user?.fullName?.split(" ")[0] || "there";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.iconCircle, { backgroundColor: colors.accent + "15" }]}>
          <Feather name="tool" size={36} color={colors.accent} />
        </View>

        <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
          Welcome, {firstName}!
        </Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          Your Service Provider account is ready. You have 14 days free, then $149/month.
        </Text>

        <View style={[styles.trialBanner, { backgroundColor: colors.accent + "12", borderColor: colors.accent + "30" }]}>
          <Feather name="gift" size={18} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.trialTitle, { color: colors.accent, fontFamily: "DM_Sans_700Bold" }]}>
              14-day free trial active
            </Text>
            <Text style={[styles.trialDesc, { color: colors.accent + "BB", fontFamily: "DM_Sans_400Regular" }]}>
              No credit card required to start. Cancel anytime.
            </Text>
          </View>
        </View>

        <View style={styles.features}>
          {FEATURES.map((f) => (
            <View key={f.title} style={[styles.featureRow, { borderBottomColor: colors.border }]}>
              <View style={[styles.featureIcon, { backgroundColor: colors.muted }]}>
                <Feather name={f.icon} size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.featureTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>{f.title}</Text>
                <Text style={[styles.featureDesc, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.verificationNote, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="info" size={15} color={colors.mutedForeground} />
          <Text style={[styles.verificationText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Your account is under review. We'll verify your Certificate of Incorporation within 1–2 business days.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
          onPress={() => router.replace("/(tabs)")}
          activeOpacity={0.8}
        >
          <Text style={[styles.primaryBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Start exploring</Text>
          <Feather name="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24, alignItems: "center" },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 24 },
  heading: { fontSize: 28, textAlign: "center", marginBottom: 12 },
  subheading: { fontSize: 15, textAlign: "center", lineHeight: 22, marginBottom: 28 },
  trialBanner: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, width: "100%", marginBottom: 28 },
  trialTitle: { fontSize: 15, marginBottom: 2 },
  trialDesc: { fontSize: 13, lineHeight: 18 },
  features: { width: "100%", marginBottom: 24 },
  featureRow: { flexDirection: "row", alignItems: "flex-start", gap: 14, paddingVertical: 16, borderBottomWidth: 1 },
  featureIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  featureTitle: { fontSize: 15, marginBottom: 2 },
  featureDesc: { fontSize: 13, lineHeight: 18 },
  verificationNote: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, width: "100%", marginBottom: 24 },
  verificationText: { flex: 1, fontSize: 13, lineHeight: 18 },
  primaryBtn: { flexDirection: "row", alignItems: "center", gap: 8, height: 52, paddingHorizontal: 32, borderRadius: 14, justifyContent: "center", width: "100%" },
  primaryBtnText: { color: "#fff", fontSize: 16 },
});
