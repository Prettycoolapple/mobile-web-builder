import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface SuspiciousRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  subscriptionTier: string;
  createdAt: string;
  abuseFlag: boolean;
  abuseFlagReason: string | null;
  abuseFlaggedAt: string | null;
  score: number;
  signalCount: number;
  lastSignalAt: string | null;
  kinds: string | null;
}

interface SuspiciousResponse {
  days: number;
  limit: number;
  autoFlagScore: number;
  rows: SuspiciousRow[];
}

const WINDOWS = [
  { label: "24 hours", days: 1 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
];

// How each signal kind reads in plain English for the admin reviewing the list.
const KIND_LABELS: Record<string, string> = {
  signup_velocity: "Account farming (many signups, one source)",
  quota_burst: "New account burned its quota immediately",
  rate_limit_trip: "Hit a rate limit (querying too fast)",
  canary_hit: "Queried a trap address — near-certain scraper",
  manual: "Manually flagged",
  signup: "Signup",
};

function scoreColor(score: number, autoFlagScore: number): string {
  if (score >= autoFlagScore) return "#c0392b"; // auto-flag grade
  if (score >= autoFlagScore / 2) return "#d97706"; // worth a look
  return "var(--muted)";
}

function KindBadges({ kinds }: { kinds: string | null }) {
  if (!kinds) return <span style={{ color: "var(--muted)" }}>—</span>;
  const list = kinds.split(",").filter((k) => k && k !== "signup");
  if (list.length === 0) return <span style={{ color: "var(--muted)" }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {list.map((k) => (
        <span
          key={k}
          className="badge"
          title={KIND_LABELS[k] ?? k}
          style={{
            fontSize: 11,
            background: k === "canary_hit" ? "#fde2e1" : "var(--badge-bg, #eef2ff)",
            color: k === "canary_hit" ? "#a01a14" : "inherit",
          }}
        >
          {(KIND_LABELS[k] ?? k).split(" ")[0]}
        </span>
      ))}
    </div>
  );
}

function FlagButton({ row, onChanged }: { row: SuspiciousRow; onChanged: (flag: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const next = !row.abuseFlag;
      const reason = next
        ? `manual review: abuse score ${row.score.toFixed(0)} (${row.kinds ?? ""})`
        : undefined;
      await apiPost<{ ok: boolean }>("/admin/abuse/flag", { userId: row.id, flag: next, reason });
      onChanged(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <button
        className="btn ghost"
        style={{ padding: "2px 8px", fontSize: 12 }}
        onClick={toggle}
        disabled={busy}
      >
        {busy ? "…" : row.abuseFlag ? "Clear flag" : "Flag"}
      </button>
      {error && <span style={{ color: "#c0392b", fontSize: 11 }}>{error}</span>}
    </div>
  );
}

export default function SecurityPage() {
  const [data, setData] = useState<SuspiciousResponse | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiGet<SuspiciousResponse>(`/admin/abuse/suspicious?days=${days}&limit=200`)
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [days]);

  const rows = data?.rows ?? [];
  const autoFlagScore = data?.autoFlagScore ?? 10;

  function updateRow(id: string, flag: boolean) {
    setData((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, abuseFlag: flag } : r)) } : prev,
    );
  }

  return (
    <>
      <h1>Security</h1>
      <p className="subtitle">
        Accounts ranked by abuse / harvesting signals (account farming, quota bursting, rate-limit
        trips, trap-address hits). Review and warn or flag manually. A score of {autoFlagScore}+ is
        auto-flag grade.
      </p>

      <div className="panel">
        <div className="panel-header">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ color: "var(--muted)", fontSize: 13 }}>Window:</span>
            {WINDOWS.map((w) => (
              <button
                key={w.days}
                className={`btn ${days === w.days ? "" : "ghost"}`}
                style={{ padding: "4px 10px", fontSize: 13 }}
                onClick={() => setDays(w.days)}
              >
                {w.label}
              </button>
            ))}
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{rows.length} flagged by signals</div>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No suspicious accounts in this window. 🎉</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Plan</th>
                  <th>Signals</th>
                  <th>Account age</th>
                  <th>Last signal</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span
                        style={{ fontWeight: 700, fontSize: 15, color: scoreColor(r.score, autoFlagScore) }}
                        title={`${r.signalCount} weighted signal(s)`}
                      >
                        {r.score.toFixed(0)}
                      </span>
                    </td>
                    <td>
                      <Link
                        to={`/users/${r.id}`}
                        style={{ color: "var(--accent, #2563eb)", textDecoration: "none" }}
                      >
                        {r.email}
                      </Link>
                    </td>
                    <td>{r.fullName ?? "—"}</td>
                    <td>
                      <span className={`badge ${r.subscriptionTier}`}>{r.subscriptionTier}</span>
                    </td>
                    <td><KindBadges kinds={r.kinds} /></td>
                    <td title={formatDate(r.createdAt)}>{relativeTime(r.createdAt)}</td>
                    <td title={r.lastSignalAt ? formatDate(r.lastSignalAt) : ""}>
                      {r.lastSignalAt ? relativeTime(r.lastSignalAt) : "—"}
                    </td>
                    <td>
                      {r.abuseFlag ? (
                        <span className="badge" style={{ background: "#fde2e1", color: "#a01a14" }}>
                          Flagged
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <a
                          className="btn ghost"
                          style={{ padding: "2px 8px", fontSize: 12, textDecoration: "none" }}
                          href={`mailto:${r.email}?subject=${encodeURIComponent(
                            "About your Project Alpha account activity",
                          )}&body=${encodeURIComponent(
                            "Hi,\n\nWe've noticed unusual automated-looking activity on your account. Our terms allow personal use of the app only and prohibit bulk or automated data collection.\n\nPlease get in touch if you have any questions.\n\nThanks,\nProject Alpha",
                          )}`}
                        >
                          Email
                        </a>
                        <FlagButton row={r} onChanged={(flag) => updateRow(r.id, flag)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
