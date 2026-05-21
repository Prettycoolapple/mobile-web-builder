import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

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
}

interface UsersResponse {
  total: number;
  limit: number;
  offset: number;
  rows: UserRow[];
}

const PAGE_SIZE = 50;

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
