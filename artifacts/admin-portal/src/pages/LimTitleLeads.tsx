import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch, apiPost } from "@/lib/api";
import { formatDate, relativeTime } from "@/lib/format";

type LeadFilter = "open" | "completed" | "review" | "all";

interface PropertyDocumentRow {
  id: string;
  canReview: boolean;
  sourceRequestId: string | null;
  docType: "lim_report" | "title" | "combined";
  fileName: string | null;
  reviewUrl: string | null;
  verificationStatus: "pending" | "text_match" | "mismatch" | "no_text_layer" | "admin_confirmed" | "rejected";
  issuedAt: string | null;
  createdAt: string;
}

interface LimTitleLead {
  id: string;
  propertyAddress: string;
  requestedDocuments: string[];
  status: string;
  offerSource: "proactive_15_percent" | "organic_intent";
  requesterUserId: string;
  buyerFullName: string | null;
  buyerEmail: string;
  buyerPhone: string | null;
  matchedAgentUserId: string | null;
  agentPhone: string;
  agentName: string | null;
  registeredAgentName: string | null;
  dmThreadId: string | null;
  consentedAt: string;
  connectedAt: string | null;
  adminSmsSentAt: string | null;
  documentsDeliveredAt: string | null;
  facilitatorMessageAt: string | null;
  agentRespondedAt: string | null;
  lastRequestedAt: string;
  requestCount: number;
  isNew: boolean;
  documents: PropertyDocumentRow[];
}

export default function LimTitleLeadsPage() {
  const [leads, setLeads] = useState<LimTitleLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LeadFilter>("open");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [documentTargets, setDocumentTargets] = useState<Record<string, string>>({});

  const loadLeads = useCallback(() => {
    apiGet<{ rows: LimTitleLead[] }>("/admin/lim-title-leads?limit=200")
      .then((data) => {
        setLeads(data.rows);
        setError(null);
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load LIM/title leads",
        ),
      );
  }, []);

  useEffect(() => {
    loadLeads();
    const timer = window.setInterval(loadLeads, 15000);
    return () => window.clearInterval(timer);
  }, [loadLeads]);

  useEffect(() => {
    // Clears the sidebar badge / per-row red dots — a buyer re-requesting
    // after the cooldown window bumps lastRequestedAt again, so simply
    // having visited before doesn't suppress a later re-request.
    apiPost("/admin/lim-title-leads/mark-viewed").catch(() => {});
  }, []);

  const visibleLeads = useMemo(() => {
    if (!leads) return null;
    if (filter === "open")
      return leads.filter((lead) => !lead.documentsDeliveredAt);
    if (filter === "completed")
      return leads.filter((lead) => Boolean(lead.documentsDeliveredAt));
    if (filter === "review")
      return leads.filter((lead) => lead.documents.some((document) =>
        document.verificationStatus === "mismatch" || document.verificationStatus === "no_text_layer",
      ));
    return leads;
  }, [filter, leads]);

  async function updateStatus(
    lead: LimTitleLead,
    field: "adminSmsSent" | "documentsDelivered",
    checked: boolean,
  ) {
    if (updatingId) return;
    setUpdatingId(lead.id);
    setError(null);
    try {
      const response = await apiPatch<{
        lead: Pick<
          LimTitleLead,
          "id" | "adminSmsSentAt" | "documentsDeliveredAt"
        >;
      }>(`/admin/lim-title-leads/${lead.id}`, { [field]: checked });
      setLeads(
        (current) =>
          current?.map((row) =>
            row.id === lead.id ? { ...row, ...response.lead } : row,
          ) ?? null,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update the lead",
      );
    } finally {
      setUpdatingId(null);
    }
  }

  async function reviewDocument(
    document: PropertyDocumentRow,
    body: Record<string, unknown>,
  ) {
    if (updatingId) return;
    setUpdatingId(document.id);
    setError(null);
    try {
      await apiPatch(`/admin/property-documents/${document.id}`, body);
      loadLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update the document");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <>
      <h1>LIM/Title Leads</h1>
      <p className="subtitle">
        Human-managed requests from buyers. Contact agents manually, then track
        replies and document delivery here.
      </p>

      <div className="panel">
        <div className="panel-header">
          <div>
            <div className="panel-title">Consented requests</div>
            <div className="lead-count">
              {leads ? `${leads.length} total` : "Loading..."}
            </div>
          </div>
          <div className="toggle" aria-label="Filter LIM/title leads">
            {(["open", "completed", "review", "all"] as LeadFilter[]).map((value) => (
              <button
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="error-text" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}
        {!visibleLeads && !error && (
          <div className="empty">Loading leads...</div>
        )}
        {visibleLeads?.length === 0 && (
          <div className="empty">No leads in this view.</div>
        )}
        {visibleLeads && visibleLeads.length > 0 && (
          <div className="lead-table-wrap">
            <table className="table lead-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Buyer</th>
                  <th>Property</th>
                  <th>Listing agent</th>
                  <th>Connection</th>
                  <th>Agent SMS sent</th>
                  <th>Replied</th>
                  <th>LIM/title delivered</th>
                  <th>Conversation</th>
                </tr>
              </thead>
              <tbody>
                {visibleLeads.map((lead) => {
                  const disabled = updatingId === lead.id;
                  return (
                    <tr key={lead.id}>
                      <td title={formatDate(lead.consentedAt)}>
                        <strong>
                          {lead.isNew && (
                            <span
                              className="mh-new-chat-dot"
                              title="New or re-requested since you last viewed this list"
                            />
                          )}
                          {relativeTime(lead.consentedAt)}
                        </strong>
                        <div className="lead-muted">
                          {formatDate(lead.consentedAt)}
                        </div>
                        <span className="badge role">
                          {lead.offerSource === "organic_intent"
                            ? "User asked"
                            : "15% prompt"}
                        </span>
                        {lead.requestCount > 1 && (
                          <div
                            className="lead-muted"
                            title={formatDate(lead.lastRequestedAt)}
                          >
                            Requested {lead.requestCount}× — last{" "}
                            {relativeTime(lead.lastRequestedAt)}
                          </div>
                        )}
                      </td>
                      <td>
                        <strong>{lead.buyerFullName ?? "Unnamed user"}</strong>
                        <a
                          className="lead-contact"
                          href={`mailto:${lead.buyerEmail}`}
                        >
                          {lead.buyerEmail}
                        </a>
                        {lead.buyerPhone ? (
                          <a
                            className="lead-contact"
                            href={`tel:${lead.buyerPhone}`}
                          >
                            {lead.buyerPhone}
                          </a>
                        ) : (
                          <span className="lead-muted">No verified mobile</span>
                        )}
                      </td>
                      <td className="lead-address">{lead.propertyAddress}</td>
                      <td>
                        <strong>
                          {lead.agentName ??
                            lead.registeredAgentName ??
                            "Unknown agent"}
                        </strong>
                        <a
                          className="lead-contact"
                          href={`tel:${lead.agentPhone}`}
                        >
                          {lead.agentPhone}
                        </a>
                        {lead.registeredAgentName &&
                          lead.registeredAgentName !== lead.agentName && (
                            <span className="lead-muted">
                              Account: {lead.registeredAgentName}
                            </span>
                          )}
                      </td>
                      <td>
                        <span
                          className={`lead-state ${lead.matchedAgentUserId ? "good" : "waiting"}`}
                        >
                          {lead.matchedAgentUserId
                            ? "Registered"
                            : "Awaiting signup"}
                        </span>
                        <span
                          className={`lead-state ${lead.connectedAt ? "good" : "waiting"}`}
                        >
                          {lead.connectedAt ? "Connected" : "Not connected"}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {lead.requestedDocuments.map((docType) => {
                            const delivered = lead.documents.some((document) =>
                              document.verificationStatus !== "rejected" &&
                              (document.docType === docType || document.docType === "combined"),
                            );
                            return (
                              <span key={docType} className={`lead-state ${delivered ? "good" : "waiting"}`}>
                                {docType === "lim_report" ? "LIM" : "Title"} {delivered ? "✓" : "—"}
                              </span>
                            );
                          })}
                        </div>
                        {lead.documents.map((document) => (
                          <div key={document.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 7, marginTop: 7, minWidth: 230 }}>
                            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              {document.reviewUrl ? (
                                <a href={document.reviewUrl} target="_blank" rel="noreferrer" className="lead-contact">
                                  {document.fileName || (document.docType === "lim_report" ? "LIM document" : "Title document")}
                                </a>
                              ) : (
                                <span>{document.fileName || "Document"}</span>
                              )}
                              <span className={`lead-state ${document.verificationStatus === "text_match" || document.verificationStatus === "admin_confirmed" ? "good" : "waiting"}`}>
                                {document.verificationStatus.replaceAll("_", " ")}
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                              <button
                                className="btn ghost"
                                disabled={!document.canReview || updatingId === document.id}
                                onClick={() => reviewDocument(document, { verificationStatus: "admin_confirmed" })}
                              >Confirm</button>
                              <button
                                className="btn ghost"
                                disabled={!document.canReview || updatingId === document.id}
                                onClick={() => reviewDocument(document, { verificationStatus: "rejected" })}
                              >Reject</button>
                              <select
                                aria-label="Move document to another request"
                                disabled={!document.canReview}
                                value={documentTargets[document.id] ?? ""}
                                onChange={(event) => setDocumentTargets((current) => ({ ...current, [document.id]: event.target.value }))}
                              >
                                <option value="">Re-tag…</option>
                                {leads?.map((targetLead) => ["lim_report", "title", "combined"].map((docType) => (
                                  <option key={`${targetLead.id}-${docType}`} value={`${targetLead.id}|${docType}`}>
                                    {targetLead.propertyAddress} · {docType === "lim_report" ? "LIM" : docType === "title" ? "Title" : "Both"}
                                  </option>
                                )))}
                              </select>
                              {documentTargets[document.id] ? (
                                <button
                                  className="btn ghost"
                                  disabled={!document.canReview || updatingId === document.id}
                                  onClick={() => {
                                    const [requestId, documentType] = documentTargets[document.id].split("|");
                                    void reviewDocument(document, { requestId, documentType });
                                  }}
                                >Apply</button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                        {!lead.documents.length && <span className="lead-muted">No linked documents</span>}
                        <label className="lead-check" style={{ marginTop: 9 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(lead.adminSmsSentAt)}
                            disabled={disabled}
                            onChange={(event) =>
                              updateStatus(
                                lead,
                                "adminSmsSent",
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            {lead.adminSmsSentAt ? "Sent" : "Not sent"}
                          </span>
                        </label>
                        {lead.adminSmsSentAt && (
                          <div className="lead-muted">
                            {formatDate(lead.adminSmsSentAt)}
                          </div>
                        )}
                      </td>
                      <td>
                        {lead.agentRespondedAt ? (
                          <div
                            className="lead-replied"
                            title={formatDate(lead.agentRespondedAt)}
                          >
                            <span className="lead-tick">✓</span>
                            <span>{relativeTime(lead.agentRespondedAt)}</span>
                          </div>
                        ) : (
                          <span className="lead-state waiting">
                            No in-app reply
                          </span>
                        )}
                      </td>
                      <td>
                        <label className="lead-check">
                          <input
                            type="checkbox"
                            checked={Boolean(lead.documentsDeliveredAt)}
                            disabled={disabled}
                            onChange={(event) =>
                              updateStatus(
                                lead,
                                "documentsDelivered",
                                event.target.checked,
                              )
                            }
                          />
                          <span>
                            {lead.documentsDeliveredAt
                              ? "Manual/automatic complete"
                              : "Mark complete manually"}
                          </span>
                        </label>
                        {lead.documentsDeliveredAt && (
                          <div className="lead-muted">
                            {formatDate(lead.documentsDeliveredAt)}
                          </div>
                        )}
                      </td>
                      <td>
                        {lead.dmThreadId && lead.matchedAgentUserId ? (
                          <Link
                            className="btn ghost lead-open-chat"
                            to={`/message-hub?accountId=${encodeURIComponent(lead.matchedAgentUserId)}&threadId=${encodeURIComponent(lead.dmThreadId)}`}
                          >
                            Open chat
                          </Link>
                        ) : (
                          <span className="lead-muted">
                            Available after signup
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
