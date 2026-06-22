import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChatStore } from "@/state/ChatStore";
import { setPdfExportTarget } from "@/lib/pdfExportTarget";
import { clearSession, displayName, getUser, initialsFor, redirectToLogin } from "@/lib/auth";
import {
  handleShowMore,
  pollCardScores,
  runAnalyse,
  sendChat,
  type PipelineStore,
} from "@/lib/pipeline";
import type { ChatMessage, PropertyCandidate } from "@/state/chat-model";
import { SearchBar } from "@/components/chat/SearchBar";
import { MessageBubble, type MessageActions } from "@/components/chat/MessageBubble";
import { HistorySidebar } from "@/components/history/HistorySidebar";

const SUGGESTIONS = [
  "What's for sale in Mount Eden?",
  "Find subdividable sites in Papatoetoe",
  "Analyse 12 Riddell Road, Glendowie",
];

export function WorkspacePage() {
  const store = useChatStore();
  const {
    sessions,
    currentSession,
    currentSessionId,
    createSession,
    addMessage,
    updateMessage,
    updateCandidateScores,
    setCurrentReport,
    setCurrentReportGroup,
    loading,
  } = store;

  const user = getUser();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [analysingAddress, setAnalysingAddress] = useState<string | null>(null);
  const [gate, setGate] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const pollCancels = useRef<Array<() => void>>([]);

  const pipelineStore: PipelineStore = {
    addMessage,
    updateMessage,
    updateCandidateScores,
    setCurrentReport,
    setCurrentReportGroup,
  };

  useEffect(() => {
    return () => pollCancels.current.forEach((c) => c());
  }, []);

  // Keep the thread pinned to the latest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [currentSession?.messages]);

  const startScorePoll = useCallback(
    (candidates: PropertyCandidate[], sessionId: string) => {
      const cancel = pollCardScores(
        candidates.map((c) => ({ address: c.address, listingUrl: c.listingUrl })),
        sessionId,
        pipelineStore,
      );
      pollCancels.current.push(cancel);
    },
    // pipelineStore is rebuilt each render but its members are stable callbacks
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const ensureSession = useCallback((): string => {
    return currentSessionId ?? createSession();
  }, [currentSessionId, createSession]);

  const handleSend = useCallback(
    (text: string) => {
      const sid = ensureSession();
      const session = sessions.find((s) => s.id === sid) ?? null;
      void sendChat({
        store: pipelineStore,
        sessionId: sid,
        session,
        text,
        onScored: startScorePoll,
        onSubscriptionRequired: () => setGate(true),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureSession, sessions],
  );

  const handleAnalyse = useCallback(
    (candidate: PropertyCandidate) => {
      const sid = ensureSession();
      const session = sessions.find((s) => s.id === sid) ?? null;
      setAnalysingAddress(candidate.address);
      void runAnalyse({
        store: pipelineStore,
        sessionId: sid,
        session,
        address: candidate.address,
        candidate,
        selectedListingUrl: candidate.listingUrl ?? null,
        onSubscriptionRequired: () => setGate(true),
      }).finally(() => setAnalysingAddress(null));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureSession, sessions],
  );

  const handleChip = useCallback(
    (message: ChatMessage, option: string) => {
      const sid = ensureSession();
      const session = sessions.find((s) => s.id === sid) ?? null;
      const isDiscoveryChoice = message.type === "discovery_exhausted_choice";
      void sendChat({
        store: pipelineStore,
        sessionId: sid,
        session,
        text: option,
        continuePresentation: isDiscoveryChoice ? message.searchPresentation : undefined,
        discoveryChoiceSuburb: isDiscoveryChoice ? message.suburb : undefined,
        onScored: startScorePoll,
        onSubscriptionRequired: () => setGate(true),
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ensureSession, sessions],
  );

  const handleShowMoreClick = useCallback(
    (message: ChatMessage) => {
      if (!currentSessionId) return;
      void handleShowMore({ store: pipelineStore, sessionId: currentSessionId, message, onScored: startScorePoll });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSessionId],
  );

  const handleExportPdf = useCallback(
    (message: ChatMessage) => {
      if (!message.report) return;
      setPdfExportTarget(message.report);
      navigate("/report-pdf");
    },
    [navigate],
  );

  const actions: MessageActions = {
    onAnalyse: handleAnalyse,
    onChip: handleChip,
    onShowMore: handleShowMoreClick,
    onExportPdf: handleExportPdf,
    analysingAddress,
  };

  const messages = currentSession?.messages ?? [];
  const showHero = !currentSession || messages.length === 0;

  return (
    <div className="ws-shell">
      <HistorySidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      <div className="ws-main">
        <div className="ws-topbar">
          <span className="spacer" />
          {gate && (
            <a className="btn btn-quiet" href="/provider-portal/" style={{ borderColor: "var(--amber)", color: "#9a6a16" }}>
              Subscription required — Manage ↗
            </a>
          )}
          <div className="ws-user-chip">
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--forest)",
                color: "#fff",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {initialsFor(displayName(user))}
            </span>
            {displayName(user)}
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              clearSession();
              redirectToLogin();
            }}
          >
            Sign out
          </button>
        </div>

        {showHero ? (
          <div className="ws-hero">
            <h1 className="ws-hero-title">What can I help you develop?</h1>
            <p className="ws-hero-sub">
              Search live listings, screen suburbs for subdivision potential, and run full feasibility analysis — all
              synced with your mobile app.
            </p>
            <div style={{ width: "100%", maxWidth: 720 }}>
              <SearchBar onSubmit={handleSend} autoFocus disabled={loading} />
            </div>
            <div className="ws-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ws-suggestion" onClick={() => handleSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="ws-thread" ref={threadRef}>
              <div className="ws-thread-inner">
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} actions={actions} />
                ))}
              </div>
            </div>
            <div className="ws-composer">
              <div className="ws-composer-inner">
                <SearchBar onSubmit={handleSend} />
                <p className="ws-composer-hint">
                  Project Alpha can make mistakes. Verify critical figures before relying on them.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
