import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";

function GlassesLogo({ size = 40, color = "#D97757" }: { size?: number; color?: string }) {
  const w = size * 1.5;
  const h = size * 0.65;
  const r = size * 0.28;
  const cx1 = size * 0.32;
  const cx2 = size * 1.18;
  const cy = h * 0.55;
  const strokeW = size * 0.065;
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <Circle cx={cx1} cy={cy} r={r} stroke={color} strokeWidth={strokeW} fill="none" />
      <Circle cx={cx2} cy={cy} r={r} stroke={color} strokeWidth={strokeW} fill="none" />
      <Line x1={cx1 + r} y1={cy} x2={cx2 - r} y2={cy} stroke={color} strokeWidth={strokeW * 0.8} strokeLinecap="round" />
      <Line x1={cx1 - r} y1={cy - r * 0.3} x2={cx1 - r - size * 0.2} y2={cy - r * 0.65} stroke={color} strokeWidth={strokeW * 0.8} strokeLinecap="round" />
      <Line x1={cx2 + r} y1={cy - r * 0.3} x2={cx2 + r + size * 0.2} y2={cy - r * 0.65} stroke={color} strokeWidth={strokeW * 0.8} strokeLinecap="round" />
    </Svg>
  );
}

export default function SignupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async () => {
    if (!email.trim() || !password) {
      setError("Please fill in all required fields.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      await signUp(email.trim(), password, fullName.trim() || undefined);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View style={styles.logoRow}>
            <GlassesLogo size={32} color={colors.accent} />
            <View>
              <Text style={[styles.logoTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
                Lecorb
              </Text>
              <Text style={[styles.logoTagline, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                Property development intelligence
              </Text>
            </View>
          </View>

          <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            Create an account
          </Text>
          <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Get 2 free feasibility reports per month
          </Text>

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Full name <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "DM_Sans_400Regular",
                }]}
                placeholder="Jane Smith"
                placeholderTextColor={colors.mutedForeground}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
                autoComplete="name"
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Email
              </Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "DM_Sans_400Regular",
                }]}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Password
              </Text>
              <View style={[styles.passwordWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                  returnKeyType="next"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Confirm password
              </Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "DM_Sans_400Regular",
                }]}
                placeholder="Re-enter your password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
                returnKeyType="done"
                onSubmitEditing={handleSignup}
              />
            </View>

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: isLoading ? 0.7 : 1 }]}
              onPress={handleSignup}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.primaryBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>Create account</Text>
              )}
            </TouchableOpacity>

            <View style={[styles.termsNote, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <Feather name="shield" size={14} color={colors.mutedForeground} />
              <Text style={[styles.termsText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                Free tier includes 3 feasibility reports per month. No credit card required.
              </Text>
            </View>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Already have an account?{" "}
            </Text>
            <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
              <Text style={[styles.footerLink, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                Sign in
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 24, width: 36 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 36 },
  logoMark: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  logoMarkText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  logoTitle: { fontSize: 18 },
  logoTagline: { fontSize: 13, marginTop: 1 },
  heading: { fontSize: 28, marginBottom: 8 },
  subheading: { fontSize: 15, marginBottom: 32, lineHeight: 22 },
  errorBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 20,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  form: { gap: 20 },
  field: { gap: 8 },
  label: { fontSize: 14 },
  input: {
    height: 48, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 16, fontSize: 15,
  },
  passwordWrapper: {
    height: 48, borderRadius: 12, borderWidth: 1,
    flexDirection: "row", alignItems: "center",
  },
  passwordInput: { flex: 1, height: "100%", paddingHorizontal: 16, fontSize: 15 },
  eyeBtn: { paddingHorizontal: 14 },
  primaryBtn: {
    height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  termsNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  termsText: { flex: 1, fontSize: 13, lineHeight: 18 },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 32 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14 },
});
