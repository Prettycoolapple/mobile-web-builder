import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { loginRevenueCat, logoutRevenueCat, getSubscriptionSyncBody, IS_TEST_PAYMENT_MODE } from "@/lib/revenuecat";
import { getApiBase } from "@/lib/api";
import { getCurrentLocale, isOSChineseLocale } from "@/lib/i18n";

/** Avoid opaque "JSON Parse error" when the API returns HTML or plain text (e.g. Vercel error page). */
async function readResponseJson(resp: Response): Promise<unknown> {
  const text = await resp.text();
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const preview = trimmed.replace(/\s+/g, " ").slice(0, 200);
    throw new Error(
      `Server returned non-JSON (${resp.status}): ${preview}${trimmed.length > 200 ? "…" : ""}`,
    );
  }
}

export type UserRole = "general" | "sales_agent" | "service_provider";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  languages: string[];
  subscriptionTier: string;
  /** ISO date from API; when set for paid tiers, usage period aligns with store renewal. */
  subscriptionPeriodEndAt?: string | null;
  reportsUsedThisMonth: number;
  messagesUsedThisMonth?: number;
  avatarUrl?: string | null;
  isVerified?: boolean;
  discipline?: string | null;
}

export type ProviderDiscipline =
  | "architect_designer"
  | "planner"
  | "engineer"
  | "quantity_surveyor"
  | "other";

export interface GeneralSignUpData {
  role: "general";
  firstName?: string;
  lastName?: string;
  email: string;
  password: string;
  languages?: string[];
  phoneNumber: string;
  phoneVerificationToken: string;
}

export interface AgentSignUpData {
  role: "sales_agent";
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  languages?: string[];
  phoneNumber: string;
  phoneVerificationToken: string;
  agentData: {
    agencyName?: string;
    reaaLicenceNumber?: string;
    yearsExperience?: number;
    regionsCovered?: string[];
    propertyTypes?: string[];
    websiteUrl?: string;
    bio?: string;
  };
}

export interface ProviderSignUpData {
  role: "service_provider";
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  languages?: string[];
  phoneNumber: string;
  phoneVerificationToken: string;
  providerData: {
    companyName?: string;
    nzCompanyRegisterNumber?: string;
    discipline?: ProviderDiscipline;
    otherDiscipline?: string;
    addressStreet?: string;
    addressSuburb?: string;
    addressCity?: string;
    addressPostcode?: string;
    contactNumber?: string;
    incorporationCertUrl?: string;
    primaryLanguage?: string;
    secondaryLanguage?: string;
    avatarUrl?: string;
  };
}

export type SignUpData = GeneralSignUpData | AgentSignUpData | ProviderSignUpData;

interface ReactNativeFileBlob {
  uri: string;
  type: string;
  name: string;
}

interface ProfilePictureSignedUrlResponse {
  uploadURL: string;
  objectPath: string;
  fileUrl: string;
  requiredHeaders?: {
    "Content-Type"?: string;
  };
}

interface CertificateSignedUrlResponse extends ProfilePictureSignedUrlResponse {}

function normalizeAvatarContentType(mimeType: string): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return "image/jpeg";
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

function extensionForAvatarContentType(contentType: string, fallbackName: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/heic") return "heic";
  if (contentType === "image/heif") return "heif";
  return fallbackName.split(".").pop()?.split("?")[0] || "jpg";
}

function normalizeUploadContentType(mimeType: string, fallback = "application/octet-stream"): string {
  const normalized = mimeType.split(";")[0]?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

export interface ApiValidationIssue {
  path: string[];
  message: string;
}

export class ApiError extends Error {
  code: string;
  details?: ApiValidationIssue[];
  constructor(message: string, code = "UNKNOWN", details?: ApiValidationIssue[]) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  // True only when the RevenueCat identity has finished switching to the
  // currently-signed-in user (or there is no user). Use this to gate any
  // subscription read/write so we never act on a stale previous identity.
  isSubscriptionIdentityReady: boolean;
  signUp: (data: SignUpData) => Promise<{ token: string }>;
  signIn: (email: string, password: string) => Promise<UserProfile>;
  requestPasswordReset: (email: string) => Promise<void>;
  resetPassword: (email: string, code: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: (tokenOverride?: string) => Promise<void>;
  getApiHeaders: () => Record<string, string>;
  uploadIncorporationCert: (
    fileUri: string,
    mimeType: string,
    fileName: string,
    tokenOverride?: string,
  ) => Promise<{ objectPath: string; fileUrl: string }>;
  uploadIncorporationCertPreSignup: (
    fileUri: string,
    mimeType: string,
    fileName: string,
  ) => Promise<{ objectPath: string; fileUrl: string }>;
  updateServiceProviderCert: (fileUrl: string, tokenOverride?: string) => Promise<void>;
  uploadProfilePicture: (
    fileUri: string,
    mimeType: string,
    fileName: string,
    tokenOverride?: string,
  ) => Promise<{ fileUrl: string }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY_TOKEN = "@devfeasible/auth_token";
const STORAGE_KEY_USER = "@devfeasible/auth_user";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscriptionIdentityReady, setIsSubscriptionIdentityReady] = useState(false);
  /** Throttle repair sync when paid tier is missing `subscriptionPeriodEndAt` (e.g. legacy row or failed sync). */
  const lastSubscriptionPeriodRepairAtRef = useRef<{ userId: string; at: number } | null>(null);

  // Wipe RevenueCat customer-info / offerings cache so the next user never
  // sees the previous user's subscription state.
  const resetSubscriptionCache = useCallback(() => {
    queryClient.removeQueries({ queryKey: ["revenuecat"] });
  }, [queryClient]);

  // Fully switch the RC identity to `userId` and only then mark the identity
  // as ready. Anything subscription-related must be gated on this flag so a
  // stale previous identity can never be read or written.
  const switchRevenueCatIdentity = useCallback(async (userId: string | null) => {
    setIsSubscriptionIdentityReady(false);
    resetSubscriptionCache();
    try {
      if (userId) {
        await loginRevenueCat(userId);
      } else {
        await logoutRevenueCat();
      }
    } finally {
      setIsSubscriptionIdentityReady(true);
    }
  }, [resetSubscriptionCache]);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_TOKEN),
          AsyncStorage.getItem(STORAGE_KEY_USER),
        ]);
        if (storedToken && storedUser) {
          const profile = JSON.parse(storedUser) as UserProfile;
          setToken(storedToken);
          setUser(profile);
          // Restore RevenueCat identity so the device subscription is tied to
          // this user — must complete before any subscription read.
          await switchRevenueCatIdentity(profile.id);
        } else {
          await switchRevenueCatIdentity(null);
        }
      } catch {
        await switchRevenueCatIdentity(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [switchRevenueCatIdentity]);

  const refreshProfile = useCallback(async (tokenOverride?: string) => {
    const activeToken = tokenOverride ?? token;
    if (!activeToken) return;
    try {
      const resp = await fetch(`${getApiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      if (resp.ok) {
        const data = (await readResponseJson(resp)) as { user: UserProfile & { role?: UserRole; languages?: string[] } };
        const profile: UserProfile = {
          ...data.user,
          role: data.user.role ?? "general",
          languages: data.user.languages ?? [],
        };
        setUser(profile);
        await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(profile));
      }
    } catch {
    }
  }, [token]);

  useEffect(() => {
    if (!token || !user?.id || !isSubscriptionIdentityReady || IS_TEST_PAYMENT_MODE) return;
    const paid = user.subscriptionTier === "pro" || user.subscriptionTier === "standard";
    if (!paid || user.subscriptionPeriodEndAt) return;

    const now = Date.now();
    const last = lastSubscriptionPeriodRepairAtRef.current;
    if (last?.userId === user.id && now - last.at < 60_000) return;
    lastSubscriptionPeriodRepairAtRef.current = { userId: user.id, at: now };

    void (async () => {
      try {
        const body = await getSubscriptionSyncBody("pro");
        const resp = await fetch(`${getApiBase()}/subscription/sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });
        if (resp.ok) await refreshProfile();
      } catch {
      }
    })();
  }, [token, user?.id, user?.subscriptionTier, user?.subscriptionPeriodEndAt, isSubscriptionIdentityReady, refreshProfile]);

  const persistAuth = useCallback(async (newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_TOKEN, newToken),
      AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(newUser)),
    ]);
  }, []);

  const persistAvatarUrl = useCallback((fileUrl: string) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, avatarUrl: fileUrl };
      void AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(next));
      return next;
    });
  }, []);

  const signUp = useCallback(async (data: SignUpData): Promise<{ token: string }> => {
    const resp = await fetch(`${getApiBase()}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = (await readResponseJson(resp)) as {
      token: string;
      user: UserProfile & { role?: UserRole; languages?: string[] };
      error?: string;
      code?: string;
      details?: ApiValidationIssue[];
    };
    if (!resp.ok) throw new ApiError(json.error ?? "Signup failed", json.code ?? "UNKNOWN", json.details);
    const profile: UserProfile = {
      ...json.user,
      role: json.user.role ?? "general",
      languages: json.user.languages ?? [],
    };
    await persistAuth(json.token, profile);
    // Drop any cached subscription data from a previous user and wait for the
    // RevenueCat identity switch to fully complete before returning.
    await switchRevenueCatIdentity(profile.id);
    return { token: json.token };
  }, [persistAuth, switchRevenueCatIdentity]);

  const signIn = useCallback(async (email: string, password: string): Promise<UserProfile> => {
    const resp = await fetch(`${getApiBase()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = (await readResponseJson(resp)) as { token: string; user: UserProfile & { role?: UserRole; languages?: string[] }; error?: string };
    if (!resp.ok) throw new Error(data.error ?? "Login failed");
    const profile: UserProfile = {
      ...data.user,
      role: data.user.role ?? "general",
      languages: data.user.languages ?? [],
    };
    await persistAuth(data.token, profile);
    // Drop any cached subscription data from a previous user and wait for the
    // RevenueCat identity switch to fully complete before returning.
    await switchRevenueCatIdentity(profile.id);
    return profile;
  }, [persistAuth, switchRevenueCatIdentity]);

  const requestPasswordReset = useCallback(async (email: string): Promise<void> => {
    const resp = await fetch(`${getApiBase()}/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = (await readResponseJson(resp)) as { error?: string };
    if (!resp.ok) throw new Error(data.error ?? "Could not send reset code");
  }, []);

  const resetPassword = useCallback(async (
    email: string,
    code: string,
    password: string,
  ): Promise<void> => {
    const resp = await fetch(`${getApiBase()}/auth/password-reset/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password }),
    });
    const data = (await readResponseJson(resp)) as { error?: string };
    if (!resp.ok) throw new Error(data.error ?? "Could not reset password");
  }, []);

  const signOut = useCallback(async () => {
    lastSubscriptionPeriodRepairAtRef.current = null;
    setToken(null);
    setUser(null);
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEY_TOKEN),
      AsyncStorage.removeItem(STORAGE_KEY_USER),
    ]);
    // Wipe cached subscription state and release the RevenueCat identity so
    // the next user starts with a completely clean slate.
    await switchRevenueCatIdentity(null);
  }, [switchRevenueCatIdentity]);

  const getApiHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
    const locale = getCurrentLocale();
    headers["Accept-Language"] = locale === "zh" ? "zh-CN" : "en-NZ";
    headers["X-Locale"] = locale;
    headers["X-OS-Chinese"] = isOSChineseLocale() ? "1" : "0";
    return headers;
  }, [token]);

  const uploadIncorporationCert = useCallback(async (
    fileUri: string,
    mimeType: string,
    fileName: string,
    tokenOverride?: string,
  ): Promise<{ objectPath: string; fileUrl: string }> => {
    const activeToken = tokenOverride ?? token;
    if (!activeToken) throw new Error("Not authenticated");
    const formData = new FormData();
    const fileBlob: ReactNativeFileBlob = { uri: fileUri, type: mimeType, name: fileName };
    formData.append("file", fileBlob as unknown as Blob);
    const resp = await fetch(`${getApiBase()}/upload/incorporation-cert`, {
      method: "POST",
      headers: { Authorization: `Bearer ${activeToken}` },
      body: formData,
    });
    const json = (await resp.json()) as { objectPath: string; fileUrl: string; error?: string };
    if (!resp.ok) throw new Error(json.error ?? "Upload failed");
    return { objectPath: json.objectPath, fileUrl: json.fileUrl };
  }, [token]);

  const uploadIncorporationCertPreSignup = useCallback(async (
    fileUri: string,
    mimeType: string,
    fileName: string,
  ): Promise<{ objectPath: string; fileUrl: string }> => {
    const contentType = normalizeUploadContentType(mimeType, "application/pdf");
    const legacyUpload = async (): Promise<{ objectPath: string; fileUrl: string }> => {
      const formData = new FormData();
      const fileBlob: ReactNativeFileBlob = { uri: fileUri, type: contentType, name: fileName };
      formData.append("file", fileBlob as unknown as Blob);
      const resp = await fetch(`${getApiBase()}/upload/incorporation-cert-pre-signup`, {
        method: "POST",
        body: formData,
      });
      const json = (await readResponseJson(resp)) as { objectPath: string; fileUrl: string; error?: string };
      if (!resp.ok) throw new Error(json.error ?? "Upload failed");
      return { objectPath: json.objectPath, fileUrl: json.fileUrl };
    };

    try {
      const localInfo = await FileSystem.getInfoAsync(fileUri);
      if (!localInfo.exists || localInfo.isDirectory || !localInfo.size) {
        throw new Error("Could not read local file");
      }

      const signResp = await fetch(`${getApiBase()}/upload/incorporation-cert-pre-signup/request-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fileName,
          size: localInfo.size,
          contentType,
        }),
      });
      const signJson = (await readResponseJson(signResp)) as CertificateSignedUrlResponse & { error?: string; code?: string };
      if (!signResp.ok) {
        throw new ApiError(signJson.error ?? "Could not prepare upload", signJson.code ?? "SIGN_URL_FAILED");
      }

      const signedContentType = signJson.requiredHeaders?.["Content-Type"] ?? contentType;
      const uploadResult = await FileSystem.uploadAsync(signJson.uploadURL, fileUri, {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: {
          "Content-Type": signedContentType,
        },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error("Upload failed");
      }

      return { objectPath: signJson.objectPath, fileUrl: signJson.fileUrl };
    } catch (signedError) {
      if (signedError instanceof ApiError) {
        if (["INVALID_NAME", "INVALID_SIZE", "INVALID_FILE_TYPE"].includes(signedError.code)) {
          throw signedError;
        }
      }
      return legacyUpload();
    }
  }, []);

  const updateServiceProviderCert = useCallback(async (
    fileUrl: string,
    tokenOverride?: string,
  ): Promise<void> => {
    const activeToken = tokenOverride ?? token;
    if (!activeToken) throw new Error("Not authenticated");
    const resp = await fetch(`${getApiBase()}/auth/service-provider/cert`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${activeToken}`,
      },
      body: JSON.stringify({ incorporationCertUrl: fileUrl }),
    });
    if (!resp.ok) {
      const json = (await resp.json()) as { error?: string };
      throw new Error(json.error ?? "Failed to update certificate");
    }
  }, [token]);

  const uploadProfilePicture = useCallback(async (
    fileUri: string,
    mimeType: string,
    fileName: string,
    tokenOverride?: string,
  ): Promise<{ fileUrl: string }> => {
    const activeToken = tokenOverride ?? token;
    if (!activeToken) throw new Error("Not authenticated");
    const contentType = normalizeAvatarContentType(mimeType);
    const normalizedFileName = fileName.includes(".")
      ? fileName
      : `avatar.${extensionForAvatarContentType(contentType, fileName)}`;
    const legacyUpload = async (): Promise<{ fileUrl: string }> => {
      const formData = new FormData();
      const fileBlob: ReactNativeFileBlob = { uri: fileUri, type: contentType, name: normalizedFileName };
      formData.append("file", fileBlob as unknown as Blob);
      const resp = await fetch(`${getApiBase()}/upload/profile-picture`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
        body: formData,
      });
      const json = (await readResponseJson(resp)) as { fileUrl: string; error?: string };
      if (!resp.ok) throw new Error(json.error ?? "Upload failed");
      return { fileUrl: json.fileUrl };
    };

    try {
      const localInfo = await FileSystem.getInfoAsync(fileUri);
      if (!localInfo.exists || localInfo.isDirectory || !localInfo.size) {
        throw new Error("Could not read local image file");
      }

      const signResp = await fetch(`${getApiBase()}/upload/profile-picture/request-url`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({
          name: normalizedFileName,
          size: localInfo.size,
          contentType,
        }),
      });
      const signJson = (await readResponseJson(signResp)) as ProfilePictureSignedUrlResponse & { error?: string };
      if (!signResp.ok) {
        throw new Error(signJson.error ?? "Failed to request upload URL");
      }

      const signedContentType = signJson.requiredHeaders?.["Content-Type"] ?? contentType;
      const uploadResult = await FileSystem.uploadAsync(signJson.uploadURL, fileUri, {
        httpMethod: "PUT",
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
        headers: {
          "Content-Type": signedContentType,
        },
      });
      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error("Failed to upload image to storage");
      }

      const completeResp = await fetch(`${getApiBase()}/upload/profile-picture/complete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify({ objectPath: signJson.objectPath }),
      });
      const completeJson = (await readResponseJson(completeResp)) as { fileUrl: string; error?: string };
      if (!completeResp.ok) {
        throw new Error(completeJson.error ?? "Failed to finalize upload");
      }

      persistAvatarUrl(completeJson.fileUrl);
      return { fileUrl: completeJson.fileUrl };
    } catch (signedError) {
      try {
        // Keep signup/profile edits working if signed URL flow is unavailable.
        const fallback = await legacyUpload();
        persistAvatarUrl(fallback.fileUrl);
        return fallback;
      } catch (legacyError) {
        const fallbackMessage =
          legacyError instanceof Error && legacyError.message
            ? legacyError.message
            : "Upload failed";
        const signedMessage =
          signedError instanceof Error && signedError.message
            ? signedError.message
            : null;
        throw new Error(
          signedMessage && signedMessage !== fallbackMessage
            ? `${fallbackMessage} (signed upload fallback also failed: ${signedMessage})`
            : fallbackMessage,
        );
      }
    }
  }, [persistAvatarUrl, token]);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading,
      isSubscriptionIdentityReady,
      signUp, signIn, requestPasswordReset, resetPassword, signOut,
      refreshProfile, getApiHeaders,
      uploadIncorporationCert,
      uploadIncorporationCertPreSignup,
      updateServiceProviderCert,
      uploadProfilePicture,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
