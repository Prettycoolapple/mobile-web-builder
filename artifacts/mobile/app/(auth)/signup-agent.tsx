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
import { useAuth, ApiError } from "@/context/AuthContext";
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

const REGION_OPTIONS = [
  { label: "Auckland", value: "Auckland" },
  { label: "Wellington", value: "Wellington" },
  { label: "Canterbury / Christchurch", value: "Canterbury/Christchurch" },
  { label: "Waikato / Hamilton", value: "Waikato/Hamilton" },
  { label: "Bay of Plenty", value: "Bay of Plenty" },
  { label: "Otago / Dunedin", value: "Otago/Dunedin" },
  { label: "Manawatū / Palmerston North", value: "Manawatu/Palmerston North" },
  { label: "Hawke's Bay", value: "Hawke's Bay" },
  { label: "Northland", value: "Northland" },
  { label: "Tasman / Nelson", value: "Tasman/Nelson" },
  { label: "Other", value: "Other" },
];

const PROPERTY_TYPE_OPTIONS = [
  { label: "Residential", value: "Residential" },
  { label: "Commercial", value: "Commercial" },
  { label: "Industrial", value: "Industrial" },
  { label: "Rural", value: "Rural" },
];

const YEARS_OPTIONS = [
  { label: "< 1 year", value: 0 },
  { label: "1–3 years", value: 1 },
  { label: "3–5 years", value: 3 },
  { label: "5–10 years", value: 5 },
  { label: "10+ years", value: 10 },
];

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  agencyDetails?: string;
}

export default function SignupAgentScreen() {
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
  const [agencyName, setAgencyName] = useState("");
  const [reaaNumber, setReaaNumber] = useState("");
  const [yearsExp, setYearsExp] = useState<number | null>(null);
  const [regions, setRegions] = useState<string[]>([]);
  const [propertyTypes, setPropertyTypes] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!firstName.trim()) errors.firstName = "First name is required.";
    if (!lastName.trim()) errors.lastName = "Last name is required.";
    if (!email.trim()) {
      errors.email = "Email is required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    if (!password) {
      errors.password = "Password is required.";
    } else if (password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }
    if (!confirmPassword) {
      errors.confirmPassword = "Please confirm your password.";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }
    if (!agencyName.trim() && !reaaNumber.trim()) {
      errors.agencyDetails = "Please provide at least your agency / company name or REAA licence number.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSignup = async () => {
    setSubmitError(null);
    if (!validate()) return;
    setIsLoading(true);
    try {
      await signUp({
        role: "sales_agent",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        languages,
        agentData: {
          agencyName: agencyName.trim() || undefined,
          reaaLicenceNumber: reaaNumber.trim() || undefined,
          yearsExperience: yearsExp ?? undefined,
          regionsCovered: regions,
          propertyTypes,
        },
      });
      router.replace("/(auth)/welcome-agent");
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        const mapped: FieldErrors = {};
        for (const issue of err.details) {
          const key = issue.path[0];
          const nested = issue.path[1];
          if (key === "firstName") mapped.firstName = issue.message;
          else if (key === "lastName") mapped.lastName = issue.message;
          else if (key === "email") mapped.email = issue.message;
          else if (key === "password") mapped.password = issue.message;
          else if (key === "agentData" && (nested === "agencyName" || nested === "reaaLicenceNumber")) {
            mapped.agencyDetails = issue.message;
          }
        }
        if (Object.keys(mapped).length > 0) {
          setFieldErrors(mapped);
          return;
        }
      }
      setSubmitError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputStyle = (field: keyof FieldErrors) => [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: fieldErrors[field] ? colors.danger : colors.border,
      color: colors.foreground,
      fontFamily: "DM_Sans_400Regular",
    },
  ];

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
            <Feather name="briefcase" size={14} color={colors.accent} />
            <Text style={[styles.roleTagText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
              Sales Agent
            </Text>
          </View>

          <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            Agent registration
          </Text>
          <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            $99/month · 14-day free trial
          </Text>

          {submitError && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{submitError}</Text>
            </View>
          )}

          <SectionHeader label="Personal details" colors={colors} />
          <View style={styles.form}>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>First name *</Text>
                <TextInput
                  style={inputStyle("firstName")}
                  placeholder="Jane"
                  placeholderTextColor={colors.mutedForeground}
                  value={firstName}
                  onChangeText={(v) => { setFirstName(v); if (fieldErrors.firstName) setFieldErrors((p) => ({ ...p, firstName: undefined })); }}
                  autoCapitalize="words"
                />
                {fieldErrors.firstName && (
                  <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{fieldErrors.firstName}</Text>
                )}
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Last name *</Text>
                <TextInput
                  style={inputStyle("lastName")}
                  placeholder="Smith"
                  placeholderTextColor={colors.mutedForeground}
                  value={lastName}
                  onChangeText={(v) => { setLastName(v); if (fieldErrors.lastName) setFieldErrors((p) => ({ ...p, lastName: undefined })); }}
                  autoCapitalize="words"
                />
                {fieldErrors.lastName && (
                  <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{fieldErrors.lastName}</Text>
                )}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Email *</Text>
              <TextInput
                style={inputStyle("email")}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(v) => { setEmail(v); if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined })); }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              {fieldErrors.email && (
                <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{fieldErrors.email}</Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Password *</Text>
              <View style={[
                styles.passwordWrapper,
                { backgroundColor: colors.card, borderColor: fieldErrors.password ? colors.danger : colors.border },
              ]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={(v) => { setPassword(v); if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined })); }}
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              {fieldErrors.password && (
                <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{fieldErrors.password}</Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Confirm password *</Text>
              <TextInput
                style={inputStyle("confirmPassword")}
                placeholder="Re-enter your password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); if (fieldErrors.confirmPassword) setFieldErrors((p) => ({ ...p, confirmPassword: undefined })); }}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
              />
              {fieldErrors.confirmPassword && (
                <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{fieldErrors.confirmPassword}</Text>
              )}
            </View>
          </View>

          <SectionHeader label="Agency details" colors={colors} />
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Agency / company name <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="Harcourts, Ray White, etc."
                placeholderTextColor={colors.mutedForeground}
                value={agencyName}
                onChangeText={(v) => {
                  setAgencyName(v);
                  if (fieldErrors.agencyDetails) setFieldErrors((p) => ({ ...p, agencyDetails: undefined }));
                }}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                REAA licence number <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: fieldErrors.agencyDetails ? colors.danger : colors.border,
                    color: colors.foreground,
                    fontFamily: "DM_Sans_400Regular",
                  },
                ]}
                placeholder="e.g. 12345678"
                placeholderTextColor={colors.mutedForeground}
                value={reaaNumber}
                onChangeText={(v) => {
                  setReaaNumber(v);
                  if (fieldErrors.agencyDetails) setFieldErrors((p) => ({ ...p, agencyDetails: undefined }));
                }}
                keyboardType="number-pad"
              />
              {fieldErrors.agencyDetails && (
                <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>
                  {fieldErrors.agencyDetails}
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Years of experience <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <View style={styles.optionRow}>
                {YEARS_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => setYearsExp(opt.value)}
                    style={[
                      styles.optionBtn,
                      {
                        backgroundColor: yearsExp === opt.value ? colors.accent : colors.card,
                        borderColor: yearsExp === opt.value ? colors.accent : colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.optionText, {
                      color: yearsExp === opt.value ? "#fff" : colors.foreground,
                      fontFamily: yearsExp === opt.value ? "DM_Sans_600SemiBold" : "DM_Sans_400Regular",
                    }]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Regions covered <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <MultiSelectChips options={REGION_OPTIONS} selected={regions} onChange={setRegions} />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Property types <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <MultiSelectChips options={PROPERTY_TYPE_OPTIONS} selected={propertyTypes} onChange={setPropertyTypes} />
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

function SectionHeader({ label, colors }: { label: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[sectionStyles.header, { borderBottomColor: colors.border }]}>
      <Text style={[sectionStyles.label, { color: colors.mutedForeground, fontFamily: "DM_Sans_600SemiBold" }]}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

const sectionStyles = StyleSheet.create({
  header: { borderBottomWidth: 1, paddingBottom: 10, marginTop: 24, marginBottom: 16 },
  label: { fontSize: 11, letterSpacing: 0.8 },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 24 },
  backBtn: { marginBottom: 20, width: 36 },
  roleTag: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginBottom: 16 },
  roleTagText: { fontSize: 13 },
  heading: { fontSize: 26, marginBottom: 6 },
  subheading: { fontSize: 14, marginBottom: 24, lineHeight: 20 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 16 },
  errorText: { flex: 1, fontSize: 14, lineHeight: 20 },
  form: { gap: 16 },
  row: { flexDirection: "row", gap: 12 },
  field: { gap: 5 },
  label: { fontSize: 14 },
  fieldError: { fontSize: 12, lineHeight: 16 },
  input: { height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, fontSize: 15 },
  passwordWrapper: { height: 48, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, height: "100%", paddingHorizontal: 16, fontSize: 15 },
  eyeBtn: { paddingHorizontal: 14 },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  optionText: { fontSize: 13 },
  primaryBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14 },
});
