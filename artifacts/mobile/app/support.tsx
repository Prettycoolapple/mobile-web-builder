import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/context/AuthContext";
import { getApiBase } from "@/lib/api";

export default function SupportScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useT();
  const { user, getApiHeaders } = useAuth();

  const [email, setEmail] = useState(user?.email ?? "");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();

    if (!trimmedEmail) {
      setError(t("support.error_empty_email"));
      return;
    }
    if (!trimmedMessage) {
      setError(t("support.error_empty_message"));
      return;
    }

    setError(null);
    setSending(true);
    Keyboard.dismiss();

    try {
      const base = getApiBase();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const authHeaders = getApiHeaders();
        Object.assign(headers, authHeaders);
      } catch {
        // not logged in — plain request is fine
      }

      const resp = await fetch(`${base}/support`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: trimmedEmail,
          phone: phone.trim() || undefined,
          message: trimmedMessage,
        }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Send failed");
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowSuccess(true);
    } catch {
      setError(t("support.error_send"));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 10,
            backgroundColor: colors.headerBg,
            borderBottomColor: colors.accent + "22",
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} style={styles.backBtn}>
          <Feather name="arrow-left" size={20} color="rgba(250,249,246,0.85)" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: "rgba(250,249,246,0.95)", fontFamily: "SpaceGrotesk_700Bold" }]}>
          {t("support.title")}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
          {t("support.subtitle")}
        </Text>

        {/* ── Email ── */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
            {t("support.email_label")}
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: "DM_Sans_400Regular",
              },
            ]}
            placeholder={t("support.email_ph")}
            placeholderTextColor={colors.mutedForeground}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ── Phone ── */}
        <View style={styles.fieldGroup}>
          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
              {t("support.phone_label")}
            </Text>
            <Text style={[styles.optional, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("support.phone_optional")}
            </Text>
          </View>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: "DM_Sans_400Regular",
              },
            ]}
            placeholder={t("support.phone_ph")}
            placeholderTextColor={colors.mutedForeground}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />
        </View>

        {/* ── Message ── */}
        <View style={styles.fieldGroup}>
          <Text style={[styles.label, { color: colors.foreground, fontFamily: "DM_Sans_500Medium" }]}>
            {t("support.message_label")}
          </Text>
          <TextInput
            style={[
              styles.textarea,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                color: colors.foreground,
                fontFamily: "DM_Sans_400Regular",
              },
            ]}
            placeholder={t("support.message_ph")}
            placeholderTextColor={colors.mutedForeground}
            value={message}
            onChangeText={setMessage}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* ── Error ── */}
        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.danger + "15", borderColor: colors.danger + "40" }]}>
            <Feather name="alert-circle" size={14} color={colors.danger} />
            <Text style={[styles.errorText, { color: colors.danger, fontFamily: "DM_Sans_400Regular" }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {/* ── Submit ── */}
        <TouchableOpacity
          style={[
            styles.submitBtn,
            { backgroundColor: colors.accent },
            sending && { opacity: 0.7 },
          ]}
          onPress={handleSubmit}
          disabled={sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="send" size={16} color="#fff" />
              <Text style={[styles.submitText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                {t("support.submit")}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>

      {/* ── Success Modal ── */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.successIcon, { backgroundColor: colors.success + "20" }]}>
              <Feather name="check-circle" size={32} color={colors.success} />
            </View>
            <Text style={[styles.successTitle, { color: colors.foreground, fontFamily: "DM_Sans_700Bold" }]}>
              {t("support.success_title")}
            </Text>
            <Text style={[styles.successBody, { color: colors.mutedForeground, fontFamily: "DM_Sans_400Regular" }]}>
              {t("support.success_body")}
            </Text>
            <TouchableOpacity
              style={[styles.doneBtn, { backgroundColor: colors.accent }]}
              onPress={() => {
                setShowSuccess(false);
                router.back();
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.doneText, { fontFamily: "DM_Sans_600SemiBold" }]}>
                {t("support.success_done")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, alignItems: "flex-start" },
  headerTitle: { flex: 1, fontSize: 17, textAlign: "center", letterSpacing: -0.4 },
  content: { padding: 20, gap: 0 },
  subtitle: { fontSize: 14, lineHeight: 21, marginBottom: 24 },
  fieldGroup: { marginBottom: 18 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  label: { fontSize: 14, marginBottom: 8 },
  optional: { fontSize: 12 },
  input: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textarea: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 140,
    lineHeight: 22,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 4,
  },
  submitText: { color: "#fff", fontSize: 16 },
  // Success modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 12,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: { fontSize: 20, textAlign: "center", letterSpacing: -0.3 },
  successBody: { fontSize: 14, lineHeight: 21, textAlign: "center" },
  doneBtn: {
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 36,
    marginTop: 8,
  },
  doneText: { color: "#fff", fontSize: 15 },
});
