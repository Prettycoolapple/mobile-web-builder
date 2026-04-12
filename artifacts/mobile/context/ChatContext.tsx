import React, { createContext, useContext, useState, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type MessageRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type: "text" | "report" | "search" | "loading";
  report?: FeasibilityReport;
  searchResults?: PropertyCandidate[];
  isMockData?: boolean;
}

export interface Score {
  ease: number;
  cost: number;
  roi: number;
  composite: number;
  ease_reasons?: string[];
  cost_reasons?: string[];
  roi_reasons?: string[];
}

export interface PropertyOverview {
  address: string;
  cv?: string;
  landArea?: string;
  floorArea?: string;
  buildYear?: string;
  zone?: string;
  listingPrice?: string;
  isOnMarket?: boolean;
}

export interface PlanningOverlay {
  name: string;
  status: "clear" | "moderate" | "restricted";
  detail: string;
}

export interface PlanningInfo {
  zone?: string;
  minLotSize?: string;
  potentialLots?: number;
  overlays?: PlanningOverlay[];
  subdivisionSummary?: string;
}

export interface AsbestosInfo {
  buildYear?: string;
  riskLevel: "low" | "moderate" | "high" | "unknown";
  risk?: "low" | "high" | "unknown";
  flagged: boolean;
  notes?: string;
  worksafe_required?: boolean;
  demoCostLow?: number;
  demoCostHigh?: number;
  worksafeNote?: string;
}

export interface TerrainInfo {
  classification: "flat" | "gentle" | "moderate" | "steep";
  slope?: string;
  retainingCostLow?: number;
  retainingCostHigh?: number;
}

export interface InfrastructureService {
  name: string;
  location: "on-parcel" | "boundary" | "neighbour" | "public-land" | "off-parcel" | "unknown";
  distance_metres?: number | null;
  estimatedCostLow?: number;
  estimatedCostHigh?: number;
  estimated_cost_low?: number;
  estimated_cost_high?: number;
  risk: "low" | "moderate" | "high";
  note?: string;
}

export interface CostItem {
  label: string;
  low: number;
  high: number;
}

export interface ROIScenario {
  years: number;
  gdv: number;
  totalCost?: number;
  total_cost_mid?: number;
  grossProfit?: number;
  gross_profit?: number;
  roi?: number;
  roi_percent?: number;
  annualisedRoi?: number;
  annualised_roi_percent?: number;
  isBest?: boolean;
  viable?: boolean;
}

export interface ComparableSale {
  address: string;
  saleDate?: string;
  sale_date?: string;
  price?: number;
  price_nzd?: number;
  size?: number;
  land_sqm?: number;
  floor_sqm?: number;
  pricePerSqm?: number;
  price_per_sqm?: number;
}

export interface FeasibilityReport {
  address: string;
  scores: Score;
  propertyOverview?: PropertyOverview;
  planning?: PlanningInfo;
  potential_lots?: number;
  zone_label?: string;
  asbestos?: AsbestosInfo;
  terrain?: TerrainInfo;
  infrastructure?: InfrastructureService[];
  costItems?: CostItem[];
  totalCostLow?: number;
  totalCostHigh?: number;
  cost_per_unit_avg?: number;
  roiScenarios?: ROIScenario[];
  comparableSales?: ComparableSale[];
  comparables_quality?: "live" | "estimated";
  avgPricePerSqm?: number;
  avg_sale_price?: number;
  riskSummary?: string[];
  disclaimer?: string;
  overlay_map_image_base64?: string;
}

export interface PropertyCandidate {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  scores: Score;
  briefSummary?: string;
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  currentReport?: FeasibilityReport;
}

interface ChatContextValue {
  sessions: Session[];
  currentSessionId: string | null;
  currentSession: Session | null;
  createSession: () => string;
  startNewChat: () => void;
  switchSession: (id: string) => void;
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
  updateLastMessage: (updates: Partial<ChatMessage>) => void;
  setCurrentReport: (report: FeasibilityReport) => void;
  deleteSession: (id: string) => void;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const STORAGE_KEY = "@devfeasible/sessions";

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as Session[];
          const withMessages = parsed.filter(
            (s) => s.messages.some((m) => m.type !== "loading" && m.content.length > 0),
          );
          setSessions(withMessages);
          if (withMessages.length > 0) {
            setCurrentSessionId(withMessages[0].id);
          }
        } catch {
        }
      }
    });
  }, []);

  const saveSessions = useCallback((newSessions: Session[]) => {
    const withMessages = newSessions.filter(
      (s) => s.messages.some((m) => m.type !== "loading" && m.content.length > 0),
    );
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(withMessages));
  }, []);

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  const createSession = useCallback(() => {
    const id = generateId();
    const newSession: Session = {
      id,
      title: "New Analysis",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => {
      const updated = [newSession, ...prev];
      saveSessions(updated);
      return updated;
    });
    setCurrentSessionId(id);
    return id;
  }, [saveSessions]);

  const startNewChat = useCallback(() => {
    setCurrentSessionId(null);
  }, []);

  const switchSession = useCallback((id: string) => {
    setCurrentSessionId(id);
  }, []);

  const addMessage = useCallback(
    (msg: Omit<ChatMessage, "id" | "timestamp">) => {
      const fullMsg: ChatMessage = {
        ...msg,
        id: generateId(),
        timestamp: Date.now(),
      };
      setSessions((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          const newMessages = [...s.messages, fullMsg];
          let title = s.title;
          if (s.messages.length === 0 && msg.role === "user") {
            title = msg.content.slice(0, 40) + (msg.content.length > 40 ? "…" : "");
          }
          return { ...s, messages: newMessages, title, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const updateLastMessage = useCallback(
    (updates: Partial<ChatMessage>) => {
      setSessions((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          const messages = [...s.messages];
          const lastIdx = messages.length - 1;
          if (lastIdx >= 0) {
            messages[lastIdx] = { ...messages[lastIdx], ...updates };
          }
          return { ...s, messages, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const setCurrentReport = useCallback(
    (report: FeasibilityReport) => {
      setSessions((prev) => {
        const updated = prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          return { ...s, currentReport: report };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const updated = prev.filter((s) => s.id !== id);
        saveSessions(updated);
        return updated;
      });
      if (currentSessionId === id) {
        setSessions((prev) => {
          const remaining = prev.filter((s) => s.id !== id);
          setCurrentSessionId(remaining.length > 0 ? remaining[0].id : null);
          return prev;
        });
      }
    },
    [currentSessionId, saveSessions],
  );

  return (
    <ChatContext.Provider
      value={{
        sessions,
        currentSessionId,
        currentSession,
        createSession,
        startNewChat,
        switchSession,
        addMessage,
        updateLastMessage,
        setCurrentReport,
        deleteSession,
        isLoading,
        setIsLoading,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
