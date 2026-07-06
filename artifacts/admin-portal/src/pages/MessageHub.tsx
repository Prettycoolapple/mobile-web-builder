import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface Provider {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  companyName: string | null;
  discipline: string | null;
}

interface DmMessageRow {
  id: string;
  threadId: string;
  senderId: string;
  body: string | null;
  imageUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  createdAt: string;
}

interface ThreadRow {
  threadId: string;
  createdAt: string;
  lastMessageAt: string | null;
  otherParticipant: { id: string; email: string; fullName: string | null; avatarUrl: string | null } | null;
  lastMessage: DmMessageRow | null;
  unreadCount: number;
}

const THREAD_POLL_MS = 15000;
const MESSAGE_POLL_MS = 5000;

export default function MessageHubPage() {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);

  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [messages, setMessages] = useState<DmMessageRow[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    apiGet<{ providers: Provider[] }>("/admin/message-hub/providers")
      .then((d) => {
        setProviders(d.providers);
        setProvidersError(null);
        if (d.providers.length > 0) setSelectedProviderId((prev) => prev ?? d.providers[0].id);
      })
      .catch((err) => setProvidersError(err instanceof Error ? err.message : "Failed to load accounts"));
  }, []);

  const loadThreads = useCallback(() => {
    if (!selectedProviderId) return;
    apiGet<{ rows: ThreadRow[] }>(`/admin/message-hub/providers/${selectedProviderId}/threads?limit=100`)
      .then((d) => {
        setThreads(d.rows);
        setThreadsError(null);
      })
      .catch((err) => setThreadsError(err instanceof Error ? err.message : "Failed to load conversations"));
  }, [selectedProviderId]);

  useEffect(() => {
    setThreads(null);
    setSelectedThreadId(null);
    setMessages(null);
    loadThreads();
    const timer = window.setInterval(loadThreads, THREAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadThreads]);

  const loadMessages = useCallback(() => {
    if (!selectedProviderId || !selectedThreadId) return;
    apiGet<{ messages: DmMessageRow[] }>(
      `/admin/message-hub/threads/${selectedThreadId}/messages?providerId=${selectedProviderId}&limit=200`,
    )
      .then((d) => {
        setMessages([...d.messages].reverse());
        setMessagesError(null);
      })
      .catch((err) => setMessagesError(err instanceof Error ? err.message : "Failed to load messages"));
  }, [selectedProviderId, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !selectedProviderId) return;
    setMessages(null);
    loadMessages();
    apiPatch("/admin/message-hub/threads/" + selectedThreadId + "/read", { providerId: selectedProviderId }).catch(
      () => {},
    );
    const timer = window.setInterval(loadMessages, MESSAGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedThreadId, selectedProviderId, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || !selectedProviderId || !selectedThreadId || sending) return;
    setSending(true);
    try {
      await apiPost(`/admin/message-hub/threads/${selectedThreadId}/messages`, {
        providerId: selectedProviderId,
        body: trimmed,
      });
      setDraft("");
      loadMessages();
      loadThreads();
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  const selectedThread = threads?.find((t) => t.threadId === selectedThreadId) ?? null;

  return (
    <>
      <h1 style={{ marginBottom: 4 }}>Message Hub</h1>
      <p className="subtitle">
        Switch between service-provider accounts and reply to their conversations without logging in and out.
      </p>

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mh-shell">
          <div className="mh-accounts">
            <div className="mh-column-title">Accounts</div>
            {providersError && <div className="empty">{providersError}</div>}
            {!providers && !providersError && <div className="empty">Loading…</div>}
            {providers?.length === 0 && <div className="empty">No service-provider accounts yet.</div>}
            {providers?.map((p) => (
              <button
                key={p.id}
                className={`mh-account-item${p.id === selectedProviderId ? " active" : ""}`}
                onClick={() => setSelectedProviderId(p.id)}
              >
                <div className="mh-account-name">{p.fullName ?? p.email}</div>
                <div className="mh-account-sub">{p.companyName ?? p.discipline ?? p.email}</div>
              </button>
            ))}
          </div>

          <div className="mh-threads">
            <div className="mh-column-title">Conversations</div>
            {threadsError && <div className="empty">{threadsError}</div>}
            {!threads && !threadsError && <div className="empty">Loading…</div>}
            {threads?.length === 0 && <div className="empty">No conversations for this account yet.</div>}
            {threads?.map((t) => (
              <button
                key={t.threadId}
                className={`mh-thread-item${t.threadId === selectedThreadId ? " active" : ""}`}
                onClick={() => setSelectedThreadId(t.threadId)}
              >
                <div className="mh-thread-row">
                  <div className="mh-thread-name">{t.otherParticipant?.fullName ?? t.otherParticipant?.email ?? "Unknown user"}</div>
                  {t.unreadCount > 0 && <span className="mh-unread-badge">{t.unreadCount}</span>}
                </div>
                <div className="mh-thread-preview">
                  {t.lastMessage?.body ?? (t.lastMessage?.fileUrl ? "📄 File" : t.lastMessage?.imageUrl ? "📷 Photo" : "No messages yet")}
                </div>
                <div className="mh-thread-time">
                  {t.lastMessageAt ? relativeTime(t.lastMessageAt) : relativeTime(t.createdAt)}
                </div>
              </button>
            ))}
          </div>

          <div className="mh-conversation">
            {!selectedThreadId && <div className="empty">Select a conversation to view messages.</div>}
            {selectedThreadId && (
              <>
                <div className="mh-conversation-header">
                  <div style={{ fontWeight: 600 }}>
                    {selectedThread?.otherParticipant?.fullName ?? selectedThread?.otherParticipant?.email ?? "Conversation"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{selectedThread?.otherParticipant?.email}</div>
                </div>
                <div className="mh-conversation-body">
                  {messagesError && <div className="empty">{messagesError}</div>}
                  {!messages && !messagesError && <div className="empty">Loading…</div>}
                  {messages?.map((m) => {
                    const fromProvider = m.senderId === selectedProviderId;
                    return (
                      <div key={m.id} className={`mh-bubble-row${fromProvider ? " mine" : ""}`}>
                        <div className={`mh-bubble${fromProvider ? " mine" : ""}`} title={formatDate(m.createdAt)}>
                          {m.body ?? (m.fileUrl ? `📄 ${m.fileName ?? "File"}` : m.imageUrl ? "📷 Photo" : "")}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                <div className="mh-composer">
                  <textarea
                    className="mh-composer-input"
                    placeholder={`Reply as ${selectedThread?.otherParticipant ? providers?.find((p) => p.id === selectedProviderId)?.fullName ?? "provider" : "provider"}…`}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  <button className="btn primary" disabled={!draft.trim() || sending} onClick={handleSend}>
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
