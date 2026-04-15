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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { MultiSelectChips } from "@/components/MultiSelectChips";

const LANGUAGE_OPTIONS = [
  { label: "English", value: "English" },
  { label: "Chinese (Mandarin)", value: "Chinese (Mandarin)" },
  { label: "Chinese (Cantonese)", value: "Chinese (Cantonese)" },
  { label: "Korean", value: "Korean" },
  { label: "Japanese", value: "Japanese" },
  { label: "Hindi", value: "Hindi" },
  { label: "Tagalog", value: "Tagalog" },
  { label: "Samoan", value: "Samoan" },
  { label: "Māori", value: "Māori" },
  { label: "Other", value: "Other" },
];

export default function SignupGeneralScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [languages, setLanguages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignup = async () => {
    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
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
      await signUp({
        role: "general",
        firstName: firstName.trim() || undefined,
        lastName: lastName.trim() || undefined,
        email: email.trim(),
        password,
        languages,
      });
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View style={[styles.roleTag, { backgroundColor: colors.accent + "15" }]}>
            <Feather name="user" size={14} color={colors.accent} />
            <Text style={[styles.roleTagText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
              General User
            </Text>
          </View>

          <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            Create your account
          </Text>
          <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            Free — 2 feasibility reports per month
          </Text>

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  First name <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Jane"
                  placeholderTextColor={colors.mutedForeground}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  Last name
                </Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Smith"
                  placeholderTextColor={colors.mutedForeground}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Email</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
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
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Password</Text>
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
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Confirm password</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
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

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Languages spoken <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <MultiSelectChips options={LANGUAGE_OPTIONS} selected={languages} onChange={setLanguages} />
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
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              Already have an account?{" "}
            </Text>
            <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
              <Text style={[styles.footerLink, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>Sign in</Text>
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
  backBtn: { marginBottom: 20, width: 36 },
  roleTag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 16 },
  roleTagText: { fontSize: 13 },
  heading: { fontSize: 26, marginBottom: 6 },
  subheading: { fontSize: 14, marginBottom: 28, lineHeight: 20 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 20 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  form: { gap: 18 },
  row: { flexDirection: "row", gap: 12 },
  field: { gap: 7 },
  label: { fontSize: 14 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, fontSize: 15 },
  passwordWrapper: { height: 48, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, height: "100%", paddingHorizontal: 16, fontSize: 15 },
  eyeBtn: { paddingHorizontal: 14 },
  primaryBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 4 },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14 },
});
