import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

function getApiBase(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "/api";
}

function normalizePhone(raw: string): string {
  return raw.replace(/[\s\-()]/g, "").trim();
}

function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}

export interface PhoneOtpStepProps {
  accent: string;
  initialPhone?: string;
  phone: string;
  onPhoneChange: (v: string) => void;
  verified: boolean;
  onVerified: (token: string, phone: string) => void;
  onUnverified: () => void;
}

export function PhoneOtpStep({
  accent,
  phone,
  onPhoneChange,
  verified,
  onVerified,
  onUnverified,
}: PhoneOtpStepProps) {
  const colors = useColors();
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startResendCountdown = (seconds: number) => {
    setResendIn(seconds);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    setError(null);
    setInfo(null);
    const normalized = normalizePhone(phone);
    if (!isValidE164(normalized)) {
      setError("Enter a valid number in international format (e.g. +6421...)");
      return;
    }
    setSending(true);
    try {
      const resp = await fetch(`${getApiBase()}/auth/send-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized }),
      });
      const json = (await resp.json()) as {
        verificationId?: string;
        error?: string;
        expiresInSeconds?: number;
      };
      if (!resp.ok || !json.verificationId) {
        setError(json.error ?? "Failed to send code");
        return;
      }
      setVerificationId(json.verificationId);
      setInfo(`Code sent to ${normalized}. Check your messages.`);
      setCode("");
      onUnverified();
      startResendCountdown(30);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send code");
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    setError(null);
    setInfo(null);
    if (!verificationId) {
      setError("Please request a code first.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your SMS.");
      return;
    }
    setVerifying(true);
    try {
      const normalized = normalizePhone(phone);
      const resp = await fetch(`${getApiBase()}/auth/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verificationId, phone: normalized, code: code.trim() }),
      });
      const json = (await resp.json()) as { token?: string; phone?: string; error?: string };
      if (!resp.ok || !json.token) {
        setError(json.error ?? "Could not verify code");
        return;
      }
      onVerified(json.token, json.phone ?? normalized);
      setInfo("Phone number verified.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not verify code");
    } finally {
      setVerifying(false);
    }
  };

  const phoneEditable = !verified;
  const canVerify = !!verificationId && !verified;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: colors.foreground }]}>Phone number *</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            style={[
              styles.input,
              {
                flex: 1,
                backgroundColor: colors.card,
                borderColor: error ? colors.danger : verified ? colors.success : colors.border,
                color: colors.foreground,
                opacity: phoneEditable ? 1 : 0.7,
              },
            ]}
            value={phone}
            onChangeText={(v) => {
              onPhoneChange(v);
              if (verified) {
                onUnverified();
                setVerificationId(null);
                setCode("");
              }
              if (error) setError(null);
            }}
            placeholder="+64 21 123 4567"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="phone-pad"
            autoComplete="tel"
            editable={phoneEditable}
          />
          {verified ? (
            <View
              style={[
                styles.sendBtn,
                { backgroundColor: colors.success + "20", borderColor: colors.success },
              ]}
            >
              <Feather name="check" size={18} color={colors.success} />
            </View>
          ) : (
            <TouchableOpacity
              onPress={sendCode}
              disabled={sending}
              activeOpacity={0.85}
              style={[
                styles.sendBtn,
                { backgroundColor: accent, opacity: sending ? 0.7 : 1 },
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>
                  {verificationId ? "Resend" : "Send code"}
                </Text>
              )}
            </TouchableOpacity>
          )}
        </View>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Include your country code (e.g. +64 for New Zealand).
        </Text>
      </View>

      {canVerify && (
        <View style={{ gap: 6 }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Verification code</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TextInput
              style={[
                styles.input,
                {
                  flex: 1,
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                  color: colors.foreground,
                  letterSpacing: 6,
                  textAlign: "center",
                  fontSize: 18,
                },
              ]}
              value={code}
              onChangeText={(v) => {
                setCode(v.replace(/\D/g, "").slice(0, 6));
                if (error) setError(null);
              }}
              placeholder="• • • • • •"
              placeholderTextColor={colors.mutedForeground}
              keyboardType="number-pad"
              maxLength={6}
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
            />
            <TouchableOpacity
              onPress={verifyCode}
              disabled={verifying || code.length !== 6}
              activeOpacity={0.85}
              style={[
                styles.sendBtn,
                {
                  backgroundColor: accent,
                  opacity: verifying || code.length !== 6 ? 0.6 : 1,
                },
              ]}
            >
              {verifying ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.sendBtnText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
          {resendIn > 0 ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              You can request a new code in {resendIn}s.
            </Text>
          ) : (
            <TouchableOpacity onPress={sendCode} disabled={sending}>
              <Text style={[styles.hint, { color: accent }]}>Didn't get it? Send again</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {error && (
        <View
          style={[
            styles.banner,
            { backgroundColor: colors.danger + "18", borderColor: colors.danger + "40" },
          ]}
        >
          <Feather name="alert-circle" size={15} color={colors.danger} />
          <Text style={[styles.bannerText, { color: colors.danger }]}>{error}</Text>
        </View>
      )}
      {info && !error && (
        <View
          style={[
            styles.banner,
            {
              backgroundColor: (verified ? colors.success : accent) + "15",
              borderColor: (verified ? colors.success : accent) + "40",
            },
          ]}
        >
          <Feather
            name={verified ? "check-circle" : "info"}
            size={15}
            color={verified ? colors.success : accent}
          />
          <Text style={[styles.bannerText, { color: verified ? colors.success : accent }]}>
            {info}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontFamily: "DM_Sans_500Medium" },
  input: {
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    fontSize: 15,
    fontFamily: "DM_Sans_400Regular",
  },
  sendBtn: {
    height: 52,
    minWidth: 92,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  sendBtnText: { color: "#fff", fontSize: 14, fontFamily: "DM_Sans_600SemiBold" },
  hint: { fontSize: 12, fontFamily: "DM_Sans_400Regular", lineHeight: 16 },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 13, fontFamily: "DM_Sans_400Regular", lineHeight: 18 },
});
