import type { ChatMessage, PropertyCandidate } from "@/state/chat-model";
import { PropertyCard } from "@/components/cards/PropertyCard";
import { ReportView } from "@/components/report/ReportView";
import { ReportGroupView } from "@/components/report/ReportGroupView";

export interface MessageActions {
  onAnalyse: (candidate: PropertyCandidate) => void;
  onChip: (message: ChatMessage, option: string) => void;
  onShowMore: (message: ChatMessage) => void;
  onExportPdf: (message: ChatMessage) => void;
  analysingAddress?: string | null;
}

const LOADING_LABELS: Record<string, string> = {
  analyse: "Running analysis…",
  discover: "Searching listings…",
  followup: "Thinking…",
};

export function MessageBubble({ message, actions }: { message: ChatMessage; actions: MessageActions }) {
  const { type } = message;

  if (type === "loading") {
    return (
      <div className="msg assistant">
        <div className="ws-loading">
          <span className="ws-dots">
            <span />
            <span />
            <span />
          </span>
          {message.retryLabel || LOADING_LABELS[message.loadingMode ?? "followup"]}
        </div>
      </div>
    );
  }

  if (type === "report" && message.report) {
    return (
      <div className="msg assistant" style={{ width: "100%" }}>
        <div style={{ width: "100%" }}>
          <div className="report-toolbar">
            <button className="btn btn-primary" onClick={() => actions.onExportPdf(message)}>
              ⬇ Export white-label PDF
            </button>
          </div>
          <ReportView report={message.report} />
        </div>
      </div>
    );
  }

  if (type === "report_group" && message.reportGroup) {
    return (
      <div className="msg assistant" style={{ width: "100%" }}>
        <div style={{ width: "100%" }}>
          <ReportGroupView group={message.reportGroup} />
        </div>
      </div>
    );
  }

  if (type === "agent_contact" && (message.agentPhone || message.agentListingUrl)) {
    return (
      <div className="msg assistant">
        <div className="agent-contact-card">
          <div className="agent-contact-avatar">
            {message.agentAvatarUrl ? (
              <img src={message.agentAvatarUrl} alt="" />
            ) : (
              <span>{initials(message.agentName)}</span>
            )}
          </div>
          <div className="agent-contact-main">
            <div className="agent-contact-kicker">Sales agent</div>
            <div className="agent-contact-name">{message.agentName || "Listing agent"}</div>
            {message.agencyName && <div className="agent-contact-agency">{message.agencyName}</div>}
            {message.propertyAddress && <div className="agent-contact-property">{message.propertyAddress}</div>}
            <div className="agent-contact-details">
              {message.agentPhone ? (
                <div>
                  <span className="agent-contact-label">Phone</span>
                  <span className="agent-contact-phone">{message.agentPhone}</span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === "search") {
    const results = message.searchResults ?? [];
    return (
      <div className="msg assistant" style={{ width: "100%" }}>
        <div style={{ width: "100%" }}>
          {message.aiIntro && <p className="msg-intro">{message.aiIntro}</p>}
          <div className="ws-cards">
            {results.map((c, i) => (
              <PropertyCard
                key={`${c.listingUrl ?? c.address}-${i}`}
                candidate={c}
                presentation={message.searchPresentation ?? "scored_screening"}
                onAnalyse={actions.onAnalyse}
                analysing={actions.analysingAddress === c.address}
              />
            ))}
          </div>
          {message.continuationToken && (
            <div className="ws-showmore">
              <button
                className="btn btn-quiet"
                onClick={() => actions.onShowMore(message)}
                disabled={message.showMoreStatus === "loading"}
              >
                {message.showMoreStatus === "loading" ? "Loading…" : "Show more"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (
    type === "subdivision_clarification" ||
    type === "address_clarification" ||
    type === "discovery_exhausted_choice"
  ) {
    const c = message.clarification;
    return (
      <div className="msg assistant">
        <div className="msg-bubble">
          {c?.question || "Could you clarify?"}
          {c?.options && c.options.length > 0 && (
            <div className="ws-chips">
              {c.options.map((opt, i) => (
                <button key={i} className="ws-chip" onClick={() => actions.onChip(message, opt)}>
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (type === "provider_upgrade_gate") {
    return (
      <div className="msg assistant">
        <div className="msg-bubble">
          Connecting with a provider requires an active subscription.{" "}
          <a href="/provider-portal/">Manage subscription ↗</a>
        </div>
      </div>
    );
  }

  // text (and any unhandled type with content)
  if (!message.content) return null;
  return (
    <div className={`msg ${message.role}`}>
      <div className="msg-bubble">{message.content}</div>
    </div>
  );
}

function initials(name?: string | null): string {
  const parts = String(name || "Agent").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A";
}
