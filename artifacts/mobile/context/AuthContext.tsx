import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  subscriptionTier: string;
  reportsUsedThisMonth: number;
}

interface AuthContextValue {
  user: UserProfile | null;
  token: string | null;
  isLoading: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  getApiHeaders: () => Record<string, string>;
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
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_TOKEN),
          AsyncStorage.getItem(STORAGE_KEY_USER),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser));
        }
      } catch {
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const persistAuth = useCallback(async (newToken: string, newUser: UserProfile) => {
    setToken(newToken);
    setUser(newUser);
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEY_TOKEN, newToken),
      AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(newUser)),
    ]);
  }, []);

  const signUp = useCallback(async (email: string, password: string, fullName?: string) => {
    const resp = await fetch(`${getApiBase()}/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, fullName }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Signup failed");
    await persistAuth(data.token, data.user);
  }, [persistAuth]);

  const signIn = useCallback(async (email: string, password: string) => {
    const resp = await fetch(`${getApiBase()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Login failed");
    await persistAuth(data.token, data.user);
  }, [persistAuth]);

  const signOut = useCallback(async () => {
    setToken(null);
    setUser(null);
    await Promise.all([
      AsyncStorage.removeItem(STORAGE_KEY_TOKEN),
      AsyncStorage.removeItem(STORAGE_KEY_USER),
    ]);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!token) return;
    try {
      const resp = await fetch(`${getApiBase()}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        setUser(data.user);
        await AsyncStorage.setItem(STORAGE_KEY_USER, JSON.stringify(data.user));
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

  return (
    <AuthContext.Provider value={{ user, token, isLoading, signUp, signIn, signOut, refreshProfile, getApiHeaders }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
