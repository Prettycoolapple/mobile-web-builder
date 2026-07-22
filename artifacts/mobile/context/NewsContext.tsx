import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";
import { useAuth } from "./AuthContext";
import { getApiBase } from "@/lib/api";

interface NewsContextValue {
  hasUnread: boolean;
  latestSequence: number;
  refreshUnread: () => Promise<void>;
  markCurrentNewsSeen: () => Promise<void>;
}

const NewsContext = createContext<NewsContextValue | null>(null);

export function NewsProvider({ children }: { children: React.ReactNode }) {
  const { user, getApiHeaders, newsGuestSessionId, isLoading } = useAuth();
  const [hasUnread, setHasUnread] = useState(false);
  const [latestSequence, setLatestSequence] = useState(0);
  const viewerStorageKey = useMemo(
    () => user?.id ? `@devfeasible/news_seen_pending/user_${user.id}` : newsGuestSessionId ? `@devfeasible/news_seen_pending/${newsGuestSessionId}` : null,
    [newsGuestSessionId, user?.id],
  );

  const refreshUnread = useCallback(async () => {
    if (isLoading || !viewerStorageKey) return;
    try {
      const response = await fetch(`${getApiBase()}/news/unread-status`, { headers: getApiHeaders() });
      if (!response.ok) return;
      const data = await response.json() as { hasUnread?: boolean; latestSequence?: number };
      const latest = Math.max(0, Number(data.latestSequence) || 0);
      const pending = Number(await AsyncStorage.getItem(viewerStorageKey)) || 0;
      setLatestSequence(latest);
      setHasUnread(Boolean(data.hasUnread) && latest > pending);
      if (pending > 0) {
        fetch(`${getApiBase()}/news/seen-through`, {
          method: "PATCH",
          headers: getApiHeaders(),
          body: JSON.stringify({ throughSequence: pending }),
        }).then(async (result) => {
          if (!result.ok) return;
          await AsyncStorage.removeItem(viewerStorageKey);
        }).catch(() => undefined);
      }
    } catch {
      // Keep the last known red-dot state while offline.
    }
  }, [getApiHeaders, isLoading, viewerStorageKey]);

  const markCurrentNewsSeen = useCallback(async () => {
    if (!viewerStorageKey || latestSequence <= 0) { setHasUnread(false); return; }
    setHasUnread(false);
    await AsyncStorage.setItem(viewerStorageKey, String(latestSequence));
    try {
      const response = await fetch(`${getApiBase()}/news/seen-through`, {
        method: "PATCH",
        headers: getApiHeaders(),
        body: JSON.stringify({ throughSequence: latestSequence }),
      });
      if (response.ok) {
        await AsyncStorage.removeItem(viewerStorageKey);
        void refreshUnread();
      }
    } catch {
      // The pending cursor is retried on foreground/refresh.
    }
  }, [getApiHeaders, latestSequence, refreshUnread, viewerStorageKey]);

  useEffect(() => { void refreshUnread(); }, [refreshUnread]);
  useEffect(() => {
    const news = DeviceEventEmitter.addListener("projectAlpha:newsChanged", () => void refreshUnread());
    const app = AppState.addEventListener("change", (state) => { if (state === "active") void refreshUnread(); });
    return () => { news.remove(); app.remove(); };
  }, [refreshUnread]);

  return <NewsContext.Provider value={{ hasUnread, latestSequence, refreshUnread, markCurrentNewsSeen }}>{children}</NewsContext.Provider>;
}

export function useNews(): NewsContextValue {
  const value = useContext(NewsContext);
  if (!value) throw new Error("useNews must be used within NewsProvider");
  return value;
}
