import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, DeviceEventEmitter } from "react-native";

import { useAuth } from "./AuthContext";
import { getApiBase } from "@/lib/api";
import { setAppIconBadgeCountAsync } from "@/lib/appBadge";

export type NotificationPage = "search" | "messages" | "history";

export interface NotificationItem {
  id: string;
  kind: string;
  sourceId: string;
  page: NotificationPage;
  title: string;
  body: string | null;
  metadata: unknown;
  createdAt: string;
}

interface NotificationSummary {
  total: number;
  pages: Record<NotificationPage, number>;
}

interface NotificationContextValue {
  total: number;
  pageCounts: Record<NotificationPage, number>;
  refresh: () => Promise<void>;
  fetchItems: (page: Exclude<NotificationPage, "messages">) => Promise<NotificationItem[]>;
  markItemRead: (id: string) => Promise<void>;
  markSourceRead: (kind: string, sourceId: string) => Promise<void>;
  markPageRead: (page: Exclude<NotificationPage, "messages">) => Promise<void>;
}

const emptyCounts: Record<NotificationPage, number> = {
  search: 0,
  messages: 0,
  history: 0,
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { token, user } = useAuth();
  const [summary, setSummary] = useState<NotificationSummary>({ total: 0, pages: emptyCounts });

  const authHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  }), [token]);

  const refresh = useCallback(async () => {
    if (!token || !user) {
      setSummary({ total: 0, pages: emptyCounts });
      await setAppIconBadgeCountAsync(0);
      return;
    }
    try {
      const resp = await fetch(`${getApiBase()}/notifications/summary`, {
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json() as NotificationSummary;
      const next = {
        total: data.total ?? 0,
        pages: { ...emptyCounts, ...(data.pages ?? {}) },
      };
      setSummary(next);
      await setAppIconBadgeCountAsync(next.total);
    } catch {
    }
  }, [authHeaders, token, user]);

  const fetchItems = useCallback(async (page: Exclude<NotificationPage, "messages">) => {
    if (!token || !user) return [];
    try {
      const resp = await fetch(`${getApiBase()}/notifications/items?page=${encodeURIComponent(page)}`, {
        headers: authHeaders(),
      });
      if (!resp.ok) return [];
      const data = await resp.json() as { items?: NotificationItem[] };
      return data.items ?? [];
    } catch {
      return [];
    }
  }, [authHeaders, token, user]);

  const markItemRead = useCallback(async (id: string) => {
    if (!token || !user) return;
    try {
      await fetch(`${getApiBase()}/notifications/items/${encodeURIComponent(id)}/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
    } finally {
      await refresh();
      DeviceEventEmitter.emit("projectAlpha:notificationsChanged");
    }
  }, [authHeaders, refresh, token, user]);

  const markSourceRead = useCallback(async (kind: string, sourceId: string) => {
    if (!token || !user) return;
    try {
      await fetch(`${getApiBase()}/notifications/sources/${encodeURIComponent(kind)}/${encodeURIComponent(sourceId)}/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
    } finally {
      await refresh();
      DeviceEventEmitter.emit("projectAlpha:notificationsChanged");
    }
  }, [authHeaders, refresh, token, user]);

  const markPageRead = useCallback(async (page: Exclude<NotificationPage, "messages">) => {
    if (!token || !user) return;
    try {
      const resp = await fetch(`${getApiBase()}/notifications/pages/${encodeURIComponent(page)}/read`, {
        method: "PATCH",
        headers: authHeaders(),
      });
      if (!resp.ok) return;
      const data = await resp.json() as NotificationSummary;
      const next = {
        total: data.total ?? 0,
        pages: { ...emptyCounts, ...(data.pages ?? {}) },
      };
      setSummary(next);
      await setAppIconBadgeCountAsync(next.total);
    } catch {
    } finally {
      DeviceEventEmitter.emit("projectAlpha:notificationsChanged");
    }
  }, [authHeaders, token, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const changedSub = DeviceEventEmitter.addListener("projectAlpha:notificationsChanged", () => {
      void refresh();
    });
    const jobReadySub = DeviceEventEmitter.addListener("projectAlpha:backgroundJobsReady", () => {
      void refresh();
    });
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => {
      changedSub.remove();
      jobReadySub.remove();
      appStateSub.remove();
    };
  }, [refresh]);

  return (
    <NotificationContext.Provider
      value={{
        total: summary.total,
        pageCounts: summary.pages,
        refresh,
        fetchItems,
        markItemRead,
        markSourceRead,
        markPageRead,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationProvider");
  return ctx;
}
