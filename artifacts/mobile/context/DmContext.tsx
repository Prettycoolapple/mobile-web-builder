import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";

function getApiOrigin(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}`;
  }
  return "";
}

function getApiBase(): string {
  if (process.env.EXPO_PUBLIC_DOMAIN) {
    return `https://${process.env.EXPO_PUBLIC_DOMAIN}/api`;
  }
  return "/api";
}

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
  otherParticipant: { id: string; fullName: string | null; role: string } | null;
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

export function DmProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [threads, setThreads] = useState<DmThread[]>([]);
  const socketRef = useRef<Socket | null>(null);

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

  useEffect(() => {
    if (!user || !token) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      return;
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

    newSocket.on("connect_error", () => {
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    fetchThreads();

    return () => {
      newSocket.disconnect();
      socketRef.current = null;
    };
  }, [user, token]);

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
