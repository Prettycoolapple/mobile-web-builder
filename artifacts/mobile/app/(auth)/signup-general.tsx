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
  Modal,
  FlatList,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth, ApiError } from "@/context/AuthContext";
import * as ImagePicker from "expo-image-picker";
import { PhoneOtpStep } from "@/components/PhoneOtpStep";
import { useT, isOSChineseLocale } from "@/lib/i18n";
import { languageDisplayName } from "@/lib/languages";

const ALL_LANGUAGES = [
  "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani",
  "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Catalan",
  "Cebuano", "Chinese (Cantonese)", "Chinese (Mandarin)", "Croatian", "Czech",
  "Danish", "Dutch", "English", "Esperanto", "Estonian", "Filipino",
  "Finnish", "French", "Galician", "Georgian", "German", "Greek",
  "Gujarati", "Haitian Creole", "Hausa", "Hawaiian", "Hebrew", "Hindi",
  "Hmong", "Hungarian", "Icelandic", "Igbo", "Indonesian", "Irish",
  "Italian", "Japanese", "Javanese", "Kannada", "Kazakh", "Khmer",
  "Korean", "Kurdish", "Kyrgyz", "Lao", "Latin", "Latvian",
  "Lithuanian", "Luxembourgish", "Macedonian", "Malagasy", "Malay",
  "Malayalam", "Maltese", "Māori", "Marathi", "Mongolian", "Myanmar (Burmese)",
  "Nepali", "Norwegian", "Nyanja", "Odia", "Pashto", "Persian",
  "Polish", "Portuguese", "Punjabi", "Romanian", "Russian", "Samoan",
  "Scottish Gaelic", "Serbian", "Sesotho", "Shona", "Sindhi", "Sinhala",
  "Slovak", "Slovenian", "Somali", "Spanish", "Sundanese", "Swahili",
  "Swedish", "Tajik", "Tamil", "Tatar", "Telugu", "Thai",
  "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur", "Uzbek",
  "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu",
  "Tagalog", "Other",
];

const TOTAL_STEPS = 5;

interface FieldErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  password?: string;
  confirmPassword?: string;
  language?: string;
  phone?: string;
}

export default function SignupGeneralScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signUp, uploadProfilePicture, refreshProfile } = useAuth();
  const { width: SCREEN_W } = useWindowDimensions();
  const { t } = useT();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState("");
  const [languagePickerOpen, setLanguagePickerOpen] = useState(false);
  const [languageSearch, setLanguageSearch] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [avatarMimeType, setAvatarMimeType] = useState("image/jpeg");
  const [phoneNumber, setPhoneNumber] = useState("+64 ");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState<string | null>(null);
  const [verifiedPhone, setVerifiedPhone] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [step, setStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const osChinese = isOSChineseLocale();
  const searchQ = languageSearch.toLowerCase();
  const filteredLanguages = ALL_LANGUAGES.filter((l) => {
    const display = languageDisplayName(l, osChinese);
    return l.toLowerCase().includes(searchQ) || display.toLowerCase().includes(searchQ);
  });

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
      if (!phoneVerificationToken || !verifiedPhone) {
        errors.phone = t("signup.error.phone_verify");
      }
    } else if (step === 3) {
      if (!language) errors.language = t("signup.error.language");
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

  const handlePickAvatar = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
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
    }
  };

  const handleSignup = async () => {
    if (!validateStep()) return;
    setSubmitError(null);
    setIsLoading(true);
    try {
      if (!phoneVerificationToken || !verifiedPhone) {
        setFieldErrors({ phone: t("signup.error.phone_verify") });
        setStep(2);
        return;
      }
      const { token: newToken } = await signUp({
        role: "general",
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        languages: language ? [language] : [],
        phoneNumber: verifiedPhone,
        phoneVerificationToken,
      });

      if (avatarUri) {
        try {
          const ext = avatarUri.split(".").pop() ?? "jpg";
          await uploadProfilePicture(avatarUri, avatarMimeType, `avatar.${ext}`, newToken);
          await refreshProfile().catch(() => {});
        } catch {
        }
      }

      router.replace("/(tabs)");
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        const mapped: FieldErrors = {};
        for (const issue of err.details) {
          const key = issue.path[0];
          if (key === "firstName") mapped.firstName = issue.message;
          else if (key === "lastName") mapped.lastName = issue.message;
          else if (key === "email") mapped.email = issue.message;
          else if (key === "password") mapped.password = issue.message;
        }
        if (Object.keys(mapped).length > 0) {
          setFieldErrors(mapped);
          if (mapped.email || mapped.password || mapped.confirmPassword) setStep(1);
          else if (mapped.firstName || mapped.lastName) setStep(0);
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
          <Text style={[styles.stepTag, { color: colors.accent }]}>{t("signup.general.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>
            {t("signup.name.heading")}
          </Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.name.subheading_general")}
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

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 1) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: colors.accent }]}>{t("signup.general.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>
            {t("signup.login.heading")}
          </Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.login.subheading")}
          </Text>

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

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={goNext}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>{t("signup.continue")}</Text>
            <Feather name="arrow-right" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 2) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: colors.accent }]}>{t("signup.general.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>
            {t("signup.phone.heading_general")}
          </Text>
          <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
            {t("signup.phone.subheading_general")}
          </Text>

          {fieldErrors.phone && !verifiedPhone && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{fieldErrors.phone}</Text>
            </View>
          )}

          <PhoneOtpStep
            accent={colors.accent}
            phone={phoneNumber}
            onPhoneChange={setPhoneNumber}
            verified={!!phoneVerificationToken && !!verifiedPhone}
            onVerified={(token, phone) => {
              setPhoneVerificationToken(token);
              setVerifiedPhone(phone);
              setFieldErrors((p) => ({ ...p, phone: undefined }));
            }}
            onUnverified={() => {
              setPhoneVerificationToken(null);
              setVerifiedPhone(null);
            }}
          />

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              { backgroundColor: colors.accent, opacity: phoneVerificationToken ? 1 : 0.5 },
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

    if (step === 3) {
      return (
        <View style={styles.stepContent}>
          <Text style={[styles.stepTag, { color: colors.accent }]}>{t("signup.general.tag")}</Text>
          <Text style={[styles.stepHeading, { color: colors.foreground }]}>
            {t("signup.lang.heading_general")}
          </Text>

          {submitError && (
            <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={[styles.errorText, { color: colors.danger }]}>{submitError}</Text>
            </View>
          )}

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.foreground }]}>{t("signup.lang.primary")}</Text>
            <TouchableOpacity
              style={[
                styles.dropdownBtn,
                {
                  backgroundColor: colors.card,
                  borderColor: fieldErrors.language ? colors.danger : colors.border,
                },
              ]}
              onPress={() => { setLanguageSearch(""); setLanguagePickerOpen(true); }}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.dropdownBtnText,
                { color: language ? colors.foreground : colors.mutedForeground, fontFamily: "DM_Sans_400Regular" },
              ]}>
                {language ? languageDisplayName(language, osChinese) : t("signup.lang.select_placeholder")}
              </Text>
              <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
            {fieldErrors.language && <Text style={[styles.fieldError, { color: colors.danger }]}>{fieldErrors.language}</Text>}
          </View>

          <Modal
            visible={languagePickerOpen}
            animationType="slide"
            transparent
            onRequestClose={() => setLanguagePickerOpen(false)}
          >
            <KeyboardAvoidingView
              style={styles.modalOverlay}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <View style={[styles.modalSheet, { backgroundColor: colors.background }]}>
                <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
                  <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "DM_Sans_600SemiBold" }]}>
                    {t("signup.lang.modal_title")}
                  </Text>
                  <TouchableOpacity onPress={() => setLanguagePickerOpen(false)} style={styles.modalCloseBtn}>
                    <Feather name="x" size={20} color={colors.foreground} />
                  </TouchableOpacity>
                </View>
                <View style={[styles.searchRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="search" size={16} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.searchInput, { color: colors.foreground, fontFamily: "DM_Sans_400Regular" }]}
                    placeholder={t("signup.lang.modal_search")}
                    placeholderTextColor={colors.mutedForeground}
                    value={languageSearch}
                    onChangeText={setLanguageSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {languageSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setLanguageSearch("")}>
                      <Feather name="x-circle" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>
                <FlatList
                  data={filteredLanguages}
                  keyExtractor={(item) => item}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.languageItem,
                        { borderBottomColor: colors.border },
                        item === language && { backgroundColor: colors.accent + "15" },
                      ]}
                      onPress={() => {
                        setLanguage(item);
                        if (fieldErrors.language) setFieldErrors((p) => ({ ...p, language: undefined }));
                        setLanguagePickerOpen(false);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.languageItemText,
                        { color: item === language ? colors.accent : colors.foreground, fontFamily: "DM_Sans_400Regular" },
                        item === language && { fontFamily: "DM_Sans_600SemiBold" },
                      ]}>
                        {languageDisplayName(item, osChinese)}
                      </Text>
                      {item === language && <Feather name="check" size={16} color={colors.accent} />}
                    </TouchableOpacity>
                  )}
                />
              </View>
            </KeyboardAvoidingView>
          </Modal>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
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
        <Text style={[styles.stepTag, { color: colors.accent }]}>{t("signup.general.tag")}</Text>
        <Text style={[styles.stepHeading, { color: colors.foreground }]}>
          {t("signup.photo.heading")}
        </Text>
        <Text style={[styles.stepSubheading, { color: colors.mutedForeground }]}>
          {t("signup.photo.subheading_general")}
        </Text>

        {submitError && (
          <View style={[styles.errorBanner, { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" }]}>
            <Feather name="alert-circle" size={15} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger }]}>{submitError}</Text>
          </View>
        )}

        <TouchableOpacity style={styles.avatarPickerWrap} onPress={handlePickAvatar} activeOpacity={0.8}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatarPreview} />
          ) : (
            <View style={[styles.avatarPlaceholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="camera" size={32} color={colors.mutedForeground} />
              <Text style={[styles.avatarPlaceholderText, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
                {t("signup.photo.tap_to_upload")}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {avatarUri && (
          <TouchableOpacity style={styles.changePhotoBtn} onPress={handlePickAvatar} activeOpacity={0.7}>
            <Feather name="refresh-cw" size={14} color={colors.accent} />
            <Text style={[styles.changePhotoText, { color: colors.accent, fontFamily: "DM_Sans_500Medium" }]}>
              {t("signup.photo.change")}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.accent, opacity: isLoading ? 0.7 : 1 }]}
          onPress={handleSignup}
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
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.progressTrack, { marginTop: insets.top, backgroundColor: colors.border }]}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(((step + 1) / TOTAL_STEPS) * 100)}%`, backgroundColor: colors.accent },
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
                <Text style={[styles.footerLink, { color: colors.accent }]}>{t("signup.sign_in")}</Text>
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
  primaryBtn: {
    height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center",
    flexDirection: "row", gap: 8, marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontSize: 16, fontFamily: "DM_Sans_600SemiBold" },
  footer: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 28 },
  footerText: { fontSize: 14, fontFamily: "DM_Sans_400Regular" },
  footerLink: { fontSize: 14, fontFamily: "DM_Sans_600SemiBold" },
  dropdownBtn: {
    height: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 16,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  dropdownBtnText: { fontSize: 15, flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", paddingBottom: 24 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  modalTitle: { fontSize: 17 },
  modalCloseBtn: { padding: 4 },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 16, marginVertical: 12,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, height: 44,
  },
  searchInput: { flex: 1, fontSize: 15, height: "100%" },
  languageItem: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  languageItemText: { fontSize: 15 },
  avatarPickerWrap: { alignItems: "center", marginVertical: 8 },
  avatarPreview: { width: 120, height: 120, borderRadius: 60 },
  avatarPlaceholder: {
    width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderStyle: "dashed",
    alignItems: "center", justifyContent: "center", gap: 8,
  },
  avatarPlaceholderText: { fontSize: 13 },
  changePhotoBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  changePhotoText: { fontSize: 14 },
});
