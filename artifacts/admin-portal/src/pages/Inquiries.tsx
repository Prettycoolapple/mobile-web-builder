import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

type FilterType = "all" | "report" | "support";

interface InquiryRow {
  kind: "report" | "support";
  id: string;
  createdAt: string;
  message: string;
  submitter: {
    id: string | null;
    email: string | null;
    fullName: string | null;
    phone: string | null;
    role: string | null;
    subscriptionTier: string | null;
    planLabel: string;
  };
  reportedUser?: {
    id: string;
    email: string | null;
    fullName: string | null;
    role: string | null;
  } | null;
}

interface InquiriesResponse {
  total: number;
  limit: number;
  offset: number;
  rows: InquiryRow[];
}

const PAGE_SIZE = 50;

export default function InquiriesPage() {
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [type, setType] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({
      type,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    apiGet<InquiriesResponse>(`/admin/inquiries?${params.toString()}`)
      .then((d) => {
        setRows(d.rows);
        setTotal(d.total);
      })
      .catch(() => {
        setRows([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [type, offset]);

  return (
    <>
      <h1>Inquiries</h1>
      <p className="subtitle">
        Abuse reports from the DM system and general support form submissions, with submitter metadata for manual
        follow-up.
      </p>

      <div className="panel">
        <div className="panel-header">
          <div className="toggle">
            <button className={type === "all" ? "active" : ""} onClick={() => { setType("all"); setOffset(0); }}>All</button>
            <button className={type === "report" ? "active" : ""} onClick={() => { setType("report"); setOffset(0); }}>Reports</button>
            <button className={type === "support" ? "active" : ""} onClick={() => { setType("support"); setOffset(0); }}>Support</button>
          </div>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>{total} total</div>
        </div>

        {loading ? (
          <div className="empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No messages.</div>
        ) : (
          rows.map((row) => (
            <div className="inquiry-row" key={`${row.kind}-${row.id}`}>
              <header>
                <span className={`pill ${row.kind}`}>{row.kind === "report" ? "Report" : "Support"}</span>
                <span style={{ color: "var(--muted)", fontSize: 12 }} title={formatDate(row.createdAt)}>
                  {relativeTime(row.createdAt)}
                </span>
              </header>
              <div className="who">
                <strong>From:</strong> {row.submitter.fullName || "(no name)"} —{" "}
                <a href={`mailto:${row.submitter.email ?? ""}`}>{row.submitter.email ?? "(no email)"}</a>
                {row.submitter.phone && ` · ${row.submitter.phone}`}
                {row.submitter.role && ` · ${row.submitter.role}`}
                {row.submitter.subscriptionTier && ` · ${row.submitter.planLabel}`}
              </div>
              {row.reportedUser && (
                <div className="who">
                  <strong>Reported:</strong> {row.reportedUser.fullName || "(no name)"} —{" "}
                  {row.reportedUser.email ?? "(no email)"}
                  {row.reportedUser.role && ` · ${row.reportedUser.role}`}
                </div>
              )}
              <div className="body">{row.message}</div>
            </div>
          ))
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
