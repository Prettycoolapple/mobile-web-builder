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
import { PhoneOtpStep } from "@/components/PhoneOtpStep";
import { useT, isOSChineseLocale } from "@/lib/i18n";

import { WORLD_LANGUAGES, languageDisplayName } from "@/lib/languages";

type DisciplineOption = { label: string; value: ProviderDiscipline };

function buildDisciplineOptions(t: (k: string) => string): DisciplineOption[] {
  return [
    { label: t("dm.discipline.architect_designer"), value: "architect_designer" },
    { label: t("dm.discipline.planner"), value: "planner" },
    { label: t("dm.discipline.engineer"), value: "engineer" },
    { label: t("dm.discipline.quantity_surveyor"), value: "quantity_surveyor" },
    { label: t("dm.discipline.other"), value: "other" },
  ];
}

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

function cleanUploadError(baseMessage: string, error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : "";
  if (!detail) return baseMessage;
  const normalizedBase = baseMessage.replace(/[.\s]+$/g, "").toLowerCase();
  const normalizedDetail = detail.replace(/[.\s]+$/g, "").toLowerCase();
  if (
    normalizedDetail === normalizedBase ||
    normalizedDetail === "upload failed" ||
    normalizedDetail === "upload failed please try again" ||
    normalizedDetail.startsWith(`${normalizedBase} `)
  ) {
    return baseMessage;
  }
  return `${baseMessage} ${detail}`;
}

function LanguagePicker({
  label,
  value,
  onSelect,
  placeholder,
  required,
  error,
  colors,
  t,
}: {
  label: string;
  value: string;
  onSelect: (val: string) => void;
  placeholder: string;
  required?: boolean;
  error?: string;
  colors: ReturnType<typeof useColors>;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const osChinese = isOSChineseLocale();
  const q = search.toLowerCase();
  const filtered = WORLD_LANGUAGES.filter((l) => {
    const display = languageDisplayName(l, osChinese);
    return l.toLowerCase().includes(q) || display.toLowerCase().includes(q);
  });

  // Sentinel value for the "no selection" row. We use a locale-free token so
  // the actual displayed label can be localized while keeping equality checks
  // stable across renders.
  const NONE_VALUE = "__NONE__";
  const options = required ? filtered : [NONE_VALUE, ...filtered];

  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: colors.foreground }]}>
        {label}
        {!required && (
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }}>{t("signup.lang.optional_suffix")}</Text>
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
          {value ? languageDisplayName(value, osChinese) : placeholder}
        </Text>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
      {error && <Text style={[styles.fieldError, { color: colors.danger }]}>{error}</Text>}

      <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
        <KeyboardAvoidingView
          style={[styles.modalContainer, { backgroundColor: colors.background }]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
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
              placeholder={t("signup.lang.modal_search")}
              placeholderTextColor={colors.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoFocus
            />
          </View>
          <FlatList
            data={options}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const displayText =
                item === NONE_VALUE ? t("signup.lang.none") : languageDisplayName(item, osChinese);
              return (
                <TouchableOpacity
                  style={[
                    styles.modalOption,
                    { borderBottomColor: colors.border },
                    item === value && { backgroundColor: ACCENT + "18" },
                  ]}
                  onPress={() => {
                    onSelect(item === NONE_VALUE ? "" : item);
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
                    {displayText}
                  </Text>
                  {item === value && <Feather name="check" size={16} color={ACCENT} />}
                </TouchableOpacity>
              );
            }}
            keyboardShouldPersistTaps="handled"
          />
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function SignupProviderScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, uploadIncorporationCertPreSignup, uploadProfilePicture, refreshProfile } = useAuth();
  const { width: SCREEN_W } = useWindowDimensions();
  const { t } = useT();
  const DISCIPLINE_OPTIONS = React.useMemo(() => buildDisciplineOptions(t), [t]);

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
  const [phoneVerificationToken, setPhoneVerificationToken] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
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
      Alert.alert(t("common.error"), t("signup.cert.pick_error"));
    }
  };

  const handlePickAvatar = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(t("signup.photo.permission_title"), t("signup.photo.permission_body"));
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
      Alert.alert(t("common.error"), t("signup.photo.select_error"));
    }
  };

  const validateStep = (): boolean => {
    const errors: FieldErrors = {};
    if (step === 0) {
      if (!firstName.trim()) errors.firstName = t("signup.error.first_name");
      if (!lastName.trim()) errors.lastName = t("signup.error.last_name");
    } else if (step === 1) {
      if (!email.trim()) errors.email = t("signup.error.email");
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = t("signup.error.email_invalid");
      if (!password) errors.password = t("signup.error.password");
      else if (password.length < 8) errors.password = t("signup.error.password_short");
      if (!confirmPassword) errors.confirmPassword = t("signup.error.confirm_password");
      else if (password !== confirmPassword) errors.confirmPassword = t("signup.error.password_mismatch");
    } else if (step === 2) {
      if (!companyName.trim()) errors.companyName = t("signup.error.company");
      if (!regNumber.trim()) errors.regNumber = t("signup.error.reg_number");
      if (!discipline) errors.discipline = t("signup.error.discipline");
      else if (discipline === "other" && !otherDisciplineText.trim()) errors.otherDiscipline = t("signup.error.discipline_other");
      if (!pickedFile) errors.cert = t("signup.error.cert");
    } else if (step === 3) {
      if (!phoneVerificationToken || !verifiedPhone) {
        errors.contactNumber = t("signup.error.phone_verify");
      }
      if (!primaryLanguage) errors.primaryLanguage = t("signup.error.primary_language");
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

  const handleSignup = async (options?: { skipAvatar?: boolean }) => {
    setSubmitError(null);
    setCertError(null);
    setIsLoading(true);
    try {
      // Atomic provider signup: upload the Certificate of Incorporation FIRST
      // and only attempt to create the account once we have a URL. The server
      // requires providerData.incorporationCertUrl, so a failed upload aborts
      // signup before any half-formed profile is written.
      if (!pickedFile) {
        setFieldErrors((e) => ({ ...e, cert: t("signup.error.cert") }));
        setUploadStatus("error");
        setStep(5);
        setIsLoading(false);
        return;
      }

      setUploadStatus("uploading");
      let certFileUrl: string;
      try {
        const { fileUrl } = await uploadIncorporationCertPreSignup(
          pickedFile.uri,
          pickedFile.mimeType,
          pickedFile.name,
        );
        certFileUrl = fileUrl;
        setUploadStatus("done");
      } catch (certErr) {
        setUploadStatus("error");
        setCertError(cleanUploadError(t("signup.cert.upload_failed"), certErr));
        setIsLoading(false);
        return;
      }

      if (!phoneVerificationToken || !verifiedPhone) {
        setFieldErrors({ contactNumber: t("signup.error.phone_verify") });
        setStep(3);
        setIsLoading(false);
        return;
      }

      const { token: newToken } = await signUp({
        role: "service_provider",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        languages: primaryLanguage ? [primaryLanguage, ...(secondaryLanguage ? [secondaryLanguage] : [])] : [],
        phoneNumber: verifiedPhone,
        phoneVerificationToken,
        providerData: {
          companyName: companyName.trim() || undefined,
          nzCompanyRegisterNumber: regNumber.trim(),
          discipline: discipline ?? undefined,
          otherDiscipline: discipline === "other" ? otherDisciplineText.trim() || undefined : undefined,
          addressStreet: addressStreet.trim() || undefined,
          addressSuburb: addressSuburb.trim() || undefined,
          addressCity: addressCity.trim() || undefined,
          addressPostcode: addressPostcode.trim() || undefined,
          contactNumber: verifiedPhone,
          primaryLanguage: primaryLanguage || undefined,
          secondaryLanguage: secondaryLanguage || undefined,
          incorporationCertUrl: certFileUrl,
        },
      });

      if (avatarUri && !options?.skipAvatar) {
        try {
          const ext = avatarMimeType.split("/")[1] ?? "jpg";
          await uploadProfilePicture(avatarUri, avatarMimeType, `avatar.${ext}`, newToken);
          await refreshProfile().catch(() => {});
        } catch (err) {
          Alert.alert(
            t("profile.error"),
            t("profile.error_upload_conn"),
          );
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
      setSubmitError(err instanceof Error ? err.message : t("signup.submit_failed"));
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
          <Text style={[styles.stepTag, { color: ACCENT }]}>{t("signup.provider.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>{t("signup.name.heading")}</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.name.subheading_provider")}
          </Text>

          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.first_name")}</Text>
              <TextInput
                style={inputBase("firstName")}
                placeholder={t("signup.first_name_ph")}
                placeholderTextColor={colors.mutedForeground}
                value={firstName}
                onChangeText={(v) => { setFirstName(v); if (fieldErrors.firstName) setFieldErrors((p) => ({ ...p, firstName: undefined })); }}
                autoCapitalize="words"
                returnKeyType="next"
              />
              {fieldErrors.firstName && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.firstName}</Text>}
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.last_name")}</Text>
              <TextInput
                style={inputBase("lastName")}
                placeholder={t("signup.last_name_ph")}
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
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 1) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>{t("signup.provider.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>{t("signup.login.heading")}</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>{t("signup.login.subheading")}</Text>

          {submitError && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{submitError}</Text>
            </View>
          )}

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.email_label")}</Text>
              <TextInput
                style={inputBase("email")}
                placeholder={t("signup.email_ph")}
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
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.password_label")}</Text>
              <View style={[styles.passwordWrapper, { backgroundColor: colors.card, borderColor: fieldErrors.password ? colors.danger : colors.border }]}>
                <TextInput
                  style={[styles.passwordInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder={t("signup.password_ph")}
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
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.confirm_password_label")}</Text>
              <TextInput
                style={inputBase("confirmPassword")}
                placeholder={t("signup.confirm_password_ph")}
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
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 2) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>{t("signup.provider.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>{t("signup.company.heading")}</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.company.subheading")}
          </Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.company.name")}</Text>
              <TextInput
                style={inputBase("companyName")}
                placeholder={t("signup.company.name_ph")}
                placeholderTextColor={colors.mutedForeground}
                value={companyName}
                onChangeText={(v) => { setCompanyName(v); if (fieldErrors.companyName) setFieldErrors((p) => ({ ...p, companyName: undefined })); }}
              />
              {fieldErrors.companyName && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.companyName}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.company.reg_number")}</Text>
              <TextInput
                style={inputBase("regNumber")}
                placeholder={t("signup.company.reg_number_ph")}
                placeholderTextColor={colors.mutedForeground}
                value={regNumber}
                onChangeText={(v) => { setRegNumber(v); if (fieldErrors.regNumber) setFieldErrors((p) => ({ ...p, regNumber: undefined })); }}
                keyboardType="number-pad"
              />
              {fieldErrors.regNumber && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.regNumber}</Text>}
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.company.discipline")}</Text>
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
                <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.company.discipline_other")}</Text>
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
                  placeholder={t("signup.company.discipline_other_ph")}
                  placeholderTextColor={colors.mutedForeground}
                  value={otherDisciplineText}
                  onChangeText={(v) => { setOtherDisciplineText(v); if (fieldErrors.otherDiscipline) setFieldErrors((p) => ({ ...p, otherDiscipline: undefined })); }}
                  autoCapitalize="words"
                />
                {fieldErrors.otherDiscipline && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.otherDiscipline}</Text>}
              </View>
            )}

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.company.cert")}</Text>
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
                    <Text style={[styles.uploadBtnText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>{t("signup.company.cert_choose")}</Text>
                  </>
                )}
              </TouchableOpacity>
              <Text style={[styles.uploadHint, { color: colors.mutedForeground }]}>{t("signup.company.cert_hint")}</Text>
              {fieldErrors.cert && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.cert}</Text>}
            </View>
          </View>

          <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: ACCENT }]} onPress={goNext} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 3) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>{t("signup.provider.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>{t("signup.phone.heading_provider")}</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.phone.subheading_provider")}
          </Text>

          <View style={styles.fields}>
            <PhoneOtpStep
              accent={ACCENT}
              phone={contactNumber}
              onPhoneChange={setContactNumber}
              verified={!!phoneVerificationToken && !!verifiedPhone}
              onVerified={(token, phone) => {
                setPhoneVerificationToken(token);
                setVerifiedPhone(phone);
                setContactNumber(phone);
                setFieldErrors((p) => ({ ...p, contactNumber: undefined }));
              }}
              onUnverified={() => {
                setPhoneVerificationToken(null);
                setVerifiedPhone(null);
              }}
            />
            {fieldErrors.contactNumber && !verifiedPhone && (
              <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.contactNumber}</Text>
            )}

            <LanguagePicker
              label={t("signup.lang.primary")}
              value={primaryLanguage}
              onSelect={(v) => { setPrimaryLanguage(v); if (fieldErrors.primaryLanguage) setFieldErrors((p) => ({ ...p, primaryLanguage: undefined })); }}
              placeholder={t("signup.lang.primary_placeholder_provider")}
              required
              error={fieldErrors.primaryLanguage}
              colors={colors}
              t={t}
            />

            <LanguagePicker
              label={t("signup.lang.secondary")}
              value={secondaryLanguage}
              onSelect={setSecondaryLanguage}
              placeholder={t("signup.lang.none")}
              colors={colors}
              t={t}
            />
          </View>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { backgroundColor: ACCENT, opacity: phoneVerificationToken ? 1 : 0.5 },
            ]}
            onPress={goNext}
            activeOpacity={0.85}
            disabled={!phoneVerificationToken}
          >
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 4) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: ACCENT }]}>{t("signup.provider.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>{t("signup.address.heading")}</Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.address.subheading")}{" "}
            <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }}>{t("signup.address.optional")}</Text>
          </Text>

          <View style={styles.fields}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.address.street")}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder={t("signup.address.street_ph")}
                placeholderTextColor={colors.mutedForeground}
                value={addressStreet}
                onChangeText={setAddressStreet}
                autoCapitalize="words"
              />
            </View>

            <View style={styles.fieldRow}>
              <View style={[styles.field, { flex: 1 }]}>
                <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.address.suburb")}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder={t("signup.address.suburb_ph")}
                  placeholderTextColor={colors.mutedForeground}
                  value={addressSuburb}
                  onChangeText={setAddressSuburb}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.field, { width: 90 }]}>
                <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.address.postcode")}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                  placeholder={t("signup.address.postcode_ph")}
                  placeholderTextColor={colors.mutedForeground}
                  value={addressPostcode}
                  onChangeText={setAddressPostcode}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.address.city")}</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                placeholder={t("signup.address.city_ph")}
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
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.stepContent}>
        <Text style={[styles.stepTag, { color: ACCENT }]}>{t("signup.provider.tag")}</Text>
        <Text style={[styles.stepHeading, { color: colors.foreground }]}>{t("signup.photo.heading")}</Text>
        <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
          {t("signup.photo.subheading_provider")}{" "}
          <Text style={{ color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }}>{t("signup.photo.optional")}</Text>
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
                <Text style={[styles.avatarStepPlaceholderText, { color: colors.mutedForeground }]}>{t("signup.photo.tap_to_upload")}</Text>
              </View>
            )}
          </TouchableOpacity>
          {avatarUri && (
            <View style={styles.avatarStepActions}>
              <TouchableOpacity onPress={handlePickAvatar} activeOpacity={0.7}>
                <Text style={[styles.avatarLink, { color: ACCENT }]}>{t("signup.photo.change")}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setAvatarUri(null)} activeOpacity={0.7}>
                <Text style={[styles.avatarLink, { color: colors.mutedForeground }]}>{t("signup.photo.remove")}</Text>
              </TouchableOpacity>
            </View>
          )}
          <Text style={[styles.avatarStepHint, { color: colors.mutedForeground }]}>
            {t("signup.photo.provider_hint")}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: ACCENT, opacity: isLoading ? 0.7 : 1 }]}
          onPress={() => handleSignup()}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>{t("signup.create_account")}</Text>
              <Feather name="check" size={18} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => handleSignup({ skipAvatar: true })}
          disabled={isLoading}
          activeOpacity={0.7}
          style={styles.skipBtn}
        >
          <Text style={[styles.skipBtnText, { color: colors.mutedForeground }]}>{t("signup.photo.skip")}</Text>
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
                {t("signup.step_counter", { current: step + 1, total: TOTAL_STEPS })}
              </Text>
            </View>

            {renderStep()}

            <View style={styles.footer}>
              <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                {t("signup.have_account")}
              </Text>
              <TouchableOpacity onPress={() => router.push("/(auth)/login")}>
                <Text style={[styles.footerLink, { color: ACCENT }]}>{t("signup.sign_in")}</Text>
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
