import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface AgentProfile {
  id: string;
  email: string;
  fullName: string | null;
  phoneNumber: string | null;
  isVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  agencyName: string | null;
  licenceNumber: string | null;
  avatarUrl: string | null;
}

interface ListingRow {
  id: string;
  status: string;
  approvedAt: string | null;
  address: string;
  listingType: string;
  propertyType: string;
  priceDisplay: string | null;
  priceNzd: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  imageUrls: string[];
  createdAt: string;
  removedAt: string | null;
}

interface AgentDetailResponse {
  profile: AgentProfile;
  listings: ListingRow[];
}

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [data, setData] = useState<AgentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  useEffect(() => {
    if (!agentId) return;
    setLoading(true);
    apiGet<AgentDetailResponse>(`/admin/agents/${agentId}`)
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load agent"))
      .finally(() => setLoading(false));
  }, [agentId]);

  async function toggleApproval(listing: ListingRow) {
    setApprovingId(listing.id);
    try {
      const action = listing.approvedAt ? "unapprove" : "approve";
      const result = await apiPost<{ ok: boolean; approvedAt: string | null }>(
        `/admin/listings/${listing.id}/${action}`,
      );
      setData((prev) =>
        prev
          ? {
              ...prev,
              listings: prev.listings.map((l) =>
                l.id === listing.id ? { ...l, approvedAt: result.approvedAt } : l,
              ),
            }
          : prev,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Action failed");
    } finally {
      setApprovingId(null);
    }
  }

  if (loading) return <div className="empty">Loading…</div>;
  if (error) return <div className="empty">{error}</div>;
  if (!data) return <div className="empty">Agent not found.</div>;

  const { profile, listings } = data;
  const pending = listings.filter((l) => !l.approvedAt && !l.removedAt).length;
  const approved = listings.filter((l) => l.approvedAt && !l.removedAt).length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <Link to="/agents" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 13 }}>
          ← Back to Agents
        </Link>
      </div>
      <h1 style={{ marginBottom: 4 }}>{profile.fullName ?? profile.email}</h1>
      <p className="subtitle">{profile.email}</p>

      {/* Profile card */}
      <div className="panel" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "flex-start" }}>
          {profile.avatarUrl && (
            <img
              src={profile.avatarUrl}
              alt="Avatar"
              style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "2px solid var(--border)" }}
            />
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
            {[
              ["Agency", profile.agencyName ?? "—"],
              ["Phone", profile.phoneNumber ?? "—"],
              ["REAA Licence", profile.licenceNumber ?? "—"],
              ["Verified", profile.isVerified ? "Yes" : "No"],
              ["Joined", relativeTime(profile.createdAt)],
              ["Last login", profile.lastLoginAt ? relativeTime(profile.lastLoginAt) : "Never"],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          ["Total listings", String(listings.length)],
          ["Pending approval", String(pending)],
          ["Approved & live", String(approved)],
        ].map(([label, value]) => (
          <div key={label} className="panel" style={{ flex: 1, minWidth: 140, padding: 16 }}>
            <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Listings table */}
      <div className="panel">
        <div className="panel-header">
          <span style={{ fontWeight: 600 }}>Listings</span>
          {pending > 0 && (
            <span className="sidebar-badge" style={{ display: "inline-flex" }}>
              {pending} pending
            </span>
          )}
        </div>
        {listings.length === 0 ? (
          <div className="empty">No listings yet.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 48 }}></th>
                  <th>Address</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th style={{ textAlign: "center" }}>Beds</th>
                  <th style={{ textAlign: "center" }}>Baths</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ width: 140 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l) => (
                  <tr key={l.id} style={l.removedAt ? { opacity: 0.45 } : undefined}>
                    <td>
                      {l.imageUrls?.[0] ? (
                        <img
                          src={l.imageUrls[0]}
                          alt=""
                          style={{ width: 40, height: 30, objectFit: "cover", borderRadius: 4, display: "block" }}
                        />
                      ) : (
                        <div style={{ width: 40, height: 30, borderRadius: 4, background: "var(--surface, #f3f4f6)" }} />
                      )}
                    </td>
                    <td>
                      <Link
                        to={`/listings/${l.id}`}
                        style={{ color: "var(--accent, #2563eb)", textDecoration: "none", wordBreak: "break-word" }}
                      >
                        {l.address}
                      </Link>
                    </td>
                    <td>
                      <span className="badge">{l.listingType === "for_sale" ? "For sale" : "For rent"}</span>
                    </td>
                    <td>{l.priceDisplay ?? (l.priceNzd ? `$${l.priceNzd.toLocaleString()}` : "—")}</td>
                    <td style={{ textAlign: "center" }}>{l.bedrooms ?? "—"}</td>
                    <td style={{ textAlign: "center" }}>{l.bathrooms ?? "—"}</td>
                    <td>
                      {l.removedAt ? (
                        <span className="badge" style={{ background: "var(--surface)" }}>Removed</span>
                      ) : l.approvedAt ? (
                        <span className="badge" style={{ background: "#dcfce7", color: "#166534" }}>Approved</span>
                      ) : (
                        <span className="badge" style={{ background: "#fef3c7", color: "#92400e" }}>Pending</span>
                      )}
                    </td>
                    <td title={formatDate(l.createdAt)}>{relativeTime(l.createdAt)}</td>
                    <td>
                      {!l.removedAt && (
                        <button
                          className="btn ghost"
                          style={{ fontSize: 12, padding: "3px 10px", color: l.approvedAt ? "var(--danger, #dc2626)" : "var(--accent, #2563eb)" }}
                          disabled={approvingId === l.id}
                          onClick={() => toggleApproval(l)}
                        >
                          {approvingId === l.id ? "…" : l.approvedAt ? "Unapprove" : "Approve"}
                        </button>
                      )}
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
