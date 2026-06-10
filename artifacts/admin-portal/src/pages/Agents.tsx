import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface AgentRow {
  id: string;
  email: string;
  fullName: string | null;
  phoneNumber: string | null;
  isVerified: boolean;
  createdAt: string;
  agencyName: string | null;
  licenceNumber: string | null;
  totalListings: number;
  pendingListings: number;
  approvedListings: number;
}

interface AgentsResponse {
  total: number;
  limit: number;
  offset: number;
  rows: AgentRow[];
}

const PAGE_SIZE = 50;

export default function AgentsPage() {
  const [rows, setRows] = useState<AgentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (search) params.set("search", search);
    apiGet<AgentsResponse>(`/admin/agents?${params}`)
      .then((d) => { setRows(d.rows); setTotal(d.total); })
      .catch(() => { setRows([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [search, offset]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    setOffset(0);
    setSearch(searchInput.trim());
  }

  return (
    <>
      <h1>Sales Agents</h1>
      <p className="subtitle">All registered sales agents and their listing approval status.</p>

      <div className="panel">
        <div className="panel-header">
          <form onSubmit={onSearch} style={{ display: "flex", gap: 8 }}>
            <input
              className="search"
              placeholder="Search email or name…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <button type="submit" className="btn ghost">Search</button>
          </form>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{total} total</div>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No agents found.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Agency</th>
                  <th>Phone</th>
                  <th style={{ textAlign: "center" }}>Listings</th>
                  <th style={{ textAlign: "center" }}>Pending</th>
                  <th style={{ textAlign: "center" }}>Approved</th>
                  <th>Verified</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link
                        to={`/agents/${a.id}`}
                        style={{ color: "var(--accent, #2563eb)", textDecoration: "none" }}
                      >
                        {a.email}
                      </Link>
                    </td>
                    <td>{a.fullName ?? "—"}</td>
                    <td>{a.agencyName ?? "—"}</td>
                    <td>{a.phoneNumber ?? "—"}</td>
                    <td style={{ textAlign: "center" }}>{a.totalListings}</td>
                    <td style={{ textAlign: "center" }}>
                      {a.pendingListings > 0 ? (
                        <span className="sidebar-badge" style={{ display: "inline-flex" }}>
                          {a.pendingListings}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ textAlign: "center" }}>{a.approvedListings}</td>
                    <td>{a.isVerified ? "Yes" : "No"}</td>
                    <td title={formatDate(a.createdAt)}>{relativeTime(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
            <button className="btn ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              ← Previous
            </button>
            <span style={{ color: "var(--muted)", fontSize: 13, alignSelf: "center" }}>
              Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <button className="btn ghost" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next →
            </button>
          </div>
        )}
      </div>
    </>
  );
}
