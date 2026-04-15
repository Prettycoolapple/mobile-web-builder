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

const DISCIPLINE_OPTIONS = [
  { label: "Architect", value: "architect" },
  { label: "Designer", value: "designer" },
  { label: "Planner", value: "planner" },
  { label: "Other", value: "other" },
];

type Discipline = "architect" | "designer" | "planner" | "other";

interface UploadedFile {
  name: string;
  uri: string;
  mimeType: string;
  fileUrl?: string;
}

export default function SignupProviderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, uploadIncorporationCert } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [discipline, setDiscipline] = useState<Discipline | null>(null);
  const [addressStreet, setAddressStreet] = useState("");
  const [addressSuburb, setAddressSuburb] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressPostcode, setAddressPostcode] = useState("");
  const [contactNumber, setContactNumber] = useState("+64 ");
  const [languages, setLanguages] = useState<string[]>([]);
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setUploadedFile({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType || "application/pdf" });
    } catch {
      Alert.alert("Error", "Could not pick a file. Please try again.");
    }
  };

  const handleUploadCert = async (): Promise<string | undefined> => {
    if (!uploadedFile) return undefined;
    setIsUploading(true);
    try {
      const { fileUrl } = await uploadIncorporationCert(uploadedFile.uri, uploadedFile.mimeType, uploadedFile.name);
      setUploadedFile((prev) => prev ? { ...prev, fileUrl } : prev);
      return fileUrl;
    } catch (e: any) {
      Alert.alert("Upload failed", e.message || "Could not upload the certificate. Please try again.");
      return undefined;
    } finally {
      setIsUploading(false);
    }
  };

  const handleSignup = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      setError("First and last name are required.");
      return;
    }
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
      let incorporationCertUrl: string | undefined;
      if (uploadedFile && !uploadedFile.fileUrl) {
        incorporationCertUrl = await handleUploadCert();
      } else if (uploadedFile?.fileUrl) {
        incorporationCertUrl = uploadedFile.fileUrl;
      }

      await signUp({
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
          incorporationCertUrl,
        },
      });
      router.replace("/(auth)/welcome-provider");
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

          {error && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>{error}</Text>
            </View>
          )}

          <SectionHeader label="Personal details" colors={colors} />
          <View style={styles.form}>
            <View style={styles.row}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>First name *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Jane"
                  placeholderTextColor={colors.mutedForeground}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Last name *</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Smith"
                  placeholderTextColor={colors.mutedForeground}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Email *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Password *</Text>
              <View style={[styles.passwordWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>Confirm password *</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="Re-enter your password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
              />
            </View>
          </View>

          <SectionHeader label="Company details" colors={colors} />
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Company name <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="Acme Design Ltd"
                placeholderTextColor={colors.mutedForeground}
                value={companyName}
                onChangeText={setCompanyName}
              />
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
                Discipline <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <MultiSelectChips
                options={DISCIPLINE_OPTIONS}
                selected={discipline ? [discipline] : []}
                onChange={(vals) => setDiscipline((vals[0] as Discipline) ?? null)}
                singleSelect
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
                Certificate of Incorporation <Text style={{ color: colors.mutedForeground }}>(optional)</Text>
              </Text>
              <TouchableOpacity
                onPress={handlePickDocument}
                style={[
                  styles.uploadBtn,
                  {
                    backgroundColor: uploadedFile ? colors.success + "10" : colors.card,
                    borderColor: uploadedFile ? colors.success : colors.border,
                  },
                ]}
                activeOpacity={0.7}
              >
                {isUploading ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : uploadedFile ? (
                  <>
                    <Feather name="check-circle" size={18} color={colors.success} />
                    <Text style={[styles.uploadBtnText, { color: colors.success, fontFamily: "DM_Sans_500Medium" }]}>
                      {uploadedFile.name}
                    </Text>
                    <TouchableOpacity onPress={() => setUploadedFile(null)}>
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Feather name="upload" size={18} color={colors.mutedForeground} />
                    <Text style={[styles.uploadBtnText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                      Tap to select PDF or image
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                PDF, JPEG, PNG or WEBP — max 10 MB
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

function SectionHeader({ label, colors }: { label: string; colors: any }) {
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
  field: { gap: 7 },
  label: { fontSize: 14 },
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
