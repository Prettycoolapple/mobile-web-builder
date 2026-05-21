import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

interface ProviderRow {
  userId: string;
  email: string;
  fullName: string | null;
  phoneNumber: string | null;
  createdAt: string;
  company: {
    name: string | null;
    nzRegisterNumber: string | null;
    discipline: string | null;
    otherDiscipline: string | null;
    address: {
      street: string | null;
      suburb: string | null;
      city: string | null;
      postcode: string | null;
    };
    contactNumber: string | null;
    languages: string[];
    primaryLanguage: string | null;
    secondaryLanguage: string | null;
    bio: string | null;
  };
  incorporationCertUrl: string | null;
  incorporationCertReviewUrl: string | null;
}

interface PendingResponse {
  total: number;
  rows: ProviderRow[];
}

function disciplineLabel(value: string | null, other: string | null): string {
  if (!value) return "—";
  if (value === "other") return other?.trim() ? `Other — ${other}` : "Other";
  return value.replace(/_/g, " ");
}

function addressLine(addr: ProviderRow["company"]["address"]): string {
  const parts = [addr.street, addr.suburb, addr.city, addr.postcode].filter((p): p is string =>
    Boolean(p && p.trim()),
  );
  return parts.length > 0 ? parts.join(", ") : "—";
}

export default function PendingProvidersPage() {
  const [rows, setRows] = useState<ProviderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<PendingResponse>("/admin/providers/pending");
      setRows(data.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending providers");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function verify(userId: string): Promise<void> {
    if (!confirm("Mark this service provider as officially verified?")) return;
    setVerifyingId(userId);
    try {
      await apiPost(`/admin/providers/${userId}/verify`);
      setRows((prev) => prev.filter((r) => r.userId !== userId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyingId(null);
    }
  }

  return (
    <>
      <h1>Pending verifications</h1>
      <p className="subtitle">
        Service-provider signups awaiting manual verification against the NZ Companies Register and other sources.
        Click "Mark as verified" once you've confirmed the details — the provider becomes officially verified in the
        app.
      </p>

      {loading ? (
        <div className="panel">
          <div className="empty">Loading…</div>
        </div>
      ) : error ? (
        <div className="panel">
          <div className="empty">{error}</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <div className="empty">No service providers currently awaiting verification.</div>
        </div>
      ) : (
        rows.map((r) => (
          <div key={r.userId} className="provider-card">
            <h3>{r.company.name || r.fullName || r.email}</h3>
            <div className="meta">
              Signed up {relativeTime(r.createdAt)} ({formatDate(r.createdAt)})
            </div>

            <dl className="grid">
              <dt>Full name</dt>
              <dd>{r.fullName || "—"}</dd>

              <dt>Email</dt>
              <dd>
                <a href={`mailto:${r.email}`}>{r.email}</a>
              </dd>

              <dt>Phone (account)</dt>
              <dd>{r.phoneNumber || "—"}</dd>

              <dt>Company name</dt>
              <dd>{r.company.name || "—"}</dd>

              <dt>NZ Companies Register #</dt>
              <dd>
                {r.company.nzRegisterNumber ? (
                  <a
                    href={`https://app.companiesoffice.govt.nz/companies/app/ui/pages/companies/search?q=${encodeURIComponent(r.company.nzRegisterNumber)}`}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {r.company.nzRegisterNumber} ↗
                  </a>
                ) : (
                  "—"
                )}
              </dd>

              <dt>Discipline</dt>
              <dd>{disciplineLabel(r.company.discipline, r.company.otherDiscipline)}</dd>

              <dt>Address</dt>
              <dd>{addressLine(r.company.address)}</dd>

              <dt>Contact number</dt>
              <dd>{r.company.contactNumber || "—"}</dd>

              <dt>Languages</dt>
              <dd>
                {[r.company.primaryLanguage, r.company.secondaryLanguage, ...(r.company.languages ?? [])]
                  .filter((l): l is string => Boolean(l && l.trim()))
                  .filter((l, i, arr) => arr.indexOf(l) === i)
                  .join(", ") || "—"}
              </dd>

              {r.company.bio && (
                <>
                  <dt>Bio</dt>
                  <dd style={{ whiteSpace: "pre-wrap" }}>{r.company.bio}</dd>
                </>
              )}
            </dl>

            <div className="actions">
              {r.incorporationCertReviewUrl ? (
                <a
                  className="btn ghost"
                  href={r.incorporationCertReviewUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  View incorporation certificate ↗
                </a>
              ) : r.incorporationCertUrl ? (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  Certificate URL present but not viewable (legacy upload).
                </span>
              ) : (
                <span style={{ color: "var(--muted)", fontSize: 13 }}>No certificate uploaded.</span>
              )}

              <button
                className="btn success"
                onClick={() => verify(r.userId)}
                disabled={verifyingId === r.userId}
              >
                {verifyingId === r.userId ? "Verifying…" : "Mark as verified"}
              </button>
            </div>
          </div>
        ))
      )}
    </>
  );
}
