import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

type AccountRole = "service_provider" | "sales_agent";
type AccountFilter = "all" | AccountRole;

interface MessageHubAccount {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: AccountRole;
  companyName: string | null;
  discipline: string | null;
  agencyName: string | null;
  unreadCount: number;
}

interface DmMessageRow {
  id: string;
  threadId: string;
  senderId: string;
  body: string | null;
  imageUrl: string | null;
  fileUrl: string | null;
  fileName: string | null;
  fileMime: string | null;
  likedAt: string | null;
  likedBy: string | null;
  createdAt: string;
}

interface ThreadRow {
  threadId: string;
  createdAt: string;
  lastMessageAt: string | null;
  otherParticipant: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
  } | null;
  lastMessage: DmMessageRow | null;
  unreadCount: number;
}

const THREAD_POLL_MS = 15000;
const MESSAGE_POLL_MS = 5000;
const NEW_CHAT_POLL_MS = 15000;
const MH_LAST_SEEN_KEY = "admin.messageHub.lastSeenAt";

export default function MessageHubPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [accounts, setAccounts] = useState<MessageHubAccount[] | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );

  const [threads, setThreads] = useState<ThreadRow[] | null>(null);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);

  const [messages, setMessages] = useState<DmMessageRow[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const openedAtRef = useRef(new Date().toISOString());
  const [liveNewChatsCount, setLiveNewChatsCount] = useState(0);

  const requestedAccountId = searchParams.get("accountId");
  const requestedThreadId = searchParams.get("threadId");

  // Mark this visit as "seen" so the sidebar badge clears, and keep nudging
  // the marker forward while the page stays open so chats that arrive during
  // this visit don't re-trigger the badge the moment the admin navigates away.
  useEffect(() => {
    localStorage.setItem(MH_LAST_SEEN_KEY, openedAtRef.current);
    let cancelled = false;
    function poll() {
      apiGet<{ total: number }>(
        `/admin/message-hub/new-chats-count?since=${encodeURIComponent(openedAtRef.current)}`,
      )
        .then((data) => {
          if (!cancelled) setLiveNewChatsCount(data.total);
        })
        .catch(() => {});
      localStorage.setItem(MH_LAST_SEEN_KEY, new Date().toISOString());
    }
    const timer = window.setInterval(poll, NEW_CHAT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      localStorage.setItem(MH_LAST_SEEN_KEY, new Date().toISOString());
    };
  }, []);

  useEffect(() => {
    apiGet<{ accounts: MessageHubAccount[] }>("/admin/message-hub/accounts")
      .then((data) => {
        setAccounts(data.accounts);
        setAccountsError(null);
        setSelectedAccountId((current) => {
          if (
            current &&
            data.accounts.some((account) => account.id === current)
          )
            return current;
          if (
            requestedAccountId &&
            data.accounts.some((account) => account.id === requestedAccountId)
          ) {
            return requestedAccountId;
          }
          return data.accounts[0]?.id ?? null;
        });
      })
      .catch((err) =>
        setAccountsError(
          err instanceof Error ? err.message : "Failed to load accounts",
        ),
      );
  }, []); // Deep-link values are intentionally read only on initial load.

  const selectedAccount =
    accounts?.find((account) => account.id === selectedAccountId) ?? null;
  const filteredAccounts = useMemo(() => {
    if (!accounts) return null;
    return accountFilter === "all"
      ? accounts
      : accounts.filter((account) => account.role === accountFilter);
  }, [accountFilter, accounts]);

  function selectAccount(accountId: string) {
    setSelectedAccountId(accountId);
    setSelectedThreadId(null);
    const params = new URLSearchParams(searchParams);
    params.set("accountId", accountId);
    params.delete("threadId");
    setSearchParams(params, { replace: true });
  }

  function selectThread(threadId: string) {
    setSelectedThreadId(threadId);
    const params = new URLSearchParams(searchParams);
    if (selectedAccountId) params.set("accountId", selectedAccountId);
    params.set("threadId", threadId);
    setSearchParams(params, { replace: true });
  }

  const loadThreads = useCallback(() => {
    if (!selectedAccountId) return;
    apiGet<{ rows: ThreadRow[] }>(
      `/admin/message-hub/accounts/${selectedAccountId}/threads?limit=100`,
    )
      .then((data) => {
        setThreads(data.rows);
        setThreadsError(null);
        setSelectedThreadId((current) => {
          if (
            current &&
            data.rows.some((thread) => thread.threadId === current)
          )
            return current;
          if (
            requestedThreadId &&
            data.rows.some((thread) => thread.threadId === requestedThreadId)
          ) {
            return requestedThreadId;
          }
          return null;
        });
      })
      .catch((err) =>
        setThreadsError(
          err instanceof Error ? err.message : "Failed to load conversations",
        ),
      );
  }, [requestedThreadId, selectedAccountId]);

  useEffect(() => {
    setThreads(null);
    setSelectedThreadId(null);
    setMessages(null);
    loadThreads();
    const timer = window.setInterval(loadThreads, THREAD_POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadThreads]);

  const loadMessages = useCallback(() => {
    if (!selectedAccountId || !selectedThreadId) return;
    apiGet<{ messages: DmMessageRow[] }>(
      `/admin/message-hub/threads/${selectedThreadId}/messages?accountId=${selectedAccountId}&limit=200`,
    )
      .then((data) => {
        setMessages([...data.messages].reverse());
        setMessagesError(null);
      })
      .catch((err) =>
        setMessagesError(
          err instanceof Error ? err.message : "Failed to load messages",
        ),
      );
  }, [selectedAccountId, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !selectedAccountId) return;
    setMessages(null);
    loadMessages();
    if (selectedAccount?.role === "service_provider") {
      apiPatch(`/admin/message-hub/threads/${selectedThreadId}/read`, {
        accountId: selectedAccountId,
      }).catch(() => {});
    }
    const timer = window.setInterval(loadMessages, MESSAGE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [
    selectedAccount?.role,
    selectedAccountId,
    selectedThreadId,
    loadMessages,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function handleSend() {
    const trimmed = draft.trim();
    if (
      !trimmed ||
      !selectedAccountId ||
      !selectedThreadId ||
      sending ||
      selectedAccount?.role !== "service_provider"
    ) {
      return;
    }
    setSending(true);
    try {
      await apiPost(`/admin/message-hub/threads/${selectedThreadId}/messages`, {
        accountId: selectedAccountId,
        body: trimmed,
      });
      setDraft("");
      loadMessages();
      loadThreads();
    } catch (err) {
      setMessagesError(
        err instanceof Error ? err.message : "Failed to send message",
      );
    } finally {
      setSending(false);
    }
  }

  const selectedThread =
    threads?.find((thread) => thread.threadId === selectedThreadId) ?? null;

  return (
    <>
      <h1>
        Message Hub
        {liveNewChatsCount > 0 && (
          <span
            className="mh-new-chat-dot"
            title={`${liveNewChatsCount} new conversation${liveNewChatsCount === 1 ? "" : "s"} since you opened this page`}
          />
        )}
      </h1>
      <p className="subtitle">
        Review provider and sales-agent conversations. Real sales-agent
        histories are read-only to admins.
        {liveNewChatsCount > 0 &&
          ` ${liveNewChatsCount} new conversation${liveNewChatsCount === 1 ? "" : "s"} started since you opened this page.`}
      </p>

      <div className="panel mh-filter-panel">
        <div className="toggle" aria-label="Filter Message Hub accounts">
          {(
            [
              ["all", "All"],
              ["service_provider", "Service providers"],
              ["sales_agent", "Sales agents"],
            ] as Array<[AccountFilter, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              className={accountFilter === value ? "active" : ""}
              onClick={() => setAccountFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mh-shell">
          <div className="mh-accounts">
            <div className="mh-column-title">Accounts</div>
            {accountsError && <div className="empty">{accountsError}</div>}
            {!filteredAccounts && !accountsError && (
              <div className="empty">Loading...</div>
            )}
            {filteredAccounts?.length === 0 && (
              <div className="empty">No matching accounts.</div>
            )}
            {filteredAccounts?.map((account) => (
              <button
                key={account.id}
                className={`mh-account-item${account.id === selectedAccountId ? " active" : ""}`}
                onClick={() => selectAccount(account.id)}
              >
                <div className="mh-account-row">
                  <div className="mh-account-name">
                    {account.fullName ?? account.email}
                  </div>
                  {account.unreadCount > 0 && (
                    <span className="mh-unread-badge">
                      {account.unreadCount}
                    </span>
                  )}
                </div>
                <div className="mh-account-sub">
                  {account.role === "sales_agent"
                    ? "Sales agent"
                    : "Service provider"}
                  {` · ${account.agencyName ?? account.companyName ?? account.discipline ?? account.email}`}
                </div>
              </button>
            ))}
          </div>

          <div className="mh-threads">
            <div className="mh-column-title">Conversations</div>
            {threadsError && <div className="empty">{threadsError}</div>}
            {!threads && !threadsError && (
              <div className="empty">Loading...</div>
            )}
            {threads?.length === 0 && (
              <div className="empty">
                No conversations for this account yet.
              </div>
            )}
            {threads?.map((thread) => (
              <button
                key={thread.threadId}
                className={`mh-thread-item${thread.threadId === selectedThreadId ? " active" : ""}`}
                onClick={() => selectThread(thread.threadId)}
              >
                <div className="mh-thread-row">
                  <div className="mh-thread-name">
                    {thread.createdAt > openedAtRef.current && (
                      <span
                        className="mh-new-chat-dot"
                        title="New conversation"
                      />
                    )}
                    {thread.otherParticipant?.fullName ??
                      thread.otherParticipant?.email ??
                      "Unknown user"}
                  </div>
                  {thread.unreadCount > 0 && (
                    <span className="mh-unread-badge">
                      {thread.unreadCount}
                    </span>
                  )}
                </div>
                <div className="mh-thread-preview">
                  {thread.lastMessage?.body ??
                    (thread.lastMessage?.fileUrl
                      ? "File"
                      : thread.lastMessage?.imageUrl
                        ? "Photo"
                        : "No messages yet")}
                </div>
                <div className="mh-thread-time">
                  {thread.lastMessageAt
                    ? relativeTime(thread.lastMessageAt)
                    : relativeTime(thread.createdAt)}
                </div>
              </button>
            ))}
          </div>

          <div className="mh-conversation">
            {!selectedThreadId && (
              <div className="empty">
                Select a conversation to view messages.
              </div>
            )}
            {selectedThreadId && (
              <>
                <div className="mh-conversation-header">
                  <div style={{ fontWeight: 600 }}>
                    {selectedThread?.otherParticipant?.fullName ??
                      selectedThread?.otherParticipant?.email ??
                      "Conversation"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    {selectedThread?.otherParticipant?.email}
                  </div>
                  {selectedAccount?.role === "sales_agent" && (
                    <span className="mh-readonly-badge">Read-only</span>
                  )}
                </div>
                <div className="mh-conversation-body">
                  {messagesError && (
                    <div className="empty">{messagesError}</div>
                  )}
                  {!messages && !messagesError && (
                    <div className="empty">Loading...</div>
                  )}
                  {messages?.map((message) => {
                    const fromAccount = message.senderId === selectedAccountId;
                    return (
                      <div
                        key={message.id}
                        className={`mh-bubble-row${fromAccount ? " mine" : ""}`}
                      >
                        <div
                          className={`mh-bubble${fromAccount ? " mine" : ""}`}
                          title={formatDate(message.createdAt)}
                        >
                          {message.body && <div>{message.body}</div>}
                          {message.fileUrl && (
                            <a
                              className="mh-attachment"
                              href={message.fileUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {message.fileName ?? "Open file"}
                            </a>
                          )}
                          {message.imageUrl && (
                            <a
                              href={message.imageUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                className="mh-image"
                                src={message.imageUrl}
                                alt="Chat attachment"
                              />
                            </a>
                          )}
                          <div className="mh-message-meta">
                            <span>{formatDate(message.createdAt)}</span>
                            {message.likedAt && (
                              <span
                                title={`Liked ${formatDate(message.likedAt)}`}
                              >
                                ♥ Liked
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
                {selectedAccount?.role === "service_provider" ? (
                  <div className="mh-composer">
                    <textarea
                      className="mh-composer-input"
                      placeholder={`Reply as ${selectedAccount.fullName ?? "provider"}...`}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          handleSend();
                        }
                      }}
                    />
                    <button
                      className="btn primary"
                      disabled={!draft.trim() || sending}
                      onClick={handleSend}
                    >
                      {sending ? "Sending..." : "Send"}
                    </button>
                  </div>
                ) : (
                  <div className="mh-readonly-note">
                    Admins can review this sales-agent conversation but cannot
                    send or mark it read.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
