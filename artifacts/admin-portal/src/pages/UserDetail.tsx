import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPatch } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

type Tab = "feedback" | "addresses" | "agent_calls";

interface UserDetailResponse {
  profile: {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    languages: string[] | null;
    phoneNumber: string | null;
    subscriptionTier: string;
    planLabel: string;
    specialStatus: string | null;
    specialStatusExpiresAt: string | null;
    isVerified: boolean;
    createdAt: string;
    lastLoginAt: string | null;
    reportsUsedThisMonth: number;
  };
  counts: {
    feasibilityReports: number;
    agentCalls: number;
    thumbsDown: number;
    callsPerReport: number;
    recommendationCount: number | null;
  };
}

interface FeedbackRow {
  id: string;
  createdAt: string;
  responseMode: string | null;
  reason: string | null;
}

interface AddressRow {
  id: string;
  createdAt: string;
  queryAddress: string;
  analysisAddress: string;
  status: string;
}

interface AgentCallRow {
  id: string;
  createdAt: string;
  agentName: string | null;
  agencyName: string | null;
  agentPhone: string | null;
  propertyAddress: string | null;
}

interface ListResponse<T> {
  total: number;
  limit: number;
  offset: number;
  rows: T[];
}

const PAGE_SIZE = 20;

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 16,
        minWidth: 160,
        flex: 1,
      }}
    >
      <div style={{ fontSize: 12, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--muted)" }}>{hint}</div>}
    </div>
  );
}

function SpecialStatusPill({ status, expiresAt }: { status: string | null; expiresAt: string | null }) {
  if (status === "friends_family") {
    return <span className="badge special-ff">Friends &amp; Family</span>;
  }
  if (status === "supercharge") {
    const expLabel = expiresAt ? `expires ${formatDate(expiresAt)}` : "";
    return (
      <span className="badge special-sc" title={expLabel}>
        Supercharge{expLabel ? ` · ${expLabel}` : ""}
      </span>
    );
  }
  return null;
}

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const [data, setData] = useState<UserDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("feedback");

  const [recCountInput, setRecCountInput] = useState<string>("");
  const [recCountSaving, setRecCountSaving] = useState(false);
  const [recCountError, setRecCountError] = useState<string | null>(null);

  // Sub-list state — each tab has its own pagination
  const [feedbackList, setFeedbackList] = useState<ListResponse<FeedbackRow> | null>(null);
  const [feedbackOffset, setFeedbackOffset] = useState(0);
  const [addressList, setAddressList] = useState<ListResponse<AddressRow> | null>(null);
  const [addressOffset, setAddressOffset] = useState(0);
  const [callList, setCallList] = useState<ListResponse<AgentCallRow> | null>(null);
  const [callOffset, setCallOffset] = useState(0);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    apiGet<UserDetailResponse>(`/admin/users/${userId}`)
      .then((d) => {
        setData(d);
        setError(null);
        if (d.counts.recommendationCount != null) {
          setRecCountInput(String(d.counts.recommendationCount));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load user"))
      .finally(() => setLoading(false));
  }, [userId]);

  const loadFeedback = useCallback(() => {
    if (!userId) return;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(feedbackOffset) });
    apiGet<ListResponse<FeedbackRow>>(`/admin/users/${userId}/feedback?${params}`)
      .then(setFeedbackList)
      .catch(() => setFeedbackList(null));
  }, [userId, feedbackOffset]);

  const loadAddresses = useCallback(() => {
    if (!userId) return;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(addressOffset) });
    apiGet<ListResponse<AddressRow>>(`/admin/users/${userId}/addresses?${params}`)
      .then(setAddressList)
      .catch(() => setAddressList(null));
  }, [userId, addressOffset]);

  const loadCalls = useCallback(() => {
    if (!userId) return;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(callOffset) });
    apiGet<ListResponse<AgentCallRow>>(`/admin/users/${userId}/agent-calls?${params}`)
      .then(setCallList)
      .catch(() => setCallList(null));
  }, [userId, callOffset]);

  useEffect(() => {
    if (tab === "feedback") loadFeedback();
  }, [tab, loadFeedback]);
  useEffect(() => {
    if (tab === "addresses") loadAddresses();
  }, [tab, loadAddresses]);
  useEffect(() => {
    if (tab === "agent_calls") loadCalls();
  }, [tab, loadCalls]);

  if (loading) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">User not found.</div>;

  const { profile, counts } = data;
  const languages = Array.isArray(profile.languages) ? profile.languages.filter(Boolean) : [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <Link to="/users" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13 }}>
          ← Back to Users
        </Link>
      </div>
      <h1 style={{ marginBottom: 4 }}>{profile.fullName ?? profile.email}</h1>
      <p className="subtitle">{profile.email}</p>

      {/* Header card */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Role
            </div>
            <span className="badge role">{profile.role}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Plan
            </div>
            <span className={`badge ${profile.subscriptionTier}`}>{profile.planLabel}</span>
          </div>
          {(profile.specialStatus === "supercharge" || profile.specialStatus === "friends_family") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                Special Status
              </div>
              <SpecialStatusPill status={profile.specialStatus} expiresAt={profile.specialStatusExpiresAt} />
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Language(s)
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {languages.length > 0 ? (
                languages.map((l) => (
                  <span key={l} className="badge" style={{ background: "var(--surface, #f3f4f6)" }}>
                    {l}
                  </span>
                ))
              ) : (
                <span style={{ color: "var(--muted)" }}>—</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Verified
            </div>
            <span>{profile.isVerified ? "Yes" : "No"}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Created
            </div>
            <span title={formatDate(profile.createdAt)}>{relativeTime(profile.createdAt)}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Last login
            </div>
            <span title={profile.lastLoginAt ? formatDate(profile.lastLoginAt) : ""}>
              {profile.lastLoginAt ? relativeTime(profile.lastLoginAt) : "Never"}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Phone
            </div>
            <span>{profile.phoneNumber ?? "—"}</span>
          </div>
        </div>
      </div>

      {/* Stat tiles */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <StatTile label="Feasibility reports" value={String(counts.feasibilityReports)} />
        <StatTile label="Agent calls placed" value={String(counts.agentCalls)} hint="Recommended-card calls only" />
        <StatTile label="Thumbs-down" value={String(counts.thumbsDown)} />
        <StatTile
          label="Calls per report"
          value={counts.callsPerReport.toFixed(2)}
          hint="Higher = more likely to call after analysing"
        />
        {counts.recommendationCount != null && (
          <StatTile label="Recommendations (thumbs-up)" value={String(counts.recommendationCount)} hint="Shown on provider card & profile" />
        )}
      </div>

      {/* Recommendation count editor — service providers only */}
      {profile.role === "service_provider" && counts.recommendationCount != null && (
        <div className="panel" style={{ marginBottom: 24 }}>
          <div className="panel-header">
            <span style={{ fontWeight: 600 }}>Adjust recommendation count</span>
          </div>
          <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
              Sets the thumbs-up count visible on the provider card and profile for all users.
              Real user recommendations are still tracked; this value overrides the display.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number"
                min={0}
                step={1}
                value={recCountInput}
                onChange={(e) => setRecCountInput(e.target.value)}
                style={{
                  width: 100,
                  padding: "6px 10px",
                  border: "1px solid var(--border, #d1d5db)",
                  borderRadius: 6,
                  fontSize: 14,
                }}
              />
              <button
                className="btn"
                disabled={recCountSaving}
                onClick={async () => {
                  const n = parseInt(recCountInput, 10);
                  if (!Number.isFinite(n) || n < 0) {
                    setRecCountError("Must be a non-negative whole number.");
                    return;
                  }
                  setRecCountSaving(true);
                  setRecCountError(null);
                  try {
                    const res = await apiPatch<{ ok: boolean; recommendationCount: number }>(
                      `/admin/users/${userId}/recommendation-count`,
                      { count: n },
                    );
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            counts: { ...prev.counts, recommendationCount: res.recommendationCount },
                          }
                        : prev,
                    );
                    setRecCountInput(String(res.recommendationCount));
                  } catch (err) {
                    setRecCountError(err instanceof Error ? err.message : "Save failed.");
                  } finally {
                    setRecCountSaving(false);
                  }
                }}
              >
                {recCountSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {recCountError && (
              <div style={{ fontSize: 13, color: "var(--danger, #dc2626)" }}>{recCountError}</div>
            )}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="panel">
        <div className="panel-header" style={{ gap: 8 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn ghost"
              onClick={() => setTab("feedback")}
              style={{
                fontWeight: tab === "feedback" ? 600 : 400,
                borderColor: tab === "feedback" ? "var(--accent, #2563eb)" : undefined,
              }}
            >
              Thumbs-down feedback{feedbackList ? ` (${feedbackList.total})` : ""}
            </button>
            <button
              className="btn ghost"
              onClick={() => setTab("addresses")}
              style={{
                fontWeight: tab === "addresses" ? 600 : 400,
                borderColor: tab === "addresses" ? "var(--accent, #2563eb)" : undefined,
              }}
            >
              Analyzed addresses{addressList ? ` (${addressList.total})` : ""}
            </button>
            <button
              className="btn ghost"
              onClick={() => setTab("agent_calls")}
              style={{
                fontWeight: tab === "agent_calls" ? 600 : 400,
                borderColor: tab === "agent_calls" ? "var(--accent, #2563eb)" : undefined,
              }}
            >
              Agent calls{callList ? ` (${callList.total})` : ""}
            </button>
          </div>
        </div>

        {tab === "feedback" && (
          <FeedbackTable list={feedbackList} offset={feedbackOffset} setOffset={setFeedbackOffset} />
        )}
        {tab === "addresses" && (
          <AddressTable list={addressList} offset={addressOffset} setOffset={setAddressOffset} />
        )}
        {tab === "agent_calls" && (
          <CallTable list={callList} offset={callOffset} setOffset={setCallOffset} />
        )}
      </div>
    </>
  );
}

function Pagination({
  total,
  offset,
  setOffset,
}: {
  total: number;
  offset: number;
  setOffset: (n: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
      <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
        ← Previous
      </button>
      <span style={{ color: "var(--muted)", fontSize: 13, alignSelf: "center" }}>
        Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
      </span>
      <button
        className="btn ghost"
        disabled={offset + PAGE_SIZE >= total}
        onClick={() => setOffset(offset + PAGE_SIZE)}
      >
        Next →
      </button>
    </div>
  );
}

function FeedbackTable({
  list,
  offset,
  setOffset,
}: {
  list: ListResponse<FeedbackRow> | null;
  offset: number;
  setOffset: (n: number) => void;
}) {
  if (!list) return <div className="empty">Loading…</div>;
  if (list.rows.length === 0) return <div className="empty">No thumbs-down feedback yet.</div>;
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>When</th>
              <th style={{ width: 140 }}>Response mode</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td title={formatDate(r.createdAt)}>{relativeTime(r.createdAt)}</td>
                <td>{r.responseMode ?? "—"}</td>
                <td style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{r.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={list.total} offset={offset} setOffset={setOffset} />
    </>
  );
}

function AddressTable({
  list,
  offset,
  setOffset,
}: {
  list: ListResponse<AddressRow> | null;
  offset: number;
  setOffset: (n: number) => void;
}) {
  if (!list) return <div className="empty">Loading…</div>;
  if (list.rows.length === 0) return <div className="empty">No analyses yet.</div>;
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>When</th>
              <th>Query address</th>
              <th>Analyzed address</th>
              <th style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td title={formatDate(r.createdAt)}>{relativeTime(r.createdAt)}</td>
                <td style={{ wordBreak: "break-word" }}>{r.queryAddress}</td>
                <td style={{ wordBreak: "break-word" }}>{r.analysisAddress}</td>
                <td>
                  <span className="badge">{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={list.total} offset={offset} setOffset={setOffset} />
    </>
  );
}

function CallTable({
  list,
  offset,
  setOffset,
}: {
  list: ListResponse<AgentCallRow> | null;
  offset: number;
  setOffset: (n: number) => void;
}) {
  if (!list) return <div className="empty">Loading…</div>;
  if (list.rows.length === 0) return <div className="empty">No agent calls yet.</div>;
  return (
    <>
      <div style={{ overflowX: "auto" }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 160 }}>When</th>
              <th>Agent</th>
              <th>Agency</th>
              <th>Phone</th>
              <th>Property</th>
            </tr>
          </thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r.id}>
                <td title={formatDate(r.createdAt)}>{relativeTime(r.createdAt)}</td>
                <td>{r.agentName ?? "—"}</td>
                <td>{r.agencyName ?? "—"}</td>
                <td>{r.agentPhone ?? "—"}</td>
                <td style={{ wordBreak: "break-word" }}>{r.propertyAddress ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination total={list.total} offset={offset} setOffset={setOffset} />
    </>
  );
}
