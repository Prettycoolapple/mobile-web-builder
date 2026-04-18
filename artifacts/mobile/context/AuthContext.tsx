import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import { loginRevenueCat, logoutRevenueCat } from "@/lib/revenuecat";

export type UserRole = "general" | "sales_agent" | "service_provider";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  role: UserRole;
  languages: string[];
  subscriptionTier: string;
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
}

export interface AgentSignUpData {
  role: "sales_agent";
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  languages?: string[];
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
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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

function getApiBase(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "/api";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubscriptionIdentityReady, setIsSubscriptionIdentityReady] = useState(false);

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

  const persistAuth = useCallback(async (newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_TOKEN, newToken),
      AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(newUser)),
    ]);
  }, []);

  const signUp = useCallback(async (data: SignUpData): Promise<{ token: string }> => {
    const resp = await fetch(`${getApiBase()}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = (await resp.json()) as {
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
    const data = (await resp.json()) as { token: string; user: UserProfile & { role?: UserRole; languages?: string[] }; error?: string };
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

  const signOut = useCallback(async () => {
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

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    try {
      const resp = await fetch(`${getApiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = (await resp.json()) as { user: UserProfile & { role?: UserRole; languages?: string[] } };
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

  const getApiHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
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
    const formData = new FormData();
    const fileBlob: ReactNativeFileBlob = { uri: fileUri, type: mimeType, name: fileName };
    formData.append("file", fileBlob as unknown as Blob);
    const resp = await fetch(`${getApiBase()}/upload/incorporation-cert-pre-signup`, {
      method: "POST",
      body: formData,
    });
    const json = (await resp.json()) as { objectPath: string; fileUrl: string; error?: string };
    if (!resp.ok) throw new Error(json.error ?? "Upload failed");
    return { objectPath: json.objectPath, fileUrl: json.fileUrl };
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
    const formData = new FormData();
    const fileBlob: ReactNativeFileBlob = { uri: fileUri, type: mimeType, name: fileName };
    formData.append("file", fileBlob as unknown as Blob);
    const resp = await fetch(`${getApiBase()}/upload/profile-picture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${activeToken}` },
      body: formData,
    });
    const json = (await resp.json()) as { fileUrl: string; error?: string };
    if (!resp.ok) throw new Error(json.error ?? "Upload failed");
    setUser((prev) => (prev ? { ...prev, avatarUrl: json.fileUrl } : prev));
    return { fileUrl: json.fileUrl };
  }, [token]);

  return (
    <AuthContext.Provider value={{
      user, token, isLoading,
      isSubscriptionIdentityReady,
      signUp, signIn, signOut,
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
