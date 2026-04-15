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
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth, ApiError, type ProviderDiscipline } from "@/context/AuthContext";
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

const DISCIPLINE_OPTIONS: { label: string; value: ProviderDiscipline }[] = [
  { label: "Architect / Designer", value: "architect_designer" },
  { label: "Planner", value: "planner" },
  { label: "Engineer", value: "engineer" },
  { label: "Quantity Surveyor", value: "quantity_surveyor" },
  { label: "Other", value: "other" },
];

interface PickedFile {
  name: string;
  uri: string;
  mimeType: string;
}

type UploadStatus = "idle" | "uploading" | "done" | "error";

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  companyName?: string;
  discipline?: string;
}

export default function SignupProviderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, uploadIncorporationCert, updateServiceProviderCert } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [discipline, setDiscipline] = useState<ProviderDiscipline | null>(null);
  const [addressStreet, setAddressStreet] = useState("");
  const [addressSuburb, setAddressSuburb] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressPostcode, setAddressPostcode] = useState("");
  const [contactNumber, setContactNumber] = useState("+64 ");
  const [languages, setLanguages] = useState<string[]>([]);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setPickedFile({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType ?? "application/pdf" });
    } catch {
      Alert.alert("Error", "Could not pick a file. Please try again.");
    }
  };

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
    if (!companyName.trim()) errors.companyName = "Company name is required.";
    if (!discipline) errors.discipline = "Please select your discipline.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSignup = async () => {
    setSubmitError(null);
    setCertError(null);
    if (!validate()) return;
    setIsLoading(true);
    try {
      // Step 1: Create account (no cert URL yet — user is unauthenticated at this point)
      const { token: newToken } = await signUp({
        role: "service_provider",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        languages,
        providerData: {
          companyName: companyName.trim() || undefined,
          nzCompanyRegisterNumber: regNumber.trim() || undefined,
          discipline: discipline ?? undefined,
          addressStreet: addressStreet.trim() || undefined,
          addressSuburb: addressSuburb.trim() || undefined,
          addressCity: addressCity.trim() || undefined,
          addressPostcode: addressPostcode.trim() || undefined,
          contactNumber: contactNumber.trim() !== "+64" ? contactNumber.trim() : undefined,
        },
      });

      // Step 2: If a file was selected, upload it now that we're authenticated
      if (pickedFile) {
        setUploadStatus("uploading");
        try {
          const { fileUrl } = await uploadIncorporationCert(
            pickedFile.uri,
            pickedFile.mimeType,
            pickedFile.name,
            newToken,
          );
          // Step 3: Patch the service provider profile with the cert URL
          await updateServiceProviderCert(fileUrl, newToken);
          setUploadStatus("done");
        } catch (certErr) {
          setUploadStatus("error");
          setCertError(
            certErr instanceof Error
              ? certErr.message
              : "Certificate upload failed — you can re-upload it from your profile.",
          );
          // Account is created; navigate anyway so the user isn't blocked
        }
      }

      router.replace("/(auth)/welcome-provider");
    } catch (err) {
      setUploadStatus("idle");
      if (err instanceof ApiError && err.details?.length) {
        const mapped: FieldErrors = {};
        for (const issue of err.details) {
          const key = issue.path[0];
          const nested = issue.path[1];
          if (key === "firstName") mapped.firstName = issue.message;
          else if (key === "lastName") mapped.lastName = issue.message;
          else if (key === "email") mapped.email = issue.message;
          else if (key === "password") mapped.password = issue.message;
          else if (key === "providerData" && nested === "companyName") mapped.companyName = issue.message;
          else if (key === "providerData" && nested === "discipline") mapped.discipline = issue.message;
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
            <Feather name="tool" size={14} color={colors.accent} />
            <Text style={[styles.roleTagText, { color: colors.accent, fontFamily: "DM_Sans_600SemiBold" }]}>
              Service Provider
            </Text>
          </View>

          <Text style={[styles.heading, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
            Provider registration
          </Text>
          <Text style={[styles.subheading, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
            $149/month · 14-day free trial
          </Text>

          {submitError && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{submitError}</Text>
            </View>
          )}
          {certError && (
            <View style={[styles.errorBanner, { backgroundColor: "#F59E0B18", borderColor: "#F59E0B40" }]}>
              <Feather name="alert-triangle" size={15} color="#F59E0B" />
              <Text style={[styles.errorText, { color: "#92400E", fontFamily: "DM_Sans_400Regular" }]}>
                Certificate not uploaded: {certError}
              </Text>
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

          <SectionHeader label="Company details" colors={colors} />
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Company name *
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: fieldErrors.companyName ? colors.danger : colors.border,
                    color: colors.foreground,
                    fontFamily: "DM_Sans_400Regular",
                  },
                ]}
                placeholder="Acme Design Ltd"
                placeholderTextColor={colors.mutedForeground}
                value={companyName}
                onChangeText={(v) => {
                  setCompanyName(v);
                  if (fieldErrors.companyName) setFieldErrors((p) => ({ ...p, companyName: undefined }));
                }}
              />
              {fieldErrors.companyName && (
                <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>
                  {fieldErrors.companyName}
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                NZ Companies Register number <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="e.g. 1234567"
                placeholderTextColor={colors.mutedForeground}
                value={regNumber}
                onChangeText={setRegNumber}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Discipline *
              </Text>
              <MultiSelectChips
                options={DISCIPLINE_OPTIONS}
                selected={discipline ? [discipline] : []}
                onChange={(vals) => {
                  setDiscipline((vals[0] as ProviderDiscipline) ?? null);
                  if (fieldErrors.discipline) setFieldErrors((p) => ({ ...p, discipline: undefined }));
                }}
                singleSelect
              />
              {fieldErrors.discipline && (
                <Text style={[styles.fieldError, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>
                  {fieldErrors.discipline}
                </Text>
              )}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Certificate of Incorporation <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TouchableOpacity
                onPress={handlePickDocument}
                disabled={uploadStatus === "uploading"}
                style={[
                  styles.uploadBtn,
                  {
                    backgroundColor:
                      uploadStatus === "done"
                        ? colors.success + "10"
                        : uploadStatus === "error"
                        ? colors.danger + "10"
                        : pickedFile
                        ? colors.accent + "10"
                        : colors.card,
                    borderColor:
                      uploadStatus === "done"
                        ? colors.success
                        : uploadStatus === "error"
                        ? colors.danger
                        : pickedFile
                        ? colors.accent
                        : colors.border,
                  },
                ]}
                activeOpacity={0.7}
              >
                {uploadStatus === "uploading" ? (
                  <>
                    <ActivityIndicator size="small" color={colors.accent} />
                    <Text style={[styles.uploadBtnText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      Uploading certificate…
                    </Text>
                  </>
                ) : uploadStatus === "done" ? (
                  <>
                    <Feather name="check-circle" size={18} color={colors.success} />
                    <Text style={[styles.uploadBtnText, { color: colors.success, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
                      {pickedFile?.name ?? "Certificate uploaded"}
                    </Text>
                  </>
                ) : uploadStatus === "error" ? (
                  <>
                    <Feather name="alert-circle" size={18} color={colors.danger} />
                    <Text style={[styles.uploadBtnText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]} numberOfLines={1}>
                      Upload failed — tap to choose again
                    </Text>
                  </>
                ) : pickedFile ? (
                  <>
                    <Feather name="file-text" size={18} color={colors.accent} />
                    <Text style={[styles.uploadBtnText, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>
                      {pickedFile.name}
                    </Text>
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); setPickedFile(null); }}
                      hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                    >
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Feather name="file" size={18} color={colors.mutedForeground} />
                    <Text style={[styles.uploadBtnText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      Choose certificate file
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                PDF, JPEG, PNG or WEBP — max 10 MB. Uploaded after account creation.
              </Text>
            </View>
          </View>

          <SectionHeader label="Address" colors={colors} />
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Street <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="123 Main Street"
                placeholderTextColor={colors.mutedForeground}
                value={addressStreet}
                onChangeText={setAddressStreet}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Suburb</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Grey Lynn"
                  placeholderTextColor={colors.mutedForeground}
                  value={addressSuburb}
                  onChangeText={setAddressSuburb}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>City</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Auckland"
                  placeholderTextColor={colors.mutedForeground}
                  value={addressCity}
                  onChangeText={setAddressCity}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Postcode</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="1010"
                placeholderTextColor={colors.mutedForeground}
                value={addressPostcode}
                onChangeText={setAddressPostcode}
                keyboardType="number-pad"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Contact number <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="+64 21 000 0000"
                placeholderTextColor={colors.mutedForeground}
                value={contactNumber}
                onChangeText={setContactNumber}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          <SectionHeader label="Languages spoken" colors={colors} />
          <View style={styles.form}>
            <MultiSelectChips options={LANGUAGE_OPTIONS} selected={languages} onChange={setLanguages} />

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
  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 12, borderStyle: "dashed",
    padding: 14, minHeight: 52,
  },
  uploadBtnText: { flex: 1, fontSize: 14 },
  uploadHint: { fontSize: 12, marginTop: 2 },
  primaryBtn: { height: 50, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 8 },
  primaryBtnText: { color: "#fff", fontSize: 16 },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28 },
  footerText: { fontSize: 14 },
  footerLink: { fontSize: 14 },
});
