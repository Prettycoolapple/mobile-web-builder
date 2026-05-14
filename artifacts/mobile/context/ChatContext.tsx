import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "@/context/AuthContext";
import {
  cacheReportPhotos,
  deleteReportPhotos,
  reportPhotoSignature,
} from "@/lib/reportPhotoCache";
import { getCurrentLocale } from "@/lib/i18n";
import { translateReportViaApi } from "@/lib/translateReport";

export type MessageRole = "user" | "assistant";

export interface ServiceProvider {
  id: string;
  fullName: string | null;
  companyName: string | null;
  discipline: string | null;
  bio: string | null;
  recommendationCount: number;
  avatarUrl: string | null;
  isVerified?: boolean;
  contactNumber?: string | null;
  addressSuburb?: string | null;
  addressCity?: string | null;
  primaryLanguage?: string | null;
  secondaryLanguage?: string | null;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  type: "text" | "report" | "search" | "loading" | "provider_recommendation" | "provider_upgrade_gate" | "agent_contact" | "subdivision_clarification" | "address_clarification";
  clarification?: {
    question: string;
    options: string[];
  };
  loadingMode?: "analyse" | "discover" | "followup";
  retryLabel?: string;
  retryText?: string;
  report?: FeasibilityReport;
  searchResults?: PropertyCandidate[];
  isMockData?: boolean;
  aiIntro?: string;
  provider?: ServiceProvider;
  intentType?: string;
  propertyAddress?: string;
  agentName?: string | null;
  agentPhone?: string;
  agencyName?: string | null;
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
  bedrooms?: number | null;
  bathrooms?: number | null;
  zone?: string;
  /** LINZ estate description / tenure (e.g. Fee Simple, Cross lease). */
  titleType?: string | null;
  listingPrice?: string;
  isOnMarket?: boolean;
}

export interface PlanningOverlay {
  name: string;
  status: "clear" | "moderate" | "restricted";
  detail: string;
}

export interface EasementEntry {
  type: "right_of_way" | "drainage" | "power" | "services" | "covenant" | "encroachment" | "other";
  burden: "burdening" | "appurtenant" | "unknown";
  description: string;
  estimated_width_m?: number | null;
  estimated_area_sqm?: number | null;
  severity?: "minor" | "moderate" | "significant";
}

export interface PlanningInfo {
  zone?: string;
  minLotSize?: string;
  potentialLots?: number;
  grossAreaSqm?: number;
  netAreaSqm?: number;
  easementAreaSqm?: number;
  overlays?: PlanningOverlay[];
  easements?: EasementEntry[];
  appurtenant_easements?: { type: string; description: string }[];
  easement_summary?: string;
  easement_data_status?: "retrieved" | "no_memorials" | "api_error" | "no_title";
  lot_impact_note?: string | null;
  subdivisionSummary?: string;
  subdivisionPathwayNote?: string | null;
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
  classification: "flat" | "gentle" | "moderate" | "steep" | null;
  slope?: string;
  slope_degrees?: number | null;
  retainingCostLow?: number;
  retainingCostHigh?: number;
  source?: string;
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

export interface ROICaseResult {
  case: "bear" | "base" | "bull";
  label: string;
  gdv: number;
  gdv_multiplier: number;
  gross_profit: number;
  roi_percent: number;
  annualised_roi_percent: number;
  viable: boolean;
}

export interface ROIScenario {
  years: number;
  gdv: number;
  gdv_per_lot?: number;
  sqm_per_lot?: number;
  lots?: number;
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
  cases?: ROICaseResult[];
  interest_rate_outlook?: "falling" | "stable" | "rising";
  cv_unavailable?: boolean;
}

export type DevelopmentStrategyId = "hold_existing" | "refurbish" | "demolish_rebuild";
export type DevelopmentStrategyRecommendation = "recommended" | "viable" | "not_recommended";
export type RefurbishmentScope = "none" | "light" | "moderate" | "heavy";

export interface DevelopmentStrategyCostItem {
  label: string;
  low: number;
  high: number;
}

export interface DevelopmentStrategyScenario {
  id: DevelopmentStrategyId;
  title: string;
  recommendation: DevelopmentStrategyRecommendation;
  confidence: number;
  rationale: string;
  rationale_zh?: string;
  assumptions: string[];
  refurbishScope?: RefurbishmentScope;
  totalCostLow: number;
  totalCostHigh: number;
  costPerUnitAvg: number;
  costItems?: DevelopmentStrategyCostItem[];
  roiScenarios: ROIScenario[];
}

export interface ComparableSale {
  address: string;
  saleDate?: string;
  sale_date?: string | null;
  price?: number;
  price_nzd?: number;
  size?: number;
  land_sqm?: number;
  floor_sqm?: number;
  pricePerSqm?: number;
  price_per_sqm?: number;
  cv_nzd?: number | null;
  build_year?: number | null;
}

/** MoE Schools Directory enrichment for home-zone listing text (Hougarden). */
export interface SchoolZoneDetail {
  level: "primary" | "intermediate" | "secondary";
  sourceLabel: string;
  orgName: string | null;
  orgType: string | null;
  authority: string | null;
  authorityCategory: "public" | "state_integrated" | "private" | "unknown";
  equityIndex: string | null;
  enrolmentScheme: string | null;
  roll: number | null;
  matched: boolean;
}

export interface FeasibilityReport {
  address: string;
  /** Server search-history row id when this report was persisted. */
  historyId?: string | null;
  /** Server-created timestamp for history ordering when available. */
  historyCreatedAt?: string | null;
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
  total_excludes_land?: boolean;
  cv_unavailable?: boolean;
  cost_per_unit_avg?: number;
  roiScenarios?: ROIScenario[];
  developmentStrategies?: DevelopmentStrategyScenario[];
  recommendedDevelopmentStrategy?: DevelopmentStrategyId | null;
  interest_rate_outlook?: "falling" | "stable" | "rising";
  comparableSales?: ComparableSale[];
  comparables_quality?: "live" | "estimated" | "unavailable";
  avgPricePerSqm?: number | null;
  avg_sale_price?: number | null;
  /** Enriched state/intermediate/secondary zone schools (MoE directory). */
  schoolZones?: SchoolZoneDetail[];
  riskSummary?: string[];
  disclaimer?: string;
  overlay_map_image_base64?: string;
  data_sources?: Record<string, string>;
  missing_critical_fields?: string[];
  photoUrl?: string;
  photoUrls?: string[];
  /**
   * On-device file URIs of property photos already downloaded for this report.
   * Populated lazily by `lib/reportPhotoCache.ts` so the report still shows
   * the correct photograph after the original CDN URL has rotated. Persisted
   * with the session and cleared when the user deletes the report.
   */
  cachedPhotoUris?: string[];
}

export interface PropertyCandidate {
  address: string;
  price: number;
  landArea?: number;
  zone?: string;
  scores: Score;
  scoresLoading?: boolean;
  briefSummary?: string;
  potentialLots?: number;
  minLotSize?: number;
  photoUrl?: string;
  listingUrl?: string;
  bedrooms?: number;
  bathrooms?: number;
  /** True when listing sources disagreed on the count — render as "~3 bd". */
  bedroomsApprox?: boolean;
  bathroomsApprox?: boolean;
  /** True when listing sources disagreed on land area / price — render as "~503 m²" / "~$1.25M". */
  landAreaApprox?: boolean;
  priceApprox?: boolean;
  /** Floor (dwelling) area in m². */
  floorArea?: number;
  floorAreaApprox?: boolean;
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  currentReport?: FeasibilityReport;
  /** User rated the first LLM reply (thumbs up/down). */
  firstLlmResponseRating?: "up" | "down";
  /** Opened from History — skip first-turn rating prompt. */
  skipFirstTurnRating?: boolean;
}

interface ChatContextValue {
  sessions: Session[];
  currentSessionId: string | null;
  currentSession: Session | null;
  createSession: () => string;
  startNewChat: () => void;
  switchSession: (id: string) => void;
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => void;
  updateLastMessage: (updates: Partial<ChatMessage>, sessionId?: string) => void;
  removeMessage: (messageId: string, sessionId?: string) => void;
  updateCandidateScores: (
    scoreMap: Record<string, { ease: number; cost: number; roi: number; composite: number; landArea?: number; zone?: string | null }>,
    sessionId?: string,
  ) => void;
  setCurrentReport: (report: FeasibilityReport) => void;
  deleteSession: (id: string) => void;
  openHistoryReport: (address: string, report: FeasibilityReport) => string;
  isLoading: boolean;
  setIsLoading: (v: boolean) => void;
  setFirstLlmResponseRating: (sessionId: string, rating: "up" | "down") => void;
  /** Increment to signal the server-side search history list may have new rows (e.g. after /analyse). */
  searchHistoryTick: number;
  bumpSearchHistory: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const BASE_STORAGE_KEY = "@devfeasible/sessions";

function getStorageKey(userId: string | null | undefined): string {
  return userId ? `${BASE_STORAGE_KEY}/${userId}` : BASE_STORAGE_KEY;
}

function generateId(): string {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9);
}

/** True if the string contains no CJK characters — used to detect untranslated English fields. */
function isEnglishText(s: unknown): boolean {
  if (typeof s !== "string" || !s.trim()) return false;
  return !/[\u3400-\u9FFF\uF900-\uFAFF]/.test(s);
}

/** True when a report has at least one LLM-narrative field still in English (ASCII-only prose). */
function reportHasEnglishNarrative(report: FeasibilityReport): boolean {
  const scores = report.scores;
  if (scores) {
    for (const key of ["ease_reasons", "cost_reasons", "roi_reasons"] as const) {
      const arr = scores[key];
      if (Array.isArray(arr) && arr.some((x) => isEnglishText(x))) return true;
    }
  }
  const planning = report.planning;
  if (planning) {
    if (isEnglishText(planning.subdivisionPathwayNote)) return true;
    if (isEnglishText(planning.subdivisionSummary)) return true;
    if (isEnglishText(planning.easement_summary)) return true;
    if (Array.isArray(planning.overlays)) {
      for (const o of planning.overlays) {
        if (isEnglishText(o.detail)) return true;
      }
    }
  }
  if (report.riskSummary?.some((r) => isEnglishText(r))) return true;
  if (isEnglishText(report.disclaimer)) return true;
  if (isEnglishText(report.asbestos?.notes)) return true;
  if (isEnglishText(report.propertyOverview?.titleType)) return true;
  if (isEnglishText(report.terrain?.slope)) return true;

  if (report.costItems?.some((ci) => isEnglishText(ci.label))) return true;

  const strategies = report.developmentStrategies;
  if (strategies?.length) {
    for (const s of strategies) {
      const zhRationale =
        typeof s.rationale_zh === "string" && s.rationale_zh.trim().length > 0 && !isEnglishText(s.rationale_zh);
      if (!zhRationale && isEnglishText(s.rationale)) return true;
      if (typeof s.rationale_zh === "string" && s.rationale_zh.trim() && isEnglishText(s.rationale_zh)) return true;
      if (s.assumptions?.some((a) => isEnglishText(a))) return true;
      if (s.costItems?.some((ci) => isEnglishText(ci.label))) return true;
    }
  }

  return false;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchHistoryTick, setSearchHistoryTick] = useState(0);

  const bumpSearchHistory = useCallback(() => {
    setSearchHistoryTick((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const storageKey = getStorageKey(userId);
    setSessions([]);
    setCurrentSessionId(null);
    // Different user → re-evaluate every report's photo cache once.
    photoCacheAttemptsRef.current = new Set();
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (cancelled) return;
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
    return () => { cancelled = true; };
  }, [userId]);

  const saveSessions = useCallback((newSessions: Session[]) => {
    const storageKey = getStorageKey(userId);
    const withMessages = newSessions.filter(
      (s) => s.messages.some((m) => m.type !== "loading" && m.content.length > 0),
    );
    AsyncStorage.setItem(storageKey, JSON.stringify(withMessages));
  }, [userId]);

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
    (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => {
      const fullMsg: ChatMessage = {
        ...msg,
        id: generateId(),
        timestamp: Date.now(),
      };
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
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
    (updates: Partial<ChatMessage>, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
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

  const removeMessage = useCallback(
    (messageId: string, sessionId?: string) => {
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = s.messages.filter((m) => m.id !== messageId);
          if (messages.length === s.messages.length) return s;
          return { ...s, messages, updatedAt: Date.now() };
        });
        saveSessions(updated);
        return updated;
      });
    },
    [currentSessionId, saveSessions],
  );

  const updateCandidateScores = useCallback(
    (
      scoreMap: Record<string, { ease: number; cost: number; roi: number; composite: number; landArea?: number; zone?: string | null }>,
      sessionId?: string,
    ) => {
      const normMap: Record<string, { ease: number; cost: number; roi: number; composite: number; landArea?: number; zone?: string | null }> = {};
      for (const [addr, data] of Object.entries(scoreMap)) {
        normMap[addr.toLowerCase().replace(/[^a-z0-9]/g, "")] = data;
      }
      setSessions((prev) => {
        const targetId = sessionId ?? currentSessionId;
        const updated = prev.map((s) => {
          if (s.id !== targetId) return s;
          const messages = s.messages.map((m) => {
            if (m.type !== "search" || !m.searchResults) return m;
            const updatedResults = m.searchResults.map((c) => {
              const normAddr = c.address.toLowerCase().replace(/[^a-z0-9]/g, "");
              const update = normMap[normAddr];
              if (!update) return c;
              const { landArea, zone, ...scoreFields } = update;
              return {
                ...c,
                scores: { ...c.scores, ...scoreFields },
                scoresLoading: false,
                ...(landArea != null ? { landArea } : {}),
                ...(zone != null ? { zone } : {}),
              };
            });
            return { ...m, searchResults: updatedResults };
          });
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

  const setFirstLlmResponseRating = useCallback(
    (sessionId: string, rating: "up" | "down") => {
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === sessionId ? { ...s, firstLlmResponseRating: rating, updatedAt: Date.now() } : s,
        );
        saveSessions(updated);
        return updated;
      });
    },
    [saveSessions],
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
      // Drop on-device property photos owned by this session so they don't
      // linger after the user deletes the report.
      deleteReportPhotos(id).catch(() => {});
    },
    [currentSessionId, saveSessions],
  );

  // Tracks reports we've already attempted to cache photos for, keyed by
  // `${sessionId}::${messageId|"current"}::${photoSignature}`. Lets the effect
  // below run safely on every session mutation without re-downloading or
  // hammering Street View when an attempt yielded zero usable photos.
  const photoCacheAttemptsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    type Pending = {
      sessionId: string;
      messageId: string | null;
      report: FeasibilityReport;
      attemptKey: string;
    };

    const pending: Pending[] = [];
    for (const session of sessions) {
      const collect = (report: FeasibilityReport, messageId: string | null) => {
        if ((report.cachedPhotoUris?.length ?? 0) > 0) return;
        const sig = reportPhotoSignature(report);
        const attemptKey = `${session.id}::${messageId ?? "current"}::${sig}`;
        if (photoCacheAttemptsRef.current.has(attemptKey)) return;
        pending.push({ sessionId: session.id, messageId, report, attemptKey });
      };
      if (session.currentReport) collect(session.currentReport, null);
      for (const msg of session.messages) {
        if (msg.type === "report" && msg.report) collect(msg.report, msg.id);
      }
    }

    if (pending.length === 0) return;

    for (const item of pending) {
      photoCacheAttemptsRef.current.add(item.attemptKey);
    }

    void (async () => {
      for (const item of pending) {
        if (cancelled) return;
        const uris = await cacheReportPhotos(item.sessionId, item.report);
        if (cancelled || uris.length === 0) continue;

        setSessions((prev) => {
          let mutated = false;
          const next = prev.map((s) => {
            if (s.id !== item.sessionId) return s;

            let updatedSession = s;
            const patch = (target: FeasibilityReport): FeasibilityReport => ({
              ...target,
              cachedPhotoUris: uris,
            });

            if (
              item.messageId === null &&
              s.currentReport &&
              reportPhotoSignature(s.currentReport) === reportPhotoSignature(item.report) &&
              (s.currentReport.cachedPhotoUris?.length ?? 0) === 0
            ) {
              updatedSession = { ...updatedSession, currentReport: patch(s.currentReport) };
              mutated = true;
            }

            if (item.messageId !== null) {
              const newMessages = s.messages.map((m) => {
                if (m.id !== item.messageId || !m.report) return m;
                if ((m.report.cachedPhotoUris?.length ?? 0) > 0) return m;
                return { ...m, report: patch(m.report) };
              });
              if (newMessages !== s.messages) {
                updatedSession = { ...updatedSession, messages: newMessages };
                mutated = true;
              }
            }

            return updatedSession;
          });

          if (!mutated) return prev;
          saveSessions(next);
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessions, saveSessions]);

  // When the device locale is zh, back-translate any cached report messages
  // whose narrative fields are still in English (generated before translation
  // was active). Runs once per session change; skips reports already translated.
  const { getApiHeaders } = useAuth();
  const translatedReportIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (getCurrentLocale() !== "zh") return;
    let cancelled = false;
    (async () => {
      const headers = getApiHeaders();
      for (const session of sessions) {
        for (const msg of session.messages) {
          if (msg.type !== "report" || !msg.report) continue;
          const key = `${session.id}::${msg.id}`;
          if (translatedReportIdsRef.current.has(key)) continue;
          if (!reportHasEnglishNarrative(msg.report)) {
            translatedReportIdsRef.current.add(key);
            continue;
          }
          const translated = await translateReportViaApi(msg.report, headers);
          if (cancelled) return;
          if (!translated) {
            translatedReportIdsRef.current.add(key);
            continue;
          }
          translatedReportIdsRef.current.add(key);
          setSessions((prev) => {
            const next = prev.map((s) => {
              if (s.id !== session.id) return s;
              const newMessages = s.messages.map((m) =>
                m.id === msg.id ? { ...m, report: translated } : m,
              );
              const newCurrentReport =
                s.currentReport && reportHasEnglishNarrative(s.currentReport)
                  ? translated
                  : s.currentReport;
              return { ...s, messages: newMessages, currentReport: newCurrentReport };
            });
            saveSessions(next);
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [sessions, getApiHeaders, saveSessions]);

  const openHistoryReport = useCallback(
    (address: string, report: FeasibilityReport): string => {
      const now = Date.now();
      const sessionId = generateId();
      const newSession: Session = {
        id: sessionId,
        title: address.slice(0, 50),
        messages: [
          {
            id: generateId(),
            role: "user",
            content: address,
            timestamp: now,
            type: "text",
          },
          {
            id: generateId(),
            role: "assistant",
            content: "",
            timestamp: now + 1,
            type: "report",
            report,
          },
        ],
        createdAt: now,
        updatedAt: now,
        currentReport: report,
        skipFirstTurnRating: true,
      };
      setSessions((prev) => {
        const updated = [newSession, ...prev];
        saveSessions(updated);
        return updated;
      });
      setCurrentSessionId(sessionId);
      return sessionId;
    },
    [saveSessions],
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
        removeMessage,
        updateCandidateScores,
        setCurrentReport,
        deleteSession,
        openHistoryReport,
        isLoading,
        setIsLoading,
        setFirstLlmResponseRating,
        searchHistoryTick,
        bumpSearchHistory,
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
