import { useEffect, useRef, useState } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

type SpecialStatus = "free" | "supercharge" | "friends_family";

interface UserRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  subscriptionTier: string;
  planLabel: string;
  createdAt: string;
  lastLoginAt: string | null;
  isVerified: boolean;
  phoneNumber: string | null;
  specialStatus: string | null;
  specialStatusExpiresAt: string | null;
}

interface UsersResponse {
  total: number;
  limit: number;
  offset: number;
  rows: UserRow[];
}

const PAGE_SIZE = 50;

function SpecialStatusPill({ status, expiresAt }: { status: string | null; expiresAt: string | null }) {
  if (status === "friends_family") {
    return <span className="badge special-ff">Friends &amp; Family</span>;
  }
  if (status === "supercharge") {
    const exp = expiresAt ? new Date(expiresAt) : null;
    const expLabel = exp ? `expires ${formatDate(expiresAt!)}` : "";
    return <span className="badge special-sc" title={expLabel}>Supercharge{expLabel ? ` · ${expLabel}` : ""}</span>;
  }
  return <span className="badge free">Free</span>;
}

function StatusEditor({ user, onUpdated }: { user: UserRow; onUpdated: (updated: Partial<UserRow>) => void }) {
  const currentStatus: SpecialStatus =
    user.specialStatus === "supercharge" ? "supercharge"
    : user.specialStatus === "friends_family" ? "friends_family"
    : "free";

  const [selected, setSelected] = useState<SpecialStatus>(currentStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isDirty = selected !== currentStatus;
  const prevStatusRef = useRef(currentStatus);

  // Reset local selection when the parent row updates (e.g. after save)
  useEffect(() => {
    if (prevStatusRef.current !== currentStatus) {
      prevStatusRef.current = currentStatus;
      setSelected(currentStatus);
    }
  }, [currentStatus]);

  async function handleSet() {
    setSaving(true);
    setError(null);
    try {
      const result = await apiPatch<{ ok: boolean; specialStatus: string | null; specialStatusExpiresAt: string | null }>(
        `/admin/users/${user.id}/status`,
        { status: selected },
      );
      onUpdated({ specialStatus: result.specialStatus, specialStatusExpiresAt: result.specialStatusExpiresAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value as SpecialStatus)}
        style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid var(--border)" }}
        disabled={saving}
      >
        <option value="free">Free</option>
        <option value="supercharge">Supercharge (60/mo · 6 mo)</option>
        <option value="friends_family">Friends &amp; Family (9999/mo)</option>
      </select>
      {isDirty && (
        <button
          className="btn ghost"
          style={{ padding: "2px 8px", fontSize: 12 }}
          onClick={handleSet}
          disabled={saving}
        >
          {saving ? "Saving…" : "Set"}
        </button>
      )}
      {error && <span style={{ color: "var(--danger, #c0392b)", fontSize: 11 }}>{error}</span>}
    </div>
  );
}

export default function UsersPage() {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (search) params.set("search", search);
    apiGet<UsersResponse>(`/admin/users?${params.toString()}`)
      .then((d) => {
        setRows(d.rows);
        setTotal(d.total);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [search, offset]);

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  function updateRow(id: string, patch: Partial<UserRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <h1>Users</h1>
      <p className="subtitle">All non-admin users with their current plan and last activity.</p>

      <div className="panel">
        <div className="panel-header">
          <form onSubmit={onSearchSubmit} style={{ display: "flex", gap: 8 }}>
            <input
              className="search"
              placeholder="Search email or name…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn ghost">
              Search
            </button>
          </form>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {total} total
          </div>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No users found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Verified</th>
                  <th>Created</th>
                  <th>Last login</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}</td>
                    <td>{u.fullName ?? "—"}</td>
                    <td>
                      <span className="badge role">{u.role}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.subscriptionTier}`}>{u.planLabel}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <SpecialStatusPill status={u.specialStatus} expiresAt={u.specialStatusExpiresAt} />
                        <StatusEditor user={u} onUpdated={(patch) => updateRow(u.id, patch)} />
                      </div>
                    </td>
                    <td>{u.isVerified ? "Yes" : "No"}</td>
                    <td title={formatDate(u.createdAt)}>{relativeTime(u.createdAt)}</td>
                    <td title={u.lastLoginAt ? formatDate(u.lastLoginAt) : ""}>
                      {u.lastLoginAt ? relativeTime(u.lastLoginAt) : "Never"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button
              className="btn ghost"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            >
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
        )}
      </div>
    </>
  );
}
