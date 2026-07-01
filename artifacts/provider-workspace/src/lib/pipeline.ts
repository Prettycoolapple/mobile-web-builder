import { apiGet, apiPost, isApiError } from "@/lib/api";
import { extractJSON, sanitizeForDisplay } from "@/lib/format";
import {
  isFeasibilityReport,
  isFeasibilityReportGroup,
  selectedListingContextFromCandidate,
  type CandidateScoreUpdate,
  type ChatMessage,
  type FeasibilityReport,
  type FeasibilityReportGroup,
  type PropertyCandidate,
  type Session,
} from "@/state/chat-model";

/** Subset of ChatStore the pipeline needs. */
export interface PipelineStore {
  addMessage: (msg: Omit<ChatMessage, "id" | "timestamp">, sessionId?: string) => string;
  updateMessage: (id: string, updates: Partial<ChatMessage>, sessionId?: string) => void;
  updateCandidateScores: (scoreMap: Record<string, CandidateScoreUpdate>, sessionId?: string) => void;
  setCurrentReport: (report: FeasibilityReport, sessionId?: string) => void;
  setCurrentReportGroup: (group: FeasibilityReportGroup, sessionId?: string) => void;
}

const CHAT_TIMEOUT_MS = 240_000;
const ANALYSE_TIMEOUT_MS = 300_000;

function normaliseAddressKey(address: string): string {
  return address.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function withHistoryMetadata(
  report: FeasibilityReport,
  searchId?: string | null,
  historyCreatedAt?: string | null,
): FeasibilityReport {
  if (!searchId && !historyCreatedAt) return report;
  return {
    ...report,
    historyId: searchId ?? report.historyId ?? null,
    historyCreatedAt: historyCreatedAt ?? report.historyCreatedAt ?? null,
  };
}

function withGroupHistoryMetadata(
  group: FeasibilityReportGroup,
  searchId?: string | null,
  historyCreatedAt?: string | null,
): FeasibilityReportGroup {
  if (!searchId && !historyCreatedAt) return group;
  return {
    ...group,
    historyId: searchId ?? group.historyId ?? null,
    historyCreatedAt: historyCreatedAt ?? group.historyCreatedAt ?? null,
    reports: group.reports.map((report) => withHistoryMetadata(report, searchId, historyCreatedAt)),
  };
}

function serializeSearchMessageForChat(message: ChatMessage): string {
  const results = (message.searchResults ?? [])
    .map((r) => `${r.address}||${r.listingUrl ?? ""}`)
    .join("; ");
  const parts = [`[Search results shown: ${results}]`];
  const aiIntro = message.aiIntro?.trim();
  if (aiIntro) parts.push(`[Assistant search note: ${aiIntro}]`);
  return parts.join("\n");
}

/** Build the /chat `messages` payload from a session's transcript + the new text. */
export function buildChatMessages(
  sessionMessages: ChatMessage[],
  text: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  return [
    ...sessionMessages
      .filter(
        (m) =>
          m.type === "text" ||
          m.type === "report" ||
          m.type === "report_group" ||
          m.type === "search" ||
          m.type === "agent_contact",
      )
      .map((m) => ({
        role: m.role,
        content:
          m.type === "text"
            ? m.content
            : m.type === "report"
              ? `[Feasibility report for ${m.report?.address || "property"}]`
              : m.type === "report_group"
                ? `[Combined listing reports shown: ${(m.reportGroup?.reports ?? []).map((r) => r.address).join("; ")}]`
                : m.type === "agent_contact"
                  ? `[Listing agent contact card shown for ${m.propertyAddress ?? "the property"}]`
                  : serializeSearchMessageForChat(m),
      })),
    { role: "user" as const, content: text },
  ];
}

interface ChatResponse {
  content?: string;
  mode?: string;
  type?: string;
  searchId?: string | null;
  historyCreatedAt?: string | null;
  report?: FeasibilityReport;
  reportGroup?: FeasibilityReportGroup;
  clarificationType?: string;
  question?: string;
  options?: string[];
  optionActions?: Array<"repeat_origin" | "search_nearby">;
  searchPresentation?: "generic_listing" | "scored_screening";
  suburb?: string | null;
}

interface AgentContactResponse {
  wantsAgentContact: boolean;
  found?: boolean;
  isListed?: boolean;
  matchType?: "subject" | "suburb" | null;
  listingAddress?: string | null;
  agentName?: string | null;
  agentPhone?: string | null;
  agencyName?: string | null;
  agentAvatarUrl?: string | null;
  listingUrl?: string | null;
}

export interface SendChatArgs {
  store: PipelineStore;
  sessionId: string;
  session: Session | null;
  text: string;
  displayText?: string;
  continuePresentation?: "generic_listing" | "scored_screening";
  discoveryChoiceSuburb?: string;
  /** Skip adding the visible user bubble (used by clarification chip taps). */
  hideUserBubble?: boolean;
  onScored?: (candidates: PropertyCandidate[], sessionId: string) => void;
  onSubscriptionRequired?: () => void;
}

/**
 * Core search/screening/analysis turn. Adds the user bubble + a loading bubble,
 * POSTs /chat, then fills the loading bubble with text / cards / a report /
 * clarification chips — mirroring the mobile pipeline (app/(tabs)/index.tsx).
 */
export async function sendChat(args: SendChatArgs): Promise<void> {
  const { store, sessionId, session, text } = args;
  if (!args.hideUserBubble) {
    store.addMessage({ role: "user", content: args.displayText ?? text, type: "text" }, sessionId);
  }
  const loadingId = store.addMessage(
    { role: "assistant", content: "", type: "loading", loadingMode: detectLoadingMode(text) },
    sessionId,
  );

  const messages = buildChatMessages(session?.messages ?? [], text);
  const currentReportContext = session?.currentReportGroup ?? session?.currentReport;

  try {
    if (session?.currentReport && !session.currentReportGroup) {
      const agentContact = await lookupAgentContact(session.currentReport, messages).catch(() => null);
      if (agentContact?.wantsAgentContact) {
        if (agentContact.found && agentContact.isListed && (agentContact.agentPhone || agentContact.listingUrl)) {
          store.updateMessage(
            loadingId,
            {
              role: "assistant",
              content: "",
              type: "agent_contact",
              agentName: agentContact.agentName ?? null,
              agentPhone: agentContact.agentPhone ?? null,
              agencyName: agentContact.agencyName ?? null,
              agentAvatarUrl: agentContact.agentAvatarUrl ?? null,
              propertyAddress: agentContact.listingAddress ?? session.currentReport.address,
              agentMatchType: agentContact.matchType ?? "subject",
              agentListingUrl: agentContact.listingUrl ?? null,
            },
            sessionId,
          );
          return;
        }

        const shortAddress = session.currentReport.address.split(",")[0] || session.currentReport.address;
        store.updateMessage(
          loadingId,
          {
            type: "text",
            content:
              agentContact.isListed === false
                ? `${shortAddress} is not currently on the market, so there is no active listing agent for this property.`
                : "I couldn't find a callable listing agent for this property.",
          },
          sessionId,
        );
        return;
      }
    }

    const data = await apiPost<ChatResponse>(
      "/chat",
      {
        messages,
        currentReport: currentReportContext,
        continuePresentation: args.continuePresentation,
        discoveryChoiceSuburb: args.discoveryChoiceSuburb,
      },
      { timeoutMs: CHAT_TIMEOUT_MS, redirectOn401: false },
    );

    applyChatResponse(data, { ...args, loadingId });
  } catch (e) {
    if (isApiError(e)) {
      if (e.status === 401) {
        store.updateMessage(loadingId, { type: "text", content: "Your session expired. Please sign in again." }, sessionId);
        return;
      }
      if (e.status === 402 || e.subscriptionRequired) {
        store.updateMessage(loadingId, { type: "text", content: e.message }, sessionId);
        args.onSubscriptionRequired?.();
        return;
      }
      if (e.status === 429) {
        store.updateMessage(loadingId, { type: "text", content: e.message }, sessionId);
        return;
      }
    }
    store.updateMessage(
      loadingId,
      { type: "text", content: "Couldn't reach the service. Please try again.", retryText: text },
      sessionId,
    );
  }
}

function applyChatResponse(data: ChatResponse, ctx: SendChatArgs & { loadingId: string }): void {
  const { store, sessionId, loadingId } = ctx;
  const mode = data.mode ?? data.type ?? "";

  // Direct structured fields (some /chat responses return report/reportGroup top-level).
  if (data.reportGroup && isFeasibilityReportGroup(data.reportGroup)) {
    const group = withGroupHistoryMetadata(data.reportGroup, data.searchId, data.historyCreatedAt);
    store.setCurrentReportGroup(group, sessionId);
    store.updateMessage(loadingId, { type: "report_group", reportGroup: group, content: "" }, sessionId);
    seedGroupScores(group, store, sessionId);
    return;
  }
  if (data.report && data.report.scores) {
    const report = withHistoryMetadata(data.report, data.searchId, data.historyCreatedAt);
    store.setCurrentReport(report, sessionId);
    store.updateMessage(loadingId, { type: "report", report, content: "" }, sessionId);
    if (report.address) store.updateCandidateScores({ [report.address]: report.scores }, sessionId);
    return;
  }

  // Clarification (top-level form).
  if (mode === "clarification" || data.clarificationType) {
    applyClarification(data, ctx);
    return;
  }

  // Otherwise parse `content` as JSON (report / report_group / discover payload).
  const rawContent = data.content ?? "";
  const trimmed = rawContent.trim();
  const hasJsonShape = /\{[\s\S]*\}|\[[\s\S]*\]/.test(trimmed);
  const parsed = hasJsonShape ? extractJSON(trimmed) : null;

  if (mode === "clarification") {
    applyClarificationFromContent(rawContent, ctx);
    return;
  }

  if (isFeasibilityReportGroup(parsed)) {
    const group = withGroupHistoryMetadata(parsed, data.searchId, data.historyCreatedAt);
    store.setCurrentReportGroup(group, sessionId);
    store.updateMessage(loadingId, { type: "report_group", reportGroup: group, content: "" }, sessionId);
    seedGroupScores(group, store, sessionId);
    return;
  }

  if (mode === "discover") {
    const payload = parsed as
      | { candidates?: PropertyCandidate[]; aiIntro?: string; searchPresentation?: "generic_listing" | "scored_screening"; suburb?: string; continuationToken?: string | null }
      | null;
    const aiIntro = payload?.aiIntro ?? "";
    if (payload?.candidates && payload.candidates.length > 0) {
      const presentation = payload.searchPresentation === "generic_listing" ? "generic_listing" : "scored_screening";
      store.updateMessage(
        loadingId,
        {
          type: "search",
          searchResults: payload.candidates,
          content: "",
          aiIntro,
          searchPresentation: presentation,
          suburb: payload.suburb,
          continuationToken: payload.continuationToken ?? null,
          showMoreStatus: "idle",
        },
        sessionId,
      );
      if (presentation !== "generic_listing") ctx.onScored?.(payload.candidates, sessionId);
    } else {
      store.updateMessage(loadingId, { type: "text", content: aiIntro || "No matching listings found right now." }, sessionId);
    }
    return;
  }

  if (mode === "analyse" && parsed && isFeasibilityReport(parsed)) {
    const report = withHistoryMetadata(parsed as FeasibilityReport, data.searchId, data.historyCreatedAt);
    store.setCurrentReport(report, sessionId);
    store.updateMessage(loadingId, { type: "report", report, content: "" }, sessionId);
    if (report.address) store.updateCandidateScores({ [report.address]: report.scores }, sessionId);
    return;
  }

  // Fallback: report-shaped content even when mode is unknown.
  if (isFeasibilityReport(parsed) && (parsed as FeasibilityReport).scores) {
    const report = withHistoryMetadata(parsed as FeasibilityReport, data.searchId, data.historyCreatedAt);
    store.setCurrentReport(report, sessionId);
    store.updateMessage(loadingId, { type: "report", report, content: "" }, sessionId);
    if (report.address) store.updateCandidateScores({ [report.address]: report.scores }, sessionId);
    return;
  }

  store.updateMessage(
    loadingId,
    { type: "text", content: sanitizeForDisplay(rawContent, "Could you clarify what you'd like to look at?") },
    sessionId,
  );
}

function applyClarification(data: ChatResponse, ctx: SendChatArgs & { loadingId: string }): void {
  const { store, sessionId, loadingId } = ctx;
  if (data.content && !data.clarificationType) {
    applyClarificationFromContent(data.content, ctx);
    return;
  }
  const ct = data.clarificationType;
  if (ct === "subdivision" && Array.isArray(data.options) && data.options.length > 0) {
    store.updateMessage(loadingId, { type: "subdivision_clarification", content: "", clarification: { question: data.question || "Which lot do you mean?", options: data.options } }, sessionId);
    return;
  }
  if (ct === "address" && Array.isArray(data.options)) {
    store.updateMessage(loadingId, { type: "address_clarification", content: "", clarification: { question: data.question || "Which address did you mean?", options: data.options } }, sessionId);
    return;
  }
  if (ct === "discovery_exhausted" && Array.isArray(data.options)) {
    store.updateMessage(loadingId, { type: "discovery_exhausted_choice", content: "", clarification: { question: data.question || "No more listings — what next?", options: data.options, optionActions: data.optionActions }, searchPresentation: data.searchPresentation ?? undefined, suburb: data.suburb ?? undefined }, sessionId);
    return;
  }
  store.updateMessage(loadingId, { type: "text", content: data.question || "Could you clarify?" }, sessionId);
}

function applyClarificationFromContent(content: string, ctx: SendChatArgs & { loadingId: string }): void {
  const { store, sessionId, loadingId } = ctx;
  try {
    const parsed = JSON.parse(content) as ChatResponse;
    applyClarification(parsed, ctx);
  } catch {
    store.updateMessage(loadingId, { type: "text", content: content || "Could you clarify?" }, sessionId);
  }
}

function seedGroupScores(group: FeasibilityReportGroup, store: PipelineStore, sessionId: string): void {
  for (const report of group.reports) {
    if (report.scores && report.address) store.updateCandidateScores({ [report.address]: report.scores }, sessionId);
  }
}

function detectLoadingMode(text: string): "analyse" | "discover" | "followup" {
  const lower = text.toLowerCase();
  if (/find|search|discover|looking for|subdivid|for sale|on the market|show me/.test(lower)) return "discover";
  if (/analys|feasibility|assess|evaluate|\d+\s+\w+\s+(road|street|ave|avenue|drive|lane|place|terrace|crescent|rd|st|dr|pl)/i.test(text)) return "analyse";
  return "followup";
}

async function lookupAgentContact(
  report: FeasibilityReport,
  messages: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<AgentContactResponse> {
  const selectedListingContext =
    report.selectedListingContext ??
    report.propertyOverview?.selectedListingContext ??
    null;
  return apiPost<AgentContactResponse>(
    "/agent-contact/lookup",
    {
      address: report.address,
      messages,
      listingUrl: selectedListingContext?.listingUrl ?? report.propertyOverview?.listingUrl ?? null,
      selectedListingContext,
    },
    { timeoutMs: 30_000, redirectOn401: false },
  );
}

// ── Full analysis (synchronous on web) ──────────────────────────────────────

export interface RunAnalyseArgs {
  store: PipelineStore;
  sessionId: string;
  session: Session | null;
  address: string;
  selectedListingUrl?: string | null;
  candidate?: PropertyCandidate | null;
  onSubscriptionRequired?: () => void;
}

interface AnalyseResponse {
  report?: FeasibilityReport;
  reportGroup?: FeasibilityReportGroup;
  type?: string;
  searchId?: string | null;
  historyCreatedAt?: string | null;
  clarificationType?: string;
  question?: string;
  options?: string[];
}

export async function runAnalyse(args: RunAnalyseArgs): Promise<void> {
  const { store, sessionId, session, address } = args;
  const loadingId = store.addMessage(
    { role: "assistant", content: "", type: "loading", loadingMode: "analyse", retryLabel: "Running full analysis…" },
    sessionId,
  );

  const conversationHistory = (session?.messages ?? [])
    .filter((m) => m.type === "text")
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content }));

  try {
    const data = await apiPost<AnalyseResponse>(
      "/analyse",
      {
        address,
        conversationHistory,
        selectedListingUrl: args.selectedListingUrl ?? args.candidate?.listingUrl ?? null,
        selectedListingContext: args.candidate ? selectedListingContextFromCandidate(args.candidate) : null,
        async: false,
      },
      { timeoutMs: ANALYSE_TIMEOUT_MS, redirectOn401: false },
    );

    if (data.reportGroup && isFeasibilityReportGroup(data.reportGroup)) {
      const group = withGroupHistoryMetadata(data.reportGroup, data.searchId, data.historyCreatedAt);
      store.setCurrentReportGroup(group, sessionId);
      store.updateMessage(loadingId, { type: "report_group", reportGroup: group, content: "" }, sessionId);
      seedGroupScores(group, store, sessionId);
      return;
    }
    if (data.report && data.report.scores) {
      const report = withHistoryMetadata(data.report, data.searchId, data.historyCreatedAt);
      store.setCurrentReport(report, sessionId);
      store.updateMessage(loadingId, { type: "report", report, content: "" }, sessionId);
      if (report.address) store.updateCandidateScores({ [report.address]: report.scores }, sessionId);
      return;
    }
    if (data.type === "clarification" && Array.isArray(data.options) && data.options.length > 0) {
      const type = data.clarificationType === "address" ? "address_clarification" : "subdivision_clarification";
      store.updateMessage(loadingId, { type, content: "", clarification: { question: data.question || "Which one?", options: data.options } }, sessionId);
      return;
    }
    store.updateMessage(loadingId, { type: "text", content: "Couldn't complete the analysis. Please try again." }, sessionId);
  } catch (e) {
    if (isApiError(e) && (e.status === 402 || e.subscriptionRequired)) {
      store.updateMessage(loadingId, { type: "text", content: e.message }, sessionId);
      args.onSubscriptionRequired?.();
      return;
    }
    store.updateMessage(loadingId, { type: "text", content: "Couldn't complete the analysis. Please try again." }, sessionId);
  }
}

// ── Discovery "Show more" ────────────────────────────────────────────────────

export interface ShowMoreArgs {
  store: PipelineStore;
  sessionId: string;
  message: ChatMessage;
  onScored?: (candidates: PropertyCandidate[], sessionId: string) => void;
}

export async function handleShowMore(args: ShowMoreArgs): Promise<void> {
  const { store, sessionId, message } = args;
  if (!message.continuationToken || message.showMoreStatus === "loading") return;
  store.updateMessage(message.id, { showMoreStatus: "loading" }, sessionId);

  try {
    const data = await apiPost<{
      candidates?: PropertyCandidate[];
      continuationToken?: string | null;
      exhausted?: boolean;
      suburb?: string;
      clarification?: { question: string; options: string[]; optionActions?: Array<"repeat_origin" | "search_nearby"> };
    }>(
      "/discovery/next",
      { continuationToken: message.continuationToken, shownCandidates: message.searchResults ?? [], count: 6 },
      { timeoutMs: CHAT_TIMEOUT_MS, redirectOn401: false },
    );

    const incoming = data.candidates ?? [];
    if (incoming.length === 0) {
      store.updateMessage(message.id, { continuationToken: data.continuationToken ?? null, showMoreStatus: "idle" }, sessionId);
      store.addMessage(
        {
          role: "assistant",
          content: "",
          type: "discovery_exhausted_choice",
          clarification: data.clarification ?? { question: "No more listings here — see them again or search nearby?", options: ["See again", "Search nearby"], optionActions: ["repeat_origin", "search_nearby"] },
          searchPresentation: message.searchPresentation,
          suburb: message.suburb,
        },
        sessionId,
      );
      return;
    }

    // Dedupe against already-shown (by listing URL or normalised address).
    const seen = new Set<string>();
    for (const ex of message.searchResults ?? []) {
      const url = ex.listingUrl?.trim().toLowerCase();
      if (url) seen.add(url);
      const k = normaliseAddressKey(ex.address);
      if (k) seen.add(k);
    }
    const deduped = incoming.filter((c) => {
      const url = c.listingUrl?.trim().toLowerCase();
      const k = normaliseAddressKey(c.address);
      if ((url && seen.has(url)) || (k && seen.has(k))) return false;
      if (url) seen.add(url);
      if (k) seen.add(k);
      return true;
    });

    store.updateMessage(
      message.id,
      {
        searchResults: [...(message.searchResults ?? []), ...deduped],
        continuationToken: data.continuationToken ?? null,
        ...(data.suburb ? { suburb: data.suburb } : {}),
        showMoreStatus: "idle",
      },
      sessionId,
    );
    if (message.searchPresentation !== "generic_listing" && deduped.length > 0) {
      args.onScored?.(deduped, sessionId);
    }
  } catch {
    store.updateMessage(message.id, { showMoreStatus: "idle" }, sessionId);
  }
}

// ── Card score backfill polling ──────────────────────────────────────────────

interface CardScoreResult {
  address: string;
  status: string;
  scores?: { ease: number; cost: number; roi: number; composite: number };
  landArea?: number;
  zone?: string | null;
  potentialLots?: number;
  minLotSize?: number | null;
  standardVacantLots?: number;
  standardPathViable?: boolean;
  standardMinLotSize?: number | null;
  designLedEligible?: boolean;
  designLedYieldRange?: { min: number; max: number } | null;
  designLedConfidence?: "none" | "low" | "medium";
  designLedReasons?: string[];
  designLedBlockers?: string[];
  designLedSummary?: string | null;
  designLedDetail?: string | null;
}

/**
 * Polls /analyse/card-scores until every candidate resolves (or 20 tries).
 * Returns a cancel fn. Mirrors startCardScorePoll in the mobile app.
 */
export function pollCardScores(
  candidates: Array<Pick<PropertyCandidate, "address" | "listingUrl">>,
  sessionId: string,
  store: PipelineStore,
): () => void {
  const addresses = candidates.map((c) => c.address);
  let attempts = 0;
  let stopped = false;
  const MAX = 20;

  const poll = async () => {
    if (stopped) return;
    attempts += 1;
    if (attempts > MAX) {
      clearInterval(timer);
      return;
    }
    try {
      const params = addresses.map((a) => `addresses[]=${encodeURIComponent(a)}`).join("&");
      const urlParams = candidates.map((c) => `urls[]=${encodeURIComponent(c.listingUrl ?? "")}`).join("&");
      const results = await apiGet<CardScoreResult[]>(
        `/analyse/card-scores?${params}${urlParams ? `&${urlParams}` : ""}`,
        { redirectOn401: false },
      );
      const ready: Record<string, CandidateScoreUpdate> = {};
      let allDone = results.length > 0;
      for (const r of results) {
        if (r.status === "pending") {
          allDone = false;
          continue;
        }
        if (r.status === "ready" && r.scores) {
          ready[r.address] = {
            ...r.scores,
            ...(r.landArea != null ? { landArea: r.landArea } : {}),
            ...(r.zone !== undefined ? { zone: r.zone } : {}),
            ...(r.potentialLots != null ? { potentialLots: r.potentialLots } : {}),
            ...(r.minLotSize !== undefined ? { minLotSize: r.minLotSize } : {}),
            ...(r.standardVacantLots != null ? { standardVacantLots: r.standardVacantLots } : {}),
            ...(r.standardPathViable !== undefined ? { standardPathViable: r.standardPathViable } : {}),
            ...(r.standardMinLotSize !== undefined ? { standardMinLotSize: r.standardMinLotSize } : {}),
            ...(r.designLedEligible !== undefined ? { designLedEligible: r.designLedEligible } : {}),
            ...(r.designLedYieldRange !== undefined ? { designLedYieldRange: r.designLedYieldRange } : {}),
            ...(r.designLedConfidence !== undefined ? { designLedConfidence: r.designLedConfidence } : {}),
            ...(r.designLedReasons !== undefined ? { designLedReasons: r.designLedReasons } : {}),
            ...(r.designLedBlockers !== undefined ? { designLedBlockers: r.designLedBlockers } : {}),
            ...(r.designLedSummary !== undefined ? { designLedSummary: r.designLedSummary } : {}),
            ...(r.designLedDetail !== undefined ? { designLedDetail: r.designLedDetail } : {}),
          };
        }
      }
      if (Object.keys(ready).length > 0) store.updateCandidateScores(ready, sessionId);
      if (allDone) clearInterval(timer);
    } catch {
      /* keep polling */
    }
  };

  const timer = setInterval(poll, 4000);
  void poll();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
