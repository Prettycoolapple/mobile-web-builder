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
import { hasServiceProviderAccess, useAuth } from "@/context/AuthContext";
import { useT, isOSChineseLocale } from "@/lib/i18n";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, requestPasswordReset, resetPassword } = useAuth();
  const { t } = useT();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState<"idle" | "request" | "confirm" | "done">("idle");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError(t("login.error_required"));
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const result = await signIn(email.trim(), password);
      const role = result?.role;
      const tier = result?.subscriptionTier ?? "free";
      if (role === "sales_agent" && tier === "free") {
        router.replace("/(onboarding)/sales-agent-welcome");
      } else if (role === "service_provider" && !hasServiceProviderAccess(result)) {
        router.replace("/(onboarding)/service-provider-welcome");
      } else {
        router.replace("/(tabs)");
      }
    } catch (e: any) {
      setError(e.message || t("login.error_failed"));
    } finally {
      setIsLoading(false);
    }
  };

  const openReset = () => {
    setError(null);
    setResetError(null);
    setResetMessage(null);
    setResetMode("request");
  };

  const closeReset = () => {
    setResetMode("idle");
    setResetCode("");
    setNewPassword("");
    setResetError(null);
    setResetMessage(null);
  };

  const handleRequestReset = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setResetError(t("login.reset_error_email"));
      return;
    }
    setResetLoading(true);
    setResetError(null);
    setResetMessage(null);
    try {
      await requestPasswordReset(trimmedEmail);
      setResetMode("confirm");
      setResetMessage(t("login.reset_code_sent"));
    } catch (e: any) {
      setResetError(e.message || t("login.reset_error_send"));
    } finally {
      setResetLoading(false);
    }
  };

  const handleConfirmReset = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !resetCode.trim() || !newPassword) {
      setResetError(t("login.reset_error_required"));
      return;
    }
    if (newPassword.length < 8) {
      setResetError(t("login.reset_error_password_short"));
      return;
    }
    setResetLoading(true);
    setResetError(null);
    try {
      await resetPassword(trimmedEmail, resetCode.trim(), newPassword);
      setPassword(newPassword);
      setResetCode("");
      setNewPassword("");
      setResetMode("done");
      setResetMessage(t("login.reset_success"));
    } catch (e: any) {
      setResetError(e.message || t("login.reset_error_confirm"));
    } finally {
      setResetLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoRow}>
            <View>
              <Text style={[styles.logoTitle, { color: colors.accent, fontFamily: "SpaceGrotesk_700Bold" }]}>
                {isOSChineseLocale() ? "奥房" : "Project Alpha"}
              </Text>
              <Text style={[styles.logoTagline, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("login.tagline")}
              </Text>
            </View>
          </View>

          <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            {t("login.heading")}
          </Text>
          <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            {t("login.subheading")}
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
                {t("login.email")}
              </Text>
              <TextInput
                style={[styles.input, {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  fontFamily: "DM_Sans_400Regular",
                }]}
                placeholder={t("login.email_ph")}
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
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                  {t("login.password")}
                </Text>
                <TouchableOpacity onPress={openReset} disabled={resetLoading} activeOpacity={0.7}>
                  <Text style={[styles.forgotLink, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                    {t("login.forgot_password")}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={[styles.passwordWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder={t("login.password_ph")}
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password"
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>

            {resetMode !== "idle" && (
              <View style={[styles.resetPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.resetHeader}>
                  <View style={[styles.resetIcon, { backgroundColor: colors.accent + "18" }]}>
                    <Feather name="key" size={15} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.resetTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                      {t("login.reset_title")}
                    </Text>
                    <Text style={[styles.resetHelp, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      {resetMode === "request" ? t("login.reset_help_request") : t("login.reset_help_confirm")}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={closeReset} style={styles.resetCloseBtn} disabled={resetLoading}>
                    <Feather name="x" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>

                {resetError && (
                  <Text style={[styles.resetStatus, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{resetError}</Text>
                )}
                {resetMessage && (
                  <Text style={[styles.resetStatus, { color: colors.success, fontFamily: "DM_Sans_400Regular" }]}>{resetMessage}</Text>
                )}

                {resetMode === "request" && (
                  <TouchableOpacity
                    style={[styles.secondaryBtn, { borderColor: colors.accent, opacity: resetLoading ? 0.7 : 1 }]}
                    onPress={handleRequestReset}
                    disabled={resetLoading}
                    activeOpacity={0.8}
                  >
                    {resetLoading ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Text style={[styles.secondaryBtnText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                        {t("login.reset_send")}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}

                {resetMode === "confirm" && (
                  <View style={styles.resetFields}>
                    <TextInput
                      style={[styles.input, {
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        color: colors.foreground,
                        fontFamily: "DM_Sans_400Regular",
                      }]}
                      placeholder={t("login.reset_code_ph")}
                      placeholderTextColor={colors.mutedForeground}
                      value={resetCode}
                      onChangeText={setResetCode}
                      keyboardType="number-pad"
                      autoComplete="one-time-code"
                    />
                    <View style={[styles.passwordWrapper, { backgroundColor: colors.background, borderColor: colors.border }]}>
                      <TextInput
                        style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                        placeholder={t("login.reset_new_password_ph")}
                        placeholderTextColor={colors.mutedForeground}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        secureTextEntry={!showNewPassword}
                        autoComplete="password-new"
                        onSubmitEditing={handleConfirmReset}
                      />
                      <TouchableOpacity onPress={() => setShowNewPassword(!showNewPassword)} style={styles.eyeBtn}>
                        <Feather name={showNewPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[styles.secondaryBtnFilled, { backgroundColor: colors.accent, opacity: resetLoading ? 0.7 : 1 }]}
                      onPress={handleConfirmReset}
                      disabled={resetLoading}
                      activeOpacity={0.8}
                    >
                      {resetLoading ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={[styles.secondaryBtnFilledText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                          {t("login.reset_confirm")}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}

                {resetMode === "done" && (
                  <TouchableOpacity
                    style={[styles.secondaryBtnFilled, { backgroundColor: colors.accent }]}
                    onPress={closeReset}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.secondaryBtnFilledText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                      {t("login.reset_back_to_login")}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: isLoading ? 0.7 : 1 }]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={[styles.primaryBtnText, { fontFamily: "DM_Sans_600SemiBold" }]}>{t("login.submit")}</Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("login.no_account")}{" "}
            </Text>
            <TouchableOpacity onPress={() => router.push("/(auth)/signup")}>
              <Text style={[styles.footerLink, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
                {t("login.sign_up")}
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
  logoRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 48 },
  logoMark: {
    width: 44, height: 44, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  logoMarkText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  logoTitle: { fontSize: 20, letterSpacing: -0.5 },
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
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  label: { fontSize: 14 },
  forgotLink: { fontSize: 13 },
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
  resetPanel: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 12,
  },
  resetHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  resetIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  resetCloseBtn: { padding: 3 },
  resetTitle: { fontSize: 15, marginBottom: 3 },
  resetHelp: { fontSize: 12, lineHeight: 18 },
  resetStatus: { fontSize: 12, lineHeight: 18 },
  resetFields: { gap: 10 },
  secondaryBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 14 },
  secondaryBtnFilled: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnFilledText: { color: "#fff", fontSize: 14 },
  primaryBtn: {
    height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 32 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14 },
});
