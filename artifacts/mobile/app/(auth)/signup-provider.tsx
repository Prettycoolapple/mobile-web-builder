import React, { useState, useRef } from "react";
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
  Animated,
  useWindowDimensions,
  Alert,
  Modal,
  Image,
  FlatList,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { useAuth, ApiError, type ProviderDiscipline } from "@/context/AuthContext";
import { MultiSelectChips } from "@/components/MultiSelectChips";

import { WORLD_LANGUAGES } from "@/lib/languages";

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

const TOTAL_STEPS = 6;

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  companyName?: string;
  regNumber?: string;
  discipline?: string;
  otherDiscipline?: string;
  cert?: string;
  contactNumber?: string;
  primaryLanguage?: string;
}

const ACCENT = "#52C99A";

function LanguagePicker({
  label,
  value,
  onSelect,
  placeholder,
  required,
  error,
  colors,
}: {
  label: string;
  value: string;
  onSelect: (val: string) => void;
  placeholder: string;
  required?: boolean;
  error?: string;
  colors: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = WORLD_LANGUAGES.filter((l) =>
    l.toLowerCase().includes(search.toLowerCase()),
  );

  const options = required
    ? filtered
    : ["None", ...filtered];

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        {label}
        {!required && (
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }}> (optional)</Text>
        )}
      </Text>
      <TouchableOpacity
        onPress={() => { setSearch(""); setOpen(true); }}
        style={[
          styles.pickerBtn,
          {
            backgroundColor: colors.card,
            borderColor: error ? colors.danger : colors.border,
          },
        ]}
        activeOpacity={0.7}
      >
        <Text
          style={[
            styles.pickerBtnText,
            { color: value ? colors.foreground : colors.mutedForeground, fontFamily: "DM_Sans_400Regular" },
          ]}
        >
          {value || placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
      {error && <Text style={[styles.fieldError, { color: colors.danger }]}>{error}</Text>}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>{label}</Text>
            <TouchableOpacity onPress={() => setOpen(false)} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={[styles.modalSearch, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.modalSearchInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
              placeholder="Search languages…"
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => item}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[
                  styles.modalOption,
                  { borderBottomColor: colors.border },
                  item === value && { backgroundColor: ACCENT + "18" },
                ]}
                onPress={() => {
                  onSelect(item === "None" ? "" : item);
                  setOpen(false);
                }}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.modalOptionText,
                    { color: item === value ? ACCENT : colors.foreground, fontFamily: item === value ? "DM_Sans_600SemiBold" : "DM_Sans_400Regular" },
                  ]}
                >
                  {item}
                </Text>
                {item === value && <Feather name="check" size={16} color={ACCENT} />}
              </TouchableOpacity>
            )}
            keyboardShouldPersistTaps="handled"
          />
        </View>
      </Modal>
    </View>
  );
}

export default function SignupProviderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, uploadIncorporationCert, updateServiceProviderCert, uploadProfilePicture } = useAuth();
  const { width: SCREEN_W } = useWindowDimensions();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [discipline, setDiscipline] = useState<ProviderDiscipline | null>(null);
  const [otherDisciplineText, setOtherDisciplineText] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressSuburb, setAddressSuburb] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressPostcode, setAddressPostcode] = useState("");
  const [contactNumber, setContactNumber] = useState("+64 ");
  const [primaryLanguage, setPrimaryLanguage] = useState("");
  const [secondaryLanguage, setSecondaryLanguage] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState("image/jpeg");
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [step, setStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const slide = (nextStep: number, direction: 1 | -1) => {
    Animated.timing(slideAnim, {
      toValue: -direction * SCREEN_W,
      duration: 260,
      useNativeDriver: true,
    }).start(() => {
      slideAnim.setValue(direction * SCREEN_W);
      setStep(nextStep);
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start();
    });
  };

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

  const handlePickAvatar = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow access to your photo library to upload a logo.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setAvatarUri(asset.uri);
      setAvatarMimeType(asset.mimeType ?? "image/jpeg");
    } catch {
      Alert.alert("Error", "Could not select image. Please try again.");
    }
  };

  const validateStep = (): boolean => {
    const errors: FieldErrors = {};
    if (step === 0) {
      if (!firstName.trim()) errors.firstName = "First name is required.";
      if (!lastName.trim()) errors.lastName = "Last name is required.";
    } else if (step === 1) {
      if (!email.trim()) errors.email = "Email is required.";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Enter a valid email address.";
      if (!password) errors.password = "Password is required.";
      else if (password.length < 8) errors.password = "Password must be at least 8 characters.";
      if (!confirmPassword) errors.confirmPassword = "Please confirm your password.";
      else if (password !== confirmPassword) errors.confirmPassword = "Passwords do not match.";
    } else if (step === 2) {
      if (!companyName.trim()) errors.companyName = "Company name is required.";
      if (!regNumber.trim()) errors.regNumber = "NZ Companies Register number is required.";
      if (!discipline) errors.discipline = "Please select your discipline.";
      else if (discipline === "other" && !otherDisciplineText.trim()) errors.otherDiscipline = "Please describe your discipline.";
      if (!pickedFile) errors.cert = "Certificate of Incorporation is required.";
    } else if (step === 3) {
      const phone = contactNumber.trim();
      if (!phone || phone === "+64") errors.contactNumber = "Contact number is required.";
      if (!primaryLanguage) errors.primaryLanguage = "Primary language is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goNext = () => {
    if (!validateStep()) return;
    slide(step + 1, 1);
  };

  const goBack = () => {
    if (step === 0) { router.back(); return; }
    slide(step - 1, -1);
  };

  const handleSignup = async () => {
    setSubmitError(null);
    setCertError(null);
    setIsLoading(true);
    try {
      const { token: newToken } = await signUp({
        role: "service_provider",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        languages: primaryLanguage ? [primaryLanguage, ...(secondaryLanguage ? [secondaryLanguage] : [])] : [],
        providerData: {
          companyName: companyName.trim() || undefined,
          nzCompanyRegisterNumber: regNumber.trim(),
          discipline: discipline ?? undefined,
          otherDiscipline: discipline === "other" ? otherDisciplineText.trim() || undefined : undefined,
          addressStreet: addressStreet.trim() || undefined,
          addressSuburb: addressSuburb.trim() || undefined,
          addressCity: addressCity.trim() || undefined,
          addressPostcode: addressPostcode.trim() || undefined,
          contactNumber: contactNumber.trim() !== "+64" ? contactNumber.trim() : undefined,
          primaryLanguage: primaryLanguage || undefined,
          secondaryLanguage: secondaryLanguage || undefined,
        },
      });

      if (avatarUri) {
        try {
          const ext = avatarMimeType.split("/")[1] ?? "jpg";
          await uploadProfilePicture(avatarUri, avatarMimeType, `avatar.${ext}`, newToken);
        } catch {
        }
      }

      if (pickedFile) {
        setUploadStatus("uploading");
        try {
          const { fileUrl } = await uploadIncorporationCert(pickedFile.uri, pickedFile.mimeType, pickedFile.name, newToken);
          await updateServiceProviderCert(fileUrl, newToken);
          setUploadStatus("done");
        } catch (certErr) {
          setUploadStatus("error");
          setCertError(certErr instanceof Error ? certErr.message : "Certificate upload failed — you can re-upload it from your profile.");
        }
      }

      router.replace("/(onboarding)/service-provider-welcome");
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
          if (mapped.email || mapped.password) setStep(1);
          else if (mapped.firstName || mapped.lastName) setStep(0);
          else if (mapped.companyName || mapped.discipline) setStep(2);
          return;
        }
      }
      setSubmitError(err instanceof Error ? err.message : "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const inputBase = (field: keyof FieldErrors) => [
    styles.input,
    {
      backgroundColor: colors.card,
      borderColor: fieldErrors[field] ? colors.danger : colors.border,
      color: colors.foreground,
      fontFamily: "DM_Sans_400Regular",
    },
  ];

  const renderStep = () => {
    if (step === 0) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>Service Provider · $149/mo</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>What should{"\n"}we call you?</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            Let's get your provider profile set up.
          </Text>

          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.foreground }]}>First name</Text>
              <TextInput
                style={inputBase("firstName")}
                placeholder="Jane"
                placeholderTextColor={colors.mutedForeground}
                value={firstName}
                onChangeText={(v) => { setFirstName(v); if (fieldErrors.firstName) setFieldErrors((p) => ({ ...p, firstName: undefined })); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {fieldErrors.firstName && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.firstName}</Text>}
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.foreground }]}>Last name</Text>
              <TextInput
                style={inputBase("lastName")}
                placeholder="Smith"
                placeholderTextColor={colors.mutedForeground}
                value={lastName}
                onChangeText={(v) => { setLastName(v); if (fieldErrors.lastName) setFieldErrors((p) => ({ ...p, lastName: undefined })); }}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={goNext}
              />
              {fieldErrors.lastName && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.lastName}</Text>}
            </View>
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: ACCENT }]} onPress={goNext} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 1) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>Service Provider · $149/mo</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>Create your{"\n"}login</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>Your email and a secure password.</Text>

          {submitError && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{submitError}</Text>
            </View>
          )}

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Email address</Text>
              <TextInput
                style={inputBase("email")}
                placeholder="you@example.com"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={(v) => { setEmail(v); if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined })); }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />
              {fieldErrors.email && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.email}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Password</Text>
              <View style={[styles.passwordWrapper, { backgroundColor: colors.card, borderColor: fieldErrors.password ? colors.danger : colors.border }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="At least 8 characters"
                  placeholderTextColor={colors.mutedForeground}
                  value={password}
                  onChangeText={(v) => { setPassword(v); if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined })); }}
                  secureTextEntry={!showPassword}
                  autoComplete="password-new"
                  returnKeyType="next"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
              {fieldErrors.password && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.password}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Confirm password</Text>
              <TextInput
                style={inputBase("confirmPassword")}
                placeholder="Re-enter your password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={(v) => { setConfirmPassword(v); if (fieldErrors.confirmPassword) setFieldErrors((p) => ({ ...p, confirmPassword: undefined })); }}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
                returnKeyType="done"
                onSubmitEditing={goNext}
              />
              {fieldErrors.confirmPassword && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.confirmPassword}</Text>}
            </View>
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: ACCENT }]} onPress={goNext} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 2) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>Service Provider · $149/mo</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>Your company</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            Your company details and professional discipline.
          </Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Company name *</Text>
              <TextInput
                style={inputBase("companyName")}
                placeholder="Acme Design Ltd"
                placeholderTextColor={colors.mutedForeground}
                value={companyName}
                onChangeText={(v) => { setCompanyName(v); if (fieldErrors.companyName) setFieldErrors((p) => ({ ...p, companyName: undefined })); }}
              />
              {fieldErrors.companyName && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.companyName}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>NZ Companies Register number *</Text>
              <TextInput
                style={inputBase("regNumber")}
                placeholder="e.g. 1234567"
                placeholderTextColor={colors.mutedForeground}
                value={regNumber}
                onChangeText={(v) => { setRegNumber(v); if (fieldErrors.regNumber) setFieldErrors((p) => ({ ...p, regNumber: undefined })); }}
                keyboardType="number-pad"
              />
              {fieldErrors.regNumber && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.regNumber}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Discipline *</Text>
              <MultiSelectChips
                options={DISCIPLINE_OPTIONS}
                selected={discipline ? [discipline] : []}
                onChange={(vals) => {
                  const val = (vals[0] as ProviderDiscipline) ?? null;
                  setDiscipline(val);
                  if (val !== "other") setOtherDisciplineText("");
                  if (fieldErrors.discipline) setFieldErrors((p) => ({ ...p, discipline: undefined }));
                }}
                singleSelect
              />
              {fieldErrors.discipline && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.discipline}</Text>}
            </View>

            {discipline === "other" && (
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground }]}>Describe your discipline *</Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: fieldErrors.otherDiscipline ? colors.danger : colors.border,
                      color: colors.foreground,
                      fontFamily: "DM_Sans_400Regular",
                    },
                  ]}
                  placeholder="e.g. Environmental consultant"
                  placeholderTextColor={colors.mutedForeground}
                  value={otherDisciplineText}
                  onChangeText={(v) => { setOtherDisciplineText(v); if (fieldErrors.otherDiscipline) setFieldErrors((p) => ({ ...p, otherDiscipline: undefined })); }}
                  autoCapitalize="words"
                />
                {fieldErrors.otherDiscipline && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.otherDiscipline}</Text>}
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Certificate of Incorporation *</Text>
              <TouchableOpacity
                onPress={() => { handlePickDocument(); if (fieldErrors.cert) setFieldErrors((p) => ({ ...p, cert: undefined })); }}
                disabled={uploadStatus === "uploading"}
                style={[
                  styles.uploadBtn,
                  {
                    backgroundColor: uploadStatus === "done" ? colors.success + "10" : uploadStatus === "error" || fieldErrors.cert ? colors.danger + "10" : pickedFile ? ACCENT + "10" : colors.card,
                    borderColor: uploadStatus === "done" ? colors.success : uploadStatus === "error" || fieldErrors.cert ? colors.danger : pickedFile ? ACCENT : colors.border,
                  },
                ]}
                activeOpacity={0.7}
              >
                {pickedFile ? (
                  <>
                    <Feather name="file-text" size={18} color={ACCENT} />
                    <Text style={[styles.uploadBtnText, { color: ACCENT, fontFamily: "DM_Sans_500Medium" }]} numberOfLines={1}>{pickedFile.name}</Text>
                    <TouchableOpacity onPress={(e) => { e.stopPropagation(); setPickedFile(null); }} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <Feather name="file" size={18} color={colors.mutedForeground} />
                    <Text style={[styles.uploadBtnText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>Choose certificate file</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>PDF, JPEG, PNG or WEBP — max 10 MB</Text>
              {fieldErrors.cert && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.cert}</Text>}
            </View>
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: ACCENT }]} onPress={goNext} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 3) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>Service Provider · $149/mo</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>Contact{"\n"}details</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            How clients will reach you.
          </Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Phone number *</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.card,
                    borderColor: fieldErrors.contactNumber ? colors.danger : colors.border,
                    color: colors.foreground,
                    fontFamily: "DM_Sans_400Regular",
                  },
                ]}
                placeholder="+64 21 123 4567"
                placeholderTextColor={colors.mutedForeground}
                value={contactNumber}
                onChangeText={(v) => { setContactNumber(v); if (fieldErrors.contactNumber) setFieldErrors((p) => ({ ...p, contactNumber: undefined })); }}
                keyboardType="phone-pad"
              />
              {fieldErrors.contactNumber && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.contactNumber}</Text>}
            </View>

            <LanguagePicker
              label="Primary language"
              value={primaryLanguage}
              onSelect={(v) => { setPrimaryLanguage(v); if (fieldErrors.primaryLanguage) setFieldErrors((p) => ({ ...p, primaryLanguage: undefined })); }}
              placeholder="Select primary language"
              required
              error={fieldErrors.primaryLanguage}
              colors={colors}
            />

            <LanguagePicker
              label="Secondary language"
              value={secondaryLanguage}
              onSelect={setSecondaryLanguage}
              placeholder="None"
              colors={colors}
            />
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: ACCENT }]} onPress={goNext} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 4) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>Service Provider · $149/mo</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>Where are{"\n"}you based?</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            Help property developers find nearby providers.{" "}
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }}>All fields optional.</Text>
          </Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>Street address</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder="123 Main Street"
                placeholderTextColor={colors.mutedForeground}
                value={addressStreet}
                onChangeText={setAddressStreet}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground }]}>Suburb</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="Ponsonby"
                  placeholderTextColor={colors.mutedForeground}
                  value={addressSuburb}
                  onChangeText={setAddressSuburb}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.field, { width: 90 }]}>
                <Text style={[styles.label, { color: colors.foreground }]}>Postcode</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder="1010"
                  placeholderTextColor={colors.mutedForeground}
                  value={addressPostcode}
                  onChangeText={setAddressPostcode}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>City</Text>
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

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: ACCENT }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Continue</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.stepContent}>
        <Text style={[styles.stepTag, { color: ACCENT }]}>Service Provider · $149/mo</Text>
        <Text style={[styles.stepHeading, { color: colors.foreground }]}>Profile{"\n"}picture</Text>
        <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
          Add a photo so clients can put a face to the name.{" "}
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }}>Optional.</Text>
        </Text>

        {(submitError || certError) && (
          <View style={[styles.errorBanner, { backgroundColor: (certError ? "#F59E0B" : colors.danger) + "18", borderColor: (certError ? "#F59E0B" : colors.danger) + "40" }]}>
            <Feather name={certError ? "alert-triangle" : "alert-circle"} size={15} color={certError ? "#F59E0B" : colors.danger} />
            <Text style={[styles.errorText, { color: certError ? "#92400E" : colors.danger }]}>{certError ?? submitError}</Text>
          </View>
        )}

        <View style={styles.avatarStepSection}>
          <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.8} style={styles.avatarStepBtn}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarStepPreview} />
            ) : (
              <View style={[styles.avatarStepPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="camera" size={36} color={colors.mutedForeground} />
                <Text style={[styles.avatarStepPlaceholderText, { color: colors.mutedForeground }]}>Tap to upload</Text>
              </View>
            )}
          </TouchableOpacity>
          {avatarUri && (
            <View style={styles.avatarStepActions}>
              <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.7}>
                <Text style={[styles.avatarLink, { color: ACCENT }]}>Change photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAvatarUri(null)} activeOpacity={0.7}>
                <Text style={[styles.avatarLink, { color: colors.mutedForeground }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={[styles.avatarStepHint, { color: colors.mutedForeground }]}>
            Providers with a photo receive significantly more engagement from potential clients. You can also add this later from your account settings.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: ACCENT, opacity: isLoading ? 0.7 : 1 }]}
          onPress={handleSignup}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>Create account</Text>
              <Feather name="check" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSignup}
          disabled={isLoading}
          activeOpacity={0.7}
          style={styles.skipBtn}
        >
          <Text style={[styles.skipBtnText, { color: colors.mutedForeground }]}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.progressTrack, { marginTop: insets.top, backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(((step + 1) / TOTAL_STEPS) * 100)}%`, backgroundColor: ACCENT },
          ]}
        />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <Animated.View style={[{ flex: 1 }, { transform: [{ translateX: slideAnim }] }]}>
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.topNav}>
              <TouchableOpacity onPress={goBack} style={styles.backBtn}>
                <Feather name="arrow-left" size={22} color={colors.foreground} />
              </TouchableOpacity>
              <Text style={[styles.stepCounter, { color: colors.mutedForeground }]}>
                {step + 1} / {TOTAL_STEPS}
              </Text>
            </View>

            {renderStep()}

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                Already have an account?{" "}
              </Text>
              <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
                <Text style={[styles.footerLink, { color: ACCENT }]}>Sign in</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  progressTrack: { height: 3, width: "100%" },
  progressFill: { height: "100%", borderRadius: 2 },
  scroll: { paddingHorizontal: 24 },
  topNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 16, marginBottom: 8 },
  backBtn: { width: 36, height: 36, alignItems: "flex-start", justifyContent: "center" },
  stepCounter: { fontSize: 13, fontFamily: "DM_Sans_400Regular" },
  stepContent: { paddingTop: 16, gap: 20 },
  stepTag: { fontSize: 12, fontFamily: "DM_Sans_600SemiBold", letterSpacing: 0.5, textTransform: "uppercase" },
  stepHeading: { fontSize: 32, fontFamily: "DM_Sans_700Bold", lineHeight: 40, marginTop: -4 },
  stepSubheading: { fontSize: 15, fontFamily: "DM_Sans_400Regular", lineHeight: 22, marginTop: -8 },
  errorBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 14, fontFamily: "DM_Sans_400Regular", lineHeight: 20 },
  fields: { gap: 16 },
  fieldRow: { flexDirection: "row", gap: 12 },
  field: { gap: 6 },
  label: { fontSize: 14, fontFamily: "DM_Sans_500Medium" },
  fieldError: { fontSize: 12, fontFamily: "DM_Sans_400Regular", lineHeight: 16 },
  input: { height: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, fontSize: 15 },
  passwordWrapper: { height: 52, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  passwordInput: { flex: 1, height: "100%", paddingHorizontal: 16, fontSize: 15 },
  eyeBtn: { paddingHorizontal: 14 },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14,
  },
  uploadBtnText: { flex: 1, fontSize: 14 },
  uploadHint: { fontSize: 12, fontFamily: "DM_Sans_400Regular", marginTop: 4 },
  pickerBtn: {
    height: 52, borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 16, flexDirection: "row",
    alignItems: "center", justifyContent: "space-between",
  },
  pickerBtnText: { fontSize: 15, flex: 1 },
  avatarSection: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
  avatarPreview: { width: 72, height: 72, borderRadius: 36 },
  avatarPlaceholder: {
    width: 72, height: 72, borderRadius: 36,
    borderWidth: 1, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center",
  },
  avatarHint: { fontSize: 13, fontFamily: "DM_Sans_400Regular", lineHeight: 19, flex: 1 },
  avatarLink: { fontSize: 13, fontFamily: "DM_Sans_600SemiBold" },
  avatarStepSection: { alignItems: "center", gap: 16 },
  avatarStepBtn: { alignSelf: "center" },
  avatarStepPreview: { width: 120, height: 120, borderRadius: 60 },
  avatarStepPlaceholder: {
    width: 120, height: 120, borderRadius: 60,
    borderWidth: 2, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  avatarStepPlaceholderText: { fontSize: 13, fontFamily: "DM_Sans_400Regular" },
  avatarStepActions: { flexDirection: "row", gap: 20 },
  avatarStepHint: { fontSize: 13, fontFamily: "DM_Sans_400Regular", lineHeight: 20, textAlign: "center", paddingHorizontal: 8 },
  skipBtn: { height: 44, alignItems: "center", justifyContent: "center" },
  skipBtnText: { fontSize: 14, fontFamily: "DM_Sans_400Regular" },
  primaryBtn: {
    height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8, marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "DM_Sans_600SemiBold" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28 },
  footerText: { fontSize: 14, fontFamily: "DM_Sans_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "DM_Sans_600SemiBold" },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 17, fontFamily: "DM_Sans_600SemiBold" },
  modalSearch: {
    flexDirection: "row", alignItems: "center", gap: 10,
    marginHorizontal: 16, marginVertical: 12,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10,
  },
  modalSearchInput: { flex: 1, fontSize: 15 },
  modalOption: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalOptionText: { fontSize: 15 },
});
