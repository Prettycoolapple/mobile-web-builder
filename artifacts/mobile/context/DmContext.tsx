import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { getApiBase, getApiOrigin } from "@/lib/api";

export interface DmMessage {
  id: string;
  threadId: string;
  senderId: string;
  body: string | null;
  imageUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface DmThread {
  id: string;
  participantA: string;
  participantB: string;
  lastMessageAt: string | null;
  createdAt: string;
  otherParticipant: { id: string; fullName: string | null; role: string; recommendationCount?: number } | null;
  lastMessage: DmMessage | null;
  unreadCount: number;
}

interface DmContextValue {
  socket: Socket | null;
  unreadCount: number;
  setUnreadCount: (n: number) => void;
  threads: DmThread[];
  setThreads: React.Dispatch<React.SetStateAction<DmThread[]>>;
  fetchThreads: () => Promise<void>;
}

const DmContext = createContext<DmContextValue | null>(null);

// Sockets are opt-out via env so the same mobile binary can talk to either a
// self-hosted API (real-time) or a Vercel serverless API (no sockets, polling
// only). Default: enabled.
const SOCKETS_ENABLED = process.env.EXPO_PUBLIC_ENABLE_SOCKETS !== "false";
const POLL_INTERVAL_MS = Math.max(
  2000,
  Number(process.env.EXPO_PUBLIC_DM_POLL_MS ?? "10000"),
);

export function DmProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [threads, setThreads] = useState<DmThread[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchThreads = useCallback(async () => {
    if (!token) return;
    try {
      const resp = await fetch(`${getApiBase()}/dm/threads`, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      if (resp.ok) {
        const data = await resp.json() as { threads: DmThread[] };
        setThreads(data.threads ?? []);
        const total = (data.threads ?? []).reduce((sum, t) => sum + (t.unreadCount || 0), 0);
        setUnreadCount(total);
      }
    } catch {
    }
  }, [token]);

  const startPolling = useCallback(() => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(() => {
      fetchThreads();
    }, POLL_INTERVAL_MS);
  }, [fetchThreads]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!user || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      stopPolling();
      return;
    }

    // Polling-only mode (Vercel / serverless backend): don't even try to
    // open a socket.
    if (!SOCKETS_ENABLED) {
      fetchThreads();
      startPolling();
      return () => {
        stopPolling();
      };
    }

    const origin = getApiOrigin();
    const newSocket = io(origin, {
      path: "/api/socket.io",
      auth: { token },
      transports: ["websocket", "polling"],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 2000,
    });

    newSocket.on("connect", () => {
      stopPolling();
      fetchThreads();
    });

    newSocket.on("new_message", ({ threadId, message }: { threadId: string; message: DmMessage }) => {
      const isMine = message.senderId === user?.id;
      setThreads((prev) => {
        const threadExists = prev.some((t) => t.id === threadId);
        if (!threadExists) {
          fetchThreads();
          return prev;
        }
        const updated = prev.map((t) => {
          if (t.id === threadId) {
            const extra = isMine ? 0 : 1;
            return { ...t, unreadCount: t.unreadCount + extra, lastMessageAt: new Date().toISOString() };
          }
          return t;
        });
        const total = updated.reduce((sum, t) => sum + (t.unreadCount || 0), 0);
        setUnreadCount(total);
        return updated;
      });
    });

    // If the socket can't reach the server (for example because the API is
    // behind a serverless host that doesn't run Socket.IO), fall back to
    // REST polling so DMs still refresh.
    newSocket.on("connect_error", () => {
      startPolling();
    });

    newSocket.on("disconnect", () => {
      startPolling();
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    fetchThreads();

    return () => {
      newSocket.disconnect();
      socketRef.current = null;
      stopPolling();
    };
  }, [user, token, fetchThreads, startPolling, stopPolling]);

  return (
    <DmContext.Provider value={{ socket, unreadCount, setUnreadCount, threads, setThreads, fetchThreads }}>
      {children}
    </DmContext.Provider>
  );
}

export function useDm(): DmContextValue {
  const ctx = useContext(DmContext);
  if (!ctx) throw new Error("useDm must be used within DmProvider");
  return ctx;
}
