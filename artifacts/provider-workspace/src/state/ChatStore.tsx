import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api";
import { getUser } from "@/lib/auth";
import type {
  CandidateScoreUpdate,
  ChatMessage,
  FeasibilityReport,
  FeasibilityReportGroup,
  Session,
} from "./chat-model";

/**
 * Cross-device chat store. Mirrors the mobile ChatProvider
 * (artifacts/mobile/context/ChatContext.tsx): sessions live locally + sync to
 * GET/POST/DELETE /conversations with last-write-wins by `updatedAt`. The synced
 * `data` blob is the Session, so chats started here appear in mobile History.
 */

function storageKey(userId: string | null): string {
  return userId ? `@alpha/ws-sessions/${userId}` : "@alpha/ws-sessions";
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).slice(2, 11);
}

function sessionHasContent(s: Session): boolean {
  return s.messages.some((m) => m.type !== "loading" && m.content.length > 0);
}

function normaliseAddressKey(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function addressMatchKeys(address: string): string[] {
  const full = normaliseAddressKey(address);
  const streetPart = address.split(",")[0]?.trim() ?? "";
  const street = /\d/.test(streetPart) ? normaliseAddressKey(streetPart) : "";
  return Array.from(new Set([full, street].filter(Boolean)));
}

/** Drop transient loading bubbles before persisting/syncing (mirrors stripSessionForSync). */
function stripSessionForSync(s: Session): Session {
  return { ...s, messages: s.messages.filter((m) => m.type !== "loading") };
}

type RemoteConversation = {
  id: string;
  title?: string;
  data?: Partial<Session>;
  updatedAt?: number | null;
  createdAt?: number | null;
};

function hydrateRemoteSession(rc: RemoteConversation): Session {
  const data = (rc.data && typeof rc.data === "object" ? rc.data : {}) as Partial<Session>;
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const updatedAt =
    typeof data.updatedAt === "number" ? data.updatedAt : typeof rc.updatedAt === "number" ? rc.updatedAt : Date.now();
  const createdAt =
    typeof data.createdAt === "number" ? data.createdAt : typeof rc.createdAt === "number" ? rc.createdAt : updatedAt;
  return {
    ...data,
    id: rc.id,
    title: (typeof data.title === "string" && data.title) || rc.title || "",
    messages,
    createdAt,
    updatedAt,
  } as Session;
}

export interface ChatStoreValue {
  sessions: Session[];
  currentSessionId: string | null;
  currentSession: Session | null;
  loading: boolean;
  createSession: () => string;
  startNewChat: () => void;
  switchSession: (id: string) => void;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => string;
  updateMessage: (messageId: string, updates: Partial<ChatMessage>, sessionId?: string) => void;
  updateLastMessage: (updates: Partial<ChatMessage>, sessionId?: string) => void;
  updateCandidateScores: (scoreMap: Record<string, CandidateScoreUpdate>, sessionId?: string) => void;
  setCurrentReport: (report: FeasibilityReport, sessionId?: string) => void;
  setCurrentReportGroup: (group: FeasibilityReportGroup, sessionId?: string) => void;
}

const ChatStoreContext = createContext<ChatStoreValue | null>(null);

export function ChatStoreProvider({ children }: { children: React.ReactNode }) {
  const userId = getUser()?.id ?? null;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pullDone, setPullDone] = useState(false);
  const syncedUpdatedAtRef = useRef<Map<string, number>>(new Map());
  const currentSessionIdRef = useRef<string | null>(null);
  currentSessionIdRef.current = currentSessionId;

  const persist = useCallback(
    (next: Session[]) => {
      const withContent = next.filter(sessionHasContent);
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(withContent));
      } catch {
        /* quota — ignore */
      }
    },
    [userId],
  );

  // Initial load: local cache for instant UI, then merge server conversations.
  useEffect(() => {
    let cancelled = false;
    setSessions([]);
    setCurrentSessionId(null);
    syncedUpdatedAtRef.current = new Map();
    setPullDone(false);
    setLoading(true);

    (async () => {
      let local: Session[] = [];
      try {
        const raw = localStorage.getItem(storageKey(userId));
        if (raw) local = (JSON.parse(raw) as Session[]).filter(sessionHasContent);
      } catch {
        /* ignore */
      }
      if (cancelled) return;
      setSessions(local);

      try {
        const data = await apiGet<{ conversations?: RemoteConversation[] }>("/conversations");
        if (!cancelled && Array.isArray(data.conversations) && data.conversations.length > 0) {
          const remote = data.conversations;
          setSessions((prev) => {
            const byId = new Map(prev.map((s) => [s.id, s]));
            let changed = false;
            for (const rc of remote) {
              if (!rc || typeof rc.id !== "string") continue;
              const remoteUpdated = typeof rc.updatedAt === "number" ? rc.updatedAt : 0;
              const localSession = byId.get(rc.id);
              if (!localSession) {
                const hydrated = hydrateRemoteSession(rc);
                if (!sessionHasContent(hydrated)) continue;
                byId.set(rc.id, hydrated);
                syncedUpdatedAtRef.current.set(rc.id, hydrated.updatedAt);
                changed = true;
              } else if (remoteUpdated > (localSession.updatedAt ?? 0)) {
                const hydrated = hydrateRemoteSession(rc);
                byId.set(rc.id, hydrated);
                syncedUpdatedAtRef.current.set(rc.id, hydrated.updatedAt);
                changed = true;
              } else if (remoteUpdated === (localSession.updatedAt ?? 0)) {
                syncedUpdatedAtRef.current.set(rc.id, localSession.updatedAt ?? 0);
              }
            }
            if (!changed) return prev;
            const merged = Array.from(byId.values()).sort(
              (a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt),
            );
            persist(merged);
            return merged;
          });
        }
      } catch {
        /* offline / unauth — local cache still shows */
      }
      if (!cancelled) {
        setPullDone(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, persist]);

  // Debounced push of locally-changed sessions to the server.
  useEffect(() => {
    if (!pullDone) return;
    const changed = sessions.filter(
      (s) => sessionHasContent(s) && syncedUpdatedAtRef.current.get(s.id) !== s.updatedAt,
    );
    if (changed.length === 0) return;

    const handle = setTimeout(async () => {
      const snapshot = changed.map((s) => ({ id: s.id, updatedAt: s.updatedAt }));
      try {
        await apiPost("/conversations", {
          conversations: changed.map((s) => ({
            id: s.id,
            title: s.title,
            updatedAt: s.updatedAt,
            createdAt: s.createdAt,
            messageCount: s.messages.filter((m) => m.type !== "loading").length,
            data: stripSessionForSync(s),
          })),
        });
        for (const snap of snapshot) syncedUpdatedAtRef.current.set(snap.id, snap.updatedAt);
      } catch {
        /* retried on next change */
      }
    }, 1500);

    return () => clearTimeout(handle);
  }, [sessions, pullDone]);

  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? null;

  const createSession = useCallback((): string => {
    const id = generateId();
    const now = Date.now();
    const fresh: Session = { id, title: "New Analysis", messages: [], createdAt: now, updatedAt: now };
    setSessions((prev) => {
      const next = [fresh, ...prev];
      persist(next);
      return next;
    });
    setCurrentSessionId(id);
    return id;
  }, [persist]);

  const startNewChat = useCallback(() => setCurrentSessionId(null), []);
  const switchSession = useCallback((id: string) => setCurrentSessionId(id), []);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        persist(next);
        if (currentSessionIdRef.current === id) {
          setCurrentSessionId(next[0]?.id ?? null);
        }
        return next;
      });
      syncedUpdatedAtRef.current.delete(id);
      apiDelete(`/conversations/${encodeURIComponent(id)}`).catch(() => {});
    },
    [persist],
  );

  const renameSession = useCallback(
    (id: string, title: string) => {
      const cleanTitle = title.trim() || "Untitled";
      setSessions((prev) => {
        const next = prev.map((s) => (s.id === id ? { ...s, title: cleanTitle, updatedAt: Date.now() } : s));
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string): string => {
      const full: ChatMessage = { ...msg, id: generateId(), timestamp: Date.now() };
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionIdRef.current;
        const next = prev.map((s) => {
          if (s.id !== targetId) return s;
          let title = s.title;
          if (s.messages.length === 0 && msg.role === "user") {
            title = msg.content.slice(0, 40) + (msg.content.length > 40 ? "…" : "");
          }
          return { ...s, messages: [...s.messages, full], title, updatedAt: Date.now() };
        });
        persist(next);
        return next;
      });
      return full.id;
    },
    [persist],
  );

  const updateMessage = useCallback(
    (messageId: string, updates: Partial<ChatMessage>, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionIdRef.current;
        const next = prev.map((s) => {
          if (s.id !== targetId) return s;
          let changed = false;
          const messages = s.messages.map((m) => {
            if (m.id !== messageId) return m;
            changed = true;
            return { ...m, ...updates };
          });
          return changed ? { ...s, messages, updatedAt: Date.now() } : s;
        });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateLastMessage = useCallback(
    (updates: Partial<ChatMessage>, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionIdRef.current;
        const next = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = [...s.messages];
          const last = messages.length - 1;
          if (last >= 0) messages[last] = { ...messages[last], ...updates };
          return { ...s, messages, updatedAt: Date.now() };
        });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const updateCandidateScores = useCallback(
    (scoreMap: Record<string, CandidateScoreUpdate>, sessionId?: string) => {
      const normMap: Record<string, CandidateScoreUpdate> = {};
      for (const [addr, data] of Object.entries(scoreMap)) {
        for (const key of addressMatchKeys(addr)) normMap[key] = data;
      }
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionIdRef.current;
        const next = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = s.messages.map((m) => {
            if (m.type !== "search" || !m.searchResults) return m;
            const updatedResults = m.searchResults.map((c) => {
              const update = addressMatchKeys(c.address)
                .map((key) => normMap[key])
                .find(Boolean);
              if (!update) return c;
              const {
                landArea,
                zone,
                potentialLots,
                minLotSize,
                standardVacantLots,
                standardPathViable,
                standardMinLotSize,
                designLedEligible,
                designLedYieldRange,
                designLedConfidence,
                designLedReasons,
                designLedBlockers,
                designLedSummary,
                designLedDetail,
                builtEnvironmentContext,
                ...scoreFields
              } = update;
              return {
                ...c,
                scores: { ...c.scores, ...scoreFields },
                scoresLoading: false,
                ...(landArea != null ? { landArea } : {}),
                ...(zone != null ? { zone } : {}),
                ...(potentialLots != null ? { potentialLots } : {}),
                ...(minLotSize !== undefined ? { minLotSize: minLotSize ?? undefined } : {}),
                ...(standardVacantLots != null ? { standardVacantLots } : {}),
                ...(standardPathViable !== undefined ? { standardPathViable } : {}),
                ...(standardMinLotSize !== undefined ? { standardMinLotSize } : {}),
                ...(designLedEligible !== undefined ? { designLedEligible } : {}),
                ...(designLedYieldRange !== undefined ? { designLedYieldRange } : {}),
                ...(designLedConfidence !== undefined ? { designLedConfidence } : {}),
                ...(designLedReasons !== undefined ? { designLedReasons } : {}),
                ...(designLedBlockers !== undefined ? { designLedBlockers } : {}),
                ...(designLedSummary !== undefined ? { designLedSummary } : {}),
                ...(designLedDetail !== undefined ? { designLedDetail } : {}),
                ...(builtEnvironmentContext !== undefined ? { builtEnvironmentContext } : {}),
              };
            });
            return { ...m, searchResults: updatedResults };
          });
          return { ...s, messages, updatedAt: Date.now() };
        });
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setCurrentReport = useCallback(
    (report: FeasibilityReport, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionIdRef.current;
        const next = prev.map((s) =>
          s.id === targetId ? { ...s, currentReport: report, currentReportGroup: undefined, updatedAt: Date.now() } : s,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setCurrentReportGroup = useCallback(
    (group: FeasibilityReportGroup, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionIdRef.current;
        const next = prev.map((s) =>
          s.id === targetId
            ? { ...s, currentReportGroup: group, currentReport: group.reports[0], updatedAt: Date.now() }
            : s,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const value: ChatStoreValue = {
    sessions,
    currentSessionId,
    currentSession,
    loading,
    createSession,
    startNewChat,
    switchSession,
    deleteSession,
    renameSession,
    addMessage,
    updateMessage,
    updateLastMessage,
    updateCandidateScores,
    setCurrentReport,
    setCurrentReportGroup,
  };

  return <ChatStoreContext.Provider value={value}>{children}</ChatStoreContext.Provider>;
}

export function useChatStore(): ChatStoreValue {
  const ctx = useContext(ChatStoreContext);
  if (!ctx) throw new Error("useChatStore must be used within ChatStoreProvider");
  return ctx;
}
